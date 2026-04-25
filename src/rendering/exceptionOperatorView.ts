import type {
  ExceptionCase,
  EvidenceItem,
  ResolutionStatus,
  SimilarCaseReference
} from '../projection/exceptionProjector';

export interface ExceptionListItem {
  caseId: string;
  shipmentId: string;
  classification: ExceptionCase['classification'];
  resolutionStatus: ResolutionStatus;
  blockingCounterpart: ExceptionCase['blocking_counterpart'];
  releaseStatus: ExceptionCase['shipment']['release_status'];
}

export interface CaseDetail {
  shipmentId: string;
  orderReference: string;
  invoiceReference: string;
  customerName: string;
  consigneeName?: string;
}

export interface EvidenceTimelineItem {
  label: string;
  sourceFamily: EvidenceItem['source_family'];
  artifactRef: string;
  provenanceEventId: string;
  supportingDocumentType?: EvidenceItem['customs_supporting_document_type'];
}

export interface MissingArtifactPanel {
  title: 'Missing Artifact Panel';
  items: string[];
}

export interface CounterpartState {
  title: 'Counterpart State';
  blockingCounterpart: ExceptionCase['blocking_counterpart'];
  releaseStatus: ExceptionCase['shipment']['release_status'];
  statusMessage: string;
}

export interface HandoffNotes {
  title: 'Handoff Notes';
  notes: string[];
}

export interface SimilarHistoricalException {
  caseId: string;
  summary: string;
  resolutionStatus: ResolutionStatus;
}

export interface ResolutionSnapshot {
  title: 'Resolution Snapshot';
  resolutionStatus: ResolutionStatus;
  summary: string;
  openQuestionsCount: number;
  evidenceCount: number;
  similarCases: SimilarHistoricalException[];
}

export interface OperatorSurfaceModel {
  application: 'ledger.allora.usable.dev';
  exceptionList: ExceptionListItem[];
  caseDetail: CaseDetail | null;
  evidenceTimeline: EvidenceTimelineItem[];
  missingArtifactPanel: MissingArtifactPanel;
  counterpartState: CounterpartState | null;
  handoffNotes: HandoffNotes;
  resolutionSnapshot: ResolutionSnapshot | null;
}

function buildCaseId(exceptionCase: ExceptionCase): string {
  const { shipment_id, document_type, order_reference } = exceptionCase.canonical_key;
  return `${shipment_id}::${document_type}::${order_reference}`;
}

function buildStatusMessage(exceptionCase: ExceptionCase): string {
  switch (exceptionCase.shipment.release_status) {
    case 'hold':
      return `Waiting on ${exceptionCase.blocking_counterpart}-facing evidence for shipment ${exceptionCase.shipment.shipment_id}.`;
    case 'pending_release':
      return `Waiting on ${exceptionCase.blocking_counterpart}-facing release confirmation for shipment ${exceptionCase.shipment.shipment_id}.`;
    case 'released':
      return `Shipment ${exceptionCase.shipment.shipment_id} is released.`;
  }
}

function buildResolutionSummary(exceptionCase: ExceptionCase): string {
  switch (exceptionCase.resolution_status) {
    case 'open':
      return 'Case is open and needs operator follow-up.';
    case 'waiting_for_artifact':
      return 'Case is waiting on missing artifact delivery.';
    case 'updated':
      return 'Case is updated and awaiting final release acknowledgement.';
    case 'resolved':
      return 'Case is resolved and ready for memory closeout.';
  }
}

function pickPrimaryCase(exceptionCases: ExceptionCase[]): ExceptionCase | null {
  return exceptionCases[0] ?? null;
}

function mapSimilarCases(similarCases: SimilarCaseReference[]): SimilarHistoricalException[] {
  return similarCases.map((item) => ({
    caseId: item.case_id,
    summary: item.summary,
    resolutionStatus: item.resolution_status
  }));
}

