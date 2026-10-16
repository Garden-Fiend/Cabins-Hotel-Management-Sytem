# B5 booking sources and versioned agreements checkpoint

October 16, 2026, Asia/Manila. Starting commit `79ef2bb`; working tree was clean. Accepted B1–B4
preserved. Starting head `c37d42e8f932`; final head **`d48e53f9a043`**, 20 revisions / 20 tables.
B5 configuration only. No commit/push, dependencies, reset/reseed, B6 transactions, accounting,
authentication redesign or ZKBioTime access.

## Implemented

Original Configuration → Booking Sources / `BookingChannelsEditor` now creates, reads, edits and
enables/disables owned sources with stable UUID/alias, classification, reference requirement,
notes and expected versions. No source deletion or redundant archive flag was added. Used-source
classification changes reject; rename/disable preserve reservations. New reservations retain a
server-captured source label. Legacy reads/replayed receipt projections use an original-label
fallback, without rewriting old reservations, source IDs, pricing, bills or audit.

One owned `source_agreements` table stores server-assigned revision UUID/number, separate edit
version, source/company, dates, status, PHP terms, creation time and actor. Existing sources receive
no invented agreements. Configuration supports pricing override/reason flags, none/percentage/
fixed/manual commission, explicit contractual basis, collection hotel/channel/per-reservation and
deducted/separate-invoice/offset/manual settlement. Percentage uses integer basis points; fixed
fees use exact bounded integer cents. Reopening API fees uses exact decimal text, including the
maximum supported amount. Nothing calculates commission or collects/remits money.

Two specification assumptions were resolved against the original demo: **end dates are inclusive**,
and saved **draft rules remain editable**. Published/retired rules and identity/revision/provenance
are database-protected; new published terms require a new revision. Original date/status editing
remains available and audited. Active date ranges cannot overlap, enforced by PostgreSQL exclusion.
Draft/retired/future-only/expired histories produce no applicable version outside their active dates.
Old ranges close through an explicit save; no automatic interval closure or historical attachment.

Source row locks serialize agreement writers. Mutations require source version and a separate
agreement-history token (sum of edit versions); existing agreement edits also require their own
version. Version review keeps the draft while refreshing tokens/history. Saves are blocked during
review. Source/agreement ambiguous responses retain original UUID/body in tab session storage for
explicit replay after refresh. Definition, audit and receipt commit/roll back together.

Original reservation creation now selects enabled persisted **direct** sources, including newly
configured ones. Non-direct and external-reference-required sources are visibly gated until B6
can capture their required facts. Backend creation enforces the same limit. Existing reservation
source changes remain gated; B2/B3 cannot bypass this through allocation editing. Source disable
does not block existing operational edits/lifecycle. Demo retains its original independent behavior.

## Contracts and migration

See [full contract](../../backend/booking-source-agreements.md) for typed bodies and semantics.

- `GET/POST /api/v1/configuration/booking-sources`
- `GET/PATCH /api/v1/configuration/booking-sources/{id}`
- `GET/POST /api/v1/configuration/booking-sources/{id}/agreements`
- `PATCH /api/v1/configuration/booking-sources/{id}/agreements/{agreement_id}`
- Agreement GET optionally filters `?effective_on=YYYY-MM-DD`; reference-data GET also includes history.

Writes require UUID keys. Source create / new agreement return 201; updates return 200. Missing/
foreign resources return 404; invalid types/enums/precision/currency/dates 422; stale history,
duplicate name, overlap or protected rules 409. Replay binds company, operation, parent/target and
body, returning the original committed result without duplicate revisions or audit.

The additive migration removes the reference-table direct-only constraint, adds metadata/label
columns and one agreement table. Existing owned source/reservation FKs remain. New ownership,
unique revision/name, valid-term checks, inclusive date exclusion and immutable history triggers
enforce integrity. Old rows/financial captures are not backfilled. Downgrade refuses unreviewed
history removal. The owned development/test targets were upgraded explicitly; no reseed occurred.

## Executed verification

- Affected PostgreSQL: **171 passed** (47 B5 cases plus configuration, retirement and B2/B3 cases).
  Final focused source/initial-financial/immutable-document run: **94 passed**. Counts overlap;
  this is not a new complete repository regression. Coverage includes source variants, uniqueness,
  ownership, disabled selection, history/labels, draft publication, date boundaries, precision,
  forged fields, same-key/body conflicts, concurrent create/replay/interval edits, exact-once audit,
  database checks and four-stage rollback/retry for both initial agreement and interval changes.
- Affected frontend: **71 passed in eight files**. After an additional legacy receipt-label case,
  final affected adapter/editor/recovery run: **12 passed in three files**. These overlap. Original
  channel/demo/configuration/Dashboard/multi-room tests passed; new tests cover parent gating,
  failure retention, draft review/busy state, published fields, exact cents and effective selection.
- Final TypeScript, full ESLint, production build, Ruff lint/format (105 Python files), dependency
  consistency, Alembic drift and diff whitespace passed. Full frontend/backend suites were not
  rerun. Existing TestClient deprecation and bundle-size warnings remain non-failing.
