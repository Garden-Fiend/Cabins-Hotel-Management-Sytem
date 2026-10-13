# HMS defect remediation and regression results

Date: 2026-10-12, Asia/Manila. Scope: the three approved defects and their authorized preventive safeguards. Implementation is complete; this report does not certify production readiness.

## Results and evidence

**27 targeted browser scenarios PASS; 0 outstanding FAIL; 0 BLOCKED in that selection.** The consolidated report excludes 110 inventory scenarios from this rerun; they must not be counted as newly passing tests. The cumulative inventory has 137 scenarios, including three added remediation cases. Its latest recorded outcomes are 131 PASS and six previously BLOCKED cases, drawn from multiple preserved runs.

- [Consolidated screenshot report](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/index.html): 363 numbered steps, 390 actual step/final screenshots. No console warnings/errors or page errors in the 27 selected passing outcomes.
- [Consolidated machine-readable assertions and artifacts](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/results.json).
- [Tested source manifests and execution environments](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/environment.json).
- [Main verification session](../../booking-tests/reports/2026-10-12T02-42-48-937Z-11568/index.html): 23 PASS, four ambiguous-selector failures retained unchanged.
- [Corrected selector and expanded room verification session](../../booking-tests/reports/2026-10-12T02-48-06-855Z-20840/index.html): five PASS. These replace the four failed boundary outcomes and strengthen room assertions; they do not erase the earlier failures.
- [Cumulative coverage](../../booking-tests/reports/coverage/index.html) and [execution history](../../booking-tests/reports/coverage/execution-history.json) retain earlier defect and harness outcomes.

Both consolidated sessions have the same application source fingerprint: `73e3e73e8fa3628ff27b69f32a83961aa7a7675b953f914c45513a9149c946ba`. The base Git revision is `c0d25a5bc06f689d2ef2d9653b1ec9b787595ebd`, with an uncommitted working tree. Per-file SHA-256 manifests record the actual tested sources; the base commit alone is not the implementation revision. Test-harness refinements are recorded separately in each session manifest.

Environment: Windows, Node version recorded in the manifest, Chromium **156.0.8078.4**, `en-PH`, Asia/Manila, initial viewport **1600 × 1050**. The interaction case also checks **1024 × 768** and horizontal scrolling. Browser clock: `2026-11-10T15:00:00+08:00`; future year/leap cases navigate the calendar to their test dates while retaining this deterministic clock. All business operations are simulated in provider memory; no real hotel records, payments or backend were modified.

## Confirmed fixed defects

