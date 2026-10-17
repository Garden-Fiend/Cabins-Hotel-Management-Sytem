# B7 operational collection contract

Approved authority: user-provided B7 implementation specification, D1-D6. This supersedes the
unresolved choices in the October 16 architecture plan. This is staff recording, not payment execution.

Two append-only billing tables: `billing_collection_transactions`, `guest_obligation_bases`.
Migration `b82c97d3e487` follows B6 `a71b86c2d376`; additive `c93da8e4f598` explicitly rejects
SQL NULL evidence/known amounts. Applied migration behavior was not rewritten. No payment backfill. Existing captures,
pricing, allocations and issued bills remain unchanged. Actor identity remains local development.

GET `/api/v1/reservations/{id}/collections?limit=100&offset=0` returns paginated history, full count,
full-history summary and obligation history. POST to the same path requires UUID Idempotency-Key,
`expected_version`, `source_id`, nullable `capture_id`, `kind`, `collector`, `component`, positive
integer `amount_minor`, PHP, method/reference, and partial/confirmed declaration. Hotel method is
required; cash can omit reference, electronic cannot. Channel evidence requires a reference and
exact owned commercial capture. A booking confirmation alone is insufficient evidence of payment.
Payment methods are nonblank descriptive values (e.g. cash/card/bank), not processor integrations.
No uploads or occurrence-time infrastructure is introduced. Server records actor and recording time.

Refund/reversal requires original collection UUID and nonblank reason. Original collector,
component, source/capture and currency must match. Partial refunds cap at original remaining amount;
full reversal requires no refunds. No corrections of corrections or corrections of reversed records.
All lifecycle states allow recording; a new cancelled/no-show collection additionally needs reason.

Evidence comparison trims outer whitespace and Unicode-casefolds reference and hotel method;
internal spacing is preserved, stored evidence is unchanged. Channel method is excluded from the key.
Company/collector/method/reference advisory lock serializes cross-reservation duplicate rechecks.
409 `duplicate_evidence_review` includes owned matching IDs, amounts/kinds/reservations and token.
Resubmit with token, `duplicate_acknowledged:true` and `duplicate_justification`. Token binds the
complete current matching set, target/intent and reviewed version (or stable initial-create body).
A changed amount, target, intent or matching set needs another review. Same-key committed replay is
resolved first and never needs a fresh duplicate review. No universal reference uniqueness.

POST `/api/v1/reservations/{id}/guest-obligation` requires expected reservation version, exact
`expected_pricing_id`, nullable `expected_capture_id`, `status:known|unknown`, optional accommodation
minor amount (required only when known), and nonblank review evidence. It appends an independent
reviewed accommodation basis. It does not change contractual hotel entitlement or reported guest facts.

For non-direct bookings no guest accommodation debt is invented: absent/unknown/outdated basis yields
requires_review/null residual. A reviewed basis is tied to exact pricing and commercial capture;
changes require another review, preserving previous bases. Direct accommodation uses canonical
discounted hotel pricing; direct basis reviews can only affirm that canonical amount, not override it.
Collections have explicit accommodation or hotel_charges applicability;
channel collection covers accommodation only, never hotel extras. Hotel collections can cover either.
Corrections inherit original component. Source rollups count every transaction once across histories.

Component residuals are authoritative eligible obligations minus active payment allocations. Unapplied
money is separate from outstanding charges, even when the aggregate signed guest balance is zero.
Nonzero signed billing adjustments lack an approved component mapping: allocation eligibility and
combined balance remain null/requires_review with `unallocated_signed_adjustments`. This applies even
when opposite adjustments sum to zero. No guessed adjustment distribution is performed.

## B7.1 component allocation

Append-only `payment_allocation_events` captures original payment UUID, stable target
`reservation UUID:accommodation|hotel_charges`, pricing UUID, optional reviewed obligation UUID,
positive PHP cents, allocate/release kind, release-of UUID, provenance/reason and server actor/time.
Individual products are not represented as separate receivables. Existing B7 payments are not
backfilled with fabricated allocation history, and GET performs no writes.

New collections automatically cover their declared eligible component up to its remaining obligation.
Excess remains unapplied. Hotel funds can be explicitly applied to either known eligible component;
channel funds can automatically cover reviewed accommodation only. Discounts alter obligation, never
payment capacity. `guest_balance_minor` is a signed arithmetic balance, not proof that every component
is paid; `component_outstanding`, coverage status and unapplied funds must be read separately.

POST `/api/v1/reservations/{id}/payment-allocations` requires `expected_version`,
`expected_pricing_id`, nullable `expected_obligation_id`, `kind:allocate|release`, original `payment_id`,
`component`, positive `amount_minor` and nonblank `reason`. Release also requires `release_of`.
Returns 201 summary. UUID request keys replay before fresh context/version checks. Foreign resources,
stale context, insufficient source funds, unknown/over-cap targets and channel transfer attempts reject.
One parent lock/version/audit/receipt transaction; no pricing or document edits.

Refunds/reversals append compensation releases before commit, retaining oldest valid allocations up
to remaining original capacity. Pricing/basis changes release obsolete-context allocations atomically.
Funds then await explicit allocation; reviewing a known basis may apply declared-component funds.
Manual releases do not automatically reapply. Database append-only/owned-context/release guards and
deferred source-capacity guards complement server target validation from captured pricing. Raw SQL
is not an alternative pricing/allocation API. Original transactions, allocations and bills are retained.

Saved writes lock the owned parent, compare version, validate evidence/capacity, append history,
increment reservation version once, audit and persist replay response in one transaction. They do not
lock documents, append pricing revisions or create B8 settlements. Old drafts become stale under their
unchanged full-source-version rules; finalized bill hashes/content/numbers remain fixed.

Optional initial `collections` is a legacy object or an ordered list of 1–100 collection intents
(no corrections); attribution derives from new reservation/capture. Optional `guest_obligation` saves
in the same create transaction. Intra-version ordinals preserve list order. Evidence locks are taken
in sorted order before writes; duplicate review identifies the affected `initial_ordinal` and binds
the complete ordered initial body and current match set. No follow-up payment command is issued.
Singular/plural creates remain version 1. Omitted fields preserve historical request hashes. Saved
plural edit rejects those initial-only inputs; use explicit commands. Guest creation remains the
existing independent command, not silently bundled into reservation ownership.

404 foreign/missing; 422 malformed/unsupported money/evidence; 409 version/context/duplicate/capacity;
503 bounded timeout/unavailability. No paid invoice, statutory receipt, gateway, bank feed, OTA payout,
commission confirmation, B8 settlement/reconciliation or accounting journal is introduced.
