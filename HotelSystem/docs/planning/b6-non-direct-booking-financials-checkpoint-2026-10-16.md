# B6 non-direct booking financials checkpoint

October 16, 2026, Asia/Manila. Baseline `f4fb4a2` / `d48e53f9a043`; initial tree clean.
B1–B5 and user records retained. No commit/push, dependencies, reset/reseed, backfill,
payment/accounting implementation or ZKBioTime access.

## Implemented

Original Dashboard/calendar creation saves non-direct bookings, external references, explicit
confirmation date and commercial facts in the existing **single atomic create request**. Direct
requests without new fields keep their contracts/hashes. Existing single/shared/independent room
infrastructure is reused; one contractual accommodation amount applies across all rooms.

The user approved accommodation-only replacement: PHP 3,000 rooms + PHP 500 extras, with a
PHP 2,700 contract, becomes PHP 3,200 before separate signed adjustments. Hotel prices, unit
replacements and ordered discount allocations remain captured. Contract replaces discounted
accommodation once; extras retain reductions. Adjustments and zero clamp follow. Client draft
totals are estimates; the server validates/calculates saved results. No second pricing engine.

External confirmation date selects published terms using B5 inclusive boundaries, never arrival
or today's date. Reviewed source version and agreement UUID/edit version must match. Missing
agreements require typed manually specified terms and a reason, not a fabricated revision.
Source labels/classification, exact terms, identities, factual inputs, server time/actor and reasons
are captured independently of current configuration. In-form definition review refreshes tokens
without discarding amounts/reasons and blocks submission/context changes while loading.

Guest accommodation amounts are explicitly reported-paid/expected/unknown facts, separate from
hotel receipts. Guest/contract differences are classified, never automatically converted into hotel
discounts or commission. Percentage/fixed/manual/none commission respects configured bases and
override permission, exact cents/basis points and half-up rounding. Per-reservation collection
requires an explicit hotel/channel choice. Deducted and separate-invoice expectations differ;
offset/manual/unresolved or hotel-funded guest differences do not invent a net remittance.
No collection, refund, payout, confirmed entitlement, receipt, settlement or ledger record is created.

The original channel editor is reused in the pane and reviewed detail correction dialog. Stored
facts/history appear separately from live billing. Failed saves retain drafts; ambiguous corrections
recover original keys after refresh. Invalid monetary text blocks saving. Demo defaults remain
independent. Saved-source corrections occur through the explicit detail review, not ordinary edits.

## Schema and API

Additive `e59f64a0b154` introduces nullable current external reference, scoped uniqueness and
owned append-only `booking_financial_captures`; `f60a75b1c265` adds capture precision/provenance
checks. The second was additive because the first was already applied. Additive `a71b86c2d376` preserves retirement and corrections under proven historical terms, rather than rewriting either earlier revision. Both isolated targets are
at **`a71b86c2d376`: 23 revisions, 21 HMS tables**. No pre-existing financial rows were rewritten.

Owned FKs, version uniqueness, major-money precision, current reservation-version/source and
published-term INSERT guards complement service validation. UPDATE/DELETE/TRUNCATE reject.
Used agreement periods must cover captured confirmation dates. Retirement remains available; unchanged-source/date corrections retain their proven captured terms even after retirement.
Source classification cannot change while current reservations or historical captures use it.
Current references trim boundaries, preserve case/internal spaces, reject controls and are unique
per company/source when nonblank. Optional blanks remain optional. Explicit correction releases
the former current reference; historical captures remain searchable. Repeated-reference source
exceptions are not configured by B5/B6.

Pricing schema 7 preserves the **unchanged original `channel` commercial capture**. Separate
`channel_figures` records calculation against that pricing revision's hotel lines/adjustments.
Operational edits cannot rewrite the original capture under its UUID. Schemas 1–6 and older
finalized bills remain readable. New bills retain original context and current captured payable total.

- Existing singular/plural create accepts optional `booking_financials`, atomically.
- `GET /api/v1/reservations/{id}/booking-financials`: newest-first capture history.
- `POST /api/v1/reservations/{id}/edit-booking-financials`: expected version, reviewed source,
  complete facts, reason and UUID key; append capture/pricing/audit/receipt, increment version once.
- Reservation list accepts scoped current/historical `external_reference` lookup; original
  Reservations search includes the current captured reference.

Cancelled/no-show records reject financial correction. Finalized bills block it pending their future
correction workflow; issued documents are never changed. Existing drafts become stale. Stay edits
retain captured agreement/contract, with no automatic date-based agreement replacement.
See [full contract](../../backend/booking-financials.md) for amounts, fields and settlement limits.

## Executed verification

- **Complete PostgreSQL: 650 passed** before the final retirement compatibility refinement.
  Final affected regression: **207 passed**, including 29 pure calculation and 30 capture/API cases,
  B5 sources, B2/B3 and immutable bills. Counts overlap; no second complete regression is claimed.
  Covers direct/B1–B5 regressions, configured bases/rounding/models, strict/forged/stale inputs,
  scoped references, inclusive/missing agreements, history, shared multi-room totals, identical-key
  concurrent create, competing corrections, SQL money/history guards, finalized bills, and create/
  correction rollback/retry after each relevant write and immediately before commit.
- **Complete frontend: 263 passed in 48 files.** After adding in-form definition review, final
  affected tests: **28 passed in four files** (new fields/estimates, original channel integration and
  Dashboard). Counts overlap; this is not a second complete 265-case run. Final TypeScript,
  full ESLint and production build passed.
