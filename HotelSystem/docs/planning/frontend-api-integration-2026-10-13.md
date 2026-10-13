# Frontend/API integration mapping — first checkpoint

## Phase 1 inspection and plan (before frontend behavior changes)

The current App wraps every demo route in ReservationDemoProvider. Separate React arrays
hold reservations, numeric calendar stays, guests, configuration and channel settlements.
Dashboard/expanded detail forms save full snapshots through synchronous callbacks and raw
setters. Guest creation is independent. Calendar reads stays/configured room numbers; detail
and print routes use reservation IDs. Guest cards contain additional demo-only CRM fields.
Reference configuration and lifecycle hooks also mutate local state directly.

| Existing flow | API mapping | First checkpoint |
|---|---|---|
| Calendar/list/detail reads | GET reservations (all pages) / UUID detail | Supported; canonical server data |
| Guest reads/creation | GET guests (all pages), POST guest | Supported; independent save |
| Rooms, types, durations, rates, sources/settings | GET reference-data | Read-only |
| Single-room direct create | POST reservation, required request UUID | Supported; await commit |
| Notes/adult-child edits | PATCH with expected version and request UUID | Supported; keep draft on failure |
| Room/date/source/guest reassignment, custom/multi-room | No supported PATCH/create contract | Unavailable |
| Check-in/out/cancel/no-show/departure, room readiness | No endpoints | Unavailable |
| Discounts, inclusions, breakfast, extras, adjustments | No supported create/PATCH fields | Unavailable |
| Collections, refunds, channel settlement, accounting/Odoo | No endpoints | Unavailable |
| CRM segmentation, guest edit/delete, print invoice | No verified contract | Not simulated |

Implement an explicit VITE_HMS_DATA_MODE=api branch with a separate API provider/router and
small supported reservation pane, reusing AppLayout, AvailabilityCalendar, CalendarToolbar
and hotelTime helpers. Keep the entire rich demo provider/forms/routes unchanged. Do not
give API routes demo setters or synthesize unsupported data/write success.

Compatibility risks: backend UUIDs cannot be converted to legacy numeric Stay IDs; use the
server business_number as a single-room calendar display key and retain reservation/allocation
UUIDs in canonical presentation data. ISO instants retain microseconds in raw DTOs although
JavaScript Date geometry has millisecond precision; edits must never round-trip saved dates.
Prices remain integer minor units and come from saved pricing, not current configuration.
Lists have 100-row pagination; bootstrap must load all pages without treating failure as empty.
Audit reads expose summaries, not raw before/after, so do not invent detailed audit descriptions.
No guest-update/delete, quote/availability endpoint or atomic multi-resource bootstrap exists.
Reference-based create previews must be identified as estimates; conflicts/price authority stay
on the server. A retry after uncertain network delivery must reuse the original request key;
an altered draft after an uncertain outcome must be reconciled before another write.

No schema or backend business-rule change is needed for this scope. The accepted backend
and prior worktree changes are preserved. Phase 2 results will be appended after verification.

## Phase 2 — implemented first integration checkpoint

The default remains demo. Explicit API mode uses a separate provider and route tree; it does
not mount demo pages, provide demo setters or substitute fixtures. It reuses AppLayout, calendar
views/toolbar and hotelTime helpers. The narrow reservation pane lives with reservation components;
API route composition lives under pages/api. Existing rich demo forms/stores/pages are unchanged.

- Bootstrap loads references, all guest pages and all reservation pages. Loading/failure is
  distinguished from a successful empty result. Initial failure blocks the data screens; later
  refresh errors identify the last confirmed data rather than silently replacing it with demo.
- UUIDs, allocation IDs, versions, raw microsecond timestamps and minor-unit captured prices
  remain in canonical DTOs. Calendar display keys use the server business number. Calendar
  timestamps are millisecond projections only; PATCH never sends them back. Detail/list prices
  come only from captured pricing, including saved unit rates/quantities. Creation preview is
  explicitly an estimate from reference rates; POST determines the accepted final price.
- Guest creation is independent and awaited. Reservation creation installs only a validated
  canonical server response after successful POST; it never inserts an optimistic local booking.
- Edit PATCH sends only changed notes/count fields with the captured expected version. A 409
  preserves the user's edits. Explicit latest-version loading retains dirty fields, updates
  untouched fields and requires review/save; it does not auto-resubmit or overwrite the draft.
- An unconfirmed response retains the original body/key and freezes editing/Close while allowing
  retry of that exact request. Same-key replay handles a lost response after commit. Known 409/422
  failures remain editable and show explicit errors. Duplicate submit clicks are guarded.
- Unsupported paths show a dedicated unavailable screen. API navigation omits discount/inventory
  writes; reference/room screens are read-only. Detail explicitly identifies unsupported lifecycle,
  collections, pricing adjustments and invoice printing. No disabled operation reports success.

## Setup

