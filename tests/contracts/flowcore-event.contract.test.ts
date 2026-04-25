import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
const eventSchema = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/flowcore-event.v0.schema.json'), 'utf8'));
const stateMachine = JSON.parse(readFileSync(resolve(repoRoot, 'schemas/exception-state-machine.v0.json'), 'utf8'));
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(eventSchema);

describe('flowcore-event and state-machine contracts', () => {
  it('accepts only the required v0 event families', () => {
    const sample = {
      event_family: 'corrected_document_received',
      canonical_key: {
        shipment_id: 'SHIP-123',
        document_type: 'commercial_invoice',
        order_reference: 'ORDER-456'
      },
      source_family: 'email_attachment_intake',
      occurred_at: '2026-04-25T14:30:00.000Z',
      provenance: {
        event_id: 'evt-2',
        artifact_ref: 'mail://thread/abc/attachment/1'
      },
      correlation_state: 'canonical',
      payload: {
        filename: 'invoice-corrected.pdf'
      }
    };

    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects inbox-style event families and enforces the single resolution path', () => {
    const invalid = {
      event_family: 'message_triaged',
      canonical_key: {
        shipment_id: 'SHIP-123',
        document_type: 'commercial_invoice',
        order_reference: 'ORDER-456'
      },
      source_family: 'email_attachment_intake',
      occurred_at: '2026-04-25T14:30:00.000Z',
      provenance: {
        event_id: 'evt-2',
        artifact_ref: 'mail://thread/abc/attachment/1'
      }
    };

    expect(validate(invalid)).toBe(false);
    const transitionPairs = stateMachine.transitions.map((transition: { from: string; to: string; event_family: string }) => `${transition.from}:${transition.event_family}:${transition.to}`);
    expect(transitionPairs).toContain('provisional_correlation:expected_document_missing:open');
    expect(transitionPairs).toContain('open:counterparty_requested_correction:waiting_for_artifact');
    expect(transitionPairs).toContain('waiting_for_artifact:corrected_document_received:updated');
    expect(transitionPairs).toContain('updated:case_resolved:resolved');
    expect(transitionPairs).not.toContain('resolved:shipment_hold_changed:open');
  });
});
