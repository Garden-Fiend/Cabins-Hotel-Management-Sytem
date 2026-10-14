import type { ReservationDiscount } from "../../types/reservation";
import type { ManualDiscountInput, ReservationDto } from "./contracts";

/** Original room-number UI targets map to canonical room UUIDs only at the API boundary. */
export function manualDiscountInputs(items: ReservationDiscount[], roomId: string, canonical?: ReservationDto): ManualDiscountInput[] {
  return items.map(item => {
    if (!["fixed", "percentage"].includes(item.method)) throw new Error("Final-price overrides are not supported by this server.");
    if (!Number.isFinite(item.value) || item.value <= 0 || (item.method === "percentage" && item.value > 100)) throw new Error("Enter a valid positive manual discount.");
    const old = canonical?.pricing.snapshot.discounts?.find(d => d.id === item.id);
    return { id: item.id, label: item.label, scope: item.scope, method: item.method as "fixed" | "percentage", ...(item.sourcePresetId ? {preset_id:item.sourcePresetId} : {}),
      value: old && Number(old.value) === item.value && old.method === item.method ? old.value : String(item.value),
      target_id: item.scope === "reservation" ? "" : item.scope === "room" ? roomId : item.targetId, currency: "PHP" };
  });
}

/** After an explicit version review, preserve remote additions and locally untouched entries. */
export function mergeManualDiscountInputs(original: ReservationDiscount[], draft: ReservationDiscount[], roomId: string, canonical: ReservationDto): ManualDiscountInput[] {
  const identity = (d: ReservationDiscount) => JSON.stringify([d.label, d.scope, d.method, d.value, d.targetId, d.sourcePresetId]);
  const previous = new Map(original.map(d => [d.id, d]));
  const next = new Map(draft.map(d => [d.id, d]));
  const local = manualDiscountInputs(draft, roomId, canonical);
  const changed = new Map(local.filter(d => !previous.has(d.id) || identity(next.get(d.id)!) !== identity(previous.get(d.id)!)).map(d => [d.id, d]));
  const result: ManualDiscountInput[] = (canonical.pricing.snapshot.discounts ?? []).filter(d => !previous.has(d.id) || next.has(d.id)).map(d => changed.get(d.id) ?? ({ id: d.id, label: d.label, scope: d.scope, method: d.method, value: d.value, target_id: d.target_id, currency: d.currency, ...(d.preset_id ? {preset_id:d.preset_id} : {}) }));
  for (const d of local) if (changed.has(d.id) && !result.some(item => item.id === d.id)) result.push(d);
  return result;
}
