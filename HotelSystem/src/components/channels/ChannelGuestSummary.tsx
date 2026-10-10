import type { ReservationPriceSummary } from "../../types/reservation";
import { fromMinorUnits, toMinorUnits } from "../../lib/money";
export function ChannelGuestSummary({ pricing, compact = false }: {
    pricing: ReservationPriceSummary;
    compact?: boolean;
}) {
    const c = pricing.channel;
    if (!c)
        return null;
    const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: c.currency }).format(fromMinorUnits(amount, c.currency));
    const rows = [["Original accommodation", c.standardAccommodationMinor], ["Accommodation after hotel discounts", c.discountedAccommodationMinor], ["Channel accommodation adjustment", c.accommodationAdjustmentMinor], ["Confirmed accommodation", c.confirmedAccommodationMinor], ["Additional charges after discounts", c.additionalChargesMinor], ["Total guest charges", c.totalGuestChargesMinor], ["Verified guest collection (all recorded collectors)", c.verifiedCollectionMinor], ["Guest balance (negative means credit)", c.guestBalanceMinor]] as const;
    const visibleRows = compact ? rows.filter(([label,value]) => label !== "Original accommodation" && label !== "Accommodation after hotel discounts" && (label !== "Channel accommodation adjustment" || value !== 0)) : rows;
    return <section aria-label="Channel guest billing" className="rounded-xl border border-blue-200 bg-blue-50 p-4">
    <h3 className="font-semibold">Guest billing</h3>
    <dl className="mt-3 space-y-2 text-sm">{visibleRows.map(([label, value]) => <div key={label} className="flex justify-between gap-3">
        <dt>{label}</dt>
        <dd className="font-semibold">{money(value)}</dd>
        </div>)}{pricing.adjustmentTotal !== 0 && <div className="flex justify-between gap-3"><dt>Billing adjustments</dt><dd className="font-semibold">{money(toMinorUnits(pricing.adjustmentTotal,c.currency))}</dd></div>}</dl>
    <p className="mt-3 text-xs text-slate-600">Collection reduces the guest balance. Hotel payouts and commissions are recorded separately.</p>{c.roomAllocations.length > 1 && <details className="mt-3 text-xs">
        <summary>Internal accommodation allocation</summary>{c.roomAllocations.map(room => <p key={room.roomNumber}>Room {room.roomNumber}: {money(room.amountMinor)} ({room.source === "equal_zero_basis" ? "Equal allocation: zero original prices" : "Proportional to original prices"})</p>)}</details>}</section>;
}
