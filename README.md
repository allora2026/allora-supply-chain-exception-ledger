# Supply-chain Exception Ledger

Supply-chain Exception Ledger is now a runnable HTTP app with a real trigger path, honest local-only fallback, and optional live Flowcore + Usable integration.

## What this is now

This repo is no longer limited to deterministic read-only demo routes.

It now supports:
- `POST /api/events/trigger` to ingest a real Flowcore-shaped exception event
- persisted local runtime state for events and projected cases
- live Flowcore ingestion when `FLOWCORE_API_KEY` and `FLOWCORE_DATA_CORE_ID` are configured
- live Usable fragment create/update when `USABLE_ACCESS_TOKEN`, `USABLE_WORKSPACE_ID`, and `USABLE_FRAGMENT_TYPE_ID` are configured
- honest `local-only` behavior when those credentials are absent
- explicit persisted mode reporting on every case and in runtime status responses
- the existing demo scenario routes for inspection and regression coverage

## Runtime endpoints

- `GET /health`
- `GET /`
- `GET /api/runtime/status`
- `GET /api/events`
- `GET /api/cases`
- `GET /api/cases/:caseId`
- `POST /api/events/trigger`
- `POST /api/cases/:caseId/refresh-usable`
- `GET /api/demo/open`
- `GET /api/demo/updated`
- `GET /api/demo/resolved`

## Honest mode split

### Local-only mode

If Flowcore and/or Usable credentials are missing:
- trigger requests still work
- events and cases are persisted in the local runtime store
- responses clearly report `local-only`
- no external completion is implied

### Live mode

If credentials are present:
- the trigger route forwards the incoming event to Flowcore at `https://webhook.api.flowcore.io`
- the projected case creates or updates a real Usable fragment through `https://usable.dev/api`
- persisted case state includes the returned live Flowcore event ids and Usable fragment metadata

## Environment variables

### Flowcore

- `FLOWCORE_API_KEY`
- `FLOWCORE_TENANT` (defaults to `allora2026`)
- `FLOWCORE_DATA_CORE_ID`
- `FLOWCORE_DATA_CORE_NAME` (defaults to `supply-chain-exception-ledger`)
- `FLOWCORE_FLOW_TYPE` (defaults to `supply-chain-exception-ledger.0`)
- `FLOWCORE_EVENT_TYPE` (defaults to `commercial-invoice-exception.0`)
- `FLOWCORE_PATHWAY_NAME` (defaults to `supply-chain-exception-ledger`)
- `FLOWCORE_INGESTION_BASE_URL` (defaults to `https://webhook.api.flowcore.io`)

### Usable

- `USABLE_ACCESS_TOKEN`
- `USABLE_WORKSPACE_ID`
- `USABLE_FRAGMENT_TYPE_ID`
- `USABLE_API_BASE_URL` (defaults to `https://usable.dev/api`)
- `USABLE_APP_BASE_URL` (defaults to `https://usable.dev`)

### Runtime store

- `RUNTIME_STORE_FILE` (defaults to `data/runtime-store.json`)

## Example trigger

```bash
curl -X POST http://127.0.0.1:3000/api/events/trigger \
  -H 'content-type: application/json' \
  -d '{
    "event_family": "expected_document_missing",
    "canonical_key": {
      "shipment_id": "SHIP-123",
      "document_type": "commercial_invoice",
      "order_reference": "ORDER-456"
    },
    "source_family": "erp_order_invoice",
    "occurred_at": "2026-04-25T16:00:00.000Z",
    "provenance": {
      "event_id": "evt-open",
      "artifact_ref": "erp://orders/ORDER-456/invoice"
    },
    "payload": {
      "invoice_reference": "INV-9",
      "customer_name": "Acme Exporters",
      "consignee_name": "North Harbor Imports",
      "blocking_counterpart": "broker",
      "operator_hypothesis": "Broker cannot clear the shipment until the commercial invoice is present.",
      "open_questions": ["Which corrected commercial invoice file is the broker waiting on?"],
      "release_status": "hold"
    }
  }'
```

## Local run

```bash
pnpm install
pnpm start
```

Then open `http://127.0.0.1:3000/`.

## Quality checks

```bash
pnpm check
pnpm test
pnpm build
```

## Current honesty boundary

Without real credentials in the environment, this repo is still only locally verifiable for its external integrations.

That means:
- the app is genuinely triggerable end-to-end inside the repo
- the live Flowcore and Usable code paths are implemented and tested with mocked external calls
- a fully verified production live round-trip still depends on valid external credentials at deploy/runtime
