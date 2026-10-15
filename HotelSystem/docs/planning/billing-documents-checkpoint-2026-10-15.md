# Billing-document foundation checkpoint

Date: October 15, 2026, Asia/Manila. Baseline:
[accepted final-price checkpoint](final-prices-checkpoint-2026-10-15.md), `f19b362d47a0`.
Earlier uncommitted discount work was retained. No commit/push, dependency installation,
database reset, fixture import, frontend implementation, payments or accounting.

## Implemented backend slice

Company-owned `operational_bill` documents support fixed draft capture, read/list and explicit
finalization. **Draft version 1 → Finalized version 2** is the only transition. These are operational
bills, not tax invoices or accounting postings. The [contract](../../backend/billing-documents.md)
defines inputs, captures, eligibility, numbering, concurrency and deferred corrections.

Four endpoints:

- `POST /api/v1/reservations/{id}/billing-documents`, with `expected_reservation_version`.
- `GET /api/v1/billing-documents/{id}`.
- `GET /api/v1/reservations/{id}/billing-documents`, with bounded limit/offset.
- `POST /api/v1/billing-documents/{id}/finalize`, with document `expected_version`.

Mutations require UUID request keys. Captures include guest/reservation/stay identity and the
complete authoritative pricing revision: quantities, original units, separate replacement units/
effects, discounts/allocations, adjustments, PHP total and historical provenance. Typed line reads
project captured results, never current configuration. A canonical capture hash detects corruption.
No second pricing engine was introduced.

Finalization checks source reservation version, pricing revision identity and captured pricing
contents. Any intervening source change, including notes/counts, rejects with 409. Drafts never
refresh silently; review and create a new draft. One finalized document per company/reservation is
enforced; multiple drafts are allowed. Cancelled/no-show sources reject for this slice. Confirmed,
reserved, checked-in and checked-out sources are eligible, including zero totals.

Finalization serializes document/source writers, then allocates `HMS-BILL-00000001`, etc., from a
transactional company counter. Number, document, audit and durable receipt commit together. Failures
consume no number. Identical replay returns the original response without new writes; different
body/target conflicts. Draft creation replay after finalization returns its original draft response;
GET returns the current final state.

Reservation/allocation/pricing rows are not mutated by document operations; operational audit and
receipts are appended. Later reservation edits remain possible without changing finalized content.
PostgreSQL triggers reject finalized edits/deletion/reopening and direct finalized insertion, freeze
captured content through finalization, reject unsupported draft edits and prevent truncation.
Composite foreign keys retain owned reservation/pricing provenance. Lines reside in the document's
single JSON aggregate, avoiding orphaned child-line writes.

## Actual verification

| Check | Result |
|---|---|
| Focused PostgreSQL document suite | **27 passed** |
| Complete backend PostgreSQL regression | **429 passed** |
| Complete frontend regression | **215 passed in 41 files** |
| ESLint / TypeScript / production build | Passed |
| Ruff lint / format / dependency consistency | Passed |
| Alembic drift / both database heads | No drift / `68f75a14d5a4` |
| Real HTTP process restart, SQL capture and durable replay | Passed |
| Original-row preservation comparison | Passed |

Focused cases verify room and purchased-item overrides followed by sequential reductions, captured
original/effective units, extras, signed adjustments, zero totals, stale financial and note changes,
creation/finalization replay and changed-key payload/target conflicts, concurrent identical creation,
same/different-draft finalization races, distinct-reservation numbering, strict fields/versions and
foreign-company denial. Direct SQL attempts to edit, delete or reopen finalized documents reject.
An explicit subsequent reservation repricing leaves the finalized document unchanged.

Injected failures after draft/document, counter insertion/increment, audit and receipt writes, and
immediately before commit leave complete raw state unchanged. Failed keys can retry successfully;
rolled-back finalization still receives number 1. Source reservation/allocation/pricing preservation
is also asserted directly. TRUNCATE was not attempted; its rejecting statement trigger is installed.

