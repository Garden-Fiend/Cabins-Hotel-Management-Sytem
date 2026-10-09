import { describe, expect, it } from "vitest";

import type { Stay } from "../types/booking";
import { findClash, getAvailableRooms } from "./availability";

const stay: Stay = {
  id: 1,
  reservationId: "RES-1",
  room: "101",
  guest: "Sample guest",
  checkIn: new Date("2026-10-08T14:00:00"),
  checkOut: new Date("2026-10-09T14:00:00"),
  status: "reserved",
};

describe("findClash", () => {
  it("uses half-open intervals so adjacent stays do not overlap", () => {
    expect(
      findClash(
        [stay],
        "101",
        new Date("2026-10-09T14:00:00"),
        new Date("2026-10-10T14:00:00"),
      ),
    ).toBeUndefined();
  });

  it("detects overlap only for the same physical room and ignores cancellation", () => {
    expect(
      findClash(
        [stay],
        "101",
        new Date("2026-10-09T13:59:00"),
        new Date("2026-10-10T14:00:00"),
      ),
    ).toBe(stay);
    expect(
      findClash(
        [{ ...stay, status: "cancelled" }],
        "101",
        stay.checkIn,
        stay.checkOut,
      ),
    ).toBeUndefined();
    expect(
      findClash(
        [stay],
        "102",
        stay.checkIn,
        stay.checkOut,
      ),
    ).toBeUndefined();
  });

  it("returns none, one, or multiple operational rooms based on reservations", () => {
    const rooms = [
      { number: "101" },
      { number: "102" },
      { number: "103", maintenanceStatus: "maintenance" },
    ];
    const start = new Date("2026-10-08T14:00:00");
    const end = new Date("2026-10-09T14:00:00");
    const reserved101 = { ...stay, checkIn: start, checkOut: end };
    const reserved102 = { ...reserved101, id: 2, room: "102" };

    expect(getAvailableRooms(rooms, [], start, end).map((room) => room.number)).toEqual([
      "101",
      "102",
    ]);
    expect(
      getAvailableRooms(rooms, [reserved101], start, end).map((room) => room.number),
    ).toEqual(["102"]);
    expect(
      getAvailableRooms(rooms, [reserved101, reserved102], start, end),
    ).toEqual([]);
  });
});
