import type { ChannelCapabilities, ChannelCapability } from "../app/permissions";
import { can } from "../app/permissions";
import type { ReservationSnapshot, ReservationAuditEntry } from "../types/reservation";
import type { ReservationChannelTerms, CollectionTransaction, ChannelSettlement, FinancialConfirmation } from "../features/channels/types";
import { applyChannelPricing, assertMinor, commissionEstimate, validateSettlement, verifiedCollection } from "./channelFinance";
import { fromMinorUnits } from "./money";
export function requireCapability(capabilities: ChannelCapabilities, capability: ChannelCapability) {
    if (!can(capabilities, capability))
        throw new Error("Permission required: " + capability.replaceAll("_", " "));
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function validateTermsPermissions(next: ReservationChannelTerms | undefined, previous: ReservationChannelTerms | undefined, capabilities: ChannelCapabilities) {
    if (same(next, previous))
        return;
    requireCapability(capabilities, "edit_channel_terms");
    if (next?.accommodationOverrideMinor !== previous?.accommodationOverrideMinor || next?.overrideReason !== previous?.overrideReason)
        requireCapability(capabilities, "override_accommodation");
    if (next?.commissionOverrideMinor !== previous?.commissionOverrideMinor || next?.referenceValueMinor !== previous?.referenceValueMinor || next?.commissionableMinor !== previous?.commissionableMinor)
        requireCapability(capabilities, "confirm_commission");
    if (!same(next?.collection.transactions, previous?.collection.transactions) && ((next?.collection.transactions.length ?? 0) > 0 || previous)) {
        requireCapability(capabilities, "verify_collection");
        const original = previous?.collection.transactions ?? [], transactions = next?.collection.transactions ?? [];
        if (transactions.length < original.length || !same(transactions.slice(0, original.length), original))
            throw new Error("Verified transactions are immutable; use an audited refund or reversal.");
    }
    for (const field of ["confirmedCommission", "expectedSettlement", "confirmedEntitlement"] as const)
        if (!same(next?.[field], previous?.[field]))
            throw new Error("Use the audited financial confirmation action.");
}
function display(value: unknown, terms: ReservationChannelTerms) { return typeof value === "number" ? new Intl.NumberFormat("en-PH", { style: "currency", currency: terms.currency }).format(fromMinorUnits(value, terms.currency)) : value === undefined ? "Not recorded" : String(value).replaceAll("_", " "); }
export function channelTermsAudit(before: ReservationChannelTerms | undefined, after: ReservationChannelTerms | undefined, actor: string, occurredAt: Date): ReservationAuditEntry[] {
    if (!after)
        return [];
    const fields: [
        string,
        unknown,
        unknown
    ][] = [["External booking reference", before?.externalReference, after.externalReference], ["Accommodation override", before?.accommodationOverrideMinor, after.accommodationOverrideMinor], ["Override reason", before?.overrideReason, after.overrideReason], ["Agreement version", before?.agreement ? `${before.channelLabel} v${before.agreement.version} (${before.agreement.id})` : undefined, after.agreement ? `${after.channelLabel} v${after.agreement.version} (${after.agreement.id})` : undefined], ["Collection responsibility", before?.collection.responsibility, after.collection.responsibility], ["Collection verification", before?.collection.status, after.collection.status], ["Collection reference", before?.collection.reference, after.collection.reference], ["Tax basis", before?.taxBasis, after.taxBasis], ["Contract reference value", before?.referenceValueMinor, after.referenceValueMinor], ["Explicit commissionable value", before?.commissionableMinor, after.commissionableMinor], ["Commission override estimate", before?.commissionOverrideMinor, after.commissionOverrideMinor]];
    return fields.filter(([, a, b]) => !same(a, b)).map(([field, a, b]) => ({ visibility: ["Contract reference value", "Explicit commissionable value", "Commission override estimate"].includes(field) ? "accounting" as const : undefined, eventType: "channel_terms_changed", actor, occurredAt, action: field + " changed", before: JSON.stringify({ field, value: a, display: field === "Agreement version" ? String(a ?? "Not recorded") : display(a, after) }), after: JSON.stringify({ field, value: b, display: field === "Agreement version" ? String(b ?? "Not recorded") : display(b, after) }) }));
}
export function refreshChannelReservation(reservation: ReservationSnapshot, terms: ReservationChannelTerms): ReservationSnapshot {
    const pricing = applyChannelPricing(reservation.pricing, terms, reservation.supersededChannelTerms);
    const estimate = commissionEstimate(terms, pricing.channel!.confirmedAccommodationMinor);
    return { ...reservation, channelTerms: { ...terms, commissionBasisMinor: estimate.basisMinor, commissionEstimateMinor: estimate.estimateMinor }, pricing };
}
export function recordCollection(reservation: ReservationSnapshot, transaction: CollectionTransaction, status: "partial" | "confirmed", capabilities: ChannelCapabilities): ReservationSnapshot {
    requireCapability(capabilities, "verify_collection");
    const terms = reservation.channelTerms;
    if (!terms)
        throw new Error("Capture booking channel terms before recording collection.");
    assertMinor(transaction.amountMinor);
    if (!transaction.amountMinor || transaction.currency !== terms.currency || !transaction.reference.trim() || !transaction.verifiedBy.trim() || !Number.isFinite(transaction.verifiedAt.getTime()))
        throw new Error("A positive same-currency amount, reference, actor and valid verification time are required.");
    if (terms.collection.transactions.some(item => item.id === transaction.id))
        throw new Error("Duplicate collection transaction.");
    const next = { ...terms, collection: { ...terms.collection, status, transactions: [...terms.collection.transactions, structuredClone(transaction)] } };
    if (verifiedCollection(next) < 0)
        throw new Error("Refunds cannot exceed this channel's verified collection.");
    const updated = refreshChannelReservation(reservation, next);
    return { ...updated, audit: [...reservation.audit, ...channelTermsAudit(terms, next, transaction.verifiedBy, transaction.verifiedAt), { eventType: "channel_terms_changed", actor: transaction.verifiedBy, occurredAt: transaction.verifiedAt, action: `Verified ${transaction.collector} ${transaction.kind}: ${display(transaction.amountMinor, terms)}; reference ${transaction.reference}` }] };
}
export function confirmChannelFinancial(reservation: ReservationSnapshot, field: "confirmedCommission" | "expectedSettlement" | "confirmedEntitlement", confirmation: FinancialConfirmation, capabilities: ChannelCapabilities): ReservationSnapshot {
    requireCapability(capabilities, field === "confirmedCommission" ? "confirm_commission" : "record_settlement");
    if (!reservation.channelTerms)
        throw new Error("Channel terms are required.");
    assertMinor(confirmation.amountMinor);
    if (!confirmation.reference.trim() || !confirmation.actor.trim() || !Number.isFinite(confirmation.occurredAt.getTime()))
        throw new Error("Document reference, actor and valid confirmation time are required.");
    const labels = { confirmedCommission: "Commission confirmed", expectedSettlement: "Expected settlement documented", confirmedEntitlement: "Payout entitlement confirmed" };
    return { ...reservation, channelTerms: { ...reservation.channelTerms, [field]: structuredClone(confirmation) }, audit: [...reservation.audit, { visibility: "accounting", eventType: "channel_terms_changed", actor: confirmation.actor, occurredAt: confirmation.occurredAt, action: `${labels[field]}: ${display(confirmation.amountMinor, reservation.channelTerms)}; reference ${confirmation.reference}`, before: JSON.stringify(reservation.channelTerms[field]), after: JSON.stringify(confirmation) }] };
}
export function validateSettlementReservations(transaction: ChannelSettlement, reservations: ReservationSnapshot[], capabilities: ChannelCapabilities) {
    requireCapability(capabilities, "record_settlement");
    validateSettlement(transaction);
    if (!Number.isFinite(transaction.occurredAt.getTime()))
        throw new Error("Settlement time is required.");
    for (const allocation of transaction.allocations) {
        const reservation = reservations.find(r => r.id === allocation.reservationId);
        if (!reservation || ![reservation.channelTerms, ...(reservation.supersededChannelTerms ?? [])].some(t => t?.channelId === transaction.channelId && t.currency === transaction.currency))
            throw new Error("Each settlement allocation must match a captured channel and currency.");
    }
}
export function reconcileChannelSettlement(transaction: ChannelSettlement, status: ChannelSettlement["reconciliation"], note: string, capabilities: ChannelCapabilities): ChannelSettlement {
    requireCapability(capabilities, "reconcile_settlement");
    if (!note.trim())
        throw new Error("A reconciliation explanation is required.");
    return { ...transaction, reconciliation: status, note };
}
export function switchChannelTerms(reservation: ReservationSnapshot, next: ReservationChannelTerms | undefined, reviewed: boolean, capabilities: ChannelCapabilities) {
    requireCapability(capabilities, "edit_channel_terms");
    if (!reviewed)
        throw new Error("Review the source change before applying new channel defaults.");
    return { channelTerms: next ? structuredClone(next) : undefined, supersededChannelTerms: [...(reservation.supersededChannelTerms ?? []), ...(reservation.channelTerms ? [structuredClone(reservation.channelTerms)] : [])] };
}
// Correct a preserved collector ledger without moving its financial attribution to the new source.
export function recordHistoricalCollection(reservation: ReservationSnapshot, historyIndex: number, transaction: CollectionTransaction, status: "partial" | "confirmed", capabilities: ChannelCapabilities): ReservationSnapshot {
    const archived = reservation.supersededChannelTerms?.[historyIndex];
    if (!archived || !reservation.channelTerms || archived.currency !== reservation.channelTerms.currency)
        throw new Error("Select a same-currency preserved channel ledger.");
    const verified = recordCollection({ ...reservation, channelTerms: archived, supersededChannelTerms: [], audit: [] }, transaction, status, capabilities);
    const history = reservation.supersededChannelTerms!.map((terms, index) => index === historyIndex ? { ...terms, collection: verified.channelTerms!.collection } : terms);
    const updated = refreshChannelReservation({ ...reservation, supersededChannelTerms: history }, reservation.channelTerms);
    return { ...updated, audit: [...reservation.audit, ...verified.audit.map(entry => ({ ...entry, action: archived.channelLabel + " preserved ledger: " + entry.action }))] };
}
