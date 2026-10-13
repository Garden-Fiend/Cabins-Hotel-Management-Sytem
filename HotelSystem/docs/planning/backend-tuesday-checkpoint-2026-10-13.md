# Tuesday backend checkpoint — 13 October 2026, Asia/Manila

Scope: audit Monday, complete Section 3 Tuesday foundation, then begin the explicitly permitted
Wednesday atomic create/read slice once its database gate passes. This checkpoint was reached
early in the morning session; it does not claim that four hours elapsed or that afternoon work ran.
Frontend integration, edit/lifecycle commands, accounting and Odoo remain outside this checkpoint.

## Monday audit: observed results

- `main` starts at pushed commit `ae5f4f5`. Existing modified frontend/package files and untracked
  tests, reports, plan and research documents were preserved. No reset, commit or push this turn.
- The backend was a real scaffold with two frozen migrations, explicit reference seed, isolated
  SQLAlchemy connections and health endpoints. It had no business DTOs, services or booking API.
- Project Python is 3.12.0; the base interpreter is
  `C:\Users\Malala\AppData\Local\Programs\Python\Python312`, not ZKBioTime. The wrapper clears
  inherited Python variables only in the child command process. Dependency checks passed.
- Docker Desktop's Linux engine was stopped at audit start, causing initial migration/test checks
  to time out. Normal startup recovered the existing `hms-local-foundation` container/volume.
  No volume recreation, database deletion or connection to native PostgreSQL occurred.
- Both `hms_dev` and `hms_test` were at `032f6c7afbbd`, each with 12 tables and eight reference rows.
  Monday's 24 backend tests then passed again; Alembic reported no schema drift and the preserved
  row comparison passed. Historical notes were not treated as newly executed evidence.
- Audit found missing occupancy counts, enabled duration/source flags, rate/duration-kind
  compatibility, captured pricing DTOs and explicit audit/pricing version provenance.
- PowerShell's wrapper treats short pip `-e` as an ambiguous common parameter. Setup documentation
  now uses verified `--editable`. The editable package was refreshed with normal isolated build
  dependencies; the existing installed tzdata is now an explicit project dependency.

## Tuesday foundation completed

The new frozen additive migration `82f79142cdbd` upgraded both existing databases:

- Positive adult/nonnegative child counts, finite scheduled intervals and descriptive room-type
  capacity. No new capacity ceiling was invented; counts are explicit request data.
- Enabled duration and booking-source flags; a composite FK ensures an hourly rate references
  an hourly duration belonging to the same company. Monday's ownership and active-rate indexes
  remain in force.
- Asia/Manila hotel-policy check and valid local wall-clock times below 24:00.
- Reservation updated time, pricing captured reservation version and optional audit version.
- CHECK constraints are explicitly included in the migration: Alembic autogenerate did not
  discover them. Old migrations were not rewritten. No downgrade was run.

Reference UUIDs are deterministic and seeding is explicit. Repeated commands preserve existing
values. Only primary identity conflicts can replay; other unique conflicts abort the whole seed
instead of silently omitting a definition. No guest/reservation fixtures are auto-seeded.

Strict Pydantic DTOs define single-room direct create/read and a future expected-version
note/count edit contract. Clients cannot set totals, company, status, audit actor, physical
occupancy or unsupported extras/discounts. Money is integer PHP centavos, bounded by the
frontend's exact integer range; decimal boundary rounding is half away from zero. Timestamps
must be offset-aware ISO values, have at most microsecond precision, and normalize to UTC
without rounding. Naive values, numeric epochs and overflow are rejected.

Hourly packages charge once. Overnight charges use configured nights, and checkout is the
hotel-local arrival date plus that count at the configured checkout time. Explicit arrival
time is preserved; the check-in default is not silently imposed on it.

The foundation gate passed before reservation endpoints were enabled, including two independent
PostgreSQL transactions racing on an identical room interval. Raw GiST inserts can reject the
loser via exclusion error or deadlock-victim rollback. The application also locks the room first
to serialize decisions and return a predictable conflict.

## Early Wednesday slice completed and verified

Implemented endpoints:

| Endpoint | Behavior |
|---|---|
| GET `/api/v1/live`, `/api/v1/health` | Process/database health |
| GET `/api/v1/reference-data` | Company-scoped, consistently read reference configuration |
| POST `/api/v1/guests` | Independent, audited, idempotent guest creation |
| GET `/api/v1/guests` | Scoped, bounded list and literal substring search |
| POST `/api/v1/reservations` | Server-priced, single-room direct create |
| GET `/api/v1/reservations`, `/{id}` | Scoped canonical reads with captured price/version/audit |

Both POST endpoints require a UUID `Idempotency-Key`. The server chooses company context and
actor `local-development`; this is not authenticated staff attribution. Business routes fail
closed outside development settings. CORS permits only configured local origins, GET/POST and
the implemented headers. The guarded database URL now also rejects driver query overrides.

