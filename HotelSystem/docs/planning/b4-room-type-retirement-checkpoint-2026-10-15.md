# B4 room and room-type retirement checkpoint

October 15, 2026, Asia/Manila. Starting commit `e6c45ff`; starting/final head
`c37d42e8f932` (19 revisions, 19 tables). B4 only. Starting tree was clean. No commit/push,
migration, installation, reset/reseed, B5, accounting or unrelated environment access.

## Implemented boundary

Existing `enabled`/`archived` fields are reused. Original Rooms Archive/Restore and confirmed
Delete controls now persist; API-only active/archived/all filtering supports management.
Generic Configuration Enable/Disable and edit-form Enabled restoration are also connected.
Demo interactions and restrictions remain unchanged and independent.

Room archive rejects blocking allocations and outstanding occupancy. Terminal history allows
archive, not deletion. Restore preserves identity, number, housekeeping, operational status and
type; an archived type must be restored first. Archived numbers remain unique/reserved.

Type archive retains physical rooms, their individual flags, rates and inclusion defaults.
New bookings/allocation assignments reject archived rooms/types. Existing captured assignments
remain serviceable: an inconsistent legacy single-room type-status check was removed, aligning
check-in with the existing plural lifecycle. Physical-room readiness/maintenance/occupancy and
captured-type matching still apply. Restoring a type does not restore individually archived rooms.

Permanent deletion checks every modeled incoming FK, including all allocation history/tombstones,
physical rooms, rates, defaults and presets, plus pricing/document/business audit JSON identities.
No dependent records are automatically removed. Own definition audit/receipts remain as snapshots
after unused deletion; other audit references prevent deletion. Definition row locks serialize with
existing booking/configuration locks; database FKs remain the final relational guard. Audit, mutation
and durable receipt are one transaction. Financial captures and finalized documents are unchanged.

## API and retry contract

- `POST /api/v1/configuration/rooms/{id}/retirement`
- `POST /api/v1/configuration/room-types/{id}/retirement`

Body: `{ "expected_version": 1, "action": "archive" | "restore" | "delete" }`, UUID request key.
200 confirms `{id, version, action}`; 404 missing/foreign; 422 malformed; 409 stale/protected use.
Same-key replay returns the original committed response, including after deletion. A different key
for a missing record returns 404. A current-version request for the already-current archive state
is a no-op, with a receipt but no extra version/action audit. Existing configuration PATCH and
reference-data GET remain available; reads include archived definitions.

UI waits for server confirmation and canonical refresh. Busy guards prevent duplicate submissions;
blocked operations retain records. Ambiguous requests retain original key/body across tab refresh
and expose explicit original-request recovery. Generic configuration uses its existing recovery path.

## Actual verification

- Focused PostgreSQL: **75 passed**, including retirement/configuration and existing single-room
  lifecycle tests. A final additional inclusion-default dependency case passed separately (**1 passed**).
  These are focused runs, not a complete repository regression. Coverage includes future/occupied
  guards, terminal/tombstoned history, unused deletion/replay, foreign ownership, name uniqueness,
  type/rate/default dependencies, archive/delete versus competing creates, stale requests and four
  rollback/retry stages for both archive and delete. B2 shared/B3 independent history, failed additions
  through an archived type, immutable finalized captures and checkout after retirement are API-tested.
- Affected frontend: **19 passed in four files**; after correcting new test-only TypeScript declarations,
  its three cases passed again. Full ESLint passed; final affected ESLint, TypeScript and production
  build passed. Full frontend/backend suites were intentionally not rerun.
- Ruff lint/format, Alembic drift and diff whitespace passed. Existing TestClient deprecation and
  bundle-size warnings remain non-failing.
- [Final browser: nine checks passed](../../booking-tests/reports/20261015T081120Z-retirement/results.json),
  with [SQL/restart verification](../../booking-tests/reports/20261015T081120Z-retirement/postgres-verification.json).
  Original dedicated room/type creation, archive/restore, confirmed unused deletion, filtering,
  reservation chooser exclusion/restoration, failed archive/original-key retry, blocked historical
  deletion, generic type and room Enable/Disable/edit-form restore, historical reservation print,
  check-in/out under an archived type, immutable bill read and independent demo were exercised.
  One booking, one finalized bill, one room/type and 22 audit events survived a real owned API restart.
  SQL directly checked persisted flags/versions. Trace/video/screenshot remain with the report.

The first browser run, `20261015T080439Z-retirement`, is retained as FAIL: an exact accessible-name
selector ignored option text within the Room type label. The selector was corrected; no assertion
was weakened. The earlier eight-check passing run remains at `20261015T080624Z-retirement`.
Early new backend test failures were fixture errors: cancellation omitted `guest_has_vacated`,
the commit injection patched the wrong method, a removed room was passed to an old helper,
ownership checked the wrong error attribute, and lifecycle advanced the room version. Corrected
tests passed. Initial Ruff formatting errors and new test-only TypeScript errors were fixed.

## Preservation, files and continuation

[Hash baseline](../../backend/verification/b4-before-20261015.json) comparison passed: every original
row/column unchanged, with no additional retained rows in either database. Final inventory remains
six development reservations/allocations and zero retained test reservations/allocations. Only exact
random synthetic companies in `hms_test` were cleaned using existing guarded cleanup; document
cleanup retained its exclusive-lock/trigger discipline. Backend and browser suites ran separately.
Owned temporary servers stopped; user-owned servers and ZKBioTime were untouched. PostgreSQL itself
was not restarted; persistence checks restarted only the harness-owned API.

New: `configuration/retirement.py`, two retirement test files, frontend `RoomRetirement.test.tsx`,
`run-retirement.py`/`browser-retirement.mjs`, preservation baseline and this checkpoint.
Modified: configuration router/services, single-room lifecycle guard, typed API client/bridge/command
context, original Rooms/Configuration pages, contracts/README and bounded parity plan/matrix updates.

From `HotelSystem`, run browser verification separately from PostgreSQL tests:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-retirement.py
npx vitest run src/pages/RoomRetirement.test.tsx src/pages/RoomsPage.test.tsx src/pages/ConfigurationPage.test.tsx src/app/api/useMutation.test.ts --maxWorkers=2
npm run lint
npm run build
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_retirement.py tests/test_retirement_multi.py tests/test_configuration_api.py tests/test_reservation_lifecycle.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b4-before-20261015.json
```

The reproduction command now includes the additional default-dependency test; it was executed
separately after the 75-case run. Restart an older launcher normally before `run-api.bat`; no migration
or reseeding required.

**B4 COMPLETE within this boundary.** Concurrent type retirement/booking and every combined
entitlement scenario were not separately browser-exercised; incoming type-lock/FK behavior and
focused dependency tests support the boundary. No production authentication/authorization is implied.
No PostgreSQL-process restart or new recovery rehearsal was performed. Stop here; next separately
authorized work is B5 booking-source/agreement contract review. Do not remove history guards to
implement it or automatically rerun completed B1–B3 suites.
