# Room-type inclusions focused checkpoint

Date: October 14, 2026, Asia/Manila. Continued Session 1 with the user's two-hour/limited-usage
budget. Baseline: [special extras](extra-charges-checkpoint-2026-10-14.md). Prior uncommitted
work and both previous Wednesday checkpoints were preserved. No commit/push, dependency
installation, reset, fixture import or breakfast implementation.

## Implemented

Inclusion definitions share catalog product storage under protected `special-inclusions`
identity, `type=inclusion`, system-defined/enabled. Rename remains available; archive/delete/
reclassification of the category do not. Ordinary matching names coexist without data conversion.
Inclusions are nonfinancial entitlements: product price metadata is never a reservation charge.

Room-type default lists persist in an ordered, owned relational table with composite company
foreign keys, unique type/product identity and positive quantities. Definition saves replace the
list atomically with type version, audit and receipt. Omission preserves; explicit empty clears.
Inactive retained defaults remain configured but are skipped for new assignments. Referenced
products cannot be reclassified until their room-type defaults are removed.

New assignments capture current active defaults on the server. Create accepts manual additions
and explicit default overrides, including zero and same-value overrides; automatic frontend
defaults are omitted so they cannot replace unseen current server defaults. Saved allocation
captures retain product IDs, labels, quantities, manual/default source and override flags.
Source/labels/prices cannot be supplied by clients. Configuration edits do not rewrite captures.

Room-type reconciliation mirrors `src/lib/roomTypeInclusions.ts`: manual entries survive, obsolete
defaults disappear, new active defaults apply, and positive overridden quantities survive only
for shared defaults. A zero override resets when the default is reapplied on a type switch.
Same-type room transfers and duration/arrival changes preserve selections.

`POST /api/v1/reservations/{id}/edit-inclusions` supports versioned/idempotent inclusion edits
with existing supported note/count/guest and optional charge/adjustment/discount changes.
Inclusion-only edits advance reservation version once without changing pricing or appending
a pricing revision. Mixed financial edits remain one existing billing transaction. Stay edits
also persist/reconcile inclusions atomically. Server audit captures actual before/after facts.
Stale versions and changed-key bodies reject; failed commands roll back and retain drafts.
Reviewed retries merge locally changed selections while retaining untouched remote additions.

Original Inventory, Configuration room-type defaults, Rooms room-type defaults and ReservationPane
controls are connected. Zero/default provenance is retained when reopening API snapshots. Demo
helpers and fixture semantics remain unchanged. `reservation.inclusions.v1` gates inclusion controls;
breakfast remains disabled. No frontend redesign or additional billing category was introduced.

## Database and preservation

Additive migration `8c21a6f4d903` follows unchanged `7b90f132ae64`. Both isolated databases are
at this head: ten revisions, 15 HMS tables. It adds the default relation, product ownership key,
allocation JSON captures and protected category initialization. Existing allocations receive
an empty capture; historical entitlements are not inferred. The existing company-initialization
function retains extra initialization and adds inclusion metadata. No demo products are imported.
Downgrade fails explicitly pending a reviewed data plan; none was executed.

Final [hash preservation comparison](../../backend/verification/inclusions-before-20261014.json)
passed for every pre-existing row/column. After synthetic cleanup, each database has one new
protected category and an empty new default table. Existing development business records remain
intact. [Final environment inventory](../../backend/verification/current-integration-audit-20261014T023449Z.json)
verifies owned Python, separate databases, UTC and current heads. ZKBioTime was not used.

## Actual focused checks

| Check | Result |
|---|---|
| Inclusion + configuration + manual-discount PostgreSQL files | **80 passed**, including 20 inclusion cases |
| Inclusion adapters, demo reconciliation, edit adapters, extras and manual-discount frontend files | **20 passed in 5 files** |
| Focused original-control browser harness | **6 checks passed**, plus actual PostgreSQL verification |
| TypeScript `tsc -b` and ESLint on affected frontend files | Passed |
| Backend Ruff lint/format, migration drift and diff whitespace | Passed; no drift |
| Preservation after tests/browser cleanup | All original rows/columns unchanged |

