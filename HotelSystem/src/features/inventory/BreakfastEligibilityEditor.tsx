import { useState } from "react";
import { useHotelConfiguration } from "../configuration/useHotelConfiguration";
import { isActiveProduct } from "../../lib/inventoryProducts";
import { useReservationDemo } from "../../app/useReservationDemo";

export function BreakfastEligibilityEditor() {
  const { configuration, setConfiguration } = useHotelConfiguration();
  const { mode, commands } = useReservationDemo();
  const persistent = mode === "api";
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(configuration.breakfastEligibleItems ?? []);
  const [base, setBase] = useState(configuration.breakfastEligibleItems ?? []);
  const [version, setVersion] = useState(configuration.breakfastVersion);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (persistent) {
      if (!commands?.saveBreakfast || !version) { setNotice("Breakfast persistence is unavailable; your draft is retained."); return; }
      setSaving(true);
      try { await commands.saveBreakfast(draft, version); setVersion(version+1); setBase(draft); setNotice("Breakfast configuration committed to PostgreSQL."); }
      catch(error) { setNotice(error instanceof Error ? error.message : "Save not confirmed. Draft retained."); }
      finally { setSaving(false); }
    } else { setConfiguration(current => ({ ...current, breakfastEligibleItems: draft })); setNotice("Breakfast configuration saved for this session."); }
  }
  async function review() {
    if (!commands?.loadBreakfast) return;
    setSaving(true);
    try {
      const latest = await commands.loadBreakfast();
      const old = new Map(base.map(i=>[i.inventoryItemId,i])), local=new Map(draft.map(i=>[i.inventoryItemId,i])), merged=new Map(latest.items.map(i=>[i.inventoryItemId,i]));
      for(const id of new Set([...old.keys(),...local.keys()])) {
        if(JSON.stringify(old.get(id))===JSON.stringify(local.get(id))) continue;
        if(local.has(id)) merged.set(id,local.get(id)!); else merged.delete(id);
      }
      setBase(latest.items); setDraft([...merged.values()]); setVersion(latest.version);
      setNotice("Latest configuration loaded for review. Your local edits and untouched remote choices are retained; Save to apply.");
    } catch(error) { setNotice(error instanceof Error ? error.message : "Unable to review latest configuration."); }
    finally { setSaving(false); }
  }
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="font-semibold text-slate-900">Breakfast Configuration: Eligible Items</h3>
    <p className="text-sm text-slate-500">Nightly stays receive one meal and one beverage per guest per existing breakfast service date. Product selling prices remain unchanged.</p>
    <fieldset disabled={saving || (persistent && (commands?.busy || !commands?.canEditBreakfast))} className="space-y-3">{configuration.catalogItems.filter((item) => item.category === "ordinary" || draft.some((entry) => entry.inventoryItemId === item.id)).map((product) => {
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
    })}</fieldset>
    <button type="button" disabled={saving || (persistent && (commands?.busy || !commands?.canEditBreakfast))} onClick={() => void save()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Save breakfast configuration</button>
    {persistent && notice && <button type="button" disabled={saving} onClick={() => void review()} className="ml-3 underline">Load latest breakfast configuration for review</button>}
    {notice && <p role="status" className="text-sm text-slate-600">{notice}</p>}
  </section>;
}