For the already initialized Windows workspace, double-click `HotelSystem/run-api.bat`, or
run `.\run-api.bat` from `HotelSystem`. It starts Docker Desktop if needed, brings up only
the HMS PostgreSQL container, starts FastAPI and API-mode Vite in hidden child processes,
waits for health/reference/frontend readiness and opens `http://127.0.0.1:5173`.
Keep the launcher open; press Enter to stop its API/frontend processes. PostgreSQL stays
running and its volume is retained. It refuses occupied ports instead of stopping another
service, preserves configuration files, and performs no migrations/seeding/installations.
The launcher sets API mode and its own loopback API URL only in its frontend child environment.
Timestamped logs live under ignored `logs/`. Use `run-api.bat -NoBrowser` to omit browser opening,
or `run-api.bat -CheckOnly` for prerequisites/settings/port checks without starting services.
Prerequisite and actual full-start/readiness/Enter-shutdown checks passed on this workspace.

Manual startup remains available:

From `HotelSystem/backend`, use the existing isolated environment/database:

```powershell
docker compose up -d --wait postgres
& .\scripts\python.ps1 -m uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Separate terminal in `HotelSystem`:

```powershell
Copy-Item .env.api.example .env.api.local
npm run dev -- --mode api --host 127.0.0.1 --port 5173 --strictPort
```

The local file contains only public frontend mode/API URL settings and is ignored. Do not
overwrite an existing local configuration without reviewing it. For demo, use `npm run dev`
without `--mode api`; no API requests are made. Invalid mode/URL configuration fails visibly,
never falls back. `VITE_HMS_DATA_MODE`/`VITE_HMS_API_URL` can also be set explicitly in the
process environment. Port 5173 matches the existing backend CORS policy; no backend change was made.

## Actual verification

- Frontend: **186 tests passed in 33 files** (all existing 177 plus nine client/adapter/retry tests).
- Frontend ESLint and production build passed; the existing bundle-size warning remains.
- Backend regression: **134 tests passed**; no migration drift, no backend code/schema changes.
- Genuine Chromium/React/PostgreSQL run: **ten checks passed**. Guest creation, server 422 draft
  retention, reservation refresh persistence, supported PATCH refresh persistence, stale/room 409
  protection, calendar-to-UUID detail navigation, unchanged captured price, lost-response retry
  without duplicate bookings, unavailable bootstrap/recovery and independent demo mode were verified.
- The browser harness created a synthetic company only in `hms_test`. SQL verification found two
  reservations and two unchanged revision-1 PHP 110000 pricing rows. Cleanup removed only that
  company's records. Development business data was never written. Original eight reference rows
  in both databases remain unchanged. Verification API and Vite processes were stopped.
- Fingerprint comparison of 153 pre-existing files found only the two intended entry/layout changes:
  App.tsx and AppLayout.tsx. The other 151 pre-existing files, including prior uncommitted work,
  were unchanged. Original test reports and previous failed integration runs were preserved.

Evidence: [browser results](../../booking-tests/reports/20261013T012147Z-api-integration/results.json),
[SQL verification](../../booking-tests/reports/20261013T012147Z-api-integration/postgres-verification.json),
[browser trace](../../booking-tests/reports/20261013T012147Z-api-integration/trace.zip).
The same report directory contains genuine screenshots and video. Initial failed runs exposed
unstable control labels; stable accessible names were added, then genuine checks passed.

Explicit rerun from `HotelSystem` (ports 5173/5174 must be free; unrelated servers are not stopped):

```powershell
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run.py
```

## Changed files and limits

Existing files modified: `src/app/App.tsx` (configured lazy API branch),
`src/app/layouts/AppLayout.tsx` (optional API navigation/header). New files:
`src/app/api/` client/contracts/presentation/context/provider/router/mutation hooks and tests;
`src/pages/api/ApiPages.tsx`; `src/components/reservations/ApiReservationForms.tsx`;
`.env.api.example`; `integration-tests/run.py`/`browser.mjs`; this mapping/checkpoint.
Backend README/contracts and the architecture diagram were updated to describe the connection.
Reports are local ignored artifacts. No dependencies, package files, database migrations or
backend business code were modified, and nothing was committed/pushed.

Contract limitations remain explicit: no quote/availability endpoint, no atomic multi-resource
snapshot, no audit before/after in read DTOs, no guest edit/delete/CRM fields, and no print invoice
contract. Current reads can become stale; writes rely on backend version/room checks. Display
dates have millisecond precision while canonical values retain original microseconds. Pending
drafts/request keys are held in memory for the open form; cross-tab navigation or page reload
during an unconfirmed save is not a durable draft-recovery workflow. Reload retrieves committed
server records for reconciliation. Authentication/production deployment remains out of scope.

No blocking backend mismatch was found and no backend rule/schema change was needed. Stop at
this first integration checkpoint; multi-room/custom/channel bookings, repricing/reassignment,
lifecycle, payments/refunds/settlements, accounting and Odoo remain unsupported.
