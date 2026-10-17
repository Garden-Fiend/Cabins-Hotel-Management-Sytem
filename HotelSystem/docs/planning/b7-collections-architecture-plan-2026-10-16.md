# B7 collection, refund and reversal design

October 17 follow-up: the user's approved `B7_Codex_Implementation_Spec.md` resolves D1-D6 and
supersedes the unresolved recommendations below. See the implemented
[collection contract](../../backend/collections.md) and
[B7 checkpoint](b7-collections-checkpoint-2026-10-17.md). The original planning text remains historical.

October 16, 2026, Asia/Manila. Planning only, against the B6 working tree and migration
`a71b86c2d376`. This document proposes contracts; it does not authorize implementation or
resolve the business decisions below. Existing uncommitted B6 work was left intact.

## 1. Verified starting point

Read: [B6 checkpoint](b6-non-direct-booking-financials-checkpoint-2026-10-16.md),
[commercial contract](../../backend/booking-financials.md),
[document contract](../../backend/billing-documents.md),
[API contracts](../../backend/contracts.md),
[architecture](hms-current-architecture.mmd),
[implementation plan](../../IMPLEMENTATION_PLAN.md), and B7/B8 in the
[parity closure plan](demo-api-parity-closure-plan.md).

| Existing implementation | What B7 can reuse / what it cannot establish |
|---|---|
| `backend/app/modules/reservations/financial_models.py`, `financial_capture.py`, `booking_financials.py` | Owned immutable commercial captures, exact contract/commission expectations, source/agreement provenance. Reported guest amounts are accommodation facts, not verified collection or hotel receipts. |
| `backend/app/modules/billing/documents.py`, `documents_schemas.py` | Stored operational bills, fixed drafts, immutable finalization, source-version checks. No payment allocation, tax receipt, credit document or paid-state workflow. |
| `backend/app/core_models.py`, `app/mutations.py` | Operational audit and durable `mutation_receipts`; resource-bound hashes, advisory request locks and replay. A mutation receipt is an API replay record, not proof of money received. |
| `backend/app/modules/reservations/services.py`, `financial_corrections.py` | Owned reservation locking, expected versions, bounded transaction timeouts, atomic audit/receipt writes. Commercial corrections append history rather than editing captures. |
| `src/features/channels/types.ts` | Demo `CollectionTransaction`: collection/refund/reversal, actual collector, amount/currency, reference, verifier/time. No original-transaction linkage or persistent payment method. |
| `src/lib/channelActions.ts` | Demo append-only transaction behavior, historical-source collection corrections, permission checks and audit. Current refund guard is net nonnegative per selected terms ledger, not per original payment or collector. |
| `src/lib/channelFinance.ts` | Demo sums collections positively and refunds/reversals negatively; guest balance includes historical terms and can be negative. Channel collection is separate from hotel payouts. |
| `ChannelFinancials.tsx`, `ChannelGuestSummary.tsx` | Original detail collection/refund/reversal controls, historical ledger selector, collector/status fields and guest summary. Currently demo state mutations. |
| `ReservationChannelTermsEditor.tsx`, `ChannelIntegration.test.tsx` | Original initial reservation entry can stage a verified collection before saving. B7 parity must include this entry point, not just saved-reservation detail. |
| `src/app/api/RichApiBridge.tsx` | API `verify_collection`, `confirm_commission`, `record_settlement`, `reconcile_settlement` capabilities are currently false. There is no implemented payment write route in the inspected reservation/billing routes. |

**Finding:** real money movement is not integrated. The app has a reusable transactional foundation,
but no persisted collection records, refund/reversal targets, or authoritative collection-derived
balance. Recording a payment will be a staff-attested operational fact; it will not execute a card,
bank, OTA or cash transfer. Actor attribution remains local development, not authenticated staff.

The original implementation plan places payments in the billing module and separates them from
native accounting. B7 should follow that ownership. Its dated week-by-week schedule does not
override the later B6 checkpoint or expand this task into accounting.

## 2. Financial meanings and read model

Keep these values distinct in DTOs, labels and print:

1. **B6 reported guest amount:** what the booking document says (reported-paid/expected/unknown).
   Never automatically imported as a B7 transaction or subtracted again.
2. **Hotel-collected transaction:** staff records evidence of actual hotel collection. Contributes
   to net hotel-collected funds, not commission or channel remittance.
3. **Channel-collected verification:** staff verifies evidence that the channel collected from the
   guest. May contribute to the operational guest balance, but hotel receipt remains zero for it.
   An unverified OTA report remains B6 provenance, not a second payment event.
