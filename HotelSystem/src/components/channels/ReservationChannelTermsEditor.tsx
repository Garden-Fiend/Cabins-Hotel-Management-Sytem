import { InfoTip } from "../InfoTip";
import { useState } from "react";
import type { ReservationChannelTerms, CollectionTransaction } from "../../features/channels/types";
import type { ChannelCapabilities } from "../../app/permissions";
import { can } from "../../app/permissions";
import { parseMinor } from "../../lib/channelFinance";
import { fromMinorUnits } from "../../lib/money";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
export function ReservationChannelTermsEditor({ terms, onChange, capabilities, onValidity, onCollection, actor }: {
    terms: ReservationChannelTerms;
    onChange: (terms: ReservationChannelTerms) => void;
    capabilities: ChannelCapabilities;
    onValidity: (valid: boolean) => void;
    actor: string;
    onCollection: (transaction: CollectionTransaction, status: "partial" | "confirmed") => void;
}) {
    const [paid, setPaid] = useState("");
    const [paidReference, setPaidReference] = useState("");
    const [verification, setVerification] = useState<"partial" | "confirmed">("partial");
    const [error, setError] = useState("");
    const [amountErrors, setAmountErrors] = useState<Record<string, string>>({});
    const [override, setOverride] = useState(terms.accommodationOverrideMinor === undefined ? "" : String(fromMinorUnits(terms.accommodationOverrideMinor, terms.currency)));
    const [reference, setReference] = useState(terms.referenceValueMinor === undefined ? "" : String(fromMinorUnits(terms.referenceValueMinor, terms.currency)));
    const [basis, setBasis] = useState(terms.commissionableMinor === undefined ? "" : String(fromMinorUnits(terms.commissionableMinor, terms.currency)));
    const [commission, setCommission] = useState(terms.commissionOverrideMinor === undefined ? "" : String(fromMinorUnits(terms.commissionOverrideMinor, terms.currency)));
    function amount(field: "accommodationOverrideMinor" | "referenceValueMinor" | "commissionableMinor" | "commissionOverrideMinor", value: string) {
        try {
            onChange({ ...terms, [field]: value.trim() ? parseMinor(value, terms.currency) : undefined });
            const next = { ...amountErrors };
            delete next[field];
            setAmountErrors(next);
            onValidity(Object.keys(next).length === 0);
        }
        catch (e) {
            setAmountErrors({ ...amountErrors, [field]: e instanceof Error ? e.message : "Invalid amount." });
            onValidity(false);
        }
    }
    return <div className="mt-4 space-y-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
    <div className="flex items-center justify-between"><h3 className="font-semibold">Channel booking</h3><InfoTip label="Channel booking">Record the external booking reference and choose who collects guest payment. Selecting an OTA does not mark the booking paid or record a hotel payout.</InfoTip></div>
    <p className="text-xs text-slate-600">{terms.channelLabel} / {terms.collection.status === "pending" ? "No collection verified" : `${terms.collection.transactions.length} collection record(s), ${terms.collection.status}`}</p>{(error || Object.keys(amountErrors).length > 0) && <p role="alert" className="text-sm text-red-700">{error || Object.values(amountErrors)[0]}</p>}<fieldset disabled={!can(capabilities, "edit_channel_terms")} className="grid gap-4 sm:grid-cols-2">
    <label>External booking reference<input className={input} value={terms.externalReference} onChange={e => onChange({ ...terms, externalReference: e.target.value })}/>
    </label>
    <label>Who collects guest payment<select className={input} value={terms.collectionChoiceRequired ? "" : terms.collection.responsibility} onChange={e => onChange({ ...terms, collectionChoiceRequired: false, collection: { ...terms.collection, responsibility: e.target.value as "hotel" | "channel" } })}>
    <option value="" disabled>Choose for this reservation</option>
    <option value="hotel">Hotel collects</option>
    <option value="channel">Channel collects</option>
    </select>
    </label>
    </fieldset>
    <details className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-medium">Booking document details <InfoTip label="Booking document details">Tax basis records what the OTA document says; leave Unknown if unspecified. Collection reference is a general booking reference, separate from each verified payment document. Agreement rules are captured for this booking.</InfoTip></summary><fieldset disabled={!can(capabilities,"edit_channel_terms")} className="mt-3 grid gap-3 sm:grid-cols-2">    <label>Tax basis<select className={input} value={terms.taxBasis} onChange={e => onChange({ ...terms, taxBasis: e.target.value as ReservationChannelTerms["taxBasis"] })}>{["unknown", "inclusive", "exclusive"].map(v => <option key={v}>{v}</option>)}</select>
    </label>
    <label>Collection reference<input className={input} value={terms.collection.reference} onChange={e => onChange({ ...terms, collection: { ...terms.collection, reference: e.target.value } })}/>
    </label>
</fieldset><p className="mt-3 text-xs text-slate-500">{terms.agreement ? `Agreement v${terms.agreement.version} captured (${terms.agreement.effectiveFrom})` : "Standard pricing; no agreement captured."}</p></details>
    <p className="text-xs text-slate-600">Verification: {terms.collection.status}. Record verified collection here or in reservation details; enter amounts only after checking documentation. Selecting a channel never marks payment received.</p>
 {can(capabilities, "verify_collection") && <details className="rounded-lg border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold">Verify guest collection <InfoTip label="Verify guest collection">Check the payment evidence yourself, then record the amount and reference. This reduces the guest balance. Money collected by the channel does not establish hotel receipt of a payout. Click Add verified collection, then save the reservation.</InfoTip></summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>Verified collected amount ({terms.currency})<input className={input} value={paid} onChange={e => setPaid(e.target.value)}/>
        </label>
        <label>Payment document reference<input className={input} value={paidReference} onChange={e => setPaidReference(e.target.value)}/>
        </label>
        <label>Verification<select className={input} value={verification} onChange={e => setVerification(e.target.value as "partial" | "confirmed")}>
        <option value="partial">Partially collected</option>
        <option value="confirmed">Confirmed collected</option>
        </select>
        </label>
        <button type="button" className="self-end rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => { try {
            if (terms.collectionChoiceRequired)
                throw new Error("Choose the collector first.");
            onCollection({ id: crypto.randomUUID(), kind: "collection", collector: terms.collection.responsibility, amountMinor: parseMinor(paid, terms.currency), currency: terms.currency, reference: paidReference, verifiedBy: actor, verifiedAt: new Date() }, verification);
            setPaid("");
            setPaidReference("");
            setError("");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Invalid collection.");
        } }}>Add verified collection</button>
        </div>
        <p className="mt-3 text-xs text-slate-600">{terms.collection.transactions.length} verified transaction(s) recorded. Save the reservation to retain this entry in the session.</p>
        </details>}
 {(terms.agreement?.pricing.allowOverride || terms.accommodationOverrideMinor !== undefined) && <details open={terms.accommodationOverrideMinor !== undefined || undefined} className="rounded-lg border bg-white p-3"><summary className="cursor-pointer text-sm font-semibold">Use a channel accommodation total <span className="font-normal text-slate-500">/ optional</span> <InfoTip label="Channel accommodation total">Enter one documented total for all rooms. It replaces accommodation after hotel discounts; extras keep their own discounts. Leave blank to use HMS prices. Remove override restores normal accommodation pricing.</InfoTip></summary><fieldset disabled={!can(capabilities, "override_accommodation")} className="mt-3">
        <legend className="px-1 font-semibold text-sm">Reservation accommodation override</legend>
        <p className="text-xs text-slate-500">One total for all rooms, applied after accommodation discounts. Purchases and extras retain their discounts.</p>
        <label className="block mt-2">Confirmed accommodation ({terms.currency}; blank uses HMS pricing)<input className={input} value={override} onChange={e => { setOverride(e.target.value); amount("accommodationOverrideMinor", e.target.value); }}/>
        </label>
        <label className="block mt-2">Override reason<input className={input} value={terms.overrideReason} onChange={e => onChange({ ...terms, overrideReason: e.target.value })}/>
        </label>
        <button type="button" className="mt-2 text-sm underline" onClick={() => { setOverride(""); amount("accommodationOverrideMinor", ""); }}>Remove override</button>
        </fieldset></details>}
 {can(capabilities, "confirm_commission") && <details className="rounded-lg border bg-white p-3">
        <summary className="cursor-pointer font-semibold text-sm">Accounting calculation inputs <span className="font-normal text-slate-500">/ optional</span> <InfoTip label="Commission estimates">These fields change the commission estimate, never the guest invoice. Contract/reference or explicit commissionable amounts supply the configured basis. A booking commission override replaces the estimate; document confirmation and payouts are recorded separately in reservation details.</InfoTip></summary>
        <p className="mt-2 text-xs text-slate-500">These inputs generate estimates, not confirmed commission or payout.</p>
        <fieldset disabled={!can(capabilities, "edit_channel_terms")} className="mt-3 grid gap-3 sm:grid-cols-2">{terms.agreement?.commission.basis === "reference_value" && <label>Contract / reference selling value<input className={input} value={reference} onChange={e => { setReference(e.target.value); amount("referenceValueMinor", e.target.value); }}/>
            </label>}{terms.agreement?.commission.basis === "explicit_amount" && <label>Explicit commissionable amount<input className={input} value={basis} onChange={e => { setBasis(e.target.value); amount("commissionableMinor", e.target.value); }}/>
            </label>}{(terms.agreement?.commission.allowOverride || terms.agreement?.commission.method === "manual") && <label>Booking commission override (estimate)<input className={input} value={commission} onChange={e => { setCommission(e.target.value); amount("commissionOverrideMinor", e.target.value); }}/>
            </label>}</fieldset>
        </details>}</div>;
}
