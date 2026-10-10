# Shared inventory, breakfast eligibility and reservation purchases

This implementation uses the existing in-memory ReservationDemoProvider. Reloading resets configuration and reservations. There is no backend, stock movement, retail checkout, staff authorization system, payment ledger, or separate invoice engine.

## Architecture and model decisions

CatalogConfiguration remains the authoritative product: stable ID, category reference, label, selling price, enabled/archived state. Ordinary products have availableForSale; missing values retain the previous ordinary-product sellable behavior. Inclusions, extras and amenities keep their existing behavior.

HotelConfigurationData.breakfastEligibleItems stores only inventoryItemId, meal/beverage kind, and enabled. Inventory category names never determine breakfast kind or eligibility. Active product and category checks are shared in src/lib/inventoryProducts.ts. Sale availability is independent of breakfast eligibility.

BreakfastEligibilityEditor is reused in Inventory's Breakfast Configuration popup and Configuration's Inclusions & Extras section. Inventory's Breakfast Items pill shows eligible catalog products at their selling prices, and opens configuration through Configure breakfast. New products belong to ordinary Meals/Beverages/Snacks or other ordinary categories; Breakfast no longer creates product definitions.

ReservationRoomSnapshot.charges remains the authoritative billable item collection. Optional usage distinguishes purchase from extra_charge; existing records without usage remain extras. The record's ID, enclosing reservation reference, catalogId, captured label, quantity and unitPrice describe a purchase. Room assignment is a charge association, not product ownership. Existing discounts apply to purchase lines through the same charge pricing pipeline.

Purchased Items appears after Breakfast in each room configuration. Selectors group labels by inventory category and offer active sellable ordinary products only. Quantities are positive integers; removing a line removes its targeted discounts. Unit price and line totals use captured values. The shared charge renderer serves extras and purchases, with a purchase running total.

buildReservationPriceLines emits each charge once and classifies its usage. Saved reservation pricing is the existing folio-like charge breakdown used by detail/print screens. No additional charge ledger is generated. Operational breakfast records are represented by zero-price lines with complimentary_breakfast usage. Catalog prices never determine historical reservation totals.

## Sample migration and compatibility

The existing Filipino breakfast, Continental, Vegetarian, American breakfast, Coffee, Tea, Juice, Water and Soda IDs are retained. Their single catalog records move to ordinary Meals/Beverages categories and receive illustrative selling prices (PHP 150 for meals and PHP 50 for beverages). Their old kind and enabled states become eligibility references. Existing reservation IDs, captured labels, zero breakfast prices and seed totals are unchanged, so no identifier remapping is needed. Archived American breakfast/Soda remain inactive historical products. Pancit Canton (PHP 120) and Potato Chips (PHP 35) demonstrate sale-only products without automatic breakfast eligibility.

There was no persisted/external data migration: this is a sample configuration migration. If a future backend imports old independent breakfast records, it will need an explicit conversion to these catalog references. Optional fields avoid requiring unrelated historic snapshots to be rewritten.

## Breakfast entitlement

The previous UI already exposes one meal/beverage pair per guest (adults plus children) per service date, starting the hotel-local day after arrival and before checkout. Those rules are retained; hourly reservations now expose no new complimentary selections. No additional child-age, consumption, cancellation, or per-day quota policy is introduced.

Removing eligibility, changing kind, archiving products or editing names/prices does not remove saved selections. Historical options retain captured labels and remain visible but unavailable for new selection. Save validates newly selected products against active eligibility. Explicit stay/guest changes discard breakfast records outside the resulting nightly date/guest entitlement, matching the form's existing guest-count trimming behavior. There is no breakfast fulfillment tracking or authentication; authorized-staff restrictions require a future access-control design.

## Validation

Regression tests in inventoryProducts.test.ts cover explicit eligibility, independent kind/selling price, disabled categories/products, sale availability, captured purchase pricing and zero-price breakfast without duplicate billing. ReservationPurchases.test.tsx covers UI separation, quantities, hourly exclusion, nightly guest allowance, saving, retired product history and unrelated edits. InventoryPage.test.tsx covers creating a regular product and configuring eligibility by reference. Existing reservation/detail/print and pricing tests retain sample history checks.

## Files created or modified for this integration

Created:
- src/lib/inventoryProducts.ts and inventoryProducts.test.ts
- src/features/inventory/BreakfastEligibilityEditor.tsx
- src/components/reservations/ReservationPurchases.test.tsx
- docs/inventory-breakfast-purchases.md

Modified:
- src/features/configuration/types.ts and sampleConfiguration.ts
- src/types/reservation.ts
- src/data/datasample.ts
- src/lib/reservationDraftPricing.ts
- src/components/reservations/ReservationPane.tsx
- src/pages/InventoryPage.tsx and InventoryPage.test.tsx
- src/pages/ConfigurationPage.tsx
- src/pages/ReservationDetailPage.tsx and ReservationPrintPage.tsx

Final automated checks: 109 tests in 18 files passed; npm run lint and npm run build passed. The build still reports the existing bundle-size warning. No manual browser verification was performed.
