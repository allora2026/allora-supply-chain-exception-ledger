# Supply-chain Exception Ledger v0 Contract

This repository encodes the first implementation-ready contract for PRD `c33ca45b-a18b-4289-940c-d61acf3fa3a5`.

## Scope

The product handles exactly one exception family in v0:

- missing or mismatched commercial invoice / customs-supporting documentation for international shipment release

The canonical case identity is the tuple:

- `shipment_id`
- `document_type`
- `order_reference`

For the v0 wedge, `document_type` remains anchored to `commercial_invoice`. Customs-supporting documents may appear as attached evidence, but they do not create new case families or change the canonical key.

## Required case facts

Each durable exception case preserves:

- shipment identifier
- release / hold state
- customer / consignee context
- order and invoice references
- missing-vs-mismatch classification
- current blocking counterpart
- latest operator hypothesis
- open questions / missing artifacts
- provenance-linked evidence trail
- current resolution status (`open`, `waiting_for_artifact`, `updated`, `resolved`)

## Required source families

The contract assumes these source families exist:

- ERP order and expected invoice facts
- WMS shipment facts
- TMS / carrier / freight-forwarder milestone updates
- EDI or customs-document status signals
- email / attachment intake metadata for forwarded document evidence

## Required event families

Flowcore must emit the following event families:

- `shipment_hold_changed`
- `expected_document_present`
- `expected_document_missing`
- `document_mismatch_detected`
- `counterparty_requested_correction`
- `corrected_document_received`
- `operator_note_recorded`
- `case_resolved`

## System boundary

### Flowcore owns

- ingestion of the v0 source families
- provenance preservation for evidence items and artifact references
- correlation onto the canonical exception key
- open / changed / sleeping / reawakened exception detection
- routed case-update events
- event trail generation

### Usable owns

- durable case narrative
- hypotheses and confidence notes
- missing-artifact questions
- counterpart waiting state and requested follow-ups
- shift handoff summaries
- similar historical exception memory
- reusable resolution memory on closeout

### Application owns

The single app at `ledger.allora.usable.dev` renders:

- exception list
- case detail
- evidence timeline
- missing-artifact panel
- counterpart state
- handoff notes
- resolution snapshot

## Scope guards

The v0 contract explicitly excludes:

- generic case-platform abstractions
- inbox or message-triage semantics
- multi-service decomposition
- extra operator modules beyond the seven required surfaces
- extra exception families, claims, billing, SLA tooling, or broad analytics

## State model

Allowed case states:

- `provisional_correlation`
- `open`
- `waiting_for_artifact`
- `updated`
- `resolved`

`provisional_correlation` is internal only. A surfaced durable case must converge to the canonical key before operator use.
