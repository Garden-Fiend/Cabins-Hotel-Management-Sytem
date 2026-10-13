# On-demand booking browser tests

Remediation results: [implementation and verification summary](../docs/investigations/hms-defect-remediation-results.md). Three additional `REMEDY-*` cases cover optional clears/room safety, archived metadata, and subpixel calendar interaction. Runs now record source SHA-256 manifests in `environment.json` and browser/clock metadata per case. Existing session reports remain unchanged.

To consolidate completed remediation sessions without executing tests, run `node booking-tests/consolidate-remediation.mjs <older-session-directory> <newer-session-directory>` from `HotelSystem/`. This creates a new timestamped report and refuses to combine differing application source fingerprints. Earlier failures stay linked; consolidated statuses use the latest actual outcome for each selected scenario.

Run from `HotelSystem/`. No hooks, CI, watcher, application state injection, production writes, or app-logic changes are used. The repository had no existing Playwright utility; this isolated directory adds it. `npm test` remains the existing Vitest suite because browser files use `.pw.mjs`, not `.test`/`.spec` names.

```powershell
npm install
npx playwright install chromium
node booking-tests/run.mjs --list
node booking-tests/run.mjs --scenario BOOK-STA-1
node booking-tests/run.mjs --module discounts
node booking-tests/run.mjs --priority P0
node booking-tests/run.mjs --full
node booking-tests/run.mjs --full --resume booking-tests/reports/coverage/results.json
```

To select an already running local application, append `--base-url http://127.0.0.1:5173`. Otherwise the runner starts an isolated Vite server at port 5173 and shuts it down when done. This test-only server imports the application Vite configuration and disables hot reload/file watching of test artifacts; it prevents generated reports or harness edits from resetting in-memory records. Normal application configuration is unchanged. An occupied port is a setup failure, not permission to silently test a different application. Optional `--headed` shows the browser; `--list` appended to a selection provides a dry run. `--scenario ID1,ID2` selects a small batch. `--resume PATH` excludes only PASS cases in the specified saved results; failed, blocked and unexecuted cases remain selected. Do not point this demo suite at an external production service.

Each explicit run creates `booking-tests/reports/<UTC timestamp>-<pid>/` with an HTML coverage report (`index.html`), machine-readable scenario results, selection manifest, genuine step/final screenshots, and Playwright's HTML report. Failed tests retain video and trace. No retries disguise failures. Earlier sessions are preserved; reports are ignored by Git but remain on disk. Pending implementation/unsupported scenarios are explicitly reported as BLOCKED if selected; excluded cases remain UNEXECUTED. Selected executable gaps are blocked for missing test implementation, not claimed as application failures.

`booking-tests/reports/coverage/index.html` aggregates the latest result per scenario across preserved sessions; `execution-history.json` retains earlier outcomes and triage annotations. Run `node booking-tests/aggregate.mjs` to rebuild it without executing tests. Reports update after each completed case, so an interrupted batch retains progress. Re-running a corrected harness case creates a new session; it never erases the previous failure. Stable `GAP-*` IDs remain unchanged when a previously pending case is implemented.

Every test gets a new browser context and fresh seeded in-memory application. Hotel time uses Playwright's fixed Date clock, while timers keep running so the save UI can complete. Navigate using SPA links within a scenario to preserve its state. Reload is used only to test the documented reset behavior. No backend responses or saved records are fabricated.

`matrix.mjs` defines scenario prerequisites, inputs, independent expected results, priority and rule links. `SCENARIO-MATRIX.md` and `scenario-matrix.json` are generated with `node booking-tests/inventory.mjs`. Edit the inventory before implementing a new case, then regenerate it. Rules supported only by implementation are identified as contracts for regression, not assumed correct product policy. Review the policy questions and explicit gaps before expanding coverage.

`booking.pw.mjs` executes the selected cases through the UI. `ui.mjs` makes actions visible as numbered Playwright steps and captures screenshots after each significant step, including failed steps. Assertions verify amounts, validation, transitions, snapshots and UI synchronization. Browser exceptions, console warnings/errors, request failures and HTTP errors are recorded; unhandled exceptions/network failures fail an otherwise passing scenario. Console messages remain evidence rather than automatically converting framework warnings into booking defects.

Reports intentionally distinguish real browser/UI evidence from simulated hotel operations. Collection references and accounting documents entered by the suite are fictional test data; no real money moves. There is no claim of complete production, security, persistence or combinatorial coverage.

Implementation uses Playwright's [clock](https://playwright.dev/docs/clock) and [reporter APIs](https://playwright.dev/docs/test-reporters).
