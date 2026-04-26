import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server';

const servers: Array<ReturnType<typeof createServer>> = [];

async function startTestServer() {
  const server = createServer();
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
});

describe('runtime ledger demo server', () => {
  it('serves a health endpoint for deployment probes', async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      application: 'ledger.allora.usable.dev'
    });
  });

  it('serves an honest demo homepage instead of pretending live Flowcore ingestion exists', async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(baseUrl);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Supply-chain Exception Ledger');
    expect(html).toContain('Deterministic demo scenarios');
    expect(html).toContain('Not live Flowcore or Usable production data');
    expect(html).toContain('/api/demo/open');
    expect(html).toContain('/api/demo/updated');
    expect(html).toContain('/api/demo/resolved');
  });

  it('projects the open scenario through the HTTP API', async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/api/demo/open`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scenario).toBe('open');
    expect(payload.case.resolution_status).toBe('open');
    expect(payload.case.shipment.shipment_id).toBe('SHIP-123');
    expect(payload.rendered).toContain('Exception List');
  });

  it('projects the resolved scenario with reusable case memory through the HTTP API', async () => {
    const { baseUrl } = await startTestServer();

    const response = await fetch(`${baseUrl}/api/demo/resolved`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.scenario).toBe('resolved');
    expect(payload.case.resolution_status).toBe('resolved');
    expect(payload.case.usable_case_memory.resolution_snapshot.summary).toContain('resolved');
    expect(payload.case.usable_case_memory.similar_cases).toHaveLength(1);
    expect(payload.rendered).toContain('Similar Historical Exceptions');
  });
});
