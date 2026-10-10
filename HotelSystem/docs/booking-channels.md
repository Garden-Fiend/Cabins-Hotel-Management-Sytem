# Booking channels and manual OTA financial terms

## Architecture inspected

The app is a single-property React/TypeScript frontend. Routing lives in `src/app`, with configuration composed in `src/pages/ConfigurationPage.tsx`. `ReservationDemoProvider` owns configuration, reservations, guests and stays in memory. There was no payment ledger or settlement model to extend; the former billing summary explicitly displayed payment data as unavailable.

`src/features/configuration/types.ts` originally represented booking sources as ID, label and enabled status. `src/types/reservation.ts` already captured room rates, charge prices, discounts, timestamps and historical labels. `src/lib/roomPricing.ts` selects package/nightly prices. `src/lib/reservationDraftPricing.ts` builds room, purchase, extra and breakfast lines. `src/lib/reservationPricing.ts` remains the authoritative existing discount calculator. Creation and editing share `ReservationPane`; details and prints consume saved snapshots. `src/lib/reservationAudit.ts` expands audit records into newest-first field activity.

These boundaries are retained. There is no second reservation store, external pricing engine, OTA-specific subclass, added dependency, backend, connector or accounting journal generator. A distinct settlement transaction list in the existing provider is necessary because a payout may cover multiple reservations.

## Contracts and ownership

- `src/features/channels/types.ts`: agreement versions, captured reservation terms, integer-money financial confirmations, verified guest collection transactions, pricing snapshots and settlement allocations.
- `src/features/configuration/types.ts`: existing booking sources gain optional classification, reference requirements and notes; configuration gains agreements. Optional additions keep earlier records compatible.
- `src/app/permissions.ts`: injectable capabilities, all granted for the local demo. This is a boundary for future authentication, not authentication or secure authorization.
- `src/lib/channelFinance.ts`: validates inputs, selects effective agreements, extends existing pricing, allocates exact cents, estimates commissions and expected settlements.
- `src/lib/channelActions.ts`: capability checks, immutable verified records, audited confirmations, source reviews and settlement validation.
- `src/components/channels`: the Booking Sources editor, reservation terms editor, guest summary and collection/accounting detail controls.
- `src/data/channelSamples.ts`: twelve labeled December 2026 examples, fictional agreements and a partial two-reservation batch payout. Original nine examples remain intact.

## Pricing and monetary rules

1. Capture each room's standard rate and build its normal price lines.
2. Run the existing hotel discounts exactly once, retaining original lines and discount allocations.
3. If permitted, replace the final discounted accommodation total with the single documented external total. Persist the difference as a channel adjustment, never an ordinary discount.
4. Add the separately discounted purchases, extras and services, and existing manual adjustments. Commission never reduces guest charges.
5. Subtract verified guest collection to calculate a signed guest balance. A negative balance is credit; do not clamp it to zero.

`pricing.amountOwed` continues to represent total guest charges for compatibility with existing tables. `pricing.channel.guestBalanceMinor` represents what remains to collect. Original line totals, standard and discounted accommodation, the external accommodation amount, adjustment, collection and final guest charges remain individually available.

New financial values use integer minor currency units. Decimal inputs are parsed with BigInt rather than floating-point multiplication. Percentage rates are integer basis points; commission products and allocation division use BigInt with deterministic rounding. The existing calculator's decimal public contract is converted at this boundary. Currencies must match; there is no conversion. Tax basis is explicitly unknown, inclusive or exclusive and does not introduce a tax calculation.

Accommodation is allocated proportionally to original room accommodation values, using largest remainders to distribute remaining minor units. Equal remainders use saved room order. When all original values are zero, allocate equally in saved room order. Allocations always sum exactly to the confirmed total. Allocation metadata can represent future authoritative room amounts; entering those amounts is outside this phase. No commission allocation is inferred.

## Agreements and source reviews

A new reservation selects the active agreement using the hotel's date when staff selects the source (the booking-entry date), not the stay date. Effective endpoints are inclusive and active ranges cannot overlap. Draft versions can be edited; published versions can change effective dates/status but their financial rules, identity and currency cannot be rewritten or demoted to draft. New rules require a new version. A saved reservation contains a deep agreement snapshot, so later date changes, retirement and disabled channels do not recalculate its terms.

