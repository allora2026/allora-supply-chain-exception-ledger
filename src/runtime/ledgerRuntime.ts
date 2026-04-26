import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { buildOperatorSurfaceModel, renderOperatorSurface, type OperatorSurfaceModel } from '../rendering/exceptionOperatorView.js';
import { projectExceptionCase, type ExceptionCase, type FlowcoreEvent } from '../projection/exceptionProjector.js';
import {
  createFlowcoreContext,
  createLedgerEntityKey,
  getFlowcoreConfig,
  getRuntimeStorePath,
  ingestFlowcoreEvent,
  type FlowcoreConfig,
  type FlowcoreIngestionResult
} from '../integrations/flowcore.js';
import {
  createUsableFragmentForCase,
  getUsableConfig,
  hasUsableAccess,
  updateUsableFragmentForCase,
  type UsableFragmentSyncResult
} from '../integrations/usable.js';

export interface RuntimeEventRecord {
  runtimeEventId: string;
  sourceEventId: string;
  caseId: string;
  entityKey: string;
  receivedAt: string;
  occurredAt: string;
  event: FlowcoreEvent;
  flowcore: {
    tenant: string;
    dataCoreId: string | null;
    flowType: string;
    eventType: string;
    timeBucket: string;
    pathwayName: string;
    route: string;
    ingestionEndpoint: string | null;
    sourceEventId: string;
    liveEventId: string | null;
    ingestionMode: 'live' | 'local-only';
    lastResponseStatus: number | null;
  };
}

export interface RuntimeCaseRecord {
  caseId: string;
  canonicalKey: ExceptionCase['canonical_key'];
  projectedCase: ExceptionCase;
  operatorSurface: OperatorSurfaceModel;
  rendered: string;
  sourceEventIds: string[];
  lastEventAt: string;
  lastReceivedAt: string;
  integrations: {
    flowcore: {
      ingestionMode: 'live' | 'local-only';
      liveEventIds: string[];
      route: string;
      eventType: string;
      flowType: string;
    };
    usable: UsableFragmentSyncResult;
  };
}

interface RuntimeState {
  version: 1;
  generatedAt: string | null;
  flowcore: {
    tenant: string;
    dataCoreId: string | null;
    dataCoreName: string;
    flowType: string;
    eventType: string;
    pathwayName: string;
    ingestionBaseUrl: string;
  };
  events: RuntimeEventRecord[];
  cases: RuntimeCaseRecord[];
}

export interface RuntimeOptions {
  env?: NodeJS.ProcessEnv;
  root?: string;
}

export interface TriggerEventOptions extends RuntimeOptions {
  event: FlowcoreEvent;
  receivedAt?: string;
  fetchImpl?: typeof fetch;
}

export interface RefreshCaseOptions extends RuntimeOptions {
  caseId: string;
  fetchImpl?: typeof fetch;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildCaseId(canonicalKey: FlowcoreEvent['canonical_key']): string {
  return `${canonicalKey.shipment_id}::${canonicalKey.document_type}::${canonicalKey.order_reference}`;
}

function compareEvents(left: RuntimeEventRecord, right: RuntimeEventRecord): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.receivedAt.localeCompare(right.receivedAt) || left.sourceEventId.localeCompare(right.sourceEventId);
}

function createEmptyRuntimeState(config: FlowcoreConfig): RuntimeState {
  return {
    version: 1,
    generatedAt: null,
    flowcore: {
      tenant: config.tenant,
      dataCoreId: config.dataCoreId,
      dataCoreName: config.dataCoreName,
      flowType: config.flowType,
      eventType: config.eventType,
      pathwayName: config.pathwayName,
      ingestionBaseUrl: config.ingestionBaseUrl
    },
    events: [],
    cases: []
  };
}

