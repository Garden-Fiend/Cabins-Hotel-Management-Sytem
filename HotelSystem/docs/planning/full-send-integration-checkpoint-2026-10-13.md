# Full-send integration sprint — paused handoff

**Historical first-session checkpoint.** The user resumed this work; use the
[completed second-session checkpoint](full-send-session-two-checkpoint-2026-10-13.md)
for the current implementation and next task. The gated readiness failure below was subsequently fixed.

Date: 2026-10-13, Asia/Manila. User requested stopping at a resumable checkpoint. No commit/push. Existing uncommitted work preserved. **Resume from this document, not the earlier parity estimate.**

## Verified persistent checkpoints

**A — Original rich UI:** ApiApp now routes the original DashboardPage, ReservationPane, ReservationDetailPage, ReservationsPage, GuestsPage and ReservationPrintPage. Inventory/discount/configuration routes and navigation remain present with unsupported writes disabled. RichApiBridge projects only server references and canonical captures, supplies explicit awaited commands and prevents raw local setters from pretending to persist. Guest creation remains independent. Notes/count PATCH uses the captured expected version, retains draft on failure and allows explicit conflict review without overwriting remotely changed untouched counts. Saved prices come from captured server amounts. UUIDs, versions and raw instants remain in ApiProvider canonical DTOs; Date and decimal amounts are presentation projections only.

Uncertain request body/key/target is retained in tab-scoped sessionStorage, scoped by API URL/company/operation, and cleared after a definitive outcome. Recovery does not automatically submit a new command. A mounted draft must finish its original save rather than use an external confirmation button to create another intent. This is request recovery, not a persistent offline booking store. Sensitive draft/contact payloads live only for that tab's pending-request recovery; no demo fallback.

**B — Single-room lifecycle:** Explicit POST check-in/check-out/cancel/no-show/record-departure commands require positive expected_version and UUID Idempotency-Key. Cancellation requires strict guest_has_vacated. Transaction owns reservation lock, room lock, allocation lock, actual instants, occupancy pointer, housekeeping, version, before/after audit and receipt. Server supplies mutation time; scheduled endpoints, original prices and all captured pricing revisions remain unchanged. Cancelled guests still present retain physical occupancy until departure. Checkout/departure release occupancy and mark Dirty. No-show rejects before scheduled arrival. Existing future reservations are preserved. API capabilities control whether original lifecycle buttons activate.

Browser evidence: `booking-tests/reports/20261013T025246Z-rich-api-integration` passed original create/edit/conflict/network-recovery/print/demo and real backend restart checks. `booking-tests/reports/20261013T030926Z-rich-api-integration` additionally passed original check-in/checkout, dirty handoff, early-no-show rejection and cancellation/refresh. Genuine trace/video/screenshots/results and SQL preservation checks are in those directories. Earlier failed harness runs are preserved, not relabeled PASS. Browser evidence predates the final additive room-version extension; lifecycle PostgreSQL tests were repeated after that migration.

## Partial C — intentionally gated, exact resume point

Migration **bc7a419f2d30**, following 82f79142cdbd, adds rooms.version (non-null default 1, positive CHECK). It upgraded both owned databases; Alembic current/check showed head/no drift. Existing lifecycle room changes now advance room version. No reset/downgrade/record repair occurred.

Room readiness service/client/provider/UI scaffolding exists but **is not verified and is unavailable**. Its `/rooms/{id}/readiness` registration and `room.readiness.v1` capability were removed at the user's stop request. Original Rooms controls remain disabled for API readiness. The unfinished service is `backend/app/modules/reservations/readiness.py`; it has version/key/ownership/occupancy/rollback boundaries but failed valid-success tests.

Observed pre-gate readiness run: **6 failed, 29 passed** across readiness + lifecycle. Valid readiness requests returned 500 `Saved data requires integrity review`; no partial state survived. This is the application's Pydantic saved-data error, not evidence of an existing corrupt database. Likely immediate cause: `RoomRead.model_validate(updated)` receives the complete SQL row including company_id, while DTO extra fields are forbidden. Existing reference reads explicitly project only DTO fields. This diagnosis is source-supported but the correction was deliberately **not made** after the stop request.

`backend/tests/test_room_readiness.py` has an explicit module skip while this disabled feature is unfinished (12 cases). Skipping it is not a success claim. Its original failures are recorded above. **Next task:** project returned SQL row to RoomRead.model_fields; restore the readiness route for isolated tests while retaining the disabled advertised capability; remove that explicit skip; run the 12 readiness cases and lifecycle suite. Only after success, advertise readiness and verify Start cleaning/Mark Clean in the original Rooms page after checkout, refresh and API restart. Do not implement broader configuration CRUD before finishing this slice.