4. **Channel-to-hotel payout:** a B8 settlement, never a B7 guest collection. A payout cannot reduce
   guest balance again after the underlying channel collection did so.

Proposed server-derived summary, in exact PHP minor units:

- Gross collections, refunds and reversals, separated by actual collector and captured source context.
- Net verified hotel collection and net verified channel collection, plus combined net collection.
- Live operational guest balance = current canonical reservation payable minus combined net collection.
  Preserve the demo's signed balance: negative means credit, not another discount or automatic refund.
- Include current reservation version/pricing UUID and the collection basis used for the summary.
- Keep staff-entered `partial`/`confirmed` verification declaration separate from computed
  unpaid/partial/covered/credit balance state. Demo's declaration is not proof of full payment.

Do not rewrite pricing to represent payment. B6's immutable capture, including its original zero
hotel-received figure, remains historical; new collection summaries live outside `channel` and
`channel_figures`. Neither old operational bills nor their capture hashes change after collection.
Any future bill-specific residual needs explicit allocations and an approved liability basis;
the live reservation balance is not silently presented as a finalized bill's residual.

## 3. Minimal proposed storage

One new module-owned `billing_collection_transactions` table in `hms`, implemented under
`backend/app/modules/billing/`. Reuse reservation version/audit/mutation receipt infrastructure;
no new payment framework, ledger, receipt-number counter or settlement table for B7.

Proposed immutable columns:

- UUID, company UUID, reservation UUID, reservation version at recording, server sequence/order.
- `kind`: collection/refund/reversal; `collector`: hotel/channel; positive safe integer `amount_minor`;
  PHP currency. Never accept signed amounts alongside kind-based signs.
- Nullable owned `booking_financial_capture_id`, owned captured `source_id`, historical source
  label/reference snapshot. Non-direct attribution uses the exact capture UUID, never history index.
  Direct bookings without B6 captures use their owned reservation source and captured label;
  do not fabricate a commercial capture just to collect a payment.
- `reference`, staff-entered verification declaration, nonblank correction reason for refund/reversal.
- Server actor/attribution and `recorded_at`; separate evidence `occurred_at` only if approved.
  Do not let client-supplied actor/time masquerade as server verification.
- Nullable `related_transaction_id` for correction provenance; exact linking/cap rules are Decision 1.
- Optional observed pricing UUID as context, not an invoice allocation or frozen liability.

Use composite ownership FKs for reservation/source/capture/related transaction, including reservation
identity where required; verify capture belongs to the same reservation and captured source.
Retain history under source changes, disabled sources and retired agreements. Refund attribution
must not move to the current channel merely because the reservation was corrected.

DB checks: enum allowlists, amount > 0 and <= existing safe-money maximum, PHP only, nonblank
reference/reason where required, valid provenance, unique transaction identity and reservation
recording order. Append-only UPDATE/DELETE/TRUNCATE guards follow existing capture patterns.
Cross-row refund/reversal checks require locked service validation and, where practical, a narrow
DB insert guard taking the same parent lock; a CHECK constraint cannot enforce aggregate sums.

Index `(company_id, reservation_id, recording_order)` and capture/related transaction lookups.
No guessed uniqueness of external references: one transfer may legitimately be split; Decision 4
must settle duplicate-evidence policy. Existing request receipts provide retry deduplication.

An additive migration creates empty storage only. No payment backfill from reported-paid facts,
demo fixtures, pricing, bill issuance or B6 expected remittance. Existing documents and captures
are not altered. Downgrade must refuse unreviewed financial-history removal.

## 4. Proposed command and concurrency contract

Reuse `request_hash`, `replay_or_lock`, `save_receipt` and the existing service transaction wrapper.

1. Acquire company/operation/key advisory lock; return original response on matching replay **before**
   checking now-stale versions. Same key with another target/body rejects with 409.
2. Exclusively lock owned reservation; compare strict `expected_version` and reviewed financial
   context. Lock/read related transactions and validate original collector/capture context.
3. Validate positive amount, currency, evidence reference, declaration and approved correction limits;
   derive effects on all relevant historical ledgers and signed balance from server records.
4. Insert immutable transaction, advance reservation version once, append exact audit and durable
   receipt, return canonical summary/history, commit once. No pricing revision or allocation change.

