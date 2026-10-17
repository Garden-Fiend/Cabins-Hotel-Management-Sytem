# Operational billing-document contract

This backend foundation captures an authoritative reservation into a separately persisted document.
Its type is `operational_bill`, not a tax invoice, payment or accounting entry. It reuses captured
pricing results without adding a pricing/tax engine or statutory invoice-number policy.

## Lifecycle

Only **Draft (version 1) → Finalized (version 2)** is supported. Draft captures are fixed; there is
no edit/refresh/delete API. A changed source requires explicit review and a new draft. Multiple drafts
may exist, but a partial unique index permits only one finalized bill per company/reservation.
Another bill after finalization requires the future correction workflow.

Eligible sources: confirmed, reserved, checked-in and checked-out reservations. Cancelled/no-show
sources reject. Zero totals are valid. Finalization compares the entire source reservation version
(including note/count changes), current pricing UUID and captured pricing contents. Changes return
409 `stale_billing_source`; no silent regeneration occurs.

These operations append audit/receipts but do not increment reservation versions, alter allocations
or append pricing revisions. Later reservation edits remain possible; the document remains unchanged.

## API

Mutations require UUID `Idempotency-Key`. Versions are strict positive JSON integers. Unsupported
fields/client-priced captures reject with 422. Company ownership comes from server context.

| Endpoint | Contract |
|---|---|
| `POST /api/v1/reservations/{id}/billing-documents` | `{ "expected_reservation_version": 3 }` → 201 draft |
| `GET /api/v1/billing-documents/{id}` | Complete captured document |
| `GET /api/v1/reservations/{id}/billing-documents` | Ordered list; limit 1–100/default 100, offset default 0 |
| `POST /api/v1/billing-documents/{id}/finalize` | `{ "expected_version": 1 }` → 200 finalized document |

Foreign resources return 404. Stale document/source versions, finalized state and another finalized
bill return explicit 409 errors. Same company/operation/key/body/target replays its original committed
result; a different body/target returns 409 `idempotency_conflict`. Draft creation replay after
finalization returns the original draft response; GET returns the current finalized document.

## Capture

`billing_documents` owns UUID, company/reservation IDs, source pricing UUID and reservation version,
type, state, number, PHP total, document version, UTC timestamps, server actor attribution and
creation/finalization request keys. `capture_hash` is SHA-256 of canonical typed JSON, for corruption
detection rather than a digital signature.

Capture schema 1 stores reservation reference/state, guest identity/contact snapshot, allocation
identity/scheduled instants and complete existing `PricingRead`. This retains original identities,
historical labels, quantities, units, separate overrides, discounts/allocations, signed adjustments,
total, pricing revision/version/time. Company identity remains on the owning document. Current
products/rates/definitions are unnecessary for reconstruction.

Typed response `lines` projects these stored results: source line/kind/rate-or-product, label,
quantity, original/effective unit and extended amount, captured reductions and final amount.
Effective unit means captured replacement when present, otherwise original. Reductions use saved
original-line-order allocations, not a proportional split. Adjustments and zero clamp remain separate
in pricing, so line totals need not equal payable before those effects. Projections are not inputs.

## Transaction and database enforcement

Creation takes the existing request advisory lock and an owned source reservation lock, checks
expected version, then inserts document/audit/receipt atomically. Finalization takes the request
lock, exclusively locks the document, then exclusively locks its source reservation. This serializes
separate drafts/finalizations with reservation writers. Existing bounded lock timeouts apply; prolonged
contention may return retryable 503.

The company-owned `billing_document_counters` row allocates `HMS-BILL-00000001`, etc. Its increment,
document finalization, audit and receipt commit together. Failures consume no number. Numbers are
company-unique internal references, not a statutory invoice series; exhaustion rejects explicitly.

Composite foreign keys enforce company/reservation/pricing provenance. State/money/version checks,
unique keys/numbers and a partial final-bill index complement service validation. PostgreSQL triggers
reject finalized UPDATE/DELETE/reopening, direct finalized insertion, financial-content changes during
finalization, unsupported draft edits and truncation. Source foreign keys retain history. Lines live
inside one JSON aggregate, preventing partial/orphaned child-line writes.

The database owner can administer triggers; a least-privileged production runtime role remains future
work. No API/request flag bypass exists. Guarded test-owner cleanup temporarily disables only the row
trigger inside an exclusive-table-lock transaction, removes its random synthetic company's rows and
re-enables the trigger before commit. It cannot expose a disabled trigger to concurrent writers or
change existing business records.

## Deferred corrections and UI

A future correction/credit document should have its own number/UUID and an explicit same-company
`corrects_document_id` link to the original. Original captures must remain immutable. Correction
types/amounts, tax and payment interactions need separately approved rules; none are implemented.

API mode now exposes an always-visible Billing Documents section in expanded reservation detail:
list/read, explicit draft creation, capture review and confirmed finalization. The separate
`/billing-documents/{id}/print` route reads the stored capture and labels it Operational Billing
Statement; drafts have a visible DRAFT label and no final number. Ambiguous mutations retain their
original UUID request/body in session storage across refresh for explicit replay. Demo actions are
gated and do not call this API. Existing live reservation billing and reservation print remain separate.
No payments, refunds or accounting were added. See the
[frontend checkpoint](../docs/planning/billing-documents-ui-checkpoint-2026-10-15.md).

## Multi-room capture compatibility (B2)

Plural sources use capture schema 2: `allocation_id: null`, the complete active `allocations` array
and pricing schema 6 with allocation-attributed lines. Existing endpoints, hashes, immutability and
numbering remain authoritative: one document belongs to one reservation, not one per room.
Later room addition/removal cannot rewrite a finalized bill. Schema-1 captures remain unchanged.

## Independent-stay captures (B3)

Capture schema 3 adds inherited/custom provenance to each captured allocation. Top-level dates are
the overall range; individual allocation dates/duration and captured rate/kind/quantity remain the
authority. Contents/print display captured room stays without current rate/duration configuration.
Schemas 1/2, source-version checks, hashes, counters and immutable finalization remain unchanged.
Date/duration edits make an earlier draft source stale; finalized documents are never regenerated.

## B6 captured commercial context

New documents can contain pricing schema 7: the immutable original commercial `channel` capture and separate per-pricing-revision `channel_figures`. Payable total uses that saved pricing result; commission and reported guest payments are not added as guest charges or hotel receipts. The UI labels original commercial capture totals separately from the document's current captured total. Existing document schemas/captures and finalized rows are unchanged. Reviewed commercial correction rejects while a finalized bill exists; no finalized-document correction workflow is introduced.
