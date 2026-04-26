import type { FlowcoreEvent } from './projection/exceptionProjector.js';

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

export function buildOpenScenarioEvents(): FlowcoreEvent[] {
  return [
    baseEvent({
      event_family: 'expected_document_missing',
      provenance: {
        event_id: 'evt-open',
        artifact_ref: 'erp://orders/ORDER-456/invoice'
      }
    })
  ];
}

export function buildUpdatedScenarioEvents(): FlowcoreEvent[] {
  return [
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
        release_status: 'pending_release',
        similar_cases: [
          {
            case_id: 'SHIP-900::commercial_invoice::ORDER-900',
            summary: 'Prior customs-document miss resolved after the broker accepted a corrected invoice PDF.',
            resolution_status: 'resolved'
          }
        ]
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
  ];
}

export function buildResolvedScenarioEvents(): FlowcoreEvent[] {
  return [
    ...buildUpdatedScenarioEvents(),
    baseEvent({
      event_family: 'case_resolved',
      occurred_at: '2026-04-25T16:45:00.000Z',
      provenance: {
        event_id: 'evt-case-resolved',
        artifact_ref: 'tms://shipments/SHIP-123/released'
      },
      source_family: 'tms_milestone',
      payload: {
        invoice_reference: 'INV-9-REV2',
        customer_name: 'Acme Exporters',
        consignee_name: 'North Harbor Imports',
        blocking_counterpart: 'carrier',
        operator_hypothesis: 'Shipment released after the corrected invoice package was accepted.',
        release_status: 'released',
        resolution_summary: 'Commercial invoice exception resolved after corrected invoice acceptance and release confirmation.'
      }
    })
  ];
}
