import type { Stay, StayStatus } from "../types/booking";

export const BLOCKING_STATUSES = new Set<StayStatus>([
  "reserved",
  "confirmed",
]);
export function findClash(
  stays: Stay[],
  room: string,
  checkIn: Date,
  checkOut: Date,
  skipId?: number,
  skipReservationId?: string,
) {
  return stays.find(
    (stay) =>
      stay.id !== skipId &&
      stay.reservationId !== skipReservationId &&
      stay.room === room &&
      (stay.occupancyLocked === true ||
        stay.status === "checked_in" ||
        (BLOCKING_STATUSES.has(stay.status) &&
          stay.checkIn.getTime() < checkOut.getTime() &&
          checkIn.getTime() < stay.checkOut.getTime())),
  );
}

export function getAvailableRooms<
  Room extends { number: string; maintenanceStatus?: string },
>(
  rooms: Room[],
  stays: Stay[],
  checkIn: Date,
  checkOut: Date,
  skipReservationId?: string,
): Room[] {
  return rooms.filter(
    (room) =>
      !room.maintenanceStatus &&
      !findClash(
        stays,
        room.number,
        checkIn,
        checkOut,
        undefined,
        skipReservationId,
      ),
  );
}