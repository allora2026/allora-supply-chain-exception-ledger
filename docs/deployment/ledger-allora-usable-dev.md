# Deployment + verification guide for `ledger.allora.usable.dev`

This repository stays within the single-app deployment contract for the supply-chain exception ledger v0 slice.

## Single-app GitOps shape

- Deployment values live under `deploy/apps/ledger/values.yaml`.
- The production override lives under `deploy/apps/ledger/azure-eu.yaml`.
- The workload is expressed as one `flowcore-microservices` deployment named `alloraSupplyChainExceptionLedger`.
- Ingress terminates on `ledger.allora.usable.dev` using `allora-wildcard-tls`.
- ArgoCD should reconcile the workload from `main` after the matching image tag is published.
- The deployment contract remains one app only; do not split the ledger into separate API, worker, or inbox services for v0.

## Runtime boundary

The deployed app still handles only the commercial-invoice/customs-document exception family described in the PRD and contract docs.

## Runtime mode expectations

The app has two honest modes:

- **live**: Flowcore and/or Usable credentials are present, so trigger requests forward to Flowcore and case memory syncs to Usable.
- **local-only**: credentials are absent, so trigger requests still persist locally and the UI/API explicitly report that the result is local-only.

Do not describe a rollout as fully live unless the deployed environment has working values for:
- `FLOWCORE_API_KEY`
- `FLOWCORE_DATA_CORE_ID`
- `USABLE_ACCESS_TOKEN`
- `USABLE_WORKSPACE_ID`
- `USABLE_FRAGMENT_TYPE_ID`

## End-to-end verification loop

Use the trigger route and persisted case APIs to verify the operator path end to end.

1. **Open the case** by POSTing an `expected_document_missing` event to `/api/events/trigger`, then confirm `GET /api/cases` shows the projected case and `GET /api/cases/:caseId` shows the exception list, case detail, evidence timeline, missing-artifact panel, counterpart state, handoff notes, and resolution snapshot shell. In other words: open the case through the real trigger route.
2. **Wake the case with later evidence** by POSTing later correlated events like `counterparty_requested_correction` and `corrected_document_received`, then confirm the same case moves through `waiting_for_artifact` and `updated` rather than creating a new family. This step should explicitly wake the case with later evidence.
3. **Resolve the case** by POSTing `case_resolved` and verify the final status is `resolved` with a concrete resolution snapshot while preserving the same canonical key. This step should resolve the case without changing the case family.
4. **Verify reusable case memory** by confirming the resolved case keeps durable `usable_case_memory` content: handoff notes, operator hypotheses, missing-artifact questions, the resolution snapshot, and similar historical case recall.
5. **Verify live vs local-only truthfulness** by checking `GET /api/runtime/status` and the returned case record integrations. The API must expose whether the current result is live or local-only.

## Verified public rollout evidence

The deployed app can still host the demo routes, but the repo truth has moved beyond demo-only behavior.

Minimum rollout verification for a real deployment:
- `GET /health` returns `200`
- `GET /api/runtime/status` reports the expected modes
- `POST /api/events/trigger` accepts a valid event body
- `GET /api/cases` shows the persisted case
- when live credentials are configured, the returned case includes live Flowcore ids and/or Usable fragment metadata

If the public host is missing external credentials, report it as **running in local-only mode**, not as fully live Flowcore + Usable.

## Suggested repo checks

- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm build`
- `pnpm test -- tests/contracts/deployment-demo.contract.test.ts`

These checks keep the deployment contract, end-to-end operator narrative, and reusable case memory expectations committed in repo truth before any external GitOps rollout.
