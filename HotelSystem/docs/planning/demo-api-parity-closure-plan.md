# Demo-to-API parity closure plan

October 15, 2026, Asia/Manila. Audit-only deliverable based on the current source and accepted
head `68f75a14d5a4`; see [the capability matrix](demo-api-parity-matrix.md) for sources, evidence,
classification and verification gaps. No implementation, tests, migrations or database operations
were performed for this audit. Preserve the entire existing dirty worktree. No commit/push.

**Full original demo parity is a gate before native accounting.** These are proposed batches,
not authorization to implement. There are **14 implementation batches**, plus one final verification
gate. Several small batches can share a work session; a large batch may require several sessions.
This count is planning granularity, not a completion percentage or a fixed schedule.

## Top five remaining gaps by operational importance

1. Multi-room reservations and room-specific stays: the current unique allocation and one-line DTOs
   cannot represent an ordinary group booking faithfully (B2/B3).
2. Booking sources, captured agreements and external booking terms: even additional direct sources
   such as Walk-in/Website lack writable canonical definitions; non-direct terms are absent (B5/B6).
3. Manually recorded guest collections/refunds/reversals and guest balances: demo operational facts
   cannot currently be saved at all (B7). This does not authorize payment-provider integration.
4. Commission/entitlement confirmations, settlement allocations and reconciliation: no persistent
   equivalent of the original manually maintained channel records (B8).
5. Detailed before/after audit history: raw values exist but are omitted by read DTOs/adapters, so
   staff cannot inspect the original level of change detail (B11).

Room retirement and initial-save financial controls are also operational gaps. B1 is recommended
first because it closes a concrete inconsistency with a small transactional surface before the
larger allocation/source changes; this sequencing does not imply it outranks multi-room demand.

## Shared implementation conditions

- Existing demo controls, defaults, clearing, popup behavior and historical choices are the spec.
  Verify each original dedicated/generic/calendar/detail entry point independently.
- Use owned canonical IDs, strict DTO allowlists, expected versions, durable original-key retry,
  server calculations, audit and atomic receipts. No in-memory fake save or API-to-demo fallback.
- Applied migrations stay frozen. Use additive reviewed migrations; never reset dev/test or silently
  reinterpret old records. Preserve old request hashes when new optional fields are omitted.
- Existing finalized document captures/numbering/immutability remain intact. New source structures
  need versioned captures/readers; do not rewrite old JSON, price history, receipts or documents.
- An implementation batch completes only with focused PostgreSQL/API and original-control browser
  verification, refresh/restart persistence, failure retention, stale conflicts and rollback. Broader
  regressions follow shared contract changes; do not repeatedly run every suite after trivial edits.
- Existing frontend limits, API list/count limits and allowed state transitions need explicit comparison
  during affected batches. Document safety limits or obtain approved exceptions rather than assuming
  every stricter server rule is parity. Do not loosen integrity simply to match an unsafe path.

## B1 — Complete financial inputs on initial reservation save (small–medium)

**Completed October 15:** [B1 implementation and verification checkpoint](b1-initial-financials-checkpoint-2026-10-15.md).
The requirements below are retained as the original batch scope. No subsequent batch was started.

Exact first task: inventory and enable **ordinary purchases and signed adjustments before the first
save** in the original ReservationPane, without introducing a second post-create mutation.

- Files: `ReservationPane.tsx`, `reservationDemoStore.ts`, API `contracts.ts`, `RichApiBridge.tsx`,
  backend reservation `schemas.py`, `services.py`, billing `charges.py`/`adjustments.py`, `mutations.py`.
- Schema: none expected; existing pricing captures store charges/adjustments. Verify rather than
  creating new tables. API: ordinary create charges already resolve via shared server code; add
  optional create adjustment intents with compatible omitted-field hashes and server validation.
- Frontend: remove only the initial purchase/adjustment gates; include fields in the original create
  command. Retain special-extra classification, discounts, preset replacements, inclusions/breakfast.
- Tests/acceptance: Dashboard and calendar create with purchases + extra + adjustment + reductions,
  precise totals and captured history; network retry/refresh, no phantom or second version, concurrent
  same-key replay, rollback after every stage, server rejection of forged prices. Demo comparison.
- Dependencies: current accepted baseline only. Stop after this slice for review.

## B2 — Multi-room aggregate and original add/remove controls (large)

Execution: [B2 checkpoint](b2-multi-room-checkpoint-2026-10-15.md) records shared-stay implementation,
actual verification and limits. The task below is retained as its original scope; B3 was not started.

- Files: reservation `models.py`, `schemas.py`, `services.py`, `pricing.py`, `stay_edit.py`, `lifecycle.py`;
  billing callers/documents; API contracts/presentation/provider/bridge; pane, Dashboard, detail/print.
