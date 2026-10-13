# Revised implementation roadmap

Date: 2026-10-13, Asia/Manila. Planning only; no implementation, commit or push authorized. Full existing operational parity is the target. This does not replace the user's approval with an automatic backlog execution.

## Scope and estimate basis

The [matrix](frontend-backend-parity-matrix.md) counts 95 capabilities, including 11 explicit placeholder/absent categories. The 84 implemented/partial frontend capabilities are the operational parity inventory. Full parity means the rich UI's actual business actions become durable, server-validated and consistent across refresh/restart, with the demo preserved. It does not mean implementing every absent feature listed in the audit prompt.

Existing create/read/PATCH is accepted reusable work, not re-estimated as if absent. The remaining packages include implementation, frontend mapping, direct tests, debugging and contract review. W9 covers broader integration/migration/handoff verification beyond package tests. Add 20% contingency once at programme level, not on every row. Facet estimates in the matrix overlap and are not summed. No production certification, automatic OTA sync, general stock ledger, new guest CRM, authentication programme or native accounting is hidden in parity hours.

| Package | Deliverable | Dependencies | Active engineer-hours | Confidence |
|---|---|---|---:|---|
| W0 | Existing route/pane/detail reuse; awaited commands; canonical adapters; capability and retry/conflict handling | Current API contracts | 16–24 | Medium |
| W1 | Durable room/type/status/rate/duration/source/settings writes and metadata preservation | W0 adapter contract; ownership decisions | 24–40 | Low–medium; currency scope unresolved |
| W2 | Multi-room allocation aggregate, guest/room/schedule editing, availability reads | W0; W1 room/reference contract; W4 pricing intent design | 24–36 | Low–medium |
| W3 | Atomic lifecycle, cancellation occupancy, departure, readiness | W0; shared W2 lock/aggregate design; W1 state contract | 24–36 | Medium for single-room, lower for multi-room |
| W4 | Server full charge snapshots, discounts, signed operational adjustments and explicit repricing | W1 references; W2 allocation identity; W5 catalog DTO design | 32–48 | Low–medium |
| W5 | Catalog/categories, default/manual inclusions, breakfast and purchases | W1/W2; W4 line contract | 20–32 | Medium |
| W6 | Verified collection/refund/reversal evidence and historical-source corrections | W4 stable money/lines; W7 terms contract | 20–32 | Low–medium |
| W7 | Source agreements, captured/superseded terms, commission/override, settlement allocations and reconciliation | W1 sources; W2/W4; W6 collection evidence | 32–48 | Low |
| W8 | Full audit, filters, guest cards, detail/print and historical read models | W0; each aggregate package | 12–20 | Medium |
| W9 | Cross-page browser/DB concurrency/failure regression, forward migration preservation and handoff | All operational packages | 16–24 | Medium |
| **Base** | **Unique package sum** | | **220–340** | |
| **With 20% contingency** | **Operational parity planning range** | | **264–408** | **Low–medium overall** |

These are preliminary source-based estimates, not measured velocity. A checkpoint after W0 and single-room W3 should replace guesses with observed implementation/test throughput. If approved currency behavior, posted correction policy or existing real records require complex migration, re-estimate rather than spend the contingency silently.

## Capacity and dates

Assume **one engineer/operator**, eight scheduled hours on weekdays, **6.4 active engineer-hours per day** after review/setup/coordination. Approximately five active hours remain today for illustration; this is not a claim that the user has booked them. October 14–30 has 13 weekdays, giving about **88 active hours through October 31** including today. Three additional full Saturday sessions would increase that to roughly 107 hours only if expressly available. Other holidays, absences and deployments are not included; shift dates later if they apply.

At this capacity, 264 hours finish around **December 9, 2026**; 408 hours around **January 8, 2027**, assuming continuous weekday work and no holiday deductions. December 9 is the earliest **conditional planning date**, not an evidence-backed promise. There is insufficient measured velocity to guarantee any date. Extra people can parallelize some packages, but contract review, shared schema and integration remain serial; do not divide total hours mechanically by agent count.

