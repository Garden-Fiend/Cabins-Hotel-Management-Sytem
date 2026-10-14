# Wednesday special extra charges checkpoint

Date: October 14, 2026, Asia/Manila. Baseline: the verified
[manual-discounts checkpoint](manual-discounts-checkpoint-2026-10-14.md). That checkpoint and
all pre-existing uncommitted work were retained. No commit/push, dependency installation,
database reset, fixture import or inclusions/breakfast implementation.

## Implemented boundary

Special extras share the existing catalog product table, but retain protected category identity
(`source_id=special-extras`, `type=extra`, `system_defined=true`) and distinct `extra_charge`
intent/captured classification. Each company receives one category; no ordinary category/product
is converted, renamed or deduplicated. Ordinary categories/products with matching names coexist
under different canonical IDs. The frontend adds an ordinary-category display suffix where
needed; stored names remain unchanged.

The original Inventory protected-category Rename action remains available. Archive/delete and
reclassification remain unavailable. Extra products are operational definitions, not ordinary
sellable products. Definition create/edit uses existing versioned configuration commands.

Original reservation extra-charge selectors, quantities and removal work for initial create
and saved single-room direct reservations. Requests carry identities/quantities/classification,
never authoritative prices. Existing line edits retain captured unit prices/labels; catalog
changes do not rewrite old captures. Removing/recalculating lines appends pricing history.
Pricing schemas 3/4 retain classification without introducing a separate product table or
new pricing schema. Existing room/item/reservation discount eligibility and sequential rounding
rules apply to extras. Adjustments remain separate, and the final zero clamp is unchanged.

Existing billing/stay transaction boundaries handle mixed supported changes with one version
increment, server audit, pricing revision and durable receipt. Stale versions reject; identical
keys replay; failed writes roll back and retain UI drafts. Omitted new create `charges` preserves
historical create request hashes. Initial ordinary purchases retain their previous first-save
gate; this slice enables initial special extras only.

## Database and preservation

Two additive revisions follow the unchanged manual-discount database baseline:

- `6a4e29c18f03`: protected extra classification/identity, ordinary-name coexistence, category
  initialization for existing companies and a transactionally executed company INSERT trigger.
- `7b90f132ae64`: preserves the original protected-category rename behavior. The first revision
  had already been applied, so its label constraint was corrected additively rather than rewriting
  applied history.

Both isolated databases are at `7b90f132ae64`: nine revisions, 14 HMS tables. The trigger installs
only protected metadata, not demo products. Downgrades refuse destructive removal and require
an explicit reviewed data plan. No downgrade was executed. Ordinary collisions are retained,
not repaired automatically. ZKBioTime environment/database/storage were not used.

The hash-only [baseline](../../backend/verification/extra-charges-before-20261014.json) verifies
all pre-existing rows/columns remain unchanged. After synthetic cleanup, the only additional
row in each database is its protected extra category. Existing development business records
remain intact.

## Verification

Full PostgreSQL suite: **292 passed**, including ten focused extra-charge cases. They cover
protected identity/rename, matching ordinary names, forged classification, captured-price and
history preservation, exact quantities/discount amounts, GET/replay/stale rejection, competing
versioned writers, concurrent identical-key replay, initial create and rollback/retry after
reservation/pricing/audit/receipt writes and immediately before commit.

Full frontend: **200 tests passed in 37 files**; ESLint and production build passed. Ruff lint/
format, dependency consistency, Alembic drift and `git diff --check` passed. Existing non-failing
TestClient deprecation and frontend bundle-size warnings remain.

Real browser integration: **26 checks passed**, followed by successful real API restart/SQL
verification of four reservations and 23 historical pricing rows. Verified extra entry points:
Inventory category rename and product create/edit, generic Configuration definition create/reopen,
calendar empty-cell reservation create with an initial extra, expanded-detail add/quantity/remove
and item discount, and document print. Definition/reservation failed saves retained drafts and
retry persisted; refreshed records retained captured classification and prices after definition
changes. Existing Dashboard/calendar edit, manual discounts, purchases and lifecycle cases passed.
Demo extra selection/quantity and manual discounts remained functional with zero API calls.
Product archive/restore was not independently browser-tested in this slice.

Evidence: [browser assertions](../../booking-tests/reports/20261014T015634Z-rich-api-integration/results.json),
[SQL/restart verification](../../booking-tests/reports/20261014T015634Z-rich-api-integration/postgres-verification.json),
trace/video/screenshots in the same directory, and
[final environment inventory](../../backend/verification/current-integration-audit-20261014T015829Z.json).
Only the harness-owned synthetic company was cleaned from `hms_test`; development business data
was not written. Temporary API/frontend verification processes were stopped; user-owned servers
were not terminated. The final preservation comparison passed after both suites and cleanup.

The browser harness retains every failed run. It exposed two corrected integration assumptions:
protected categories permit Rename in demo, and Configuration's existing catalog form was still
gated despite the implemented product API. Harness selector/timing failures are preserved too;
they are not relabeled as passing evidence.

## Files and execution

- Backend: the two migrations; configuration models/schemas/services; reservation create/schema/
  references; charge resolution; compatible mutation hashing; focused extra-charge tests and the
  catalog-list expectation. Historical create-hash tests now explicitly omit the new optional field.
- Frontend: API contracts/definition/edit adapters and bridge, command context, original
  ReservationPane, Inventory and Configuration controls; focused extra-charge adapter tests.
- Verification: rich browser/SQL-restart harness, hash preservation baseline and current inventory.
- Documentation: this checkpoint, backend README/contracts and current Mermaid architecture.

From `HotelSystem`, restart an older launcher normally and use `./run-api.bat` for current
frontend/backend together. The owned databases were already migrated; no reset or reseeding
is required. For another local checkout, apply migrations explicitly from `backend`:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/extra-charges-before-20261014.json
```

From `HotelSystem`:

```powershell
npm test -- --maxWorkers=2
npm run lint
npm run build
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
```

Run the full PostgreSQL suite separately from the browser synthetic-company harness.

## Limits and next slice

This is operational extra-charge billing, not stock tracking, payments or accounting posting.
Supported reservation scope remains direct single-room; multi-room/custom/OTA and detailed
history browsing remain outside it. Actor attribution remains development-only. Inclusions
and breakfast remain gated and were not implemented. Session 2 can begin inclusions as a
separately bounded task after review of this checkpoint.
