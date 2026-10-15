# HMS local backend — persistent single-room operations

FastAPI/SQLAlchemy/PostgreSQL/Alembic local backend. React defaults to independent demo mode;
an explicit API-backed branch is available at the
[first frontend integration checkpoint](../docs/planning/frontend-api-integration-2026-10-13.md).
Health, reference reads, independent guest creation/reads and direct single-room reservation
creation/reads and version-checked note/count PATCH are implemented. Creates and patches are
transactional, audited and idempotent; creates are server-priced and patches preserve pricing.
The original rich React pages now support lifecycle/readiness, essential versioned configuration,
guest and pre-arrival stay changes, catalog products and captured purchases/manual adjustments and server-authoritative manual discounts.
See [Wednesday manual discounts](../docs/planning/manual-discounts-checkpoint-2026-10-14.md) and the [earlier integration checkpoint](../docs/planning/full-send-session-two-checkpoint-2026-10-13.md).
This is loopback development infrastructure; authentication, native accounting and Odoo remain absent.

Current migration head is `54e8c2a17d90` in both owned databases (14 HMS tables).
The resumed session added `e921a6830fc4` (versioned reference metadata) and
`3b36715627c4` (owned product/category catalog), following the unchanged earlier history.
Additive `54e8c2a17d90` now records explicit room operational status. All seven revisions preserve existing rows; downgrades were not run.
See [room status correction](../docs/planning/room-operational-status-2026-10-13.md).

From HotelSystem, `run-api.bat` starts FastAPI and opens both API mode at
`http://127.0.0.1:5173` and independent demo mode at `http://127.0.0.1:5174` for comparison.
Press Enter in the launcher window to stop its backend and both frontends; PostgreSQL remains running.
`run-api.bat -NoBrowser` starts the same services without opening browser tabs.
Stop an older launcher normally
before restarting it to expose the new routes/capabilities; this work did not terminate user servers.
New databases still use the explicit minimal seed. Catalog data is created through Inventory,
not populated from frontend demo fixtures. Purchases/adjustments are added after the booking is saved.

Current read-only inventory and preservation checks, from backend:

```powershell
& .\scripts\python.ps1 scripts/audit-current-integration.py
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/session-two-data-before-20261013.json
```

## Windows setup

Run from `HotelSystem/backend`. Use a Python installation outside ZKBioTime. On the inspected
machine the independent interpreter is:

```powershell
& 'C:\Users\Malala\AppData\Local\Programs\Python\Python312\python.exe' -I -m venv .venv
Remove-Item Env:PYTHONHOME,Env:PYTHONPATH -ErrorAction SilentlyContinue
& .\scripts\python.ps1 -m pip install -r requirements.lock
& .\scripts\python.ps1 -m pip install --editable . --no-deps
& .\scripts\initialize-local.ps1
docker compose up -d --wait postgres
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 -m app.seed
& .\scripts\python.ps1 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

`initialize-local.ps1` generates a private random local password into ignored `.env` and refuses
to overwrite an existing file. Do not rerun it against an initialized persistent volume by
deleting `.env`; recover the original password or use a separately reviewed fresh environment.
The Python wrapper clears inherited `PYTHONHOME`/`PYTHONPATH` only in its process and uses `-I`.
It never changes ZKBioTime's installation or global environment. Install the editable package
so isolated Python can import `app` without using arbitrary working-directory paths.

The Compose project is **hms-local-foundation**, container **hms-local-foundation-postgres-1**,
volume **hms-local-foundation_hms_pgdata**, port **127.0.0.1:55432**, database/user **hms_dev**.
This is a dedicated container, not a connection to the native ZKBioTime database. Its development
role administers this isolated cluster; it is not a production least-privilege role design.
`docker compose stop` stops this project without deleting its data. Do not use `down -v` as a
routine stop operation. No schema creation or seeding happens on FastAPI startup.

Verify from another terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/api/v1/live
Invoke-RestMethod http://127.0.0.1:8001/api/v1/health
```

