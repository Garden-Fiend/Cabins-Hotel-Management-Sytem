export type StayStatus =
  | "draft"
  | "reserved"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface Stay {
  id: number;
  reservationId?: string;
  room: string;
  guest: string;
  checkIn: Date;
  checkOut: Date;
  status: StayStatus;
  occupancyLocked?: boolean;
  housekeepingState?: "clean" | "dirty" | "cleaning";
  roomOperational?: boolean;
}