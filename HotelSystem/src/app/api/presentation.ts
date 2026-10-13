import type { Stay } from "../../types/booking";
import type { ReservationDto } from "./contracts";

export function apiInstant(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("Server returned a timestamp without an offset.");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid server timestamp.");
  return new Date(timestamp);
}

export function formatPhp(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Invalid PHP minor-unit amount.");
  const units = BigInt(minor);
  return `₱${(units / 100n).toLocaleString("en-PH")}.${String(units % 100n).padStart(2, "0")}`;
}

export function phpDecimal(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Invalid PHP minor-unit amount.");
  const amount = BigInt(minor);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

export interface ApiReservationPresentation {
  canonical: ReservationDto; // Keep UUIDs, versions, raw microseconds and minor units losslessly.
  stay: Stay;
}
export function presentReservation(dto: ReservationDto): ApiReservationPresentation {
  if (!Number.isSafeInteger(dto.business_number) || dto.business_number < 1 || dto.version < 1)
    throw new Error("Invalid reservation identity/version.");
  formatPhp(dto.pricing.snapshot.total_minor);
  const line = dto.pricing.snapshot.lines[0];
  if (!line || line.room_id !== dto.allocation.room_id || dto.pricing.snapshot.currency !== "PHP")
    throw new Error("Unsupported or inconsistent captured pricing.");
  return { canonical: dto, stay: {
    id: dto.business_number, // Server-issued display key for the single-room calendar, not UUID conversion.
    reservationId: dto.id, room: line.room_number, guest: dto.guest.name,
    checkIn: apiInstant(dto.allocation.scheduled_start), checkOut: apiInstant(dto.allocation.actual_check_out ?? dto.allocation.scheduled_end),
    status: dto.status, occupancyLocked: dto.allocation.actual_check_in !== null && dto.allocation.actual_check_out === null,
  } };
}
