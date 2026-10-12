# Week 1 contracts — planned, not implemented business endpoints

Approved scope: one company, PHP, **single-room direct bookings**, seeded read-only references,
server-owned prices. Guest creation is independent, matching the current pane's provider flow.
No transaction-integrity requirement found that warrants silently changing guest ownership.

Frontend demo stays unchanged today. Persistent mode is not wired or claimed. When introduced,
unsupported multi-room/custom stay, OTA/settlement, advanced discount, extras, accounting and
Odoo actions must be disabled/read-only and rejected by API input validation. Never silently
fall back to demo data or locally fake-save a persistent command.

| Endpoint | Contract | Today |
|---|---|---|
| GET `/api/v1/live` | Process liveness, no DB dependency | Implemented/tested |
| GET `/api/v1/health` | DB SELECT check, 200 healthy / 503 unavailable; no credentials exposed | Implemented/tested |
| GET `/api/v1/guests` | Company-scoped guest read/search | Planned |
| POST `/api/v1/guests` | Independent trimmed-name creation; optional contacts; UUID/server attribution | Planned |
| GET `/api/v1/reference-data` | Company, source, rooms/types, enabled duration/rates/settings | Planned |
| POST `/api/v1/reservations` | One direct booking aggregate; required UUID `Idempotency-Key` | Planned |
| GET `/api/v1/reservations` | Company-scoped list with explicit loaded/empty/error handling | Planned |
| GET `/api/v1/reservations/{id}` | Stable UUID lookup; transport DTO, pricing snapshot/version | Planned |
| PATCH `/api/v1/reservations/{id}` | Allowlisted fields, required `expected_version` and operation key | Planned |

Proposed create request fields: `guest_id`, `booking_source_id`, `room_id`, `duration_id`,
offset-aware `scheduled_start`, `note`. IDs are stable database UUIDs; source identifiers such
as `direct` remain explicit reference metadata. Company is selected from server-owned context,
not an arbitrary browser override. Package/nights/check-out and final price come from the server.
Minimum occupancy counts and configured hotel check-out settings need DTO/schema review Tuesday.

Do not accept authoritative `price`, `audit`, `actual_check_in`, `status`, `current_occupancy`,
commission or accounting fields from a client. Request model should forbid unsupported fields.
Return a canonical read DTO containing stable UUID, human code derived from database-assigned
`business_number`, version, saved guest/source/room context, scheduled/actual instants, currency,
captured pricing revision and audit. Frontend's numeric Stay IDs/human reservation routes need
an explicit adapter; no UUID-to-number casting or client max-plus-one numbering.

Mutation boundary: `Session.begin()` encloses reservation, allocation, pricing revision,
operational audit and mutation receipt. Commit once after every validation; failure rolls
everything back. A receipt is committed with the resource, never beforehand. Same key/body
replays the canonical result; same key/different request hash is conflict. The initial unique
receipt key is only a database prerequisite—request replay behavior is not implemented today.

Lock relevant room rows before occupancy/availability decisions. Scheduled overlap exclusion
uses `[start,end)`; touching endpoints are allowed. Current physical occupancy is a separate
room reference; overdue/locked occupancy must reject new bookings regardless of scheduled end.
Existing future reservations must not be erased by check-in. Stale versions reject the full edit.
All ownership/rate/currency checks must run server-side before exposing writes.

Proposed error responses: 422 unsupported/invalid input; 404 missing resource; 409 allocation,
version or idempotency conflict; 503 unavailable dependency. Business endpoints should use
`{code,message,field_errors,request_id}` with safe messages. Never expose SQL/connection strings.
Server time supplies accepted audit/actual timestamps; JSON transport uses aware ISO values,
PostgreSQL UTC instants, hotel display Asia/Manila and date-only service dates where applicable.
PHP minor units are integers; enforce supported transport precision and documented rounding.

Frontend commands must await commit before closing/resetting the pane, keep drafts on failure
and refresh canonical room/calendar/detail state together. Persistent bootstrap errors must not
be interpreted as “no reservations” or show available rooms from stale demo data. Existing raw
React setters are not a persistence API. Future CORS must allow the exact mutation methods and
headers only when those commands are implemented (today only health GET access is allowed).

Before first write: finalize company-scoped FK/active-rate uniqueness, captured pricing schema,
DTO/version/idempotency semantics and authoritative pricing. Today's DB rollback/overlap tests
verify foundation constraints, not a completed reservation service. No collections/refunds,
native invoices/journals, financial posting or Odoo adapter is authorized in this checkpoint.
