# B7 persistent collections checkpoint

October 17, 2026, Asia/Manila. Starting HEAD `f4fb4a2`, B6 working tree/head `a71b86c2d376`.
Existing uncommitted B6 code, evidence and business records retained. Authority: the user's approved
`B7_Codex_Implementation_Spec.md`, D1-D6. No commit/push, dependencies, reset, seed overwrite,
payment execution, accounting, B8 implementation or unrelated environment access.

## Implemented by stage

**A — contracts/storage.** Billing owns two append-only tables: `billing_collection_transactions`
and `guest_obligation_bases`. Strict positive safe PHP cents, evidence/method/declaration rules,
owned provenance, refund capacity and full-original-only reversal rules. Cash may omit external
reference; immutable UUID is its internal identifier. Electronic hotel evidence and verified channel
evidence require references. Actor/time are server recorded, with development attribution explicitly
retained. No attachments/occurrence-date infrastructure or automatic payment backfill.

**B — saved commands.** GET/POST reservation `/{id}/collections`, POST `/{id}/guest-obligation`.
See [exact contract](../../backend/collections.md). Parent-version locking, durable original-key
replay, exact audit and one transaction reuse existing infrastructure. No document locks or pricing
writes. Partial linked refunds cap at original capacity; reversal must be full, with no refunds or
previous reversal. Corrections of corrections and mismatched collector/source/capture reject.
Post-checkout/finalization recording is allowed; cancelled/no-show new collection needs reason.

Duplicate references compare trimmed Unicode-casefolded reference and hotel method within company/
collector. Original reference text is retained. Advisory reference locking protects cross-reservation
races. Explicit acknowledgment/justification binds the complete current match set and reviewed intent,
target/version (or stable initial-create body). Changed amount/context/matches requires review again.
Matching-key committed replay precedes fresh version/duplicate checks. Safe review details are owned.

Guest obligation is accommodation-only and independent of hotel contractual entitlement. Non-direct
unknown/outdated bases produce null/requires_review, not fabricated debt or zero. Known bases capture
evidence, pricing UUID, commercial UUID, actor/time and version. Commercial/pricing changes require
new review; historical bases and collections remain intact and are not additive liabilities.
Direct obligation follows canonical hotel pricing; a basis review can affirm, not override it.

Hotel/channel net collections and accommodation/hotel-charge coverage remain separate. Verified OTA
accommodation does not clear hotel extras or create hotel cash/payout. Signed credits are retained.
Source rollups count records once across captures; corrections retain original source labels/references.

**C — original entry points.** The existing detail ChannelFinancials entry point now uses awaited
API collection/refund/reversal controls, exact historical ledger/original selectors, duplicate review,
obligation review and immutable history. Direct bookings have an API payment surface without fabricated
channel terms. Original Dashboard/calendar panes stage one collection and optional obligation in the
same singular/plural create transaction at version 1; there is no follow-up collection mutation.
Failed drafts remain, uncertain requests recover original body/key after refresh, and stale context
requires review. Source changes require review of staged facts. B8 capabilities remain disabled.

API pricing totals are labeled operational bill totals, separate from guest residuals. Original
reservation print now explicitly excludes current collections; finalized document captures/print stay
unchanged. Exact integer-to-decimal formatting preserves maximum supported cents and signed credits.
Demo controls/financial behavior remain independent; no API state is fake-saved through demo setters.

**D — regression/recovery.** Results below were executed, not inferred from API support.

## Migrations and preservation

- `b82c97d3e487`: two tables, owned/composite FKs, evidence indexes, immutable history and correction/
  provenance insert guards; additive capture ownership uniqueness.
- `c93da8e4f598`: explicitly reject SQL NULL method/evidence/known amounts in relevant CHECKs. The
  first migration was already applied, so corrected constraints were added instead of rewriting history.
- Both owned targets upgraded explicitly to **`c93da8e4f598`**, 25 revisions / 23 HMS tables.
  No downgrade/reset/backfill. Downgrades refuse unreviewed financial-history removal.
- Final [hash baseline](../../backend/verification/b7-before-20261017.json) comparison passed:
  **all original rows/columns unchanged, no additional retained rows; both new tables empty** in
  development and test after synthetic cleanup. Existing finalized documents/captures retained.

Only random harness/fixture companies in `hms_test` were written by business verification. Test-owner
cleanup exclusively locks its protected tables, removes only its exact owner and re-enables row
guards before commit. Backend suites and browser harnesses ran separately. User servers were untouched;
owned temporary processes stopped. Restart checks restarted only the owned API, not PostgreSQL.

## Executed checks

| Gate | Actual result |
|---|---|
| Stage A pure rules | 9 passed |
| Complete PostgreSQL regression | **678 passed** |
| Later affected PostgreSQL (collections, B6, immutable bills) | **91 passed** |
| Final B7 focused PostgreSQL/rules after duplicate intent binding | **34 passed** |
| Complete frontend | **269 passed in 49 files** |
| Final affected frontend, including exact-cent display boundary | **46 passed in six files** |
| Final full ESLint, TypeScript/production build | Passed |
| Ruff lint/format, Alembic drift, dependency consistency, diff whitespace | Passed |

Counts overlap. The complete backend run preceded eight added boundary cases; the later 91-case run
includes them. Final 34 covers B7 after the last safety refinements; no second complete 686-case claim.
The full frontend run preceded final display/context refinements; the final affected run covers those.
Existing TestClient deprecation and bundle-size warnings remain non-failing.

