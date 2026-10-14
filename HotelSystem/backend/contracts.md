# HMS API contracts — persistent single-room operations

Approved scope: one company, PHP, **single-room direct bookings**, versioned essential references,
server-owned prices. Guest creation is independent, matching the current pane's provider flow.
No transaction-integrity requirement found that warrants silently changing guest ownership.

Frontend demo stays independent. The explicit API-backed branch is documented in the
[integration checkpoint](../docs/planning/frontend-api-integration-2026-10-13.md);
unsupported multi-room/custom stay, OTA/settlement, final-price overrides, accounting and
Odoo actions must be disabled/read-only and rejected by API input validation. Never silently
fall back to demo data or locally fake-save a persistent command.

| Endpoint | Contract | Today |
|---|---|---|
| GET `/api/v1/live` | Process liveness, no DB dependency | Implemented/tested |
| GET `/api/v1/health` | DB SELECT check, 200 healthy / 503 unavailable; no credentials exposed | Implemented/tested |
| GET `/api/v1/guests` | Company-scoped guest read/search | Implemented/tested |
| POST `/api/v1/guests` | Independent trimmed-name creation; required UUID key; audited | Implemented/tested |
| GET `/api/v1/reference-data` | Company, sources, rooms/types, duration/rates/settings; active flags | Implemented/tested |
| POST `/api/v1/reservations` | One direct booking aggregate; required UUID `Idempotency-Key` | Implemented/tested |
| GET `/api/v1/reservations` | Company-scoped bounded list | Implemented/tested |
| GET `/api/v1/reservations/{id}` | Stable UUID lookup; captured pricing/version/audit | Implemented/tested |
| PATCH `/api/v1/reservations/{id}` | Notes/adult-child counts; expected version and UUID operation key | Implemented/tested |

Original note/count PATCH remains unchanged. Create and billing/stay commands accept additive optional manual discounts; omitted discount fields retain their original receipt hashes. New commands use
separate allowlisted DTOs and operation namespaces:

| Command | Supported input / behavior |
|---|---|
| POST reservation `/{id}/edit-details` | Required guest UUID and expected version; optional note/counts; captured prices unchanged |
| POST reservation `/{id}/edit-stay` | Guest, room, duration UUIDs, aware scheduled start, expected version; optional note/counts/adjustments |
| POST reservation `/{id}/edit-discounts` | Guest UUID, expected version, complete manual discount array; optional note/counts/charges/adjustments in the same transaction |
| POST reservation `/{id}/edit-billing` | Guest UUID, expected version, complete adjustments array; optional note/counts |
| POST reservation `/{id}/edit-charges` | Guest UUID, expected version, complete purchase/extra-charge array; optional note/counts/adjustments |
| POST reservation `/{id}/edit-stay-charges` | Single atomic combination of stay and charge changes |
| POST reservation `/{id}/check-in`, `/check-out`, `/no-show`, `/record-departure` | Expected version; explicit guarded lifecycle transition |
| POST reservation `/{id}/cancel` | Expected version plus strict `guest_has_vacated` boolean |
| POST room `/{id}/readiness` | Expected room version; `clean` or `cleaning`; occupied rooms reject |
| POST/PATCH configuration `/room-types`, `/rooms`, `/durations`, `/rates`, `/categories`, `/products` | Typed definitions; PATCH appends `/{id}` and requires captured expected version |

All paths above are prefixed `/api/v1` (`reservation` means `/reservations`, `room` means `/rooms`,
`configuration` means `/configuration`). Every mutation requires a UUID `Idempotency-Key`.
Version conflicts and changed-key payloads return 409 with no partial write. Receipts are durable
and return the original committed result on replay; subsequent GET may have a newer version.

Stay edits require confirmed/reserved, unoccupied allocations; old/new rooms lock in UUID order.
The same allocation identity is retained. Arrival-only changes preserve captured charges and
original booked duration/checkout policy. Room or duration changes capture current accommodation
rates in a new pricing revision; old captures and purchases/adjustments remain intact.
PostgreSQL exclusion protection remains the final authority against overlapping scheduled stays.

