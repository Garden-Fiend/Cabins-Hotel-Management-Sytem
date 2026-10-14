import type { InclusionInput, InclusionCaptureDto } from "./contracts";
import type { ReservationRoomSnapshot } from "../../types/reservation";

export function previousInclusionInputs(room: ReservationRoomSnapshot): InclusionInput[] {
  const quantities = new Map(Object.keys(room.inclusionOrigins ?? {}).map(id => [id, 0]));
  (room.inclusions ?? []).forEach(i => quantities.set(i.catalogId, i.quantity));
  return [...quantities].map(([product_id, quantity]) => ({ product_id, quantity,
    ...(room.inclusionOrigins?.[product_id]?.overridden ? { overridden: true } : {}) }));
}

export function inclusionIdentity(items: InclusionInput[]) {
  return JSON.stringify(items.map(i => ({ product_id: i.product_id, quantity: i.quantity, overridden: i.overridden ?? false })).sort((a,b) => a.product_id.localeCompare(b.product_id)));
}

/** Explicit reviewed retry changes only locally edited entries, retaining remote additions. */
export function mergeInclusionInputs(original: InclusionInput[], local: InclusionInput[], current: InclusionCaptureDto[]): InclusionInput[] {
  const old = new Map(original.map(i => [i.product_id, i]));
  const next = new Map(local.map(i => [i.product_id, i]));
  const result = new Map(current.map(i => [i.product_id, { product_id: i.product_id, quantity: i.quantity, overridden: i.overridden }]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (inclusionIdentity(old.has(id) ? [old.get(id)!] : []) === inclusionIdentity(next.has(id) ? [next.get(id)!] : [])) continue;
    if (next.has(id)) result.set(id, { ...next.get(id)!, overridden: next.get(id)!.overridden ?? false });
    else result.delete(id);
  }
  return [...result.values()];
}