- Ruff lint/format, dependency consistency, Alembic drift and whitespace passed. Existing
  TestClient deprecation and bundle-size warnings remain; no installation/suppression.
- [Final browser: eleven checks passed](../../booking-tests/reports/20261016T063516Z-booking-financials/results.json),
  followed by [actual SQL/API restart](../../booking-tests/reports/20261016T063516Z-booking-financials/postgres-verification.json).
  Original Dashboard/calendar create, published/manual arrangements, reported guest amount,
  percentage/fixed/manual commission, hotel/channel/per-reservation collection, optional blank
  references, required/duplicate rejection, failed-save retention/retry, reviewed source changes,
  stale reservation review, changed configuration/in-form review, lost committed response/refresh/
  original-key replay, history retired-term correction and reservation print were exercised. Agreement retirement was API setup; the retained correction controls were exercised through the original detail UI. Four bookings, nine commercial
  captures, two agreements and one immutable bill survived restart. SQL compared raw capture/
  pricing history with canonical responses. Trace/video/screenshots remain. Browser demo opens
  independently with zero API calls; existing demo saves/channel behavior passed frontend tests.

## Failures and data preservation

A new test exposed a real defect: an ordinary adjustment initially changed figures under the same
commercial capture UUID. Original capture now stays fixed with separate current pricing figures;
that test passed in the complete backend run. A later test exposed an overly strict agreement-retirement guard; additive `a71b86c2d376` restores retirement and proven historical-term corrections without admitting retired terms on new selections. A nightly repricing case also exposed an unnecessary override-reason requirement for an unchanged booked contract. Historical reapplication now retains the original contract/reason; actual price changes still require configured permission and reasons. The final 207-case affected run passed. In-form definition review also closes the draft
recovery path when configuration changes during submission.

Initial test failures: incorrect half-up expectation (15% of 10 minor units is 2, not 1); legacy
expected-body fixtures included the new omitted null field; a plural test assumed another room;
new frontend assertions used unavailable DOM matchers. Tests were corrected without changing
old hashes/rounding or dependencies. Formatting/helper-lambda issues were corrected.

One finalized-bill test passed but fixture teardown lacked bill cleanup, leaving exactly one synthetic
owner after transactional cleanup rolled back. Shared cleanup now uses exclusive locks and the
existing trigger re-enable discipline for bills/captures. The retained recovery script accepts only
UUID `d6a02e3d-a1a4-4733-a25e-79eace144c4d`, verifies fixture name/deterministic source identity
and guarded `hms_test`. Its initial wrong-name assertion stopped before mutation; corrected proof
cleaned only that owner. Later teardown and preservation passed.

Browser `055355Z` is INTERRUPTED after an unbounded action wait; `055516Z` is retained FAIL for
a select accessible-name mismatch. Timeout/prefix selector corrections preserved assertions.
Independent passing reports remain at `055612Z` (six), `060930Z` (nine), `061834Z` (ten) and final `063516Z` (eleven).

Final post-browser [hash baseline](../../backend/verification/b6-before-20261016.json) comparison:
**every pre-existing row/column unchanged, no additional retained rows in either database**.
New capture tables are empty. Development retains six reservations/six allocations; test has none.
[Final inventory](../../backend/verification/current-integration-audit-20261016T064531Z.json) verifies
owned Python, isolated targets, UTC/current heads. Only exact synthetic companies were written/
cleaned. Backend/browser suites ran separately. Owned verification servers stopped; user servers
and unrelated environments were untouched. Only the owned API restarted, not PostgreSQL itself.

## Files, commands and next boundary

New: financial DTO/calculator, capture/correction services/model, three migrations, two backend test
files; typed frontend helpers/tests, original-editor wrapper, stored/review components and tests;
guarded browser/SQL runner, hash evidence, exact fixture recovery and this checkpoint. Modified:
create/plural/stay/billing preservation, reads/routes/hashes, source-history guards, cleanup/legacy
fixtures; client/projections/context, original pane/editor, Reservations search/detail/print, bill
contents, contracts/README, parity plan/matrix and architecture. Earlier verified functionality retained.

From `HotelSystem`:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-booking-financials.py
npx vitest run src/components/channels/BookingFinancialFields.test.tsx src/app/api/bookingFinancials.test.ts src/components/channels/ChannelIntegration.test.tsx src/pages/DashboardPage.test.tsx --maxWorkers=2
npm run lint
npm run build
```

From `backend`, separately from browser harnesses:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b6-before-20261016.json
```

Other checkouts must explicitly migrate through the owned wrappers. Current targets are migrated;
restart an old launcher normally before `run-api.bat`. No reset/reseed required.

**B6 is implemented and verified within the manual operational capture boundary.** No dedicated
server-preview endpoint, complete rich-browser rerun, fresh-empty migration/restore rehearsal,
source-create response-loss browser case or every nightly/independent/entitlement combination was
separately exercised here. New financial document PDF rendering was not separately browser-tested.
These limits are distinct from the passing full backend/frontend and targeted original-UI checks.

Next separately authorized milestone: **B7 collection/refund/reversal contract review**, preserving
reported guest facts versus actual collector transactions/hotel receipts and source/history identity.
B8 settlement execution, finalized-bill corrections, accounting, connectors and production staff
authorization remain separate. Stop here; no commit/push.
