# Wednesday Session 2 checkpoint

Date: October 14, 2026, Asia/Manila. Baseline: [Session 1 handoff](session-one-handoff-2026-10-14.md).
Existing uncommitted work and earlier evidence preserved. No commit/push, dependency installation,
database reset, fixture import, accounting or Odoo implementation.

## Inclusion regression gate — passed before breakfast work

- Complete PostgreSQL suite: **312 passed**.
- Complete frontend: **204 passed in 38 files**; TypeScript, ESLint and production build passed.
- Ruff lint/format, Alembic drift and preservation checks passed.
- Rich browser: **26 checks passed**, followed by real API restart and SQL verification.
  [Gate evidence](../../booking-tests/reports/20261014T051720Z-rich-api-integration/results.json).

Additional development records were reported and retained, not removed to restore historical counts.
Backend and synthetic browser suites ran separately. No repeated architecture audit or earlier focused
inclusion browser run was required. Rare inclusion boundary coverage listed in Session 1 remains
distinct from this passing full regression gate.

## Breakfast implementation

Protected `special-breakfast` identity is a virtual view over existing catalog products, not another
meal-product table. Eligible meal/beverage definitions have owned relational references and a company
configuration version. Ordinary selling prices remain independent. Original Inventory dialog and
both existing Configuration widgets save/review eligibility; no UI replacement was introduced.

Original reservation controls support optional included/skipped/unrecorded choices per assigned
adult/child and nightly hotel service date. Server-owned captures retain recipe IDs, historical labels,
quantity one and exact zero amounts. Separately purchased meals use existing ordinary purchase lines
and captured prices. Pure breakfast edits preserve all pricing revisions; mixed supported edits use
the existing transaction. Counts/stay changes reconcile out-of-scope selections. New selections enforce
current eligibility; unchanged historical recipes survive retirement. No serving/stock/payment ledger
is implied.

Create, explicit `edit-breakfast` and stay commands validate fields, company ownership and dates.
Mutation versions, durable key replay, server audit and rollback remain enforced. Failed UI saves keep
drafts. Reviewed retries retain untouched remote choices; local choices excluded by reviewed counts/
dates produce an explicit error instead of silent loss. Historical omitted-field request hashes remain
compatible. Original note/count PATCH accepts no breakfast input but reconciles selections on count changes.

Two application defects discovered and fixed: skipped-to-included transitions retained empty recipe IDs
despite displayed dropdown options; reviewed smaller guest counts could silently discard a local edited
breakfast. The first now uses existing eligible defaults; the second retains the draft with an error.
The original layouts/default unrecorded state and independent demo mode remain intact.

## Actual final verification

| Check | Result |
|---|---|
| Complete PostgreSQL suite | **342 passed**, including 30 breakfast cases |
| Complete frontend suite | **208 passed in 39 files** |
| TypeScript, ESLint, production build | Passed |
| Ruff lint/format, dependency consistency | Passed |
| Alembic drift | None |
| Breakfast browser + SQL/restart | **7 checks passed** |
| Rich regression browser + SQL/restart | **26 checks passed** |
| Final preservation comparison | Every pre-existing row/column unchanged |

Breakfast tests cover dates/Manila boundaries/midnight checkout, guest limits, strict input rejection,
ownership/FKs, protected virtual identity, zero amounts versus paid purchases, captured labels/prices,
clear/skip, replay/stale/key conflicts, concurrent edits/replays, count/stay reconciliation and full
reservation/configuration stage-by-stage rollback/retry. The frontend guard has a dedicated regression.

[Breakfast browser evidence](../../booking-tests/reports/20261014T060344Z-breakfast-api/results.json)
and [SQL/restart verification](../../booking-tests/reports/20261014T060344Z-breakfast-api/postgres-verification.json)
cover Inventory eligibility/retry, both Configuration widgets including stale/review handling, Dashboard
nightly create, expanded-detail recipe/purchase edits, historical labels after product rename, reservation
409 review preserving a remote choice, calendar create/summary edit/clear, print and independent demo
eligibility with zero API calls. Two synthetic bookings and three historical pricing rows survived restart.
[Rich regression](../../booking-tests/reports/20261014T055728Z-rich-api-integration/results.json) independently
rechecked established booking/configuration/billing/lifecycle/demo workflows. Original traces/videos remain.

The [failed first breakfast browser run](../../booking-tests/reports/20261014T054444Z-breakfast-api/results.json)
is preserved: three checks passed, then an included recipe was rejected with empty IDs (422).
A new frontend regression initially reproduced silent quota loss, then passed after the guard.
Intermediate backend failures were test-helper duplicate arguments/missing imports and a legacy-hash
fixture needing exclusion of the new optional field; they were corrected without changing old hashes.
A one-line Ruff formatting failure was corrected. Existing TestClient/bundle-size warnings remain.

## Migration, preservation and files

Both databases are at additive `9d54e702b816`: **eleven revisions, 16 HMS tables**. It adds company
breakfast version, owned eligibility, allocation captures and protected category initialization.
Existing selections remain empty; no retrospective entitlements/products were fabricated. Existing
extra/inclusion identities remain unchanged. Downgrade refuses unreviewed data removal; none was run.
[Hash baseline](../../backend/verification/breakfast-before-20261014.json) and
[final inventory](../../backend/verification/current-integration-audit-20261014T061204Z.json) verify preservation
and isolation. Synthetic test companies were cleaned; development business data was not written by tests.
No user-owned server or ZKBioTime environment/database/storage was used or terminated.

New: configuration/reservation breakfast helpers, migration, backend tests, frontend input helper/tests,
focused breakfast browser/runner, preservation evidence and this checkpoint. Modified: concrete models/
DTOs/references/routes/create/stay/billing/PATCH reconciliation/hash compatibility; original eligibility
editor, Inventory/Configuration/ReservationPane and typed API adapters/context; owned cleanup; README,
contracts and Mermaid diagram. Earlier discounts/extras/inclusions remain in overlapping files.

Run from `HotelSystem` after normally restarting an older launcher:

```powershell
.\run-api.bat
& .\backend\scripts\python.ps1 integration-tests/run-breakfast.py
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
npm test -- --maxWorkers=2
npm run lint
npm run build
```

Run PostgreSQL separately from browser harnesses, from `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/breakfast-before-20261014.json
```

The owned databases were already migrated; no reset/reseed is needed. Other checkouts must apply the
new revision explicitly. Fresh-empty-database/backup-restore rehearsal was not performed this session.

## Thursday first tasks and limits

1. Extend browser boundary coverage for retired captured recipes, count/stay pruning and reviewed quota
   conflicts, protected breakfast/inclusion rename/collisions and remaining combined inclusion edits.
   Backend coverage exists for several; do not call them separately browser-verified yet.
2. Rehearse the complete migration/explicit seed and backup/restore path in an independently isolated
   disposable target with reviewed target guards. Never reset/reuse the existing databases for rehearsal.
3. Review remaining parity priorities; recommend discount preset configuration/selection as the next
   bounded feature once authorized. It must preserve captured prices and distinguish final-price offers
   from sequential manual reductions. No next feature was started here.

Still unsupported/incomplete: presets/final-price overrides, multi-room/custom stays, OTA/source/settings
financial workflows, collections/payments/refunds/settlements, full history presentation, room/type
archive/deletion controls, stock tracking, authenticated staff/public deployment, accounting and Odoo.
No known blocker remains for the implemented direct single-room nightly breakfast slice. This is
verified local operational functionality, not production certification or completed overall parity.
