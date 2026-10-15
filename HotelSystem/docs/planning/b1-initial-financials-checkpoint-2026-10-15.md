# B1 initial reservation financials checkpoint

October 15, 2026, Asia/Manila. Baseline: accepted billing-document frontend milestone,
head `68f75a14d5a4`. B1 only; no B2 implementation, commit/push, migration, dependency install,
reset or reseeding. Existing uncommitted milestones and user data were retained.

## Recovered and completed

Before resumption, B1 application changes were already implemented: ordinary create charges accepted,
optional signed adjustments validated with the saved-billing contract, shared server pricing invoked
inside the existing create transaction, omitted adjustment fields excluded from historical request
hashes, typed frontend inputs forwarded and original initial-purchase/adjustment gates removed.
Twenty new backend cases existed. Earlier affected runs passed 84 backend tests and 28 frontend tests;
the new 20-case suite also passed after adding the combined nightly case. These overlapping counts
are not additional distinct tests.

Resumption retained that code. It completed browser/SQL/restart verification, corrected only harness
assumptions/selectors, formatted the updated legacy-hash fixture, ran targeted regressions and recorded
this checkpoint. No application behavior needed changing during recovery.

Initial save now accepts purchases, protected extras, positive/negative adjustments, discounts,
configured final unit prices, inclusions and nightly breakfast in one create operation. Server-owned
product/rate prices and captured labels remain authoritative. Adjustments use unique UUIDs, strict
nonzero signed PHP cents and nonblank reasons; unsupported/client-priced fields reject. Existing
discount order/caps and final zero clamp are reused. No create-then-edit workaround was added.

## Actual verification

- Final targeted PostgreSQL run: **127 passed**, covering initial financials, manual discounts,
  inclusions, breakfast and existing immutable billing documents. The 20 new B1 cases cover mixed
  purchases/extras/discounts, signed amounts/zero clamp, full nightly override/inclusion/breakfast
  creation, forged/invalid inputs, duplicate IDs, historical hash compatibility, concurrent identical
  creates and rollback/retry after each reservation/allocation/pricing/audit/receipt write and before
  commit. Earlier 84-case run additionally exercised existing create/read/extras/final-price APIs.
- Final affected frontend: **32 passed in five files**, including create/discount/edit adapters,
  Dashboard demo behavior and original-key mutation recovery. ESLint, TypeScript and production build
  passed. Ruff lint/format, runner syntax and diff whitespace passed. Complete repository suites were
  not rerun; existing TestClient and bundle-size warnings remain.
- [Four browser checks](../../booking-tests/reports/20261015T051306Z-initial-financials/results.json)
  and [actual PostgreSQL/restart verification](../../booking-tests/reports/20261015T051306Z-initial-financials/postgres-verification.json)
  passed. Original Dashboard and calendar empty-cell create forms saved purchases/quantities, extras,
  a room final-price replacement, percentage reduction and both adjustment signs. Totals were
  **PHP 1,040.00** and **PHP 1,130.00**, each at reservation version 1 / pricing revision 1.
  A failed pre-send save retained the draft and created no phantom. A lost committed response survived
  refresh and replayed the original key without a duplicate. Browser request assertions confirmed no
  follow-up reservation edit. Original print retained captured charges/adjustments. Demo purchase and
  signed-adjustment creation passed with zero API calls. Both canonical records and raw pricing
  snapshots survived a real owned API process restart. Trace/video/screenshot remain with the report.

Failed browser evidence remains preserved: `20261015T024521Z-initial-financials` assumed Configure
was closed after adding a room; `024658Z` matched the same reason in two displays; `051110Z` looked
for a detail-only adjustment on Dashboard; `051151Z` omitted the demo-required booking source.
Only harness setup/selectors changed for these failures. Initial backend test failures were an audit
shape assertion and expecting HTTP 500 from a TestClient configured to raise exceptions; corrected
tests passed. One overlong legacy-hash fixture line failed Ruff, then formatting/checks passed.

## Data and scope

[Hash-only preservation baseline](../../backend/verification/b1-before-20261015.json) comparison passed:
every pre-existing row/column is unchanged. Additional development guest/reservation/room/history
records were reported and retained, not removed to force old counts. The harness wrote only its
random synthetic company in `hms_test` and cleaned only that company. Backend and browser suites ran
separately. No user-owned server or ZKBioTime environment/database was touched. Owned temporary
verification processes stopped normally. Alembic reports no drift and unchanged head `68f75a14d5a4`.

B1 files: backend reservation schemas/services and mutation hashing; legacy hash test and new
`backend/tests/test_initial_financials.py`; frontend API contracts/bridge, command context and original
ReservationPane; new `integration-tests/browser-initial-financials.mjs` / `run-initial-financials.py`;
backend contract, preservation/browser evidence and this handoff. Earlier changes in shared files
remain intact.

## Reproduce / stop point

From `HotelSystem`:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-initial-financials.py
npx vitest run src/app/api/manualDiscounts.test.ts src/app/api/reservationEditInput.test.ts src/app/api/useMutation.test.ts src/pages/DashboardPage.test.tsx src/components/reservations/ReservationDiscounts.test.tsx --maxWorkers=2
npm run lint
npm run build
```

Run PostgreSQL tests separately from browser harnesses, from `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_initial_financials.py tests/test_manual_discounts.py tests/test_breakfast.py tests/test_inclusions.py tests/test_billing_documents.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b1-before-20261015.json
```

**B1 meets its bounded acceptance criteria; no known B1 blocker remains.** The combined nightly
all-components case is API/PostgreSQL-tested, not separately browser-tested with every component
selected together. Full regression remains a later gate, not a claim made here. Restart an older
launcher normally and use `run-api.bat`; no migration/reseed required. B2 and all other parity work
remain unstarted by this batch and require separate authorization.
