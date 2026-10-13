# Version-checked reservation PATCH checkpoint

Date: 2026-10-13, Asia/Manila. Accepted baseline:
[Tuesday foundation/create-read checkpoint](backend-tuesday-checkpoint-2026-10-13.md).
Scope is strictly notes and adult/child counts. No commit or push; prior uncommitted work preserved.

## Implemented behavior

`PATCH /api/v1/reservations/{id}` requires UUID `Idempotency-Key`, a strict positive integer
`expected_version` and at least one of `note`, `adults`, `children`. Notes trim; blank intentionally
clears. Adults must be positive integers and children nonnegative integers. Booleans, fractional
counts, numeric strings, explicit null, missing versions and unsupported fields return 422.
Omitted fields remain unchanged. No room/date/source/status/pricing/audit inputs are accepted.

The existing service transaction owns commit. It takes the request-key advisory lock, checks
replay, exclusively locks the company-owned reservation and compares expected version. Stale
requests return 409 `version_conflict` with no changes or receipt. An update also includes the
version predicate in SQL, and version overflow fails explicitly instead of wrapping.

The request hash includes the target reservation UUID as well as the validated body. Identical
key/body/target replays the original committed response before testing the now-stale expected
version. Different body or target conflicts with 409 `idempotency_conflict`. Keys remain scoped
by company/operation, consistently with create. Original create hashes were not changed.

Successful new requests increment version exactly once, including equal-value submissions.
Replays increment nothing. Replay is the original operation result; after another edit, GET is
the current state and may have a newer version than the replayed response.

Only supplied count columns change on the existing allocation. Identity, room/duration links,
scheduled and actual instants, occupancy flag, captured unit rates/currency/quantities and every
historical pricing row remain intact. There is no pricing resolver call during PATCH.
Pricing's `reservation_version` stays its original capture provenance even when the reservation
version advances. Notes/counts have no accommodation price impact under current supported rules.

Each new accepted mutation writes one `reservation.updated` event with exact before/after version,
note, adults and children. Actor is server-owned `local-development`. Update/audit times use
PostgreSQL mutation-time `clock_timestamp()` rather than transaction-start `now()`, which could
precede a competing lock holder's update. Audit raw before/after is stored; existing GET audit DTO
continues to return event identity/actor/version/time summaries, preserving its transport shape.

Reservation/count writes, audit and receipt are one transaction. Canonical data is returned only
after commit succeeds. CORS now permits PATCH for the already configured local origins/headers.

## Changed files for this task

- `backend/app/modules/reservations/services.py`: exclusive lock option and atomic PATCH command.
- `backend/app/modules/reservations/router.py`: PATCH registration.
- `backend/app/modules/reservations/schemas.py`: edit contract description; validation retained.
- `backend/app/mutations.py`: optional target-bound hash, retaining original create hash behavior.
- `backend/app/main.py`: CORS PATCH method.
- `backend/tests/test_reservation_patch.py`: new PostgreSQL/HTTP tests.
- `backend/tests/test_reservation_api.py`: unsupported-empty PATCH now expects validation 422,
  replacing the former unregistered-route 405 expectation.
- `backend/scripts/http-smoke.py`: PATCH, GET and durable replay after real API process restart.
- `backend/README.md`, `backend/contracts.md`, current Mermaid diagram and this report.
- New timestamped verification JSON files; original evidence was preserved.

No schema migration, dependency change, frontend code change, seed rewrite or database reset.
Both databases remain at `82f79142cdbd`.

## Actual tests and results

| Check | Result |
|---|---|
| Accepted baseline before edits | 93 backend tests passed |
| Focused PATCH suite | 41 passed |
| Full backend suite including existing create/read | 134 passed |
| Frontend regression | 177 tests passed in 31 files |
| Frontend ESLint / build | Passed / passed |
| Ruff lint / format, dependency check | Passed |
| Alembic drift and preserved row comparison | No drift; preserved |
| Independent environment/database/file audit | Two isolated DBs; 153 pre-existing files unchanged |

The PATCH suite verifies successful PATCH/GET/list persistence, clearing/omission semantics,
stale rejection, simultaneous competing edits (one 200 and one 409), simultaneous identical-key
replays (one mutation), concurrent same-key/different-payload rejection, resource-bound keys,
ownership, all supported validation and rejection of out-of-scope fields.

Synthetic failures after allocation UPDATE, reservation UPDATE, audit INSERT and receipt INSERT,
plus a failure immediately before DB commit, return no success and roll back complete raw state
including updated timestamps, counts, version, audit, receipts and pricing. Retrying the failed
key succeeds. Raw pricing-row comparisons include a synthetic second historical revision and a
disabled/changed current rate, demonstrating that PATCH does not reprice or rewrite history.

Real loopback HTTP verification created a synthetic guest/booking, patched it, restarted its
Uvicorn process, then verified GET persistence and unchanged pricing, original create replay,
PATCH replay, changed-body conflict and stale-version conflict. Test records were created only
inside an isolated synthetic company in `hms_test` and cleaned afterward. Development business
data was not written. Temporary verification API processes were stopped.

Evidence: [HTTP restart/PATCH verification](../../backend/verification/http-smoke-20261013T004751Z.json)
and [environment/schema/count inventory](../../backend/verification/tuesday-foundation-audit-20261013T004759Z.json).
The 12-table/eight-reference-row baseline remains in both databases, with no retained business
records. PostgreSQL remains running. Existing non-failing TestClient deprecation and frontend
bundle-size warnings remain; no warning suppression or unrelated upgrades were added.

Run from `HotelSystem/backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 -m pip check
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/http-smoke.py
& .\scripts\python.ps1 scripts/audit-foundation.py
```

Example request after starting the existing local API:

```http
PATCH /api/v1/reservations/{reservation-uuid}
Content-Type: application/json
Idempotency-Key: {new-request-uuid}

{"expected_version":1,"note":"Arriving late","adults":2,"children":0}
```

## Architectural concerns and stop point

No blocker for this bounded PATCH. Development-only actor attribution is still not authenticated
staff identity; the service is not approved for public production deployment. Existing row and
advisory lock timeouts can return safe retryable 503 under prolonged contention. Future room
reassignment/lifecycle commands must review lock order rather than extend this PATCH implicitly.
Current services preserve pricing history, but this is not an immutable accounting ledger.

Frontend stays in memory/demo mode. Room reassignment, repricing, lifecycle actions, persistent
frontend integration, native accounting and Odoo were not added. Stop at this verified PATCH;
the user has not authorized a commit or push.
