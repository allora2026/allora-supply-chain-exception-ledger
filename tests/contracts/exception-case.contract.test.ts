import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const schemaPath = resolve(repoRoot, 'schemas/exception-case.v0.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validate = ajv.compile(schema);

describe('exception-case.v0.schema.json', () => {
  it('requires the canonical key and required case facts', () => {
    const sample = {
      case_type: 'commercial_invoice_or_customs_document_exception',
      canonical_key: {
        shipment_id: 'SHIP-123',
        document_type: 'commercial_invoice',
        order_reference: 'ORDER-456'
      },
      shipment: {
        shipment_id: 'SHIP-123',
        release_status: 'hold',
        invoice_reference: 'INV-9',
        consignee_name: 'North Harbor Imports'
      },
      customer_context: {
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports'
      },
      classification: 'missing',
      blocking_counterpart: 'broker',
      operator_hypothesis: 'Broker is waiting on the corrected invoice upload.',
      open_questions: ['Has the broker acknowledged the replacement invoice?'],
      usable_case_memory: {
        handoff_notes: ['Waiting for the docs team to upload the broker-ready invoice PDF.'],
        operator_hypotheses: ['Broker is waiting on the corrected invoice upload.'],
        missing_artifact_questions: ['Has the broker acknowledged the replacement invoice?'],
        resolution_snapshot: {
          summary: 'Resolved after the corrected invoice PDF was re-sent and acknowledged by the broker.',
          recorded_at: '2026-04-25T18:10:00.000Z',
          source_event_id: 'evt-closeout'
        },
        similar_cases: [
          {
            case_id: 'SHIP-321::commercial_invoice::ORDER-654',
            summary: 'Prior invoice mismatch cleared after broker-side HS code correction.',
            resolution_status: 'resolved'
          }
        ]
      },
      evidence: [
        {
          source_family: 'erp_order_invoice',
          artifact_ref: 'erp://orders/ORDER-456/invoice',
          provenance_event_id: 'evt-1'
        }
      ],
      resolution_status: 'waiting_for_artifact',
      source_families: ['erp_order_invoice', 'wms_shipment', 'tms_milestone']
    };

    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it('locks the wedge to a commercial-invoice keyed case and missing-vs-mismatch classification', () => {
    const invalid = {
      case_type: 'generic_supply_chain_case',
      canonical_key: {
        shipment_id: 'SHIP-123',
        document_type: 'packing_list',
        order_reference: 'ORDER-456'
      },
      shipment: {
        shipment_id: 'SHIP-123',
        release_status: 'hold',
        invoice_reference: 'INV-9'
      },
      customer_context: { customer_name: 'Acme Exporters' },
      classification: 'late',
      blocking_counterpart: 'customer',
      operator_hypothesis: 'Something is wrong',
      open_questions: [],
      evidence: [
        {
          source_family: 'erp_order_invoice',
          artifact_ref: 'erp://orders/ORDER-456/invoice',
          provenance_event_id: 'evt-1'
        }
      ],
      resolution_status: 'open',
      source_families: ['erp_order_invoice']
    };

    expect(validate(invalid)).toBe(false);
    const messages = (validate.errors ?? []).map((error) => error.instancePath + ':' + error.message).join('\n');
    expect(messages).toContain('document_type');
    expect(messages).toContain('classification');
    expect(messages).toContain('case_type');
  });

  it('requires durable usable-backed case memory for handoff, resolution, and similar-case recall', () => {
    const missingMemory = {
      case_type: 'commercial_invoice_or_customs_document_exception',
      canonical_key: {
        shipment_id: 'SHIP-123',
        document_type: 'commercial_invoice',
        order_reference: 'ORDER-456'
      },
      shipment: {
        shipment_id: 'SHIP-123',
        release_status: 'hold',
        invoice_reference: 'INV-9'
      },
      customer_context: { customer_name: 'Acme Exporters' },
      classification: 'missing',
      blocking_counterpart: 'broker',
      operator_hypothesis: 'Broker is waiting on the corrected invoice upload.',
      open_questions: ['Has the broker acknowledged the replacement invoice?'],
      evidence: [
        {
          source_family: 'erp_order_invoice',
          artifact_ref: 'erp://orders/ORDER-456/invoice',
          provenance_event_id: 'evt-1'
        }
      ],
      resolution_status: 'waiting_for_artifact',
      source_families: ['erp_order_invoice']
    };

    expect(validate(missingMemory)).toBe(false);
    const messages = (validate.errors ?? []).map((error) => error.instancePath + ':' + error.message).join('\n');
    expect(messages).toContain('usable_case_memory');
  });
});
