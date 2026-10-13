# Backend gap analysis

Date: 2026-10-13, Asia/Manila. Investigation only; every endpoint/model below described as proposed is unimplemented. See the [95-row matrix](frontend-backend-parity-matrix.md) for source locations and maturity, and the [roadmap](revised-implementation-roadmap.md) for estimates.

## Actual baseline

The [router](../../backend/app/modules/reservations/router.py) implements guest POST/GET, reference GET and reservation POST/list/detail/PATCH; [main](../../backend/app/main.py) adds live/health. There are nine method/path combinations. Guest creation is independent. Reservation create supports one room, direct source, PHP, configured duration and server pricing. PATCH permits only note/adults/children with expected_version. It does not implement scheduled edits, lifecycle or rich billing.

[ReservationService](../../backend/app/modules/reservations/services.py) owns a transaction spanning business changes, captured price, audit and mutation receipt. Company/operation/key advisory locking serializes replay; hashes bind PATCH to its target. Room locks and the half-open GiST allocation exclusion prevent double booking. Exclusive reservation locking and an update version predicate protect PATCH. Response construction is inside the transaction, but publication follows successful commit. Preserve these properties rather than replace them with generic CRUD.

[Models](../../backend/app/modules/reservations/models.py) limit allocation to one per reservation through a unique reservation_id. Status and actual timestamps exist without lifecycle commands. Room operational state is a boolean, not the frontend's configurable statuses. Sources are constrained to direct. [Billing](../../backend/app/modules/billing/models.py) has pricing_revisions only: JSON accommodation snapshots are not invoice, payment, adjustment or accounting models. [Schemas](../../backend/app/modules/reservations/schemas.py) enforce one accommodation line; adding arbitrary JSON to the database does not make the transport or pricing service support richer bills.

Three migrations end at 82f79142cdbd in source. Historical checkpoints record both isolated databases upgraded and 134 PostgreSQL/unit/API tests passing. No live migration, seed or row inventory was executed in this audit, so current live contents/head are not asserted from those historical observations. The test fixture in [conftest](../../backend/tests/conftest.py) seeds when --postgres is enabled; this audit deliberately did not enable it.

## Shared command contract for proposed packages

Every new mutation requires an operation-scoped UUID key, canonical normalized request hash including resource ID, server-selected company, validated owned references, expected aggregate/reference version, server-owned actor/time, audit and receipt in the same transaction. Replay must precede stale-version checking and return the original result without a second mutation. Current reservation hashes/receipts must remain replayable after DTO expansion; do not silently reinterpret old snapshots.

Define one documented lock order across new commands before registering writes: request-key lock, aggregate locks in UUID order, affected rooms in UUID order, dependent allocations/financial records in stable order. Existing create and PATCH have different lock sets; prove that expanded operations cannot introduce an inversion with them. Exclusion remains final authority. Retryable lock timeouts must stay explicit, not convert into fake success. GET/list/read adapters must accept old snapshot schema versions alongside new ones.

Expected versions increment once per accepted command; each financial snapshot records its capture version, not the newest reservation version. Reject out-of-scope fields, explicit null where invalid, booleans as counts, stale references and foreign-company identities. No action may delete historical rows, overwrite original rates or silently repair duplicate identities. Audit visibility is enforced server-side when authenticated roles are introduced, not merely hidden in React.

## W0 — Existing React surfaces and command boundary

No schema change is needed to reconnect supported note/count/create actions to the existing rich interface. Replace synchronous whole-snapshot callbacks with explicit awaited commands and a presentation adapter. Preserve current DTO UUIDs, raw instants, versions, captured prices and request identity. The API branch currently has separate simplified pages/forms; using it as permanent parity would leave most business UI behind.

Contract additions only when required: a versioned capabilities read can describe supported actions; a company-scoped mutation-recovery lookup may later resolve uncertain requests without resubmitting. Neither is necessary to start the bounded UI reuse task. Do not expose raw arbitrary receipt payloads or promise exactly-once human intent merely because keys deduplicate requests.

Tests: existing demo remains independent; supported rich-pane POST/PATCH waits for commit; error retains draft; stale rebase preserves dirty fields; old replay cannot downgrade cache; navigating/reloading an uncertain save cannot accidentally create a new key and duplicate a booking. No backend business rule needs changing for the first UI task.

## W1 — Durable reference configuration and room state

Proposed endpoints: GET/POST/PATCH room-types, rooms, room-statuses, durations, rates, booking-sources; PATCH hotel-settings; explicit archive/restore or enabled-state commands. Existing reference-data GET remains a compatible bootstrap contract. Do not permit unrestricted delete of records referenced historically.