The reservation row is the collection aggregate lock: concurrent collections/refunds/source edits
serialize, so neither refund caps nor captured attribution are computed from stale unlocked sums.
All future collection writers must use it. Initial-create transactions can append to the new parent
inside its existing transaction. No room locks are needed for payment-only writes.

Avoid locking billing documents after the reservation: existing finalize locks document then parent.
B7 need not mutate or lock documents at all. Collection advances reservation version, so an older
draft will become stale under the existing full-source-version rule. Preserve that behavior and show
the reason; do not weaken finalization guards. A finalized bill stays immutable. Whether collection
is allowed in each lifecycle/document state is Decision 3, not inherited from pricing-edit gates.

One transaction rolls back transaction/version/audit/receipt together, including a failure immediately
before commit. Keep existing bounded lock/statement timeouts and explicit retryable errors.
No automatic write retry with a new key after uncertain network failure.

## 5. Minimum API and original-control integration

Proposed routes (names are design, not implemented):

| Route | Purpose |
|---|---|
| `GET /api/v1/reservations/{id}/collections` | Paginated ordered immutable history and a full-history summary, current version/pricing basis; pagination must not truncate totals. |
| `POST /api/v1/reservations/{id}/collections` | Record one collection/refund/reversal with expected version and UUID Idempotency-Key; 201 canonical transaction and summary. |

Write intent contains kind, actual collector, positive amount, PHP, reference, reviewed context,
verification declaration and approved correction linkage/reason. Reject client balance, calculated
net, payout, commission, receipt-number and provenance fields. Foreign resources 404, malformed
inputs 422, stale/key/context/financial-limit conflicts 409, unavailable/timeout explicit 503.

Extend singular and plural create with optional `collections` only for the original staged-collection
entry point. Initial UI currently stages collection, not refund/reversal; keep that scope. Resolve
attribution from the server-created reservation/capture, not an invented client capture UUID.
Save booking, financial facts, collections, audit and receipt in the **same create transaction**;
never create then collect. Omitted field must preserve all existing request hashes and replay.

Reuse the original detail form, historical context selector, transaction/collector/status controls,
guest summary and initial terms editor through awaited typed commands. Preserve demo behavior.
Direct creation/detail support must be inventoried explicitly: the current channel component returns
null without terms, so a direct-payment surface must not fabricate OTA terms to make it render.
If a new direct-only control is needed, approve that small UI extension separately from demo parity.

Display hotel collection and channel verification separately. Preserve drafts on errors; after 409,
review current version/context/available refund amount before resubmitting. Never silently retarget
a historical transaction to the latest source or replay a refund against a different payment.
Use original-key session recovery and duplicate-click guards. Do not enable B8 capabilities when
enabling B7 verification. Reservation print may show a separate current collection section; stored
bill contents/print must still reproduce their original immutable captures.

## 6. Unresolved business decisions — resolve before affected writes

These are explicit approval points, not implemented policies:

1. **Refund/reversal meaning and targets.** Demo treats both as negative amounts and caps only the
   selected terms ledger's combined net; it does not link originals. Recommended: refund records an
   actual return linked to a collection; reversal corrects an erroneous record with explicit linkage.
   Decide partial vs full reversal, whether a refund can be reversed (positive effect), chains, and
   whether cross-collector or cross-payment refunds are permitted. Original demo guard is weaker;
   do not silently tighten it and call that parity. Decide before correction implementation.
2. **Verification evidence and declaration.** What evidence upgrades an OTA-reported amount into a
   verified channel collection? Preserve partial/confirmed manual declarations or derive a different
   concept? Is occurrence date/payment method required, and how are backdated records handled?
   Recommendation: retain declaration separately and server-record verifier/time; no gateway claim.
3. **Lifecycle, overpayment and issued bills.** Demo allows negative guest balances. Confirm that
   behavior for API and decide collection/refund permissions on cancelled/no-show/checked-out
   bookings and after finalization. Recommendation: do not require a final bill for a collection;
   keep money records independent, with explicit cancellation/refund review rather than auto-refund.
4. **Duplicate evidence.** Decide reference uniqueness scope or warning/review policy. Idempotency
   prevents one request from duplicating; it cannot identify two different keys for the same payment.
5. **Guest amount versus hotel contract.** A B6 OTA reported guest amount may differ from contractual
   accommodation. Demo subtracts verified collection from operational payable. Confirm how a
   verified channel amount containing channel-funded differences should affect that balance;
   never silently cap it, create hotel cash, or turn the difference into another discount. If allocation
   to guest-liability coverage is required, design it explicitly before enabling that ambiguous case.
