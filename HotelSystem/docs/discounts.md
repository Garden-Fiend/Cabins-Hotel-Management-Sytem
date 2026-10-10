# Unified discount mechanics

This frontend-only demo stores configuration and reservations in memory. Nothing
is persisted to a server. Presets never apply automatically; staff verify guest
eligibility and explicitly select them. This is not statutory tax/VAT logic.

## Configuration presets

The dedicated Discounts page (`/discounts`) provides search, create/edit,
enable/disable and delete. Its builder and preset types belong to
`src/features/discounts/`; shared pricing/applicability functions remain in `src/lib/`.
Room presets target a stable room-type ID; item presets target a catalog product ID.
Reservation presets are globally available in the hotel currency.

Room and item presets support `final_price`, `fixed`, and `percentage`.
Reservation presets support only fixed and percentage reductions. A room
final-price preset stores `{ rateId, discountedUnitPrice }` entries referencing the
existing room-type price configuration. Blank rates are excluded; zero is valid.
At least one covered rate is required. There is one nightly rate entry, regardless
of the selected number of nights. Item final prices are per unit. Item fixed
reductions are a total against one selected charge line, not a per-unit deduction.

Definitions include currency. New selections require active targets/rates,
compatible currencies and valid prices no higher than the current base. If the
base drops below a preset price, that preset is unavailable for new selection
until corrected. Disabled/deleted definitions never invalidate saved snapshots.

## Contextual selection

Each assigned room has a room preset selector. It shows only presets matching
its room type and active rate, with partial coverage respected. Room presets
apply to accommodation only. Each extra/ordinary charge line has an item
selector matching its product ID. Two lines of the same product are independent.
A line selector offers one preset at a time. Manual discounts can be stacked.

Reservation presets have a separate select-and-Apply interaction. Their values
cannot be edited inside the reservation pane. The manual form independently
supports a label, fixed/percentage method, scope and target. Manual entries can
be edited and removed. Manual room scope intentionally continues to include all
associated room charges, not just accommodation. Item scope targets one line ID.

Removing a room/charge removes its targeted discounts with feedback. A rate or
room-type change that invalidates a captured preset displays a warning and blocks
saving until staff remove or replace it. The incompatible reduction is excluded
from the preview; the selection is not silently deleted. A changed nightly count
uses the same nightly rate and recalculates quantity. Inactive historical presets
remain visible as saved selections, using their captured values.

## One pricing pipeline

`reservationPricing.ts` is the only discount calculator. `discountPresets.ts`
resolves applicability separately; `reservationDraftPricing.ts` builds original
price lines outside React rendering logic.

New reservations use pipeline version 2:

1. Start with original base line amounts.
2. Apply final-price unit overrides first (one per line).
3. Apply fixed/percentage room and item reductions in insertion order.
4. Apply reservation-wide fixed/percentage reductions in insertion order.
5. Sum signed manual adjustments separately.
6. Calculate the final nonnegative amount owed once.

Percentage reductions use the remaining eligible balance. Fixed reductions are
capped at the balance. Allocation consumes eligible lines in their input order,
as in the legacy calculator. Lines cannot go negative.

Hourly final prices replace the selected package amount. Nightly final prices
replace the unit nightly rate and multiply by captured nights. Item final prices
multiply by the charge quantity. For example, 3 nights at base 1,950 and preset
1,750 produce base 5,850, reduction 600, and effective amount 5,250.

For one night, a 1,950 base, 1,750 preset, 100 manual room reduction, and 10%
reservation reduction produce reductions of 200, 100 and 165, leaving 1,485.

Each line keeps its original `amount` and stores `effectiveAmount` after unit
replacement and `finalAmount` after all reductions. Reporting uses:

```
amountOwed = max(0, originalSubtotal - totalDiscounts + adjustmentTotal)
```

Preset reductions appear once in totalDiscounts. Effective amounts are comparison
values and are not subtracted again. The tax helper remains a zero-tax placeholder.
Unit prices round to the currency precision before quantity multiplication;
allocations use integer minor units. Percentage amounts round at each application.
Rounding is half away from zero for monetary inputs, using the currency's Intl
precision (PHP: two decimals). This is a business calculation policy, not tax law.

## Historical snapshots and compatibility

Applied reservation entries capture source preset ID/name, scope, method, target,
rate ID, currency, unit prices, quantity and application timestamp. Price summary
entries retain calculated amount, actual application order and per-line allocation.
Room snapshots capture base unit price, rate ID and pricing quantity. They retain
`capturedRoomPrice` as the original/base accommodation amount; the price summary
contains the applied reductions and effective/final amounts.

Opening a saved reservation never fetches new preset values. Configuration edits,
disabling, deletion, rate changes and item price changes do not rewrite records.
Unrelated edits preserve original rates, quantities and scheduled timestamps.
Explicit duration edits resolve current base pricing and revalidate selected
presets. Item quantity edits recalculate using the captured unit prices.

Pre-version-2 reservations retain their manual discount list order when edited
without adding presets. Selecting a preset explicitly opts that record into the
staged pipeline. Legacy fixture prices/totals remain historical; they are not
migrated to current base rates. For legacy room snapshots without captured pricing
quantity, overnight quantity is inferred from the saved hotel-local stay dates.
Detail and print views read saved reductions; they do not reconstruct history
from current definitions. Unchanged saves return the existing snapshot directly.

## Limits

There are no coupon codes, automatic personal eligibility checks, date schedules,
rate overrides by physical room, payments, tax compliance rules or backend.
Only extras and ordinary products are chargeable item targets; included breakfast,
amenities and inclusions remain outside item preset selection. There is no
apply-to-all-items action or discount priority editor. Multiple preset definitions
can exist, but a room/item selector applies one at a time plus manual exceptions.

## Verification

Tests cover applicability, configuration validation, unit replacements, nightly
and item multiplication, scope differences, stable staging, caps, adjustments,
rounding, preserved legacy order, contextual UI, manual editing, invalidation,
historical configuration changes and printing. See `discountPresets.test.ts`,
`unifiedPricing.test.ts`, `DiscountPresetsEditor.test.tsx` and
`ReservationDiscounts.test.tsx`, along with the existing pricing/page tests.


## External accommodation totals

Booking channel agreements can permit a single externally confirmed accommodation
total for the reservation. The channel extension applies it once after this
calculator, preserving original room prices and hotel discount allocations.
Purchases and extra charges retain their existing discounted amounts. Commission
and hotel settlements remain separate from guest charges. See
[Booking channels](./booking-channels.md) for monetary, collection and history rules.
