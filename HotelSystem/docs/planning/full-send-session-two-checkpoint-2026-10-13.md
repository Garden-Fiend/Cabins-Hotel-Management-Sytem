# Resumed integration checkpoint

Date: October 13, 2026, Asia/Manila. Continuation authorized by “proceed”.
Earlier evidence: [first-session checkpoint](full-send-integration-checkpoint-2026-10-13.md).
No commit or push. Existing uncommitted work and development business records were retained.

## Post-checkpoint correction: dedicated room creation (historical defect)

User review identified a missed entry point: **Rooms → Add room fails in API mode** with
“Select a valid operational status.” The demo form intentionally has no status selector and
defaults to `operational`; the API projection exposes `api-operational`/`api-blocked`.
The dedicated form retains the demo ID and fails frontend validation before submitting.
The recorded browser checks exercised **Configuration → Rooms**, not this dedicated creation path.
Those historical results remain valid for the paths actually tested; they do not establish complete
room-creation parity. This is an integration defect, not an unsupported backend feature.

The user required inspection without application edits. No fix had been applied at the time of that inspection. The subsequent authorized correction is verified in [room status correction](room-operational-status-2026-10-13.md).
The hard demo-behavior preservation and per-entry-point verification restriction is now recorded
in [AGENTS.md](../../AGENTS.md). **On authorized implementation, fix and verify dedicated room
creation before starting discounts or other new features**, preserving its automatic Operational
default and testing demo/API create, reset/reopen, edit and failed-save behavior.

## Verified persistent functionality

| Workflow | Completed boundary |
|---|---|
| Room readiness | Fixed SQL-row/DTO projection; restored route/capability; original Start cleaning / Mark Clean persist Dirty → Cleaning → Clean after checkout and refresh |
| Room/type/rate/duration configuration | Original Configuration creates definitions and edits rooms/types; optional text/capacity clears persist; server versions, ownership, uniqueness and captured-price preservation verified |
| Primary guest changes | Original guest selector saves through a separate versioned details command; notes/counts/pricing remain intact |
| Pre-arrival room/stay changes | Confirmed/reserved single-room reassignment and duration changes persist atomically; stable allocation identity, overlap protection and old pricing revisions retained |
| Manual adjustments | Original add/remove controls persist exact signed PHP amounts with distinct UUIDs and reasons; failed saves retain drafts; old captures/audit retained |
| Catalog | Original Inventory creates ordinary categories/products, edits exact-cent prices, preserves drafts on failed saves and reloads real records |
| Purchased items | Original room settings add/edit/remove purchase lines; server captures product prices; subsequent catalog changes do not reprice existing lines; print totals agree |
| Existing create/read/PATCH/lifecycle/demo | Existing flows remain passing; demo stays independent of FastAPI |

Configuration and billing are **partial overall**, not full feature parity. Product/category
archive/restore handlers are implemented but were not separately exercised through the browser.
Room/type archive/deletion controls, source/settings writes, extra-charge category definitions,
discounts/presets, inclusions/default entitlements, breakfast, payment/collection/channel workflows,
multi-room/custom stays, full pricing-history/audit presentation and accounting/Odoo remain unsupported
or incomplete. Unsupported persistent actions remain gated; breakfast configuration is explicitly
disabled within the now-enabled Inventory page. Availability is read from persisted reservation/reference
snapshots with authoritative write-time guards; no separate availability-query endpoint was added.

## Command and integrity decisions

Original create and notes/count PATCH DTOs and request hashes remain intact. Separate commands:
`edit-details`, `edit-stay`, `edit-billing`, `edit-charges`, `edit-stay-charges` under
`POST /api/v1/reservations/{id}/...`. Each uses expected version, UUID request key, company ownership,
server audit, durable receipt and one transaction. Mixed supported edits use one command rather than
multiple partially successful saves. Stale edits return 409. Explicit conflict review preserves the
draft and sends only changed fields, retaining untouched remote guest/count/stay facts and raw timestamps.

Room transfers acquire old/new room locks in UUID order, consistent with lifecycle/availability
boundaries. Final PostgreSQL `[start,end)` exclusion protection remains active. Inconsistent inactive
pre-arrival allocations reject rather than being silently repaired. Room/duration changes append a
current-rate capture; arrival-only changes preserve booked duration and original checkout policy.
Existing charges/adjustments survive reassignment. Financial editing matches the existing UI's
confirmed/reserved/checked-in access; final lifecycle states reject new bill commands. This is
operational editing, not an official accounting posting cutoff or immutable ledger.

Pricing schemas 1/2/3 represent accommodation, adjustments and purchases respectively; old snapshots
are not rewritten. Exact integer totals are clamped at zero and bounded to JavaScript's safe monetary
range. New purchase intents accept product/line identities and quantity, never client prices. Existing
line quantity changes retain captured unit prices/labels. Removed purchase identities cannot be reused.
New API line identities use checked secure UUIDs outside replayed React state updaters; demo identity
behavior is preserved. Raw reference minor amounts are retained for precise form reopening/toggling.

