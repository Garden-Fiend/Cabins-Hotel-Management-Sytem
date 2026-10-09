import { useState } from "react";
import type { DiscountDefinitionConfiguration } from "./types";
import { useHotelConfiguration } from "../configuration/useHotelConfiguration";
import { isChargeableItem, validateDiscountPreset } from "../../lib/discountPresets";
import { roundMoney } from "../../lib/money";

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const buttonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold";
const panelClass = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

export function DiscountPresetsEditor() {
  const { configuration, setConfiguration } = useHotelConfiguration();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<DiscountDefinitionConfiguration | null>(null);
  const [value, setValue] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: configuration.currency }).format(amount);
  const roomTypes = configuration.roomTypes.filter((item) => item.enabled && !item.archived);
  const items = configuration.catalogItems.filter(isChargeableItem);
  const rates = configuration.roomTypePrices.filter((rate) => rate.enabled && rate.roomTypeId === draft?.targetRoomTypeId && rate.currency === configuration.currency && (rate.bookingType === "overnight" || configuration.durations.some((item) => item.enabled && item.id === rate.durationId && item.bookingType === "hourly")));

  function open(preset?: DiscountDefinitionConfiguration) {
    setDraft(preset ? { ...preset } : {
      id: crypto.randomUUID(), label: "", scope: "room", method: "final_price", value: 0,
      enabled: true, currency: configuration.currency,
      targetRoomTypeId: roomTypes[0]?.id, targetItemId: items[0]?.id,
    });
    setValue(preset ? String(preset.method === "final_price" ? preset.discountedUnitPrice ?? "" : preset.value) : "");
    setPrices(Object.fromEntries((preset?.rates ?? []).map((rate) => [rate.rateId, String(rate.discountedUnitPrice)])));
    setNotice("");
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const next: DiscountDefinitionConfiguration = {
      ...draft, label: draft.label.trim(), currency: configuration.currency,
      targetRoomTypeId: draft.scope === "room" ? draft.targetRoomTypeId : undefined,
      targetItemId: draft.scope === "item" ? draft.targetItemId : undefined,
      value: draft.method === "final_price" ? 0 : Number(value),
      discountedUnitPrice: draft.scope === "item" && draft.method === "final_price" && value.trim() !== "" ? Number(value) : undefined,
      rates: draft.scope === "room" && draft.method === "final_price"
        ? Object.entries(prices).filter(([, price]) => price.trim() !== "").map(([rateId, price]) => ({ rateId, discountedUnitPrice: Number(price) })) : undefined,
    };
    const errors = validateDiscountPreset(next, configuration);
    if (errors.length) { setNotice(errors.join(" ")); return; }
    next.value = next.method === "fixed" ? roundMoney(next.value, configuration.currency) : next.value;
    next.rates = next.rates?.map((rate) => ({ ...rate, discountedUnitPrice: roundMoney(rate.discountedUnitPrice, configuration.currency) }));
    if (next.discountedUnitPrice !== undefined) next.discountedUnitPrice = roundMoney(next.discountedUnitPrice, configuration.currency);
    setConfiguration((current) => ({ ...current, discounts: current.discounts.some((item) => item.id === next.id) ? current.discounts.map((item) => item.id === next.id ? next : item) : [...current.discounts, next] }));
    setDraft(null); setNotice("Discount preset saved for this session.");
  }

  return <div className="space-y-5">
    <section className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Discount Presets</h2>
        <button type="button" className={buttonClass} onClick={() => open()}>Create Discount</button>
      </div>
      <p className="mt-2 text-sm text-slate-600">Presets are selected by staff. They never apply automatically.</p>
      {notice && <p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}
      <label className="mt-4 block text-sm">Search discounts
        <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-sm">
        <thead><tr>{["Name", "Scope", "Method", "Status", "Actions"].map((label) => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead>
        <tbody>{configuration.discounts.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).map((preset) => <tr key={preset.id} className="border-t border-slate-200">
          <td className="px-2 py-3">{preset.label}</td><td className="px-2 capitalize">{preset.scope}</td>
          <td className="px-2">{preset.method === "final_price" ? "Final Price" : preset.method === "fixed" ? "Fixed Amount" : "Percentage"}</td>
          <td className="px-2">{preset.enabled ? "Enabled" : "Disabled"}</td>
          <td className="flex gap-2 px-2 py-3">
            <button type="button" className="underline" onClick={() => open(preset)}>Edit</button>
            <button type="button" className="underline" onClick={() => {
              if (!preset.enabled) {
                const errors = validateDiscountPreset(preset, configuration);
                if (errors.length) { setNotice(errors.join(" ")); return; }
              }
              setConfiguration((current) => ({ ...current, discounts: current.discounts.map((item) => item.id === preset.id ? { ...item, enabled: !item.enabled } : item) }));
              setNotice(`${preset.label} ${preset.enabled ? "disabled" : "enabled"}. Saved reservations are unchanged.`);
            }}>{preset.enabled ? "Disable" : "Enable"}</button>
            <button type="button" className="text-rose-700 underline" onClick={() => {
              setConfiguration((current) => ({ ...current, discounts: current.discounts.filter((item) => item.id !== preset.id) }));
              if (draft?.id === preset.id) setDraft(null);
              setNotice(`${preset.label} deleted. Saved reservations retain their snapshots.`);
            }}>Delete</button>
          </td>
        </tr>)}</tbody>
      </table></div>
    </section>
    {draft && <section className={panelClass}>
      <h3 className="font-semibold">{configuration.discounts.some((item) => item.id === draft.id) ? "Edit Discount" : "Create Discount"}</h3>
      <form className="mt-4 space-y-4" onSubmit={save} noValidate>
        <label className="block text-sm">Discount Name<input className={inputClass} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label className="block text-sm">Apply To<select className={inputClass} value={draft.scope} onChange={(event) => {
          const scope = event.target.value as DiscountDefinitionConfiguration["scope"];
          setDraft({ ...draft, scope, method: scope === "reservation" && draft.method === "final_price" ? "percentage" : draft.method });
          setValue(""); setPrices({});
        }}><option value="room">Room</option><option value="item">Item</option><option value="reservation">Reservation</option></select></label>
        {draft.scope === "room" && <label className="block text-sm">Room Type<select className={inputClass} value={draft.targetRoomTypeId ?? ""} onChange={(event) => { setDraft({ ...draft, targetRoomTypeId: event.target.value }); setPrices({}); }}>
          <option value="">Select room type</option>{roomTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>}
        {draft.scope === "item" && <label className="block text-sm">Applicable Item<select className={inputClass} value={draft.targetItemId ?? ""} onChange={(event) => { setDraft({ ...draft, targetItemId: event.target.value }); setValue(""); }}>
          <option value="">Select chargeable item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>}
        <label className="block text-sm">Discount Method<select className={inputClass} value={draft.method} onChange={(event) => { setDraft({ ...draft, method: event.target.value as DiscountDefinitionConfiguration["method"] }); setValue(""); }}>
          {draft.scope !== "reservation" && <option value="final_price">Set Discounted Price</option>}<option value="fixed">Fixed Amount</option><option value="percentage">Percentage</option>
        </select></label>
        {draft.method === "final_price" && draft.scope === "room" ? <div className="space-y-3">
          <p className="text-sm text-slate-600">Leave rates blank to exclude them. Nightly prices apply per night.</p>
          {rates.map((rate) => {
            const label = rate.bookingType === "overnight" ? "Nightly" : configuration.durations.find((item) => item.id === rate.durationId)?.label ?? rate.durationId;
            return <label key={rate.id} className="block text-sm">{label} discounted price <span className="text-slate-500">(base {money(rate.amount)})</span>
              <input aria-label={`${label} discounted price`} type="number" min="0" step="any" className={inputClass} value={prices[rate.id] ?? ""} onChange={(event) => setPrices({ ...prices, [rate.id]: event.target.value })} />
            </label>;
          })}
          {!rates.length && <p className="text-sm text-amber-800">No active rates in the hotel currency. Configure room prices first.</p>}
          {Object.keys(prices).some((id) => !rates.some((rate) => rate.id === id) && prices[id] !== "") && <p role="alert">Some saved rates are unavailable. Select a room type again to clear them before saving.</p>}
        </div> : <label className="block text-sm">{draft.method === "final_price" ? "Discounted Unit Price" : "Value"}
          {draft.scope === "item" && draft.method === "final_price" && <span className="ml-2 text-slate-500">Current unit price: {money(items.find((item) => item.id === draft.targetItemId)?.price ?? 0)}</span>}
          <input aria-label={draft.method === "final_price" ? "Discounted Unit Price" : "Value"} type="number" min="0" step="any" className={inputClass} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label>
        <div className="flex gap-2"><button className={`${buttonClass} bg-slate-900 text-white`} type="submit">Save Discount</button><button className={buttonClass} type="button" onClick={() => setDraft(null)}>Cancel</button></div>
      </form>
    </section>}
  </div>;
}
