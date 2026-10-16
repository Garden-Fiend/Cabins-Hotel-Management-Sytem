export type ChannelClassification = "direct" | "ota" | "corporate" | "agent" | "other";
export type CollectionResponsibility = "channel" | "hotel";
export type CommissionMethod = "percentage" | "fixed" | "manual" | "none";
export type CommissionBasis = "confirmed_accommodation" | "reference_value" | "explicit_amount";
export type SettlementMethod = "deducted" | "separate_invoice" | "offset" | "manual";
export interface ChannelAgreement {
    serverVersion?: number;
    id: string;
    channelId: string;
    version: number;
    effectiveFrom: string;
    effectiveTo?: string;
    status: "draft" | "active" | "retired";
    currency: string;
    pricing: {
        allowOverride: boolean;
        reasonRequired: boolean;
    };
    commission: {
        method: CommissionMethod;
        basis: CommissionBasis;
        rateBasisPoints: number;
        fixedMinor: number;
        allowOverride: boolean;
    };
    payment: {
        collection: CollectionResponsibility | "per_reservation";
    };
    settlement: {
        method: SettlementMethod;
    };
}
export interface FinancialConfirmation {
    amountMinor: number;
    actor: string;
    occurredAt: Date;
    reference: string;
}
export interface CollectionTransaction {
    id: string;
    kind: "collection" | "refund" | "reversal";
    collector: CollectionResponsibility;
    amountMinor: number;
    currency: string;
    reference: string;
    verifiedBy: string;
    verifiedAt: Date;
}
export interface ReservationChannelTerms {
    channelId: string;
    channelLabel: string;
    classification: ChannelClassification;
    currency: string;
    externalReference: string;
    collectionChoiceRequired?: boolean;
    agreement?: ChannelAgreement;
    taxBasis: "unknown" | "inclusive" | "exclusive";
    accommodationOverrideMinor?: number;
    overrideReason: string;
    collection: {
        responsibility: CollectionResponsibility;
        status: "pending" | "partial" | "confirmed";
        reference: string;
        transactions: CollectionTransaction[];
    };
    referenceValueMinor?: number;
    commissionableMinor?: number;
    commissionOverrideMinor?: number;
    commissionEstimateMinor?: number;
    commissionBasisMinor?: number;
    confirmedCommission?: FinancialConfirmation;
    expectedSettlement?: FinancialConfirmation;
    confirmedEntitlement?: FinancialConfirmation;
}
export interface ChannelPricingSnapshot {
    currency: string;
    standardAccommodationMinor: number;
    discountedAccommodationMinor: number;
    confirmedAccommodationMinor: number;
    accommodationAdjustmentMinor: number;
    additionalChargesMinor: number;
    totalGuestChargesMinor: number;
    verifiedCollectionMinor: number;
    guestBalanceMinor: number;
    roomAllocations: {
        roomNumber: string;
        amountMinor: number;
        source: "proportional" | "equal_zero_basis" | "authoritative";
    }[];
}
export interface ChannelSettlement {
    id: string;
    channelId: string;
    currency: string;
    kind: "payout" | "commission_deduction" | "commission_invoice" | "offset" | "adjustment" | "refund" | "reversal";
    amountMinor: number;
    allocations: {
        reservationId: string;
        amountMinor: number;
    }[];
    reference: string;
    occurredAt: Date;
    recordedBy: string;
    reconciliation: "unreconciled" | "partial" | "reconciled" | "disputed";
    note: string;
}