**Full operational parity by October 31 is not supported.** Minimum remaining estimate is about three times assumed active capacity. Original October 16 persistence means the narrow connected create/read/PATCH slice already exists; it must not be redefined as complete ordinary stay management or the full demo. The remaining October 19–24 ledger and October 26–31 integration windows cannot also absorb full operational parity.

## Scenario A — Preserve accounting priority and original target windows

Deliver only shared rich UI integration for the supported slice and narrowly bounded single-room direct lifecycle first; then prioritize native accounting kernel and invoice/payment posting slice. Original accounting **priority** can be preserved; original accounting **dates** are not defensible at the assumed capacity.

| Stage | Active hours before contingency | Earliest indicative sequence |
|---|---:|---|
| Shared supported UI + safe single-room lifecycle + direct regression | 32–48 | Oct 13–20/22 |
| Native accounting kernel | 40–56 | Starts Oct 21/23; late Oct–early Nov gate |
| Finalized-document/payment/accounting vertical slice | 32–48 | Follows kernel and approved billing/tax policy; November |
| Total + 20% | **125–183** | Approximately **Nov 10–23**, before holiday adjustments |

Dependencies: approved document/posting cutoff, tax/advance/payment mapping; stable charge/document identities; lifecycle lock design; accounting immutability and company ownership. Kernel dates above are estimates for new work, not existing features. Any separate authenticated deployment work is extra.

Explicitly unsupported in API mode: multi-room/custom stays, reassignment/schedule edits, complete reference editors, inclusions/breakfast/purchases, contextual discounts/manual adjustments, OTA/source changes, collection history/settlement workflows, complete detailed audit and printable rich bills. These remain visible with honest disabled explanations in their existing UI shells; demo remains usable. Generic legal invoice and payment interfaces would be new bounded accounting work, not restored demo parity.

Risks: two partially complete products, incomplete front-desk workflow, accounting rules designed before rich charge/terms contracts mature. Confidence low. Acceptance: narrow ordinary stay completes transactionally, rich UI preserves supported drafts, one approved finalized document posts once to balanced immutable entries, supported payment allocation/reversal is traced, all deferred actions explicitly identified. **Not acceptable to label this full parity.**

To literally retain Oct 19/Oct 31 accounting dates would require independently staffed, experienced parallel work after a frozen billing contract or materially less scope. That staffing is not established; no claim that the current single-worker plan fits those dates.

## Scenario B — Full operational parity first (recommended)

Deliver W0–W9, prioritizing ordinary stay operations, then existing billing/catalog/configuration, then complete channel workflows and evidence. Begin substantial ledger implementation only once operational charge/document source contracts are stable. Accounting compatibility design and policy clarification continue during the audit/reviews; no journal implementation is required to persist operational bills.

| Milestone | Indicative window under stated capacity | Acceptance |
|---|---|---|
| W0 supported rich UI first checkpoint | Oct 13–16/19 | Existing appearance/actions retained; awaited supported commands; no phantom save |
| Single-room lifecycle gate, with multi-room contract review | Following W0, late Oct | All lifecycle states/locks/readiness atomic and priced history unchanged |
| W1/W2 and full pricing/catalog | Late Oct–Nov; re-baseline after initial gates | Persistent configuration, allocation arrays, preserved history, exact rich charges |
| W6/W7 and full reads/verification | Nov–Dec/Jan | Collections/source history/settlements, full UI and cross-page consistency |
| Full operational parity | **Dec 9, 2026–Jan 8, 2027** conditional range | All 84 implemented/partial frontend capabilities resolved against approved scope |
| Accounting kernel then invoice/payment posting | Afterwards, roughly 3–4 additional active weeks | Separate balanced immutable posting and traceable supported payment/document lifecycle |

Hours: **264–408 operational**, then **86–125 accounting** (72–104 base plus roughly 20% contingency). Combined about **350–533 active hours**. Accounting moves from Oct 19 to approximately December/January; its vertical-slice completion becomes roughly January/February 2027, subject to policy and actual velocity. This is an estimate of new bounded accounting foundations, not a full accounting-product replacement or production deadline.

