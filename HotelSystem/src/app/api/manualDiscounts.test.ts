import { describe, expect, it } from "vitest";
import { manualDiscountInputs, mergeManualDiscountInputs } from "./discountInputs";
import { calculateReservationPrice } from "../../lib/reservationPricing";
import { richReservation } from "./richPresentation";
import { reservationEditInput } from "./reservationEditInput";
import type { ReservationDto, ReferencesDto } from "./contracts";
import type { ReservationDiscount } from "../../types/reservation";

const room = "11111111-1111-4111-8111-111111111111";
const dto = { id: "reservation", business_number: 1, version: 2, status: "confirmed", guest: { id: "guest" }, booking_source_id: "direct", note: "", created_at: "2026-10-14T00:00:00Z",
 allocation: { room_id: room, duration_id: "hourly", adults: 2, children: 0, scheduled_start: "2026-10-15T06:00:00Z", scheduled_end: "2026-10-15T12:00:00Z", actual_check_in: null, actual_check_out: null },
 pricing: { snapshot: { schema_version: 4, currency: "PHP", total_minor: 81000, pipeline_version: 2, discount_total_minor: 29000,
 lines: [{ room_id: room, room_number: "101", room_type_id: "type", room_type_label: "Standard", amount_minor: 110000, unit_amount_minor: 110000, quantity: 1, currency: "PHP" }], charges: [], adjustments: [],
 discounts: [{ id: "reservation-discount", label: "Reservation", scope: "reservation", method: "percentage", value: "10.000000000000000001", target_id: "", currency: "PHP", provenance: "manual", applied_at: "2026-10-14T00:01:00Z", amount_minor: 9000, order: 1, allocations: [{ line_id: `room:${room}`, amount_minor: 9000 }] },
 { id: "room-discount", label: "Room", scope: "room", method: "fixed", value: "200", target_id: room, currency: "PHP", provenance: "manual", applied_at: "2026-10-14T00:01:00Z", amount_minor: 20000, order: 0, allocations: [{ line_id: `room:${room}`, amount_minor: 20000 }] }] } }, audit: [] } as unknown as ReservationDto;
const refs = { capabilities: ["reservation.manual-discounts.v1"], booking_sources: [{ id: "direct", label: "Direct" }], rooms: [{ id: room, number: "101" }] } as unknown as ReferencesDto;

describe("manual discount API boundary", () => {
 it("maps canonical targets and exact inputs without trusting client amounts", () => {
   const presentation = richReservation(dto, refs);
   expect(presentation.discounts.map(d => d.id)).toEqual(["reservation-discount", "room-discount"]);
   expect(presentation.discounts[1].targetId).toBe("101");
   expect(presentation.pricing.discounts.map(d => d.order)).toEqual([0, 1]);
   expect(presentation.pricing.lines[0]).toMatchObject({ amount: 1100, finalAmount: 810, effectiveAmount: 1100 });
   expect(presentation.pricing.amountOwed).toBe(810);
   expect(manualDiscountInputs(presentation.discounts, room, dto)[0].value).toBe("10.000000000000000001");
   expect(manualDiscountInputs(presentation.discounts, room, dto)[1].target_id).toBe(room);
 });
 it("sends mixed discount/count changes atomically and preserves untouched remote edits", () => {
   const original = richReservation(dto, refs);
   const draft = { note: original.note, adults: 2, children: 0, discounts: original.discounts.map(d => d.id === "room-discount" ? { ...d, value: 100 } : d) };
   const body = reservationEditInput(original, draft, dto, refs, 5);
   expect(body).toMatchObject({ expected_version: 5, guest_id: "guest", discounts: [{ value: "10.000000000000000001" }, { value: "100", target_id: room }] });
   expect(body).not.toHaveProperty("adults"); expect(body).not.toHaveProperty("note");
 });
 it("preserves untouched remote discounts and newly added entries after review", () => {
   const original = richReservation(dto, refs);
   const changed = { ...dto, pricing: { ...dto.pricing, snapshot: { ...dto.pricing.snapshot, discounts: dto.pricing.snapshot.discounts!.map(d => d.id === "reservation-discount" ? { ...d, value: "20" } : d) } } };
   changed.pricing.snapshot.discounts!.push({ ...changed.pricing.snapshot.discounts![0], id: "remote-new", label: "Remote" });
   const local = original.discounts.map(d => d.id === "room-discount" ? { ...d, value: 100 } : d);
   expect(mergeManualDiscountInputs(original.discounts, local, room, changed).map(d => d.value)).toEqual(["20", "100", "20"]);
 });
 it("maps presets but rejects final-price overrides and invalid values", () => {
   const item = { id: "discount", label: "Courtesy", scope: "reservation", method: "percentage", value: 10, targetId: "" } as ReservationDiscount;
   expect(manualDiscountInputs([{ ...item, sourcePresetId: "preset" }], room)[0].preset_id).toBe("preset");
   expect(() => manualDiscountInputs([{ ...item, method: "final_price", sourcePresetId: "preset" }], room)).toThrow("Final-price");
   expect(() => manualDiscountInputs([{ ...item, value: 101 }], room)).toThrow("valid");
 });
 it("matches staged demo financial fixtures including eligible caps", () => {
   const lines = [{ id: "room:101", label: "Room", kind: "room" as const, roomNumber: "101", amount: 1100 }, { id: "purchase", label: "Meal", kind: "charge" as const, roomNumber: "101", amount: 200.25 }];
   const discounts: ReservationDiscount[] = [{ id: "a", label: "Reservation", scope: "reservation", method: "percentage", value: 10, targetId: "" }, { id: "b", label: "Room", scope: "room", method: "fixed", value: 100, targetId: "101" }, { id: "c", label: "Item", scope: "item", method: "percentage", value: 50, targetId: "purchase" }];
   expect(calculateReservationPrice(lines, discounts, [-5], { staged: true })).toMatchObject({ discountTotal: 310.14, amountOwed: 985.11 });
 });
});