`ReservationService` owns `Session.begin()`. A transaction-scoped advisory lock serializes a
company/operation/request key, checks its canonical request hash and replays the original saved
response. Room row locking precedes availability decisions; PostgreSQL exclusion remains the
final overlap guard. Physical occupancy locks block even a future booking, independent of the
prior scheduled checkout. Dirty housekeeping is not silently treated as occupancy or check-in.

One commit includes reservation, allocation, operational pricing revision, audit and receipt.
Failed commands retain no partial booking or receipt. Independent guests remain independent.
The response is returned only after commit. Prices, captured labels, unit amounts, quantities,
currency, calculation/schema versions and explicit `tax_status=not_configured` are saved together.
Changing configuration does not reprice saved records. Current services never modify captured
revisions; this is not database-enforced journal immutability or tax/accounting implementation.

## Actual verification

| Check | Result |
|---|---|
| Monday audit suite after Docker recovery | 24 passed |
| Final backend PostgreSQL/unit/API suite | **93 passed** |
| Concurrent HTTP, distinct keys / same interval | One 201, one 409; one complete aggregate |
| Concurrent HTTP, identical key/body | Same 201 response; one aggregate and one booking receipt |
| Fail after reservation/allocation/pricing/audit/receipt insert | Entire booking rolled back; same-key retry succeeds |
| Forged authoritative totals/status/company/audit | 422, no booking writes |
| Hourly and two-night prices, year boundary, UTC precision, zero rate | Passed |
| Physical occupancy lock, inactive references, history after rate/label change | Passed |
| Real loopback HTTP create, process restart, read and identical-key retry | Passed in `hms_test` |
| Alembic upgrades/current/drift | Both at `82f79142cdbd`; no new upgrade operations |
| Reference seed twice and preserved pre-existing row comparison | Passed |
| Ruff lint/format and dependency check | Passed |
| Frontend Vitest / ESLint / production build | **177 tests passed** / passed / passed |
| Pre-existing file fingerprints | **153 files unchanged** |

Actual HTTP evidence:
[restart/replay verification](../../backend/verification/http-smoke-20261013T003316Z.json).
Read-only environment/schema/count evidence:
[foundation inventory](../../backend/verification/tuesday-foundation-audit-20261013T003314Z.json).
Test logs are local ignored artifacts, not fabricated screenshots or rewritten historical results.

The initial extended test run exposed a missing test import (corrected) and the raw exclusion
deadlock outcome described above; final results are the subsequent successful runs. Existing
non-failing warnings remain: Starlette/httpx TestClient deprecation and frontend >500kB bundle.
No dependency upgrade or warning suppression was used to manufacture a pass.

All synthetic HTTP/concurrency records were scoped to newly generated companies in `hms_test`
and cleaned after verification. Both databases retain the eight reference rows with zero business
records. PostgreSQL identity sequences may advance during test inserts/rollbacks; sequence gaps
are expected and were not reset. No existing row values were overwritten. PostgreSQL remains
running; the temporary HTTP verification processes were stopped.

## Files and commands

Modified backend models/settings/main/seed, pyproject, README/contracts and preservation checker;
added `context.py`, `errors.py`, `mutations.py`, reservation schemas/pricing/references/router/service,
the third migration, three new test modules and scoped test fixtures. Added audit/HTTP-smoke scripts
and JSON evidence. Updated the current Mermaid diagram; added this checkpoint. No frontend code,
package files, original reports, implementation plan or research was changed.

From `HotelSystem/backend`:

```powershell
docker compose up -d --wait postgres
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m app.seed
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 -m pip check
& .\scripts\python.ps1 scripts/audit-foundation.py
& .\scripts\python.ps1 scripts/http-smoke.py
& .\scripts\python.ps1 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

With the server running, visit `http://127.0.0.1:8001/docs`. Reference reads provide the UUIDs
needed by the guest/booking POST requests. The frontend still uses its in-memory demo and does
not call these endpoints. No developer booking was left in either database merely for a demo.

## Readiness, blockers and afternoon handoff

**The first reservation write is safe for the supported local-development slice and has already
been implemented and verified.** There is no remaining environment blocker. This is not
production readiness: authentication, least-privilege deployment and backup/restore remain work.

Afternoon first task: review this create/read checkpoint and add targeted resilience work under
the same scope if a gap is found. The next planned business implementation is **version-checked,
idempotent PATCH**, preserving captured pricing for note/count-only changes and testing stale
updates and rollback before registration. It is not implemented at this checkpoint.

Frontend persistent-mode integration remains Thursday work; check-in/out/cancel/no-show remain
Friday work. Advanced discounts, extras, multi-room/custom bookings, OTA settlements, native
accounting, Odoo and hosted deployment were not implemented. No commit/push was requested for
Tuesday, so this checkpoint is left as a reviewable worktree diff.
