import { expect, it } from "vitest";
import { reservationEditInput } from "./reservationEditInput";
import { definitionIntent } from "./definitionInputs";
import { sampleConfiguration } from "../../features/configuration/sampleConfiguration";
import type { ReservationSnapshot } from "../../types/reservation";
import type { ReservationDto, ReferencesDto } from "./contracts";

const original = { id: "reservation", guestId: "guest", serverVersion: 1, note: "", discounts: [], adjustments: [], rooms: [{ roomNumber: "101", adults: 1, children: 0, charges: [], checkIn: new Date(), durationId: "hourly" }] } as unknown as ReservationSnapshot;
const canonical = { id: "reservation", guest: { id: "guest" }, allocation: { room_id: "room" }, pricing: { snapshot: {} } } as unknown as ReservationDto;
const refs = { capabilities: ["reservation.purchases.v1", "reservation.extra-charges.v1"], rooms: [] } as unknown as ReferencesDto;
it("preserves extra charge classification in the existing atomic edit command", () => {
 const input = { note: "", adults: 1, children: 0, charges: [{ id: "charge", catalogId: "product", quantity: 2, label: "Extra bed", unitPrice: 500.25, usage: "extra_charge" as const }] };
 expect(reservationEditInput(original, input, canonical, refs, 1)).toMatchObject({ charges: [{ id: "charge", product_id: "product", quantity: 2, usage: "extra_charge" }] });
 expect(() => reservationEditInput(original, input, canonical, { ...refs, capabilities: ["reservation.purchases.v1"] }, 1)).toThrow("Extra charges");
});
it("preserves ordinary and extra products with identical names as distinct canonical definitions", () => {
 const config = { ...sampleConfiguration, inventoryCategories: [{ id: "extra", label: "Extra Charges", type: "extra" as const, enabled: true, systemDefined: true }, { id: "ordinary", label: "Extra Charges", type: "ordinary" as const, enabled: true, systemDefined: false }] };
 const body = definitionIntent("catalogItems", undefined, { label: "Extra bed", categoryId: "extra", price: "500.25", availableForSale: false }, config).body;
 expect(body).toMatchObject({ category_id: "extra", unit_amount_minor: 50025, available_for_sale: false });
});
