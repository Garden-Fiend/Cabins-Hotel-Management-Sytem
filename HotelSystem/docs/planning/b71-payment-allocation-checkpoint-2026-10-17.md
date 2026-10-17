# B7.1 payment allocation and financial boundary checkpoint

October 17, 2026, Asia/Manila. Baseline: [B7](b7-collections-checkpoint-2026-10-17.md),
`c93da8e4f598`. Authority: the supplied B7.1 specification. Existing dirty B6/B7 work and
business records retained. No commit/push, installation, database reset/reseed, B8, accounting,
payment execution or unrelated environment access.

## Implemented

[Architecture mapping](b71-allocation-contract-2026-10-17.md) was established before implementation.
One billing-owned append-only allocation/release table reuses original collection UUIDs and stable
`reservation UUID:component` targets. Each event captures pricing/basis UUIDs, exact positive PHP
cents, provenance/reason, server actor/time and an original-allocation link for releases. No new
charge/pricing calculator, folio or individual receivable table was introduced.

New payments automatically cover their declared eligible component up to its outstanding obligation.
Excess stays unapplied. Staff may explicitly apply hotel funds to another eligible component or
release an active allocation. Channel money covers only reviewed accommodation and never becomes
hotel money. Discounts create no funds. Any unclassified nonzero adjustment, including offsetting
positive/negative entries, retains requires_review; unknown/outdated accommodation bases stay unknown.
Signed guest balance, component debt, unapplied funds and original refund capacity remain distinct.

Refunds/reversals compensate excess allocations in the same transaction, preserving oldest valid
applications. Pricing/basis changes release obsolete-context allocations without rewriting history.
Released funds await review/reallocation; a reviewed basis can apply matching-component funds.
No migration/GET backfills historical payments. Existing immutable bills/prices are unchanged.

POST `reservations/{id}/payment-allocations` reuses owned aggregate locking, strict context/version
checks, original-key replay, audit and receipts. Source and target caps are server validated; owned
FKs, append-only/release guards and deferred source-capacity checks enforce relational integrity.
See [contracts](../../backend/collections.md). Original detail controls expose authoritative summaries,
manual application/release, immutable history, retained failures and uncertain-request recovery.

Original Dashboard/calendar create controls now stage an ordered list of up to 100 payments in the
same singular/plural create operation. Legacy one-object/omitted requests retain their hashes.
Version remains 1, with deterministic intra-version ordinals and sorted evidence locks. Per-entry
duplicate review binds the complete ordered intent and current match set, including earlier staged
entries; acknowledgment under a new key after a known rollback remains valid for unchanged intent.
No create-then-collect workaround. Demo remains independent.

## Migration and preservation

Additive `da4eb9f506a9` adds `payment_allocation_events`, collection ordinals and guarded constraints.
Both owned targets upgraded explicitly from B7; [final inventory](../../backend/verification/b71-final-inventory-20261017.json) confirms 26 revisions / 24 HMS tables. No downgrade/backfill.
Fresh migration and restored drift passed in the independently isolated recovery cluster.

Final [original-column hash comparison](../../backend/verification/b71-before-20261017.json) passed:
**every original row/column unchanged; no additional retained rows in either target; new event table
empty** after owned synthetic cleanup. Existing finalized documents and historical financial rows
were retained. Cleanup exclusively locks the protected event table and re-enables its row guard
before transaction commit. Only exact synthetic test owners were removed. User servers and unrelated
environments were untouched; owned temporary servers stopped. Restart verification restarts the API,
not PostgreSQL.

## Executed verification

- Stage A rules: **7 passed**. Initial allocation/API slice: **18 passed**. Later focused runs
  expanded correction, concurrency, initial list and duplicate-review coverage.
- **Full PostgreSQL: 709 passed.** Subsequent affected allocation/B7/B1/immutable-bill run:
  **100 passed**. Final allocation API suite after two additional ownership/lock-order tests:
  **23 passed**. Counts overlap; no second complete regression is claimed.
- **Full frontend: 274 passed in 51 files**. Focused allocation/cart/collection run: **9 passed**.
  Cases include retained stale drafts, exact source/context submission, original-key refresh recovery
  and removing one staged payment without shifting another's amount.
- Final full ESLint, TypeScript/production build, Ruff lint/format, dependency consistency,
  Alembic drift and whitespace checks passed. Existing TestClient/bundle warnings remain.