An adjustment is `{id: UUID, amount_minor: strict signed nonzero integer, reason: nonblank string}`.
A charge intent is `{id: UUID, product_id: UUID, quantity: strict positive integer, usage: "purchase"|"extra_charge"}`.
Clients cannot submit purchase labels, prices, currency or tax. New purchases resolve owned active
sellable ordinary products. Existing lines keep their captured label/unit price when quantity changes.
Omitted optional financial arrays preserve their current values; supplied empty arrays remove all
current entries, with prior revisions/audit retained. Duplicate identities reject. Removed purchase
identities cannot be reused; a new purchase uses a new UUID.

Captured schema 1 remains accommodation-only; schema 2 adds adjustments; schema 3 adds purchases; schema 4 adds manual discount captures.
Server total is `max(0, accommodation + purchases + extra charges - discounts + signed adjustments)` using exact PHP minor units.
Each accepted bill/stay command advances reservation version once and appends at most one pricing
revision. Ordinary note/count/guest edits preserve pricing revisions. Bill edits are supported for
confirmed/reserved/checked-in reservations, matching existing UI editing access; final lifecycle
statuses reject new bill commands. This restriction does not create accounting posting/finalization.
Discarded unsaved drafts create no saved audit event. Taxes remain explicitly unconfigured/zero.

Catalog categories support ordinary/amenities and the protected extra category; amenities are
zero-priced and not sellable. Extra products share product storage and are not ordinary sellable
products. No stock movement, product deletion or breakfast entitlement is implied.
Configuration preserves physical occupancy/readiness metadata; readiness uses its separate command.
Assigned room numbers cannot be renamed; active assigned rooms cannot be disabled/retyped.
Current caps in `/reference-data` gate corresponding React controls; no demo-data fallback.

Implemented create request fields: `guest_id`, `booking_source_id`, `room_id`, `duration_id`,
offset-aware `scheduled_start`, required positive integer `adults`, nonnegative integer
`children` (default 0), `note` (default empty). Counts reject booleans/floats/numeric strings;
they are recorded without inventing a capacity ceiling. IDs are database UUIDs; identifiers such
as `direct` remain explicit reference metadata. Company is selected from server-owned context,
not an arbitrary browser override. Package/nights/check-out and final price come from the server.
Hotel checkout is computed server-side: hourly start plus configured minutes; overnight hotel-local
start date plus configured nights at the hotel's checkout wall-clock time. The explicit start is
not silently snapped to the configured check-in time. ISO input must include `Z` or `+/-HH:MM`,
with at most six fractional digits. Epoch numbers/strings and naive timestamps are rejected.

Do not accept authoritative `price`, `audit`, `actual_check_in`, `status`, `current_occupancy`,
commission or accounting fields from a client. Request model should forbid unsupported fields.
Return a canonical read DTO containing stable UUID, human code derived from database-assigned
`business_number`, version, saved guest/source/room context, scheduled/actual instants, currency,
captured pricing revision and audit. Frontend's numeric Stay IDs/human reservation routes need
an explicit adapter; no UUID-to-number casting or client max-plus-one numbering.

Implemented mutation boundary: `Session.begin()` encloses reservation, allocation, pricing revision,
operational audit and mutation receipt. Commit once after every validation; failure rolls
everything back. A receipt is committed with the resource, never beforehand. Same key/body
replays the canonical result; same key/different request hash is conflict. The initial unique
receipt key is backed by a transaction-scoped PostgreSQL advisory lock on company/operation/key.
Canonical hashing normalizes UTC timestamps/default fields; retries after API restart return the
stored original response. Changed bodies conflict. Receipts are never written ahead of the booking.

