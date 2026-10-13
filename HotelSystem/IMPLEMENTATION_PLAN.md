# HMS Implementation Plan — Backend Persistence to Native Accounting

**Baseline:** Monday, 12 October 2026 (Asia/Manila)  
**Immediate objective:** Use the remaining ~2 hours today to authorize and scaffold Week 1, without compromising the current frontend.  
**Week 1:** 13–17 October — persistent reservations  
**Week 2:** 19–24 October — native ledger foundation  
**Week 3:** 26–31 October — invoice-to-ledger vertical slice

> This is an implementation plan, not a claim that work has been executed. Codex must inspect the current repository before editing, record discoveries, and report actual test results.

## 1. Architecture decisions (approved direction)

- Standalone HMS and **native accounting** are the long-term target. Odoo is an **optional future adapter**, never a runtime dependency.
- **Modular monolith:** React/TypeScript frontend → FastAPI/Pydantic API → SQLAlchemy → PostgreSQL; Alembic owns migrations.
- Domain boundaries: `reservations` (guests, room allocation, pricing), `billing` (charges, finalized documents, payments), `accounting` (accounts, journals, posting, reconciliation), `integrations` (Odoo and other adapters), `reporting` (read models).
- One PostgreSQL database initially, module-owned tables/services. Do not implement microservices, event brokers, or empty abstractions without use cases.
- Keep rich demo mode separate from persistent mode. Never silently fall back to demo data on API failure.
- HMS operational charges are **not automatically accounting invoices**. Accounting posting is an explicit controlled step.
- Support one company and PHP for the initial slice, but represent company identity, currency, historical pricing/tax details, and stable source IDs from the start.

## 2. TODAY — two-hour execution window (Monday, Oct 12)

### 0–15 min: Repository baseline and safety
- Inspect git status, branch, frontend package scripts, directory structure, and current demo-store integration.
- Record baseline lint, tests, build (run only what fits time); **do not discard user changes**.
- Identify local PostgreSQL/Docker availability. Never touch the ZKBioTime Python environment or database.
- Record findings and blockers in `docs/planning/backend-kickoff.md`.

### 15–35 min: Lock first-week scope and contracts
- Week 1 supports **single-room direct bookings, PHP, seeded read-only reference configuration, and server-owned pricing**.
- Multi-room/custom stays, OTA settlements, advanced discounts, extras, native journal posting, authentication, and Odoo synchronization are **deferred**. Unsupported persistent-mode UI actions must be clearly disabled, not fake-saved.
- Guest creation remains an independent command unless the current code reveals a transaction-integrity reason to bundle it; report any proposed change.
- Specify `POST /api/v1/reservations`, `GET /api/v1/reservations`, `GET /api/v1/reservations/{id}`, `PATCH /api/v1/reservations/{id}`, guest/reference read endpoints, and health endpoint. Do not implement every endpoint today.
- Write down mutation contract: idempotency key, expected version on edit, server-calculated price, explicit error responses, and atomic reservation/stay/pricing/audit writes.

### 35–100 min: Scaffold an isolated backend
- Add `backend/` with project-owned Python environment instructions, FastAPI app, settings, SQLAlchemy session setup, Alembic, test configuration, and `.env.example` (no credentials committed).
- Establish an isolated PostgreSQL dev database; prefer project-specific Docker Compose if healthy, otherwise document a dedicated native instance. Never reuse existing app databases.
- Implement `/api/v1/health` and a DB connectivity check. Create initial migration for **only the minimal proven schema**: guests, room types, rooms, reference rates, reservations, room allocations, pricing revisions, operational audit, and mutation receipts. Include company/currency/source identifiers where appropriate.
- Build explicit seed command for reference data, never auto-reset or auto-seed live data at app startup.
- Ensure a clean migration from empty DB and a successful basic API/test run. If migration scope exceeds time, stop after verified scaffold and document schema next steps rather than rushing constraints.