| Defect | Preserved before evidence | Verified after behavior |
|---|---|---|
| Adjustment collision/removal, P0 | [Original fixed-clock failure](../../booking-tests/reports/2026-10-12T01-01-04-925Z-4912/index.html#GAP-DUPLICATE-SUBMIT): equal timestamp IDs; removing +100 also removes +200 | [After](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/index.html#GAP-DUPLICATE-SUBMIT): 1100 +100 +200 =1400; removing +100 retains +200 and 1300; Save, detail, document print and readable audit agree; no duplicate-key warnings |
| Optional room edits, P1 | [Original capacity failure](../../booking-tests/reports/2026-10-12T01-04-33-985Z-5888/index.html#CONFIG-OPTIONAL-CAPACITY): blank optional capacity blocks native submit | [After](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/index.html#CONFIG-OPTIONAL-CAPACITY): room 102 saves Dirty readiness with blank capacity; expanded cases clear descriptions/notes independently and all optional fields together |
| Calendar geometry, P1 | [Original geometry failure](../../booking-tests/reports/2026-10-12T01-04-33-985Z-5888/index.html#GAP-CALENDAR-GEOMETRY): month/year bars both render 26px | [After](../../booking-tests/reports/2026-10-12T02-50-00-567Z-remediation/index.html#GAP-CALENDAR-GEOMETRY): proportional widths and actual start/end edges pass within 1 CSS px in all four views; separate short-stay markers and deterministic chooser preserve discoverability |

Measured original six-hour interval, Nov 10 14:07–20:07:

| View | Expected width, CSS px | Before actual | After actual |
|---|---:|---:|---:|
| Day | 384 | 384 | 384 |
| Week | 42.7142857 | 42.703125 | 42.703125 |
| Month | 22 | 26 | 22 |
| Year | 0.8305556 | 26 | 0.828125 |

The corrected assertions additionally measure both actual bounding-rectangle edges, rather than relying on inline percentages alone. Midnight, month-end, year-end, leap-year and minute-offset cases check saved/printed timestamps and year-column geometry. Year clipping at December 31 retains the visible-range boundary without modifying stored timestamps.

## What changed

Financial adjustments use a focused helper with secure UUID generation, eight bounded attempts, local uniqueness validation and explicit generation failure. Synchronous draft refs serialize rapid accepted additions without generating randomness inside replayable React updater callbacks. Removal requires exactly one matching identity; unknown identities remove nothing. Save checks nonempty/unique identities before the no-op save path. Legacy duplicate records are preserved and require a reviewed repair. The pane shows an integrity warning; audit formatting enumerates ambiguous historical values rather than collapsing them into a seemingly complete Map diff. Raw audit entries and existing non-UUID IDs are not rewritten.

Room editors share validation and normalization. Display name is an optional stored override, with room-type fallback derived for presentation. Blank descriptions/notes stay empty strings; cleared capacity stays undefined. Supplied capacity remains a positive integer. Replacement starts from the existing room, preserving stable ID, archive state, occupancy lock and hidden metadata. The generic readiness path rejects changes on occupied/locked rooms, and its disabling guard matches active-assignment safety. Assigned room-number changes are rejected rather than attempting a migration. Historical room-type references remain available for existing records, while inactive types are excluded from new selections.

All four calendar views use a small shared stay layer without changing positioning helpers or availability calculations. Time buttons have no horizontal padding, layout border or external margin. Positioned labels cannot enlarge the interval and are visually hidden below 80px while retaining accessible identity. Below one CSS pixel, a distinct diamond is anchored to the timestamp with a separate transparent 16px-wide interaction target. Competing targets are collected and ordered by start time/ID; pointer interaction opens an explicit chooser. Keyboard activation identifies the focused stay directly. Accessible names/title/details include guest, room, status and exact times. Empty-cell booking actions remain available outside the local target. No continuous zoom or new calendar library was added.

## Verification

| Check | Final result |
|---|---|
| `npm test` | **177 tests PASS in 31 files**, default command, 27.70s final run |
| Reduced-concurrency diagnostic, `npm test -- --maxWorkers=2` | All 177 PASS before final default-command verification |
| `npm run lint` | PASS |
| `npm run build` | PASS; existing >500kB bundle warning remains, current JS bundle approximately 615kB |
| `node booking-tests/validate.mjs` | PASS: 137 scenarios, 34 rules; every linked step/final screenshot exists |
| Targeted browser selection | **27 PASS**, 390 actual screenshots |

Sixteen focused unit/component regressions were added. They cover bounded UUID retries and unavailable generation, legacy string IDs, duplicate/missing save identities, no bulk deletion, real pane save rejection including no-op Save, historical audit ambiguity without rewriting values, optional-field normalization, valid references, positive integer capacity, dynamic/custom display names, locked readiness, exact subpixel geometry, explicit target choice and half-open target boundaries.

Browser selection:

```text
GAP-DUPLICATE-SUBMIT
BILL-ADJ-POS, BILL-ADJ-NEG, BILL-ADJ-FLOOR
BILL-ADJ-INVALID-ZERO, BILL-ADJ-INVALID-REASON
DISC-FIXED, DISC-PERCENT, DISC-SEQUENCE, DISC-ITEM
CONFIG-OPTIONAL-CAPACITY, CHECKIN-DIRTY
REMEDY-ROOM-CONTRACT, REMEDY-ROOM-METADATA
GAP-CALENDAR-GEOMETRY, CAL-EXTEND, REMEDY-CALENDAR-INTERACTION
TIME-MIDNIGHT, TIME-MONTH, TIME-YEAR, TIME-LEAP, TIME-MINUTE
AVAIL-TOUCH, AVAIL-CONFLICT, AVAIL-OCCUPIED
PRINT-DOCUMENT, PRINT-THERMAL
```

Expanded room evidence verifies independent text clears, removal of a previously supplied capacity, capacity 1 acceptance, 0/-1/1.5 rejection, consistent fallback/custom names, archived-state preservation, occupied readiness rejection, and continued occupancy blocking after a legitimate descriptive edit. Pure shared-validator tests reject nonnumeric capacity and invalid/duplicate required references. Legacy-corruption testing uses explicitly synthetic unit/component fixtures, not injected browser/provider data claimed as genuine UI evidence.

Intermediate failures were not hidden: a blocked port startup, ambiguous print/room selectors, attempting to archive a seeded assigned room, and matching fourteen year-view John Doe stays were harness/setup issues corrected through more precise fixtures/selectors. Initial unit runs exposed absent ResizeObserver support in jsdom; a guarded resize-listener fallback resolved it. Existing Dashboard queries were updated for richer accessible names. Two long Dashboard workflows now allow 15s without removing assertions, avoiding the earlier 5s timeout/cascading failures under concurrent load. The final ordinary `npm test` passes. Temporary lint/build failures during editing were corrected and checked again against stable sources.

The temporary test server was stopped after browser verification. There are no new background services, CI hooks or automatic test triggers.

## Modified files

Application and regression source modified:

- `src/components/reservations/ReservationPane.tsx`
- `src/lib/reservationAudit.ts`
- `src/pages/ConfigurationPage.tsx`
- `src/pages/RoomsPage.tsx`
- `src/pages/DashboardPage.test.tsx`
- `src/components/calendar/DayCalendar.tsx`
- `src/components/calendar/WeekCalendar.tsx`
- `src/components/calendar/MonthCalendar.tsx`
- `src/components/calendar/YearCalendar.tsx`

New focused source and tests:

- `src/lib/reservationAdjustments.ts`
- `src/lib/reservationAdjustments.test.ts`
- `src/lib/reservationAdjustmentAudit.test.ts`
- `src/lib/roomConfiguration.ts`
- `src/lib/roomConfiguration.test.ts`
- `src/lib/calendarInteraction.ts`
- `src/components/calendar/CalendarStayLayer.tsx`
- `src/components/calendar/CalendarStayLayer.test.tsx`
- `src/components/reservations/ReservationAdjustmentIntegrity.test.tsx`

On-demand harness and documentation:

- `booking-tests/booking.pw.mjs`
- `booking-tests/configuration-cases.mjs`
- `booking-tests/matrix.mjs`
- `booking-tests/run.mjs`
- `booking-tests/ui.mjs`
- `booking-tests/consolidate-remediation.mjs` (new, explicit report generation only)
- `booking-tests/SCENARIO-MATRIX.md`, `booking-tests/scenario-matrix.json` (regenerated inventory)
- `booking-tests/README.md`
- `docs/investigations/hms-defect-remediation-results.md` (this report)
- New timestamped `booking-tests/reports/` evidence and refreshed cumulative coverage; historical session artifacts are retained.

Pre-existing package/lockfile/.gitignore changes belong to the earlier test-infrastructure task. This remediation added no dependencies and did not alter those files or seed data. The investigation and original FINDINGS remain historical baseline documents.

## Remaining limitations and deferred work

- **Failed tests:** none outstanding in the final selected browser outcomes or final unit/lint/build checks. Intermediate failures remain preserved and explained above.
- **Blocked tests:** the six existing cumulative gaps remain: capability-denial UI, hidden direct domain calls, whole-guest/capacity policy, contact-validation policy, cancellation financial policy, and real persistence/banking. They were not resolved or counted as newly executed in the targeted 27-case report.
- **Unverified behavior:** Firefox/WebKit, physical touchscreen devices, other deployment/browser combinations, exhaustive timestamp/viewport combinations and actual legacy datasets. The tested short-stay target is 16px wide; this is not a certification of mobile touch accessibility. No audit/data migration was performed.
- **Deferred architecture:** backend persistence, cross-device uniqueness/concurrency, authenticated audit, idempotency, posting/finalization/reversal workflows, journals, payment processing, permissions and Odoo/Supabase integration. Approved lifecycle direction is documented, but no posting states were introduced.
- **Production limitation:** all operational/financial data remains transient in-memory state. These fixes correct the approved defects; durable operation and production readiness require separate work.