Lock relevant room rows before occupancy/availability decisions. Scheduled overlap exclusion
uses `[start,end)`; touching endpoints are allowed. Current physical occupancy is a separate
room reference; overdue/locked occupancy must reject new bookings regardless of scheduled end.
Existing future reservations must not be erased by future check-in commands. The PATCH service
rejects stale versions without writing any part of the edit.
All ownership/rate/currency checks must run server-side before exposing writes.

Implemented error responses: 422 unsupported/invalid input; 404 missing resource; 409 allocation
version or idempotency conflict; 503 unavailable dependency. Business endpoints use
`{code,message,field_errors,request_id}` with safe messages. Never expose SQL/connection strings.
SQLAlchemy dependency errors return safe 503; unanticipated integrity errors return safe 500.
Server time supplies accepted audit and actual check-in/out timestamps.
JSON transport uses aware ISO values,
PostgreSQL UTC instants, hotel display Asia/Manila and date-only service dates where applicable.
PHP minor units are strict integers up to JavaScript's exact integer limit (`2**53-1`). Hourly
packages charge once; nightly rates multiply configured nights. Captured snapshots preserve rate
IDs/source IDs, room/type labels, quantities, unit amounts, totals, currency, calculation/schema
versions and explicit `tax_status=not_configured`. Decimal boundary conversion uses half away from
zero. Manual reductions use Decimal and integer PHP minor units; binary-float server pricing and VAT posting are not implemented. Pricing revisions
are append-only through current services; this is not a database-enforced accounting ledger.

Frontend commands must await commit before closing/resetting the pane, keep drafts on failure
and refresh canonical room/calendar/detail state together. Persistent bootstrap errors must not
be interpreted as “no reservations” or show available rooms from stale demo data. Existing raw
React setters are not a persistence API. Future CORS must allow the exact mutation methods and
headers only when implemented (currently GET/POST/PATCH and `Content-Type`/`Idempotency-Key`).

The first create/read write gate is verified with PostgreSQL concurrency, stage-by-stage rollback,
forged-input, historical-price, durable replay and real HTTP restart tests. Version initializes at
1; `ReservationEdit` requires an expected version and explicit note/count edits. PATCH locks the
reservation exclusively, rejects stale versions with 409 `version_conflict`, updates only supplied
note/count fields and increments once. Missing edit fields are preserved, blank note clears,
explicit null rejects. Equal-value requests still advance once as accepted commands. A replay
advances nothing and returns the original committed response; GET returns current state.
The hash includes the target reservation UUID, preventing same-key reuse across reservations.
Audit before/after stores version, note and both counts; actor and mutation-time timestamps are
server-owned. Updates to counts do not change room/time/occupancy identity or any pricing revision.
Captured pricing's reservation version remains the version at capture, not the new edit version.
Reads, updates, audit and receipt commit atomically; failures including before commit roll back.
No migration is needed for this bounded PATCH. Read lists default to
100 rows, accept limit 1–100/offset >=0 and sort deterministically; no pagination total is claimed.
Guest search is a literal, case-sensitive substring, including escaped wildcard characters.
Company selection (`HMS_COMPANY_ID`) and actor `local-development` are server-controlled local
context, not authenticated identity. Business routes are restricted to development settings.
No collections/refunds,
native invoices/journals, financial posting or Odoo adapter is authorized in this checkpoint.


### Explicit room operational status (October 13 correction)

Room reference/read DTOs now return `operational_status`: `operational`, `housekeeping`,
`maintenance`, or legacy `unavailable`. Configuration room create/edit accepts this optional
field. When supplied, it derives the booking-eligibility boolean; an explicitly contradictory
`operational` boolean or null/unknown status rejects with 422. SQL checks enforce the same
status/boolean invariant. Readiness (`housekeeping`) remains independent.

Omitted status retains the previous explicit status when the supplied boolean is unchanged;
otherwise the boolean maps to Operational/legacy Unavailable. Legacy command hashes exclude
this new field when omitted, preserving durable replay; old response receipts derive the
missing status without rewriting their stored JSON. Existing false rooms migrate to legacy
Unavailable because their original reason was not captured. No original column is updated.

