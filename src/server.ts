import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildOperatorSurfaceModel, renderOperatorSurface } from './rendering/exceptionOperatorView.js';
import { projectExceptionCase, type FlowcoreEvent } from './projection/exceptionProjector.js';
import {
  buildOpenScenarioEvents,
  buildResolvedScenarioEvents,
  buildUpdatedScenarioEvents
} from './demoScenarios.js';
import {
  getRuntimeCaseById,
  getRuntimeStatus,
  listRuntimeCases,
  listRuntimeEvents,
  refreshCaseUsableContext,
  triggerLedgerEvent,
  type RuntimeOptions
} from './runtime/ledgerRuntime.js';

export type DemoScenario = 'open' | 'updated' | 'resolved';

interface ScenarioPayload {
  scenario: DemoScenario;
  case: ReturnType<typeof projectExceptionCase>;
  rendered: string;
}

export interface ServerOptions extends RuntimeOptions {
  fetchImpl?: typeof fetch;
}

function buildScenarioPayload(scenario: DemoScenario): ScenarioPayload {
  const events = scenario === 'open'
    ? buildOpenScenarioEvents()
    : scenario === 'updated'
      ? buildUpdatedScenarioEvents()
      : buildResolvedScenarioEvents();

  const projectedCase = projectExceptionCase(events);
  if (!projectedCase) {
    throw new Error(`Scenario ${scenario} did not project a case`);
  }

  const model = buildOperatorSurfaceModel([projectedCase]);
  return {
    scenario,
    case: projectedCase,
    rendered: renderOperatorSurface(model)
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    throw new Error('Request body is required');
  }

  return JSON.parse(rawBody) as T;
}

