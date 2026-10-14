import type { ReservationDemoContextValue } from "../reservationDemoStore";
import type { ReservationSnapshot } from "../../types/reservation";
import type { BillingEditInput, DetailsEditInput, PatchInput, ReferencesDto, ReservationDto, StayEditInput, ChargesEditInput, StayChargesEditInput, ChargeInput, DiscountsEditInput } from "./contracts";
import { mergeManualDiscountInputs } from "./discountInputs";
import { toMinorUnits } from "../../lib/money";
import { inclusionIdentity, mergeInclusionInputs, previousInclusionInputs } from "./inclusionInputs";
import type { InclusionsEditInput } from "./contracts";
import type { BreakfastEditInput } from "./contracts";
import { breakfastInputs, breakfastIdentity, mergeBreakfastInputs } from "./breakfastInputs";

type EditDraft = Parameters<NonNullable<ReservationDemoContextValue["commands"]>["patch"]>[1];
export type ReservationEditInput = BreakfastEditInput | InclusionsEditInput | DiscountsEditInput | PatchInput | DetailsEditInput | StayEditInput | BillingEditInput | ChargesEditInput | StayChargesEditInput;

/** Send only changed fields; after explicit conflict review preserve untouched server facts. */
export function reservationEditInput(original: ReservationSnapshot, input: EditDraft,
  canonical: ReservationDto | undefined, references: ReferencesDto, version: number): ReservationEditInput | undefined {
  if (!Number.isInteger(version) || version < 1) throw new Error("Reload the reservation version before editing.");
  const previous = original.rooms[0];
  const body: PatchInput & { guest_id?: string } = { expected_version: version };
  if (input.guestId && input.guestId !== original.guestId) {
    if (!references.capabilities?.includes("reservation.guest-edit.v1")) throw new Error("Guest changes are not supported by this server.");
    body.guest_id = input.guestId;
  }
  if (input.note !== original.note) body.note = input.note;
  if (input.adults !== previous.adults) body.adults = input.adults;
  if (input.children !== previous.children) body.children = input.children;
  const changedRoom = input.roomNumber !== undefined && input.roomNumber !== previous.roomNumber;
  const changedDuration = input.durationId !== undefined && input.durationId !== previous.durationId;
  const changedStart = input.start !== undefined && input.start.getTime() !== previous.checkIn.getTime();
  const changedStay = changedRoom || changedDuration || changedStart;
  const oldBreakfast = breakfastInputs(previous.breakfast ?? []);
  const breakfastBody = input.breakfast !== undefined ? breakfastInputs(input.breakfast) : undefined;
  const changedBreakfast = breakfastBody !== undefined && breakfastIdentity(breakfastBody) !== breakfastIdentity(oldBreakfast);
  const oldInclusions = previousInclusionInputs(previous);
  const inclusionBody = input.inclusions?.map(i => ({ product_id: i.catalogId, quantity: i.quantity, ...(i.overridden ? { overridden: true } : {}) }));
  const changedInclusions = inclusionBody !== undefined && inclusionIdentity(inclusionBody) !== inclusionIdentity(oldInclusions);
  const changedDiscounts = input.discounts !== undefined && JSON.stringify(input.discounts) !== JSON.stringify(original.discounts);
  const changedAdjustments = input.adjustments !== undefined && JSON.stringify(input.adjustments) !== JSON.stringify(original.adjustments);
  const chargeIdentity = (items: NonNullable<EditDraft["charges"]>) => items.map(item => ({ id: item.id, product_id: item.catalogId, quantity: item.quantity, usage: item.usage }));
  const changedCharges = input.charges !== undefined && JSON.stringify(chargeIdentity(input.charges)) !== JSON.stringify(chargeIdentity(previous.charges ?? []));
  if (!changedStay && !changedBreakfast && !changedInclusions && !changedAdjustments && !changedCharges && !changedDiscounts && Object.keys(body).length === 1) return;
  if (!changedStay && !changedBreakfast && !changedInclusions && !changedAdjustments && !changedCharges && !changedDiscounts) return body;
  if (!canonical || canonical.id !== original.id) throw new Error("Reload canonical reservation data before editing.");
  const adjustmentBody = input.adjustments?.map(item => {
    const originalItem = original.adjustments.find(old => old.id === item.id);
    const canonicalItem = canonical.pricing.snapshot.adjustments?.find(old => old.id === item.id);
    return { id: item.id, amount_minor: originalItem?.amount === item.amount && canonicalItem ? canonicalItem.amount_minor : toMinorUnits(item.amount, "PHP"), reason: item.reason };
  });
  if (changedAdjustments && !references.capabilities?.includes("reservation.adjustments.v1")) throw new Error("Adjustment changes are not supported by this server.");
  let charges: ChargeInput[] | undefined;
  if (changedCharges) {
    if (!references.capabilities?.includes("reservation.purchases.v1")) throw new Error("Purchases are not supported by this server.");
    charges = input.charges!.map(item => {
      if (item.usage !== "purchase" && item.usage !== "extra_charge") throw new Error("Select a supported bill-line classification.");
      if (item.usage === "extra_charge" && !references.capabilities?.includes("reservation.extra-charges.v1")) throw new Error("Extra charges are not supported by this server.");
      return { id: item.id, product_id: item.catalogId, quantity: item.quantity, usage: item.usage };
    });
  }
  if (changedDiscounts && !references.capabilities?.includes("reservation.manual-discounts.v1")) throw new Error("Manual discounts are not supported by this server.");
  const discountBody = changedDiscounts ? mergeManualDiscountInputs(original.discounts ?? [], input.discounts!, changedRoom ? references.rooms.find(r => r.number === input.roomNumber)?.id ?? canonical.allocation.room_id : canonical.allocation.room_id, canonical) : undefined;
  const guest_id = body.guest_id ?? canonical.guest.id;
  if (changedBreakfast && !references.capabilities?.includes("reservation.breakfast.v1")) throw new Error("Breakfast selections are not supported by this server.");
  let mergedBreakfast: import("./contracts").BreakfastInput[] | undefined;
  if (changedBreakfast) {
    const allowed = (i: import("./contracts").BreakfastInput) => (!input.breakfastDates || input.breakfastDates.includes(i.service_date)) && i.guest_number <= (body.adults ?? canonical.allocation.adults) + (body.children ?? canonical.allocation.children);
    for (const item of breakfastBody!) {
      const old = oldBreakfast.find(i => i.service_date === item.service_date && i.guest_number === item.guest_number);
      if (!allowed(item) && breakfastIdentity(old ? [old] : []) !== breakfastIdentity([item])) {
        throw new Error("The reviewed guest count or stay excludes a breakfast you edited. Review counts/dates or clear that selection before saving.");
      }
    }
    mergedBreakfast = mergeBreakfastInputs(oldBreakfast, breakfastBody!, canonical.allocation.breakfast ?? []).filter(allowed);
  }
  if (changedInclusions && !references.capabilities?.includes("reservation.inclusions.v1")) throw new Error("Inclusions are not supported by this server.");
  if (changedStay) {
    if (!references.capabilities?.includes("reservation.stay-edit.v1")) throw new Error("Stay changes are not supported by this server.");
    const room = references.rooms.find(r => r.number === (input.roomNumber ?? previous.roomNumber));
    if (!room) throw new Error("Select a server-owned room.");
    const reconciledInclusions = changedInclusions ? mergeInclusionInputs(oldInclusions, inclusionBody!, canonical.allocation.inclusions ?? []).filter(i => {
      if (!changedRoom) return true;
      const remote = canonical.allocation.inclusions?.find(item => item.product_id === i.product_id);
      const defaults = references.room_types?.find(t => t.id === room.room_type_id)?.default_inclusions ?? [];
      return remote?.source !== "default" || defaults.some(d => d.product_id === i.product_id) || inclusionBody!.some(d => d.product_id === i.product_id);
    }) : undefined;
    return { ...body, guest_id,
      room_id: changedRoom ? room.id : canonical.allocation.room_id,
      duration_id: changedDuration ? input.durationId! : canonical.allocation.duration_id,
      scheduled_start: changedStart ? input.start!.toISOString() : canonical.allocation.scheduled_start,
      ...(changedBreakfast ? { breakfast: mergedBreakfast! } : {}),
      ...(changedInclusions ? { inclusions: reconciledInclusions! } : {}),
      ...(changedDiscounts ? { discounts: discountBody! } : {}), ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}), ...(changedCharges ? { charges: charges! } : {}) };
  }
  if (changedBreakfast) return { ...body, guest_id, breakfast: mergedBreakfast!, ...(changedInclusions ? { inclusions: mergeInclusionInputs(oldInclusions, inclusionBody!, canonical.allocation.inclusions ?? []) } : {}), ...(changedDiscounts ? { discounts: discountBody! } : {}), ...(changedCharges ? { charges: charges! } : {}), ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}) };
  if (changedInclusions) return { ...body, guest_id, inclusions: mergeInclusionInputs(oldInclusions, inclusionBody!, canonical.allocation.inclusions ?? []), ...(changedDiscounts ? { discounts: discountBody! } : {}), ...(changedCharges ? { charges: charges! } : {}), ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}) };
  if (changedDiscounts) return { ...body, guest_id, discounts: discountBody!, ...(changedCharges ? { charges: charges! } : {}), ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}) };
  if (changedCharges) return { ...body, guest_id, charges: charges!, ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}) };
  return { ...body, guest_id, adjustments: adjustmentBody! };
}
