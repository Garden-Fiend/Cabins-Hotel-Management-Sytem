# Booking browser findings

134 scenarios discovered, 128 implemented, 34 traceable rules. Latest recorded outcomes across preserved batches: **125 PASS, 3 FAIL, 6 BLOCKED, 0 UNEXECUTED**. Each implemented scenario has reached the actual application UI; all hotel data and financial transactions remain simulated session memory. This is not complete production or combinatorial coverage.

## Verified failures

- [GAP-DUPLICATE-SUBMIT](reports/coverage/index.html#GAP-DUPLICATE-SUBMIT) — APPLICATION DEFECT / P0: ReservationPane.addAdjustment uses Date.now() as ID. A fixed clock reproduces equal IDs; removal filters by ID and removes both independent entries. Same-millisecond collisions are the corresponding real-clock risk.
- [GAP-CALENDAR-GEOMETRY](reports/coverage/index.html#GAP-CALENDAR-GEOMETRY) — APPLICATION DEFECT / P1: Month/Year stay buttons use px-3 plus borders. Their rendered box cannot shrink below 26px, even though inline CSS ratios retain minute precision. The six-hour bar is 26px versus intended 22px (month) and approximately 0.83px (year) at the tested viewport.
- [CONFIG-OPTIONAL-CAPACITY](reports/coverage/index.html#CONFIG-OPTIONAL-CAPACITY) — APPLICATION DEFECT / P1: ConfigurationPage.save lists capacityOverride/description/operationalNotes as optional, but the shared field renderer gives their inputs required. Native validation prevents submit before domain validation can handle blanks.

The adjustment failure is reproduced with a deterministic fixed hotel clock, making the ID collision reliable. It demonstrates the same-timestamp boundary rather than asserting collisions occur during every ordinary interaction. The geometry probe verifies minute-accurate style percentages before comparing actual rendered widths. The capacity probe supplies valid description/notes so the remaining invalid native constraint is the optional blank capacity. Application logic was not edited or repaired.

## Blocked coverage

- GAP-CAPABILITIES: All demo capabilities are granted; no UI to change identity/capabilities. Do not inject application state.
- GAP-DOMAIN-TRANSITIONS: UI cannot call hidden domain actions; existing unit tests cover some, cancellation lacks explicit domain guard.
- GAP-OCCUPANCY-INTEGERS: Whole-guest and capacity policy unclear: UI minima exist, capacity/integer enforcement appears absent; review before asserting invented limits.
- GAP-GUEST-CONTACT: Phone/email optional; no documented validation policy beyond input type; request policy review.
- GAP-CANCEL-FINANCE: Cancellation retains captured bill; automatic refund/penalty policy not documented or implemented.
- GAP-REAL-PERSISTENCE: No backend, authenticated actor or banking integration implemented.

Capability denial and invalid direct-domain calls cannot be driven through the granted-capability demo UI; contact/occupancy policies need confirmation; cancellation financial policy and real persistence/banking are unavailable. Static inspection also finds no explicit lifecycle guard in cancelReservation; this is an unverified domain concern, not a browser-discovered defect. Existing unit tests are separate evidence and are not counted as browser passes.

## Validation actually run

- Existing Vitest suite: 161 tests in 26 files passed.
- npm run lint passed.
- npm run build passed; existing >500 kB bundle-size warning remains.
- Browser suite ran in manually selected batches, with no automatic hooks or CI changes. JavaScript syntax and inventory/report consistency were checked separately.

## Preserved sessions and limitations

[Visual coverage report](reports/coverage/index.html), [execution history](reports/coverage/execution-history.json), [scenario matrix](SCENARIO-MATRIX.md), and [execution instructions](README.md). Early selector, encoding, text-comparison and browser/setup failures remain preserved and classified. No result or screenshot was fabricated; no failures were silently deleted. Tests use Chromium desktop/Asia-Manila and SPA navigation. The isolated test server disables hot reload and ignores generated artifacts after unexpected reloads were observed in development-server traces. Foreign-currency hotel setups, backend concurrency, other browsers/viewports and unsupported policies are excluded.
