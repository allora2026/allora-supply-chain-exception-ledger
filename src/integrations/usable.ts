import type { ExceptionCase } from '../projection/exceptionProjector.js';

const DEFAULT_USABLE_API_BASE_URL = 'https://usable.dev/api';
const DEFAULT_USABLE_APP_BASE_URL = 'https://usable.dev';

export interface UsableConfig {
  accessToken: string | null;
  apiBaseUrl: string;
  appBaseUrl: string;
  workspaceId: string | null;
  fragmentTypeId: string | null;
}

export interface UsableFragmentSyncResult {
  accessMode: 'live' | 'local-only';
  fragmentId: string | null;
  workspaceId: string | null;
  url: string | null;
  title: string | null;
  content: string | null;
  lastSyncedAt: string | null;
}

function createHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  };
}

export function getUsableConfig(env: NodeJS.ProcessEnv = process.env): UsableConfig {
  return {
    accessToken: env.USABLE_ACCESS_TOKEN ?? null,
    apiBaseUrl: env.USABLE_API_BASE_URL ?? DEFAULT_USABLE_API_BASE_URL,
    appBaseUrl: env.USABLE_APP_BASE_URL ?? DEFAULT_USABLE_APP_BASE_URL,
    workspaceId: env.USABLE_WORKSPACE_ID ?? null,
    fragmentTypeId: env.USABLE_FRAGMENT_TYPE_ID ?? null
  };
}

export function hasUsableAccess(config: UsableConfig = getUsableConfig()): boolean {
  return Boolean(config.accessToken && config.workspaceId && config.fragmentTypeId);
}

export function buildUsableFragmentUrl(fragmentId: string, config: UsableConfig = getUsableConfig()): string {
  return `${config.appBaseUrl}/dashboard/workspaces/${config.workspaceId}/fragments/${fragmentId}`;
}

function summarizeEvidence(exceptionCase: ExceptionCase): string[] {
  return exceptionCase.evidence.map((item) => `${item.source_family} -> ${item.artifact_ref}`);
}

export function buildUsableFragmentTitle(caseRecord: {
  caseId: string;
  projectedCase: ExceptionCase;
}): string {
  return `Supply-chain exception case — ${caseRecord.caseId}`;
}

export function buildUsableFragmentTags(caseRecord: {
  caseId: string;
  projectedCase: ExceptionCase;
  integrations: { flowcore: { ingestionMode: 'live' | 'local-only' } };
}): string[] {
  return [
    'supply-chain-exception-ledger',
    'flowcore',
    'usable',
    `case:${caseRecord.caseId}`,
    `classification:${caseRecord.projectedCase.classification}`,
    `resolution:${caseRecord.projectedCase.resolution_status}`,
    `counterpart:${caseRecord.projectedCase.blocking_counterpart}`,
    `flowcore-mode:${caseRecord.integrations.flowcore.ingestionMode}`
  ];
}