DTOs reproduce existing room optional clearing, display-name behavior, descriptions/operational notes, capacity override, type capacity/amenities, room amenity additions/removals, archive and enabled flags, configurable room status with blocksReservation. Add reference versions and configuration audit provenance. Supplied blank text clears; blank optional capacity maps to explicit null at the API, omission preserves. Identifier/name changes must retain UUID assignment identity; frontend number-based joins must be adapted before enabling rename.

Additive schema: owned status definitions and room FK; missing type/room metadata; reference versions; any currency configuration support approved for existing settings. Backfill current operational boolean into explicit status records without altering room availability. Review existing data before enforcing new constraints. Rate uniqueness and company FKs already exist; reuse them. Active rate changes affect only new/reviewed prices. Referenced disabled/archive records remain readable.

The demo currency setting is broader than PHP-only backend. Full parity must resolve this explicitly: support configured currencies for new captures with defined minor units, preserving old currency snapshots and rejecting mixed-currency aggregates, or obtain a documented scope decision. Currency conversion, FX and multi-company operations are not existing UI features and are not implied. Estimates carry low confidence until this policy is settled.

Transactions lock edited references and affected rooms/assignments; conflicts with booking creation must use a consistent lock order. Readiness start-cleaning/mark-clean must check physical occupancy and preserve assignments/locks. Audit before/after metadata and state. Test optional clears, archived preservation, occupied-room guard, active-rate races, assigned-room rename, disabled historical visibility and full refresh consistency. Sources: ConfigurationPage.save/persist, RoomsPage.saveRoom/readiness handlers, roomConfiguration.ts and configuration types.

## W2 — Full allocation aggregate and booking edits

Proposed contract: a versioned reservation create DTO with allocations[] and explicit per-room start/duration/counts; a bounded allocation-edit command for adding/removing/reassigning rooms and changing schedule; a guest-reference edit; GET availability with visible interval/room filters. Keep old create DTO supported through an explicit compatible adapter or new API version. Notes/count PATCH remains bounded rather than accepting arbitrary snapshots.

Schema: remove only the one-allocation-per-reservation uniqueness after establishing replacement uniqueness for the active allocation identity; retain stable allocation UUIDs, owned room/duration references, counts and GiST exclusion per room. Decide retired allocation history representation rather than destructive replacement. Existing single-room records require no rekeying. Expand read DTO to allocations[] and preserve historical capture links. Business_number is the reservation display reference; it cannot remain the unique key for every multi-room calendar stay.

Service locks the existing reservation and union of old/new rooms deterministically, validates all owned references and all intervals, prices only approved changed charge inputs, then commits allocations, reservation version, any new pricing revision, detailed audit and receipt once. Removing/reassigning a physically occupied room requires a defined supported transition; do not silently relocate guests. Source semantics come from ReservationPane.addRoom/changeAssignedRoom/updateRoom and reservationLifecycle, not a free-form status PATCH.

Test two-room rollback where only one conflicts, opposite-direction room swaps, two simultaneous edits, guest ownership, shared endpoint touching, mixed duration/time precision, unchanged captured rates, and refresh/list/calendar per allocation. Availability GET is advisory; POST remains authoritative under lock. Server filtering/pagination must not misrepresent a partially loaded calendar as complete availability.

## W3 — Lifecycle, physical occupancy and housekeeping

Proposed POST commands: reservations/{id}/check-in, /check-out, /cancel, /no-show, /record-departure, each expected-version and keyed. Cancellation DTO requires the existing UI's explicit vacated/not-vacated choice where relevant; actual timestamps and audit actor are server-owned. Do not invent partial-room check-in when the current demo checks the whole booking atomically.

Database already has useful status/actual timestamps/current room allocation pointer. Review whether retained cancelled occupancy and multi-room actual instants require additional lifecycle history/lock fields after W2. The old scheduled exclusion alone cannot model an overdue guest indefinitely. Keep scheduled reservation, physical occupancy, operational status and readiness distinct; guard physical pointer transitions transactionally without cancelling later reservations.

Services port existing validated rules from reservationLifecycle.ts: valid status/time window and clean/operational/assigned-room checks for check-in; checkout captures actual departure and marks dirty; cancellation releases scheduled capacity but retains physical locks if guest remains; no-show only after scheduled arrival; later departure releases cancellation locks and marks dirty. These are real demo rules, not merely enum labels. Review differences between per-room schedule and aggregate window before implementation.

Commit all rooms/allocations, reservation version, room state, audit and receipt together. Preserve scheduled/captured pricing history through actual-time transitions; lifecycle is not an automatic repricing or journal event. Test dirty second room, stale status/version, overdue versus future booking, cancellation-not-vacated, later departure, no-show timing, lock inversion, concurrent booking/check-in and injected failure after each write.

