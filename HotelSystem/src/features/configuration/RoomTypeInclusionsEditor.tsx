import type { HotelConfigurationData, RoomTypeConfiguration } from "./types";

export function RoomTypeInclusionsEditor({ configuration, value, onChange }: {
  configuration: HotelConfigurationData;
  value: NonNullable<RoomTypeConfiguration["defaultInclusions"]>;
  onChange: (items: NonNullable<RoomTypeConfiguration["defaultInclusions"]>) => void;
}) {
  const products = configuration.catalogItems.filter((item) => item.category === "inclusion" && ((item.enabled && !item.archived) || value.some((entry) => entry.catalogId === item.id)));
  return <fieldset className="border-t border-slate-200 pt-4">
    <legend className="text-sm font-semibold">Default inclusions</legend>
    <p className="mt-3 text-sm text-slate-500">Applied to new assignments. Saved reservations keep their own quantities.</p>
    <div className="mt-4 space-y-3">{value.map((entry) => <div key={entry.catalogId} className="flex flex-wrap items-center gap-3">
      <span className="min-w-32 flex-1 text-sm">{configuration.catalogItems.find((item) => item.id === entry.catalogId)?.label ?? "Retired inclusion"}</span>
      <input type="number" min="1" step="1" aria-label={`Default ${configuration.catalogItems.find((item) => item.id === entry.catalogId)?.label ?? entry.catalogId} quantity`} className="w-20 rounded-lg border border-slate-300 p-2" value={entry.quantity} onChange={(event) => onChange(value.map((item) => item.catalogId === entry.catalogId ? { ...item, quantity: Number(event.target.value) } : item))} />
      <button type="button" className="text-sm underline" onClick={() => onChange(value.filter((item) => item.catalogId !== entry.catalogId))}>Remove default {configuration.catalogItems.find((item) => item.id === entry.catalogId)?.label ?? "inclusion"}</button>
    </div>)}</div>
    <select aria-label="Add default inclusion" value="" className="mt-4 w-full rounded-lg border border-slate-300 p-2 text-sm" onChange={(event) => { if (event.target.value && !value.some((item) => item.catalogId === event.target.value)) onChange([...value, { catalogId: event.target.value, quantity: 1 }]); }}><option value="">Add inclusion</option>{products.filter((item) => item.enabled && !item.archived && !value.some((entry) => entry.catalogId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
  </fieldset>;
}
