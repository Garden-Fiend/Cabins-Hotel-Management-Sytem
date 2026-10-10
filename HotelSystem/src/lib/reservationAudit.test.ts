import { describe, expect, it } from "vitest";
import { formatReservationAudit } from "./reservationAudit";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { sampleGuests } from "../data/datasample";
import { createHotelDateTime } from "./hotelTime";
import type { ReservationAuditEntry } from "../types/reservation";

const stamp = createHotelDateTime(2026, 10, 10, 9, 30);
function event(eventType: ReservationAuditEntry["eventType"], before: unknown, after: unknown): ReservationAuditEntry { return { eventType, before: JSON.stringify(before), after: JSON.stringify(after), action: "Reservation changed", actor: "Front Desk", occurredAt: stamp }; }
const format = (events: ReservationAuditEntry[]) => formatReservationAudit(events, sampleConfiguration, sampleGuests);
describe("readable reservation audit", () => {
  it("splits stay field changes, formats hotel dates, and resolves identifiers", () => {
    const record = event("stay_changed", { checkOut: createHotelDateTime(2026, 10, 10, 12), durationId: "1-night", roomTypeId: "standard" }, { checkOut: createHotelDateTime(2026, 10, 10, 15), durationId: "2-nights", roomTypeId: "deluxe" });
    const entries = format([record]);
    expect(entries).toHaveLength(3);
    expect(entries[0].description).toContain("12:00 PM"); expect(entries[0].description).toContain("3:00 PM");
    expect(entries[1].description).toContain("1 night to 2 nights");
    expect(entries[2].description).toContain("Standard to Deluxe");
    expect(entries.every((entry) => entry.actor === "Front Desk" && entry.occurredAt === stamp)).toBe(true);
  });
  it("shows quantity and price changes independently without modifying technical records", () => {
    const records = [event("inclusion_changed", [{ catalogId: "bottled-water", label: "Bottled water", quantity: 1 }], [{ catalogId: "bottled-water", label: "Bottled water", quantity: 2 }]), event("extra_changed", [{ id: "c1", catalogId: "laundry", label: "Laundry", quantity: 1, unitPrice: 100 }], [{ id: "c1", catalogId: "laundry", label: "Laundry", quantity: 2, unitPrice: 120 }])];
    const serialized = JSON.stringify(records); const entries = format(records);
    expect(entries.map((entry) => entry.description)).toEqual(["Bottled water quantity changed from 1 to 2", "Laundry quantity changed from 1 to 2", "Laundry unit price changed from ₱100.00 to ₱120.00"]);
    expect(JSON.stringify(records)).toBe(serialized);
  });
  it("sorts newest first, retains deterministic ties, and hides unknown technical data", () => {
    const older = event("created", undefined, { internal_field: "secret" });
    const newer = { ...event("checked_in", undefined, undefined), occurredAt: createHotelDateTime(2026, 10, 10, 10) };
    const unknown = { ...event("updated", { unknown_field: "secret" }, { unknown_field: "other" }), action: "unknown_field", actor: "" };
    const entries = format([older, newer, unknown]);
    expect(entries.map((entry) => entry.description)).toEqual(["Guest checked in", "Reservation created", "Reservation updated"]);
    expect(entries[2].actor).toBe("Actor not recorded");
    expect(JSON.stringify(entries)).not.toContain("secret");
  });
  it("resolves discount targets without exposing internal line identifiers", () => {
    const room = format([event("discount_changed", [{ id: "discount-1", label: "Offer", scope: "room", targetId: "room:101" }], [{ id: "discount-1", label: "Offer", scope: "room", targetId: "room:107" }])]);
    expect(room[0].description).toBe("Offer target changed from Room 101 to Room 107");
    expect(room[0].description).not.toContain("room:");
  });
  it("resolves guest references and supports existing plain-text sample records", () => {
    const guest = format([event("guest_changed", "guest-bob-wilson", "guest-alice-johnson")])[0].description;
    expect(guest).toContain("Bob Wilson"); expect(guest).toContain("Alice Johnson");
    expect(format([{ ...event("stay_changed", undefined, undefined), before: "1 night", after: "2 nights" }])[0].description).toBe("Stay duration changed from 1 night to 2 nights");
  });
});