DB failure returns HTTP 503 and a redacted unavailable response, not demo data. API docs are at
`http://127.0.0.1:8001/docs`. Readiness proves DB connectivity, not completed reservation services.

## Tests and migrations

Create the test database only inside the HMS container, once:

```powershell
docker compose exec -T postgres createdb -U hms_dev hms_test
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 -m pip check
& .\scripts\python.ps1 -m alembic current
& .\scripts\python.ps1 -m alembic check
```

Without `--postgres`, DB integration tests explicitly skip. They are never replaced with SQLite.
`migrate-test.py` applies the same migration history to the separately guarded `hms_test` database;
it does not clear databases. Admin/seed/connection helpers reject unrelated databases, users,
hosts or ports. The current guard is local-only: hosted migration configuration requires a later
reviewed change, not simply pasting a production URL into `.env`.

The initial frozen migration is `fc7887fa1f65`. Module-owned SQLAlchemy Core tables share one
`hms` schema and metadata. Rooms use a protected allocation reference for physical occupancy;
active scheduled allocations use a GiST exclusion over `[start,end)`. This is not an infinite
occupancy range. Cyclic room/allocation FK creation and removal are explicit in the migration.
The extension is retained on downgrade because it could be used elsewhere in the cluster.
Never generate historical migrations from live model imports or use `create_all` at startup.

The seed inserts only a development company, Standard type, Room 101, direct source, six-hour
and one-night durations/rates. It creates no guests, reservations, payments or journals and
never updates existing reference values. Other demo features/rates are not yet represented.
The second migration, `032f6c7afbbd`, adds company-scoped foreign keys for all current
business references and unique enabled hourly/nightly rate bases. Disabled historical rates
can coexist. Company wall-clock defaults are 14:00 check-in and 12:00 check-out, matching
the existing demo configuration; services must interpret them in the hotel's timezone.
The broad fixture import remains deferred. See the
[safeguards verification](../docs/planning/backend-schema-safeguards.md).

Schema model changes use a new reviewed Alembic revision after this initial migration has been
applied. `alembic check` does not prove every CHECK/exclusion definition: direct PostgreSQL tests
verify the important interval, identity and rollback behavior. No destructive test DB reset is
automatic. Backups/restore, real concurrent-writer tests and a production migration process are
not completed today.

## Module and transport boundaries

Tuesday migration head: `82f79142cdbd`. It adds counts, active reference flags, rate/duration-kind
ownership, finite scheduled intervals, supported hotel timezone/time checks and audit/pricing
version provenance. Migration CHECK definitions are explicit because autogenerate misses them.
Reference seed identities are deterministic UUIDs, repeated seed calls preserve existing values,
and non-identity unique conflicts now fail transactionally rather than silently dropping a seed.

Read [`contracts.md`](contracts.md) for supported request/response fields and endpoint limits.
Open `http://127.0.0.1:8001/docs` while the server is running for the actual OpenAPI contract.
`Idempotency-Key` is a required UUID header for both POST commands. The server selects the company
from `HMS_COMPANY_ID` (default development company) and records actor `local-development`;
this is development attribution, not authenticated staff identity. Routes fail closed outside
`HMS_ENV=development`. The current database target guard also rejects query-string overrides.

Additional explicit checks:

```powershell
& .\scripts\python.ps1 scripts/audit-foundation.py
& .\scripts\python.ps1 scripts/http-smoke.py
```

The HTTP smoke test creates only a synthetic company in `hms_test`, starts/stops its own loopback
API process twice, verifies read/replay after restart, then deletes only its synthetic UUID-scoped
rows. It never writes `hms_dev`. The audit script currently expects the reference-only baseline:
12 tables/eight rows in each DB; once real local bookings exist it will intentionally flag that
change instead of clearing them. It is a historical foundation audit, not the current integration
audit; use `audit-current-integration.py` for the current schema without requiring empty business tables.
The session preservation evidence uses hashes instead of guest/contact contents;
do not commit future snapshots of real guest/contact records.

