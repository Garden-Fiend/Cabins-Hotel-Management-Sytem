# Wednesday remaining-session checkpoint

Baseline: [Session 2 checkpoint](session-two-checkpoint-2026-10-14.md), `9d54e702b816`.
Earlier work, user records and failed evidence retained. No commit/push, dependency installation,
database reset, ZKBioTime access, accounting or Odoo work.

## Edge cases and correction

Focused API checks passed for retired captured breakfast choices, Manila service dates/count/stay
pruning, competing mutations, protected category identity and mixed inclusion/billing changes.
Four new boundary cases verify breakfast/inclusion rename with ordinary-name collisions, retained
inclusion labels after rename/retirement, and competing atomic stay/inclusion/financial edits.
The latter accepts one writer and rejects the other with 409 without losing pricing history.

[Three focused browser checks](../../booking-tests/reports/20261014T063347Z-special-boundaries/results.json)
and its SQL/restart verification passed: original detail editing of retired recipes, reviewed guest
quota conflicts retaining drafts, and original Inventory special-category Rename/name coexistence.
Combined stay/inclusion/financial competition was API-tested, not separately browser-tested here.

Confirmed presentation defect corrected: API reservation inclusion controls used current product
labels after rename. Existing captured inclusion labels now appear in those controls; demo behavior
is unchanged. The initial failed browser evidence remains in the timestamped reports. A subsequent
selector correction used the quantity input label because visible text includes a default suffix.

## Fresh migration and recovery

The rehearsal creates a uniquely named PostgreSQL 17.6 container/volume, bound only to
`127.0.0.1:55433`. It refuses an occupied port, never reuses a container/database, and creates
`hms_rehearsal` and a separate empty `hms_restore` inside this independently isolated cluster.
Normal development/test guards remain unchanged. A process-only opt-in authorizes exclusively
these rehearsal names, user and port; eight guard cases verify rejection of other targets.

Empty migration, explicit seed, identical seed replay, synthetic configuration/booking creation,
custom-format pg_dump/pg_restore, identical hashes of every restored table, canonical reservation
equality, matching migration heads and restored Alembic drift checks passed.

- [Baseline rehearsal](../../backend/verification/recovery-rehearsal-20261014T062953Z.json): head `9d54e702b816`.
- [Final rehearsal](../../backend/verification/recovery-rehearsal-20261014T070829Z.json): head `2cd0458fa054`,
  including inclusion defaults, a preset definition, captured discount, pricing, audit and receipts.

The [first attempt](../../backend/verification/recovery-rehearsal-failed-20261014T062852Z.json) completed dump/restore but verification failed because a string replacement also
changed the URL username. The runner now replaces only the database path. That failed cluster and
all successful clusters remain retained, stopped; no database/volume was deleted. Dumps remain
inside their owned containers. The final runner stops its own successful container to free the port.
This verifies local restoration, not hosted disaster recovery, encrypted offsite backups or RPO/RTO.

## Preset slice

Original Discounts controls configure fixed/percentage presets for reservation, room-type and
product scopes. Create/edit/enable/disable persist with versions, keys and server audit. Failed saves
retain drafts; explicit latest-version review does not replace the draft. Deletion is gated; Disable
retires a definition while preserving identity. Demo retains its original final-price builder/default.

Original reservation room/item selectors and reservation select-and-Apply resolve new selections
from company-owned active definitions on the server. Captures retain preset ID/version, label,
decimal value, scope/target, applicable room rate and first-application time. Existing captures retain
their terms after definition edits/retirement; captured prices and historical revisions are preserved.
Preset fields/calculated provenance cannot be supplied as financial authority by the client.

Room presets reduce accommodation only; manual room discounts still include associated charges.
Item fixed reductions apply to a line total, not per unit. Room/item reductions precede reservation
reductions with existing rounding/caps; adjustments remain separate. Duplicate preset selections
are rejected. A changed room rate/type or missing item requires removing/replacing an incompatible
captured preset. All changes use existing atomic command, audit and receipt boundaries.
Old manual request hashes remain compatible when the additive preset identity is absent.

