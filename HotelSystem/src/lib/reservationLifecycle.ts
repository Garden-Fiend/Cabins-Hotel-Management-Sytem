import type { HotelConfigurationData } from "../features/configuration/types";
import { findClash } from "../utils/availability";
import type { Stay } from "../types/booking";
import type {
  ReservationAuditEntry,
  ReservationSnapshot,
} from "../types/reservation";

export interface LifecycleState {
  reservation: ReservationSnapshot;
  stays: Stay[];
  configuration: HotelConfigurationData;
}

function audit(
  eventType: ReservationAuditEntry["eventType"],
  action: string,
  actor: string,
  occurredAt: Date,
  before?: string,
  after?: string,
): ReservationAuditEntry {
  return {
    eventType,
    action,
    actor,
    occurredAt,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

export function validateReservationCheckIn(
  reservation: ReservationSnapshot,
  configuration: HotelConfigurationData,
  stays: Stay[],
  now: Date,
) {
  const errors: string[] = [];
  if (reservation.status !== "confirmed" && reservation.status !== "reserved") {
    errors.push("Only confirmed reservations can be checked in.");
  }
  if (reservation.rooms.length === 0) {
    errors.push("Assign at least one room before checking in.");
  }
  if (
    Number.isNaN(reservation.checkIn.getTime()) ||
    Number.isNaN(reservation.checkOut.getTime()) ||
    reservation.checkOut.getTime() <= reservation.checkIn.getTime()
  ) {
    errors.push("The reservation stay dates are invalid.");
  } else if (
    reservation.checkIn.getTime() > now.getTime() ||
    reservation.checkOut.getTime() <= now.getTime()
  ) {
    errors.push("Check-in is available only during the scheduled stay.");
  }

  for (const assigned of reservation.rooms) {
    const room = configuration.rooms.find(
      (item) => item.number === assigned.roomNumber,
    );
    const roomType = configuration.roomTypes.find(
      (item) => item.id === assigned.roomTypeId,
    );
    if (
      !room?.enabled ||
      room.archived ||
      !roomType?.enabled ||
      roomType.archived
    ) {
      errors.push(`Room ${assigned.roomNumber} is not active.`);
      continue;
    }
    if (room.roomTypeId !== assigned.roomTypeId) {
      errors.push(
        `Room ${assigned.roomNumber} no longer matches the room type saved on the reservation.`,
      );
    }
    if (
      Number.isNaN(assigned.checkIn.getTime()) ||
      Number.isNaN(assigned.checkOut.getTime()) ||
      assigned.checkOut.getTime() <= assigned.checkIn.getTime() ||
      assigned.checkIn.getTime() > now.getTime() ||
      assigned.checkOut.getTime() <= now.getTime()
    ) {
      errors.push(
        `Room ${assigned.roomNumber} is outside its scheduled check-in window.`,
      );
    }
    if (room.housekeepingState !== "clean") {
      errors.push(
        `Room ${assigned.roomNumber} is ${room.housekeepingState}; it must be Clean before check-in.`,
      );
    }
    const status = configuration.roomStatuses.find(
      (item) => item.id === room.roomStatusId,
    );
    if (!status?.enabled || status.blocksReservation) {
      errors.push(`Room ${assigned.roomNumber} is not operational.`);
    }
    const conflict = findClash(
      stays,
      assigned.roomNumber,
      assigned.checkIn,
      assigned.checkOut,
      undefined,
      reservation.id,
    );
    if (conflict) {
      errors.push(`Room ${assigned.roomNumber} has a conflicting stay.`);
    }
  }
  return [...new Set(errors)];
}

export function checkInReservation(
  reservation: ReservationSnapshot,
  stays: Stay[],
  configuration: HotelConfigurationData,
  now: Date,
): { state?: LifecycleState; errors: string[] } {
  const errors = validateReservationCheckIn(
    reservation,
    configuration,
    stays,
    now,
  );
  if (errors.length) return { errors };
  const event = audit(
    "checked_in",
    "Guest checked in",
    "Local demo user",
    now,
    reservation.status,
    "checked_in",
  );
  return {
    errors: [],
    state: {
      reservation: {
        ...reservation,
        status: "checked_in",
        actualCheckInAt: now,
        rooms: reservation.rooms.map((room) => ({
          ...room,
          actualCheckInAt: now,
        })),
        audit: [...reservation.audit, event],
      },
      stays: stays.map((stay) =>
        stay.reservationId === reservation.id
          ? { ...stay, status: "checked_in", occupancyLocked: false }
          : stay,
      ),
      configuration,
    },
  };
}

export function checkOutReservation(
  reservation: ReservationSnapshot,
  stays: Stay[],
  configuration: HotelConfigurationData,
  now: Date,
): { state?: LifecycleState; errors: string[] } {
  if (reservation.status !== "checked_in") {
    return {
      errors: ["Only checked-in reservations can be checked out."],
    };
  }
  const roomNumbers = new Set(reservation.rooms.map((room) => room.roomNumber));
  const event = audit(
    "checked_out",
    "Guest checked out",
    "Local demo user",
    now,
    "checked_in",
    "checked_out",
  );
  return {
    errors: [],
    state: {
      reservation: {
        ...reservation,
        status: "checked_out",
        actualCheckOutAt: now,
        rooms: reservation.rooms.map((room) => ({
          ...room,
          actualCheckOutAt: now,
        })),
        audit: [...reservation.audit, event],
      },
      stays: stays.map((stay) =>
        stay.reservationId === reservation.id
          ? { ...stay, status: "checked_out", checkOut: now, occupancyLocked: false }
          : stay,
      ),
      configuration: {
        ...configuration,
        rooms: configuration.rooms.map((room) =>
          roomNumbers.has(room.number)
            ? {
                ...room,
                housekeepingState: "dirty",
                occupancyLockReservationId: undefined,
              }
            : room,
        ),
      },
    },
  };
}

export function cancelReservation(
  reservation: ReservationSnapshot,
  stays: Stay[],
  configuration: HotelConfigurationData,
  guestHasVacated: boolean,
  now: Date,
): LifecycleState {
  const wasCheckedIn = reservation.status === "checked_in";
  const lockedRooms =
    wasCheckedIn && !guestHasVacated
      ? reservation.rooms.map((room) => room.roomNumber)
      : [];
  const event = audit(
    "cancelled",
    wasCheckedIn && !guestHasVacated
      ? "Reservation cancelled; guest remains in room"
      : "Reservation cancelled",
    "Local demo user",
    now,
    reservation.status,
    "cancelled",
  );
  return {
    reservation: {
      ...reservation,
      status: "cancelled",
      ...(wasCheckedIn && guestHasVacated ? { actualCheckOutAt: now } : {}),
      occupancyLockRoomNumbers: lockedRooms,
      rooms: reservation.rooms.map((room) => ({
        ...room,
        ...(wasCheckedIn && guestHasVacated ? { actualCheckOutAt: now } : {}),
      })),
      audit: [...reservation.audit, event],
    },
    stays: stays.map((stay) =>
      stay.reservationId === reservation.id
        ? {
            ...stay,
            status: "cancelled",
            ...(lockedRooms.includes(stay.room)
              ? { occupancyLocked: true }
              : { occupancyLocked: false }),
            ...(wasCheckedIn && guestHasVacated ? { checkOut: now } : {}),
          }
        : stay,
    ),
    configuration: {
      ...configuration,
      rooms: configuration.rooms.map((room) =>
        reservation.rooms.some((assigned) => assigned.roomNumber === room.number)
          ? {
              ...room,
              occupancyLockReservationId: lockedRooms.includes(room.number)
                ? reservation.id
                : undefined,
              ...(wasCheckedIn && guestHasVacated
                ? { housekeepingState: "dirty" as const }
                : {}),
            }
          : room,
      ),
    },
  };
}

export function recordGuestDeparture(
  reservation: ReservationSnapshot,
  stays: Stay[],
  configuration: HotelConfigurationData,
  now: Date,
): { state?: LifecycleState; error?: string } {
  if (
    reservation.status !== "cancelled" ||
    !reservation.occupancyLockRoomNumbers?.length
  ) {
    return { error: "This cancelled reservation has no active occupancy lock." };
  }
  const roomNumbers = new Set(reservation.occupancyLockRoomNumbers);
  return {
    state: {
      reservation: {
        ...reservation,
        actualCheckOutAt: now,
        occupancyLockRoomNumbers: [],
        rooms: reservation.rooms.map((room) =>
          roomNumbers.has(room.roomNumber)
            ? { ...room, actualCheckOutAt: now }
            : room,
        ),
        audit: [
          ...reservation.audit,
          audit(
            "departure_recorded",
            "Guest departure recorded after cancellation",
            "Local demo user",
            now,
            "occupancy locked",
            "departure recorded",
          ),
        ],
      },
      stays: stays.map((stay) =>
        stay.reservationId === reservation.id
          ? {
              ...stay,
              checkOut: now,
              occupancyLocked: false,
            }
          : stay,
      ),
      configuration: {
        ...configuration,
        rooms: configuration.rooms.map((room) =>
          roomNumbers.has(room.number)
            ? {
                ...room,
                occupancyLockReservationId: undefined,
                housekeepingState: "dirty",
              }
            : room,
        ),
      },
    },
  };
}

export function markReservationNoShow(
  reservation: ReservationSnapshot,
  stays: Stay[],
  configuration: HotelConfigurationData,
  now: Date,
): { state?: LifecycleState; error?: string } {
  if (reservation.status !== "confirmed" && reservation.status !== "reserved") {
    return { error: "Only confirmed reservations can be marked No-show." };
  }
  if (now < reservation.checkIn) {
    return {
      error: "A reservation can be marked No-show only after scheduled check-in.",
    };
  }
  return {
    state: {
      reservation: {
        ...reservation,
        status: "no_show",
        audit: [
          ...reservation.audit,
          audit(
            "no_show",
            "Reservation marked No-show",
            "Local demo user",
            now,
            reservation.status,
            "no_show",
          ),
        ],
      },
      stays: stays.map((stay) =>
        stay.reservationId === reservation.id
          ? { ...stay, status: "no_show", occupancyLocked: false }
          : stay,
      ),
      configuration,
    },
  };
}
