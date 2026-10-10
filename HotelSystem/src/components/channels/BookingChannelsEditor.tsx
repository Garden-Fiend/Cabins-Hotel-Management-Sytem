import { useState } from "react";
import { useReservationDemo } from "../../app/useReservationDemo";
import { can } from "../../app/permissions";
import type { BookingSourceConfiguration } from "../../features/configuration/types";
import type { ChannelAgreement } from "../../features/channels/types";
import { parseMinor, validateAgreement } from "../../lib/channelFinance";
import { fromMinorUnits } from "../../lib/money";
import { hotelDateKey } from "../../lib/hotelTime";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold";
export function BookingChannelsEditor() {
    const { configuration, setConfiguration, capabilities } = useReservationDemo();
    const [channel, setChannel] = useState<BookingSourceConfiguration>();
    const [agreement, setAgreement] = useState<ChannelAgreement>();
    const [notice, setNotice] = useState("");
    const [fixed, setFixed] = useState("0");
    const [rate, setRate] = useState("0");
    const editable = can(capabilities, "manage_channels");
    function saveChannel() {
        try {
            if (!editable || !channel)
                throw new Error("Channel management permission is required.");
            if (!channel.label.trim())
                throw new Error("Channel name is required.");
            if (configuration.bookingSources.some(c => c.id !== channel.id && c.label.toLowerCase() === channel.label.trim().toLowerCase()))
                throw new Error("Channel names must be unique.");
            setConfiguration(current => ({ ...current, bookingSources: [...current.bookingSources.filter(c => c.id !== channel.id), { ...channel, label: channel.label.trim() }] }));
            setNotice("Channel saved in this demo session.");
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : "Unable to save channel.");
        }
    }
    function newVersion(source: BookingSourceConfiguration) {
        const versions = configuration.channelAgreements?.filter(a => a.channelId === source.id) ?? [];
        const previous = [...versions].sort((a, b) => b.version - a.version)[0];
        const version = Math.max(0, ...versions.map(a => a.version)) + 1;
        const next: ChannelAgreement = { id: crypto.randomUUID(), channelId: source.id, version, effectiveFrom: hotelDateKey(new Date()), status: "draft", currency: configuration.currency, pricing: { allowOverride: false, reasonRequired: true }, commission: { method: "none", basis: "confirmed_accommodation", rateBasisPoints: 0, fixedMinor: 0, allowOverride: false }, payment: { collection: "hotel" }, settlement: { method: "manual" }, ...(previous ? { ...structuredClone(previous), id: crypto.randomUUID(), version, status: "draft", effectiveFrom: hotelDateKey(new Date()), effectiveTo: undefined } : {}) };
        setChannel(source);
        setAgreement(next);
        setFixed(String(fromMinorUnits(next.commission.fixedMinor, next.currency)));
        setRate(String(next.commission.rateBasisPoints / 100));
        setNotice("");
    }
    function saveAgreement() {
        try {
            if (!editable || !agreement)
                throw new Error("Channel management permission is required.");
            const next = { ...agreement, commission: { ...agreement.commission, fixedMinor: parseMinor(fixed, agreement.currency), rateBasisPoints: parseMinor(rate, "PHP") } };
            validateAgreement(next, configuration.channelAgreements ?? []);
            setConfiguration(current => ({ ...current, channelAgreements: [...(current.channelAgreements ?? []).filter(a => a.id !== next.id), next] }));
            setAgreement(undefined);
            setNotice("Agreement saved. Captured reservation versions are unchanged.");
        }
        catch (e) {
            setNotice(e instanceof Error ? e.message : "Unable to save agreement.");
        }
    }
    return <div className="space-y-5">
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex justify-between">
    <h2 className="text-lg font-semibold">Booking channels</h2>{editable && <button className={button} onClick={() => { setChannel({ id: crypto.randomUUID(), label: "", enabled: true, classification: "other", referenceRequired: false, notes: "" }); setAgreement(undefined); }}>Add channel</button>}</div>
    <p className="mt-2 text-sm text-slate-600">Manual channel terms; all data resets on reload. Classification does not imply prepaid collection or commission.</p>{notice && <p role="status" className="my-3 text-sm text-blue-900">{notice}</p>}<ul className="mt-4 divide-y">{configuration.bookingSources.map(source => <li key={source.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
        <p className="font-semibold">{source.label} <span className="text-xs text-slate-500">{source.enabled ? "Enabled" : "Disabled"} / {source.classification ?? "direct"}</span>
        </p>
        <p className="text-xs text-slate-500">{source.notes}</p>
        </div>
        <div className="flex gap-2">
        <button className={button} onClick={() => { setChannel({ ...source }); setAgreement(undefined); }}>Details / history</button>{editable && <button className={button} onClick={() => newVersion(source)}>New agreement version</button>}</div>
        </li>)}</ul>
    </section>
 {channel && <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Channel identity</h2>
        <p className="mt-1 text-xs text-slate-500">Stable ID: {channel.id}</p>
        <fieldset disabled={!editable} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label>Name<input className={input} value={channel.label} onChange={e => setChannel({ ...channel, label: e.target.value })}/>
        </label>
        <label>Classification<select className={input} value={channel.classification ?? "direct"} onChange={e => setChannel({ ...channel, classification: e.target.value as BookingSourceConfiguration["classification"] })}>{["direct", "ota", "corporate", "agent", "other"].map(v => <option key={v}>{v}</option>)}</select>
        </label>
        <label>
        <input type="checkbox" checked={channel.enabled} onChange={e => setChannel({ ...channel, enabled: e.target.checked })}/> Enabled</label>
        <label>
        <input type="checkbox" checked={channel.referenceRequired ?? false} onChange={e => setChannel({ ...channel, referenceRequired: e.target.checked })}/> External reference required</label>
        <label className="sm:col-span-2">Internal notes<textarea className={input} value={channel.notes ?? ""} onChange={e => setChannel({ ...channel, notes: e.target.value })}/>
        </label>
        <button className={button} onClick={saveChannel}>Save channel</button>
        </fieldset>
        <h3 className="mt-6 font-semibold">Agreement history</h3>{(configuration.channelAgreements ?? []).filter(a => a.channelId === channel.id).sort((a, b) => b.version - a.version).map(a => <div key={a.id} className="mt-3 rounded-lg border p-3 text-sm">
            <p>Version {a.version} / {a.status} / {a.effectiveFrom} to {a.effectiveTo ?? "open"} / {a.currency}</p>
            <p>Commission: {a.commission.method}, {a.commission.basis.replaceAll("_", " ")}; collection: {a.payment.collection.replaceAll("_", " ")}; settlement: {a.settlement.method.replaceAll("_", " ")}</p>{editable && <button className={button} onClick={() => { setAgreement(structuredClone(a)); setFixed(String(fromMinorUnits(a.commission.fixedMinor, a.currency))); setRate(String(a.commission.rateBasisPoints / 100)); }}>Edit dates / status{a.status === "draft" ? " / rules" : ""}</button>}</div>)}</section>}
 {agreement && <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Agreement version {agreement.version}</h2>
        <p className="mt-2 text-sm text-slate-600">Rules of published versions are frozen. Create a new version for rule changes. End the previous active range before activating another.</p>
        <fieldset disabled={!editable} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label>Effective from<input type="date" className={input} value={agreement.effectiveFrom} onChange={e => setAgreement({ ...agreement, effectiveFrom: e.target.value })}/>
        </label>
        <label>Effective through (inclusive)<input type="date" className={input} value={agreement.effectiveTo ?? ""} onChange={e => setAgreement({ ...agreement, effectiveTo: e.target.value || undefined })}/>
        </label>
        <label>Status<select className={input} value={agreement.status} onChange={e => setAgreement({ ...agreement, status: e.target.value as ChannelAgreement["status"] })}>{["draft", "active", "retired"].map(v => <option key={v}>{v}</option>)}</select>
        </label>
        <label>Currency<input disabled={configuration.channelAgreements?.some(a => a.id === agreement.id && a.status !== "draft")} className={input} value={agreement.currency} onChange={e => setAgreement({ ...agreement, currency: e.target.value.toUpperCase() })}/>
        </label>
        </fieldset>
 <fieldset disabled={!editable || configuration.channelAgreements?.some(a => a.id === agreement.id && a.status !== "draft")} className="mt-4 space-y-4">
        <div className="rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold">Accommodation pricing</h3>
        <label className="block mt-2">
        <input type="checkbox" checked={agreement.pricing.allowOverride} onChange={e => setAgreement({ ...agreement, pricing: { ...agreement.pricing, allowOverride: e.target.checked } })}/> Allow reservation accommodation override</label>
        <label className="block mt-2">
        <input type="checkbox" checked={agreement.pricing.reasonRequired} onChange={e => setAgreement({ ...agreement, pricing: { ...agreement.pricing, reasonRequired: e.target.checked } })}/> Require override reason</label>
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
        <h3 className="font-semibold">Commission</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>Method<select className={input} value={agreement.commission.method} onChange={e => setAgreement({ ...agreement, commission: { ...agreement.commission, method: e.target.value as ChannelAgreement["commission"]["method"] } })}>{["none", "percentage", "fixed", "manual"].map(v => <option key={v}>{v}</option>)}</select>
        </label>
        <label>Basis<select className={input} value={agreement.commission.basis} onChange={e => setAgreement({ ...agreement, commission: { ...agreement.commission, basis: e.target.value as ChannelAgreement["commission"]["basis"] } })}>{["confirmed_accommodation", "reference_value", "explicit_amount"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select>
        </label>
        <label>Rate (%)<input className={input} value={rate} onChange={e => setRate(e.target.value)}/>
        </label>
        <label>Fixed amount<input className={input} value={fixed} onChange={e => setFixed(e.target.value)}/>
        </label>
        <label>
        <input type="checkbox" checked={agreement.commission.allowOverride} onChange={e => setAgreement({ ...agreement, commission: { ...agreement.commission, allowOverride: e.target.checked } })}/> Allow booking commission override</label>
        </div>
        </div>
        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <label>Collection default<select className={input} value={agreement.payment.collection} onChange={e => setAgreement({ ...agreement, payment: { collection: e.target.value as ChannelAgreement["payment"]["collection"] } })}>{["hotel", "channel", "per_reservation"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select>
        </label>
        <label>Settlement default<select className={input} value={agreement.settlement.method} onChange={e => setAgreement({ ...agreement, settlement: { method: e.target.value as ChannelAgreement["settlement"]["method"] } })}>{["deducted", "separate_invoice", "offset", "manual"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</select>
        </label>
        </div>
        </fieldset>
        <div className="mt-4 flex gap-3">
        <button disabled={!editable} className={button} onClick={saveAgreement}>Save agreement</button>
        <button className={button} onClick={() => setAgreement(undefined)}>Cancel</button>
        </div>
        </section>}</div>;
}