Backend cases verify default persistence, empty/omitted behavior, captured selection/price history,
manual/shared-default reconciliation, zero reset, explicit same-value overrides, ownership, strict
validation, inactive definitions, initial override merging, stale/key conflicts, competing edits,
identical-key replay, mixed discount/adjustment saves and complete rollback/retry. Default replacement
failures after type UPDATE, child DELETE/INSERT, audit/receipt INSERT and before commit preserve
the original list/version/audit/receipts. Inclusion-edit failures after allocation/reservation/audit/
receipt writes and before commit preserve the aggregate, including pricing.

Browser evidence: [six assertions](../../booking-tests/reports/20261014T023240Z-inclusions-focused/results.json),
[PostgreSQL verification](../../booking-tests/reports/20261014T023240Z-inclusions-focused/postgres-verification.json),
trace/video/screenshots in that directory. Verified paths are Inventory product creation;
Configuration existing-type defaults with failed-save retention/retry/reopen; dedicated Rooms type
creation/defaults/reopen/reset; Dashboard reservation creation with defaults; expanded-detail manual
quantity edits, network retry and 409 review preserving a remote addition; room reassignment with
positive override/manual preservation; document inclusion display. Demo dedicated type/default
creation succeeds independently with zero API calls.

The focused browser created one synthetic reservation with two pricing revisions. Inclusion-only
edits retained its original pricing; explicit reassignment captured the new accommodation rate.
Only the harness-owned company was cleaned from `hms_test`. No development business writes or
user-owned process termination occurred. Earlier failed focused frontend assertions exposed
incomplete legacy test snapshots; the adapter now tolerates absent historical inclusion arrays.
No failed evidence was relabeled. Existing TestClient deprecation warning remains.

**Full PostgreSQL/frontend/browser regressions and production build were not rerun in this session.**
Calendar empty-cell/summary edit inclusion paths, generic catalog inclusion entry, inclusion archive/
restore, room-type clear/edit/reset combinations across both editors, focused browser restart and
broader lifecycle/discount/history compatibility remain Session 2 verification targets. Current
focused results do not establish complete cross-entry-point parity or production readiness.

## Changed files and commands

New: backend inclusion helper, migration and `test_inclusions.py`; frontend inclusion input helper/
tests; `integration-tests/run-inclusions.py` and `browser-inclusions.mjs`; hash baseline/inventory;
this checkpoint.

Modified: backend models, configuration schemas/services, reservation schemas/references/create/
stay/router, existing billing transaction and compatible request hashing, owned fixture cleanup
and historical hash expectation; frontend contracts/client/provider/bridge/edit/definition/
presentation adapters, command context, original ReservationPane/Configuration/Rooms controls;
rich harness cleanup; backend README/contracts and Mermaid diagram. Existing manual-discount and
extra-charge implementations were retained in overlapping files.

From `HotelSystem/backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres tests/test_inclusions.py tests/test_configuration_api.py tests/test_manual_discounts.py -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/inclusions-before-20261014.json
```

From `HotelSystem`:

```powershell
npx vitest run src/app/api/inclusionInputs.test.ts src/lib/roomTypeInclusions.test.ts src/app/api/reservationEditInput.test.ts src/app/api/extraCharges.test.ts src/app/api/manualDiscounts.test.ts --maxWorkers=2
npx tsc -b
& .\backend\scripts\python.ps1 integration-tests/run-inclusions.py
```

Restart an older launcher normally and use `./run-api.bat` for current code. Both owned databases
were already upgraded; no reset/reseed is required. Other checkouts must explicitly apply the new
revision. Run backend and browser synthetic-company suites separately.

## Session 2 first task

Verify inclusion defaults/overrides through calendar empty-cell creation and calendar summary Edit,
then complete the remaining entry-point/clear/archive/restart cases above and run the complete
backend/frontend/browser regressions plus lint/build. Review any contract mismatch before expanding
scope. Breakfast remains off-limits until inclusion verification is accepted. No accounting,
payments, multi-room, stock tracking or authenticated production actor was added.
