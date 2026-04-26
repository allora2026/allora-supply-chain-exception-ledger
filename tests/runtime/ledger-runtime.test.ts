import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { buildOpenScenarioEvents, buildUpdatedScenarioEvents } from '../../src/demoScenarios';
import {
  getRuntimeStatus,
  listRuntimeCases,
  listRuntimeEvents,
  refreshCaseUsableContext,
  triggerLedgerEvent
} from '../../src/runtime/ledgerRuntime';

const tempDirs: string[] = [];

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-runtime-'));
  tempDirs.push(dir);
  return {
    ...overrides,
    RUNTIME_STORE_FILE: join(dir, 'runtime-store.json')
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('ledger runtime integration', () => {
  it('persists a local-only case when credentials are missing', async () => {
    const env = createEnv();
    const [event] = buildOpenScenarioEvents();

    const caseRecord = await triggerLedgerEvent({ event, env });

    expect(caseRecord.caseId).toBe('SHIP-123::commercial_invoice::ORDER-456');
    expect(caseRecord.projectedCase.resolution_status).toBe('open');
    expect(caseRecord.integrations.flowcore.ingestionMode).toBe('local-only');
    expect(caseRecord.integrations.usable.accessMode).toBe('local-only');
    expect(caseRecord.integrations.usable.fragmentId).toBeNull();

    const events = listRuntimeEvents({ env });
    expect(events).toHaveLength(1);
    expect(events[0].flowcore.ingestionMode).toBe('local-only');

    const persistedCases = listRuntimeCases({ env });
    expect(persistedCases).toHaveLength(1);
    expect(persistedCases[0].rendered).toContain('Exception List');

    const status = getRuntimeStatus({ env });
    expect(status.flowcore.ingestionMode).toBe('local-only');
    expect(status.usable.accessMode).toBe('local-only');
    expect(status.counts).toEqual({ events: 1, cases: 1 });
  });

  it('forwards to live Flowcore and Usable when credentials are configured', async () => {
    const env = createEnv({
      FLOWCORE_API_KEY: 'flowcore-key',
      FLOWCORE_DATA_CORE_ID: 'core-123',
      USABLE_ACCESS_TOKEN: 'usable-token',
      USABLE_WORKSPACE_ID: 'workspace-123',
      USABLE_FRAGMENT_TYPE_ID: 'fragment-type-123'
    });
    const fetchCalls: Array<{ url: string; method: string; body: string | null }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchCalls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null
      });

      if (url.startsWith('https://webhook.api.flowcore.io/event/')) {
        return new Response(JSON.stringify({ eventId: 'live-flowcore-evt-1', timeBucket: '20260425160000' }), {
          status: 202,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url === 'https://usable.dev/api/memory-fragments') {
        return new Response(JSON.stringify({ fragmentId: 'frag-123' }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        });
      }

      if (url === 'https://usable.dev/api/memory-fragments/frag-123') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    };

    const openCase = await triggerLedgerEvent({ event: buildOpenScenarioEvents()[0], env, fetchImpl });

    expect(openCase.integrations.flowcore.ingestionMode).toBe('live');
    expect(openCase.integrations.flowcore.liveEventIds).toEqual(['live-flowcore-evt-1']);
    expect(openCase.integrations.usable.accessMode).toBe('live');
    expect(openCase.integrations.usable.fragmentId).toBe('frag-123');
    expect(openCase.integrations.usable.url).toContain('/dashboard/workspaces/workspace-123/fragments/frag-123');

    const updatedCase = await triggerLedgerEvent({ event: buildUpdatedScenarioEvents()[1], env, fetchImpl });
    expect(updatedCase.projectedCase.resolution_status).toBe('waiting_for_artifact');
    expect(updatedCase.integrations.usable.fragmentId).toBe('frag-123');

    const refreshedCase = await refreshCaseUsableContext({ caseId: updatedCase.caseId, env, fetchImpl });
    expect(refreshedCase?.integrations.usable.accessMode).toBe('live');
    expect(refreshedCase?.integrations.usable.fragmentId).toBe('frag-123');

    expect(fetchCalls.map((item) => `${item.method} ${item.url}`)).toEqual([
      'POST https://webhook.api.flowcore.io/event/allora2026/core-123/supply-chain-exception-ledger.0/commercial-invoice-exception.0',
      'POST https://usable.dev/api/memory-fragments',
      'POST https://webhook.api.flowcore.io/event/allora2026/core-123/supply-chain-exception-ledger.0/commercial-invoice-exception.0',
      'PATCH https://usable.dev/api/memory-fragments/frag-123',
      'PATCH https://usable.dev/api/memory-fragments/frag-123'
    ]);

    const usableCreateBody = JSON.parse(fetchCalls[1].body ?? '{}') as { workspaceId?: string; fragmentTypeId?: string; tags?: string[] };
    expect(usableCreateBody.workspaceId).toBe('workspace-123');
    expect(usableCreateBody.fragmentTypeId).toBe('fragment-type-123');
    expect(usableCreateBody.tags).toContain('flowcore-mode:live');

    const runtimeStore = readFileSync(env.RUNTIME_STORE_FILE!, 'utf8');
    expect(runtimeStore).toContain('live-flowcore-evt-1');
    expect(runtimeStore).toContain('frag-123');
  });
});
