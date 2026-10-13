# HMS API contracts — persistent single-room operations

Approved scope: one company, PHP, **single-room direct bookings**, versioned essential references,
server-owned prices. Guest creation is independent, matching the current pane's provider flow.
No transaction-integrity requirement found that warrants silently changing guest ownership.

Frontend demo stays independent. The explicit API-backed branch is documented in the
[integration checkpoint](../docs/planning/frontend-api-integration-2026-10-13.md);
unsupported multi-room/custom stay, OTA/settlement, discounts, inclusions/breakfast, accounting and
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

The original POST/PATCH contracts and their receipt hashes remain unchanged. New commands use
separate allowlisted DTOs and operation namespaces:

| Command | Supported input / behavior |
|---|---|
| POST reservation `/{id}/edit-details` | Required guest UUID and expected version; optional note/counts; captured prices unchanged |
| POST reservation `/{id}/edit-stay` | Guest, room, duration UUIDs, aware scheduled start, expected version; optional note/counts/adjustments |
| POST reservation `/{id}/edit-billing` | Guest UUID, expected version, complete adjustments array; optional note/counts |
| POST reservation `/{id}/edit-charges` | Guest UUID, expected version, complete purchases array; optional note/counts/adjustments |
| POST reservation `/{id}/edit-stay-charges` | Single atomic combination of stay and purchase changes |
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
A purchase intent is `{id: UUID, product_id: UUID, quantity: strict positive integer, usage: "purchase"}`.
Clients cannot submit purchase labels, prices, currency or tax. New purchases resolve owned active
sellable ordinary products. Existing lines keep their captured label/unit price when quantity changes.
Omitted optional financial arrays preserve their current values; supplied empty arrays remove all
current entries, with prior revisions/audit retained. Duplicate identities reject. Removed purchase
identities cannot be reused; a new purchase uses a new UUID.

Captured schema 1 remains accommodation-only; schema 2 adds adjustments; schema 3 adds purchases.
Server total is `max(0, accommodation + purchases + signed adjustments)` using exact PHP minor units.
Each accepted bill/stay command advances reservation version once and appends at most one pricing
revision. Ordinary note/count/guest edits preserve pricing revisions. Bill edits are supported for
confirmed/reserved/checked-in reservations, matching existing UI editing access; final lifecycle
statuses reject new bill commands. This restriction does not create accounting posting/finalization.
Discarded unsaved drafts create no saved audit event. Taxes remain explicitly unconfigured/zero.

Catalog categories support ordinary/amenities; amenities are zero-priced and not sellable. No stock
movement, product deletion, breakfast entitlement or system category creation is implied.
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
zero; no binary-float pricing, discounts or VAT logic is implemented. Pricing revisions
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
