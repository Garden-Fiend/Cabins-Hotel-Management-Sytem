import { describe, expect, it } from "vitest";

import {
  bookingSources,
  historicalRoomRates,
  roomRates,
} from "./datasample";
import { demoReservations } from "./demoReservations";

describe("demonstration reservation domain scenarios", () => {
  it("covers the established reservation cases with related sample entities", () => {
    expect(demoReservations).toHaveLength(9);

    const simple = demoReservations.find((item) => item.id === "DEMO-1");
    expect(simple?.rooms).toHaveLength(1);
    expect(simple?.discounts).toHaveLength(0);
    expect(simple?.rooms[0].charges).toHaveLength(0);

    const multiRoom = demoReservations.find((item) => item.id === "DEMO-2");
    expect(multiRoom?.rooms).toHaveLength(2);
    expect(new Set(multiRoom?.rooms.map((room) => room.roomTypeId)).size).toBe(2);
    expect(multiRoom?.rooms[0].children).toBe(1);
    expect(multiRoom?.rooms[0].charges[1].quantity).toBe(3);

    const breakfast = demoReservations.find((item) => item.id === "DEMO-3");
    expect(breakfast?.rooms[0].breakfast.map((item) => item.stayDate)).toEqual(
      expect.arrayContaining(["2026-10-19", "2026-10-20"]),
    );
    expect(breakfast?.rooms[0].breakfast.some((item) => item.status === "skipped")).toBe(true);

    const discounts = demoReservations.find((item) => item.id === "DEMO-4");
    expect(new Set(discounts?.discounts.map((item) => item.scope))).toEqual(
      new Set(["room", "item", "reservation"]),
    );
    expect(demoReservations.find((item) => item.id === "DEMO-6")?.discounts).toHaveLength(1);
    expect(discounts?.adjustments[0].reason).toBe("Late arrival service");
  });

  it("keeps disabled configuration and captured values readable in history", () => {
    const cancelled = demoReservations.find((item) => item.id === "DEMO-5");
    expect(cancelled?.status).toBe("cancelled");
    expect(
      bookingSources.find((source) => source.id === cancelled?.bookingSourceId)
        ?.enabled,
    ).toBe(false);

    const historical = demoReservations.find((item) => item.id === "DEMO-8");
    const historicalRoom = historical?.rooms[0];
    expect(historicalRoom?.capturedRoomPrice).toBe(
      historicalRoomRates.Deluxe["3-nights"],
    );
    expect(historicalRoom?.capturedRoomPrice).not.toBe(
      roomRates.Deluxe["3-nights"],
    );
    expect(historicalRoom?.charges[0].label).toBe("Legacy minibar");
    expect(historicalRoom?.breakfast[0].mealLabel).toBe("American breakfast");
    expect(historical?.audit.some((event) => event.before && event.after)).toBe(true);
  });
});
