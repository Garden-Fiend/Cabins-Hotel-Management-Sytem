# B2 shared-stay multi-room checkpoint

October 15, 2026, Asia/Manila. Baseline: accepted B1 at `68f75a14d5a4`.
Scope B2 only. Earlier uncommitted final-price, billing-document and B1 work retained.
No commit/push, dependency installation, reset/reseed, B3, accounting or ZKBioTime access.

## Model and contracts

One parent reservation retains its UUID, version, guest, source, shared stay and financial record.
Existing allocations gain independent state/removal metadata; existing single-room records are not
backfilled or rekeyed. New plural GET/list representations expose `allocation: null`, full
`allocations` history, shared dates/duration and an explicit aggregate state. No primary-room alias.

New commands: `POST /api/v1/multi-room-reservations`,
`POST /api/v1/reservations/{id}/edit-allocations`, and
`POST /api/v1/reservations/{id}/room-lifecycle/{action}`. Create accepts 1–50 distinct rooms;
edit requires version and stable IDs. Lifecycle optionally targets an allocation; omitted check-in/out
targets all active rooms, validates every target before mutation and rejects rather than skipping.
Existing key/replay, ownership, transaction, audit and server-pricing boundaries apply.
Original single-room request bodies/hashes remain unchanged; plural promotion retains the original
allocation ID and reservation ID. Singular mutation endpoints explicitly reject promoted records.

Add/remove/shared-stay edits require all active rooms reserved. Removed allocations are tombstoned,
not deleted/reassigned; no empty active aggregate. Operational guest/count/note/financial edits
preserve occupancy. Terminal parents reject edits. Shared arrival-only changes retain booked duration,
captured rates and checkout policy. B3 room-specific stays remain gated in API mode; demo is independent.

Parent/aggregate mapping: all reserved → confirmed/reserved; occupied plus reserved →
checked_in/partially_checked_in; occupied plus checked-out → checked_in/partially_checked_out;
reserved plus checked-out without occupancy → confirmed/partially_checked_out; all terminal →
corresponding terminal state. Cancellation retains physical occupancy separately until departure.
Per-room state/actual instants drive calendar occupancy; checkout marks only released rooms Dirty.

Pricing schema 6 extends the existing calculator, with allocation attribution for accommodation and
charges. Room presets/replacements affect only their intended room; manual room discounts include
that room's charges. Reservation reductions/adjustments apply once. Inclusions/breakfast remain
per-allocation. Existing captured units/labels survive additions and unrelated edits; removal appends
history. Billing capture schema 2 stores every active allocation and financial line; old schema-1
captures and finalized bills remain unchanged. Original reservation/document prints remain separate.

## Migrations and preservation

Both isolated databases upgraded additively through `a15b20c6d710` and `b26c31d7e821`:
18 revisions, 19 HMS tables. The first removes the single-allocation unique constraint and adds
shared-stay/active-room checks, partial uniqueness and deferred shared-stay triggers. The second
preserves original legacy staging (zero allocations while a legacy parent is staged) and enforces
stable plural allocation identity/removed history. It was additive because the first was already applied.
Existing overlap/ownership constraints remain. Downgrades refuse unreviewed history removal; none ran.

Read-only initial inventory: development six allocations/six reservations; test business tables empty.
Hash-only preservation baseline: `backend/verification/b2-before-20261015.json`.
Final comparison and exact final verification results are recorded below after checks finish.
Synthetic cleanup changes only its generated company's parent marker inside its cleanup transaction;
application commands have no bypass. Document cleanup retains the existing exclusive-lock discipline.

## Verification so far

- Multi-room focused PostgreSQL: **32 passed**, including create/GET/list/replay, two/three rooms,
  mixed room rates/financial attribution, nightly inclusions/breakfast, legacy promotion, independent
  and strict bulk actions, sorted-lock competing creates/replay, stale requests, staged rollback/retry,
  immutable multi-room bill, shared-stay SQL guards, tombstones and arrival-policy preservation.
- Complete PostgreSQL regression: **481 passed** after the additive compatibility correction.
  Earlier full run had 476 passes/one failure: an original concurrency test stages a legacy parent
  before allocation insertion. The correction restored legacy staging without weakening plural completeness.
- Complete frontend: **235 passed in 43 files**; ESLint, TypeScript and production build passed.
  Subsequent affected input/recovery tests: **12 passed**, including a reviewed breakfast-quota guard.
- [Multi-room browser: 11 checks passed](../../booking-tests/reports/20261015T055723Z-multi-room/results.json),
  followed by [PostgreSQL/restart verification](../../booking-tests/reports/20261015T055723Z-multi-room/postgres-verification.json).
  Dashboard and calendar creation, failed-save draft retention, committed-response loss/refresh/replay,
  both room rows in all four calendar views, independent check-in, strict bulk checkout, original Add/
  Remove, mixed financial totals, conflict review preserving remote counts, no-op save, original print,
  finalized multi-room bill/PDF and independent demo were exercised. Two reservations, four pricing
  revisions and the final document survived restart; only the random test company was cleaned.