- [Final browser: eleven checks passed](../../booking-tests/reports/20261016T010322Z-sources/results.json),
  followed by [actual SQL/API restart verification](../../booking-tests/reports/20261016T010322Z-sources/postgres-verification.json).
  Original source create/edit/disable/enable, active publication, inclusive close, future version,
  history, overlap rejection/draft retention, stale source and agreement review, lost committed
  response/refresh/original-key replay, source rename/history/print, direct source chooser and actual
  Dashboard booking, plus independent demo with zero API calls were exercised. Two reservations,
  three agreement revisions and one immutable bill survived restart; SQL compared stored agreement
  terms/versions against canonical captures. Eighteen audit events were retained through restart.
  Traces, video, screenshots and intermediate reports remain in their timestamped directories.

## Failures and preservation

Confirmed UI defects fixed: Configuration's parent fieldset still disabled the supported channel
editor; source Save or a context switch could race unfinished review; API fixed-fee reopening used
a floating amount. New focused regressions cover these. A missing company field in the agreement
read DTO initially caused rolled-back 500 responses; corrected DTO then passed the B5 cases.

The first affected run passed 50 test bodies but all 50 cleanup teardowns failed from a missing
SQLAlchemy import. Recovery identified exact new fixture owners against the hash baseline and
deterministic fixture identities; its [owner manifest](../../backend/verification/b5-failed-fixture-owners.json)
was saved before cleanup. Only those proven IDs were removed in guarded `hms_test`; the retained
recovery script now accepts only this recorded manifest. Its initial missing Base import was fixed
before execution. Later normal teardown/replay/rollback runs and final preservation all passed.

Failed browser evidence was not relabeled: `003832Z` found the disabled parent; `003956Z` and
`004124Z` had select/textarea accessible-name mistakes; `004307Z` compared against a setup snapshot
preceding intended document audit events; `004410Z` exposed the review race; `004537Z` used an
option matcher that misreported an actual disabled property; `004704Z` omitted the original
“+ Add room” button prefix; `005155Z` matched both the loading status and the review notice.
Harness selectors/setup were corrected without removing assertions. Passing runs `004840Z`
(ten checks), `005338Z` and `005655Z` remain independent evidence. A late regression reproduced
history-context switching during pending review; its disabled guard then passed. Run `010118Z`
unexpectedly reset Configuration to its default section while final build/documentation work was
finishing. The exact same browser checks passed in `010322Z` after that work finished, without an
application/assertion change. Its failure remains preserved; the reset's root cause was not established.

[Hash-only baseline](../../backend/verification/b5-before-20261016.json) final comparison passed:
**every pre-existing row/column unchanged; no additional retained rows in either database**, and
the new agreement table is empty after test cleanup. Final inventory remains six development
reservations/allocations and zero retained test reservations/allocations. See
[final environment inventory](../../backend/verification/current-integration-audit-20261016T005753Z.json).
Only random synthetic test companies were written. Agreement/document cleanup retains the exclusive
table-lock/trigger re-enable discipline. PostgreSQL and browser suites ran separately. Temporary
owned servers stopped; user-owned servers and unrelated environments were untouched. Restart
verification restarted only the owned API, not PostgreSQL itself.

## Files, reproduction and stop point

New: configuration `sources.py` / `source_models.py`, additive migration, `test_sources.py`, API
source inputs/tests, original-editor regression, guarded source browser/SQL runner, preservation/
recovery evidence, source contract and this checkpoint. Modified: configuration routes; source/
reservation models/reads/create/plural guards; reference DTOs; fixture cleanup; original channel
editor, Configuration parent gate and ReservationPane direct chooser; typed client/bridge/context/
projection/domain types; README/contracts, parity plan/matrix and current architecture diagram.

From `HotelSystem`:

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-sources.py
npx vitest run src/components/channels/SourceConfiguration.test.tsx src/app/api/sourceInputs.test.ts src/app/api/useMutation.test.ts --maxWorkers=2
npm run lint
npm run build
```

From `backend`, separately from browser harnesses:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_sources.py tests/test_initial_financials.py tests/test_billing_documents.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b5-before-20261016.json
```

Other checkouts must explicitly run `alembic upgrade head` and `scripts/migrate-test.py` through
the owned wrapper. Current targets are migrated. Restart an older launcher normally before
`run-api.bat`; no reset/reseed required.

**B5 COMPLETE for the authorized configuration boundary.** No channel transaction, commission
calculation, payment, settlement, conversion or historical agreement backfill was implemented.
Separate commission payer/mixed collection/timing choices were not invented beyond the demo.
Calendar source selection shares the same pane/adapter, but the new direct-source booking was
browser-exercised through Dashboard, not separately through calendar. Source-create lost-response
recovery was not separately browser-tested; agreement replay and shared recovery tests cover the
mechanism. A fresh-empty migration/backup restore rehearsal and database-process restart were not
repeated. Local actor identity is not production authorization.

Stop here. B6 can review exact reservation-level agreement captures, external references, reviewed
source changes and protection for date edits once agreement versions are in use. Stable owned source
and revision UUIDs, exact terms, effective lookup and version tokens are now available; none of
those financial capture/workflow operations were started.
