# Thursday discount completion checkpoint

Date: October 15, 2026, Asia/Manila. Baseline:
[Wednesday presets/recovery checkpoint](presets-recovery-checkpoint-2026-10-14.md),
`2cd0458fa054`. Git started clean; no existing work was discarded. No commit/push,
dependency installation, reset, accounting or unrelated feature implementation.

## Implemented boundary

Original Discounts popup and reservation selectors now support Set Discounted Price for
covered hourly packages, nightly unit rates and purchased/chargeable product lines. Room
definitions can cover selected rates while excluding others. Item definitions replace one
unit price. Zero is permitted; new replacements cannot exceed the applicable current and
captured base units. Disabled definitions/packages cannot be newly applied. Existing captures
survive definition retirement and changes to catalog prices. Disable/Enable uses the existing
versioned configuration command; deletion remains gated.

Order: original captured units → one unit replacement per line → room/item reductions →
reservation reductions → signed adjustments → zero clamp. Fixed item reductions still apply
to the extended line total. PHP input rounds half up using decimal strings and integer cents.
The existing calculator was extended; there is no parallel financial engine.

Pricing schema 5 stores `price_overrides` and `price_override_total_minor` separately from
ordinary `discounts` and `discount_total_minor`. Each capture retains original/replacement unit,
quantity, exact effect, definition UUID/version, historical label, PHP, line/type-or-product/rate
identities, provenance and server application time. Company and reservation-version provenance
remain on the owning pricing revision/audit. Schema 1–4 history and old receipts are unchanged.

Demo intentionally retains its established combined discount presentation. The October 15
request explicitly requires API replacement effects to be separate; that distinction was
reported before changing presentation. Saved detail, pane and print show separate replacement
effects and server-authoritative amounts. Reservations without replacements get no extra row.

Existing commands retain company ownership, expected versions, durable request keys, complete
transaction rollback, server audit and post-commit responses. Omitted additive configuration
fields retain old hashes. Definitions lock references before the preset, consistently with
pricing lock order. Selection retries retain first-application time; quantity changes multiply
the captured replacement once. Retargeting or reclassifying an existing selection UUID rejects.
Incompatible room/type/rate changes require explicit removal/replacement. Removed purchase
lines cannot retain dependent captures. No-op frontend saves leave version/pricing unchanged.

## Actual verification

- Final complete PostgreSQL backend regression: **402 passed**. Final package-eligibility and
  configuration concurrency focused run before the regression: **48 passed**.
- Complete frontend: **215 passed in 41 files**. Final TypeScript, ESLint and production build
  passed. Focused pricing/adapter/editor checks passed during development.
- Ruff lint/format, dependency consistency and Alembic drift passed during verification.
- [Final-price browser/API checks](../../booking-tests/reports/20261015T005553Z-final-prices/results.json):
  **13 passed**. [SQL/restart verification](../../booking-tests/reports/20261015T005553Z-final-prices/postgres-verification.json)
  compared all three reservations after a real API restart, their current raw PostgreSQL snapshots
  and all **15** historical pricing revisions.
- [Rich regression](../../booking-tests/reports/20261015T005031Z-rich-api-integration/results.json):
  **26 passed**, with SQL/restart verification.
- [Established preset regression](../../booking-tests/reports/20261015T005238Z-discount-presets/results.json):
  **10 passed**, with SQL/restart verification and independent demo workflows with zero API calls.

Final-price browser entry points: original configuration create/edit/reopen; captured prices after
definition/catalog changes; expanded-detail room/item selection, purchase quantity and removal;
failed-save retention/retry; 409 review preserving an unrelated remote preset; Disable preventing
new selection and Enable restoring it; Dashboard nightly create; calendar empty-cell create and
summary edit; alternate package/duration and room-type incompatibility; explicit removal and atomic
reassignment; no-op save; detail and document print. Nightly quantity reconciliation, malformed and
forged inputs, duplicate replacements, retirement, owner/reference validation, competing writers,
concurrent replay and complete staged rollback/retry also have backend coverage. Not every matrix
combination was independently browser-tested; nightly quantity reconciliation is API-tested.

Failed browser reports/traces were retained, including wrong duration-label and Remove-button
selectors, an early popup readiness failure and the option disabled-state matcher issue. The latter
report already showed an actual disabled historical option; the harness now checks its DOM property.
An API retirement test initially reused its pre-capture placeholder label and correctly received 422;
the test now submits the canonical captured label. No application failure was relabeled PASS.
Existing non-failing TestClient deprecation and build-size warnings remain.

## Database and preservation

Two additive revisions, applied to both owned databases:

- `e0f7f1c9a625`: final-price definition unit and covered-rate configuration.
- `f19b362d47a0`: explicit null/shape and ordinary-versus-replacement configuration checks.

Head is `f19b362d47a0`: fifteen revisions, seventeen HMS tables. The first migration's initial
constraint-name error rolled back transactionally; it was corrected before successful application.
The subsequent integrity tightening was additive, preserving applied history. Downgrades refuse
unreviewed financial safeguard/data removal; none ran.

[Hash-only baseline](../../backend/verification/final-price-before-20261015.json) captured both
databases before changes. Synthetic browser companies were created only in `hms_test` and cleaned
afterward; development business records were not written by verification. PostgreSQL suites and
browser harnesses ran separately. Temporary verification servers were stopped; user servers and
ZKBioTime were untouched. Fresh-empty migration/backup-restore rehearsal was not repeated today.
The final preservation comparison passed for every original row/column with no additional retained
rows in either database. [Final environment inventory](../../backend/verification/current-integration-audit-20261015T005807Z.json)
confirms project-owned Python, separate databases, UTC and matching migration heads.

## Files and reproduce

New backend files: `billing/overrides.py`, the two migrations, `test_final_price_api.py` and
`test_final_price_pipeline.py`. Updated concrete billing calculation/capture helpers, configuration
models/DTOs/services, reservation DTOs/stay capture and compatible request hashing.

Frontend: typed contracts, preset/discount inputs and focused tests, rich presentation/bridge,
definition types, original Discounts popup, ReservationPane/line selector, saved descriptions,
detail/print, price-summary types and the existing calculator's API presentation option.
New `integration-tests/browser-final-prices.mjs` and `run-final-prices.py`; documentation, diagram,
hash-only preservation and timestamped verification evidence accompany the code.

From `HotelSystem`, normally restart an older launcher before `./run-api.bat`. Owned databases
are migrated already; no reset/reseed is needed. Other checkouts must apply migrations explicitly.

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-final-prices.py
& .\backend\scripts\python.ps1 integration-tests/run-presets.py
& .\backend\scripts\python.ps1 integration-tests/run-rich.py
npm test -- --maxWorkers=2
npm run lint
npm run build
```

From `backend`, separately from browser harnesses:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/final-price-before-20261015.json
```

## Stop point and next milestone

Scope remains direct single-room reservations. Reservation-wide final-total replacement, arbitrary
client-priced overrides, multi-room/custom/OTA, preset deletion, room/type archive controls, stock,
payments/refunds/settlements, detailed history browsing, authenticated staff/public deployment,
accounting and Odoo were not added. Actor attribution remains development-only.

After review/acceptance, freeze new pricing features except critical corrections. **Next first task:
define the finalized billing-document contract and lifecycle**, including immutable captured amounts,
finalization/version/idempotency and correction rules. Payment records/allocations and native
accounting follow as separately authorized milestones. No work on them started here.