- Earlier browser failures retained: `055418Z` form-helper scope; `055537Z` reserved allocation tooltip
  incorrectly said confirmed. The latter application projection was corrected to allocation state;
  single-room labels were unchanged. The successful report was a fresh run, not relabeled evidence.
- Initial new test/helper failures (validator wrapper, required capture field and helper assertions)
  were corrected before passing runs. Migration lint/format failures were corrected without changing
  applied SQL behavior. Existing TestClient and bundle-size warnings remain.

## Files and reproduction

New: reservation `multi.py`, `multi_lifecycle.py`, `multi_schemas.py`; two migrations;
`test_multi_room.py`, read-only `inspect-b2.py`; API `multiInputs.ts`, `multiPresentation.ts`,
`multiRoom.test.tsx`; `AllocationOperations.tsx`; guarded multi-room browser/SQL runner and evidence.
Modified: concrete reservation models/routes/read helpers and singular-command guards; shared billing
discount/preset/override/snapshot/document contracts; typed clients/provider/store/bridge/projections;
original ReservationPane/detail/Dashboard and calendar identity sort; reservation/domain types;
owned fixture cleanup, documentation and architecture. Earlier work in shared files was retained.

From `HotelSystem` (PostgreSQL and browser harnesses must run separately):

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-multi-room.py
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
npx vitest run src/app/api/multiRoom.test.tsx src/app/api/useMutation.test.ts --maxWorkers=2
npm run lint
npm run build
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_multi_room.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b2-before-20261015.json
```

Restart an old launcher normally before `run-api.bat`. Local databases were migrated; other checkouts
must upgrade development/test explicitly. No reset/reseed needed. User-owned servers remain untouched.

## Final gate / limits

**B2 meets its bounded acceptance gate.** Final targeted PostgreSQL: **90 passed** (43 multi-room,
20 B1, 27 immutable-document cases), after the final audit/captured-duration refinements. This is a
targeted run, not a claim of a second complete 490+ regression. The earlier complete result remains
481 passed. Final affected frontend/calendar/recovery: **20 passed in four files**; the earlier
complete run remains 235 passed. Final TypeScript/ESLint/build, Ruff lint/format, dependency consistency,
Alembic drift and whitespace checks passed.

[Final multi-room browser: 12 checks passed](../../booking-tests/reports/20261015T061552Z-multi-room/results.json)
and [SQL/restart evidence](../../booking-tests/reports/20261015T061552Z-multi-room/postgres-verification.json)
verify three parent reservations, seven allocation rows (including one tombstone), five pricing
revisions and one finalized document. Added coverage clicks header Check In All, individual checkout,
verifies mixed bulk rejection/disabled controls and gray completed/red overdue rows in all four views.
The browser clock is simulated only in a separate read-only page for overdue display; server lifecycle
checks run on actual time. Both bulk check-in/out and individual check-in/out were exercised.
The final booked-night-count correction was subsequently API-tested; a new room uses the captured
shared night count even if the duration definition changed. Existing captured room amounts stay fixed.

[Existing rich regression: 26 checks passed](../../booking-tests/reports/20261015T060514Z-rich-api-integration/results.json),
with real SQL/restart verification. Final focused tests additionally verify competing versioned edits,
concurrent identical-key edit replay, six add/remove rollback/retry stages, exact audit note/count/
lifecycle instants, foreign-context rejection, and frontend reviewed quota/remote-removal safeguards.
The API adapter refuses to silently resurrect a remotely removed room or discard a local edited
breakfast excluded by reviewed counts. Unchanged drafts do not increment the version; unresolved
ambiguous edits must be recovered before closing as a no-op.

Additional failed evidence remains intact: `061244Z-multi-room` expected a completed bar with inactive
rows hidden; `061406Z-multi-room` passed the new lifecycle/color check but lost a form target after
clock manipulation in the main page. The harness now uses the existing Show inactive option and
isolates the simulated clock in its own page. No application assertion was weakened. Six new rollback
tests initially had a misplaced post-retry comparison against pre-edit state; the rollback/retry itself
passed. That assertion was moved to its intended database-delete guard test; all 90 final cases pass.

Final read-only inventory: both heads `b26c31d7e821`; development remains six reservations/six
allocations, test has zero retained reservations/allocations. Final baseline comparison passed with
**every original row/column unchanged and no additional retained rows in either database**. Browser
and PostgreSQL suites ran separately. All owned temporary test servers stopped; user servers untouched.

Coverage limit: nightly multi-room inclusions/breakfast and scoped financial combinations were
API/PostgreSQL-tested separately; one nightly browser scenario combining every component was not run. This does
not claim exhaustive workflow parity or production readiness. Add/remove after any room has left its
reserved state is explicitly rejected; no silent reassignment, last-room removal or date divergence.
No B3 custom stay, room/type retirement, channel/payment/accounting work or production authorization.
Authenticated staff, hosted recovery and correction documents remain outside the baseline.

Stop here. The next separately authorized parity milestone is B3 room-specific custom stays; begin
with its contract/invariant review, not by removing B2's shared-stay safeguards. No commit or push.