## W4 — Server-owned full pricing, discounts and adjustments

Proposed quote endpoint plus explicitly reviewed price-affecting commands; operational adjustment create/retire; owned discount-definition CRUD. Requests contain catalog/definition IDs, counts, eligibility selection, ordering and reasons, never accepted authoritative client totals. Quotes carry reference/configuration versions and are estimates until the committing command revalidates them.

Add stable charge-line identity, allocation/service-date attribution and immutable captured units, quantities, labels, currency, original rate references, calculation/schema version. Add captured discount applications with order, scope, resolved definition, eligibility and allocated reductions; operational adjustment rows with signed minor amount, reason, provenance and retirement/correction history. Append pricing revisions; never overwrite previous captures. Existing room:number synthetic IDs are presentation identities, unsuitable as durable bill-line IDs after reassignment.

Port documented behavior in docs/room-pricing.md, docs/discounts.md, reservationPricing.ts and reservationDraftPricing.ts: hourly once/nightly multiplied, final-price override ordering, sequential eligible-balance caps, room/item then reservation reductions, deterministic allocation rounding, included breakfast zero, signed nonzero adjustment and final zero clamp. Build shared golden fixtures to establish parity; the frontend may show an estimate in demo, but persistent totals come exclusively from server snapshots. No second authoritative frontend pricing engine.

Lock reservation plus needed source definitions under shared command order. Note/count-only edits continue preserving pricing, subject to explicit entitlement implications under W5. Adjustment removal of unposted operational records is not a ledger reversal; official posting cutoff requires policy. Tests cover all existing discount/pricing fixtures, negative clamp, duplicate IDs, changed inactive rates/presets, reorder/caps, captured historical revision comparison and every rollback stage.

## W5 — Catalog, default inclusions, breakfast and purchases

Proposed owned catalog/category CRUD reads/writes and eligibility/default inclusion configuration endpoints; reservation inclusion, entitlement selection and item-charge edit commands, preferably as validated portions of one aggregate intent rather than a sequence of half-saved child writes.

Add catalog/category tables, room-type default inclusion links, breakfast-eligible product/kind links, reservation/allocation inclusion snapshots, entitlement identity/service date/guest index, selections and captured catalog charge lines. Quantities must be positive integers; distinguish inherited default, manual override, explicit removal and absent update. Existing room-type defaults are copied into drafts; changing configuration must not rewrite saved selections. Disabled/archived historical products remain legible while new selections reject them.

Server generates valid entitlement dates and guest slots from approved stay/count rules; count changes must preserve consumed/historical selections under an explicit decision, not erase them. There is no consumption/stock ledger in the current UI; do not add one as parity work. Included meals remain zero-price lines; additional purchases capture sold price. W4 owns bill calculation, W5 owns selections/defaults, W1 owns room/type references.

One reservation transaction stores line changes, snapshot revision if bill-affecting, audit/version/receipt. Configuration writes lock affected owned references. Test defaults/manual overrides across reassignment, quantity capture, zero-included versus paid purchase, archived items, service-date boundaries and two writers modifying the same selections. Source: InventoryPage, BreakfastEligibilityEditor, RoomTypeInclusionsEditor and ReservationPane purchase/inclusion tests.

## W6 — Operational collections and corrections

Current FIN/CA workflows are manual verified collection records, not bank execution. Proposed POST collection/collection-correction commands and GET history/balance, supporting collector hotel/channel, reference, currency and partial/confirmed status under current domain semantics. Actor/time must become server-owned. Do not infer a generic guest-account payment UI already exists.

Add payments-owned collection transaction identity, reservation/company/currency/terms-revision link and immutable verification evidence. For refunds/reversals, require explicit original/provenance mapping and amounts, retaining previous rows. Existing CollectionTransaction does not itself contain a reversal_of ID; adding that relationship is necessary for durable traceability and needs policy review. Use existing verifiedCollection/validateChannelTerms rules as baseline; prevent over-refund concurrently under transaction locks.

Collections do not imply hotel cash receipt when the collector is an OTA. Guest balance, channel receivable and hotel settlement are separate read facts. Direct generic PaymentAllocation/invoice residual/advance lifecycle is new accounting/billing work, not a silent extension of this package. Transactions include collection, aggregate version/audit/receipt and relevant balance snapshots if stored; never editable cached money as sole authority. Test concurrent refunds, identical replay, same-key mismatch, historical-source correction, wrong currency/company and rollback.

## W7 — Sources, agreements, commission and settlements

Proposed booking-source metadata CRUD, agreement draft/publish/retire/version APIs, reservation terms capture/change commands, channel financial-confirmation command, settlement create/read and reconciliation command. Preserve the distinction between estimate, confirmed liability, documented expected settlement, confirmed payout entitlement and actual recorded hotel receipt.