6. **Grouping historical captures.** B6 can append several captures for the same source. Recommend
   exact capture attribution plus source rollups, counting each transaction once. Decide whether
   refund caps follow original transaction, capture group or source ledger; old demo uses preserved
   terms arrays and does not settle this finer boundary.

Receipt numbering, statutory receipts, deposit revenue treatment, payment rails, posting accounts
and production authorization are separate future policy/work, not prerequisites for this operational
design. No tax/accounting policy is inferred here.

## 7. Staged implementation and acceptance gates

### Stage A — resolve contracts, focused tests, additive storage

Resolve Decisions 1–6 only as needed for each enabled case; unresolved cases remain explicitly
gated and are not claimed as complete B7. Implement pure summary/correction validators, immutable
owned storage and initial migration tests. Reuse exact PHP integer transport, not floating inputs.

Acceptance: reported-paid/expected/unknown creates zero B7 records; hotel vs channel totals differ;
signed credit is retained; malformed/zero/negative/unsafe/client-priced inputs reject; owned FKs,
immutability and historical context work. Test approved refund/reversal truth table explicitly.

### Stage B — saved-reservation command and concurrency

Implement GET/POST, parent-version serialization and exact audit/replay. Include direct without
commercial capture and non-direct current/historical contexts. No pricing changes.

Acceptance: partial/full collection, mixed collectors, approved overpayment/refund/reversal cases;
source switch retains old attribution; same-key concurrent replay produces one record/audit;
different-body/target conflict; two stale writers accept one; competing refunds cannot overspend
approved capacity; collection versus source correction/finalization serializes correctly. Inject
failures after transaction/version/audit/receipt and before commit, then retry same key successfully.
Existing finalized bill bytes/hash/number and all pricing revisions remain unchanged.

### Stage C — original detail and atomic initial-entry controls

Wire original forms, declaration/history selection, authoritative summary and print separation.
Extend singular/plural create only once, preserving omitted-field hashes. Do not add an automatic
second mutation. Provide the reviewed direct-booking entry point if approved.

Acceptance: original Dashboard and calendar create stage collection and persist at version 1;
mixed initial financials and collection commit or roll back together; detail collection/refund/
reversal and preserved-ledger actions retain drafts on failure. Lost committed responses survive
refresh/original-key retry without duplicates. Demo has zero API calls and unchanged controls.
Verify direct and non-direct separately, including the approved guest-v-contract difference case.

### Stage D — targeted integration, then shared regression/recovery gate

Run focused PostgreSQL and frontend tests during each stage, then actual original-control browser,
raw SQL and owned API-restart checks. Use random synthetic company ownership; retain failed evidence.
Run PostgreSQL and browser harnesses separately. Broaden regression for changed create/read/hash/
document contracts after the slice works. Verify migration from empty and dump/restore in a new
isolated disposable target; never reset/reseed `hms_dev` or `hms_test`. Preserve original hashes.

Acceptance: canonical records and summaries survive restart; restored transaction/correction links,
audit, receipts and historical financial captures match; every named original entry point verified
or explicitly listed incomplete. A passing API-only case is not original-UI verification.

## 8. B8 boundary and future reuse

B7 records guest-to-collector facts and corrections. It does **not** confirm commission liability,
documented expected settlement or payout entitlement; execute OTA settlement; allocate a batch
across reservations; reconcile bank/channel statements; or post an accounting journal.

B8 should consume stable reservation/source/capture/transaction UUIDs and collector-separated
totals. It will own payout/refund/reversal/offset/commission transaction meaning, allocation sums,
company/channel/currency validation and append-only reconciliation history with explanations.
Settlement must not mark guest payment again or rewrite B7 originals. Reservation corrections must
not detach old settlement or collection attribution. Commission estimates, confirmed obligations,
guest collection and actual hotel receipt remain separate read-model fields.

B7 reconciliation requirements are traceable evidence references, original/correction links,
collector/source subtotals, duplicate policy, and reproducible totals at a reviewed version. No B8
matched-bank or reconciled-settlement status is fabricated. Future accounting can link operational
transaction UUIDs through explicit allocations/posting references; B7 does not create a generic
invoice allocation table or equate an operational bill with a statutory invoice.

## Planning-session result

Only this new design document was written. No application implementation, migration execution,
database access/mutation, test suite, dependency installation, commit or push was performed.
Existing B6 dirty files were inspected and preserved. Tests listed above are proposed acceptance
tests, not results. First next action is review of Decisions 1–6, then separately authorized Stage A.