- Schema: additive allocation identity/collection migration replacing per-reservation uniqueness;
  preserve each existing allocation UUID. Keep room-owned overlap exclusion and actual occupancy.
- API: additive/versioned plural allocation contract; compatibility reader for old receipts/current
  singular clients; atomic create/add/remove and all-room lifecycle, explicit room-targeted billing.
  Do not merely allow two room IDs while keeping pricing.lines max 1 or singular GET/allocation.
- Frontend: original Add/Remove room and independent counts/charges/entitlements; calendar derives
  one stay per allocation, all linked to the canonical reservation. Stable allocation-based identity.
- Tests: competing two-room creates in reversed room order (no deadlock/double booking); failure of
  second allocation rolls back all; add/remove dependent discounts/inclusions/breakfast; checked-in
  cancellation/departure locks across rooms; old captures/receipts/documents still readable/immutable.
- Dependency: B1 preferred, no channel dependency. Preserve old single-room pricing exactly.

## B3 — Custom per-room stays and supported stay-edit states (large)

Execution: [B3 checkpoint](b3-custom-stays-checkpoint-2026-10-15.md) records the implemented independent
stay model, original control verification and initial all-reserved edit boundary explicitly authorized
by the B3 session specification. Occupied stay extensions and B4 were not started.

- Files/contracts: B2 plus `hotelTime.ts`, `reservationEditInput.ts`, breakfast/inclusion reconciliation.
- Schema: per-allocation dates/duration already form the basis; add explicit inherited/custom policy
  provenance only if needed to round-trip the original radio/reset controls. No invented billing rule.
- API/frontend: preserve reservation-wide stay vs room-specific overrides, each room's counts/dates;
  inspect checked-in demo edits and implement safe matching changes with actual timestamps retained.
  Explicitly report any transition that cannot match demo safely before narrowing it.
- Tests: hourly/nightly mixtures, Manila boundaries, adjacency, custom reset, overlapping edits,
  overdue occupancy, scoped entitlements, historical pricing, races/rollback and every calendar view.
- Dependency: B2. Extending an occupied stay must not bypass other scheduled/physical occupancy.

## B4 — Room/type retirement and safe unused deletion (medium)

Completed October 15: original dedicated/generic controls, guarded retirement/delete commands,
historical-reference and lifecycle protection. See the
[B4 checkpoint](b4-room-type-retirement-checkpoint-2026-10-15.md) for executed focused/browser evidence.

- Files: RoomsPage, ConfigurationPage, definition adapter; configuration services/router; reservations
  models. Existing archived/enabled metadata means archive/restore should need no new table.
- API: reuse guarded versioned PATCH for archive/restore; add explicit unused-delete command with
  ownership/version/key/audit. Guard both room history/occupancy and type/rate/default dependencies.
- Frontend: restore dedicated Archive/Restore and demo-eligible Delete controls. Compare generic
  enable/disable separately. Referenced number changes remain prohibited where demo also prohibits.
- Tests: dedicated and generic controls, active/retained-cancel occupancy, referenced/history rejection,
  unused delete/replay/rollback, restored selectors, historical labels. No cascading business deletion.
- Dependency: baseline; account for B2 allocation collections when landed.

## B5 — Booking sources and versioned agreement configuration (medium–large)

Implemented October 16 within the configuration boundary. Inclusive end dates and editable drafts
preserve demo semantics; published rules are immutable. See the
[B5 checkpoint](b5-booking-source-agreements-checkpoint-2026-10-16.md) for executed verification.
Non-direct reservation captures/source changes remain B6, not implicit effects of these definitions.

- Files: BookingChannelsEditor, ConfigurationPage, channel types/finance; reference DTO/adapter;
  new configuration services/models/router. Schema: remove direct-only restriction additively, add
  classification/reference-required/notes/version and owned agreement versions/effective dates/rules.
- API/frontend: original source add/edit/enable/details-history/new agreement/draft rules/date/status;
  preserve stable source identities. Direct Walk-in/Website are not fabricated as OTA sources.
- Tests: overlapping agreement dates, active-rule immutability vs draft editing, exact commission units,
  source retirement, stale configuration/replay, scoped ownership and reference refresh.
- Dependencies: baseline. No API integration with Booking.com/banks is needed for demo parity.

## B6 — Captured channel terms and reviewed booking-source changes (large)

- Files: ReservationChannelTermsEditor, ChannelGuestSummary, pane, channelActions/channelFinance;
  reservation schemas/services, pricing, bridge/edit adapters and print.
- Schema/API: owned terms and historical superseded terms; agreement capture, external reference,
  responsibility/tax-basis facts, allowed accommodation override with reason, captured commission
  basis/estimate and room allocations. Versioned source-change review preserving prior terms.
- Frontend: original source selector/terms/permission gates; server resolves definitions and financial
  authority, not client-supplied computed totals. Channel accommodation overrides remain distinct
  from the newly implemented product/room final-price preset mechanism.
