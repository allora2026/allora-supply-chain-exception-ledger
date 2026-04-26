# Supply-chain Exception Ledger

An honest runnable demo for the Supply-chain Exception Ledger v0 operator flow.

## What this is

This repo now contains a real Node runtime that lets you inspect the exception-case projection and operator-surface behavior through deterministic demo scenarios.

Current surface:
- `GET /health`
- `GET /`
- `GET /api/demo/open`
- `GET /api/demo/updated`
- `GET /api/demo/resolved`

The homepage is intentionally blunt:
- this is a deterministic demo
- it is **not** live Flowcore ingestion
- it is **not** live Usable production memory

That is deliberate. Better an honest runnable surface than fake completion.

## What works now

- health endpoint for deployment probes
- HTTP demo server built from the existing projector and operator-surface modules
- scenario-driven case rendering for open / updated / resolved flows
- Dockerfile + GHCR publish workflow
- deployment contract files for `ledger.allora.usable.dev`
- test suite covering runtime, contracts, and packaging

## What is still missing

- real Flowcore event ingestion
- real Usable-backed persistence
- real image publication
- real manifests in `flowcore-io/allora-manifests`
- a verified live deployment at `ledger.allora.usable.dev`

## Local run

```bash
pnpm install
pnpm start
```

Then open:
- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/api/demo/open`
- `http://127.0.0.1:3000/api/demo/updated`
- `http://127.0.0.1:3000/api/demo/resolved`

## Quality checks

```bash
pnpm check
pnpm test
pnpm build
```

## Deployment goal

The intended public host is:
- `https://ledger.allora.usable.dev`

But do not claim that host is live until the image is published, the manifests repo is updated, and the deployed host passes real HTTP checks.
