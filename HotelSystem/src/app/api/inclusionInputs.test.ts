import { expect, it } from "vitest";
import { inclusionIdentity, mergeInclusionInputs, previousInclusionInputs } from "./inclusionInputs";
import { definitionIntent } from "./definitionInputs";
import { reservationEditInput } from "./reservationEditInput";
import { sampleConfiguration } from "../../features/configuration/sampleConfiguration";
import type { ReservationSnapshot } from "../../types/reservation";
import type { ReservationDto, ReferencesDto } from "./contracts";

it("preserves archived inclusion metadata when the generic form omits it, but permits explicit restore", () => {
  const config = { ...sampleConfiguration, inventoryCategories: [{ id: "inclusions", label: "Inclusions", type: "inclusion" as const, enabled: true, systemDefined: true }], catalogItems: [{ id: "towel", label: "Towel", category: "inclusion" as const, categoryId: "inclusions", price: 25.5, enabled: false, archived: true }] };
  const fields = { label: "Towel", categoryId: "inclusions", price: "30.50", enabled: false };
  expect(definitionIntent("catalogItems", "towel", fields, config, 2).body).toMatchObject({ archived: true, enabled: false, available_for_sale: false, unit_amount_minor: 3050 });
  expect(definitionIntent("catalogItems", "towel", { ...fields, archived: false, enabled: true }, config, 2).body).toMatchObject({ archived: false, enabled: true });
});

it("maps explicit room-type clears but omits defaults on unrelated definition writes", () => {
  const fields = { label: "Type", defaultCapacity: 2, amenities: [] };
  expect(definitionIntent("roomTypes", "type", fields, sampleConfiguration, 2).body).not.toHaveProperty("default_inclusions");
  expect(definitionIntent("roomTypes", "type", fields, sampleConfiguration, 2, []).body).toHaveProperty("default_inclusions", []);
  expect(definitionIntent("roomTypes", "type", fields, sampleConfiguration, 2, [{ catalogId: "towel", quantity: 2 }]).body).toHaveProperty("default_inclusions", [{ product_id: "towel", quantity: 2 }]);
});

it("retains zero overrides and merges only reviewed local changes", () => {
  const original = [{ product_id: "default", quantity: 0, overridden: true }];
  const current = [{ product_id: "default", quantity: 2, overridden: true, source: "default" as const, label: "Towel" }, { product_id: "remote", quantity: 4, overridden: false, source: "manual" as const, label: "Water" }];
  expect(mergeInclusionInputs(original, [{ ...original[0], quantity: 3 }], current)).toEqual([{ product_id: "default", quantity: 3, overridden: true }, { product_id: "remote", quantity: 4, overridden: false }]);
  expect(mergeInclusionInputs(original, original, current)[0].quantity).toBe(2);
  expect(inclusionIdentity([{ product_id: "a", quantity: 1 }])).toBe(inclusionIdentity([{ product_id: "a", quantity: 1, overridden: false }]));
});

it("uses a versioned nonfinancial command and preserves original zero selections", () => {
  const room = { roomNumber: "101", adults: 1, children: 0, checkIn: new Date(2026, 10, 1), durationId: "six", charges: [], inclusions: [], inclusionOrigins: { towel: { source: "default", overridden: true } } };
  const original = { id: "reservation", guestId: "guest", note: "", discounts: [], adjustments: [], rooms: [room] } as unknown as ReservationSnapshot;
  expect(previousInclusionInputs(original.rooms[0])).toEqual([{ product_id: "towel", quantity: 0, overridden: true }]);
  const canonical = { id: "reservation", guest: { id: "guest" }, allocation: { room_id: "room", inclusions: [{ product_id: "towel", quantity: 0, overridden: true, source: "default", label: "Towel" }] }, pricing: { snapshot: {} } } as unknown as ReservationDto;
  const refs = { capabilities: ["reservation.inclusions.v1"] } as ReferencesDto;
  const input = { note: "", adults: 1, children: 0, inclusions: [{ catalogId: "towel", quantity: 3, overridden: true }] };
  expect(reservationEditInput(original, input, canonical, refs, 2)).toEqual({ expected_version: 2, guest_id: "guest", inclusions: [{ product_id: "towel", quantity: 3, overridden: true }] });
  expect(() => reservationEditInput(original, input, canonical, { ...refs, capabilities: [] }, 2)).toThrow("Inclusions");
});
