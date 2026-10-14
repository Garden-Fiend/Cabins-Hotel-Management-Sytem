import type { ReservationBreakfastSnapshot } from "../../types/reservation";
import type { BreakfastInput, BreakfastCaptureDto } from "./contracts";

export function breakfastInputs(items: ReservationBreakfastSnapshot[]): BreakfastInput[] {
  return items.map(i => ({ service_date: i.stayDate, guest_number: i.guestNumber, status: i.status,
    ...(i.status === "included" ? { meal_id: i.mealId ?? "", beverage_id: i.beverageId ?? "" } : {}) }));
}
export function breakfastIdentity(items: BreakfastInput[]) {
  return JSON.stringify(items.map(i => ({ service_date: i.service_date, guest_number: i.guest_number, status: i.status,
    ...(i.status === "included" ? { meal_id: i.meal_id, beverage_id: i.beverage_id } : {}) })).sort((a,b) => `${a.service_date}:${a.guest_number}`.localeCompare(`${b.service_date}:${b.guest_number}`)));
}
export function mergeBreakfastInputs(old: BreakfastInput[], local: BreakfastInput[], current: BreakfastCaptureDto[]): BreakfastInput[] {
  const slot = (i: BreakfastInput) => `${i.service_date}:${i.guest_number}`;
  const before = new Map(old.map(i => [slot(i), i])), next = new Map(local.map(i => [slot(i), i]));
  const result = new Map(current.map(i => [slot(i), { service_date: i.service_date, guest_number: i.guest_number, status: i.status,
    ...(i.status === "included" ? { meal_id: i.meal_id, beverage_id: i.beverage_id } : {}) }]));
  for(const id of new Set([...before.keys(), ...next.keys()])) {
    if(breakfastIdentity(before.has(id) ? [before.get(id)!] : []) === breakfastIdentity(next.has(id) ? [next.get(id)!] : [])) continue;
    if(next.has(id)) result.set(id, next.get(id)!); else result.delete(id);
  }
  return [...result.values()];
}
