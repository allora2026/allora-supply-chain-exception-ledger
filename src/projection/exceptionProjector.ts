export type SourceFamily =
  | 'erp_order_invoice'
  | 'wms_shipment'
  | 'tms_milestone'
  | 'edi_document_status'
  | 'email_attachment_intake';

export type EventFamily =
  | 'shipment_hold_changed'
  | 'expected_document_present'
  | 'expected_document_missing'
  | 'document_mismatch_detected'
  | 'counterparty_requested_correction'
  | 'corrected_document_received'
  | 'operator_note_recorded'
  | 'case_resolved';

export type ResolutionStatus = 'open' | 'waiting_for_artifact' | 'updated' | 'resolved';
export type Classification = 'missing' | 'mismatch';
export type BlockingCounterpart = 'carrier' | 'broker' | 'warehouse' | 'internal_docs_team';
export type ReleaseStatus = 'hold' | 'pending_release' | 'released';

export interface CanonicalKey {
  shipment_id: string;
  document_type: 'commercial_invoice';
  order_reference: string;
}

export interface EventProvenance {
  event_id: string;
  artifact_ref: string;
}

export interface FlowcoreEventPayload {
  shipment_id?: string;
  invoice_reference?: string;
  customer_name?: string;
  consignee_name?: string;
  classification?: Classification;
  blocking_counterpart?: BlockingCounterpart;
  operator_hypothesis?: string;
  open_questions?: string[];
  release_status?: ReleaseStatus;
  customs_supporting_document_type?: 'packing_list' | 'certificate_of_origin' | 'other_customs_supporting_doc';
}

export interface FlowcoreEvent {
  event_family: EventFamily;
  canonical_key: CanonicalKey;
  source_family: SourceFamily;
  occurred_at: string;
  provenance: EventProvenance;
  correlation_state?: 'provisional' | 'canonical';
  payload?: FlowcoreEventPayload;
}

export interface EvidenceItem {
  source_family: SourceFamily;
  artifact_ref: string;
  provenance_event_id: string;
  customs_supporting_document_type?: 'packing_list' | 'certificate_of_origin' | 'other_customs_supporting_doc';
}

export interface ExceptionCase {
  case_type: 'commercial_invoice_or_customs_document_exception';
  canonical_key: CanonicalKey;
  shipment: {
    shipment_id: string;
    release_status: ReleaseStatus;
    invoice_reference: string;
    consignee_name?: string;
  };
  customer_context: {
    customer_name: string;
    consignee_name?: string;
  };
  classification: Classification;
  blocking_counterpart: BlockingCounterpart;
  operator_hypothesis: string;
  open_questions: string[];
  evidence: EvidenceItem[];
  resolution_status: ResolutionStatus;
  source_families: SourceFamily[];
}

const OPENING_EVENT_FAMILIES: EventFamily[] = ['expected_document_missing', 'document_mismatch_detected'];

const TRANSITIONS: Record<ResolutionStatus, Partial<Record<EventFamily, ResolutionStatus>>> = {
  open: {
    counterparty_requested_correction: 'waiting_for_artifact',
    shipment_hold_changed: 'updated',
    operator_note_recorded: 'open'
  },
  waiting_for_artifact: {
    corrected_document_received: 'updated',
    shipment_hold_changed: 'updated',
    operator_note_recorded: 'waiting_for_artifact'
  },
  updated: {
    shipment_hold_changed: 'updated',
    corrected_document_received: 'updated',
    operator_note_recorded: 'updated',
    case_resolved: 'resolved'
  },
  resolved: {
    operator_note_recorded: 'resolved'
  }
};