`room.status.v1` enables the original Rooms inline selector. Both original room creation
entry points default to Operational; the dedicated form adds no status input. Definition writes
retain expected version, company ownership, idempotency, audit and transactional boundaries.
The existing active-assignment restriction continues to reject making an assigned room unavailable.


### Manual discounts (October 14)

`POST /api/v1/reservations/{id}/edit-discounts` requires a UUID request key, company ownership,
positive strict `expected_version`, guest UUID and `discounts` array (maximum 100).
Each intent is `{id: UUID, label: nonblank string, scope: reservation|room|item,
method: fixed|percentage, value: positive decimal string, target_id: string, currency: PHP}`.
Fixed values are PHP amounts, percentages are at most 100. Values are plain decimal strings,
not floats, exponent notation or client-computed monetary reductions. Room targets use the
assigned canonical room UUID; item targets use an existing captured purchase-line UUID;
reservation targets are empty. Null arrays, duplicate IDs, invalid targets, unsupported provenance
inputs and forged computed fields reject. Caps are the existing eligible remaining balance;
no new configurable/manual eligibility policy is invented.

The centralized server pipeline starts from captured amounts, applies room/item reductions
in stable insertion order, then reservation reductions in stable insertion order (pipeline 2).
Fixed reductions round PHP inputs half away from zero; percentages round per application
against the remaining eligible balance. Allocation consumes accommodation then purchase
lines in their original order. Manual room scope includes its purchases. Adjustments remain
separate and the final amount is clamped at zero once. Captured unit/base prices never become
net prices.

Schema 4 captures input list order, actual application order, decimal value, scope/target,
manual provenance, server first-application time, reduction and per-line minor-unit allocations.
It stores `discount_total_minor`, `pipeline_version=2` and calculation version
`direct-manual-discounts-v1`. Reads validate the captures against the same calculator.
Historical schemas and rows remain unchanged. No SQL migration is required.

Create accepts optional discounts. Existing billing/charge/stay commands also accept optional
discounts; omission preserves current selections, explicit empty arrays remove them. Purchase
quantity and explicit stay repricing recalculate current reductions from the appropriate captured
bases while retaining old revisions. Removing a targeted purchase without addressing its discount
rejects; the original UI removes that targeted discount together with the line. Ordinary detail
PATCH does not create a pricing revision. All mixed edits commit once with one version increment,
pricing revision, server-owned audit and receipt. Terminal lifecycle states reject new bill edits.

`reservation.manual-discounts.v1` enables the original manual controls. Explicit 409 review retains
the draft and merges only locally changed discount entries, preserving remote additions and locally
untouched entries. A reviewed local change/removal to the same entry intentionally supersedes that
entry. Replays return the original committed operation result; GET supplies the current version.
Presets, statutory eligibility, inclusions/breakfast, tax/accounting and detailed history transport
remain outside this milestone.

### Special extra charges (October 14)

Each company has one protected category with `source_id=special-extras`, `type=extra` and
`system_defined=true`. Additive migrations initialize existing companies and an INSERT trigger
initializes new companies transactionally. This installs category metadata only, not demo products.
Its label can be renamed through the original Inventory control; identity, classification and
enabled state remain protected. Archive/delete/reclassification are unavailable. User-created
categories cannot claim this identity. Ordinary categories with the same label coexist under
distinct UUIDs; the frontend disambiguates their labels without renaming stored definitions.

Extra definitions use the existing owned, versioned product table and configuration endpoints.
New `extra_charge` intents must resolve active products in the protected extra category;
ordinary `purchase` intents must resolve sellable ordinary products. Forged classification rejects.
Existing charge identity/product/classification cannot change. Quantity edits retain captured
unit price/label; definition edits never rewrite saved captures or historical pricing revisions.

