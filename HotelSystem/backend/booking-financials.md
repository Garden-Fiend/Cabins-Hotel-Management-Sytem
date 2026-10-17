# Non-direct booking capture (B6)

This is manually entered booking provenance, contractual pricing and expected obligations.
It is not a channel connector, hotel payment receipt, payout, settlement or accounting entry.
Existing direct requests remain supported without new fields or changed omitted-field hashes.

## Financial meaning

The user explicitly approved accommodation-only replacement: PHP 3,000 rooms + PHP 500 extras,
with a PHP 2,700 contract, produces PHP 3,200 before separate signed adjustments. One contract
amount covers all allocations; no copy is applied per room. Configured hotel rates are retained.

The existing hotel calculator first captures unit prices, replacements and ordered discounts.
Server-owned reduction allocations determine remaining accommodation and additional charges.
The contractual amount replaces remaining accommodation once; additional charges retain their
reductions. Signed adjustments follow, then the final zero clamp. Hotel discounts are not applied
again to the contract. No extra proportional contractual room allocation is fabricated.

`guest_paid_minor` is the **accommodation amount reported by the booking document**, with
`reported_paid`, `expected`, or `unknown` provenance. It does not cover subsequent hotel extras,
reduce the operational bill or establish a hotel receipt. Zero is valid; unknown has no amount.
Guest/contract differences require `none`, `channel_funded`, `hotel_funded` or `unresolved`.
Classification never creates a discount or commission by itself. A hotel-funded reduction in
entitlement must be reflected in the contractual amount with the permitted override/reason;
an outstanding guest/contract difference classified hotel-funded remains unresolved for remittance.

Commission uses the captured none/percentage/fixed/manual rule and override permission. Percentage
bases are contractual accommodation, explicit reference value or explicit commissionable amount,
as configured. Integer basis points round half up. Manual commission/overrides require an amount
and reason. An explicitly permitted commission override is retained alongside its configured rule.

Collection is hotel/channel; configured per-reservation collection requires an explicit choice.
For channel collection, deducted settlement expects contract minus commission; separate invoice
expects the gross contract and retains commission separately. Deducted commission cannot exceed
the contract. Offset/manual settlement, and unresolved/hotel-funded guest differences, produce no
invented remittance amount. Hotel collection never creates an expected channel remittance.
All these are expectations; B6 records no collection transaction or verified hotel receipt.

## Agreement and reference resolution

An explicit external confirmation calendar date selects the active published agreement, using B5
inclusive boundaries. Arrival/current date is never substituted. Inputs include reviewed source
version and applicable agreement UUID/edit version (explicit nulls when absent). Changed definitions
reject. New selections exclude draft, retired, future-inapplicable and expired agreements.

If no agreement applies, an explicitly entered typed manual arrangement plus reason is required;
it is captured as `manual_arrangement`, with no fabricated published revision. When a published
agreement applies, manually supplied rules cannot replace it. PHP only; strict bounded integer
cents, basis points and allowlisted fields; client labels/calculated provenance/receipts reject.

References trim boundary whitespace, retain case/internal spaces/punctuation, reject internal
controls, and allow at most 200 characters. Required references cannot be blank. Every supplied
current reference is unique within company/source, backed by a partial unique index. Sources do
not currently configure repeated-reference exceptions. Optional blanks remain null/unconstrained.
Explicit correction releases the former current reference; its historical capture remains searchable.
GET reservation list supports `external_reference` and optional `booking_source_id`, including
historical captures. The original Reservations search also matches the current captured reference.

## Captures, pricing and corrections

`booking_financial_captures` stores immutable owned capture UUID, reservation version, source,
optional owned agreement, confirmation date, server capture time and typed JSON. JSON retains
source label/classification, revision/edit version, exact terms, factual inputs, reasons, actor and
initial financial results. No existing booking receives invented terms or amounts.

Pricing JSON schema 7 retains original lines and the unchanged commercial `channel` capture.
Separate `channel_figures` stores the calculation against that pricing revision's hotel lines and
adjustments. An ordinary adjustment/stay edit cannot rewrite the original capture under its UUID.
Old schemas 1–6 remain readable. Historical pricing and finalized documents remain unchanged.
New operational documents capture schema-7 pricing inside their existing document aggregate and
display the original commercial context separately from the current captured payable total.

Creation includes optional `booking_financials` in the existing singular/plural create body, inside
the same transaction. No create-then-edit sequence. Operational edits retain captured agreement,
contract and commission inputs; stay changes never select a new agreement automatically. Unchanged-source/date corrections retain their captured agreement or manual terms; retirement or newly published configuration does not silently replace the booked contract.

- `GET /api/v1/reservations/{id}/booking-financials`: captures, newest reservation version first.
- `POST /api/v1/reservations/{id}/edit-booking-financials`: expected reservation version,
  `booking_source_id`, complete `booking_financials`, nonblank correction reason and UUID key.

Reviewed source/effective-date/financial corrections append a new capture and pricing revision,
advance reservation version once, and save human-readable audit plus durable receipt atomically.
Cancelled/no-show bookings reject. A finalized bill blocks this command pending its future correction
workflow; it is never rewritten. Existing draft bills become stale and require their existing review.
Ownership, resource-bound key replay, stale-version checks and row/advisory locks are reused.

Database guards protect capture identity/major monetary precision, owned source/agreement FKs,
append-only history and agreement periods/status used by captures. Source classification cannot
change while current reservations or prior financial captures use it. Used agreement periods may
close only while still covering captured confirmation dates. Retirement remains available, and corrections under the same source/date can reuse the proven prior captured terms; new selections still require active applicable terms or an explicit manual arrangement.
Test-owner cleanup uses exclusive table locks, exact synthetic ownership and trigger re-enabling
before commit. There is no application bypass.

## UI and limits

The original pane and channel-terms editor handle Dashboard/calendar creation. Added controls
capture confirmation date, reported guest amount/funding and reasoned manual arrangements.
The detail page provides stored facts/history and an explicit reviewed correction dialog using
the same editor. Failure retains drafts; ambiguous corrections recover original keys across refresh.
Client draft totals are estimates; authoritative validation/calculation occurs on save, not a new
server-preview endpoint. Demo remains independent. B7/B8 collection/refund/settlement execution,
tax/accounting, OTA connectivity and production staff authorization remain separate milestones.

Migrations: additive `e59f64a0b154`, `f60a75b1c265` for capture precision/provenance guards, and `a71b86c2d376` for retirement-compatible historical corrections.
Applied history was not rewritten to add the latter safeguards. No reset, reseed or backfill.
