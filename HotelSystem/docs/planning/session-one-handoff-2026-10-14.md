# Wednesday Session 1 handoff

Baseline: [focused inclusion checkpoint](inclusions-checkpoint-2026-10-14.md).
Final-hour scope: outstanding inclusion verification only. No commit/push, dependencies,
schema changes, resets, breakfast implementation or complete regression reruns.

## Newly verified

**Six remaining browser checks passed**, followed by PostgreSQL verification and a real API
restart. One synthetic booking retained default-zero/manual quantities and its original single
pricing revision after restart. Verified paths:

- Configuration room-type default clear, empty reopen and explicit re-add.
- Dedicated Rooms default clear/edit/reopen, and cancellation/reset of unsaved add-form defaults.
- Generic Configuration inclusion-product creation with exact price metadata and non-sellable classification.
- Calendar empty-cell creation: automatic defaults, network failure/draft retention, no phantom
  booking, retry and refresh persistence.
- Calendar summary Edit: zero default override/manual quantity, reopen, preserved provenance,
  unchanged pricing and no version increment for a no-op save.
- Inventory inclusion-product archive/restore, with an intervening generic Configuration price edit.

Evidence: [browser results](../../booking-tests/reports/20261014T025037Z-inclusions-remaining/results.json),
[SQL/restart results](../../booking-tests/reports/20261014T025037Z-inclusions-remaining/postgres-verification.json),
trace/video/screenshot in that directory. Setup used API-created synthetic definitions; the paths
listed above were exercised through the original React controls. Archive/restore covered an unused
inclusion product, not a default already captured in a booking.

## Confirmed defect fixed

Generic Configuration omitted noneditable `archived` metadata, and the API definition adapter
converted omission into `false`. Editing an archived inclusion therefore cleared its archive flag.
The adapter now preserves the existing flag when omitted; explicit Inventory restore still clears it.
Also corrected the stale Rooms notice that said inclusion defaults were unavailable.

The failed [initial remaining run](../../booking-tests/reports/20261014T024904Z-inclusions-remaining/results.json)
is preserved: its first five checks passed, then the archived-flag assertion expected `true` and
received `false`. It was not relabeled. The final rerun passed all six checks and restart verification.

Focused adapter regression: **6 tests passed in 2 files** (inclusion inputs and extra-charge inputs).
TypeScript, ESLint on the three changed frontend files, runner Ruff/format and diff whitespace
passed. The accepted earlier 80 backend/20 frontend/six-browser results were not rerun wholesale.
No backend business logic changed in this final-hour task.

After cleanup, the hash-only preservation check passed for every original row/column. Both
databases remain at `8c21a6f4d903`. Development records and existing uncommitted work were retained;
only the harness-owned test company was cleaned. User-owned servers and ZKBioTime were untouched.

## Reproduce

From `HotelSystem`:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-inclusions.py --remaining
npx vitest run src/app/api/inclusionInputs.test.ts src/app/api/extraCharges.test.ts --maxWorkers=2
npx tsc -b
npx eslint src/app/api/definitionInputs.ts src/app/api/inclusionInputs.test.ts src/pages/RoomsPage.tsx
```

The browser command now exercises the corrected behavior; the preserved failed report records
the pre-fix outcome. New runner mode uses fresh synthetic data and refuses occupied verification
ports; do not run it alongside the PostgreSQL suites or another browser harness.

Changed for this task: API definition adapter and its inclusion test, Rooms informational notice,
new `browser-inclusions-remaining.mjs`, bounded `--remaining` mode/restart assertions in
`run-inclusions.py`, timestamped evidence and this handoff. Earlier checkpoints remain historical.

## Session 2

**Inclusions are ready for full regression verification. No known inclusion blocker remains.**
Begin with the complete PostgreSQL suite, then frontend tests/lint/build and the rich browser/SQL
restart suite, keeping backend/browser suites separate. Validate fresh-database migration/seed
compatibility if using an additional disposable target; do not reset the existing databases.

Remaining focused coverage gaps: demo calendar/default-clear comparison; archived/disabled products
already used as defaults or captured selections through the browser (backend cases exist); combined
stay/financial/inclusion edits with competing remote inclusion changes; historical labels after
definition rename; protected inclusion-category rename/name collision through Inventory. Earlier
backend tests cover several of these boundaries, but they are not separately browser-verified.

Review failures/contract mismatches before adding features. Breakfast remains off-limits until
inclusion regression results are accepted. Wednesday development continues in the separate
four-hour Session 2; this is the Session 1 stopping point, not the end of the day's work.