[HTTP evidence](../../backend/verification/http-billing-documents-20261015T012439Z.json) records real
loopback Uvicorn restarts, draft/finalized GET/list persistence, original create/PATCH behavior,
durable draft/finalize replay, SQL contents/counts and cleanup. No document UI exists or was claimed
browser-verified. Existing reservation print/demo code was not changed by this slice.

Two initial focused-test failures were test setup/expectation errors: special extras require their
existing non-sellable flag, and reservation reductions allocate in original room-first line order
rather than proportionally. Tests were corrected to the established contracts; pricing behavior was
not changed to satisfy them. Initial Ruff formatting/line-length findings were corrected. Existing
non-failing TestClient deprecation and frontend bundle-size warnings remain.

## Migration and preservation

Additive revision `68f75a14d5a4` follows unchanged `f19b362d47a0`. It adds `billing_documents` and
`billing_document_counters`, source uniqueness/FKs, state/money/key/number constraints and guards.
Referenced pricing uniqueness precedes the new composite FK. Both isolated databases upgraded:
**sixteen revisions, nineteen HMS tables**. No documents/counters were fabricated from old bookings.
Downgrade refuses unreviewed document removal; none ran. Empty-database/recovery rehearsal was not
repeated for this slice.

[Hash-only baseline](../../backend/verification/billing-documents-before-20261015.json) compared every
pre-existing row/column after tests and cleanup: unchanged. One additional development room plus its
audit/receipt was detected and retained. Both new tables are empty in dev/test after synthetic cleanup.
[Final inventory](../../backend/verification/current-integration-audit-20261015T012934Z.json) verifies
owned Python, separate DBs, UTC and matching migration heads. Test suites/HTTP harness ran separately.
Only random harness-owned synthetic companies were cleaned; development business data was not
written by verification. Temporary servers were stopped; user servers and ZKBioTime were untouched.

Test-owner cleanup needs privileged trigger maintenance because finalized rows cannot be deleted
normally. It disables only the row guard under an exclusive-table-lock transaction, deletes only
the synthetic company scope, then re-enables before commit. No request/API bypass exists. Production
least-privilege roles remain future work; a database owner can administer triggers.

## Files and reproduce

Created: `backend/app/modules/billing/documents.py`, `documents_schemas.py`, `router.py`;
the migration above; `tests/test_billing_documents.py`; `scripts/http-billing-documents.py`;
`backend/billing-documents.md`; preservation/HTTP/inventory evidence; this checkpoint.

Modified for this slice: billing models, model exports and main router registration; backend
README/contracts and current architecture diagram. Earlier overlapping documentation edits and all
uncommitted frontend/pricing changes remain intact. No frontend source was edited in this slice.

From `HotelSystem/backend`:

```powershell
& .\scripts\python.ps1 -m alembic upgrade head
& .\scripts\python.ps1 scripts/migrate-test.py
& .\scripts\python.ps1 -m pytest --postgres -q tests/test_billing_documents.py
& .\scripts\python.ps1 -m pytest --postgres -q
& .\scripts\python.ps1 scripts/http-billing-documents.py
& .\scripts\python.ps1 -m alembic check
& .\scripts\python.ps1 scripts/verify-sprint-data.py check verification/billing-documents-before-20261015.json
```

Run PostgreSQL tests separately from synthetic HTTP/browser harnesses. The owned databases are
already migrated; no reset/reseed is needed. Restart an older API normally to expose the new routes.

## Stop point and next bounded task

The backend vertical slice is verified, with no known blocker inside its supported boundary.
No draft refresh, finalized reopening, correction/credit document, payment, refund, tax engine,
journal, OTA, multi-room or document UI was implemented. Actor identity remains development-only.

Future corrections must have their own identity/number and a same-company relationship to the original
immutable document. Correction amounts/types, tax and payment interactions still require an approved
contract; original documents must not be edited to simulate correction.

**Next bounded milestone:** expose document read/print and explicit draft/finalization review in the
existing reservation detail area, using this API and capture rather than the live reservation print.
Review correction policy before enabling payment records/allocations; native accounting follows
separately. No next-milestone implementation was started.
