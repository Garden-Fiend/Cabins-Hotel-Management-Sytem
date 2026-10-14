# Wednesday manual discounts checkpoint

Date: October 14, 2026, Asia/Manila. Baseline: committed October 13 integration and room-status correction. Scope: manual discounts only. No commit/push, dependency installation, database reset or schema migration.

## Implemented and verified

API mode supports adding, editing and removing fixed/percentage manual discounts at reservation, room and purchased-line scope. The original controls remain in place; demo behavior is unchanged. Create accepts discounts, and saved edits combine supported guest/count/note, purchase, adjustment and stay changes in one existing transaction boundary.

The server calculates reductions from captured PHP amounts. Pipeline 2 applies room/item entries in insertion order, then reservation entries in insertion order. Input list order and actual application order are both retained. Fixed amounts and each percentage application round half away from zero, cap at the eligible remaining balance and allocate across original line order. Room scope includes its purchases; adjustments are added separately before the final zero clamp. No automatic statutory eligibility or additional cap policy was invented.

Captured accommodation/product unit prices and historical revisions remain unchanged. Purchase quantity edits and explicit stay repricing recalculate current discounts against the appropriate bases. Removing a targeted purchase requires addressing its discount; the original UI does so together. Ordinary note/count edits preserve pricing revisions.

New pricing JSON schema 4 stores decimal inputs, UUIDs, scopes/targets, manual provenance, server first-application times, calculated reductions and per-line minor-unit allocations. Existing schemas 1/2/3 remain readable. There is **no SQL migration**: both isolated databases remain at `54e8c2a17d90`, with 14 HMS tables.

`POST /api/v1/reservations/{id}/edit-discounts` requires version, guest identity and UUID request key. Stale versions, key/body mismatches, invalid targets and forged calculated/provenance fields reject. Writes, pricing revision, audit and receipt commit together, incrementing reservation version once. Old create/billing/stay hashes are preserved when the new optional field is omitted.

Failed saves retain drafts. Explicit conflict review preserves remotely added or locally untouched discounts; reviewed local changes/removals supersede their corresponding entries. Saved totals and reductions come from canonical server captures, not current configuration or draft estimates.

## Actual verification

| Check | Result |
|---|---|
| Full backend PostgreSQL suite | **282 passed**, including 30 new discount cases |
| Full frontend suite | **198 passed in 36 files** |
| Frontend ESLint / production build | Passed / passed |
| Ruff lint / format, dependency consistency | Passed |
| Alembic drift | None; no migration needed |
| Real browser integration | **23 checks passed** |
| Preservation comparison after final cleanup | All pre-existing rows/columns unchanged |

Backend cases cover staged calculations, caps, rounding, nightly quantity, captured-price preservation, create/edit/removal/GET, replay and resource-bound keys, ownership, terminal states, competing writers, invalid inputs, purchase/stay recalculation and rollback after allocation/reservation/pricing/audit/receipt writes and immediately before commit. A failed key can be retried successfully.

Verified original frontend entry points: Dashboard Create Reservation, calendar empty-cell creation, calendar summary Edit and expanded-detail Edit details. Browser scenarios cover room/item/reservation discounts, failed-save retention/retry, 409 review preserving an untouched remote reduction, purchase quantity/removal, capped zero billing, refresh, detail and document print. Demo manual creation and existing demo workflows work independently with zero API calls. Discount preset configuration/selectors remain unsupported and gated; they were not counted as manual-discount completion.

Evidence: [browser assertions](../../booking-tests/reports/20261014T005948Z-rich-api-integration/results.json), [SQL/restart verification](../../booking-tests/reports/20261014T005948Z-rich-api-integration/postgres-verification.json), trace/video/screenshots in that directory, and [final environment inventory](../../backend/verification/current-integration-audit-20261014T010218Z.json).

Four synthetic reservations and 19 pricing revisions were verified in PostgreSQL and survived a real API process restart. Only their isolated `hms_test` company was cleaned afterward. Development business data was not written by the harness. The [hash-only preservation baseline](../../backend/verification/manual-discounts-before-20261014.json) matched every original row/column; one additional development room/audit/receipt was reported and retained. ZKBioTime was not used.

Earlier failed browser runs remain preserved. Their failures were harness timing/selector/setup issues; the new one-cent purchase-quantity test expectation was corrected to the documented half-up result. No failed evidence was relabeled. Existing non-failing TestClient deprecation and frontend bundle-size warnings remain.

## Files and execution

- Backend: new `app/modules/billing/discounts.py`; existing billing snapshot/command builder, reservation schemas/create/stay/routes/references, compatible request hashing; new `tests/test_manual_discounts.py`.
- Frontend: API discount-input adapter/tests, contracts/client/provider/bridge/edit mapping/presentation, command context and original `ReservationPane` controls.
- Verification: existing rich browser/SQL restart harness, preservation evidence and environment inventory.
- Documentation: backend README/contracts, discount mechanics, current Mermaid architecture and planning handoff.

Restart an older launcher normally and run `./run-api.bat` from `HotelSystem` to load the current API/frontend together. No migration or reseeding is required. Existing user-owned servers were not terminated; temporary verification processes were stopped.

```powershell
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
```

From `backend`, run the PostgreSQL suite separately from the browser synthetic-company harness:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/manual-discounts-before-20261014.json
```

## Limits and next slice

Manual discount integration is complete within existing direct single-room workflows. Presets/final-price overrides, multi-room/custom stays, special extras, inclusions, breakfast, OTA, payments, accounting and detailed history browsing remain outside this slice. Actor attribution remains development-only, not authenticated staff identity.

**Next bounded task: special extra charges.** Extend the existing catalog with protected special-category identity and distinct `extra_charge` intents/captures; retain shared product storage and the established discount eligibility rules. Resolve ordinary-name collisions explicitly before installing special definitions. Preserve the original Inventory and reservation charge controls and verify them independently. Inclusions and breakfast follow separately. No implementation of these next slices was started.
