import { useState } from "react";
import { useHotelConfiguration } from "../configuration/useHotelConfiguration";
import { isActiveProduct } from "../../lib/inventoryProducts";

export function BreakfastEligibilityEditor() {
  const { configuration, setConfiguration } = useHotelConfiguration();
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(configuration.breakfastEligibleItems ?? []);
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="font-semibold text-slate-900">Breakfast Configuration: Eligible Items</h3>
    <p className="text-sm text-slate-500">Nightly stays receive one meal and one beverage per guest per existing breakfast service date. Product selling prices remain unchanged.</p>
    <div className="space-y-3">{configuration.catalogItems.filter((item) => item.category === "ordinary" || draft.some((entry) => entry.inventoryItemId === item.id)).map((product) => {
      const entry = draft.find((item) => item.inventoryItemId === product.id);
      const active = isActiveProduct(configuration, product.id);
      return <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Breakfast eligible: ${product.label}`} checked={entry?.enabled ?? false} disabled={!active && !entry?.enabled} onChange={(event) => {
          setDraft((current) => [...current.filter((item) => item.inventoryItemId !== product.id), { inventoryItemId: product.id, kind: entry?.kind ?? "meal", enabled: event.target.checked }]); setNotice("");
        }} /><span>{product.label}<span className="block text-xs text-slate-500">{product.id}{!active ? " (inactive)" : ""}</span></span></label>
        <select aria-label={`Breakfast kind: ${product.label}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={entry?.kind ?? "meal"} onChange={(event) => {
          const kind = event.target.value as "meal" | "beverage";
          setDraft((current) => [...current.filter((item) => item.inventoryItemId !== product.id), { inventoryItemId: product.id, enabled: entry?.enabled ?? false, kind }]); setNotice("");
        }}><option value="meal">Meal</option><option value="beverage">Beverage</option></select>
      </div>;
    })}</div>
    <button type="button" onClick={() => { setConfiguration((current) => ({ ...current, breakfastEligibleItems: draft })); setNotice("Breakfast configuration saved for this session."); }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save breakfast configuration</button>
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
  </section>;
}