Backend coverage includes mixed collectors, OTA-funded guest difference, extras left due, unknown/
reviewed obligations, overpayment, partial refunds/reversal restrictions, context/forged inputs,
post-checkout/finalized/cancelled behavior, stale/concurrent writers and refunds, identical-key replay,
cross-reservation duplicate races, changed duplicate-review context, pagination with full totals,
historical capture correction, singular/plural initial atomicity and stage-by-stage rollback/retry for
both collection and obligation commands. Pricing and immutable document comparisons remain unchanged.

[Final original-control browser: eleven checks passed](../../booking-tests/reports/20261017T015515Z-collections/results.json),
with [raw collection SQL/restart evidence](../../booking-tests/reports/20261017T015515Z-collections/collection-persistence.json)
and [general SQL/restart evidence](../../booking-tests/reports/20261017T015515Z-collections/postgres-verification.json).
Four reservations, ten collection/correction records and one obligation basis survived a real API
restart. Verified: Dashboard direct initial cash/failure retention/no phantom; detail linked refund;
explicit duplicate review; committed-response loss/refresh/original-key replay; Dashboard non-direct
channel verification with unknown obligation; explicit detail obligation review; calendar empty-cell
initial save; Dashboard two-room initial save; full reversal; stale draft/review/retry; independent
demo form with zero API calls. Original demo collection/channel saves also passed frontend tests.
Trace/video/screenshots and failed reports are retained. Final exact-cent display helper refinement
was unit-tested after this browser run; maximum-amount UI entry was not separately browser-tested.

[Final recovery rehearsal](../../backend/verification/recovery-rehearsal-20261017T015142Z.json)
passed empty migration, explicit seed/replay, synthetic configuration/reservation/pricing/audit/receipts,
collection + linked refund + obligation review, custom-format dump/restore into a separate empty target,
identical per-table hashes/canonical reservation/collection summary, matching head and restored drift.
Its new loopback-only Docker cluster/volume was retained stopped; existing databases were not targets.
The [first successful rehearsal](../../backend/verification/recovery-rehearsal-20261017T014341Z.json)
preceded the linked-refund addition. An initial sandbox Docker access denial created no rehearsal;
authorized escalation ran the isolated rehearsal. This is local recovery evidence, not hosted DR.

## Failures retained and fixed

The first pure test helper duplicated a keyword; an API assertion used a nonexistent top-level total;
both corrected before passing runs. A frontend text selector matched both an option and summary label.
The first full backend run had **673 passes / two failed legacy-hash expectations**; old fixture
projections now exclude new omitted fields. Actual historical request hashes remain unchanged.
The corrected complete run passed 678. Formatting/import checks were fixed without warning suppression.

Browser failures: `013419Z` exact select accessible-name mismatch; `013517Z` and `014119Z` exposed
duplicate booking-financial editor elements; `013630Z` navigation timeout during concurrent frontend
verification. The duplicate editor was an **application defect**: the new initial section shared its
React key with the existing financial editor. Namespacing the key fixed it. Navigation timeout was
bounded at 30 seconds and original controls retained. Independent passing runs `014225Z` (eight),
`015158Z` (eleven) and final `015515Z` (eleven) remain separate reports, never relabeled failures.

## Explicit limits / next action

- Nonzero signed adjustments lack an approved obligation-component mapping; opposing component
  credit/debt also lacks an approved transfer rule. API/UI explicitly show requires_review and no
  combined residual. Smallest compatible extension: reviewed component allocation tied to existing
  adjustment/pricing identities, without fake payments, discounts or a generic accounting ledger.
- Initial API save supports **one** staged collection. Multiple payments can be recorded individually
  after save, but a demo-style multi-entry initial cart is not implemented. If required for parity,
  extend initial intents to a list, add deterministic intra-version ordering and acquire all reference
  locks in stable order; do not issue create-then-collect calls or weaken transaction uniqueness.
- Calendar plural initial collection, historical-source refund through the browser, every lifecycle/
  entitlement combination and post-finalization collection through the browser were not independently
  exercised. Backend tests cover several; do not call them separately browser-verified.
- No payment execution, legal receipt numbering, bank/OTA connector, commission confirmation, channel
  payout/settlement/reconciliation, accounting or production staff authorization. B8 remains separate.

Persistent B7 operational records and the verified UI boundary are usable; this is not full demo
parity certification. Review the named limits before treating B7 as unconditionally closed. Next
separately authorized work is closure of those limits or B8 contract review, not automatic B8 execution.

## Reproduce

From `HotelSystem`, after normally restarting an older launcher (`run-api.bat`):

```powershell
& .\backend\scripts\python.ps1 integration-tests/run-collections.py
npx vitest run src/app/api/collections.test.ts src/components/channels/Collections.test.tsx src/components/channels/ChannelIntegration.test.tsx src/app/api/useMutation.test.ts src/app/api/multiRoom.test.tsx src/pages/DashboardPage.test.tsx --maxWorkers=2
npm run lint
npm run build
```

From `backend`, separately from browser harnesses:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_collection_rules.py tests/test_collections.py tests/test_collection_boundaries.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/b7-before-20261017.json
& .\scripts\python.ps1 scripts/rehearse-recovery.py
```

Other checkouts must explicitly upgrade development/test migrations through the owned wrappers.
Current targets already migrated; no reset/reseed needed.

New B7 files: billing collection models/DTOs/services, two migrations, three backend test files,
collection API types/helper/test, API collection section/fields/tests, browser/scenario wrapper,
contract/baseline/recovery evidence and this checkpoint. Modified: original create DTOs/services/hash
compatibility, reference capability/router/model registration, fixture cleanup/three old-hash fixtures,
client/mutation recovery/bridge/multi input/context, original pane/detail/channel/print entry points,
owned existing harness/recovery runner and bounded architecture/parity documentation. Earlier B6
changes remain uncommitted in overlapping files. No commit or push.
