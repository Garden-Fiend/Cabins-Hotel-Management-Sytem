# HMS backend foundation — TODAY only

FastAPI/SQLAlchemy/PostgreSQL/Alembic scaffold. React is unchanged and remains in demo mode.
Only `/api/v1/live` (process health) and `/api/v1/health` (real DB connectivity) are implemented.
No reservation CRUD, pricing service, accounting, authentication or Odoo adapter exists yet.

## Windows setup

Run from `HotelSystem/backend`. Use a Python installation outside ZKBioTime. On the inspected
machine the independent interpreter is:

```powershell
& 'C:\Users\Malala\AppData\Local\Programs\Python\Python312\python.exe' -I -m venv .venv
Remove-Item Env:PYTHONHOME,Env:PYTHONPATH -ErrorAction SilentlyContinue
& .\scripts\python.ps1 -m pip install -r requirements.lock
& .\scripts\python.ps1 -m pip install -e . --no-deps
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

See [API/command contract](contracts.md) and [kickoff/handoff](../docs/planning/backend-kickoff.md).
`reservations` owns guests, rooms, rates and allocation; `billing` currently owns only captured
operational pricing revisions. Core owns company context, operational audit and receipts.
Future accounting, integrations and reporting boundaries are documented but have no empty
implementation scaffolds. There is no journal, invoice finalization or posting on Save.

Runtime/dev versions tested are pinned in `requirements.lock`; the editable local package is
installed separately. Python and PostgreSQL patch updates, driver/pooler behavior and TLS must
be reviewed before any hosted/shared deployment. This loopback-only developer scaffold has no
authenticated API actor and is not production-ready.
