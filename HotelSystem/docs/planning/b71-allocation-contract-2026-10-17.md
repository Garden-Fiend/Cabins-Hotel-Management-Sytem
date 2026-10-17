# B7.1 architecture mapping and contract

Authority: user attachment `63fd3b50-a9ab-480f-bdff-5df459ea226c/Pasted text.txt`.
Baseline: B7 `c93da8e4f598`; existing B6/B7 uncommitted work retained.

## Architecture mapping established before implementation

- `billing_collection_transactions`: immutable original payment UUID, collector, declared component,
  source/capture provenance; linked refunds/reversals already determine remaining original capacity.
- `guest_obligation_bases`: reviewed accommodation basis bound to pricing UUID and commercial capture.
- Existing pricing snapshots retain room/allocation UUIDs, purchase/extra line UUIDs, discount
  allocations and signed adjustment UUIDs. `hotel_amounts` computes authoritative post-reduction
  accommodation/extra component totals. No new pricing calculator or invented charge-line IDs.
- Minimal target is a **component**, identified by `(reservation UUID, accommodation|hotel_charges)`.
  An allocation captures the pricing UUID and, for reviewed accommodation, obligation UUID. Individual
  product/room splits are not asserted by this component-level model.
- New billing-owned allocation events retain original payment UUID, target component, positive PHP
  amount, allocate/release kind, release-of UUID, context, reason/provenance and server actor/time.
  Releases compensate originals; originals and captured pricing/documents never change.
- Reuse owned parent locks, expected versions, request advisory locks, audit and mutation receipts.
  Document finalization locks document then parent; allocation commands do not lock documents.
- Original demo initial editor appends multiple verified collections. API initial lists therefore
  need deterministic ordering and sorted reference locks, not a create-then-collect workaround.

## Intended behavior

Hotel payment automatically covers its declared component only when known and eligible, capped to
its residual. Excess is unapplied cash, not another discount. Explicit hotel allocation may cross to
another known eligible component with reason. Channel funds cover only reviewed accommodation.
Discounts change target obligations, never original payment capacity. Unknown bases and any
unclassified nonzero signed adjustment remain review-required; no distribution by guesswork.

Refund/reversal releases excess allocations newest-first within the same parent-locked transaction.
Pricing/basis changes release allocations whose context is obsolete, with explicit audit; history is
not rewritten. Released hotel funds remain available for review/reallocation. Reviewing a known basis
may automatically apply matching-component funds; manual release does not automatically reapply them.
Existing B7 payments are not given fabricated historical allocations by migration or GET.

GET collections gains allocation history, per-payment remaining/refundable/allocated/unapplied funds,
hotel allocation totals, channel coverage and component outstanding/credit. Signed aggregate credit
remains distinct from refundable capacity; unapplied channel amounts never become hotel cash.

Proposed POST `/{reservation}/payment-allocations`: expected_version, expected_pricing_id,
expected_obligation_id, kind, payment_id, component, amount_minor, release_of (release only), reason.
UUID Idempotency-Key, same replay/ownership/error conventions as B7. Authoritative balances reject
as extra input fields. One version/audit/receipt transaction; no pricing or document changes.

Initial `collections` accepts legacy object or ordered list (collection kind only), with additive
intra-version ordinal. Old omitted/object request hashes remain unchanged. Duplicate acknowledgment
is per entry, bound to stable initial body excluding acknowledgment fields; all reference locks are
acquired in stable numeric lock order before inserting any staged payment.

This document records intended contracts. Actual verification and remaining limits belong in the
implementation checkpoint; no tests are implied by this mapping.
