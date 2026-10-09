import { describe, expect, it } from "vitest";

import { demoReservations, demoStays } from "../data/demoReservations";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { createHotelDateTime } from "./hotelTime";
import {
  cancelReservation,
  checkInReservation,
  checkOutReservation,
  markReservationNoShow,
  recordGuestDeparture,
} from "./reservationLifecycle";
import { findClash } from "../utils/availability";

describe("reservation lifecycle", () => {
  it("checks in when every assigned room is ready and available", () => {
    const source = demoReservations.find((item) => item.id === "DEMO-2")!;
    const reservation = { ...source, status: "confirmed" as const };
    const stays = demoStays.map((stay) =>
      stay.reservationId === reservation.id
        ? { ...stay, status: "confirmed" as const }
        : stay,
    );
    const result = checkInReservation(
      reservation,
      stays,
      sampleConfiguration,
      createHotelDateTime(2026, 10, 14, 17),
    );

    expect(result.errors).toEqual([]);
    expect(result.state?.reservation.status).toBe("checked_in");
    expect(
      result.state?.stays
        .filter((stay) => stay.reservationId === reservation.id)
        .every((stay) => stay.status === "checked_in"),
    ).toBe(true);
  });

  it("validates all rooms before multi-room check-in", () => {
    const source = demoReservations.find((item) => item.id === "DEMO-2")!;
    const now = createHotelDateTime(2026, 10, 14, 17);
    const reservation = { ...source, status: "confirmed" as const };
    const stays = demoStays.map((stay) =>
      stay.reservationId === reservation.id
        ? { ...stay, status: "confirmed" as const }
        : stay,
    );
    const configuration = {
      ...sampleConfiguration,
      rooms: sampleConfiguration.rooms.map((room) =>
        room.number === "201"
          ? { ...room, housekeepingState: "dirty" as const }
          : room,
      ),
    };

    const result = checkInReservation(
      reservation,
      stays,
      configuration,
      now,
    );

    expect(result.state).toBeUndefined();
    expect(result.errors).toContain(
      "Room 201 is dirty; it must be Clean before check-in.",
    );
  });

  it("checks out every assigned room and marks the rooms Dirty", () => {
    const reservation = demoReservations.find((item) => item.id === "DEMO-6")!;
    const result = checkOutReservation(
      reservation,
      demoStays,
      sampleConfiguration,
      createHotelDateTime(2026, 10, 9, 12),
    );

    expect(result.state?.reservation.status).toBe("checked_out");
    expect(
      result.state?.configuration.rooms.find((room) => room.number === "202")
        ?.housekeepingState,
    ).toBe("dirty");
    expect(
      result.state?.stays.find((stay) => stay.reservationId === reservation.id)
        ?.status,
    ).toBe("checked_out");
  });

  it("holds cancelled occupied rooms until departure is recorded, regardless of scheduled end", () => {
    const reservation = demoReservations.find((item) => item.id === "DEMO-6")!;
    const cancelled = cancelReservation(
      reservation,
      demoStays,
      sampleConfiguration,
      false,
      createHotelDateTime(2026, 10, 9, 12),
    );

    expect(cancelled.reservation.status).toBe("cancelled");
    expect(
      findClash(
        cancelled.stays,
        "202",
        createHotelDateTime(2026, 10, 16, 14),
        createHotelDateTime(2026, 10, 17, 14),
      )?.occupancyLocked,
    ).toBe(true);

    const departure = recordGuestDeparture(
      cancelled.reservation,
      cancelled.stays,
      cancelled.configuration,
      createHotelDateTime(2026, 10, 11, 15),
    );
    expect(departure.error).toBeUndefined();
    expect(departure.state?.reservation.occupancyLockRoomNumbers).toEqual([]);
    expect(
      departure.state?.configuration.rooms.find((room) => room.number === "202")
        ?.housekeepingState,
    ).toBe("dirty");
    expect(
      findClash(
        departure.state!.stays,
        "202",
        createHotelDateTime(2026, 10, 16, 14),
        createHotelDateTime(2026, 10, 17, 14),
      ),
    ).toBeUndefined();
  });

  it("marks confirmed reservations No-show without blocking availability", () => {
    const reservation = demoReservations.find((item) => item.id === "DEMO-2")!;
    const result = markReservationNoShow(
      reservation,
      demoStays,
      sampleConfiguration,
      createHotelDateTime(2026, 10, 17),
    );

    expect(result.state?.reservation.status).toBe("no_show");
    expect(
      findClash(
        result.state!.stays,
        "102",
        createHotelDateTime(2026, 10, 14),
        createHotelDateTime(2026, 10, 16),
      ),
    ).toBeUndefined();
  });
});
