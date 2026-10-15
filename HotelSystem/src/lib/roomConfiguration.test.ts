import { describe, expect, it } from "vitest";
import { normalizeRoomFields, roomDisplayName, roomReadinessError } from "./roomConfiguration";
import { sampleConfiguration as configuration } from "../features/configuration/sampleConfiguration";

describe("room configuration contract", () => {
  const room = configuration.rooms[0];
  const input = { ...room, capacityOverride: "", description: " ", operationalNotes: "", displayType: "" };
  it("normalizes intentional clears and derives display fallback from current type", () => {
    const next = normalizeRoomFields(input, configuration, room);
    expect(next.capacityOverride).toBeUndefined();
    expect(next.description).toBe("");
    expect(next.displayType).toBe("");
    expect(roomDisplayName(next, configuration)).toBe("Standard");
    expect(roomDisplayName({ ...next, roomTypeId: "suite" }, configuration)).toBe("Suite");
    expect(roomDisplayName({ ...next, displayType: "Custom" }, configuration)).toBe("Custom");
  });
  it.each(["0", "-1", "1.5", "abc"])("rejects invalid capacity %s", capacityOverride => {
    expect(() => normalizeRoomFields({ ...input, capacityOverride }, configuration, room)).toThrow("positive whole");
  });
  it("accepts capacity one and rejects required/reference/duplicate failures", () => {
    expect(normalizeRoomFields({ ...input, capacityOverride: "1" }, configuration, room).capacityOverride).toBe(1);
    for (const invalid of [{ number: " " }, { number: "102" }, { roomTypeId: "missing" }, { roomStatusId: "missing" }, { housekeepingState: "missing" }]) expect(() => normalizeRoomFields({ ...input, ...invalid }, configuration, room)).toThrow();
  });
  it("blocks readiness changes on locked rooms, permits no-op and unoccupied changes", () => {
    const locked = { ...room, occupancyLockReservationId: "reservation" };
    expect(roomReadinessError(locked, "dirty", [], new Date(0))).toContain("occupied");
    expect(roomReadinessError(locked, room.housekeepingState, [], new Date(0))).toBeUndefined();
    expect(roomReadinessError(room, "dirty", [], new Date(0))).toBeUndefined();
  });
});