- Tests: all classifications, reference-required, agreement date selection, permitted override and
  reason, no terms lost on source switch, prior captured prices, print, mixed edits and rollback.
- Dependencies: B5; B2 for full original multi-room allocation semantics.

## B7 — Manual collection/refund/reversal records and guest balance (large)

- Files: ChannelFinancials, ChannelGuestSummary, ReservationChannelTermsEditor, channelActions;
  new module-owned operational collection services/models/DTOs and reservation read projections.
- Schema/API: company/reservation/source-term-owned collection transactions with kind, collector,
  exact amount/currency, reference, actor/time; retain original and historical-channel linkage.
  Server computes verified total/guest balance. Preserve demo action availability, not invented rails.
- Frontend: original Record verification and existing kind/status controls; failures retain values.
- Tests: partial/full verification, refund/reversal effects as actually defined by demo, source changes,
  historical records, invalid totals, same-key replay, competing writers, stage rollback and print.
- Dependencies: B6. No invoice payment allocation or accounting entries implied. If current demo's
  correction fields lack adequate provenance, report that policy need before extending semantics.

## B8 — Channel confirmations, batch settlement and reconciliation (large)

- Files: ChannelFinancials, channel types/actions/finance; operational channel read/write services.
- Schema/API: preserve confirmed commission, expected settlement and confirmed entitlement as
  distinct facts; batch transaction with company/channel/currency/kind/reference/date/actor/note,
  reservation allocations and reconciliation status/explanation. Do not conflate guest collection
  with hotel channel receipt. Choose one owning aggregate per command for atomic allocations.
- Frontend: original Save document confirmation, Record settlement, per-reservation allocations,
  partial payouts and Update reconciliation, including old channel terms after source switches.
- Tests: batch covers several reservations, exact allocated sum, currency/company/channel rejects,
  partial/refund/reversal/offset kinds, reconciliation audit, duplicates/concurrency and full rollback.
- Dependencies: B6/B7; classify these as operational records, not native ledger or bank integration.

## B9 — Hotel settings and explicit currency compatibility (medium–large)

- Files: ConfigurationPage hotel settings, company models, rate/capture validators, money adapters.
- Schema/API: versioned company settings command for local check-in/out. Data fields already exist;
  company settings version may need an additive field. Future reservations use new times, existing
  scheduled instants/captures remain fixed.
- Currency: original demo exposes a three-letter hotel currency setting. Implement faithful money
  precision/captured-currency behavior or obtain explicit approval to retain PHP-only as a parity
  exception. Never relabel existing PHP balances or translate them silently. A currency engine or FX
  ledger is not authorized by this plan; report a bounded design before lifting current PHP checks.
- Tests: invalid times, future nightly derivation, old snapshot/receipts untouched, settings stale/replay;
  approved currency behavior with precision and existing-rate compatibility. Dependencies: baseline.

## B10 — Configurable operational status definitions (medium)

- Files: ConfigurationPage roomStatuses; room validators/selectors; references/richConfiguration;
  configuration models/services and lifecycle/pricing availability checks.
- Schema/API: owned definitions label/enabled/blocksReservation and stable keys; map current enum
  statuses additively, retain legacy unavailable. Versioned definition writes. Decide validated FK vs
  key migration before execution; do not reclassify existing rooms by label.
- Frontend: original generic definition form and dedicated selectors; automatic Operational creation
  default remains valid. Readiness and physical occupancy remain separate.
- Close the separate generic Configuration housekeeping selector too: demo offers Clean/Dirty/Cleaning,
  while API only exposes dedicated clean/cleaning commands and rejects changed readiness in definition
  saves. Implement an explicit safe readiness intent (including manual Dirty where valid) or report
  and obtain approval for a narrower rule; preserve atomic room-field saves where the original form
  combines them. Never clear an occupancy pointer through a readiness edit.
- Tests: custom blocking/nonblocking status, rename/disable used definition, new-booking/check-in
  enforcement, occupied-room readiness rejection, manual Dirty and combined generic room edits,
  existing captures untouched, stale writes and original form defaults. No dependency B9.

## B11 — Detailed audit read parity (medium)

- Files: core audit model (existing before/after), AuditRead/services, richPresentation,
  ReservationAuditHistory/reservationAudit, print only if original audit export exists.
- Schema: none expected for preserved raw values. API: typed event-specific before/after transport,
  historical identity/label resolution; new pricing-history endpoint only if needed to reconstruct
  original visible events. No requirement to invent a new revision explorer absent in demo.
- Frontend: readable diffs rather than generic reservation.updated; preserve actor/time/event intent,
  business vs channel-financial visibility and every mutation's historical values.
- Tests: create, room/guest/count/stay, financial, breakfast/inclusion and source/settlement changes;
  renamed/deleted references, old events and no-op/replay not inventing duplicate audit.
