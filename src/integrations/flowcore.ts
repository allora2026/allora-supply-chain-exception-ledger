import { isAbsolute, join } from 'node:path';
import type { FlowcoreEvent } from '../projection/exceptionProjector.js';

export const DEFAULT_RUNTIME_STORE_FILE = join('data', 'runtime-store.json');

export interface FlowcoreConfig {
  apiKey: string | null;
  ingestionBaseUrl: string;
  tenant: string;
  dataCoreId: string | null;
  dataCoreName: string;
  flowType: string;
  eventType: string;
  pathwayName: string;
  runtimeStoreFile: string;
}

export interface FlowcoreContext {
  tenant: string;
  dataCoreId: string | null;
  flowType: string;
  eventType: string;
  timeBucket: string;
  pathwayName: string;
  route: string;
  ingestionEndpoint: string | null;
  ingestionMode: 'live' | 'local-only';
  sourceEventId: string;
  entityKey: string;
}

export interface FlowcoreIngestionResult {
  ingestionMode: 'live' | 'local-only';
  liveEventId: string | null;
  timeBucket: string | null;
  responseStatus: number | null;
  responseBody: unknown;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function createTimeBucket(timestamp: string): string {
  const date = new Date(timestamp);

  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    '00'
  ].join('');
}

export function getFlowcoreConfig(env: NodeJS.ProcessEnv = process.env): FlowcoreConfig {
  return {
    apiKey: env.FLOWCORE_API_KEY ?? null,
    ingestionBaseUrl: env.FLOWCORE_INGESTION_BASE_URL ?? 'https://webhook.api.flowcore.io',
    tenant: env.FLOWCORE_TENANT ?? 'allora2026',
    dataCoreId: env.FLOWCORE_DATA_CORE_ID ?? null,
    dataCoreName: env.FLOWCORE_DATA_CORE_NAME ?? 'supply-chain-exception-ledger',
    flowType: env.FLOWCORE_FLOW_TYPE ?? 'supply-chain-exception-ledger.0',
    eventType: env.FLOWCORE_EVENT_TYPE ?? 'commercial-invoice-exception.0',
    pathwayName: env.FLOWCORE_PATHWAY_NAME ?? 'supply-chain-exception-ledger',
    runtimeStoreFile: env.RUNTIME_STORE_FILE ?? DEFAULT_RUNTIME_STORE_FILE
  };
}

export function getRuntimeStorePath({ root = process.cwd(), env = process.env }: { root?: string; env?: NodeJS.ProcessEnv } = {}): string {
  const runtimeStoreFile = getFlowcoreConfig(env).runtimeStoreFile;
  return isAbsolute(runtimeStoreFile) ? runtimeStoreFile : join(root, runtimeStoreFile);
}

export function hasLiveFlowcoreAccess(config: FlowcoreConfig = getFlowcoreConfig()): boolean {
  return Boolean(config.apiKey && config.tenant && config.dataCoreId && config.flowType && config.eventType);
}

export function getFlowcoreRoute(config: FlowcoreConfig = getFlowcoreConfig()): string {
  return `flowcore://${config.dataCoreName}/${config.flowType}/${config.eventType}`;
}

export function getFlowcoreIngestionEndpoint(config: FlowcoreConfig = getFlowcoreConfig()): string | null {
  if (!config.dataCoreId) {
    return null;
  }

  return `${config.ingestionBaseUrl}/event/${config.tenant}/${config.dataCoreId}/${config.flowType}/${config.eventType}`;
}

export function getFlowcoreIngestionMode(config: FlowcoreConfig = getFlowcoreConfig()): 'live' | 'local-only' {
  return hasLiveFlowcoreAccess(config) ? 'live' : 'local-only';
}

export function createLedgerSourceEventId(event: FlowcoreEvent): string {
  return event.provenance.event_id;
}

export function createLedgerEntityKey(event: FlowcoreEvent): string {
  const { shipment_id, document_type, order_reference } = event.canonical_key;
  return `${shipment_id}::${document_type}::${order_reference}`;
}

export function createFlowcoreContext({
  event,
  receivedAt,
  config = getFlowcoreConfig()
}: {
  event: FlowcoreEvent;
  receivedAt: string;
  config?: FlowcoreConfig;
}): FlowcoreContext {
  return {
    tenant: config.tenant,
    dataCoreId: config.dataCoreId,
    flowType: config.flowType,
    eventType: config.eventType,
    timeBucket: createTimeBucket(receivedAt),
    pathwayName: config.pathwayName,
    route: getFlowcoreRoute(config),
    ingestionEndpoint: getFlowcoreIngestionEndpoint(config),
    ingestionMode: getFlowcoreIngestionMode(config),
    sourceEventId: createLedgerSourceEventId(event),
    entityKey: createLedgerEntityKey(event)
  };
}

export async function ingestFlowcoreEvent({
  payload,
  fetchImpl = globalThis.fetch,
  config = getFlowcoreConfig()
}: {
  payload: FlowcoreEvent;
  fetchImpl?: typeof fetch;
  config?: FlowcoreConfig;
}): Promise<FlowcoreIngestionResult> {
  const ingestionEndpoint = getFlowcoreIngestionEndpoint(config);

  if (!hasLiveFlowcoreAccess(config) || !ingestionEndpoint) {
    return {
      ingestionMode: 'local-only',
      liveEventId: null,
      responseStatus: null,
      responseBody: null,
      timeBucket: null
    };
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Live Flowcore ingestion requires fetch support');
  }

  const response = await fetchImpl(ingestionEndpoint, {
    method: 'POST',
    headers: {
      authorization: config.apiKey!,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const rawBody = await response.text();
  let parsedBody: unknown = null;

  if (rawBody) {
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = { rawBody };
    }
  }

  if (!response.ok) {
    const body = parsedBody as { error?: string; message?: string } | null;
    const message = body?.error ?? body?.message ?? `Flowcore ingestion failed with status ${response.status}`;
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = 502;
    throw error;
  }

  const body = parsedBody as {
    eventId?: string;
    id?: string;
    timeBucket?: string;
    event?: { eventId?: string; id?: string };
  } | null;
  const liveEventId = body?.eventId ?? body?.id ?? body?.event?.eventId ?? body?.event?.id ?? null;

  if (!liveEventId) {
    const error = new Error('Flowcore ingestion response did not include an event id') as Error & { statusCode?: number };
    error.statusCode = 502;
    throw error;
  }

  return {
    ingestionMode: 'live',
    liveEventId,
    timeBucket: body?.timeBucket ?? null,
    responseStatus: response.status,
    responseBody: parsedBody
  };
}
