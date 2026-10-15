import type { HotelConfigurationData } from "../../features/configuration/types";
import type { ReservationDiscount, ReservationPriceLine, ReservationPriceSummary } from "../../types/reservation";
import { getApplicablePresets } from "../../lib/discountPresets";

export function LineDiscountSelector({ configuration, line, discounts, summary, onSelect }: {
  configuration: HotelConfigurationData; line: ReservationPriceLine;
  discounts: ReservationDiscount[]; summary: ReservationPriceSummary;
  onSelect: (line: ReservationPriceLine, presetId: string) => void;
}) {
  const scope = line.kind === "room" ? "room" : "item";
  const label = scope === "room" ? `Room ${line.roomNumber} discount` : `${line.label} discount`;
  const current = discounts.find((item) => item.sourcePresetId && item.targetId === line.id);
  const options = getApplicablePresets(configuration, scope, line);
  const historical = current && !options.some((item) => item.id === current.sourcePresetId);
  const reduction = [...(summary.priceOverrides ?? []),...summary.discounts].filter((item) => item.sourcePresetId && item.targetId === line.id).reduce((sum, item) => sum + item.amount, 0);
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: line.currency ?? configuration.currency }).format(amount);
  return <div className="w-full space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
    <label className="block font-medium">{label}
      <select className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" value={current?.sourcePresetId ?? ""} onChange={(event) => onSelect(line, event.target.value)}>
        <option value="">None</option>
        {historical && <option value={current.sourcePresetId} disabled>{current.label} (saved historical preset)</option>}
        {options.map((preset) => <option key={preset.id} value={preset.id}>{current?.sourcePresetId === preset.id ? current.label : preset.label}</option>)}
      </select>
    </label>
    {!options.length && <p className="text-xs text-slate-500">No matching presets for this price.</p>}
    <p>Base {scope === "room" ? "accommodation" : "item total"}: {money(line.amount)}</p>
    <p>{current?.method === "final_price" && summary.priceOverrides ? "Unit-price replacement effect" : "Preset reduction"}: −{money(reduction)}</p>
    <p className="font-medium">After preset: {money(Math.max(0, line.amount - reduction))}</p>
    {current && <p className="text-xs text-slate-500">Applied values are captured and read-only. Use a manual discount for exceptions.</p>}
  </div>;
}
