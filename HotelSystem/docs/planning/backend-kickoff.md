# Backend kickoff — Monday, 12 October 2026 (Asia/Manila)

Executed **Section 2 — TODAY** of [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md).
This is a verified foundation checkpoint, **not completed reservation persistence**.

## Baseline and isolation

- Branch: `main`; base revision `c0d25a5bc06f689d2ef2d9653b1ec9b787595ebd`.
- The worktree already contained modified package files, calendar/reservation/room fixes, tests,
  reports, planning/research documents and the untracked implementation plan. Nothing was reset,
  discarded, committed or rewritten. 153 pre-existing non-generated files were hashed;
  comparison found zero changes. [Baseline/status evidence](../../backend/verification/status.json).
- Frontend store still initializes React state from fixture arrays in
  `src/app/ReservationDemoContext.tsx`. Pages still use local setters; the shared reservation pane
  builds full snapshots and calls currently synchronous save callbacks. No API integration or
  persistent mode was added; the existing demo's behavior is preserved.
- Initial PATH Python/psql belonged to ZKBioTime. Neither executable was used. The independently
  installed Python at `C:\Users\Malala\AppData\Local\Programs\Python\Python312` created the project
  `.venv`. Inherited Python environment variables initially redirected imports to incompatible
  ZKBioTime libraries; clearing them **inside the HMS command process only** resolved this.
  No packages were installed into ZKBioTime and no native/ZKBioTime database was contacted.
- Docker Desktop was installed but its Linux engine was stopped. Normal Docker startup succeeded.
  The dedicated Compose project created its own container, network and named volume. PostgreSQL
  is bound only to **127.0.0.1:55432**, independent of native PostgreSQL ports.

## Week 1 scope and ownership

Single-room direct bookings, one company, PHP, seeded read-only reference configuration and
server-owned pricing. Independent guest creation is retained. Multi-room/custom stays, OTA
settlements, advanced discounts, extras, authentication, native accounting and Odoo are deferred.
Persistent-mode unsupported actions must later be disabled and server-rejected; API errors must
never cause fallback to fixtures. Today there is no persistent frontend mode to falsely save data.

Module boundaries:

| Boundary | Today | Later |
|---|---|---|
| `reservations` | Guests, types, rooms, durations/rates, sources, reservations/allocations schema | Authoritative pricing, guest/reservation commands, lifecycle |
| `billing` | Captured operational pricing revision schema | Supported charges/finalized documents/payments in later scope |
| Core | Company context, DB/settings, operational audit, mutation receipt storage | Trusted identity/deployment configuration after approval |
| `accounting` | No implementation | Accounts/journals/posting/reconciliation; explicit posting only |
| `integrations` | No implementation | Optional adapter-owned external IDs/sync, never core Odoo dependency |
| `reporting` | No implementation | Read models derived from authoritative operational/posted data |

No empty accounting/adapter frameworks were created. SQLAlchemy Core models share one metadata
and private `hms` schema; schema ownership is explicit in module files. Alembic is the migration
authority. [Command/API contracts](../../backend/contracts.md) specify planned guest/reference
reads, independent guest creation, reservation POST/GET/PATCH, expected versions, idempotency,
server pricing/errors and atomic reservation/allocation/pricing/audit/receipt boundaries.

## Implemented and verified

- FastAPI application, validated/redacted settings, project-owned environment, SQLAlchemy engine
  and per-request session setup; explicit transaction ownership for future services.
- `/api/v1/live`: process health. `/api/v1/health`: real database connectivity; returns 503 and
  redacted unavailable state on connection failure. No startup migration or seed side effects.
- Isolated PostgreSQL **17.6**, database **hms_dev**, separate database **hms_test**.
  Container: `hms-local-foundation-postgres-1`; volume: `hms-local-foundation_hms_pgdata`.
  Verified image digest: `postgres@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929`.
- Both databases migrated from empty to **`fc7887fa1f65` (head)**, containing 12 `hms` tables:
  companies, guests, room_types, rooms, durations, reference_rates, booking_sources,
  reservations, room_allocations, pricing_revisions, operational_audit and mutation_receipts.
- Named FKs/checks/uniques; case-insensitive room-number uniqueness; one allocation per reservation;
  PostgreSQL `btree_gist` active scheduled `[start,end)` overlap exclusion; ownership-checked current
  occupancy pointer separate from scheduled range; positive interval/version/capacity and PHP money.
- Explicit guarded reference seed: development company, Standard type, Room 101, Direct source,
  six-hour/one-night duration and rate records. Repeated execution did not duplicate records;
  PostgreSQL test confirms an existing custom room display value is not overwritten.
- Development DB contains **eight reference rows total and zero guests/reservations/allocations,
  pricing revisions, audit events or mutation receipts** after verification. No fake bookings,
  payments or journals were seeded.
- Runtime/dev dependencies are recorded in `backend/requirements.lock`; `.env` contains a generated
  local password and is Git-ignored, as is `.venv`. No credentials are committed or printed.
- SQL connections and admin/seed tooling reject non-HMS hosts, ports, usernames/database names.
  The current guard intentionally does not permit a hosted/production database.

