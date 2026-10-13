# Room operational status correction

Date: October 13, 2026, Asia/Manila. Authorized by the user's request to implement this without extensive restructuring. No commit or push. Existing uncommitted work was preserved.

## Implemented and verified

The dedicated **Rooms ? Add room** form keeps its original automatic Operational default and has no new status selector. Its default now matches the API presentation IDs. Original Operational, Housekeeping and Maintenance choices persist through the Rooms inline selector and Configuration room editor. Dedicated edit/reopen preserves the status and optional room fields. Readiness remains independently Clean/Dirty/Cleaning.

The additive `54e8c2a17d90` migration follows unchanged `3b36715627c4`. Both owned databases are at the new head: seven revisions, still 14 HMS tables. A checked text enum records room operational status and a second check keeps its existing booking-eligibility boolean consistent. Existing false rooms become legacy Unavailable because their original reason was never captured. No original column, pricing capture, assignment, occupancy pointer or historical record is rewritten. Downgrade was not executed and would discard the newly recorded status reasons.

Configuration commands retain versions, ownership, audit, request-key receipts and transactional commit. Explicit null, unknown states and contradictory supplied booleans reject. Older boolean-only commands retain their original request hashes; old receipt responses remain readable without rewriting stored JSON. `room.status.v1` gates the original inline selector. Legacy Unavailable is visible only where needed and cannot be selected as a new Rooms inline choice.

The existing backend active-assignment guard remains: making a room with an active assignment unavailable returns an explicit error. Demo's existing behavior remains independent and unchanged. This correction does not expand that policy, add configurable status definitions, or change archive/delete support.

## Actual verification

- Full PostgreSQL backend suite: **252 passed**. Includes distinct status storage, version advancement, exact replay, changed-body key conflicts, invalid/no-write cases, database checks and historical hash/receipt compatibility. The existing booking rejection test now supplies a consistent Maintenance/false pair and still verifies unavailable rooms reject creation.
- Existing frontend suite: **193 passed in 35 files**. ESLint and production build passed. Existing non-failing TestClient deprecation and frontend bundle-size warnings remain.
- Ruff lint/format, dependency consistency, Alembic drift and `git diff --check`: passed.
- [Real browser results](../../booking-tests/reports/20261013T081156Z-rich-api-integration/results.json): **18 checks passed**, including dedicated API create/reset/reopen/edit, blank optional fields, failed-save draft/no-phantom/retry, all three inline statuses, Configuration status persistence, and demo create/edit/reset/status changes with zero backend calls. Other existing reservation, catalog, billing and lifecycle checks also passed.
- [PostgreSQL/restart evidence](../../booking-tests/reports/20261013T081156Z-rich-api-integration/postgres-verification.json): synthetic reservations/reference changes survived a real API process restart; historical captured prices remained intact. Only the synthetic company in `hms_test` was removed afterward. Development business data was not written by the harness.
- [Environment inventory](../../backend/verification/current-integration-audit-20261013T080759Z.json): owned Python, separate development/test databases, UTC and migration heads verified.
- [Fresh hash-only preservation baseline](../../backend/verification/room-status-before-20261013.json): all pre-existing rows and columns matched after migration/testing. The comparison also reported one additional development room, audit and receipt, retained without alteration; no test rows remained in `hms_test`.

The two earlier browser failures remain preserved. They were test-selector errors involving native labels containing select options/textarea text; final assertions select those original controls correctly rather than changing the UI to fit the test.

## Files and execution

Backend: room model/reference DTO and capability; configuration schema/service; compatible hash exclusion in `mutations.py`; additive migration; configuration/reservation tests; current environment audit. Frontend: API contracts, presentation/status mapping, definition inputs, bridge/store capability and the original Rooms inline handler. Browser harness, README, contracts, architecture diagram and planning handoff were updated. No dependency, seed, accounting or unrelated feature changes.

Restart an older launcher normally, then run from `HotelSystem`:

```powershell
.\run-api.bat
```

Both databases have already been migrated. Existing user-owned servers were not stopped; an older API process must be restarted to serve the new capability and DTOs. The launcher continues to open API mode on 5173 and demo mode on 5174.

Verification commands:

```powershell
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
```

Run the backend suite separately from the browser synthetic-company harness, from `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/room-status-before-20261013.json
```

No unresolved blocker for this correction. Future discounts and broader parity work require their own authorized scope.