function assertNonEmpty(value: string | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required field: ${fieldName}`);
  }

  return value;
}

function buildDefaultHypothesis(classification: Classification): string {
  return classification === 'missing'
    ? 'Commercial invoice evidence is still missing for release.'
    : 'Commercial invoice evidence mismatches the expected shipment facts.';
}

function buildDefaultQuestions(classification: Classification): string[] {
  return classification === 'missing'
    ? ['Which counterparty will provide the missing commercial invoice evidence?']
    : ['Which shipment or invoice fact is causing the commercial invoice mismatch?'];
}

function inferClassification(event: FlowcoreEvent): Classification {
  if (event.event_family === 'document_mismatch_detected') {
    return 'mismatch';
  }

  return event.payload?.classification ?? 'missing';
}

function defaultBlockingCounterpart(sourceFamily: SourceFamily): BlockingCounterpart {
  switch (sourceFamily) {
    case 'email_attachment_intake':
      return 'internal_docs_team';
    case 'edi_document_status':
      return 'broker';
    case 'wms_shipment':
      return 'warehouse';
    case 'tms_milestone':
      return 'carrier';
    case 'erp_order_invoice':
    default:
      return 'internal_docs_team';
  }
}

function createEvidence(event: FlowcoreEvent): EvidenceItem {
  return {
    source_family: event.source_family,
    artifact_ref: event.provenance.artifact_ref,
    provenance_event_id: event.provenance.event_id,
    customs_supporting_document_type: event.payload?.customs_supporting_document_type
  };
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function cloneCase(currentCase: ExceptionCase): ExceptionCase {
  return {
    ...currentCase,
    canonical_key: { ...currentCase.canonical_key },
    shipment: { ...currentCase.shipment },
    customer_context: { ...currentCase.customer_context },
    open_questions: [...currentCase.open_questions],
    evidence: currentCase.evidence.map((item) => ({ ...item })),
    source_families: [...currentCase.source_families]
  };
}

export class ExceptionCaseProjector {
  private currentCase: ExceptionCase | null = null;

  private seenEventIds = new Set<string>();

  apply(event: FlowcoreEvent): ExceptionCase | null {
    if (this.seenEventIds.has(event.provenance.event_id)) {
      return this.getCase();
    }

    if (this.currentCase === null) {
      if (!OPENING_EVENT_FAMILIES.includes(event.event_family)) {
        return null;
      }

      this.currentCase = this.openCase(event);
      this.seenEventIds.add(event.provenance.event_id);
      return this.getCase();
    }

    this.assertSameCanonicalKey(event.canonical_key, this.currentCase.canonical_key);

    const currentStatus = this.currentCase.resolution_status;
    const nextStatus = TRANSITIONS[currentStatus][event.event_family];

    if (!nextStatus) {
      this.mergeEvidence(event);
      this.mergeSourceFamily(event.source_family);
      this.seenEventIds.add(event.provenance.event_id);
      return this.getCase();
    }

    this.currentCase.resolution_status = nextStatus;
    this.mergeCaseDetails(event);
    this.mergeEvidence(event);
    this.mergeSourceFamily(event.source_family);
    this.seenEventIds.add(event.provenance.event_id);

    return this.getCase();
  }

  getCase(): ExceptionCase | null {
    return this.currentCase ? cloneCase(this.currentCase) : null;
  }

  private openCase(event: FlowcoreEvent): ExceptionCase {
    const classification = inferClassification(event);
    const invoiceReference = assertNonEmpty(event.payload?.invoice_reference, 'payload.invoice_reference');
    const customerName = assertNonEmpty(event.payload?.customer_name, 'payload.customer_name');

    return {
      case_type: 'commercial_invoice_or_customs_document_exception',
      canonical_key: { ...event.canonical_key },
      shipment: {
        shipment_id: event.canonical_key.shipment_id,
        release_status: event.payload?.release_status ?? 'hold',
        invoice_reference: invoiceReference,
        consignee_name: event.payload?.consignee_name
      },
      customer_context: {
        customer_name: customerName,
        consignee_name: event.payload?.consignee_name
      },
      classification,
      blocking_counterpart: event.payload?.blocking_counterpart ?? defaultBlockingCounterpart(event.source_family),
      operator_hypothesis: event.payload?.operator_hypothesis ?? buildDefaultHypothesis(classification),
      open_questions: event.payload?.open_questions ?? buildDefaultQuestions(classification),
      evidence: [createEvidence(event)],
      resolution_status: 'open',
      source_families: [event.source_family]
    };
  }

  private mergeCaseDetails(event: FlowcoreEvent): void {
    if (!this.currentCase) {
      return;
    }

    const payload = event.payload;

    if (payload?.invoice_reference) {
      this.currentCase.shipment.invoice_reference = payload.invoice_reference;
    }

    if (payload?.release_status) {
      this.currentCase.shipment.release_status = payload.release_status;
    }

    if (payload?.consignee_name) {
      this.currentCase.shipment.consignee_name = payload.consignee_name;
      this.currentCase.customer_context.consignee_name = payload.consignee_name;
    }

    if (payload?.customer_name) {
      this.currentCase.customer_context.customer_name = payload.customer_name;
    }

    if (payload?.blocking_counterpart) {
      this.currentCase.blocking_counterpart = payload.blocking_counterpart;
    }

    if (payload?.operator_hypothesis) {
      this.currentCase.operator_hypothesis = payload.operator_hypothesis;
    }

    if (payload?.open_questions) {
      this.currentCase.open_questions = payload.open_questions;
    } else if (event.event_family === 'corrected_document_received') {
      this.currentCase.open_questions = ['Has release control acknowledged the corrected commercial invoice?'];
    } else if (event.event_family === 'case_resolved') {
      this.currentCase.open_questions = [];
    }
  }

  private mergeEvidence(event: FlowcoreEvent): void {
    if (!this.currentCase) {
      return;
    }

    const evidence = createEvidence(event);
    const exists = this.currentCase.evidence.some(
      (item) => item.provenance_event_id === evidence.provenance_event_id
    );

    if (!exists) {
      this.currentCase.evidence.push(evidence);
    }
  }

  private mergeSourceFamily(sourceFamily: SourceFamily): void {
    if (!this.currentCase) {
      return;
    }

    pushUnique(this.currentCase.source_families, sourceFamily);
  }

  private assertSameCanonicalKey(actual: CanonicalKey, expected: CanonicalKey): void {
    const mismatch = actual.shipment_id !== expected.shipment_id
      || actual.document_type !== expected.document_type
      || actual.order_reference !== expected.order_reference;

    if (mismatch) {
      throw new Error('Event canonical key does not match the active exception case');
    }
  }
}

export function projectExceptionCase(events: FlowcoreEvent[]): ExceptionCase | null {
  const projector = new ExceptionCaseProjector();

  for (const event of events) {
    projector.apply(event);
  }

  return projector.getCase();
}