Two additive migrations: `ff926c58443d` creates owned preset storage and constraints;
`2cd0458fa054` enforces the demo's case-insensitive name uniqueness. The first had already been
applied, so uniqueness was added separately. Both databases are at `2cd0458fa054`: thirteen
revisions, seventeen HMS tables. Downgrades refuse unreviewed integrity/data removal; none ran.
No presets were seeded or fabricated. Final preservation comparison found every original row/column
unchanged and both new preset tables empty after synthetic cleanup.

**Final-price overrides are deferred, not converted into reductions.** Established order is original
unit amounts → one final-price unit replacement per line → room/item reductions → reservation
reductions → signed adjustments → final zero clamp. Safe implementation still needs captured
override unit/rate/quantity fields, server applicability and separate reduction accounting so the
override is counted once. This session implements fixed/percentage presets only.

## Actual verification

- Full backend regression: **362 passed** after shared preset DTO/pricing integration.
- Final focused backend (presets, special boundaries, recovery guards): **23 passed** after name
  uniqueness/target checks and decimal transport changes. Earlier affected manual/inclusion/breakfast
  run: **80 passed**. Tests cover server authority, history, ownership/validation, replay/key conflicts,
  competing versions and rollback/retry after reservation/pricing/audit/receipt writes; two added
  cases verify small plain-decimal percentages and explicit removal before incompatible room repricing.
  A further case verifies exact fixed-value cents/half-up rounding without frontend float loss, and
  different precise request payloads still conflict even when they round to the same PHP amount.
- Full frontend: **208 passed in 39 files**; final affected frontend **33 passed** after exact decimal
  input handling. Final TypeScript, ESLint and production build passed.
- [Seven preset browser checks](../../booking-tests/reports/20261014T072407Z-discount-presets/results.json)
  plus SQL/restart verification: dedicated Discounts create/edit/stale-review/disable; expanded detail
  room/item/reservation selection, failed-save retention and print; Dashboard and calendar empty-cell
  create; calendar summary edit; independent demo with original final-price default and zero API calls.
  Three bookings and five pricing revisions survived restart; only the owned synthetic company was
  cleaned from `hms_test`.
- Alembic drift, preservation and final Ruff/format checks passed.

Failed runs were retained: harness select labels included option text/quantity; a status selector
matched the refresh indicator; clicking an already-open Discounts summary closed it. Corrected
selectors precede the passing runs. Initial preset unit failures were duplicate helper keyword
arguments and expecting raised exceptions from a TestClient configured to return 500.
An obsolete frontend preset-rejection assertion was updated to retain final-price rejection.

A PowerShell text edit temporarily changed Unicode characters in ReservationPane. Two Dashboard
assertions failed; encoding was repaired without changing text, all ten Dashboard tests then passed,
and the subsequent full frontend run passed 208. Existing TestClient and bundle-size warnings remain.

## Reproduce and next milestone

From `HotelSystem` (run PostgreSQL separately from synthetic browser harnesses):

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-special-boundaries.py
& .\backend\scripts\python.ps1 integration-tests/run-presets.py
npm test -- --maxWorkers=2
npm run lint
npm run build
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 scripts/rehearse-recovery.py
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/presets-before-20261014.json
```

Restart an older launcher normally before `run-api.bat`; no reset/reseed is needed.
The owned development/test databases were migrated already.

New files: preset helper/table migrations/tests; boundary and recovery-guard tests; guarded recovery
runner/evidence; focused special-boundary and preset browser/SQL runners; this checkpoint.
Modified: configuration models/DTOs/services/routes, reservation references/DTOs and concrete pricing
callers, compatible hashes; typed client/presentation/bridge, original Discounts/ReservationPane
controls, owned synthetic cleanup, documentation. Earlier uncommitted work remains in these files.

**Next first task:** implement a separately captured final-price override path in the documented order,
with room-rate coverage, item quantities, historical unit prices, single application and rollback tests;
then connect the existing final-price choices. Do not model overrides as ordinary fixed discounts.
Remaining preset boundary gaps include browser competing reservation discount review, item quantity/
removal with captured presets, and room-rate incompatibility handling. Existing manual conflict tests
and generic transaction checks are not substitutes for those named browser paths.
Enable is connected through the same versioned definition command but was not independently
browser-exercised; the browser verified Disable and the resulting historical selection.

Multi-room/custom/OTA, payment/refund/settlement workflows, detailed history presentation, stock,
authenticated staff/public deployment, accounting and Odoo remain outside this milestone.
