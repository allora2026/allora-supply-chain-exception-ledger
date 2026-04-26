import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../src/server';
import { buildOpenScenarioEvents } from '../../src/demoScenarios';

const servers: Array<ReturnType<typeof createServer>> = [];
const tempDirs: string[] = [];

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-server-'));
  tempDirs.push(dir);
  return {
    ...overrides,
    RUNTIME_STORE_FILE: join(dir, 'runtime-store.json')
  };
}

async function startTestServer(options: Parameters<typeof createServer>[0] = {}) {
  const server = createServer(options);
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );

  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('runtime ledger server', () => {
  it('serves health and runtime status endpoints with honest mode reporting', async () => {
    const { baseUrl } = await startTestServer({ env: createEnv() });

    const healthResponse = await fetch(`${baseUrl}/health`);
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toEqual({
      ok: true,
      application: 'ledger.allora.usable.dev',
      flowcoreMode: 'local-only',
      usableMode: 'local-only'
    });

    const statusResponse = await fetch(`${baseUrl}/api/runtime/status`);
    const status = await statusResponse.json();
    expect(statusResponse.status).toBe(200);
    expect(status.flowcore.ingestionMode).toBe('local-only');
    expect(status.usable.accessMode).toBe('local-only');
    expect(status.counts).toEqual({ events: 0, cases: 0 });
  });

  it('serves a triggerable homepage instead of demo-only copy', async () => {
    const { baseUrl } = await startTestServer({ env: createEnv() });

    const response = await fetch(baseUrl);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Supply-chain Exception Ledger');
    expect(html).toContain('Runtime mode');
    expect(html).toContain('Trigger a real event');
    expect(html).toContain('/api/events/trigger');
    expect(html).toContain('local-only');
  });

  it('accepts a POST trigger, persists a case, and returns it over the HTTP API', async () => {
    const env = createEnv();
    const { baseUrl } = await startTestServer({ env });

    const triggerResponse = await fetch(`${baseUrl}/api/events/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildOpenScenarioEvents()[0])
    });
    const triggeredCase = await triggerResponse.json();

    expect(triggerResponse.status).toBe(201);
    expect(triggeredCase.caseId).toBe('SHIP-123::commercial_invoice::ORDER-456');
    expect(triggeredCase.projectedCase.resolution_status).toBe('open');
    expect(triggeredCase.integrations.flowcore.ingestionMode).toBe('local-only');

    const casesResponse = await fetch(`${baseUrl}/api/cases`);
    const cases = await casesResponse.json();
    expect(casesResponse.status).toBe(200);
    expect(cases).toHaveLength(1);

    const caseResponse = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(triggeredCase.caseId)}`);
    const caseRecord = await caseResponse.json();
    expect(caseResponse.status).toBe(200);
    expect(caseRecord.rendered).toContain('Exception List');

    const eventsResponse = await fetch(`${baseUrl}/api/events`);
    const events = await eventsResponse.json();
    expect(eventsResponse.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].sourceEventId).toBe('evt-open');
  });

  it('still serves the resolved demo scenario for inspection', async () => {
    const { baseUrl } = await startTestServer({ env: createEnv() });

    const response = await fetch(`${baseUrl}/api/demo/resolved`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scenario).toBe('resolved');
    expect(payload.case.resolution_status).toBe('resolved');
    expect(payload.case.usable_case_memory.resolution_snapshot.summary).toContain('resolved');
    expect(payload.rendered).toContain('Similar Historical Exceptions');
  });
});