## Files created/modified by this sprint

Created: `src/app/api/RichApiBridge.tsx`, `richPresentation.ts`; backend reservation `lifecycle.py`, `readiness.py`; migration `bc7a419f2d30_room_readiness_version.py`; tests `test_reservation_lifecycle.py`, `test_room_readiness.py`; `backend/scripts/verify-sprint-data.py`; hash-only `backend/verification/full-send-data-before-20261013.json`; `integration-tests/browser-rich.mjs`, `run-rich.py`; this checkpoint.

Modified: `src/app/api/ApiApp.tsx`, `ApiProvider.tsx`, `client.ts`, `contracts.ts`, `store.ts`, `presentation.ts`, `useMutation.ts`, `useMutation.test.ts`; `src/app/reservationDemoStore.ts`, `useReservationActions.ts`, `layouts/AppLayout.tsx`; `src/components/reservations/ReservationPane.tsx`; DashboardPage, ReservationDetailPage, ReservationsPage, GuestsPage, RoomsPage; `src/types/reservation.ts`, `src/features/configuration/types.ts`, `src/data/datasample.ts`; backend reservation `models.py`, `schemas.py`, `references.py`, `router.py`. Existing edits in these files were retained.

Endpoint additions available: POST `/api/v1/reservations/{id}/check-in`, `/check-out`, `/cancel`, `/no-show`, `/record-departure`. Readiness endpoint is deliberately not registered. No native accounting/Odoo, financial pricing extension or generic unrestricted PATCH.

## Verification and data protection

Before the stop: original frontend suite passed 186 tests after initial UI connection; new request-remount recovery regression was added; frontend build passed after readiness scaffolding; final ESLint passed. Baseline backend separately passed 134; lifecycle focused suite passed **23** including concurrent identical replay/competing edits, ownership, stale/key rejection, early/dirty guards, checkout history/future bookings and failures after each write plus pre-commit. Final backend: **157 passed, 12 explicitly skipped unfinished readiness cases**. Final Ruff lint/format: passed, 42 files formatted. Preservation comparison passed with the additional development booking retained. The initial final frontend run had 186 passed/1 failed because an API-error concatenation added a trailing space to the demo error text; that display regression was corrected without changing the test. The final repeat is recorded below.

One baseline backend run overlapped the browser synthetic company and failed a global room-count seed assertion (133 passed/1 failed). The separate repeat passed 134. Do not run the legacy global-count suite concurrently with the browser harness. Browser setup uses a new synthetic company only in hms_test and deletes only those synthetic rows; it never writes business records to hms_dev. Verification ports are 5183/5184 to preserve already-running user servers; test-only CORS explicitly allows 5183.

The preservation capture recorded one existing development guest and no development reservations. A new development booking appeared during the session outside the test harness. The strict identical-membership check detected it; the original snapshot was retained and comparison now checks that every original row/hash remains present unchanged, while reporting additions separately. **All original business rows/columns remained unchanged** in both databases; the new development booking/receipt/audit/pricing/allocation were retained. New room.version is excluded by the original-column projection. No assumption that either database is empty and no cleanup of user records.

Commands from HotelSystem:

```powershell
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
```

From backend:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m ruff check app tests migrations scripts
& .\scripts\python.ps1 -m ruff format --check app tests migrations scripts
& .\scripts\python.ps1 -m alembic current
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/full-send-data-before-20261013.json
```

Existing local backend processes may need a normal restart to expose new lifecycle routes/capabilities; this sprint did not terminate user-owned processes. Synthetic verification processes were stopped; PostgreSQL remains running. ZKBioTime environment/database/storage were not used.

## Remaining scope and concerns

Final frontend repeat after the display correction: **187 tests passed in 33 files**. `git diff --check` passed (existing Windows line-ending notices only). No implementation work continued beyond freezing the unfinished readiness feature and completing these checkpoint checks.

Complete existing operational parity is not claimed. Readiness C is partial/gated. Room/type/rate/duration/source/settings CRUD, guest/assignment/schedule edits, multi-room stays, extras/adjustments/discounts/inventory/inclusions/breakfast/payment/channel settlement workflows remain unsupported for persisted writes. Rich read surfaces now exist, but detailed audit before/after transport and unsupported metadata are not complete. Local-development actor is not authenticated identity; no production deployment approval is implied. Old receipt responses remain replayable, and lower reservation versions cannot replace newer cached state. Financial and raw timestamp canonical facts remain in the API cache.

**Stop here. Resume by finishing and verifying the gated readiness slice.**
