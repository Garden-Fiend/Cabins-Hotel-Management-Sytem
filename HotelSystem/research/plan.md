# Odoo Accounting Movement Investigation Plan

**Project:** HMS native accounting foundation and optional Odoo adapter  
**Status:** Research plan — no implementation authorized  
**Goal:** Trace real, controlled accounting transactions in the hotel's Odoo configuration and convert observed behavior into verified requirements for a modular native accounting engine.

## 1. Objectives

For each action, establish:

1. What triggered it (invoice, payment, discount, refund, adjustment, deposit)?
2. What business documents and accounting records were created or changed?
3. Which accounts were debited and credited?
4. How did balances, payment states, and reconciliation change?
5. How are errors, cancellations, corrections, and reversals represented?

**Principle:** Learn Odoo's accounting invariants without copying its database architecture verbatim. Native accounting must work independently of Odoo; the adapter remains optional.

## 2. Safety and investigation setup

- Identify the Odoo version, edition, installed accounting modules, company, currency, and tax configuration.
- Prefer a dedicated test database/company with fictional customers, products, and safe test journals.
- Never post experimental transactions to a live accounting period without explicit authorization.
- Do not alter production records, query production databases directly, or use privileged APIs for exploratory writes.
- Redact real guest details, bank data, account credentials, and other sensitive information from screenshots/exports.
- Record the exact configuration used; accounting behavior varies with version, journals, taxes, and account mappings.

## 3. Movement map to investigate

```text
Hotel action
  -> Odoo business document (invoice / credit note / payment)
  -> Accounting move and journal lines (debit / credit)
  -> Reconciliation / residual receivable
  -> General ledger / trial balance / financial reports
```

This is a **tracing guide**, not a claim that every Odoo action creates records in that exact order.

## 4. Experiment matrix

| ID | Controlled Odoo action | Questions / evidence |
|---|---|---|
| A1 | Create a draft customer invoice | Document state; whether draft journal items exist; editable fields |
| A2 | Post the invoice | Journal, accounts, debit/credit, taxes, posting date, unique reference |
| A3 | Register full payment | Payment records, counterpart accounts, reconciliation, zero residual |
| A4 | Register partial payment | Partial reconciliation and remaining receivable |
| A5 | Apply discount before posting | Discount representation, revenue account and tax basis |
| A6 | Issue a credit note | Original linkage, reversal/correction entries, residual changes |
| A7 | Reverse/correct a payment | Payment state, original preservation, reconciliation effects |
| A8 | Cancel/reset invoice where allowed | State guards, editability, accounting consequences |
| A9 | Record customer advance/deposit | Liability versus receivable treatment and later application |
| A10 | Add multiple invoice lines | Account mapping for rooms, meals, extras, services |
| A11 | Create a manual journal entry | Balanced posting independent of invoices |
| A12 | Test locked accounting period in safe environment | Backdating, lock restrictions and correction procedure |

**Priority:** A1–A7 and A10. Start with one invoice-to-payment trace before expanding.

## 5. Evidence collection template

Create one section per experiment, using this template:

```markdown
### Experiment A# — [name]
- Odoo version / company / test database:
- Preconditions / relevant settings:
- Test customer, product, tax, journal:
- Starting document state and balances:
- Exact UI action performed:
- Resulting business documents and IDs:
- Resulting accounting moves and IDs:
- Journal lines (account | partner | debit | credit | currency):
- Reconciliation links / residual balance:
- Status changes and timestamps:
- Before / action / after screenshots or exports:
- Observed behavior (facts only):
- Uncertainties / version-dependent behavior:
- Candidate HMS rule (hypothesis until approved):
- Regression test to implement later:
```

Capture **before**, **action**, and **after** snapshots. Where visible, record document number, state, invoice/accounting date, journal, account code, partner, debit, credit, currency, residual amount, payment state, reconciliation IDs, and reversal references.

## 6. Odoo models and relationships to inspect

| Model | Investigation focus |
|---|---|
| `account.move` | Invoices, credit notes, journal entries and states |
| `account.move.line` | Journal items, debit/credit, account and partner |
| `account.account` | Chart of accounts and account types |
| `account.journal` | Sales, cash, bank and miscellaneous journals |
| `account.payment` | Payment recording and accounting relationships |
| `account.partial.reconcile` | Partial matching of receivable/payable lines |
| `account.full.reconcile` | Full reconciliation grouping |
| `res.partner` | Customer/vendor identity |
| `account.tax` | Tax computation and account impact |