Deferred beyond operational parity: absent stock movement/supplier features, automatic OTA import, expanded guest CRM, generic legal invoice lifecycle/advances/journal reports until separately authorized accounting work; production auth/deployment separately scoped. Existing specialized channel workflows are **not** permanently deferred under B.

Risks: scope/financial-policy changes, migration of any real local records, sophisticated historical terms and concurrent money corrections. Confidence low–medium; dates must be reviewed after two implementation checkpoints. Acceptance: every implemented frontend command has real server persistence and tested failure semantics; all rich views use canonical prices/IDs; demo survives independently; accounting boundary remains separate. This best matches the user's stated priority of complete operational parity.

## Scenario C — Critical operations plus bounded accounting foundation

Deliver supported rich UI, safe single-room lifecycle and charge/document identity design, plus a small accounting kernel. The kernel means account/period/journal ownership and **balanced, immutable, idempotent posting of a synthetic approved document**. It does not mean full invoices, VAT policy, general payments, reports or end-to-end hotel accounting by Oct 31.

| Work | Base active hours |
|---|---:|
| Supported shared rich UI | 12–18 |
| Single-room direct lifecycle | 16–24 |
| Stable charge/document source boundary design and minimal required structure | 8–12 |
| Bounded ledger posting invariant kernel | 24–36 |
| Combined regression/handoff | 8–12 |
| Total + 20% | **82–123** |

Dates: operational checkpoint late October; bounded kernel gate **Oct 30–Nov 10** under current capacity. Oct 31 is possible only near the low estimate with frozen policy, existing environments healthy and no significant integration failure. Confidence low; do not promise it. No invoice/payment/reporting vertical slice is included.

Dependencies: W0 persistence interface, W3 locking, approved immutable source-document identity and kernel invariants. Risks: context switching, kernel consumes time while core UI is still incomplete, pressure to call balanced synthetic journals real hotel accounting. Deferred existing API workflows: W1 full configuration, W2 multi-room/schedule/reassignment, W4 discounts/adjustments, W5 inclusions/purchases/breakfast, W6/W7 channel finances, W8 full histories/print. The rest of operational parity still requires most W0–W9 hours; C is a checkpoint strategy, not a lower total cost.

Acceptance: direct stays complete safely in existing UI; synthetic accounting posting balances, rejects duplicate source, rolls back on failures and permits linked correction under the bounded contract; all unsupported operational actions remain explicitly unavailable without fake persistence. No Odoo dependency.

## Recommended execution order and first bounded task

Choose **B**. It preserves the actual existing hotel workflow and avoids building accounting on incomplete operational charge identities. A and C are explicit tradeoffs requiring user selection, not quiet removal of features to hit Oct 31.

1. W0 checkpoint: reconnect existing ReservationPane and ReservationDetailPage to the already implemented create/read/notes-count PATCH through awaited explicit commands. Keep the original structure/sections, canonical prices, draft preservation and demo behavior; visibly disable unsupported commands. **First bounded implementation task: this supported rich-pane/detail integration, approximately 12–18 active hours**, no new backend rules/schema.
2. Review allocation/charge DTO and global lock order before enabling new mutations. Then single-room W3 check-in/checkout/cancel/no-show/departure and readiness as a separate verified checkpoint.
3. W1 references and W2 multi-room/custom editing, coordinated with W4 stable pricing-line design. Additive migrations preserve current UUIDs and old receipts/snapshots.
4. W4/W5 full bills, discounts, adjustments, catalog, inclusions and breakfast. Demonstrate the documented demo pricing fixtures match server totals.
5. W6/W7 channel collections, terms, commission, superseded-source records and settlements. Treat estimates and verified money separately.
6. W8/W9 complete read/print/filter/audit parity and real concurrency/rollback/refresh evidence. Repeat only affected demo regressions.
7. Separately approve native accounting document/tax/advance/actor policies, then implement its module-owned kernel and posting vertical slice.

Every checkpoint reports changed files, actual tests, persistence/concurrency evidence, unsupported workflows and estimate changes. Any schema/business-rule extension requires its own approved scope. Stop after this audit; none of these steps has been started here.