- Dependencies: baseline for first audit slice; extend with B2/B6–8 event contracts.

## B12 — Guest business metadata (small–medium)

- Files: datasample/GuestsPage, guest DTO/model/service, API guest adapter.
- Schema: preserve optional segment and explicit prior-history count/baseline if justified by source
  semantics. Current derived reservation activity remains separately computable; no fake imported stays.
- API/frontend: round-trip meaningful existing guest metadata, display original segment/count rules;
  do not invent guest edit/delete actions where demo has none. Capture existing metadata if imported
  later only under a separately authorized data migration, not by fixture loading now.
- Tests: VIP/Loyal, no metadata, prior vs current activity counts, canonical guest creation and historical
  reservation identity preserved. Depends only on baseline; clarify count interpretation before writes.

## B13 — Unused ordinary category deletion (small)

- Files: Inventory Manage categories; configuration router/services, typed client/definition commands.
- Schema: none expected. API: owned/versioned/idempotent delete only when empty and unreferenced;
  protected extras/inclusions/breakfast cannot be deleted/reclassified. Audit survives deletion.
- Tests: original Delete action and category filter reset, populated/protected rejects, concurrent
  product creation vs deletion, replay/rollback. Preserve category Archive/Restore as separate actions.
- Dependencies: baseline; no product-delete feature is needed because demo products use retirement.

## B14 — Discount definition deletion parity (small–medium)

- Files: DiscountPresetsEditor, configuration preset DTOs/services/router, references/client.
- Schema/API: explicit versioned delete or tombstone retaining historic UUID provenance. Keep captures
  and previous receipts immutable. Disabling an item is not the same visible action as deleting it.
- Frontend: original delete intent with a clear history-preservation contract. If hard deletion is
  unsafe, report and approve a matching hidden-from-configuration tombstone behavior before changing it.
- Tests: unused and captured fixed/percentage/final-price definitions, historical labels/amounts,
  concurrent selection vs delete, no invalid FK, replay/rollback. Dependency: baseline.

## Verification gate G — close implemented-but-unverified parity paths

Run focused comparisons first: ordinary/extra archive/restore and amenities; captured inclusion/default
retirement and combined inclusion/financial/stay browser competition; preset Enable, item quantity/
removal and incompatible room-rate review; all four calendar views, inactive rooms, keyboard/scroll
and each original lifecycle entry point. Verify dedicated vs generic Configuration controls separately.
Earlier backend coverage and a passing month calendar test do not substitute for these named paths.

Then run complete PostgreSQL, frontend/lint/type/build and relevant browser/SQL/restart suites,
keeping PostgreSQL and synthetic browser harnesses separate. Rehearse fresh migration/seed and
backup/restore after new schema batches in independently isolated targets, never reset current DBs.
Preserve failed evidence and distinguish harness issues from application failures.

Full parity may be declared only when:

1. Every meaningful original demo field/relationship round-trips faithfully, including multi-room,
   guest metadata and operational channel facts; stable identities and old captures remain intact.
2. Every original actionable workflow has verified API-mode behavior through its original entry points.
3. API errors never substitute demo fixtures; stale/failed writes retain drafts and uncertain retries
   use original request identities. No client-priced authoritative financial writes.
4. Financial, allocation, audit and receipt writes are transactional, concurrency-safe and historical.
5. Demo remains independent and all relevant regression/preservation/recovery checks pass.
6. Every remaining exception is named and explicitly approved by the user. A disabled control or a
   stored field without an operation is not an approved exception.

No new correction/credit document, native accounting, statutory invoice, stock movement, authenticated
staff, external OTA synchronization or payment rails are required to reproduce the original working
demo. These may be production prerequisites later. Do not block parity on a new correction-document
milestone; preserve the accepted operational-document foundation while closing original gaps.

## October 31 feasibility

**Plausible but uncertain, not a reliable deadline commitment.** There are 16 calendar days after
October 15, but actual work sessions/usage and policy resolution are unknown. The existing core
significantly reduces work; multi-room changes touch the aggregate and every pricing/lifecycle caller,
and channel terms/collections/settlements are several new persistent models, not endpoint wiring.

Plan small batches at roughly part of a session and large batches at one or more sessions, then
re-estimate after B1 and the B2 contract/migration are verified. Reserve multiple sessions for combined
regression and recovery. Full parity before October 31 is realistic only with sustained sessions and
prompt decisions on currency, history-preserving deletion and guest metadata; there is no measured
basis for a stronger estimate. Do not advance accounting by silently excluding those original controls.

**Next action after authorization: B1 only.** Inspect the create resolver/DTO/hash boundary, add initial
adjustment support and enable initial ordinary purchase controls, then verify the single atomic save.
This audit does not authorize starting it.
