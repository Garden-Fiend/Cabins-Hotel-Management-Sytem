# Odoo Accounting Movement Investigation Plan — Revised (v19.4)

**Project:** HMS native accounting foundation and optional Odoo adapter
**Status:** Research plan — no implementation authorized
**Revision note:** Thinned using public Odoo documentation (docs `master` branch, closest reachable to 19.4). Items marked *Documented* need only a read plus one confirmation check. Items marked *Trace* need hands-on experiments. Confirm every "verify" against your installed 19.4 build.

Sections 1–3 (objectives, safety setup, movement map) and 5–6 (evidence template, models to inspect) of the original plan are unchanged.

## 4. Experiment matrix — with public-documentation status

| ID | Controlled Odoo action | Public status (19.x) | Plan |
|---|---|---|---|
| A1 | Draft customer invoice | **Documented.** Drafts are created in Draft status and have no accounting impact until confirmed. | Read docs; one confirmation check that no journal items are posted. |
| A2 | Post the invoice | **Documented (state, numbering, immutability).** Confirm → Posted, journal entry generated, unique sequence number assigned, no edits unless reset to draft; optional hash locking. | Read docs. **Trace** the actual debit/credit lines, accounts and tax lines for your journal. |
| A3 | Full payment | **Partly documented.** Payments can be linked or stand-alone; the payment hits an outstanding receipts account until bank reconciliation; the invoice counts as Paid after reconciliation (In Payment before). | **Trace** (core). Capture payment move, reconciliation records, state transitions. |
| A4 | Partial payment | **Partly documented.** Partial reconciliation via `account.partial.reconcile`; `payment_state` includes partial. | **Trace**, with a short read of the reconciliation source for your version. |
| A5 | Discount before posting | **Not documented for your chart.** | **Trace.** |
| A6 | Credit note | **Documented.** Reverse entry cancels original items; two paths (Reverse = draft credit note, partial refund possible; Reverse and Create invoice = auto-validated and reconciled with a new draft invoice); `R` + original number sequence; refund of money needs a separate payment. | Read docs. One confirmation trace of both paths. |
| A7 | Reverse/correct a payment | **Not confirmed.** The payments page was not reachable for 19.x. | Read the payments page in your instance first, then **trace**. |
| A8 | Cancel/reset invoice | **Documented at the headline level** (Reset to draft; hash lock blocks it). | Read docs; one check of the state guards. |
| A9 | Advance/deposit | **Partly documented.** Down payment is a percentage or fixed-amount invoice from a sales order, deducted on the final invoice; reconciliation described as automatic (secondary source). Default accounts not found. | **Trace** (accounts, liability vs receivable, final application). |
| A10 | Multi-line invoice account mapping | **Not documented for your chart.** | **Trace** (core). |
| A11 | Manual journal entry | Generic; balanced-entry rule is visible in source. | Short check only. |
| A12 | Period locks | **Documented.** Sales lock, purchase lock, tax return lock, lock-everyone date (with exceptions), hard lock (no exceptions). | Read docs. Test only: backdated posting and the lock exception procedure. Edge case to test: reconciling or payment entries across a locked period (undocumented). |

**Priority:** A1–A3, A7, A10 first; then A4, A5, A9; A6, A8, A12 as short confirmations.

## 7. Investigation sequence (thinned)

### Phase 0 — Read (new)
Read the 19.x customer invoices, payments, credit notes, down payment and lock dates pages. Read the `account.move` and `account.partial.reconcile` source for your exact version. Record anything that differs from this plan.

### Phase 1 — Invoice lifecycle (A1, A2)
Create draft, post, capture lines, accounts, taxes and sequence number. Confirm editability change.
**Exit:** Explain which event establishes a posted receivable and the balanced entry.

### Phase 2 — Payments and reconciliation (A3, A4, A7)
Full payment, partial payment, then payment reversal. Capture payment moves, outstanding receipts account behavior, reconciliation records and `payment_state` changes. Compare payment registration with bank reconciliation if configured.
**Exit:** Explain relationships among payment, receivable, reconciliation and invoice status, and how a payment is corrected.

### Phase 3 — Mapping (A5, A10)
Distinct test products for accommodation, meals and extras; multi-line invoice with a discount line; record account selection and tax effects, including configuration-dependent variants.
**Exit:** Draft HMS-to-account mapping table from observations.

### Phase 4 — Deposits (A9)
Down-payment invoice and payment, then final invoice; record accounts, reconciliation and any credit note on overpayment.
**Exit:** Decide liability vs receivable treatment for HMS deposits (policy decision, not just Odoo behavior).

### Phase 5 — Confirmations and controls (A6, A8, A11, A12)
One trace each for credit note paths, reset/cancel guards, manual entry and lock behavior; compare ledger and trial balance totals to collected evidence.
**Exit:** Minimum posting, reconciliation and reporting invariants for native accounting.

## 8–12. Unchanged

Translation into HMS design, proposed boundaries, deliverables, first session checklist and completion criteria remain as in the original plan. Update the first-session checklist: the Odoo version is now **19.4** (confirm edition, company, currency, localization and test database).

## Open items from the documentation pass

- Payments page not read for 19.x (blocks A7 planning).
- Default down-payment accounts not found in official docs.
- Behavior of locks on payment and reconciliation entries is undocumented.
- Confirm that docs `master` matches 19.4 for credit note and lock date behavior.
