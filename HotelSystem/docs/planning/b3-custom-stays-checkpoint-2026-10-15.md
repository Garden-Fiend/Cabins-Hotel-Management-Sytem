# B3 independent room stays checkpoint

October 15, 2026, Asia/Manila. Accepted baseline: B1/B2, head `b26c31d7e821`.
Session began approximately 06:44 UTC / 14:44 Manila; primary window 90 minutes, maximum 150.
Scope B3 only. All earlier uncommitted work, migration history and user business records retained.
No commit/push, dependency installation, reset/reseed, B4, accounting or ZKBioTime access.

## Allocation authority and parent compatibility

Existing allocation UUID, physical room, `scheduled_start`, `scheduled_end` and `duration_id` remain
authoritative. Pricing lines retain captured rate/kind/quantity. No new stay table/calculator.
`uses_reservation_stay` records the original Same as reservation versus Custom stay choice, even if
custom dates happen to equal the template. Existing rows default to inherited without changing dates.

Independent-mode parents retain `shared_start`/`shared_end` as legacy field names for the **derived
minimum arrival / maximum departure of nonremoved allocations**. They are never room availability
intervals. `shared_duration_id` is the actual common duration ID, or null when durations differ.
The separate `stay_defaults` is an editing template, not a second authority over custom allocations:
its start/duration persist on the parent; its checkout projection uses an inherited allocation when
one exists, otherwise previews the current hotel policy for that unused template.
Original single-room and B2 reads retain their old shape; independent records use additive
`stay_mode: independent`, `stay_defaults` and per-allocation inheritance metadata.

## Migration and safeguards

New additive revision `c37d42e8f932` follows unchanged B2 history. It adds parent mode/template fields,
an owned default-duration FK and allocation inheritance provenance. Both owned databases upgraded.
19 revisions, 19 HMS tables. No financial rows, old dates or allocation IDs were backfilled/rekeyed.

The deferred B2 trigger now distinguishes shared and independent modes: shared records retain exact
shared-date/duration checks; independent records require an exact derived range/common-duration
projection and inherited start/duration consistency. Complete active sets, valid lifecycle instants,
stable identities, immutable tombstones, composite ownership, active-room uniqueness and PostgreSQL
overlap exclusion remain enforced. Downgrade refuses unreviewed custom-stay removal; none ran.

Before applying: heads/owned constraints and six development allocations/reservations were inspected;
test business tables were empty. [Hash baseline](../../backend/verification/b3-before-20261015.json)
captures every pre-existing row/column. The first migration attempt hit a doubled constraint-name
prefix and rolled back transactionally; `op.f` corrected the unapplied revision before successful
upgrade. A mistakenly continued test invocation against that unmigrated schema failed 43 tests with
503; after upgrade the unchanged B2 suite passed 43. This was not a loss of existing business data.

## Contracts, pricing and original controls

Existing plural create/edit endpoints accept optional allocation `stay` containing UTC-aware
`scheduled_start` and owned `duration_id`. Optional `scheduled_end` is a consistency assertion:
the server rejects it unless it equals the selected package/nightly hotel-policy result. Arbitrary
quantities/kinds/client prices are not accepted. Mixed hourly/nightly stays are supported as in demo.
Omitted stay preserves historical B2 hashes; on independent edits it preserves an existing custom
stay. Explicit `stay: null` resets that room to the reservation template. No create-then-edit path.

All changed intervals are validated before writes with sorted room locks and final DB exclusion.
Add/remove/date/duration edits require every active room reserved. Counts, notes and financial
edits retain their existing supported states. Expected versions, resource-bound request keys,
server audit, atomic rollback and canonical-after-commit responses remain unchanged.
Individual/bulk lifecycle checks already use allocation instants; no parent-range shortcut added.

Only a changed duration captures a current accommodation rate; arrival-only edits keep captured
units/quantity/checkout policy, and unrelated rooms/charges remain unchanged. Existing PHP rounding,
replacement/discount order, caps, signed adjustments and zero clamp apply once. Inclusions remain
per-room with override provenance; breakfast uses each allocation's nightly dates/counts and rejects
hourly complimentary selections. Date/count reconciliation retains historical audit evidence.
Operational audit includes exact before/after facts and human-readable room-stay change events.

Billing capture schema 3 stores each independent allocation, entitlements, own schedule and pricing
schema 6. Existing capture schemas 1/2 remain unchanged and finalized documents remain immutable.
Document contents/print now list captured room stays; reservation print continues its own room list.

The original ReservationPane Custom stay/Same as reservation controls are connected for create,
edit, reset and reopen; API lifecycle restrictions disable stay controls without changing demo.
Dashboard/calendar share the same one-request adapter. Drafts survive failures and original keys
survive ambiguous response/refresh. Reviewed adapters preserve untouched remote schedules and reject
loss of locally edited breakfast choices excluded by reviewed dates/counts. Canonical projections
validate the derived range and render each allocation interval in all four original calendars.

## Executed verification / in-progress browser gate

- Complete PostgreSQL regression: **515 passed** (includes 23 initial B3 cases, B1/B2 and immutable
  document regressions). Final expanded B3 suite: **29 passed**, adding six custom-mode edit
  rollback/retry stages. Concurrent overlapping creates, different-allocation same-parent edits,
  stale/replay, mixed rates/durations, gaps versus parent span, exact financial/entitlement captures,
  reset/omission, DB aggregate enforcement and finalized capture immutability are covered.
- Complete frontend: **244 passed in 43 files**. Later focused adapter/billing/recovery tests:
  **34 passed**, including a new contradictory-range rejection. TypeScript/ESLint/build passed before
  the final small projection/review refinements; final checks are still pending below.
