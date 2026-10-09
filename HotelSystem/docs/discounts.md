# Discount mechanics

This document describes the current discount behavior in the in-memory hotel
system. It records what the app does today; it is not a proposal for additional
discount rules.

## Discount definitions and reservation discounts

Configuration → Discounts stores reusable defaults with:

- a label;
- a method: fixed amount or percentage;
- a numeric value;
- a scope: reservation, room, or item; and
- an enabled flag.

Definitions do not automatically apply to new or existing reservations. In the
reservation form, staff can select an enabled definition to prefill its label,
method, value, and scope, then add it to that reservation. These values can be
changed before adding. Staff can also add a custom discount without selecting a
definition. A reservation stores its own discount entries (ID, label, scope,
method, value, and target); it does not retain a link to the configuration
definition. Thus later edits or disabling of a definition do not rewrite a
saved reservation discount.

The add form accepts values greater than zero. Percentages are limited to
100%; fixed amounts are not capped at entry time, but the calculation limits
the actual discount to the eligible remaining amount. Room and item discounts
require a selected target. Reservation-wide discounts have no target.

The types and seed definitions are in
[`reservation.ts`](../src/types/reservation.ts) and
[`sampleConfiguration.ts`](../src/features/configuration/sampleConfiguration.ts).
Definition editing is in
[`ConfigurationPage.tsx`](../src/pages/ConfigurationPage.tsx), and adding or
removing reservation discounts is in
[`ReservationPane.tsx`](../src/components/reservations/ReservationPane.tsx).

## Scope and eligible price lines

The calculator receives the current reservation's price lines and discount
entries. Each line has an ID, amount, room number, and kind (room, charge, or
breakfast).

- **Reservation** scope applies to all price lines in the reservation.
- **Room** scope applies to every line whose `roomNumber` equals the selected
  physical room number. This includes that room's accommodation and its charge
  lines; included breakfast lines are also in scope but have a zero amount.
- **Item** scope applies to the single line whose ID equals the selected target
  ID. In the reservation form, item targets are room charge lines (extras).

If there are no eligible positive-amount lines (for example, an item target
was removed), the calculated discount amount is zero.

## Calculation order

Discounts are applied sequentially in the order stored on the reservation.
Every price line starts with a remaining amount of `max(0, line.amount)`.
For each discount:

1. Find eligible lines using its scope and target.
2. Sum those lines' **remaining** amounts after any earlier discounts.
3. For a percentage discount, request `eligible remaining amount × value / 100`.
   For a fixed discount, request the configured fixed value.
4. Clamp the requested discount to the range from zero through the eligible
   remaining amount.
5. Consume that discount from eligible lines in their input order, never
   taking a line below zero.

Consequently, later discounts can apply to value remaining after earlier
discounts, not the original subtotal. A fixed discount is a total amount for
its scope, not an amount per line. A percentage is calculated against the
eligible remaining balance at that point in sequence.

The implementation is
[`reservationPricing.ts`](../src/lib/reservationPricing.ts). For example, with
a PHP 1,000 room line and PHP 200 charge line, a 10% room discount on that room
includes both lines and requests PHP 120. If a later reservation-wide fixed
discount is PHP 200, it applies to the balance remaining after the room
discount, subject to the remaining subtotal cap.

## Totals and adjustments

- **Subtotal** is the sum of `max(0, line.amount)` across the original price
  lines.
- **Discount total** is the sum of each sequentially calculated discount.
- **Adjustment total** is the sum of manual adjustment amounts. Positive
  adjustments add to what is owed; negative adjustments reduce it.
- **Amount owed** is
  `max(0, subtotal - discount total + adjustment total)`.

The app does not allow an amount owed below zero. The tax helper is currently
a zero-tax placeholder; tax fields on price lines do not alter this discount
calculation.

## Saved values and history

When saved, each reservation retains its discount entries and its calculated
price summary. The summary records each applied discount's ID, label, and
calculated amount, along with subtotal, discount total, adjustment total, and
amount owed. The reservation detail and print pages display these saved values
rather than deriving old reservations from the current discount definitions.

The summary's applied discount rows do not separately store the original
scope, method, value, target, or per-line allocation. Those are retained on
the reservation's `discounts` entries, but a historical summary alone is not a
full allocation ledger.

## Current limitations and behavior to be aware of

- There is no automatic coupon-code, date, weekday, room-type, guest, booking
  source, or minimum-spend eligibility.
- Configuration definitions are presets, not automatically applied
  promotions.
- There is no explicit priority field; the discount list order controls
  calculation order.
- Discounts do not have a currency field. Fixed discounts and adjustments are
  formatted using the reservation/hotel currency.
- Room scope targets a physical room number, not a room type.
- Item scope targets a price-line ID; in the form this is an extra-charge line.
- A removed charge also removes item discounts targeted at that charge.
- Existing snapshots remain historical values if current configuration
  definitions later change.

Tests for the sequential calculation and total caps are in
[`reservationPricing.test.ts`](../src/lib/reservationPricing.test.ts). Sample
reservations with reservation-, room-, and item-scoped discounts are in
[`demoReservations.ts`](../src/data/demoReservations.ts).