Disabled sources remain visible on historical records and unavailable for new selection. Agoda remains disabled in the seed configuration to preserve the existing retired-source examples; staff can enable it in Booking Sources. All sample rates and platform names are illustrative and must not be treated as actual contracts.

Changing an existing reservation's source requires an explicit review. Previous terms, payment transactions and confirmations are archived as `supersededChannelTerms`, preserving their original channel attribution. Historical verified collection still reduces the guest balance. Settlement allocations retain channel ID and reservation ID and cannot be reclassified by changing the source. Archived confirmations remain readable to accounting users. The collection ledger selector permits audited refunds/reversals on preserved collectors; the settlement channel selector permits new payouts or corrections allocated to an earlier captured channel. This preserves facts; staff must resolve contract/refund discrepancies using documented corrections rather than treating a source change as a cancellation of money already collected.

## Collection, accounting and settlement

Collection responsibility and verification status are separate. Selecting an OTA never marks collection complete. Choosing per reservation requires an explicit collector. Staff can record verified collection during entry or in details with amount, collector, reference, actor and time. Verified records are append-only; refunds and reversals are separate entries. Refunds cannot exceed recorded collection on the captured channel. A channel collection reduces guest debt and never creates hotel cash or a payout.

Commission may be none, fixed, percentage or manual. Percentage bases are confirmed accommodation, contract/reference value or an explicit commissionable amount. Missing required calculation inputs leave the estimate pending. Booking overrides are estimates until document confirmation. Confirmed commission liability, documented expected settlement and confirmed payout entitlement each record amount, document reference, actor and time independently.

Calculated expected settlements are explicitly labeled estimates. They require confirmed channel collection and a supported known settlement arrangement. Deducted commission uses confirmed commission when available, otherwise the estimate; separate invoices leave the payout gross. Only transactions collected by the channel contribute to that estimate. Offset/manual arrangements remain pending without a documented expected amount. No estimate establishes confirmed entitlement or actual receipt.

Settlements are separate typed transactions with explicit currency and per-reservation minor-unit allocations. The UI supports single or batch payouts, partial payouts, commission deductions/invoices, offsets, adjustments, refunds and reversals. Allocations must sum exactly and refer to reservations that captured the same channel/currency. Payouts less payout refunds/reversals are displayed as actual funds for the current channel; other transaction kinds remain distinct. Reconciliation status and explanations are manual, audited operational assertions. They do not produce accounting entries or automatically establish bank reconciliation.

Front-desk fields, overrides, collection verification, configuration management, commission confirmation and settlement/reconciliation controls use centralized capabilities. Domain actions also check their capabilities. Accounting confirmations and settlement audit entries carry accounting visibility; guest printing includes only guest-facing billing. These frontend checks cannot secure data without an authenticated backend.

## Verification and business policies

Regression tests cover unchanged direct pricing, pending OTA collection, additional charge isolation and no double discounts, exact/zero-price allocation, all commission bases/methods, invalid amounts, overlapping and immutable agreements, signed overpayments/refunds, source review/history, batch settlement attribution, permission checks and the integrated configuration/reservation/detail/print flows.

Business confirmation is needed before production for the booking-entry effective-date policy, permitted overpayments, the equal-zero-price allocation fallback, tax interpretation, evidence required for collection/commission confirmation and reconciliation approval. Financial corrections must retain evidence and original attribution. No business confirmation is required to explore this illustrative demo.

Everything is session memory and resets on reload. Actor names come from an injectable demo context, not identity verification. Existing reservations without captured channel terms retain their original pricing and payment-unavailable presentation; they are not automatically migrated or guessed to be prepaid. Authoritative OTA room allocations, commission allocation, bank import, currency conversion, real tax computation, API integration and accounting exports remain future work.


## Front-desk reservation presentation

The pane presents five main stages: Primary guest, Reservation stay, Rooms,
Booking information, and Review & save. Discounts, billing adjustments, staff
notes, booking-document metadata, verified collection, channel accommodation
pricing, and commission inputs use expandable sections. Applied discounts,
adjustments, notes and accommodation overrides expand automatically so saved
values remain visible. Required booking references and collection responsibility
remain visible.

Information icons explain the settings on hover, keyboard focus or tap, and
Escape dismisses help. The pane uses a compact guest summary with original line
prices and discount details available in the expandable price breakdown. The
save bar shows guest balance when channel collection exists, and total guest
charges for records without channel terms. Reservation details and print retain
the fuller billing summary. Pricing rules and authorization checks are unchanged.
