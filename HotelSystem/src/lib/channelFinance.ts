import type { BookingSourceConfiguration } from "../features/configuration/types";
import type { ChannelAgreement, ReservationChannelTerms, ChannelSettlement } from "../features/channels/types";
import type { ReservationPriceSummary } from "../types/reservation";
import { currencyDigits, fromMinorUnits, toMinorUnits } from "./money";
import { createHotelDateTime, hotelDateKey } from "./hotelTime";
export function parseMinor(value: string, currency: string): number {
    const digits = currencyDigits(currency);
    if (!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1, digits)}})?$`).test(value.trim()))
        throw new Error("Enter a non-negative amount with valid currency precision.");
    const [whole, fraction = ""] = value.trim().split(".");
    if (fraction.length > digits)
        throw new Error("Too many decimal places for this currency.");
    const minor = Number(BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0"));
    assertMinor(minor);
    return minor;
}
export function assertMinor(value: number, signed = false) {
    if (!Number.isSafeInteger(value) || (!signed && value < 0))
        throw new Error("Amounts must be valid integer minor currency units.");
}
function sum(values: number[]) { values.forEach(value => assertMinor(value, true)); const total = Number(values.reduce((a, b) => a + BigInt(b), 0n)); assertMinor(total, true); return total; }
function validDate(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return Boolean(match && hotelDateKey(createHotelDateTime(Number(match[1]), Number(match[2]), Number(match[3]))) === value);
}
export function validateAgreement(agreement: ChannelAgreement, others: ChannelAgreement[]) {
    const saved = others.find(item => item.id === agreement.id);
    if (saved && saved.status !== "draft" && (agreement.status === "draft" || saved.channelId !== agreement.channelId || saved.version !== agreement.version || saved.currency !== agreement.currency || JSON.stringify([saved.pricing, saved.commission, saved.payment, saved.settlement]) !== JSON.stringify([agreement.pricing, agreement.commission, agreement.payment, agreement.settlement])))
        throw new Error("Published agreement rules are immutable; create a new version.");
    if (!agreement.id || !agreement.channelId || !Number.isInteger(agreement.version) || agreement.version < 1)
        throw new Error("Agreement identity and version are required.");
    if (!validDate(agreement.effectiveFrom) || (agreement.effectiveTo && (!validDate(agreement.effectiveTo) || agreement.effectiveTo < agreement.effectiveFrom)))
        throw new Error("Enter a valid effective date range.");
    if (!/^[A-Z]{3}$/.test(agreement.currency))
        throw new Error("Use a valid currency code.");
    currencyDigits(agreement.currency);
    if (!Number.isInteger(agreement.commission.rateBasisPoints) || agreement.commission.rateBasisPoints < 0 || agreement.commission.rateBasisPoints > 10000)
        throw new Error("Commission rate must be between 0 and 100 percent.");
    assertMinor(agreement.commission.fixedMinor);
    if (others.some((item) => item.id !== agreement.id && item.channelId === agreement.channelId && item.version === agreement.version))
        throw new Error("Agreement versions must be unique for the channel.");
    if (agreement.status === "active" && others.some((item) => item.id !== agreement.id && item.channelId === agreement.channelId && item.status === "active" && item.effectiveFrom <= (agreement.effectiveTo ?? "9999-12-31") && agreement.effectiveFrom <= (item.effectiveTo ?? "9999-12-31")))
        throw new Error("Active agreement date ranges must not overlap.");
}
export function applicableAgreement(agreements: ChannelAgreement[], channelId: string, effectiveDate: string) {
    const matches = agreements.filter((item) => item.channelId === channelId && item.status === "active" && item.effectiveFrom <= effectiveDate && (!item.effectiveTo || item.effectiveTo >= effectiveDate));
    if (matches.length > 1)
        throw new Error("Overlapping channel agreements must be corrected.");
    return matches[0];
}
export function createChannelTerms(channel: BookingSourceConfiguration, agreement: ChannelAgreement | undefined, currency: string): ReservationChannelTerms {
    if (agreement && agreement.currency !== currency)
        throw new Error("Channel agreement currency must match the reservation.");
    return { channelId: channel.id, channelLabel: channel.label, classification: channel.classification ?? "direct", currency, externalReference: "", collectionChoiceRequired: agreement?.payment.collection === "per_reservation", agreement: agreement ? structuredClone(agreement) : undefined, taxBasis: "unknown", overrideReason: "", collection: { responsibility: agreement?.payment.collection === "channel" ? "channel" : "hotel", status: "pending", reference: "", transactions: [] } };
}
export function commissionEstimate(terms: ReservationChannelTerms, confirmedAccommodationMinor: number) {
    const rule = terms.agreement?.commission;
    const basis = rule?.basis === "reference_value" ? terms.referenceValueMinor : rule?.basis === "explicit_amount" ? terms.commissionableMinor : confirmedAccommodationMinor;
    if (basis !== undefined)
        assertMinor(basis);
    if (terms.commissionOverrideMinor !== undefined) {
        assertMinor(terms.commissionOverrideMinor);
        return { basisMinor: basis, estimateMinor: terms.commissionOverrideMinor };
    }
    if (!rule || rule.method === "none")
        return { basisMinor: basis, estimateMinor: 0 };
    if (rule.method === "manual")
        return { basisMinor: basis, estimateMinor: undefined };
    if (rule.method === "fixed") {
        assertMinor(rule.fixedMinor);
        return { basisMinor: basis, estimateMinor: rule.fixedMinor };
    }
    if (!Number.isInteger(rule.rateBasisPoints) || rule.rateBasisPoints < 0 || rule.rateBasisPoints > 10000)
        throw new Error("Invalid commission rate.");
    const estimateMinor = basis === undefined ? undefined : Number((BigInt(basis) * BigInt(rule.rateBasisPoints) + 5000n) / 10000n);
    if (estimateMinor !== undefined)
        assertMinor(estimateMinor);
    return { basisMinor: basis, estimateMinor };
}
export function allocateAccommodation(total: number, rooms: {
    roomNumber: string;
    amountMinor: number;
}[]) {
    assertMinor(total);
    rooms.forEach((room) => assertMinor(room.amountMinor));
    if (!rooms.length) {
        if (total)
            throw new Error("Accommodation allocation requires rooms.");
        return [];
    }
    const weight = sum(rooms.map((room) => room.amountMinor));
    const denominator = BigInt(weight || rooms.length);
    const result = rooms.map((room, index) => { const numerator = BigInt(total) * BigInt(weight ? room.amountMinor : 1); return { roomNumber: room.roomNumber, amountMinor: Number(numerator / denominator), remainder: numerator % denominator, index }; });
    let pending = total - sum(result.map((item) => item.amountMinor));
    for (const item of [...result].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
        if (!pending)
            break;
        item.amountMinor++;
        pending--;
    }
    return result.map(({ roomNumber, amountMinor }) => ({ roomNumber, amountMinor, source: weight ? "proportional" as const : "equal_zero_basis" as const }));
}
export function verifiedCollection(terms: ReservationChannelTerms) {
    return sum(terms.collection.transactions.map((item) => {
        assertMinor(item.amountMinor);
        if (item.currency !== terms.currency)
            throw new Error("Collection currency mismatch.");
        return item.kind === "collection" ? item.amountMinor : -item.amountMinor;
    }));
}
// Extend the existing pricing result; never re-run discounts against the external override.
export function applyChannelPricing(base: ReservationPriceSummary, terms?: ReservationChannelTerms, history: ReservationChannelTerms[] = []): ReservationPriceSummary {
    if (!terms)
        return base;
    const currency = terms.currency;
    if (base.lines.some((line) => line.currency && line.currency !== currency))
        throw new Error("Channel terms currency must match all price lines.");
    const rooms = base.lines.filter((line) => line.kind === "room");
    const standard = sum(rooms.map((line) => toMinorUnits(line.amount, currency)));
    const discounted = sum(rooms.map((line) => toMinorUnits(line.finalAmount ?? line.amount, currency)));
    const confirmed = terms.accommodationOverrideMinor ?? discounted;
    assertMinor(confirmed);
    const adjustment = confirmed - discounted;
    const additions = sum(base.lines.filter((line) => line.kind !== "room").map((line) => toMinorUnits(line.finalAmount ?? line.amount, currency)));
    const total = terms.accommodationOverrideMinor === undefined ? toMinorUnits(base.amountOwed, currency) : sum([toMinorUnits(base.subtotal, currency), -toMinorUnits(base.discountTotal, currency), toMinorUnits(base.adjustmentTotal, currency), adjustment]);
    assertMinor(total);
    if (history.some(t => t.currency !== currency))
        throw new Error("Historical collection currency mismatch.");
    const paid = sum([verifiedCollection(terms), ...history.map(verifiedCollection)]);
    assertMinor(total - paid, true);
    return { ...base, amountOwed: fromMinorUnits(total, currency), channel: { currency, standardAccommodationMinor: standard, discountedAccommodationMinor: discounted, confirmedAccommodationMinor: confirmed, accommodationAdjustmentMinor: adjustment, additionalChargesMinor: additions, totalGuestChargesMinor: total, verifiedCollectionMinor: paid, guestBalanceMinor: total - paid, roomAllocations: allocateAccommodation(confirmed, rooms.map((line) => ({ roomNumber: line.roomNumber, amountMinor: toMinorUnits(line.amount, currency) }))) } };
}
export function validateChannelTerms(terms: ReservationChannelTerms, channel: BookingSourceConfiguration, previous?: ReservationChannelTerms) {
    if (terms.collectionChoiceRequired)
        throw new Error("Choose who collects payment for this reservation.");
    if (terms.channelId !== channel.id)
        throw new Error("Review channel terms for the selected booking source.");
    if (channel.referenceRequired && !terms.externalReference.trim())
        throw new Error("An external booking reference is required.");
    if (terms.agreement && terms.agreement.channelId !== channel.id)
        throw new Error("Agreement does not belong to the selected channel.");
    if (terms.agreement && terms.agreement.currency !== terms.currency)
        throw new Error("Agreement currency mismatch.");
    if (terms.accommodationOverrideMinor !== undefined) {
        assertMinor(terms.accommodationOverrideMinor);
        if (!terms.agreement?.pricing.allowOverride && previous?.accommodationOverrideMinor !== terms.accommodationOverrideMinor)
            throw new Error("This agreement does not permit accommodation overrides.");
        if (terms.agreement?.pricing.reasonRequired && !terms.overrideReason.trim())
            throw new Error("Enter an accommodation override reason.");
    }
    if (terms.commissionOverrideMinor !== undefined && !terms.agreement?.commission.allowOverride && terms.agreement?.commission.method !== "manual" && previous?.commissionOverrideMinor !== terms.commissionOverrideMinor)
        throw new Error("Booking-specific commission overrides are not permitted.");
    for (const value of [terms.referenceValueMinor, terms.commissionableMinor, terms.commissionOverrideMinor])
        if (value !== undefined)
            assertMinor(value);
    for (const transaction of terms.collection.transactions) {
        if (!transaction.amountMinor || !transaction.reference.trim() || !transaction.verifiedBy.trim() || !Number.isFinite(transaction.verifiedAt.getTime()))
            throw new Error("Verified collection needs a positive amount, reference, actor and time.");
    }
    const net = verifiedCollection(terms);
    if (net < 0)
        throw new Error("Verified refunds cannot exceed recorded collection; record an accounting adjustment instead.");
    if (terms.collection.status === "pending" && net > 0)
        throw new Error("Verified collection requires Partial or Confirmed status.");
}
export function expectedSettlement(terms: ReservationChannelTerms, pricing: ReservationPriceSummary) {
    if (terms.expectedSettlement)
        return { amountMinor: terms.expectedSettlement.amountMinor, source: "Document confirmed" };
    // Collection and commission estimates alone never establish a confirmed payout entitlement.
    if (terms.collection.responsibility !== "channel" || terms.collection.status !== "confirmed" || !terms.agreement || terms.agreement.settlement.method === "manual" || terms.agreement.settlement.method === "offset")
        return undefined;
    const verified = verifiedCollection({ ...terms, collection: { ...terms.collection, transactions: terms.collection.transactions.filter(t => t.collector === "channel") } });
    const commission = terms.confirmedCommission?.amountMinor ?? terms.commissionEstimateMinor;
    if (terms.agreement.settlement.method === "deducted" && commission === undefined)
        return undefined;
    const amount = verified - (terms.agreement.settlement.method === "deducted" ? commission ?? 0 : 0);
    if (amount < 0 || !pricing.channel)
        return undefined;
    return { amountMinor: amount, source: "Estimate from verified collection and agreement" };
}
export function validateSettlement(item: ChannelSettlement) {
    assertMinor(item.amountMinor);
    if (!item.allocations.length || new Set(item.allocations.map((allocation) => allocation.reservationId)).size !== item.allocations.length)
        throw new Error("Settlement allocations must name distinct reservations.");
    item.allocations.forEach((allocation) => assertMinor(allocation.amountMinor));
    if (sum(item.allocations.map((allocation) => allocation.amountMinor)) !== item.amountMinor)
        throw new Error("Settlement allocations must sum to the transaction amount.");
    if (!item.reference.trim() || !item.recordedBy.trim())
        throw new Error("Settlement reference and actor are required.");
}
