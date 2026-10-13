import type { HotelConfigurationData, HousekeepingState, RoomConfiguration } from "../features/configuration/types";
import type { Stay } from "../types/booking";

export const optionalRoomFields = new Set(["displayType", "capacityOverride", "description", "amenities", "operationalNotes"]);
export function roomDisplayName(room: Pick<RoomConfiguration, "displayType" | "roomTypeId">, configuration: Pick<HotelConfigurationData, "roomTypes">) {
  return room.displayType.trim() || configuration.roomTypes.find(type => type.id === room.roomTypeId)?.label || "Room";
}
export function roomOccupied(room: RoomConfiguration, stays: readonly Stay[], now: Date) {
  return Boolean(room.occupancyLockReservationId) || stays.some(stay => stay.room === room.number && (stay.status === "checked_in" || stay.occupancyLocked) && stay.checkIn <= now);
}
export function roomReadinessError(room: RoomConfiguration, state: HousekeepingState, stays: readonly Stay[], now: Date) {
  return state !== room.housekeepingState && roomOccupied(room, stays, now) ? "Housekeeping readiness cannot change while the room is occupied or locked." : undefined;
}
export function normalizeRoomFields(input: {
  number: string; roomTypeId: string; displayType: string; capacityOverride: string;
  description: string; operationalNotes: string; roomStatusId: string; housekeepingState: string;
}, configuration: HotelConfigurationData, current?: RoomConfiguration) {
  const number = input.number.trim();
  if (!number) throw new Error("Enter a room number.");
  if (configuration.rooms.some(room => room.id !== current?.id && room.number.toLowerCase() === number.toLowerCase())) throw new Error("A room with that number already exists.");
  const type = configuration.roomTypes.find(type => type.id === input.roomTypeId && ((type.enabled && !type.archived) || current?.roomTypeId === type.id));
  if (!type) throw new Error("Select a valid active room type.");
  if (!configuration.roomStatuses.some(status => status.id === input.roomStatusId)) throw new Error("Select a valid operational status.");
  if (!["clean", "dirty", "cleaning"].includes(input.housekeepingState)) throw new Error("Select a valid housekeeping readiness.");
  const rawCapacity = input.capacityOverride.trim();
  const capacityOverride = rawCapacity === "" ? undefined : Number(rawCapacity);
  if (capacityOverride !== undefined && (!Number.isInteger(capacityOverride) || capacityOverride < 1)) throw new Error("Room capacity overrides must be positive whole numbers.");
  return { number, roomTypeId: type.id, displayType: input.displayType.trim(), capacityOverride, description: input.description.trim(), operationalNotes: input.operationalNotes.trim(), roomStatusId: input.roomStatusId, housekeepingState: input.housekeepingState as HousekeepingState };
}
