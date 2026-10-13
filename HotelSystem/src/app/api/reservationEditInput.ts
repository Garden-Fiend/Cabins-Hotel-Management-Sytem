import type { ReservationDemoContextValue } from "../reservationDemoStore";
import type { ReservationSnapshot } from "../../types/reservation";
import type { BillingEditInput, DetailsEditInput, PatchInput, ReferencesDto, ReservationDto, StayEditInput, ChargesEditInput, StayChargesEditInput, ChargeInput } from "./contracts";
import { toMinorUnits } from "../../lib/money";

type EditDraft = Parameters<NonNullable<ReservationDemoContextValue["commands"]>["patch"]>[1];
export type ReservationEditInput = PatchInput | DetailsEditInput | StayEditInput | BillingEditInput | ChargesEditInput | StayChargesEditInput;

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
  const changedAdjustments = input.adjustments !== undefined && JSON.stringify(input.adjustments) !== JSON.stringify(original.adjustments);
  const chargeIdentity = (items: NonNullable<EditDraft["charges"]>) => items.map(item => ({ id: item.id, product_id: item.catalogId, quantity: item.quantity, usage: item.usage }));
  const changedCharges = input.charges !== undefined && JSON.stringify(chargeIdentity(input.charges)) !== JSON.stringify(chargeIdentity(previous.charges ?? []));
  if (!changedStay && !changedAdjustments && !changedCharges && Object.keys(body).length === 1) return;
  if (!changedStay && !changedAdjustments && !changedCharges) return body;
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
      if (item.usage !== "purchase") throw new Error("Only purchased catalog items are supported by this server.");
      return { id: item.id, product_id: item.catalogId, quantity: item.quantity, usage: "purchase" };
    });
  }
  const guest_id = body.guest_id ?? canonical.guest.id;
  if (changedStay) {
    if (!references.capabilities?.includes("reservation.stay-edit.v1")) throw new Error("Stay changes are not supported by this server.");
    const room = references.rooms.find(r => r.number === (input.roomNumber ?? previous.roomNumber));
    if (!room) throw new Error("Select a server-owned room.");
    return { ...body, guest_id,
      room_id: changedRoom ? room.id : canonical.allocation.room_id,
      duration_id: changedDuration ? input.durationId! : canonical.allocation.duration_id,
      scheduled_start: changedStart ? input.start!.toISOString() : canonical.allocation.scheduled_start,
      ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}), ...(changedCharges ? { charges: charges! } : {}) };
  }
  if (changedCharges) return { ...body, guest_id, charges: charges!, ...(changedAdjustments ? { adjustments: adjustmentBody! } : {}) };
  return { ...body, guest_id, adjustments: adjustmentBody! };
}
