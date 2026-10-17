# Booking-source and agreement configuration (B5)

This describes the B5 configuration boundary historically. [B6](booking-financials.md) now connects booking capture and protects captured dates/classification while preserving retirement used by immutable commercial history; the later B6 contract supersedes the booking gates described below.

Configuration only. These commands do not create collections, calculate commissions, reprice
bookings, attach channel terms, or produce settlement/accounting transactions. Actor attribution
remains local development, not authenticated staff identity.

## Identity and preservation

Existing source UUIDs, ownership, `source_id` aliases and reservation FKs remain unchanged.
Sources add a version, explicit `direct/ota/corporate/agent/other` classification, external-reference
requirement and notes. Original demo retirement means Enabled/Disabled; there is no source delete
action or redundant archive flag. Names are company-unique, case-insensitively.

New bookings capture their source display label independently of live metadata. Legacy bookings
have no inferred commercial agreement; their label falls back to the source's original label,
retained on its first metadata update. This avoids rewriting old reservation rows or financial
captures during source edits. Used-source classification changes reject; rename/disable remain
available. Disabled sources do not prevent operations on existing assignments.

## Agreement rules and dates

`source_agreements` contains company/source ownership, canonical UUID, server-assigned revision,
separate optimistic edit version, inclusive hotel-calendar start/end dates, status, PHP currency,
typed commercial terms, creation time and actor. Each source's agreement concurrency token is
the sum of its agreement edit versions; append/update advances it by one. Source row locks
serialize agreement writers. Reads provide that token separately from source metadata version.

The demo deliberately permits draft rule editing and published dates/status management. B5
preserves this behavior: draft edits advance the edit version; published/retired rules and their
revision/identity/creation provenance are frozen by a database trigger. New published terms require
a new revision. A published agreement cannot return to draft. No version-delete API exists; database
guards reject history deletion/truncation. Exact before/after events retain interval/status changes.

**End dates are inclusive**, matching the original “Effective through (inclusive)” control and
`applicableAgreement` helper, rather than the specification's suggested exclusive-end default.
PostgreSQL `daterange(start,end,'[]')` exclusion prohibits overlapping active versions. Draft/retired
versions are not selectable. Open ends are unbounded; no match means explicit absence, including
future-only/expired histories. Start is inclusive too. Closing an old interval is an explicit save;
there is no automatic closure, replacement or silent activation of another revision.

Once B6 captures agreement identities, its policy must also protect effective-period edits that
would contradict captured uses. B5 does not invent such links or migrate historical reservations.

## Stored commercial configuration

- Pricing: permit accommodation override / require reason.
- Commission: none, percentage, fixed or manual; basis designation confirmed accommodation,
  reference value or explicit amount; override permission. Rates are integer basis points 0–10000;
  fixed fees are exact nonnegative integer PHP cents, bounded to JavaScript's safe monetary range.
- Collection: hotel, channel, or per-reservation choice. The last requires a future explicit choice;
  it does not invent mixed/split allocations or imply an unspecified amount.
- Settlement: deducted, separate invoice, offset or manual. These are contractual settings only.

No additional commission payer, gross/net funding policy, mixed collection or payment timing is
inferred. Those do not exist as separate choices in the original editor. Non-PHP currency rejects;
there is no conversion. Unused configured fee/rate fields are retained as in demo, not calculated.

## API

All writes require UUID `Idempotency-Key`, strict versions and allowlisted input. Same company,
operation, parent/target, key and body replay the original committed result. A different body/target
rejects with 409. Audit, definition and receipt commit together; interval edit failures roll back.

| Endpoint | Contract |
|---|---|
| `GET /api/v1/configuration/booking-sources` | Company-owned sources, including disabled |
| `GET /api/v1/configuration/booking-sources/{id}` | Source and concurrency tokens |
| `POST /api/v1/configuration/booking-sources` | Source fields → 201 |
| `PATCH /api/v1/configuration/booking-sources/{id}` | Full supported fields + `expected_version` → 200 |
| `GET /api/v1/configuration/booking-sources/{id}/agreements` | Complete revision history |
| Same GET with `?effective_on=YYYY-MM-DD` | Zero/one applicable active version, inclusive bounds |
| `POST /api/v1/configuration/booking-sources/{id}/agreements` | New server-assigned revision → 201 |
| `PATCH /api/v1/configuration/booking-sources/{id}/agreements/{agreement_id}` | Guarded draft/date/status edit → 200 |

Agreement mutations accept `expected_source_version`, `expected_agreement_version`,
`effective_from`, nullable `effective_to`, `status`, `currency` and `terms`.
Existing-version edits additionally require `expected_version`. `terms` contains the original
typed `pricing`, `commission`, `payment` and `settlement` objects. Clients cannot assign revision,
canonical ID, actor, creation time, calculated commission or monetary totals. Unknown fields reject.
Reference-data GET also returns sources and complete agreement configuration in one snapshot.

404 means missing/foreign; 409 means stale history, duplicate name, overlap or immutable/protected
rules; 422 means malformed input, invalid enums/precision/dates or unsupported currency. Database
ownership FKs, checks, uniqueness, exclusion and history triggers complement application guards.

## Original frontend and B6 boundary

Configuration → Booking Sources uses the original `BookingChannelsEditor`, including Add channel,
identity save/enable/disable, Details/history, New agreement version, draft rules, date/status editing
and effective-period presentation. Explicit latest-version review retains draft values and refreshes
only concurrency tokens; saves remain blocked while review is loading. Ambiguous source/agreement
requests retain their original UUID/body in tab session storage for explicit recovery after refresh.

The original reservation chooser now permits enabled direct sources. Non-direct sources and sources
requiring an external reference remain visibly unavailable for booking until B6 can capture their
required facts. Direct API creates enforce this same boundary. Existing-reservation source changes
remain gated; B6 must implement their financial review. Merely configuring an agreement never applies
it to a reservation. Demo mode retains its original richer independent behavior.

The additive migration is `d48e53f9a043`; no reset/reseed or retrospective agreement generation.
Downgrade refuses unreviewed history removal. Test-owner cleanup temporarily disables only the
agreement row trigger inside an exclusive-table-lock transaction for an exact random company and
re-enables it before commit. There is no application bypass or arbitrary cleanup request parameter.