## Database and migrations

Both isolated `hms_dev` and `hms_test` are at **3b36715627c4**, with 14 HMS tables and the same six-revision
history. New additive revisions in this resumed session:

- `e921a6830fc4`: reference versions, room/type metadata and case-insensitive definition uniqueness.
- `3b36715627c4`: owned category/product catalog with versions, exact PHP prices and composite ownership FK.

No reset, downgrade, automatic repair, fixture import or seed overwrite. Existing rows/columns in both
databases match the fresh hash-only session baseline. New catalog tables are empty after synthetic test
cleanup. The existing development guest/reservation and their receipts/audit/pricing remain present.
ZKBioTime Python, database and storage were not used. No dependencies were installed for this session.

## Actual verification

- Full backend PostgreSQL suite: **247 passed**, no skipped cases.
- Full frontend: **193 passed in 35 files**. ESLint and production build passed.
- Ruff lint/format, dependency consistency, Alembic drift/head and `git diff --check`: passed.
- Real browser evidence: [15 checks](../../booking-tests/reports/20261013T065121Z-rich-api-integration/results.json),
  [SQL verification](../../booking-tests/reports/20261013T065121Z-rich-api-integration/postgres-verification.json).
  Trace/video/screenshots are in the same directory. Two synthetic reservations and eight historical
  pricing rows were checked; records/reference changes survived a real API restart, then only the
  synthetic company was cleaned from `hms_test`. Development business data was not written by tests.
- [Current environment inventory](../../backend/verification/current-integration-audit-20261013T064140Z.json)
  verifies owned Python, separate DBs, UTC and migration heads without requiring empty business tables.
- [Preservation baseline](../../backend/verification/session-two-data-before-20261013.json) stores hashes,
  not guest/contact contents. Comparison permits/report new tables without weakening original-row checks.

Boundary tests cover competing transfers/edits, identical-key concurrent purchase replay, stale/key
conflicts, strict validation, ownership, exact totals/zero clamp, historical captures and failures after
each write plus immediately before commit. Earlier failed browser runs remain preserved: selector/setup
errors and outdated SQL expectations were corrected, not relabeled PASS. The final review found and
fixed missing room-type version projection and exact-price reopening before the latest browser run.
Existing non-failing TestClient deprecation and bundle-size warnings remain.

## Files and execution

Created: configuration `models/schemas/services/router`; billing `adjustments.py`, `charges.py`;
reservation `stay_edit.py`; the two migrations above; configuration tests; current environment audit;
API `definitionInputs.ts`, `reservationEditInput.ts` and its tests; `reservationCharges.ts` and tests;
hash-only evidence and timestamped browser artifacts; this checkpoint.

Modified for this continuation: backend models/main, reservation schemas/services/router/references/
readiness and focused tests, synthetic cleanup/preservation scripts; API client/contracts/provider/store/
bridge/presentation, domain configuration/context types, original ReservationPane, ConfigurationPage,
RoomsPage and InventoryPage; browser runner; backend README/contracts and Mermaid architecture.
Earlier-session changes in overlapping files were retained.

From `HotelSystem`:

```powershell
.\run-api.bat
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
```

From `backend`:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/audit-current-integration.py
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/session-two-data-before-20261013.json
```

Restart an older launcher normally before running the current backend/frontend together. User-owned
servers were not terminated. Temporary verification processes were stopped; PostgreSQL remains running.
Do not run the legacy global-count backend suite concurrently with the browser synthetic-company harness.
The old `audit-foundation.py` intentionally describes its historical foundation baseline; do not replace
that evidence to make it accept authorized integration changes.

## Concerns and next task

The dedicated room-creation defect was subsequently corrected and its original demo/API entry points verified; see [room status correction](room-operational-status-2026-10-13.md). Other unsupported room controls remain outside that correction. Authentication/public deployment, durable authorized
staff identity, hosted migration/backup process and database-enforced financial immutability remain future
work. New pricing schemas require the current API/frontend together. Catalog persistence is not stock
tracking; operational purchases/adjustments are not accounting invoices or payment records.

**Next first task, when implementation is authorized:** implement server-authoritative manual discounts using the existing documented
sequential scope/eligible-balance/capping rules, retaining captured purchase/accommodation prices and
historical revisions; then connect the original discount controls and verify failure/concurrency/refresh.
Keep preset configuration, entitlements, payments and multi-room expansion separately bounded.


## Wednesday continuation

Manual discounts were subsequently implemented in the original API-backed controls.
See [October 14 checkpoint](manual-discounts-checkpoint-2026-10-14.md) for current verification,
limits and the next bounded slice. The October 13 results above remain historical evidence.
