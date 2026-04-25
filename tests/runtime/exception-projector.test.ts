import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { ExceptionCaseProjector, projectExceptionCase, type FlowcoreEvent } from '../../src/projection/exceptionProjector';

const repoRoot = resolve(import.meta.dirname, '../..');
const caseSchema = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/exception-case.v0.schema.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateCase = ajv.compile(caseSchema);

function expectCaseToMatchSchema(projectedCase: unknown): void {
  expect(validateCase(projectedCase), JSON.stringify(validateCase.errors)).toBe(true);
}

function baseEvent(overrides: Partial<FlowcoreEvent>): FlowcoreEvent {
  return {
    event_family: 'expected_document_missing',
    canonical_key: {
      shipment_id: 'SHIP-123',
      document_type: 'commercial_invoice',
      order_reference: 'ORDER-456'
    },
    source_family: 'erp_order_invoice',
    occurred_at: '2026-04-25T16:00:00.000Z',
    provenance: {
      event_id: 'evt-open',
      artifact_ref: 'erp://orders/ORDER-456/invoice'
    },
    payload: {
      invoice_reference: 'INV-9',
      customer_name: 'Acme Exporters',
      consignee_name: 'North Harbor Imports',
      blocking_counterpart: 'broker',
      operator_hypothesis: 'Broker cannot clear the shipment until the commercial invoice is present.',
      open_questions: ['Which corrected commercial invoice file is the broker waiting on?'],
      release_status: 'hold'
    },
    ...overrides
  };
}

describe('ExceptionCaseProjector', () => {
  it('opens a durable exception case from correlated events using the canonical key', () => {
    const projectedCase = projectExceptionCase([
      baseEvent({
        event_family: 'expected_document_missing',
        provenance: {
          event_id: 'evt-open',
          artifact_ref: 'erp://orders/ORDER-456/invoice'
        }
      })
    ]);

    expect(projectedCase).not.toBeNull();
    expect(projectedCase?.canonical_key).toEqual({
      shipment_id: 'SHIP-123',
      document_type: 'commercial_invoice',
      order_reference: 'ORDER-456'
    });
    expect(projectedCase?.resolution_status).toBe('open');
    expect(projectedCase?.classification).toBe('missing');
    expect(projectedCase?.shipment.release_status).toBe('hold');
    expect(projectedCase?.source_families).toEqual(['erp_order_invoice']);
    expectCaseToMatchSchema(projectedCase);
  });

  it('wakes and updates the same case on later evidence while preserving provenance', () => {
    const projector = new ExceptionCaseProjector();

    projector.apply(baseEvent({
      event_family: 'document_mismatch_detected',
      provenance: {
        event_id: 'evt-open-mismatch',
        artifact_ref: 'edi://broker/SHIP-123/mismatch'
      },
      source_family: 'edi_document_status',
      payload: {
        invoice_reference: 'INV-9',
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports',
        classification: 'mismatch',
        blocking_counterpart: 'broker',
        operator_hypothesis: 'Broker flagged a mismatch between the invoice and customs data.',
        open_questions: ['Which invoice field disagrees with the customs filing?'],
        release_status: 'hold',
        customs_supporting_document_type: 'packing_list'
      }
    }));

    projector.apply(baseEvent({
      event_family: 'counterparty_requested_correction',
      provenance: {
        event_id: 'evt-request-correction',
        artifact_ref: 'mail://threads/42/messages/7'
      },
      source_family: 'email_attachment_intake',
      payload: {
        invoice_reference: 'INV-9',
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports',
        blocking_counterpart: 'broker',
        operator_hypothesis: 'Broker requested a corrected commercial invoice PDF.',
        open_questions: ['Has the broker received the corrected commercial invoice PDF?'],
        release_status: 'hold'
      }
    }));

    projector.apply(baseEvent({
      event_family: 'corrected_document_received',
      provenance: {
        event_id: 'evt-corrected-document',
        artifact_ref: 'mail://threads/42/attachments/invoice-corrected.pdf'
      },
      source_family: 'email_attachment_intake',
      payload: {
        invoice_reference: 'INV-9-REV2',
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports',
        blocking_counterpart: 'broker',
        operator_hypothesis: 'Corrected commercial invoice received and ready for broker review.',
        release_status: 'pending_release'
      }
    }));

    projector.apply(baseEvent({
      event_family: 'shipment_hold_changed',
      provenance: {
        event_id: 'evt-hold-updated',
        artifact_ref: 'tms://shipments/SHIP-123/hold-status'
      },
      source_family: 'tms_milestone',
      payload: {
        invoice_reference: 'INV-9-REV2',
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports',
        blocking_counterpart: 'carrier',
        operator_hypothesis: 'Release control is rechecking the corrected invoice before final release.',
        release_status: 'pending_release'
      }
    }));

    const projectedCase = projector.getCase();

    expect(projectedCase).not.toBeNull();
    expect(projectedCase?.resolution_status).toBe('updated');
    expect(projectedCase?.shipment.invoice_reference).toBe('INV-9-REV2');
    expect(projectedCase?.shipment.release_status).toBe('pending_release');
    expect(projectedCase?.blocking_counterpart).toBe('carrier');
    expect(projectedCase?.classification).toBe('mismatch');
    expect(projectedCase?.evidence.map((item) => item.provenance_event_id)).toEqual([
      'evt-open-mismatch',
      'evt-request-correction',
      'evt-corrected-document',
      'evt-hold-updated'
    ]);
    expect(projectedCase?.source_families).toEqual([
      'edi_document_status',
      'email_attachment_intake',
      'tms_milestone'
    ]);
    expectCaseToMatchSchema(projectedCase);
  });

  it('suppresses duplicate evidence instead of creating inbox-style duplicate case updates', () => {
    const projector = new ExceptionCaseProjector();
    const openingEvent = baseEvent({
      event_family: 'expected_document_missing',
      provenance: {
        event_id: 'evt-duplicate-open',
        artifact_ref: 'erp://orders/ORDER-456/invoice'
      }
    });

    projector.apply(openingEvent);
    projector.apply(openingEvent);

    const projectedCase = projector.getCase();

    expect(projectedCase).not.toBeNull();
    expect(projectedCase?.evidence).toHaveLength(1);
    expect(projectedCase?.source_families).toEqual(['erp_order_invoice']);
    expect(projectedCase?.resolution_status).toBe('open');
    expectCaseToMatchSchema(projectedCase);
  });
});