## Tests actually performed

| Check | Result |
|---|---|
| Frontend `npm test -- --maxWorkers=2` | **177 PASS in 31 files** |
| Frontend `npm run lint` | PASS |
| Frontend `npm run build` | PASS; existing >500kB bundle warning remains |
| Backend `pytest --postgres -q` | **11 PASS**: 6 unit/safety cases and 5 real PostgreSQL cases |
| Ruff checks and formatting checks | PASS |
| `pip check` | PASS |
| Alembic upgrade to head on two empty databases | PASS |
| Alembic current for both databases | `fc7887fa1f65` |
| `alembic check` against dev | PASS: no new upgrade operations detected |
| Actual HTTP calls to loopback API | Health 200: `status=ok,database=ok,scope=foundation-only`; liveness 200 |
| Pre-existing file fingerprint comparison | 153 checked, zero changed |

Backend DB tests verify overlap rejection, successful touching intervals, rejection of invalid
duration definitions/duplicate mutation keys, and deliberate rollback of the full low-level
reservation/allocation/pricing/audit/receipt insert group. These are **foundation constraints and
transaction tests**, not proof of an implemented reservation API, price calculator, replay service,
version-conflict handler, physical occupancy service or concurrent-writer application behavior.
[Final backend test output](../../backend/verification/backend-tests.log) is local ignored evidence.

One non-failing warning remains: current Starlette TestClient deprecates its `httpx` compatibility
path. All tests pass; update the test transport deliberately later rather than suppressing it.
Alembic autogenerate does not prove all check/exclusion semantics; direct DB tests cover the stated
constraints. No downgrade, destructive reset, production import, backup/restore or Supabase
deployment was attempted today.

## Files created or modified

Created `backend/` only, plus this kickoff note. Existing frontend/package/plan/research files
were not modified. Main files:

- `backend/pyproject.toml`, `requirements.lock`, `.gitignore`, `.env.example`, `compose.yaml`.
- `backend/app/main.py`, `settings.py`, `db.py`, `core_models.py`, `models.py`, `seed.py`.
- `backend/app/modules/reservations/models.py`, `backend/app/modules/billing/models.py` and
  package `__init__.py` files.
- `backend/alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`,
  `migrations/versions/fc7887fa1f65_initial_operational_foundation.py`.
- `backend/scripts/initialize-local.ps1`, `python.ps1`, `migrate-test.py`.
- `backend/tests/conftest.py`, `test_health.py`, `test_postgres.py`.
- `backend/README.md`, `contracts.md`, `verification/frontend-baseline.json`, `verification/status.json`.
- `docs/planning/backend-kickoff.md`.

Ignored local artifacts: backend `.venv`, private `.env`, caches, final test log. Docker volume
contains the isolated reference-only databases. Reviewable work is left uncommitted.

## Setup and execution

Full bootstrap/recovery safeguards are in [backend README](../../backend/README.md). Since this
workspace already has its environment, private `.env`, migrations and seed applied, normal use is:

```powershell
cd HotelSystem/backend
docker compose up -d --wait postgres
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Separate terminal, same directory:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/api/v1/health
& .\scripts\python.ps1 -m app.seed
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
```

The temporary API process used for HTTP smoke testing is stopped at handoff. PostgreSQL remains
running. Use `docker compose stop` when finished; do not delete volumes or regenerate `.env`.

## Blockers, incomplete work and exact Tuesday first task

No unresolved environment blocker: Docker, the independent project Python environment, DB access,
migrations, seed and health checks were verified. The inherited Python-variable problem is handled
by the scoped wrapper. The current PostgreSQL/Python patch versions and development admin role
require review before any shared/hosted deployment; this is loopback developer infrastructure.

Intentional incomplete items: all guest/reference/reservation business endpoints and DTOs; server
pricing, idempotent replay and expected-version logic; transactional occupancy/lifecycle services;
API frontend integration; authentication, full fixtures, advanced bills, hosted migration/restore,
native accounting and Odoo. Existing front-end behavior remains simulated memory, not persisted.

Schema gaps before first reservation write: company-scoped reference consistency beyond the
verified room/occupancy ownership FK; unambiguous enabled hourly/nightly rate uniqueness;
hotel check-in/out policy settings; occupancy DTO/count policy; captured per-line pricing fields
and audit/version provenance. Generic JSON snapshot storage exists but no server snapshot producer.
Do not expose reservation writes until the service guarantees required allocation/pricing/audit
and receipt membership. Single-row constraints cannot enforce that aggregate by themselves.

**Exact first task for Tuesday, October 13:** add a reviewed **second Alembic migration** completing
company-scoped reference FKs, active rate uniqueness and hotel time settings needed by the direct
single-room command; verify invalid references/rates are rejected and upgrade both existing
`hms_dev`/`hms_test` without changing their reference values. Then finalize create/read/edit DTOs
and independent guest/reference endpoints. Implementing atomic reservation creation and its
concurrency/replay tests follows the approved Week 1 sequence—not a claim of today's completion.