Add owned channel agreement versions/effective dates/status, immutable captured reservation terms revisions and superseded terms, overrides with reason/tax-basis flag, financial confirmation records, settlement header and reservation allocations, reconciliation state/version/history. Relax direct-only source CHECK through a reviewed migration. No automatic OTA import, API credential manager or provider synchronization exists; those remain new integration scope.

Port channelFinance.validateAgreement/commissionEstimate/applyChannelPricing/validateChannelTerms and channelActions.switchChannelTerms/validateSettlementReservations/reconcileChannelSettlement. Methods are percentage/fixed/manual/none; bases confirmed accommodation/reference/explicit amount, with published agreement versions and configured collection/settlement arrangements. Do not invent tiered commissions or new per-room formulas absent these types. Enforce effective applicability and immutable published monetary terms. Source switches keep previous verified collections and agreements available for historical corrections.

Settlement DTO carries actual kind/reference/date/currency and allocations; positive totals/conservation/ownership apply. Lock all referenced reservations and settlement rows in stable order, audit each affected aggregate, commit once with receipt. A settlement reference called commission_invoice is an operational reference, not an issued legal invoice. Reconciliation is local evidence/status, not a live bank connector. Tests cover all settlement kinds, multi-reservation allocation conservation, published versions, restricted financial visibility, historical source change, simultaneous allocations/corrections and complete rollback.

## W8 — Read models, audit, search and printable views

Expand canonical aggregate DTO with owned allocations, charge snapshots, terms/history and typed audit before/after under explicit schema versions. Provide server-enforced visibility before authenticated financial roles are introduced. Existing AuditRead exposes summaries only, so it cannot drive the full existing audit descriptions. Proposed bounded filters: reservation status/room/date/operational views; use cursor/snapshot-aware pagination for coherent large calendars. Avoid aggregate counts based on demo guest.stayCount/segment fixtures.

No schema is necessarily needed for ordinary search or printing; detailed audit DTO and captured guest-label policy need review. Printable reservation remains a reservation summary, not an invoice lifecycle. Test broad date/operational filters, saved inactive labels, current-versus-captured guest name policy, raw before/after, public/restricted fields, same totals in drawer/detail/print and complete page traversal without duplicate/omitted data.

## W9 — Integration verification and operational handoff

Build scenario evidence only after implementation authorization: demo regressions; real API browser save/edit/refresh/restart; PostgreSQL concurrency/forced rollback for each new command; deterministic golden pricing; all affected cross-page reads; forward migrations with preserved rows on a second isolated database. No reset or synthetic screenshots. Reuse existing harnesses but identify which commands seed/write before running them.

Authentication, least-privilege deployment, remote database settings, backup/restore, monitoring and regulatory policy remain production gates. They are not completed by local parity or this package's regression pass. ZKBioTime remains wholly isolated. Native accounting and Odoo are not part of W0–W9.

## Accounting-compatible decisions, before any posting implementation

| Boundary | Required operational design | Future posting implication |
|---|---|---|
| Reservations | Stay identity, status and allocation history, no journal writes | A stay event alone is not an invoice or earned revenue decision |
| Billing | Stable charge IDs, capture versions, signed operational corrections | Finalize a separate immutable document from approved captured charges |
| Taxes | Current not_configured/unknown flags remain honest | Capture approved base, components, inclusive/exclusive rule and rounding; no VAT inferred from flags |
| Invoice lifecycle | Currently absent; plan separate draft/finalize/void/credit rules | Controlled numbering, frozen totals and corrections retaining original |
| Payments | Collector evidence distinct from invoice allocation and bank receipt | Allocation conservation; overpayment/advance remains separately identifiable |
| Deposits/advances | No current dedicated lifecycle; preserve source evidence | Do not assume revenue; approved policy and separate liabilities/allocation |
| Corrections | Original IDs/raw evidence retained; linked correction records | Posted content immutable; explicit linked reversal/replacement |
| Accounting | Own accounts/periods/journal lines/posting references | Unique company/source-document/revision/event posting boundary and balanced atomic posting |
| Integrations | Adapter-owned external IDs and sync state | Odoo optional; no Odoo IDs or dependency in core records |

Operational commit and future posting must have explicit atomicity/retry semantics. Within this modular monolith, a posting service can coordinate a finalized billing document and journal in one database transaction when authorized; otherwise durable pending posting references plus replayable processing are needed. Do not add an event broker or journal write to ReservationService simply to avoid deciding the boundary. Current snapshots are service-preserved, not database-enforced immutable ledgers. Resolve posting cutoff, tax policy, advance treatment, invoice corrections and actor authority before financial production use.
