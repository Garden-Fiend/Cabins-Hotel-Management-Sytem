# Frontend improvements ? October 10, 2026

## Room-type default inclusions

RoomTypeConfiguration now has optional defaultInclusions containing existing catalogId references and positive integer quantities. RoomTypeInclusionsEditor is embedded in the room-type add/edit forms in Rooms and Configuration. Inclusion drafts save with the room type and are discarded when editing is cancelled. Editing other room-type properties preserves this list. Standard and Deluxe sample defaults demonstrate the feature; historical reservation fixtures are unchanged.

New reservation room assignments copy active default inclusions into their own selection. ReservationRoomSnapshot.inclusionOrigins captures minimal provenance (default/manual, with an optional overridden flag). Legacy snapshots without provenance treat existing inclusions as manual. This preserves their selections when room types change and avoids guessing old inheritance from today's configuration.

src/lib/roomTypeInclusions.ts implements the switching rules: replace inherited defaults, retain manual items, retain positive overrides for shared defaults, remove inherited overrides absent in the new type, and restore removed shared defaults at the new configured quantity. Zero quantities plus provenance represent removed defaults. Selections use a catalog-ID-keyed map, so switching never accumulates duplicate quantities. Inclusions remain complimentary and are separate from priced inventory purchases.

The existing pre-check-in room editor now has an Assigned room selector. It uses existing operational, availability and room-price checks, and retains guest counts, charges and breakfast draft data. Changing to a different room type runs the inclusion rules; moving within the same type preserves the current selections. Room-targeted discounts move to the new room identifier and remain subject to existing compatibility validation. Checked-in room transfers are deliberately unavailable: they require physical occupancy and lifecycle requirements beyond this task.

Later configuration edits do not update saved selections. Historical captured labels remain intact on saving unrelated changes. Archived inclusion selections remain visible for records using them.

## Calendar occupancy colors

All four calendar views use the mapping in src/lib/calendar.ts: vacant gray, reserved blue, occupied green, overdue red. Overdue means checked_in with current time strictly later than the Stay's current scheduled checkOut. Exactly at checkout remains occupied. Editing the scheduled checkout changes the classification on the next render; AvailabilityCalendar refreshes its clock every second while mounted.

Calendar range and position calculations, completed/inactive styling, filtering and click actions are unchanged. Readiness and operational data remain in configuration and existing room detail mechanisms; they no longer determine reservation-bar color. The calendar legend and visible checked-in labels reflect occupancy.

## Reservation navigation and presentation

Reservation rows navigate to the existing encoded reservation detail route on pointer click, Enter or Space. Interactive descendants keep their existing independent behavior. The ID remains a real link and rows retain table semantics, visible hover/focus styling and an accessible navigation description.

The detail page now presents always-visible Guest Information, Stay Details, Inclusions & Additional Charges, Billing & Payments and Audit history sections. Header actions remain visible and wrap responsively; all existing availability rules remain unchanged. Actual timestamps, operational readiness, historical/current rate comparison, breakfast, quantities, tax placeholder details, discounts, adjustments and notes are retained.

The top financial summary directly reads saved pricing.subtotal and pricing.amountOwed, as does the detailed breakdown. There is no new calculator or payment model. Amount paid explicitly says Not recorded. Outstanding balance displays the saved amount owed with that limitation explained, since the demo has no payment records.

## Readable audit history

src/lib/reservationAudit.ts is a presentation formatter; recording behavior and underlying before/after strings remain unchanged. It parses structured records, resolves known references, formats money and explicit UTC timestamps using the hotel's display conventions, and expands multi-field changes into independent activity descriptions. Event-specific formatting prevents full room snapshots from repeating separately recorded price/inclusion/charge changes.

Older human-readable sample payloads are supported. Unknown technical payloads and fields receive safe descriptions, never raw serialized data. Missing actors are identified as unrecorded rather than assigned invented identities. Entries sort by timestamp descending with original source index as a deterministic tie-breaker. Each visible entry shows actor and date/time. The formatter does not mutate source records.

## Primary changed files

- Configuration contracts/sample data: src/features/configuration/types.ts, sampleConfiguration.ts
- Inclusion controls/rules: RoomTypeInclusionsEditor.tsx, src/lib/roomTypeInclusions.ts
- Reservation contracts/editor: src/types/reservation.ts, src/components/reservations/ReservationPane.tsx
- Configuration composition: src/pages/RoomsPage.tsx, ConfigurationPage.tsx
- Calendar: src/lib/calendar.ts, src/components/AvailabilityCalendar.tsx, all four src/components/calendar views, src/pages/DashboardPage.tsx
- Reservation navigation/detail: src/pages/ReservationsPage.tsx, ReservationDetailPage.tsx
- Audit: src/lib/reservationAudit.ts, src/components/reservations/ReservationAuditHistory.tsx

Focused tests cover all five switching rules, manual additions, overrides, removals/restoration, duplicates and quantity validation, captured selections across configuration changes, occupancy colors and deadline extensions, unchanged completed styling/geometry, pointer/keyboard navigation and nested actions, saved-summary values, multi-field audit expansion, identifier resolution, ordering and source immutability.

All data remains in ReservationDemoProvider memory and resets on reload. No backend, dependencies, payments, permissions framework, or parallel state store was added. Browser-based visual verification was not performed.

Final verification: 125 tests across 23 files passed; npm run lint, npm run build, and git diff --check passed. Vite retains the existing warning for a JavaScript bundle above 500 kB.