export function buildOperatorSurfaceModel(exceptionCases: ExceptionCase[]): OperatorSurfaceModel {
  const primaryCase = pickPrimaryCase(exceptionCases);

  return {
    application: 'ledger.allora.usable.dev',
    exceptionList: exceptionCases.map((exceptionCase) => ({
      caseId: buildCaseId(exceptionCase),
      shipmentId: exceptionCase.shipment.shipment_id,
      classification: exceptionCase.classification,
      resolutionStatus: exceptionCase.resolution_status,
      blockingCounterpart: exceptionCase.blocking_counterpart,
      releaseStatus: exceptionCase.shipment.release_status
    })),
    caseDetail: primaryCase
      ? {
          shipmentId: primaryCase.shipment.shipment_id,
          orderReference: primaryCase.canonical_key.order_reference,
          invoiceReference: primaryCase.shipment.invoice_reference,
          customerName: primaryCase.customer_context.customer_name,
          consigneeName: primaryCase.customer_context.consignee_name
        }
      : null,
    evidenceTimeline: primaryCase
      ? primaryCase.evidence.map((item, index) => ({
          label: `Evidence ${index + 1}`,
          sourceFamily: item.source_family,
          artifactRef: item.artifact_ref,
          provenanceEventId: item.provenance_event_id,
          supportingDocumentType: item.customs_supporting_document_type
        }))
      : [],
    missingArtifactPanel: {
      title: 'Missing Artifact Panel',
      items: primaryCase?.usable_case_memory.missing_artifact_questions ?? []
    },
    counterpartState: primaryCase
      ? {
          title: 'Counterpart State',
          blockingCounterpart: primaryCase.blocking_counterpart,
          releaseStatus: primaryCase.shipment.release_status,
          statusMessage: buildStatusMessage(primaryCase)
        }
      : null,
    handoffNotes: {
      title: 'Handoff Notes',
      notes: primaryCase?.usable_case_memory.handoff_notes ?? ['Single-app boundary: ledger.allora.usable.dev']
    },
    resolutionSnapshot: primaryCase
      ? {
          title: 'Resolution Snapshot',
          resolutionStatus: primaryCase.resolution_status,
          summary: primaryCase.usable_case_memory.resolution_snapshot?.summary ?? buildResolutionSummary(primaryCase),
          openQuestionsCount: primaryCase.open_questions.length,
          evidenceCount: primaryCase.evidence.length,
          similarCases: mapSimilarCases(primaryCase.usable_case_memory.similar_cases)
        }
      : null
  };
}

export function renderOperatorSurface(model: OperatorSurfaceModel): string {
  const sections: string[] = [
    `Application: ${model.application}`,
    'Exception List',
    ...model.exceptionList.map(
      (item) => `- ${item.caseId} [${item.classification}/${item.resolutionStatus}] -> ${item.releaseStatus}`
    )
  ];

  if (model.caseDetail) {
    sections.push(
      'Case Detail',
      `- Shipment: ${model.caseDetail.shipmentId}`,
      `- Order: ${model.caseDetail.orderReference}`,
      `- Invoice: ${model.caseDetail.invoiceReference}`,
      `- Customer: ${model.caseDetail.customerName}`,
      `- Consignee: ${model.caseDetail.consigneeName ?? 'unknown'}`
    );
  }

  sections.push(
    'Evidence Timeline',
    ...model.evidenceTimeline.map(
      (item) => `- ${item.label}: ${item.sourceFamily} (${item.artifactRef})`
    ),
    'Missing Artifact Panel',
    ...model.missingArtifactPanel.items.map((item) => `- ${item}`)
  );

  if (model.counterpartState) {
    sections.push(
      'Counterpart State',
      `- ${model.counterpartState.statusMessage}`
    );
  }

  sections.push(
    'Handoff Notes',
    ...model.handoffNotes.notes.map((note) => `- ${note}`)
  );

  if (model.resolutionSnapshot) {
    sections.push(
      'Resolution Snapshot',
      `- ${model.resolutionSnapshot.summary}`
    );

    if (model.resolutionSnapshot.similarCases.length > 0) {
      sections.push(
        'Similar Historical Exceptions',
        ...model.resolutionSnapshot.similarCases.map(
          (item) => `- ${item.caseId} [${item.resolutionStatus}] -> ${item.summary}`
        )
      );
    }
  }

  return sections.join('\n');
}
