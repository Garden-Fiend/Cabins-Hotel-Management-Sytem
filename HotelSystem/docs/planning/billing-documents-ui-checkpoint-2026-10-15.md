# Billing-document frontend checkpoint

Date: October 15, 2026, Asia/Manila. Baseline:
[backend document foundation](billing-documents-checkpoint-2026-10-15.md), head `68f75a14d5a4`.
Existing uncommitted final-price/backend work and user records were preserved. No commit/push,
dependency installation, migration, database reset or backend business-rule changes in this slice.

## Implemented

Expanded reservation detail has an always-visible Billing Documents section, independent of live
reservation billing: list, explicit draft creation, stored capture review, immutable-finalization
confirmation, finalized read-only view and separate Operational Billing Statement print route.
Draft print says DRAFT and has no final number. Original reservation print remains separate.

Four existing endpoints are used through typed clients. Amounts, replacements, discount allocations,
adjustments, labels and quantities come from stored captures/projections, never current configuration.
Live and captured total/version differences are displayed. Optional current company name is explicitly
labeled current; company UUID and captured guest/reservation identity remain visible.

Creation first reads the current server reservation version. Duplicate clicks are guarded; an existing
current-version draft avoids unnecessary duplicates. Stale captures remain unchanged and require
explicit source reload/review and a separate new-draft action. Finalization has an explicit permanence
confirmation and server-owned number. Finalized contents expose no edit/delete/reopen/regenerate action.

Original request body/UUID keys survive ambiguous failures and refresh in session storage. Explicit
retry replays the original request; new writes remain blocked until resolved. Known commits followed
by failed GET remain confirmed commits with a read error, not speculative new writes. Validation,
409, read/network failures and loading states are explicit. Demo gates document actions with zero API
calls. Standalone document print reads its own endpoint even if unrelated reference loading fails.

## Verification

- Complete PostgreSQL regression: **429 passed**; Alembic drift absent; Ruff lint/format passed.
- Focused frontend: **17 passed** (13 document cases plus four existing mutation-hook cases).
- Complete frontend: **228 passed in 42 files**. TypeScript, ESLint and production build passed.
- [Eight browser checks](../../booking-tests/reports/20261015T015231Z-billing-documents-ui/results.json)
  and [SQL/restart verification](../../booking-tests/reports/20261015T015231Z-billing-documents-ui/postgres-verification.json)
  passed. Original React controls exercise duplicate clicks, committed-but-lost create/finalize
  responses, refresh/original-key replay, real stale-source rejection, explicit new draft, confirmation,
  permanent numbering, historical label/price preservation, draft/final PDF and independent demo.
  One reservation, two drafts/one final, stored captures/hash, pricing history, three document audit
  events and a single consumed number were verified; records survived a real owned API restart.
- [Existing rich regression: 26 checks passed](../../booking-tests/reports/20261015T015732Z-rich-api-integration/results.json),
  followed by actual SQL and API-restart verification. Original create/edit, configuration, purchases,
  discounts, lifecycle, reservation print and demo paths remain working.

The [first rich browser run](../../booking-tests/reports/20261015T015520Z-rich-api-integration/results.json)
timed out waiting five seconds for a reservation-print discount label. Its saved DOM contains the
expected label; an unchanged rerun passed all 26 checks. No assertion was weakened or application
change made for this timing failure. Both runs remain preserved.

The initial frontend regression caught duplicate sibling React keys between the new document section
and the existing channel panel. The new section key was namespaced; the complete rerun passed,
including all existing channel tests. The [isolated failed report](../../booking-tests/channel-regression-20261015.json)
is retained. Existing TestClient deprecation and bundle-size warnings remain.

Backend and synthetic browser suites ran separately. Only owned synthetic `hms_test` companies were
cleaned; development business data was not written. Test-owner document cleanup uses the existing
exclusive-table-lock transaction with trigger re-enabled before commit; no application bypass added.
User-owned servers and ZKBioTime were untouched. Temporary verification servers were stopped.
Final [preservation baseline](../../backend/verification/billing-documents-ui-before-20261015.json)
comparison passed with no additional retained test rows; every pre-existing row/column is unchanged.
[Final environment inventory](../../backend/verification/current-integration-audit-20261015T015924Z.json)
confirms isolated Python/databases, UTC and unchanged head `68f75a14d5a4`.

## Files and run commands

New: `src/app/api/billingDocuments.ts`, `src/components/billing/BillingDocumentsSection.tsx`,
`BillingDocumentContents.tsx`, `BillingDocuments.test.tsx`, `src/pages/BillingDocumentPrintPage.tsx`,
`integration-tests/browser-billing-documents.mjs`, `run-billing-documents.py`, preservation/browser
evidence and this checkpoint. Modified: API client/router, backward-compatible mutation error formatter,
ReservationDetailPage, backend README/document contract and architecture diagram. Earlier changes in
overlapping files remain intact.

From `HotelSystem`, normally restart an old launcher and use `./run-api.bat`; no migration/reseed needed.

```powershell
npx vitest run src/components/billing/BillingDocuments.test.tsx src/app/api/useMutation.test.ts --maxWorkers=2
& .\backend\scripts\python.ps1 integration-tests/run-billing-documents.py
npm test -- --maxWorkers=2
npm run lint
npm run build
```

Run full PostgreSQL tests separately from browser harnesses. From `backend`:

```powershell
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/billing-documents-ui-before-20261015.json
```

## Limits and next milestone

Operational bills are not tax invoices, official receipts, payments or accounting postings. One final
bill per reservation remains the contract; correction/credit documents are deferred. Actor identity
remains local development. No public deployment/authentication or new financial rules were introduced.
Current company name is not a historical legal-identity capture. Session recovery is browser-tab scoped;
cross-tab simultaneous drafts remain subject to backend rules, not a new global draft uniqueness rule.

Stop at this frontend milestone. Next recommended task: review and approve the correction-document
contract before permitting replacement/correction of a finalized bill; do not weaken its immutability
or silently regenerate it. Payment/accounting and statutory-document policy remain separate work.