See the [Tuesday checkpoint](../docs/planning/backend-tuesday-checkpoint-2026-10-13.md).
The subsequent [PATCH checkpoint](../docs/planning/backend-patch-checkpoint-2026-10-13.md)
records note/count edits and their version/replay/rollback verification. PATCH requires a UUID
`Idempotency-Key`, `expected_version` and at least one of `note`, `adults`, `children`. Omitted
fields are preserved, empty note clears, null rejects, and successful new requests advance
version once. Replays return the original committed response even after later edits; GET is
the current state. Captured pricing's `reservation_version` remains its original provenance.

See [API/command contract](contracts.md) and [kickoff/handoff](../docs/planning/backend-kickoff.md).
`reservations` owns guests, rooms, rates and allocation; `configuration` adds operational catalog
definitions; `billing` owns captured operational pricing revisions, purchase resolution and adjustments.
Core owns company context, operational audit and receipts.
Future accounting, integrations and reporting boundaries are documented but have no empty
implementation scaffolds. There is no journal, invoice finalization or posting on Save.

Runtime/dev versions tested are pinned in `requirements.lock`; the editable local package is
installed separately. Python and PostgreSQL patch updates, driver/pooler behavior and TLS must
be reviewed before any hosted/shared deployment. This loopback-only developer scaffold has no
authenticated API actor and is not production-ready.

Special extra charges now use protected category identity and shared catalog product storage.
The original Inventory rename/definition controls and reservation create/edit charge controls
are connected; definition changes preserve captured prices and historical revisions. Existing
discount eligibility applies. See [extra-charge checkpoint](../docs/planning/extra-charges-checkpoint-2026-10-14.md)
and the [contracts](contracts.md) for verified boundaries. Inclusions and breakfast were deferred there.
The extra-charge checkpoint head was `7b90f132ae64` (nine revisions, 14 HMS tables). The two additive
extra-category migrations preserve existing ordinary names/rows and initialize only protected
category metadata. Downgrade requires a reviewed data plan and fails explicitly; no destructive
downgrade, fixture import or automatic ordinary-category conversion was performed.

The inclusion checkpoint head was `8c21a6f4d903` (ten revisions, 15 HMS tables). Room-type inclusion defaults have
owned relational references; reservations capture nonfinancial quantities/provenance separately
from pricing. Original Inventory, both room-type editors and reservation inclusion controls are
connected. See [focused inclusion checkpoint](../docs/planning/inclusions-checkpoint-2026-10-14.md)
for executed checks and Session 2 verification gaps.

The breakfast checkpoint head was `9d54e702b816` (eleven revisions, 16 HMS tables). Protected breakfast identity is a
virtual view over shared products, with owned meal/beverage eligibility and nonfinancial nightly
service-date selections. Pure breakfast edits preserve pricing; separately purchased meals remain
billable. Original Inventory/Configuration/pane controls are connected. See the
[Wednesday Session 2 checkpoint](../docs/planning/session-two-checkpoint-2026-10-14.md).
Restart old backend/frontend launchers together after updating code; no reset or reseeding is required.

## Discount presets, final prices and recovery rehearsal

Discount milestone head: `f19b362d47a0`, fifteen revisions and seventeen HMS tables. Original Discounts
controls persist fixed/percentage presets and final unit prices for covered room rates/products.
Reservation selectors capture server-owned terms. Unit replacements are separate from ordinary
reductions in schema 5. Deletion remains unavailable; Disable retains identity/history.
See the [Thursday checkpoint](../docs/planning/final-prices-checkpoint-2026-10-15.md).

The explicit recovery command below creates a new private PostgreSQL container/volume on loopback
port 55433. It refuses occupied ports and never connects to `hms_dev`/`hms_test`. Only this process
opts into guarded `hms_rehearsal`/`hms_restore` targets. It migrates, seeds twice, creates synthetic
records, dumps/restores and verifies every table plus canonical booking data. On success its own
container is stopped and retained for review; no volume/database is removed. Docker access and
the already installed PostgreSQL 17.6 image are required. No hosted backup guarantee is implied.

```powershell
& .\scripts\python.ps1 scripts/rehearse-recovery.py
```

## Operational billing-document foundation

