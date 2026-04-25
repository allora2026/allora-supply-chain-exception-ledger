import { describe, expect, it } from 'vitest';
import { projectExceptionCase, type FlowcoreEvent } from '../../src/projection/exceptionProjector';
import { buildOperatorSurfaceModel, renderOperatorSurface } from '../../src/rendering/exceptionOperatorView';

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

describe('exception operator surface', () => {
  it('builds and renders the minimal single-app operator surfaces from projected cases', () => {
    const projectedCase = projectExceptionCase([
      baseEvent({
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
      }),
      baseEvent({
        event_family: 'counterparty_requested_correction',
        occurred_at: '2026-04-25T16:10:00.000Z',
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
      }),
      baseEvent({
        event_family: 'corrected_document_received',
        occurred_at: '2026-04-25T16:20:00.000Z',
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
      }),
      baseEvent({
        event_family: 'shipment_hold_changed',
        occurred_at: '2026-04-25T16:30:00.000Z',
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
      })
    ]);

    expect(projectedCase).not.toBeNull();

    const model = buildOperatorSurfaceModel([projectedCase!]);
    const rendered = renderOperatorSurface(model);

    expect(model.application).toBe('ledger.allora.usable.dev');
    expect(model.exceptionList).toHaveLength(1);
    expect(model.exceptionList[0]).toMatchObject({
      caseId: 'SHIP-123::commercial_invoice::ORDER-456',
      shipmentId: 'SHIP-123',
      classification: 'mismatch',
      resolutionStatus: 'updated',
      blockingCounterpart: 'carrier',
      releaseStatus: 'pending_release'
    });
    expect(model.caseDetail).toMatchObject({
      shipmentId: 'SHIP-123',
      orderReference: 'ORDER-456',
      invoiceReference: 'INV-9-REV2',
      customerName: 'Acme Exporters',
      consigneeName: 'North Harbor Imports'
    });
    expect(model.evidenceTimeline).toHaveLength(4);
    expect(model.evidenceTimeline[0]).toMatchObject({
      label: 'Evidence 1',
      sourceFamily: 'edi_document_status',
      artifactRef: 'edi://broker/SHIP-123/mismatch'
    });
    expect(model.missingArtifactPanel).toEqual({
      title: 'Missing Artifact Panel',
      items: ['Has release control acknowledged the corrected commercial invoice?']
    });
    expect(model.counterpartState).toEqual({
      title: 'Counterpart State',
      blockingCounterpart: 'carrier',
      releaseStatus: 'pending_release',
      statusMessage: 'Waiting on carrier-facing release confirmation for shipment SHIP-123.'
    });
    expect(model.handoffNotes.notes).toEqual([
      'Single-app boundary: ledger.allora.usable.dev',
      'Focus the next shift on commercial_invoice for order ORDER-456.',
      'Current operator hypothesis: Release control is rechecking the corrected invoice before final release.'
    ]);
    expect(model.resolutionSnapshot).toEqual({
      title: 'Resolution Snapshot',
      resolutionStatus: 'updated',
      summary: 'Case is updated and awaiting final release acknowledgement.',
      openQuestionsCount: 1,
      evidenceCount: 4
    });

    expect(rendered).toContain('ledger.allora.usable.dev');
    expect(rendered).toContain('Exception List');
    expect(rendered).toContain('Case Detail');
    expect(rendered).toContain('Evidence Timeline');
    expect(rendered).toContain('Missing Artifact Panel');
    expect(rendered).toContain('Counterpart State');
    expect(rendered).toContain('Handoff Notes');
    expect(rendered).toContain('Resolution Snapshot');
  });
});
