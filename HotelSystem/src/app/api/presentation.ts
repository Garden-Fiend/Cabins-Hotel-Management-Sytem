import type { Stay } from "../../types/booking";
import type { ReservationDto, AnyReservationDto, MultiReservationDto } from "./contracts";

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
  stays:Stay[];
}
export function presentReservation(dto:ReservationDto):ApiReservationPresentation;
export function presentReservation(dto:MultiReservationDto):{canonical:MultiReservationDto;stays:Stay[]};
export function presentReservation(dto:AnyReservationDto):{canonical:AnyReservationDto;stays:Stay[]};
export function presentReservation(dto:AnyReservationDto):ApiReservationPresentation|{canonical:MultiReservationDto;stays:Stay[]} {
  if(dto.allocation===null){
    if(!Number.isSafeInteger(dto.version)||dto.version<1||!Number.isSafeInteger(dto.business_number)||dto.business_number<1||![6,7].includes(dto.pricing.snapshot.schema_version)||dto.pricing.snapshot.currency!=="PHP")throw new Error("Invalid plural reservation capture.");
    formatPhp(dto.pricing.snapshot.total_minor);
    const active=dto.allocations.filter(a=>!a.removed_at);
    if(!active.length||new Set(active.map(a=>a.id)).size!==active.length||new Set(active.map(a=>a.room_id)).size!==active.length)throw new Error("Invalid allocation set.");
    if(dto.stay_mode==='independent'){
      const starts=active.map(a=>apiInstant(a.scheduled_start).getTime()),ends=active.map(a=>apiInstant(a.scheduled_end).getTime());
      const durations=new Set(active.map(a=>a.duration_id));
      if(!dto.stay_defaults||apiInstant(dto.shared_start).getTime()!==Math.min(...starts)||apiInstant(dto.shared_end).getTime()!==Math.max(...ends)||
        (durations.size===1?dto.shared_duration_id!==active[0].duration_id:dto.shared_duration_id!==null)||ends.some((end,index)=>end<=starts[index]))throw new Error('Inconsistent independent allocation range.');
      apiInstant(dto.stay_defaults.scheduled_start);apiInstant(dto.stay_defaults.scheduled_end);
    }
    const stays:Stay[]=active.map(a=>{
      const line=dto.pricing.snapshot.lines.find(line=>line.allocation_id===a.id&&line.room_id===a.room_id);
      if(!line||line.duration_id!==a.duration_id||(dto.stay_mode!=="independent"&&(a.scheduled_start!==dto.shared_start||a.scheduled_end!==dto.shared_end||a.duration_id!==dto.shared_duration_id)))throw new Error("Inconsistent shared-stay capture.");
      return {id:a.id,reservationId:dto.id,room:line.room_number,guest:dto.guest.name,checkIn:apiInstant(a.scheduled_start),checkOut:apiInstant(a.actual_check_out??a.scheduled_end),status:a.state==='reserved'?'reserved':a.state==='cancelled'&&a.actual_check_in&&!a.actual_check_out?'checked_in':a.state==='removed'?'cancelled':a.state,occupancyLocked:a.actual_check_in!==null&&a.actual_check_out===null};
    });
    return {canonical:dto,stays};
  }
  if (!Number.isSafeInteger(dto.business_number) || dto.business_number < 1 || dto.version < 1)
    throw new Error("Invalid reservation identity/version.");
  formatPhp(dto.pricing.snapshot.total_minor);
  const line = dto.pricing.snapshot.lines[0];
  if (!line || line.room_id !== dto.allocation.room_id || dto.pricing.snapshot.currency !== "PHP")
    throw new Error("Unsupported or inconsistent captured pricing.");
  const stay:Stay = {
    id: dto.business_number, // Server-issued display key for the single-room calendar, not UUID conversion.
    reservationId: dto.id, room: line.room_number, guest: dto.guest.name,
    checkIn: apiInstant(dto.allocation.scheduled_start), checkOut: apiInstant(dto.allocation.actual_check_out ?? dto.allocation.scheduled_end),
    status: dto.status, occupancyLocked: dto.allocation.actual_check_in !== null && dto.allocation.actual_check_out === null,
  };
  return {canonical:dto,stay,stays:[stay]};
}
