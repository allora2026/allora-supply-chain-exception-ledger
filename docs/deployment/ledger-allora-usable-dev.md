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

## End-to-end verification loop

Use the existing projector and operator-surface fixtures to verify the demo path end to end.

1. **Open the case** by replaying the missing-document path (`expected_document_missing` plus the shipment hold context) and verify the operator surface shows the exception list, case detail, evidence timeline, missing-artifact panel, counterpart state, handoff notes, and resolution snapshot shell. In other words: open the case from correlated missing-document evidence.
2. **Wake the case with later evidence** by replaying the counterparty correction request and corrected-document receipt path, then verify the case moves through `waiting_for_artifact` and `updated` while preserving the new evidence trail and handoff notes. This step should explicitly wake the case with later evidence rather than spawning a new family.
3. **Resolve the case** by replaying `case_resolved` and verify the final status is `resolved` with a concrete resolution snapshot. This step should resolve the case while preserving the same canonical key.
4. **Verify reusable case memory** by confirming the resolved case keeps durable `usable_case_memory` content: handoff notes, operator hypotheses, missing-artifact questions, the resolution snapshot, and similar historical case recall for the next operator shift. This final check proves reusable case memory is available for future operators.

## Verified public rollout evidence

The deployed deterministic demo is now reachable at `https://ledger.allora.usable.dev`.

Verified on 2026-04-26:
- `GET /health` returned `200 {"ok": true, "application": "ledger.allora.usable.dev"}`
- Browser verification showed the homepage loaded and the Open / Updated / Resolved scenario buttons rendered the expected operator surfaces without console errors
- `GET /api/demo/open`, `GET /api/demo/updated`, and `GET /api/demo/resolved` all responded on the public host

This is still an honest demo boundary, not live Flowcore ingestion or live Usable production persistence.

## Suggested repo checks

- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm test -- tests/contracts/deployment-demo.contract.test.ts`

These checks keep the deployment contract, end-to-end operator narrative, and reusable case memory expectations committed in repo truth before any external GitOps rollout.
