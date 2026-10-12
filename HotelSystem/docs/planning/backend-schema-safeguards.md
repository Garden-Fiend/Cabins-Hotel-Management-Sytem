# Backend schema safeguards extension

Date: 2026-10-12, Asia/Manila. User authorized extending TODAY to the proposed
company ownership, rate uniqueness and hotel time settings work.

## Implemented and verified

New additive migration `032f6c7afbbd` follows the unchanged initial `fc7887fa1f65`.
Both existing isolated databases, `hms_dev` and `hms_test`, upgraded successfully.
No database reset, automatic data repair, reference overwrite or frontend connection occurred.
Constraints are validated normally: conflicting existing data would fail the migration rather
than be silently deleted/rekeyed. Referenced unique constraints precede foreign keys;
the downgrade removes dependent keys first. Downgrade was not executed and would discard
custom values in the two new time columns.

- Ten composite foreign keys enforce company ownership for room type, rate type/duration,
  reservation guest/source, allocation reservation/duration, pricing reservation,
  audit reservation and receipt reservation references. Existing room/allocation ownership
  constraints remain. Optional audit/receipt reservation links can still be absent.
- One enabled hourly rate per company/type/duration and one enabled nightly rate per
  company/type are enforced by partial unique indexes. Disabled history remains permitted.
- Companies now store non-null local check-in/out times, defaulting to 14:00/12:00 as in
  `src/features/configuration/sampleConfiguration.ts`. They are configurable SQL `TIME`
  values, not UTC timestamps; future overnight services must combine them with hotel dates
  and the company's timezone.

The read-only preservation comparison captured all existing rows/columns in both databases
before migration and compared them after migration and tests, excluding only the newly added
columns. Existing values and row membership remained unchanged. Eight seeded reference rows
remain in each database, with no test business records retained.

## Files

- `backend/app/core_models.py`: company wall-clock fields.
- `backend/app/models.py`: ownership constraints and active-rate indexes.
- `backend/migrations/versions/032f6c7afbbd_company_ownership_active_rates_and_.py`:
  frozen second migration, reviewed ordering.
- `backend/tests/test_schema_safeguards.py`: PostgreSQL boundary regressions.
- `backend/scripts/verify-preserved-data.py`: explicit capture/check, owned targets only.
- `backend/verification/schema-safeguards-data-before.json`: preservation evidence.
- `backend/README.md`, this report and the current Mermaid diagram: handoff updates.

## Commands and actual results

Run from `HotelSystem/backend`:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 -m alembic current
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 scripts/verify-preserved-data.py check
```

24 tests passed: the previous 11 plus 10 cross-company rejection cases, 2 rate uniqueness
cases and 1 default/custom/non-null time test. Alembic reports no new upgrade operations;
development head is `032f6c7afbbd`. The test database was upgraded through the same history
and exercised by the full PostgreSQL suite. Ruff checks pass. The existing Starlette/httpx
TestClient deprecation warning remains non-failing. Frontend tests were not rerun for this
backend-only extension; existing frontend files were preserved.

## Boundaries and next task

This is database enforcement, not multi-company product support, a business API or booking
persistence from the browser. Atomic reservation command services, server pricing, replay,
optimistic versions, concurrent writer verification and frontend integration remain incomplete.
Rate/duration kind compatibility, occupancy DTO policy, captured pricing lines and audit/version
provenance need service/schema review before booking writes. No accounting/Odoo was added.

The original kickoff's first Tuesday migration task is now completed. **Tuesday's first task:
finalize and validate the direct single-room create/read/edit DTOs**, including hotel-local
overnight time interpretation, occupancy counts and immutable captured pricing fields; then
implement independent guest/reference endpoints under the approved Week 1 sequence.