Backend cases cover excess funds and target/source caps; discounts creating no cash; channel-only
coverage; ambiguous adjustments; release/reapplication; partial refund/full reversal compensation;
pricing correction audit/history; forged/foreign targets; stale context; competing allocations/refunds;
same-key/body mismatch; staged multi-payment rollback/retry; duplicate staged evidence; opposite-order
evidence-lock races; and database immutability/deferred capacity/release guards. Allocation failure
injection covers version, event, audit, receipt and immediately before commit. Old hash tests passed
in the full suite. No financial policy was relaxed to satisfy an assertion.

[Original-control browser: 18 checks passed](../../booking-tests/reports/20261017T025454Z-collections/results.json),
followed by [raw allocation SQL/restart](../../booking-tests/reports/20261017T025454Z-collections/collection-persistence.json)
and [general SQL/restart](../../booking-tests/reports/20261017T025454Z-collections/postgres-verification.json).
Seven reservations, 18 collection/correction records, 17 allocation/release events, two obligation
bases, three commercial captures and one finalized bill survived a real owned API restart. SQL
compared event payment/pricing/basis/release identities, amounts, components, order and provenance.

New browser paths: Dashboard single/two-room multi-payment creation; calendar two-room creation with two staged payments and a purchased meal at
version 1; unapplied hotel funds; explicit meal allocation with lost-response refresh/original-key
replay exactly once; partial manual release; collection after finalization with identical bill;
OTA accommodation leaving hotel meal due with zero hotel cash; original historical-capture refund
after commercial correction; ambiguous adjusted booking retaining unapplied funds/requires_review.
Existing Dashboard initial failure/no-phantom, direct/channel collection, duplicate review, refund,
reversal, stale review and independent demo zero-API checks also passed. Traces/video/screenshots
remain in the report directory.

[Recovery rehearsal](../../backend/verification/recovery-rehearsal-20261017T024943Z.json) passed:
new loopback-only PostgreSQL cluster, empty migration, explicit seed/replay, collection/refund/basis,
automatic and manual releases, custom-format dump/restore to a separate empty database, identical
all-table hashes/canonical reservation/collection summary, matching heads and restored drift.
Five allocation events were restored, including release links. The owned cluster/volume is retained
stopped; existing dev/test databases were never rehearsal targets. This is local recovery evidence.

## Failures and limits

The first expanded browser run,
[025001Z](../../booking-tests/reports/20261017T025001Z-collections/results.json), passed 12 checks
then timed out on an exact select accessible-name matcher. A prefix matcher corrected the harness;
the fresh 18-check run passed without an application/assertion change. Failed evidence is retained.
An earlier affected backend run passed 71 and failed one old cross-component residual expectation;
the assertion was updated for the approved separate outstanding/unapplied model, and passed thereafter.

No known blocker remains for this component-level slice. Unclassified signed adjustments still need
an approved component-attribution policy; the API deliberately does not allocate them. Channel
unapplied money cannot transfer to extras. A signed zero balance does not mean every component is
covered; use component outstanding and allocation status. Refund capacity does not authorize an
actual disbursement. Legacy payments require explicit present-time review, not fabricated history.

Allocation targets aggregate accommodation/hotel charges, not individual meal/room receivables.
Dashboard single/plural and calendar plural initial payment lists were browser-exercised; calendar
single-room creation used one payment. Maximum
100-entry/maximum-cent carts were not separately browser-tested. No hosted recovery, production
staff authorization, legal receipts, gateway, bank/OTA settlement or accounting is implied.

## Reproduce and next action

From `HotelSystem`, browser harness separately from PostgreSQL suites:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-collections.py
npx vitest run src/components/channels/PaymentAllocations.test.tsx src/components/channels/Collections.test.tsx src/app/api/collections.test.ts --maxWorkers=2
npm test -- --maxWorkers=2
npm run lint
npm run build
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_payment_allocations.py tests/test_allocation_rules.py tests/test_collections.py tests/test_collection_boundaries.py tests/test_initial_financials.py tests/test_billing_documents.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b71-before-20261017.json
& .\scripts\python.ps1 scripts/rehearse-recovery.py
```

Other checkouts must explicitly migrate through owned wrappers; these targets are already upgraded.
Restart an older launcher normally before `run-api.bat`; no reset/reseed. Changes: allocation
model/service/migration/tests; collection DTOs/order/initial resolver; concrete receipt compensation;
typed API/client/cart and original detail/pane integrations; guarded fixture/browser/recovery runners;
contracts, architecture and evidence. Existing B6/B7 changes in overlapping files remain uncommitted.

Stop at B7.1. Next work is separately authorized B8 contract review, or approved attribution of the
remaining ambiguous adjustment components. Do not automatically begin settlement or accounting.
