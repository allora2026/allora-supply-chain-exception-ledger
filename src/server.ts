import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buildOperatorSurfaceModel, renderOperatorSurface } from './rendering/exceptionOperatorView.js';
import { projectExceptionCase } from './projection/exceptionProjector.js';
import {
  buildOpenScenarioEvents,
  buildResolvedScenarioEvents,
  buildUpdatedScenarioEvents
} from './demoScenarios.js';

export type DemoScenario = 'open' | 'updated' | 'resolved';

interface ScenarioPayload {
  scenario: DemoScenario;
  case: ReturnType<typeof projectExceptionCase>;
  rendered: string;
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

function renderHomePage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Supply-chain Exception Ledger</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 960px; line-height: 1.5; color: #111827; padding: 0 1rem; }
      .banner { background: #fff7ed; border: 1px solid #fdba74; padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; }
      .buttons { display: flex; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0; }
      button { border: 0; border-radius: 999px; padding: 0.75rem 1rem; cursor: pointer; background: #111827; color: white; }
      pre { background: #0f172a; color: #e2e8f0; padding: 1rem; border-radius: 12px; overflow: auto; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; }
    </style>
  </head>
  <body>
    <h1>Supply-chain Exception Ledger</h1>
    <div class="banner">
      <strong>Deterministic demo scenarios</strong><br />
      Not live Flowcore or Usable production data. This surface is an honest runnable demo around the projection + operator-memory model so Julius can inspect the product behavior without pretending the full integration already exists.
    </div>
    <p>Use one of the scenario endpoints below to inspect the operator surface transitions:</p>
    <ul>
      <li><code>/api/demo/open</code></li>
      <li><code>/api/demo/updated</code></li>
      <li><code>/api/demo/resolved</code></li>
    </ul>
    <div class="buttons">
      <button data-scenario="open">Open scenario</button>
      <button data-scenario="updated">Updated scenario</button>
      <button data-scenario="resolved">Resolved scenario</button>
    </div>
    <pre id="output">Select a scenario to load the rendered operator surface.</pre>
    <script>
      const output = document.getElementById('output');
      async function loadScenario(scenario) {
        output.textContent = 'Loading ' + scenario + ' scenario...';
        const response = await fetch('/api/demo/' + scenario);
        const payload = await response.json();
        output.textContent = payload.rendered;
      }
      document.querySelectorAll('button[data-scenario]').forEach((button) => {
        button.addEventListener('click', () => loadScenario(button.dataset.scenario));
      });
    </script>
  </body>
</html>`;
}

function routeRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/health') {
    sendJson(response, 200, { ok: true, application: 'ledger.allora.usable.dev' });
    return;
  }

  if (url.pathname === '/') {
    sendHtml(response, 200, renderHomePage());
    return;
  }

  if (url.pathname.startsWith('/api/demo/')) {
    const scenario = url.pathname.replace('/api/demo/', '') as DemoScenario;
    if (!['open', 'updated', 'resolved'].includes(scenario)) {
      sendJson(response, 404, { error: 'Unknown demo scenario' });
      return;
    }

    sendJson(response, 200, buildScenarioPayload(scenario));
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

export function createServer() {
  return createNodeServer(routeRequest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? '3000');
  const host = process.env.HOST ?? process.env.HOSTNAME ?? '127.0.0.1';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`Supply-chain Exception Ledger demo listening on http://${host}:${port}`);
  });
}
