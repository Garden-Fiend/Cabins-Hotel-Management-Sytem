import { describe, expect, it } from "vitest";

import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { getRoomAccommodationPrice } from "./roomPricing";

describe("room-type accommodation pricing", () => {
  it("returns the same hourly package rate regardless of physical room", () => {
    const sameTypeRooms = sampleConfiguration.rooms.filter(
      (room) => room.roomTypeId === "standard",
    );
    const roomRates = sameTypeRooms.map(() =>
      getRoomAccommodationPrice(sampleConfiguration, "standard", "6-hours"),
    );

    expect(sameTypeRooms.length).toBeGreaterThan(1);
    expect(roomRates).toEqual(
      sameTypeRooms.map(() => ({ amount: 1100, currency: "PHP" })),
    );
  });

  it("multiplies the single nightly base rate by configured nights, not duration minutes", () => {
    const configuration = {
      ...sampleConfiguration,
      durations: sampleConfiguration.durations.map((duration) =>
        duration.id === "2-nights"
          ? { ...duration, minutes: 60, nights: 2 }
          : duration,
      ),
    };

    expect(
      getRoomAccommodationPrice(configuration, "standard", "2-nights"),
    ).toEqual({ amount: 4400, currency: "PHP" });
  });

  it("accepts zero rates and rejects missing or disabled rates", () => {
    const zeroRateConfiguration = {
      ...sampleConfiguration,
      roomTypePrices: sampleConfiguration.roomTypePrices.map((rate) =>
        rate.id === "standard-6-hours" ? { ...rate, amount: 0 } : rate,
      ),
    };
    expect(
      getRoomAccommodationPrice(zeroRateConfiguration, "standard", "6-hours"),
    ).toEqual({ amount: 0, currency: "PHP" });

    const disabledConfiguration = {
      ...sampleConfiguration,
      roomTypePrices: sampleConfiguration.roomTypePrices.map((rate) =>
        rate.id === "standard-6-hours" ? { ...rate, enabled: false } : rate,
      ),
    };
    expect(
      getRoomAccommodationPrice(disabledConfiguration, "standard", "6-hours"),
    ).toBeUndefined();
    expect(
      getRoomAccommodationPrice(sampleConfiguration, "standard", "missing"),
    ).toBeUndefined();
  });
});