Current head: `68f75a14d5a4`, sixteen revisions and nineteen HMS tables. This additive revision
introduces `billing_documents`, company-scoped transactional counters, ownership/source foreign
keys and database immutability triggers. No existing records are converted into documents.

The backend supports explicit draft capture, GET/list and finalization. Captures reuse existing
server pricing and preserve overrides, discounts, quantities, labels and adjustments independently
of later reservation edits. Stale source versions reject rather than refreshing silently. One
finalized operational bill is permitted per reservation; corrections are deferred. API-mode reservation
detail now provides draft/review/finalize/read and a separate captured Operational Billing Statement
print route. Demo document actions are gated. No tax invoice, payment or accounting behavior was added.
Existing reservation print remains unchanged. See the
[frontend checkpoint](../docs/planning/billing-documents-ui-checkpoint-2026-10-15.md).
See [the contract](billing-documents.md) and
[checkpoint](../docs/planning/billing-documents-checkpoint-2026-10-15.md).

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_billing_documents.py
& .\scripts\python.ps1 scripts/http-billing-documents.py
```

Do not run PostgreSQL suites concurrently with the synthetic HTTP runner. Its privileged guarded
test cleanup briefly locks the document table exclusively, removes only its synthetic company's
documents and re-enables the row trigger in the same transaction. No application bypass exists.

### B2 shared-stay multi-room reservations

B2 migration head: `b26c31d7e821` (superseded by B3 below). Apply `alembic upgrade head`
and `scripts/migrate-test.py` using the owned Python wrapper for other checkouts; the current local
targets are migrated. Restart an older launcher normally; no reset/reseed is needed.
Original Add/Remove Room and expanded-detail individual/strict bulk lifecycle controls are connected.
See [contracts](contracts.md#shared-stay-multiple-allocations-b2) and
[B2 checkpoint](../docs/planning/b2-multi-room-checkpoint-2026-10-15.md).

Focused PostgreSQL: `& .\scripts\python.ps1 -m pytest --postgres -q tests/test_multi_room.py`.
From app root: `& .\backend\scripts\python.ps1 integration-tests/run-multi-room.py`.
Run PostgreSQL suites separately from synthetic browser harnesses.

### B3 independent room stays

Current head: **`c37d42e8f932`** (19 revisions / 19 tables). Other checkouts must run
`alembic upgrade head` and `scripts/migrate-test.py` through the owned wrapper. Current local targets
are migrated; restart an older launcher normally, without reset/reseed. Original Custom stay/Same as
reservation controls persist each room's arrival and selected hourly/nightly duration. Parent dates
are the overall range, not every room's availability. See the
[contract](contracts.md#independent-allocation-stays-b3) and
[B3 checkpoint](../docs/planning/b3-custom-stays-checkpoint-2026-10-15.md).

Focused backend: `& .\scripts\python.ps1 -m pytest --postgres -q tests/test_custom_stays.py`.
From app root, separately: `& .\backend\scripts\python.ps1 integration-tests/run-custom-stays.py`.
The guarded runner owns only its generated test company and temporary API/frontend processes.
### B4 room and room-type retirement

Existing archive/enabled fields are reused; head remains `c37d42e8f932`. Original Rooms controls
archive/restore and confirm unused deletion. Generic Configuration Enable/Disable and edit-form
Enabled state persist consistently. References/history remain visible, while new booking selectors
and server commands reject archived configurations. Type retirement preserves physical-room flags
and existing booked lifecycle; room retirement rejects active assignments. Referenced deletion is
blocked with an archive recommendation. See [contract](contracts.md#room-and-room-type-retirement-b4)
and [checkpoint](../docs/planning/b4-room-type-retirement-checkpoint-2026-10-15.md).

Focused backend: `& .\scripts\python.ps1 -m pytest --postgres -q tests/test_retirement.py tests/test_retirement_multi.py tests/test_configuration_api.py tests/test_reservation_lifecycle.py`.
From app root, separately: `& .\backend\scripts\python.ps1 integration-tests/run-retirement.py`.
Restart an older launcher normally; no migration/reset/reseed required.