function renderHomePage(options: ServerOptions): string {
  const status = getRuntimeStatus(options);
  const sampleEvent = buildOpenScenarioEvents()[0];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Supply-chain Exception Ledger</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 1080px; line-height: 1.5; color: #111827; padding: 0 1rem; }
      .banner { padding: 1rem; border-radius: 12px; margin-bottom: 1rem; }
      .banner.local { background: #fff7ed; border: 1px solid #fdba74; }
      .banner.live { background: #ecfdf5; border: 1px solid #34d399; }
      .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
      .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; }
      button { border: 0; border-radius: 999px; padding: 0.75rem 1rem; cursor: pointer; background: #111827; color: white; }
      textarea, pre { width: 100%; box-sizing: border-box; }
      textarea, pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 12px; overflow: auto; min-height: 220px; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
      ul { padding-left: 1.25rem; }
    </style>
  </head>
  <body>
    <h1>Supply-chain Exception Ledger</h1>
    <div class="banner ${status.flowcore.ingestionMode === 'live' || status.usable.accessMode === 'live' ? 'live' : 'local'}">
      <strong>Runtime mode</strong><br />
      Flowcore: <code>${status.flowcore.ingestionMode}</code> · Usable: <code>${status.usable.accessMode}</code><br />
      ${status.flowcore.ingestionMode === 'live'
        ? 'New trigger events will be forwarded to Flowcore using the configured tenant, data core, flow type, and event type.'
        : 'No Flowcore credentials detected, so trigger events stay local-only in the runtime store.'}
      <br />
      ${status.usable.accessMode === 'live'
        ? 'Projected cases will create or update real Usable memory fragments.'
        : 'No Usable credentials detected, so case memory stays local-only until USABLE_ACCESS_TOKEN + workspace/fragment type are configured.'}
    </div>
    <div class="grid">
      <div class="card">
        <h2>Trigger a real event</h2>
        <p>POST a Flowcore-shaped event to <code>/api/events/trigger</code>. The same route powers the form below.</p>
        <textarea id="event-json">${JSON.stringify(sampleEvent, null, 2)}</textarea>
        <p><button id="trigger">Trigger event</button></p>
      </div>
      <div class="card">
        <h2>Runtime endpoints</h2>
        <ul>
          <li><code>GET /health</code></li>
          <li><code>GET /api/runtime/status</code></li>
          <li><code>GET /api/events</code></li>
          <li><code>GET /api/cases</code></li>
          <li><code>GET /api/cases/:caseId</code></li>
          <li><code>POST /api/cases/:caseId/refresh-usable</code></li>
          <li><code>GET /api/demo/open</code>, <code>/updated</code>, <code>/resolved</code></li>
        </ul>
        <p>Persisted counts: <code>${status.counts.events}</code> events / <code>${status.counts.cases}</code> cases.</p>
      </div>
    </div>
    <h2>Output</h2>
    <pre id="output">Select Trigger event to send the JSON payload through the runtime.</pre>
    <script>
      const output = document.getElementById('output');
      const textarea = document.getElementById('event-json');
      document.getElementById('trigger').addEventListener('click', async () => {
        output.textContent = 'Triggering event...';
        try {
          const response = await fetch('/api/events/trigger', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: textarea.value
          });
          const payload = await response.json();
          output.textContent = JSON.stringify(payload, null, 2);
        } catch (error) {
          output.textContent = 'Trigger failed: ' + error.message;
        }
      });
    </script>
  </body>
</html>`;
}

function matchCasePath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/cases\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function matchCaseRefreshPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/cases\/([^/]+)\/refresh-usable$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeTriggerBody(body: unknown): FlowcoreEvent {
  if (body && typeof body === 'object' && 'event' in body) {
    return (body as { event: FlowcoreEvent }).event;
  }

  return body as FlowcoreEvent;
}

function createRequestHandler(options: ServerOptions) {
  return async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        const status = getRuntimeStatus(options);
        sendJson(response, 200, {
          ok: true,
          application: 'ledger.allora.usable.dev',
          flowcoreMode: status.flowcore.ingestionMode,
          usableMode: status.usable.accessMode
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/') {
        sendHtml(response, 200, renderHomePage(options));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/runtime/status') {
        sendJson(response, 200, getRuntimeStatus(options));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/events') {
        sendJson(response, 200, listRuntimeEvents(options));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/cases') {
        sendJson(response, 200, listRuntimeCases(options));
        return;
      }

      if (request.method === 'GET' && url.pathname.startsWith('/api/demo/')) {
        const scenario = url.pathname.replace('/api/demo/', '') as DemoScenario;
        if (!['open', 'updated', 'resolved'].includes(scenario)) {
          sendJson(response, 404, { error: 'Unknown demo scenario' });
          return;
        }

        sendJson(response, 200, buildScenarioPayload(scenario));
        return;
      }

      if (request.method === 'GET') {
        const caseId = matchCasePath(url.pathname);
        if (caseId) {
          const caseRecord = getRuntimeCaseById(caseId, options);
          if (!caseRecord) {
            sendJson(response, 404, { error: 'Case not found' });
            return;
          }

          sendJson(response, 200, caseRecord);
          return;
        }
      }

      if (request.method === 'POST' && (url.pathname === '/api/events/trigger' || url.pathname === '/api/events/trigger/flowcore')) {
        const body = await readJsonBody<FlowcoreEvent | { event: FlowcoreEvent }>(request);
        const caseRecord = await triggerLedgerEvent({
          event: normalizeTriggerBody(body),
          fetchImpl: options.fetchImpl,
          env: options.env,
          root: options.root
        });
        sendJson(response, 201, caseRecord);
        return;
      }

      if (request.method === 'POST') {
        const caseId = matchCaseRefreshPath(url.pathname);
        if (caseId) {
          const caseRecord = await refreshCaseUsableContext({
            caseId,
            fetchImpl: options.fetchImpl,
            env: options.env,
            root: options.root
          });
          if (!caseRecord) {
            sendJson(response, 404, { error: 'Case not found' });
            return;
          }

          sendJson(response, 200, caseRecord);
          return;
        }
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : error instanceof SyntaxError
          ? 400
          : 422;
      sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

export function createServer(options: ServerOptions = {}) {
  return createNodeServer(createRequestHandler(options));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? '3000');
  const host = process.env.HOST ?? process.env.HOSTNAME ?? '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Supply-chain Exception Ledger listening on http://${host}:${port}`);
  });
}