export function buildUsableFragmentContent(caseRecord: {
  caseId: string;
  projectedCase: ExceptionCase;
  rendered: string;
  integrations: {
    flowcore: { ingestionMode: 'live' | 'local-only'; liveEventIds: string[] };
    usable: { accessMode: 'live' | 'local-only' };
  };
  sourceEventIds: string[];
}): string {
  const { projectedCase } = caseRecord;

  return [
    '# Supply-chain exception ledger case',
    '',
    `Case ID: ${caseRecord.caseId}`,
    `Flowcore mode: ${caseRecord.integrations.flowcore.ingestionMode}`,
    `Usable sync mode: ${caseRecord.integrations.usable.accessMode}`,
    `Source event IDs: ${caseRecord.sourceEventIds.join(', ')}`,
    `Live Flowcore event IDs: ${caseRecord.integrations.flowcore.liveEventIds.join(', ') || 'none'}`,
    `Shipment: ${projectedCase.shipment.shipment_id}`,
    `Order: ${projectedCase.canonical_key.order_reference}`,
    `Invoice: ${projectedCase.shipment.invoice_reference}`,
    `Resolution status: ${projectedCase.resolution_status}`,
    `Release status: ${projectedCase.shipment.release_status}`,
    `Blocking counterpart: ${projectedCase.blocking_counterpart}`,
    '',
    '## Operator hypothesis',
    projectedCase.operator_hypothesis,
    '',
    '## Open questions',
    ...(projectedCase.open_questions.length > 0 ? projectedCase.open_questions.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Handoff notes',
    ...projectedCase.usable_case_memory.handoff_notes.map((item) => `- ${item}`),
    '',
    '## Evidence',
    ...summarizeEvidence(projectedCase).map((item) => `- ${item}`),
    '',
    '## Rendered operator surface',
    '```text',
    caseRecord.rendered,
    '```'
  ].join('\n');
}

async function requestUsable(
  pathname: string,
  {
    method,
    body,
    fetchImpl = globalThis.fetch,
    config
  }: {
    method: 'POST' | 'PATCH';
    body: Record<string, unknown>;
    fetchImpl?: typeof fetch;
    config: UsableConfig;
  }
): Promise<unknown> {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Usable API calls require fetch support');
  }

  const response = await fetchImpl(`${config.apiBaseUrl}${pathname}`, {
    method,
    headers: createHeaders(config.accessToken!),
    body: JSON.stringify(body)
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
    const bodyObject = parsedBody as { error?: string; message?: string } | null;
    const message = bodyObject?.error ?? bodyObject?.message ?? `Usable request failed with status ${response.status}`;
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = 502;
    throw error;
  }

  return parsedBody;
}

function createPersistedContext({
  fragmentId,
  title,
  content,
  syncedAt,
  config
}: {
  fragmentId: string;
  title: string;
  content: string;
  syncedAt: string;
  config: UsableConfig;
}): UsableFragmentSyncResult {
  return {
    accessMode: 'live',
    fragmentId,
    workspaceId: config.workspaceId,
    url: buildUsableFragmentUrl(fragmentId, config),
    title,
    content,
    lastSyncedAt: syncedAt
  };
}

export async function createUsableFragmentForCase({
  caseRecord,
  fetchImpl,
  config = getUsableConfig()
}: {
  caseRecord: {
    caseId: string;
    projectedCase: ExceptionCase;
    rendered: string;
    sourceEventIds: string[];
    integrations: {
      flowcore: { ingestionMode: 'live' | 'local-only'; liveEventIds: string[] };
      usable: { accessMode: 'live' | 'local-only' };
    };
  };
  fetchImpl?: typeof fetch;
  config?: UsableConfig;
}): Promise<UsableFragmentSyncResult> {
  const syncedAt = new Date().toISOString();
  const title = buildUsableFragmentTitle(caseRecord);
  const content = buildUsableFragmentContent(caseRecord);
  const payload = {
    title,
    content,
    workspaceId: config.workspaceId,
    fragmentTypeId: config.fragmentTypeId,
    tags: buildUsableFragmentTags(caseRecord)
  };
  const response = await requestUsable('/memory-fragments', {
    method: 'POST',
    body: payload,
    fetchImpl,
    config
  });
  const body = response as { fragmentId?: string; id?: string; fragment?: { fragmentId?: string; id?: string }; title?: string } | null;
  const fragmentId = body?.fragmentId ?? body?.id ?? body?.fragment?.fragmentId ?? body?.fragment?.id ?? null;

  if (!fragmentId) {
    const error = new Error('Usable create fragment response did not include a fragment id') as Error & { statusCode?: number };
    error.statusCode = 502;
    throw error;
  }

  return createPersistedContext({
    fragmentId,
    title: body?.title ?? title,
    content,
    syncedAt,
    config
  });
}

export async function updateUsableFragmentForCase({
  caseRecord,
  fragmentId,
  fetchImpl,
  config = getUsableConfig()
}: {
  caseRecord: {
    caseId: string;
    projectedCase: ExceptionCase;
    rendered: string;
    sourceEventIds: string[];
    integrations: {
      flowcore: { ingestionMode: 'live' | 'local-only'; liveEventIds: string[] };
      usable: { accessMode: 'live' | 'local-only' };
    };
  };
  fragmentId: string;
  fetchImpl?: typeof fetch;
  config?: UsableConfig;
}): Promise<UsableFragmentSyncResult> {
  const syncedAt = new Date().toISOString();
  const title = buildUsableFragmentTitle(caseRecord);
  const content = buildUsableFragmentContent(caseRecord);

  await requestUsable(`/memory-fragments/${fragmentId}`, {
    method: 'PATCH',
    body: {
      content,
      tags: buildUsableFragmentTags(caseRecord)
    },
    fetchImpl,
    config
  });

  return createPersistedContext({
    fragmentId,
    title,
    content,
    syncedAt,
    config
  });
}