### 100–120 min: Verify and hand off
- Run applicable tests, lint/build and Alembic checks. Record pass/fail honestly.
- Provide exact run commands, files changed, database isolation evidence, known blockers, and tomorrow's first task.
- Commit only if explicitly authorized by repository workflow; otherwise leave a reviewable diff.

**Today's definition of done:** isolated backend scaffold, documented module boundaries and command contracts, verified health endpoint and DB/migration path (or a precise blocker), plus a short handoff. **Do not claim reservation persistence is complete today.**

## 3. Week 1 — reliable hotel persistence (Oct 13–17)

### Tuesday — foundation
- Finalize schema and DTOs; migration, reference seed, separate dev/test DBs; initial service skeleton.
- Model reservation as aggregate root; one authoritative room allocation per stay; stable UUID and business reference.
- Establish datetime handling (UTC-aware persistence, Asia/Manila hotel policy), PHP minor-unit money, exact rounding and version fields.

### Wednesday — atomic reservation writes
- Implement guest/reservation create/read with server-side price calculation and historical pricing revision.
- One transaction for reservation, allocation, charges/pricing, audit and idempotency receipt.
- **Prevent double booking at DB level from first write**: PostgreSQL `tstzrange` `[start,end)` exclusion constraint (with `btree_gist`) for conflicting active allocations, plus room locking/physical occupancy rules as needed.
- Test concurrent writers, forced rollback, forged totals and repeated idempotency keys.
- **Gate:** if first safe transactional write is not working, fall back to Plan A: single-room create/read/edit and pricing/audit, defer lifecycle/adjustments.

### Thursday — frontend persistence
- Introduce API client/DTO adapter and explicit provider commands; preserve demo mode separately.
- Await reservation saves before closing/resetting forms; retain draft on error.
- Persist calendar/detail/guest reads through browser refresh and API restart; show API-unavailable state rather than demo fallback.
- Version-check edits and return 409 for stale/conflicting requests.

### Friday — lifecycle and supported billing facts
- Implement supported check-in/check-out/cancel/no-show only with tested transactional constraints.
- Implement signed operational adjustments and auditable retirement/correction only if core gates passed.
- Maintain overdue occupancy behavior and historical price revisions.
- Do **not** implement accounting posting yet.

### Saturday — hardening and deployment rehearsal
- Feature freeze, regression, conflict/idempotency tests, restore/migrate into a second isolated PostgreSQL DB, runbook.
- Document future Supabase connection/migration path; Supabase hosts PostgreSQL, FastAPI requires separate hosting.
- Explicitly list deferred or disabled features; no false frontend parity claims.

## 4. Week 2 — native accounting kernel (Oct 19–24)

- Create module-owned models: `Company`, `Currency` context, `Account`, `Journal`, `AccountingPeriod`, `JournalEntry`, `JournalLine`, `PostingReference`, `AccountMapping`; include immutable source links, reversal links, timestamps and actor attribution.
- Implement validated, **balanced** posting in a single DB transaction; reject invalid accounts, closed periods, currency/company mismatches, duplicate source postings, unbalanced debits/credits, and invalid dates.
- Posted entries cannot be edited/deleted; correcting entries/reversals are linked and auditable.
- Draft billing documents do not affect ledger. Define document finalization boundary; use versioned financial snapshots rather than recalculating from current room prices.
- Seed minimal PHP chart of accounts (cash/bank, receivables, clearing, customer advances, output VAT, room/meal/extra revenue, expenses, equity). Seed accounts as configurable records, not hardcoded ledger logic.
- Test balanced posting, posting twice, rollback, reversals, period lock, concurrent attempts, VAT-inclusive arithmetic. Separate accounting policy choices from engine invariants.
- **Gate:** one finalized test document posts exactly once to a balanced immutable entry and can be corrected through a linked reversal.

## 5. Week 3 — end-to-end accounting vertical slice (Oct 26–31)