Create accepts optional `charges` containing extra-charge intents only. Omission retains the
historical create request hash. Existing billing/charge/stay commands accept mixed purchase/extra
intents atomically with supported discounts and adjustments. Captures retain `usage=extra_charge`
in existing pricing schemas 3/4; no separate product table or new pricing schema is introduced.
Room/item/reservation manual discounts use the established eligible-line pipeline, including
extra charges. Version checks, durable key replay, audit, receipt and rollback boundaries remain
unchanged. `reservation.extra-charges.v1` enables original reservation controls, including create.
Inclusions and breakfast are separate nonfinancial workflows described below.

### Room-type inclusions (October 14, focused checkpoint)

Inclusions are nonfinancial entitlements, not purchase/extra-charge lines. Shared catalog products
belong to the protected `special-inclusions` category (`type=inclusion`, system-defined, enabled);
its label can be renamed, while identity/type/archive/delete remain protected. Ordinary categories
with matching names coexist under distinct IDs. Inclusion products are not ordinary sellable items.
Product price metadata never contributes to a reservation bill through inclusion selection.

Room-type create/edit accepts optional `default_inclusions: [{product_id: UUID, quantity: positive
strict integer}]`, max 100, unique product IDs. Omission preserves defaults and historical request
hashes; an explicit empty list clears. A relational `room_type_inclusions` table enforces composite
company-owned type/product references and positive quantities. New defaults require active inclusion
products; retained disabled defaults can remain configured but are skipped on new assignments.
Reclassifying a referenced product requires first removing its room-type defaults. Replacement,
type version, server audit and receipt commit together.

Create automatically captures current active defaults under the room-type lock. Optional `inclusions`
is an override/addition array, not a replacement of unseen server defaults: `{product_id: UUID,
quantity: nonnegative strict integer, overridden?: boolean}`. Default removal uses explicit zero.
The frontend sends manual selections/explicit overrides, letting the server supply automatic defaults.
Default provenance is server-derived; an explicit same-value override is supported only for defaults.
Client labels, prices and forged source fields reject. Omitted new inputs retain historical hashes.

Allocation reads include captured inclusion IDs, labels, quantities, default/manual source and override
flags. Existing allocations start empty after migration; no historical entitlement is invented.
Config changes do not mutate saved captures. On a room-type switch, manual entries survive, obsolete
defaults drop, active new defaults apply, and positive overrides carry only across shared defaults.
A zero default override resets when that default is reapplied on a type switch, matching demo semantics.
Same-type room transfers and arrival/duration-only edits preserve existing inclusion selections.

`POST /reservations/{id}/edit-inclusions` uses guest UUID, expected version, UUID key and a complete
inclusion selection, with optional supported note/count/charge/discount/adjustment changes. Inclusion-only
edits increment reservation version once but do not append/rewrite pricing revisions. Mixed financial
edits use the existing billing calculator/transaction. Stay commands also accept optional selections
in their existing atomic boundary. Lifecycle restrictions, company ownership, replay, audit and rollback
remain enforced. Explicit conflict review retains locally untouched remote selections/additions.
`reservation.inclusions.v1` gates original controls. The Session 2 full regression gate passed;
the focused checkpoints still identify additional boundary coverage not separately browser-tested.

### Nightly breakfast (October 14)

The protected `special-breakfast` category (`type=breakfast`, system-defined/enabled) is a virtual
eligibility view over shared catalog products. Its UUID/source identity remain stable through rename;
archive/delete/reclassification are unavailable. It does not own duplicate meal products. New product
writes cannot target this virtual category. Ordinary matching category names remain separate.

`POST /configuration/breakfast` accepts `{expected_version, items: [{product_id, kind: meal|beverage,
enabled: boolean}]}` plus UUID `Idempotency-Key`. The whole list is versioned through the company's
`breakfast_version`. Omission of a product removes eligibility; disabled entries remain representable.
New entries use ordinary products; retained eligibility is independent of later category changes,
selling price and `available_for_sale`. New enabled eligibility requires active product/category;
retained inactive history can remain configured. Company/product ownership is enforced by composite
FK, with strict kind/flag validation, audit and transactional list/version/receipt replacement.
References return eligibility and company version together in the existing consistent read snapshot.