Use Odoo developer mode or authorized read-only exports if needed. Confirm exact model fields against the installed version; do not assume model internals are stable across versions.

## 7. Investigation sequence

### Phase 1 — Invoice lifecycle

1. Record chart-of-accounts and sales journal settings relevant to a fictional room charge.
2. Create draft invoice; capture state and any generated journal items.
3. Post invoice; capture journal entry, all lines, and receivable balance.
4. Compare draft versus posted editability and identifiers.

**Exit:** Explain which event establishes a posted receivable and the corresponding balanced entry.

### Phase 2 — Payments and reconciliation

1. Pay one posted invoice fully.
2. Repeat with partial payment.
3. Inspect payment journal entries, reconciliation links, and residual balances.
4. Observe how payment registration differs from bank reconciliation, if configured.

**Exit:** Explain the relationship among payment, receivable, reconciliation and invoice status.

### Phase 3 — Corrections

1. Apply a pre-posting discount in a new test invoice.
2. Issue a credit note for a posted invoice.
3. Investigate safe payment correction/reversal.
4. Test cancellation/reset only if permitted in the isolated environment.

**Exit:** Document which records remain immutable and how correction history is linked.

### Phase 4 — Hotel account mapping

1. Set up distinct test items for accommodation, meal and extra service.
2. Inspect product/category income account configuration.
3. Post a multi-line invoice; capture line-level account selection and tax effects.
4. Record configuration-dependent variations, not just one observed outcome.

**Exit:** Draft an HMS-to-account mapping table grounded in actual observations.

### Phase 5 — Reports and controls

1. Trace posted moves into general ledger and trial balance.
2. Test manual balanced journal entries.
3. Investigate deposits and period locks in safe test configuration.
4. Compare report totals to collected journal evidence.

**Exit:** Identify the minimum posting, reconciliation and reporting invariants for native accounting.

## 8. Translation into HMS design

For each confirmed observation, produce:

- **Business rule:** permitted action and lifecycle transition.
- **Domain owner:** Reservations, Billing, Native Accounting or Integrations.
- **Data model:** entities, IDs, links, states and immutable fields.
- **Atomicity rule:** records that must commit or rollback together.
- **Accounting invariant:** balanced debit/credit, valid accounts, period rules, currency handling.
- **Correction rule:** when to edit drafts versus reverse/correct posted records.
- **Mapping rule:** hotel charge category to accounting account.
- **Test:** observable evidence that the HMS implementation is correct.

Keep **observed Odoo behavior**, **proposed HMS behavior**, and **unresolved accounting policy** in separate columns. Odoo-specific implementation details are not automatically HMS requirements.

## 9. Proposed HMS boundaries

```text
Reservations -> Billing documents / operational transactions
                        |
                        v
               Approved posting command
                        |
                        v
                Native Accounting
          (journals, lines, balances, reports)
                        |
              optional integration feed
                        v
                   Odoo Adapter
```

- Native accounting is intended to function without Odoo.
- Odoo synchronization must not be required for front-desk operations or native posting.
- Never independently post the same financial fact twice as authoritative accounting.
- Track source document, posting identity, idempotency, correction links and optional external references.
- Keep provider-specific IDs and mappings inside the integration module.

## 10. Deliverables

- `docs/research/odoo-accounting-movement-study.md` — experiment-by-experiment evidence and findings.
- Evidence folder with sanitized screenshots/exports, indexed by experiment ID.
- Odoo accounting movement diagram based on observed records.
- Hotel charge-to-account mapping matrix.
- Draft native accounting entity/transaction requirements.
- Open policy decisions and prioritized implementation tests.

## 11. First session checklist

- [ ] Confirm Odoo version, edition, company, currency and test environment.
- [ ] Identify safe fictional customer, room-charge product and sales journal.
- [ ] Capture chart-of-accounts and product account configuration.
- [ ] Perform A1: draft invoice; capture state and journal items.
- [ ] Perform A2: post invoice; capture move and debit/credit lines.
- [ ] Perform A3: register full payment; capture payment and reconciliation.
- [ ] Record uncertainties and distinguish observation from interpretation.
- [ ] Share sanitized evidence for HMS accounting-model review.

## 12. Completion criteria

The investigation is sufficient for a first native accounting vertical slice when we can trace **one invoice from draft through posting and payment**, identify its journal lines and reconciliations, reproduce its accounting totals, and specify how corrections must be handled — with evidence, not assumptions.

**Next question:** Which Odoo version and edition are installed? Record this before following version-specific screens or fields.