- New `run-custom-stays.py` / `browser-custom-stays.mjs` use a guarded random synthetic company in
  `hms_test`, real React controls, SQL assertions and an owned API restart. Browser gate in progress;
  passing individual checks do not yet establish completion.

Early test failures retained in session evidence: fixture imports removed by lint; cleanup needed
to clear both synthetic mode flags in one transaction; a datetime arithmetic precedence error was
fixed; the financial inclusion-override test needed an actual room-type default. The two failed
teardown companies were cleaned by exact UUID in guarded `hms_test`, not by broad counts/name matching.
Old/test-owner document cleanup retains its exclusive-lock transaction and re-enables the trigger.

Failed browser reports retained: `070256Z` exact Duration accessible-name selector; `070418Z`
assumed a shared hourly default without selecting it; `070730Z` read the document before finalize
completed; `071031Z` passed ten checks then exposed a simulated-clock leak into the main lifecycle
page. The harness now selects the shared duration explicitly, waits for the final bill number, and
isolates overdue simulation in a separate browser context. No application assertion was weakened.

## Files / reproduce

New: `backend/app/modules/reservations/allocation_stays.py`, the additive migration,
`backend/tests/test_custom_stays.py`, `src/app/api/allocationStayInputs.ts`, custom browser/SQL runner,
preservation baseline and this checkpoint.
Modified: existing reservation models/plural DTO/service/read/lifecycle/router/hash compatibility,
reference capability, billing capture selection/types; original command types/pane, API contracts/
bridge/adapters/projections/tests, allocation details and billing-document contents; synthetic cleanup.
Earlier shared-file changes retained. No new dependencies/tables.

From `HotelSystem`, run browser harnesses separately from PostgreSQL suites:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-custom-stays.py
& .\backend\scripts\python.ps1 integration-tests/run-multi-room.py
npx vitest run src/app/api/multiRoom.test.tsx src/components/billing/BillingDocuments.test.tsx src/app/api/useMutation.test.ts --maxWorkers=2
npm run lint
npm run build
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_custom_stays.py tests/test_multi_room.py tests/test_initial_financials.py tests/test_billing_documents.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b3-before-20261015.json
```

## Final acceptance

**B3 COMPLETE within the authorized boundary.** Final targeted PostgreSQL: **121 passed**
(31 B3, 43 B2, 20 B1, 27 immutable-document cases). The earlier complete run was 515 passed;
these overlap, not additional distinct tests or a claim of a second complete regression. Final affected
frontend/billing/recovery: **34 passed in three files**, including seven B3 projection/adapter cases.
The earlier complete frontend run was 244 passed. Final TypeScript, ESLint/build, Ruff lint/format,
dependency consistency, Alembic drift and whitespace checks passed. Existing TestClient/bundle warnings
remain non-failing. No dependencies or warning suppression were introduced.

[Final custom-stay browser: 13 checks passed](../../booking-tests/reports/20261015T072024Z-custom-stays/results.json),
with [actual PostgreSQL/API-restart verification](../../booking-tests/reports/20261015T072024Z-custom-stays/postgres-verification.json).
Three reservations, six allocations, five historical pricing revisions and one immutable schema-3
final bill survived restart. Raw SQL compared individual starts/ends, durations, inheritance flags,
occupancy and pricing captures, not parent dates alone. The original Dashboard/calendar create,
refresh, original-key ambiguous replay, arrival/duration edit, explicit inherited reset/reopen/no-op,
all four calendar intervals and overdue colors, individual/strict bulk lifecycle, reservation print,
captured bill/PDF and independent demo all passed. Trace/video/screenshots and a separate overdue
clock-context trace remain in the report directory. The clocks never alter server lifecycle time.

[B2 browser regression: 12 checks passed](../../booking-tests/reports/20261015T072110Z-multi-room/results.json),
and [existing rich regression: 26 checks passed](../../booking-tests/reports/20261015T072153Z-rich-api-integration/results.json),
both followed by actual SQL/restart checks. PostgreSQL suites and synthetic browser harnesses ran
separately. Owned temporary processes stopped; user-owned servers remained untouched.

A final targeted test demonstrated one application defect after the first passing browser run:
resetting a newly captured custom stay after its duration definition changed could retain that room's
old quantity/end instead of the inherited template's booked basis. Resolution now adopts the template
basis and revises only the affected room if quantity/package changes. End-only changes are also
availability-checked; inheritance/template changes are rejected after check-in, even if dates match.
The new failing case then passed in the final 121-case run. Its uncommon definition-change/reset
combination is API/PostgreSQL-verified, not separately browser-verified.

Further harness failures remain preserved: `071221Z` passed twelve API-mode checks, then tried to
open a demo room card already expanded automatically; its helper now respects the original open state.
`071505Z` subsequently passed all thirteen plus restart; the final `072024Z` rerun also checked raw
SQL dates after the final application correction. No failed evidence was relabeled.

Final read-only inventory: both heads **`c37d42e8f932`**, development still six reservations/six
allocations, test zero retained reservations/allocations. The post-cleanup hash comparison found
**every pre-existing row/column unchanged, with no additional retained rows in either database**.
New defaulted columns are excluded explicitly by the original-column preservation method.

Limits: all rooms must remain reserved for schedule, inheritance, template or membership edits.
Arbitrary checkout outside a configured duration, post-arrival extension/reassignment, B4 retirement,
channel/payment/accounting and public deployment remain outside this milestone. Not every nightly
entitlement/discount combination was separately browser-exercised; the focused financial/entitlement
and concurrency cases are PostgreSQL-tested. No known B3 integrity blocker remains.

Stop here. No B4 work started and no commit/push performed. Next separately authorized milestone:
review B4's room/type retirement semantics and existing historical-reference controls; do not begin
another repository-wide parity audit or repeat the successful B3 suites without a specific reason.
