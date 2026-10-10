# Room pricing mechanics

Accommodation pricing is configured by room type only. The physical room
number is never part of the accommodation rate lookup. This page describes the
current in-memory behavior; it is not a database schema migration guide.

## Configured rates

Manage rates in Configuration → Room Prices. Each room type can have:

- One enabled or disabled price per supported **hourly duration package**.
  An hourly package amount is the full accommodation charge for the package;
  it is not multiplied by the package's number of hours.
- One **nightly base rate**. Any selected overnight duration charges
  `nightly base rate × configured number of nights`.

`RoomTypePriceConfiguration.bookingType` distinguishes hourly packages from
the nightly base rate. Hourly entries have a `durationId`; the nightly base
rate has no duration ID. An overnight `DurationConfiguration` has an explicit
`nights` count. That count, rather than elapsed minutes or checkout timestamp
arithmetic, determines both the number of nights charged and the scheduled
checkout date.

One shared resolver, `getRoomAccommodationPrice`, applies these rules:

1. Find an enabled duration by its selected ID.
2. For an hourly duration, find the enabled rate for its room type and exact
   duration ID; return that amount and currency unchanged.
3. For an overnight duration, find the enabled nightly base rate for its room
   type and multiply it by the duration's positive whole-number `nights`.
4. If the duration, required rate, or valid nightly count is absent, there is
   no configured price. A zero amount is valid.

The reservation form uses the same resolver to show and validate prices, and
the reservation detail page uses it for its “current” rate comparison. A newly
assigned room without a valid rate for its room type and selected duration
cannot be saved. Room-specific status and availability can affect whether a
room is bookable, but never change its accommodation rate.

Rate configuration and its resolver are in
[`types.ts`](../src/features/configuration/types.ts),
[`sampleConfiguration.ts`](../src/features/configuration/sampleConfiguration.ts),
and [`roomPricing.ts`](../src/lib/roomPricing.ts).

## Reservation snapshots and other charges

Each assigned room saves the original/base accommodation charge in
`ReservationRoomSnapshot.capturedRoomPrice`, alongside `capturedCurrency` and
the selected `durationId`/stay dates. New snapshots also capture the unit rate, rate ID, and pricing quantity. Final-price discount presets and subsequent reductions are captured separately in the reservation price summary. For an overnight stay, the captured base price
is already the total for all selected nights; it is not a per-night value.

Opening an existing reservation does not reprice it. The saved accommodation
amount remains locked while editing unrelated details. Changing the applicable
reservation duration or that room's custom duration unlocks/recalculates that
room's accommodation amount from the current room-type rate. Saving records
the resulting new snapshot. Changing rates in Configuration does not
retroactively update existing reservations.

Room accommodation, extras, breakfast, discounts, and adjustments remain
separate price lines. Included breakfast remains zero-priced. The tax helper
is still a zero-tax placeholder. Reservation totals remain:

```text
max(0, subtotal - discountTotal + adjustmentTotal)
```

Discounts can apply to the reservation, a room, or a price line. See
[`ReservationPane.tsx`](../src/components/reservations/ReservationPane.tsx),
[`reservationPricing.ts`](../src/lib/reservationPricing.ts), and the
reservation snapshot types in
[`reservation.ts`](../src/types/reservation.ts).

## Removed legacy configuration and preserved demo history

The old model allowed `RoomConfiguration.priceOverrides`; that field and its
room-editor/configuration controls have been removed. The bundled sample room
records had only empty override lists, so no sample override values were
converted to room-type rates. This refactor intentionally does not migrate
non-empty overrides from any external or persisted configuration.

The old room-type price table had a separate rate for each overnight duration.
For the new base nightly seed rates, the previous one-night values are used as
the base: Standard PHP 2,200, Deluxe PHP 2,900, and Suite PHP 4,200. The old
two- and three-night configured amounts are not used for current pricing.

The bundled demo reservations are saved historical snapshots, not live
configuration. Their fixture data deliberately retains the old captured
two-/three-night amounts (and the separate historical Deluxe rate) so those
sample reservations and their totals remain unchanged. These fixture-only
values in [`datasample.ts`](../src/data/datasample.ts) are not available to
price new reservations.

## Current limits

Rates are not date-, weekday-, season-, occupancy-, guest-count-, or
promotion-dependent. There is no automatic proration, extension, or
physical-room rate override. Contextual discount presets can explicitly replace
a room type's hourly package or nightly unit price; see
[Discount mechanics](./discounts.md). Seasonal rules, proration and extensions
would require separate product requirements and explicit configuration.


## Reservation channel pricing

Booking channel agreements can permit a single externally confirmed accommodation
total for the reservation. The channel extension applies it once after this
calculator, preserving original room prices and hotel discount allocations.
Purchases and extra charges retain their existing discounted amounts. Commission
and hotel settlements remain separate from guest charges. See
[Booking channels](./booking-channels.md) for monetary, collection and history rules.
