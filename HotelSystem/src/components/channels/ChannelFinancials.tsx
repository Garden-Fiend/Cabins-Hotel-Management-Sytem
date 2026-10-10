import { useState } from "react";
import { useReservationDemo } from "../../app/useReservationDemo";
import { can } from "../../app/permissions";
import type { ReservationSnapshot } from "../../types/reservation";
import type { ChannelSettlement, CollectionTransaction } from "../../features/channels/types";
import { parseMinor, expectedSettlement, commissionEstimate, verifiedCollection } from "../../lib/channelFinance";
import { confirmChannelFinancial, recordCollection, recordHistoricalCollection, validateSettlementReservations, reconcileChannelSettlement } from "../../lib/channelActions";
import { fromMinorUnits } from "../../lib/money";
import { formatHotelDate } from "../../lib/hotelTime";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold";
export function ChannelFinancials({ reservation }: {
    reservation: ReservationSnapshot;
}) {
    const { capabilities, actor, reservations, setReservations, settlements, setSettlements } = useReservationDemo();
    const [notice, setNotice] = useState("");
    const [collectionLedger, setCollectionLedger] = useState("current");
    const [settlementChannel, setSettlementChannel] = useState(reservation.channelTerms?.channelId ?? "");
    const [collectionAmount, setCollectionAmount] = useState("");
    const [collectionRef, setCollectionRef] = useState("");
    const [collectionKind, setCollectionKind] = useState<CollectionTransaction["kind"]>("collection");
    const [collector, setCollector] = useState<"hotel" | "channel">(reservation.channelTerms?.collection.responsibility ?? "hotel");
    const [verification, setVerification] = useState<"partial" | "confirmed">("partial");
    const [confirmationField, setConfirmationField] = useState<"confirmedCommission" | "expectedSettlement" | "confirmedEntitlement">(can(capabilities, "confirm_commission") ? "confirmedCommission" : "expectedSettlement");
    const [confirmationAmount, setConfirmationAmount] = useState("");
    const [confirmationRef, setConfirmationRef] = useState("");
    const [kind, setKind] = useState<ChannelSettlement["kind"]>("payout");
    const [settlementRef, setSettlementRef] = useState("");
    const [allocations, setAllocations] = useState<Record<string, string>>({ [reservation.id]: "" });
    const [reconcileNotes, setReconcileNotes] = useState<Record<string, string>>({});
    const terms = reservation.channelTerms;
    if (!terms)
        return null;
    const money = (amount: number | undefined) => amount === undefined ? "Pending" : new Intl.NumberFormat("en-PH", { style: "currency", currency: terms.currency }).format(fromMinorUnits(amount, terms.currency));
    function attempt(action: () => void) {
        try {
            action();
            setNotice("Saved in this demo session.");
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : "Unable to save financial record.");
        }
    }
    function update(next: ReservationSnapshot) { setReservations(current => current.map(r => r.id === next.id ? next : r)); }
    const financialVisible = can(capabilities, "confirm_commission") || can(capabilities, "record_settlement") || can(capabilities, "reconcile_settlement");
    const estimate = commissionEstimate(terms, reservation.pricing.channel?.confirmedAccommodationMinor ?? 0);
    const expected = expectedSettlement({ ...terms, commissionEstimateMinor: estimate.estimateMinor }, reservation.pricing);
    const channelIds = new Set([terms.channelId, ...(reservation.supersededChannelTerms ?? []).map(t => t.channelId)]);
    const transactions = settlements.filter(t => channelIds.has(t.channelId) && t.allocations.some(a => a.reservationId === reservation.id));
    const received = transactions.filter(t => t.channelId === terms.channelId).reduce((total, t) => total + (t.kind === "payout" ? t.allocations.find(a => a.reservationId === reservation.id)!.amountMinor : t.kind === "refund" || t.kind === "reversal" ? -t.allocations.find(a => a.reservationId === reservation.id)!.amountMinor : 0), 0);
    const eligible = reservations.filter(r => [r.channelTerms, ...(r.supersededChannelTerms ?? [])].some(t => t?.channelId === settlementChannel && t.currency === terms.currency));
    return <div className="space-y-5">{notice && <p role="status" className="rounded-xl border bg-white p-3 text-sm">{notice}</p>}<section className="rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Channel booking details & guest collection</h2>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
    <div>
    <dt className="text-slate-500">Channel / reference</dt>
    <dd>{terms.channelLabel} / {terms.externalReference || "Not recorded"}</dd>
    </div>
    <div>
    <dt className="text-slate-500">Applied agreement</dt>
    <dd>{terms.agreement ? `Version ${terms.agreement.version} (${terms.agreement.status} at capture)` : "No agreement captured"}</dd>
    </div>
    <div>
    <dt className="text-slate-500">Collection arrangement / verification</dt>
    <dd>{terms.collection.responsibility} / {terms.collection.status}</dd>
    </div>
    <div>
    <dt className="text-slate-500">Tax basis</dt>
    <dd>{terms.taxBasis}</dd>
    </div>
    </dl>
    <p className="mt-3 text-sm">Verified on this channel: {money(verifiedCollection(terms))}. Collection through a channel is separate from funds received by the hotel.</p>
 {terms.collection.transactions.map(t => <p key={t.id} className="mt-2 text-xs text-slate-600">{t.kind} / {t.collector}: {money(t.amountMinor)} / {t.reference} / {t.verifiedBy} / {formatHotelDate(t.verifiedAt, { dateStyle: "medium", timeStyle: "short" })}</p>)}
 {(reservation.supersededChannelTerms ?? []).length > 0 && <details className="mt-4 rounded-lg border p-3">
        <summary>Preserved terms from earlier booking sources</summary>{reservation.supersededChannelTerms!.map((t, i) => <div key={i} className="mt-3 text-sm">
            <p>{t.channelLabel} / {t.externalReference || "No reference"} / agreement v{t.agreement?.version ?? "none"} / verified collection {money(verifiedCollection(t))}</p>{financialVisible && <p>Confirmed commission: {money(t.confirmedCommission?.amountMinor)}; documented entitlement: {money(t.confirmedEntitlement?.amountMinor)}</p>}{t.collection.transactions.map(c => <p key={c.id}>{c.kind}: {money(c.amountMinor)} / {c.reference} / {c.verifiedBy}</p>)}</div>)}</details>}
 {can(capabilities, "verify_collection") && <details className="mt-4 rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Record verified collection / refund / reversal</summary>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); attempt(() => { const next = (collectionLedger === "current" ? recordCollection : (r: ReservationSnapshot, t: CollectionTransaction, status: "partial" | "confirmed", caps: typeof capabilities) => recordHistoricalCollection(r, Number(collectionLedger), t, status, caps))(reservation, { id: crypto.randomUUID(), kind: collectionKind, collector, amountMinor: parseMinor(collectionAmount, terms.currency), currency: terms.currency, reference: collectionRef, verifiedBy: actor, verifiedAt: new Date() }, verification, capabilities); update(next); setCollectionAmount(""); setCollectionRef(""); }); }}>
        <label>Collection ledger<select className={input} value={collectionLedger} onChange={e => setCollectionLedger(e.target.value)}><option value="current">Current: {terms.channelLabel}</option>{(reservation.supersededChannelTerms ?? []).map((t, index) => <option key={index} value={String(index)}>Preserved: {t.channelLabel} / {t.externalReference || "No reference"}</option>)}</select></label>
        <label>Transaction<select className={input} value={collectionKind} onChange={e => setCollectionKind(e.target.value as CollectionTransaction["kind"])}>{["collection", "refund", "reversal"].map(v => <option key={v}>{v}</option>)}</select>
        </label>
        <label>Actual collector<select className={input} value={collector} onChange={e => setCollector(e.target.value as "hotel" | "channel")}>
        <option>hotel</option>
        <option>channel</option>
        </select>
        </label>
        <label>Verified amount ({terms.currency})<input required className={input} value={collectionAmount} onChange={e => setCollectionAmount(e.target.value)}/>
        </label>
        <label>Document / collection reference<input required className={input} value={collectionRef} onChange={e => setCollectionRef(e.target.value)}/>
        </label>
        <label>Verification status<select className={input} value={verification} onChange={e => setVerification(e.target.value as "partial" | "confirmed")}>
        <option value="partial">Partial</option>
        <option value="confirmed">Confirmed</option>
        </select>
        </label>
        <div className="self-end">
        <button className={button}>Record verification</button>
        </div>
        </form>
        </details>}</section>
 {financialVisible && <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Channel financials</h2>
        <p className="mt-2 text-xs text-slate-500">Accounting view. Estimates are not confirmed liabilities, entitlements or actual payouts.</p>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">{[["Commission method", terms.agreement?.commission.method ?? "none"], ["Commission basis", `${terms.agreement?.commission.basis.replaceAll("_", " ") ?? "No agreement"}: ${money(estimate.basisMinor)}`], ["Commission rate", terms.agreement?.commission.method === "percentage" ? `${terms.agreement.commission.rateBasisPoints / 100}%` : "Not applicable"], ["Estimated commission", money(estimate.estimateMinor)], ["Confirmed commission liability", money(terms.confirmedCommission?.amountMinor)], ["Expected settlement", expected ? `${money(expected.amountMinor)} (${expected.source})` : "Pending"], ["Confirmed payout entitlement", money(terms.confirmedEntitlement?.amountMinor)], ["Actual funds for this channel (payouts less refunds / reversals)", money(received)], ["Settlement arrangement", terms.agreement?.settlement.method.replaceAll("_", " ") ?? "Unknown"]].map(([label, value]) => <div key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-semibold">{value}</dd>
            </div>)}</dl>{(["confirmedCommission", "expectedSettlement", "confirmedEntitlement"] as const).map(field => terms[field] && <p key={field} className="mt-3 text-xs">{field === "confirmedCommission" ? "Commission" : field === "expectedSettlement" ? "Expected settlement" : "Payout entitlement"}: {terms[field]!.reference}, confirmed by {terms[field]!.actor}, {formatHotelDate(terms[field]!.occurredAt, { dateStyle: "medium", timeStyle: "short" })}</p>)}
 {(can(capabilities, "confirm_commission") || can(capabilities, "record_settlement")) && <details className="mt-5 rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">Confirm from a channel document</summary>
            <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); attempt(() => { update(confirmChannelFinancial(reservation, confirmationField, { amountMinor: parseMinor(confirmationAmount, terms.currency), actor, occurredAt: new Date(), reference: confirmationRef }, capabilities)); setConfirmationAmount(""); setConfirmationRef(""); }); }}>
            <label>Confirmation<select className={input} value={confirmationField} onChange={e => setConfirmationField(e.target.value as typeof confirmationField)}>{can(capabilities, "confirm_commission") && <option value="confirmedCommission">Commission liability</option>}{can(capabilities, "record_settlement") && <>
                <option value="expectedSettlement">Documented expected settlement</option>
                <option value="confirmedEntitlement">Confirmed payout entitlement</option>
                </>}</select>
            </label>
            <label>Amount ({terms.currency})<input required className={input} value={confirmationAmount} onChange={e => setConfirmationAmount(e.target.value)}/>
            </label>
            <label>Statement / document reference<input required className={input} value={confirmationRef} onChange={e => setConfirmationRef(e.target.value)}/>
            </label>
            <button className={`${button} self-end`}>Save document confirmation</button>
            </form>
            </details>}
 <h3 className="mt-6 font-semibold">Settlement transactions</h3>{transactions.length === 0 && <p className="mt-2 text-sm text-slate-500">No actual settlement recorded.</p>}{transactions.map(t => <div key={t.id} className="mt-3 rounded-xl border p-3 text-sm">
            <p className="font-semibold">{t.kind.replaceAll("_", " ")} / {money(t.amountMinor)} / {t.reconciliation}</p>
            <p>Reference {t.reference} / {t.recordedBy} / {formatHotelDate(t.occurredAt, { dateStyle: "medium", timeStyle: "short" })}</p>
            <p>Allocated to this reservation: {money(t.allocations.find(a => a.reservationId === reservation.id)!.amountMinor)}. Covers {t.allocations.length} reservation(s).</p>
            <p>{t.note}</p>{can(capabilities, "reconcile_settlement") && <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); attempt(() => { const data = new FormData(e.currentTarget); const status = data.get("status") as ChannelSettlement["reconciliation"]; const note = reconcileNotes[t.id] ?? ""; const next = reconcileChannelSettlement(t, status, note, capabilities); setSettlements(current => current.map(s => s.id === t.id ? next : s)); setReservations(current => current.map(r => t.allocations.some(a => a.reservationId === r.id) ? { ...r, audit: [...r.audit, { visibility: "accounting" as const, eventType: "channel_settlement_changed", actor, occurredAt: new Date(), action: `Settlement ${t.reference} reconciliation changed from ${t.reconciliation} to ${status}; ${note}`, before: JSON.stringify(t), after: JSON.stringify(next) }] } : r)); }); }}>
                <select aria-label={`Reconciliation for ${t.reference}`} name="status" defaultValue={t.reconciliation} className={input}>{["unreconciled", "partial", "reconciled", "disputed"].map(v => <option key={v}>{v}</option>)}</select>
                <input aria-label={`Reconciliation explanation for ${t.reference}`} required placeholder="Reconciliation explanation" className={input} value={reconcileNotes[t.id] ?? ""} onChange={e => setReconcileNotes({ ...reconcileNotes, [t.id]: e.target.value })}/>
                <button className={button}>Update reconciliation</button>
                </form>}</div>)}
 {can(capabilities, "record_settlement") && <details className="mt-5 rounded-xl border p-4">
            <summary className="cursor-pointer font-semibold">Record settlement transaction (single or batch)</summary>
            <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); attempt(() => { const parsed = Object.entries(allocations).filter(([, v]) => v.trim()).map(([reservationId, v]) => ({ reservationId, amountMinor: parseMinor(v, terms.currency) })); const transaction: ChannelSettlement = { id: crypto.randomUUID(), channelId: settlementChannel, currency: terms.currency, kind, amountMinor: parsed.reduce((total, a) => total + a.amountMinor, 0), allocations: parsed, reference: settlementRef, occurredAt: new Date(), recordedBy: actor, reconciliation: "unreconciled", note: "" }; validateSettlementReservations(transaction, reservations, capabilities); setSettlements(current => [...current, transaction]); setReservations(current => current.map(r => parsed.some(a => a.reservationId === r.id) ? { ...r, audit: [...r.audit, { visibility: "accounting" as const, eventType: "channel_settlement_changed", actor, occurredAt: transaction.occurredAt, action: `Settlement ${kind.replaceAll("_", " ")} recorded: ${money(parsed.find(a => a.reservationId === r.id)!.amountMinor)}; reference ${settlementRef}`, after: JSON.stringify(transaction) }] } : r)); setSettlementRef(""); setAllocations({ [reservation.id]: "" }); }); }}>
            <label className="block">Settlement channel<select className={input} value={settlementChannel} onChange={e => { setSettlementChannel(e.target.value); setAllocations({ [reservation.id]: "" }); }}>{[...new Map([terms, ...(reservation.supersededChannelTerms ?? [])].map(t => [t.channelId, t])).values()].map(t => <option key={t.channelId} value={t.channelId}>{t.channelLabel}</option>)}</select></label>
            <label className="block">Transaction type<select className={input} value={kind} onChange={e => setKind(e.target.value as ChannelSettlement["kind"])}>{["payout", "commission_deduction", "commission_invoice", "offset", "adjustment", "refund", "reversal"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select>
            </label>
            <label className="block">Payout / statement reference<input required className={input} value={settlementRef} onChange={e => setSettlementRef(e.target.value)}/>
            </label>
            <p className="text-xs text-slate-500">Enter each reservation's allocation in {terms.currency}; blank excludes it. The transaction total equals these allocations. Record partial payouts as separate transactions.</p>{eligible.map(r => <label key={r.id} className="block">{r.id} / {[r.channelTerms, ...(r.supersededChannelTerms ?? [])].find(t => t?.channelId === settlementChannel)?.externalReference || r.bookingSourceLabel}<input aria-label={`Settlement allocation ${r.id}`} className={input} value={allocations[r.id] ?? ""} onChange={e => setAllocations({ ...allocations, [r.id]: e.target.value })}/>
                </label>)}<button className={button}>Record settlement</button>
            </form>
            </details>}</section>}</div>;
}