function ensureRuntimeStoreFile(options: RuntimeOptions = {}): string {
  const path = getRuntimeStorePath(options);

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(createEmptyRuntimeState(getFlowcoreConfig(options.env)), null, 2)}\n`);
  }

  return path;
}

function readRuntimeState(options: RuntimeOptions = {}): RuntimeState {
  const path = ensureRuntimeStoreFile(options);
  return JSON.parse(readFileSync(path, 'utf8')) as RuntimeState;
}

function writeRuntimeState(state: RuntimeState, options: RuntimeOptions = {}): void {
  const path = ensureRuntimeStoreFile(options);
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function findCaseIndex(state: RuntimeState, caseId: string): number {
  return state.cases.findIndex((item) => item.caseId === caseId);
}

function normalizeUsableContext(existing?: Partial<UsableFragmentSyncResult> | null): UsableFragmentSyncResult {
  return {
    accessMode: existing?.accessMode === 'live' ? 'live' : 'local-only',
    fragmentId: existing?.fragmentId ?? null,
    workspaceId: existing?.workspaceId ?? null,
    url: existing?.url ?? null,
    title: existing?.title ?? null,
    content: existing?.content ?? null,
    lastSyncedAt: existing?.lastSyncedAt ?? null
  };
}

function validateEventShape(event: FlowcoreEvent): void {
  if (!event || typeof event !== 'object') {
    throw new Error('Trigger requires a Flowcore event payload');
  }

  if (!event.event_family || !event.source_family || !event.occurred_at) {
    throw new Error('Trigger requires event_family, source_family, and occurred_at');
  }

  if (!event.provenance?.event_id || !event.provenance?.artifact_ref) {
    throw new Error('Trigger requires provenance.event_id and provenance.artifact_ref');
  }

  if (!event.canonical_key?.shipment_id || !event.canonical_key?.document_type || !event.canonical_key?.order_reference) {
    throw new Error('Trigger requires canonical_key shipment_id, document_type, and order_reference');
  }
}

function buildCaseRecord({
  caseId,
  events,
  existingCase
}: {
  caseId: string;
  events: RuntimeEventRecord[];
  existingCase?: RuntimeCaseRecord | null;
}): RuntimeCaseRecord {
  const orderedEvents = [...events].sort(compareEvents);
  const projectedCase = projectExceptionCase(orderedEvents.map((item) => item.event));

  if (!projectedCase) {
    throw new Error(`Case ${caseId} could not be projected from persisted events`);
  }

  const operatorSurface = buildOperatorSurfaceModel([projectedCase]);
  const rendered = renderOperatorSurface(operatorSurface);
  const sourceEventIds = orderedEvents.map((item) => item.sourceEventId);
  const liveEventIds = orderedEvents
    .map((item) => item.flowcore.liveEventId)
    .filter((item): item is string => Boolean(item));
  const hasLiveFlowcoreEvent = orderedEvents.some((item) => item.flowcore.ingestionMode === 'live');
  const latestEvent = orderedEvents[orderedEvents.length - 1];

  return {
    caseId,
    canonicalKey: clone(projectedCase.canonical_key),
    projectedCase,
    operatorSurface,
    rendered,
    sourceEventIds,
    lastEventAt: latestEvent.occurredAt,
    lastReceivedAt: latestEvent.receivedAt,
    integrations: {
      flowcore: {
        ingestionMode: hasLiveFlowcoreEvent ? 'live' : 'local-only',
        liveEventIds,
        route: latestEvent.flowcore.route,
        eventType: latestEvent.flowcore.eventType,
        flowType: latestEvent.flowcore.flowType
      },
      usable: normalizeUsableContext(existingCase?.integrations?.usable)
    }
  };
}

async function syncCaseToUsable({
  caseRecord,
  fetchImpl,
  env,
  existingCase
}: {
  caseRecord: RuntimeCaseRecord;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  existingCase?: RuntimeCaseRecord | null;
}): Promise<UsableFragmentSyncResult> {
  const usableConfig = getUsableConfig(env);

  if (!hasUsableAccess(usableConfig)) {
    return normalizeUsableContext({
      ...existingCase?.integrations.usable,
      accessMode: 'local-only'
    });
  }

  const caseForSync = {
    caseId: caseRecord.caseId,
    projectedCase: caseRecord.projectedCase,
    rendered: caseRecord.rendered,
    sourceEventIds: caseRecord.sourceEventIds,
    integrations: {
      flowcore: caseRecord.integrations.flowcore,
      usable: { accessMode: 'live' as const }
    }
  };

  if (existingCase?.integrations.usable.fragmentId) {
    return updateUsableFragmentForCase({
      caseRecord: caseForSync,
      fragmentId: existingCase.integrations.usable.fragmentId,
      fetchImpl,
      config: usableConfig
    });
  }

  return createUsableFragmentForCase({
    caseRecord: caseForSync,
    fetchImpl,
    config: usableConfig
  });
}

function upsertEvent(state: RuntimeState, eventRecord: RuntimeEventRecord): void {
  const existingIndex = state.events.findIndex((item) => item.sourceEventId === eventRecord.sourceEventId);

  if (existingIndex === -1) {
    state.events.push(eventRecord);
    return;
  }

  state.events[existingIndex] = eventRecord;
}

export function getRuntimeStatus(options: RuntimeOptions = {}): {
  application: 'ledger.allora.usable.dev';
  flowcore: ReturnType<typeof getFlowcoreConfig> & { ingestionMode: 'live' | 'local-only' };
  usable: ReturnType<typeof getUsableConfig> & { accessMode: 'live' | 'local-only' };
  counts: { events: number; cases: number };
} {
  const state = readRuntimeState(options);
  const flowcoreConfig = getFlowcoreConfig(options.env);
  const usableConfig = getUsableConfig(options.env);

  return {
    application: 'ledger.allora.usable.dev',
    flowcore: {
      ...flowcoreConfig,
      ingestionMode: flowcoreConfig.apiKey && flowcoreConfig.dataCoreId ? 'live' : 'local-only'
    },
    usable: {
      ...usableConfig,
      accessMode: hasUsableAccess(usableConfig) ? 'live' : 'local-only'
    },
    counts: {
      events: state.events.length,
      cases: state.cases.length
    }
  };
}

export function listRuntimeEvents(options: RuntimeOptions = {}): RuntimeEventRecord[] {
  return clone([...readRuntimeState(options).events].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)));
}

export function listRuntimeCases(options: RuntimeOptions = {}): RuntimeCaseRecord[] {
  return clone([...readRuntimeState(options).cases].sort((left, right) => right.lastReceivedAt.localeCompare(left.lastReceivedAt)));
}

export function getRuntimeCaseById(caseId: string, options: RuntimeOptions = {}): RuntimeCaseRecord | null {
  return listRuntimeCases(options).find((item) => item.caseId === caseId) ?? null;
}

export async function triggerLedgerEvent({
  event,
  receivedAt = new Date().toISOString(),
  fetchImpl,
  ...options
}: TriggerEventOptions): Promise<RuntimeCaseRecord> {
  validateEventShape(event);

  const state = readRuntimeState(options);
  const config = getFlowcoreConfig(options.env);
  const caseId = buildCaseId(event.canonical_key);
  const existingEvent = state.events.find((item) => item.sourceEventId === event.provenance.event_id) ?? null;
  const shouldIngestLive = Boolean(config.apiKey && config.dataCoreId && existingEvent?.flowcore.ingestionMode !== 'live');
  const liveIngestion: FlowcoreIngestionResult = shouldIngestLive || !existingEvent
    ? await ingestFlowcoreEvent({ payload: event, fetchImpl, config })
    : {
        ingestionMode: existingEvent.flowcore.ingestionMode,
        liveEventId: existingEvent.flowcore.liveEventId,
        timeBucket: existingEvent.flowcore.timeBucket,
        responseStatus: existingEvent.flowcore.lastResponseStatus,
        responseBody: null
      };
  const flowcoreContext = createFlowcoreContext({ event, receivedAt, config });
  const eventRecord: RuntimeEventRecord = {
    runtimeEventId: liveIngestion.liveEventId ?? event.provenance.event_id,
    sourceEventId: event.provenance.event_id,
    caseId,
    entityKey: createLedgerEntityKey(event),
    receivedAt,
    occurredAt: event.occurred_at,
    event: clone(event),
    flowcore: {
      tenant: flowcoreContext.tenant,
      dataCoreId: flowcoreContext.dataCoreId,
      flowType: flowcoreContext.flowType,
      eventType: flowcoreContext.eventType,
      timeBucket: liveIngestion.timeBucket ?? flowcoreContext.timeBucket,
      pathwayName: flowcoreContext.pathwayName,
      route: flowcoreContext.route,
      ingestionEndpoint: flowcoreContext.ingestionEndpoint,
      sourceEventId: flowcoreContext.sourceEventId,
      liveEventId: liveIngestion.liveEventId,
      ingestionMode: liveIngestion.ingestionMode,
      lastResponseStatus: liveIngestion.responseStatus
    }
  };

  upsertEvent(state, eventRecord);

  const caseEvents = state.events.filter((item) => item.caseId === caseId);
  const caseIndex = findCaseIndex(state, caseId);
  const existingCase = caseIndex === -1 ? null : state.cases[caseIndex];
  const caseRecord = buildCaseRecord({ caseId, events: caseEvents, existingCase });
  caseRecord.integrations.usable = await syncCaseToUsable({ caseRecord, fetchImpl, env: options.env, existingCase });

  if (caseIndex === -1) {
    state.cases.push(caseRecord);
  } else {
    state.cases[caseIndex] = caseRecord;
  }

  state.generatedAt = receivedAt;
  writeRuntimeState(state, options);

  return clone(caseRecord);
}

export async function refreshCaseUsableContext({ caseId, fetchImpl, ...options }: RefreshCaseOptions): Promise<RuntimeCaseRecord | null> {
  const state = readRuntimeState(options);
  const caseIndex = findCaseIndex(state, caseId);

  if (caseIndex === -1) {
    return null;
  }

  const existingCase = state.cases[caseIndex];
  const updatedCase = clone(existingCase);
  updatedCase.integrations.usable = await syncCaseToUsable({
    caseRecord: updatedCase,
    fetchImpl,
    env: options.env,
    existingCase
  });
  state.cases[caseIndex] = updatedCase;
  state.generatedAt = new Date().toISOString();
  writeRuntimeState(state, options);

  return clone(updatedCase);
}
