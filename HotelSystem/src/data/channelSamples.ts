import type { ChannelAgreement, ChannelSettlement } from "../features/channels/types";
import type { ReservationSnapshot } from "../types/reservation";
import { createHotelDateTime } from "../lib/hotelTime";
import { createChannelTerms } from "../lib/channelFinance";
import { refreshChannelReservation } from "../lib/channelActions";
import { calculateReservationPrice } from "../lib/reservationPricing";
const agreement = (channelId: string, version: number, overrides: Partial<ChannelAgreement> = {}): ChannelAgreement => ({ id: `illustrative-${channelId}-v${version}`, channelId, version, effectiveFrom: "2026-01-01", status: "active", currency: "PHP", pricing: { allowOverride: true, reasonRequired: true }, commission: { method: "percentage", basis: "confirmed_accommodation", rateBasisPoints: 1500, fixedMinor: 0, allowOverride: true }, payment: { collection: "channel" }, settlement: { method: "deducted" }, ...overrides });
// Fictional terms for demonstration; these are not actual platform contracts or rates.
export const illustrativeAgreements: ChannelAgreement[] = [
    agreement("agoda", 1, { status: "retired", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }),
    agreement("agoda", 2, { payment: { collection: "per_reservation" }, commission: { method: "percentage", basis: "reference_value", rateBasisPoints: 1500, fixedMinor: 0, allowOverride: true } }),
    agreement("booking-com", 1, { payment: { collection: "hotel" } }),
    agreement("expedia", 1, { settlement: { method: "separate_invoice" } }),
];
export function illustrativeReservations(template: ReservationSnapshot): ReservationSnapshot[] {
    const scenarios = ["Direct booking without commission", "Agoda verified prepaid override", "Agoda pay at property", "Booking.com percentage commission", "Expedia separately invoiced commission", "Multiple rooms with one accommodation total", "Channel-funded promotion with distinct contract value", "Partially collected booking", "Commission confirmed from statement", "Retired agreement snapshot", "Pending channel settlement", "Batch payout covering multiple reservations"];
    return scenarios.map((scenario, index) => {
        const channelId = index === 0 ? "direct" : index === 3 ? "booking-com" : index === 4 ? "expedia" : "agoda";
        const label = channelId === "direct" ? "Direct" : channelId === "booking-com" ? "Booking.com" : channelId === "expedia" ? "Expedia" : "Agoda";
        const checkIn = createHotelDateTime(2026, 12, index + 1, 14), checkOut = createHotelDateTime(2026, 12, index + 2, 12);
        const rooms = ["101", ...(index === 5 ? ["102"] : [])].map(roomNumber => ({ ...structuredClone(template.rooms[0]), roomNumber, roomTypeId: "standard", roomType: "Standard", checkIn, checkOut, durationId: "1-night", capturedRoomPrice: 3000, capturedUnitPrice: 3000, capturedPricingQuantity: 1, capturedCurrency: "PHP", capturedRateType: "overnight" as const, inclusions: [], inclusionOrigins: {}, charges: [{ id: `sample-extra-${index}-${roomNumber}`, catalogId: "laundry", label: "Laundry (illustrative)", quantity: 1, unitPrice: 120, usage: "extra_charge" as const }], breakfast: [] }));
        const base: ReservationSnapshot = { id: `CHANNEL-${index + 1}`, status: "confirmed", guestId: template.guestId, bookingSourceId: channelId, bookingSourceLabel: label, checkIn, checkOut, createdAt: createHotelDateTime(2026, 10, 1, 10), note: `Illustrative scenario: ${scenario}. Commission terms are fictional.`, rooms, discounts: [], adjustments: [], audit: [{ eventType: "created", actor: "Illustrative sample staff", occurredAt: createHotelDateTime(2026, 10, 1, 10), action: `Illustrative: ${scenario}` }], pricing: calculateReservationPrice(rooms.flatMap(r => [{ id: `room:${r.roomNumber}`, label: `Room ${r.roomNumber}`, roomNumber: r.roomNumber, kind: "room" as const, amount: 3000, currency: "PHP" }, ...r.charges.map(c => ({ id: c.id, label: c.label, roomNumber: r.roomNumber, kind: "charge" as const, amount: c.unitPrice, currency: "PHP" }))]), [], [], { currency: "PHP", staged: true }) };
        const applied = index === 0 ? undefined : illustrativeAgreements.find(a => a.channelId === channelId && (index === 9 ? a.status === "retired" : a.status === "active"));
        const terms = createChannelTerms({ id: channelId, label, enabled: true, classification: index === 0 ? "direct" : "ota" }, applied, "PHP");
        terms.collectionChoiceRequired = false;
        terms.externalReference = index === 0 ? "" : `ILLUSTRATIVE-${index + 1}`;
        terms.collection.responsibility = index === 2 || index === 3 || index === 0 ? "hotel" : "channel";
        terms.referenceValueMinor = index === 6 ? 360000 : rooms.length * 300000;
        if ([1, 5, 6, 7, 8, 9, 10, 11].includes(index)) {
            terms.accommodationOverrideMinor = rooms.length * 240000;
            terms.overrideReason = "Illustrative confirmed booking documentation";
        }
        if ([1, 4, 5, 6, 7, 8, 9, 10, 11].includes(index)) {
            const amountMinor = index === 7 ? 100000 : terms.accommodationOverrideMinor ?? rooms.length * 300000;
            terms.collection.status = index === 7 ? "partial" : "confirmed";
            terms.collection.transactions = [{ id: `illustrative-collection-${index}`, kind: "collection", collector: "channel", currency: "PHP", amountMinor, reference: `ILLUSTRATIVE-PAY-${index + 1}`, verifiedBy: "Illustrative sample staff", verifiedAt: createHotelDateTime(2026, 10, 2, 10) }];
        }
        if (index === 8)
            terms.confirmedCommission = { amountMinor: 31000, actor: "Illustrative sample accountant", occurredAt: createHotelDateTime(2026, 10, 3, 10), reference: "ILLUSTRATIVE-COMMISSION-STATEMENT" };
        if (index === 1 || index === 11)
            terms.confirmedEntitlement = { amountMinor: 195000, actor: "Illustrative sample accountant", occurredAt: createHotelDateTime(2026, 10, 3, 10), reference: "ILLUSTRATIVE-ENTITLEMENT" };
        return refreshChannelReservation(base, terms);
    });
}
export const illustrativeSettlements: ChannelSettlement[] = [{ id: "illustrative-batch-payout", channelId: "agoda", currency: "PHP", kind: "payout", amountMinor: 300000, allocations: [{ reservationId: "CHANNEL-2", amountMinor: 150000 }, { reservationId: "CHANNEL-12", amountMinor: 150000 }], reference: "ILLUSTRATIVE-BATCH-001", occurredAt: createHotelDateTime(2026, 10, 4, 10), recordedBy: "Illustrative sample accountant", reconciliation: "partial", note: "Illustrative partial batch payout; remaining entitlements are unsettled." }];