Create and stay commands accept optional `breakfast` selections; a separate versioned/idempotent
`POST /reservations/{id}/edit-breakfast` supports selections with existing supported mixed edits.
Each intent is `{service_date: YYYY-MM-DD, guest_number: positive strict integer,
status: included|skipped, meal_id?: UUID, beverage_id?: UUID}`. At most 500 selections, unique per
date/guest. Included requires both IDs; skipped forbids a recipe. Unrecorded is absence of a row;
an explicit empty selection clears. Client prices, labels, quantity and calculated fields reject.

Only captured nightly stays have breakfast dates: hotel-local dates strictly after the arrival date
whose midnight is before scheduled checkout. Checkout-day breakfast is available when checkout is
after midnight; an exact midnight checkout excludes that day. Each assigned adult/child ordinal
has one optional slot per date. The server validates active meal/beverage eligibility for new choices.
An unchanged captured recipe remains readable/saveable when eligibility is retired, with its original
labels. Changed recipes resolve current eligible products. Captures own quantity 1 and exact zero
unit/line amount. Product selling prices never turn complimentary selections into bill lines.
Separate ordinary `purchase` intents retain existing sellability/captured-price/discount rules.

Selections live in allocation JSON, outside pricing snapshots. Pure breakfast edits advance reservation
version once, audit before/after and save a receipt, leaving every pricing revision unchanged. Supported
mixed financial edits use the existing billing transaction. Guest-count reductions and stay changes prune
only out-of-scope saved selections, matching demo behavior; new invalid slots reject. Check-in/lifecycle
and hotel timestamps/pricing policies are unchanged. Original note/count PATCH still rejects breakfast
input, but reconciles saved selections when counts change. Historical omitted-input receipt hashes remain
compatible. Existing allocations receive empty arrays; no historical breakfast is inferred.

The frontend preserves failed drafts and supports explicit conflict review. Untouched remote choices
survive reviewed retry. A local edited choice excluded by reviewed guest counts/dates causes an explicit
error, rather than silently discarding it. Eligibility editors likewise support version review while
retaining local edits and remote additions. These are operational selections, not meal fulfillment,
stock movements, payment records, accounting posting or authenticated production staff attribution.

## Fixed/percentage preset configuration and selection

`POST /api/v1/configuration/discount-presets` and version-checked
`PATCH /api/v1/configuration/discount-presets/{id}` use UUID request keys and owned definition
transactions. Decimal strings, PHP, fixed/percentage methods and reservation/room/item scopes
are supported. Room targets are owned room-type UUIDs; item targets are owned chargeable products.
Case-insensitive names are unique per company, including disabled definitions. Definition versions,
audit and receipts commit together. Disable retires a definition; deletion is not exposed.
Reference data includes `discount_presets` and `reservation.discount-presets.v1` capability.

Existing discount intents optionally include `preset_id`. New selections resolve label/method/value/
scope from the server definition, not submitted financial values. Pricing schema 4 captures preset
identity/version, resolved terms, target and applicable room rate with `provenance=preset`.
Existing captured terms cannot be edited in place and survive definition changes/retirement.
Remove/replace a selection to change it. Foreign, inactive or incompatible new targets reject.
One preset may target a room/item line; the same reservation preset cannot be added twice.

Room presets reduce accommodation only; manual room reductions include associated charges.
Item fixed values reduce a line total. Existing staged rounding/caps and adjustments remain intact.
Historical omitted-preset manual request hashes are preserved. Note/count edits do not reprice;
financial edits reuse atomic reservation/pricing/audit/receipt boundaries. New nullable preset
metadata is additive to captured discount reads; old raw revisions and receipts are not rewritten.

`final_price` remains rejected and unavailable in API mode. It is a unit-price replacement before
sequential reductions, not an ordinary fixed reduction. No final-price values were migrated or
converted. See [the checkpoint](../docs/planning/presets-recovery-checkpoint-2026-10-14.md).