- Connect supported finalized HMS invoices to accounting through an explicit posting service and stable source document reference.
- Add `Payment`, `PaymentAllocation`, partial payment/residual logic and controlled payment correction; choose clearing-account versus direct-cash policy by payment method, not by assumption.
- Build read-only journal, general ledger and trial balance views derived solely from posted lines. Add basic P&L and balance sheet only after account-type mappings are verified.
- Exercise: reservation → accommodation charge → finalized invoice → VAT/revenue/receivable journal → partial/full payment → allocation → ledger/trial balance; demonstrate without Odoo.
- Add audit trail and test replay, concurrency, failures and reconciliation of invoice residual with allocated payments.
- **Gate:** a supported hotel invoice can be billed, posted, paid, corrected and traced without Odoo. This is a **foundation**, not a production-certified Odoo replacement.

## 6. Accounting rules we must preserve from day one

1. Every posted journal entry balances (debits = credits) in exact currency units.
2. Drafts have no ledger impact; posting is explicit and authorized.
3. Posted entries are immutable; corrections use linked reversals/adjustments.
4. Posting is atomic, idempotent and protected against concurrent duplicates.
5. Ledger reports derive from posted journal lines, not editable cached balances.
6. Invoice, payment, reconciliation, bank clearing and revenue recognition are distinct concepts.
7. Finalized financial documents preserve tax bases, tax components, rounding, currency, company and resolved account mapping historically.
8. No Odoo IDs/fields in core reservation/billing/accounting tables; optional adapter owns external IDs and sync state.
9. Deposits are **not universally revenue**; posting treatment must be approved by policy and applicable law before production.
10. Multi-company and multi-currency operations are deferred, but data ownership/currency representation must not preclude them.

## 7. Known research findings and unresolved policy

The uploaded Odoo 19.4 study observed: draft invoice without posted journal items; posted ₱2,300 tax-inclusive invoice with ₱2,053.57 revenue credit, ₱246.43 output VAT credit and ₱2,300 receivable debit; payment moved receivable to Outstanding Receipts; bank reconciliation moved Outstanding Receipts to Cash in Bank. These are **observations of one configuration**, not universal accounting policy.

Do not block the ledger kernel on further Odoo reverse engineering. Still validate before enabling production behavior: advance/deposit treatment, true partial payments, paid-invoice refunds, payment reversals, account/tax mapping by item category, period locks and Philippine regulatory requirements. A qualified accountant should approve posting/tax rules before production.

## 8. Cross-cutting acceptance criteria

- No duplicate room allocation under real concurrent PostgreSQL transactions.
- No partial reservation, billing or accounting state after failed transactions.
- No duplicate postings on request retry or process restart.
- Server is authoritative for price, dates, journal totals and audit identity.
- Stale updates fail explicitly; UI preserves user input on failure.
- Posted entries are balanced, traceable and immutable; reversals preserve history.
- Migration and backup/restore tested on a second database.
- Frontend demo remains available but never masquerades as saved data.
- Tests run against PostgreSQL for exclusion, locking and transaction behavior; SQLite is not a substitute.
- No reliance on Odoo to operate hotel reservations, billing or native accounting.

## 9. Codex kickoff instruction — execute today only

> Inspect the current HMS repository and this `IMPLEMENTATION_PLAN.md`. Begin **only Section 2 (TODAY)**. First report git/worktree state, relevant existing architecture, and available isolated PostgreSQL setup. Preserve all user changes; never touch the ZKBioTime environment. Establish a minimal FastAPI/SQLAlchemy/Alembic backend scaffold, explicit module boundaries and API contracts, a safe isolated database path, a working health check, and documented migration/seed strategy. Run and report actual checks. Do not implement native accounting, broad frontend refactors, or unsupported reservation behavior today. If a safety-critical constraint cannot be completed within the window, stop at a verified checkpoint and report exactly what remains. End with a concise handoff: changed files, commands, tests, blockers and Tuesday's first action.
