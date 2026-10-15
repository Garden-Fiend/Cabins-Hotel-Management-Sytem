import type {CommandRoomInput} from '../reservationDemoStore';
import type {ReservationRoomSnapshot} from '../../types/reservation';
import type {AnyReservationDto,MultiAllocationInput,MultiAllocationDto} from './contracts';

export function roomStayChanged(room:CommandRoomInput,old:ReservationRoomSnapshot){
 return (room.useReservationStay!==undefined&&room.useReservationStay!==(old.useReservationStay??true))||
   (room.start!==undefined&&room.start.getTime()!==old.checkIn.getTime())||
   (room.durationId!==undefined&&room.durationId!==old.durationId);
}
export function allocationStayInput(room:CommandRoomInput,old?:ReservationRoomSnapshot,remote?:AnyReservationDto['allocation']|MultiAllocationDto):Pick<MultiAllocationInput,'stay'>{
 if(old&&remote&&!roomStayChanged(room,old)){
  if('uses_reservation_stay' in remote&&remote.uses_reservation_stay===false)return {stay:{scheduled_start:remote.scheduled_start,duration_id:remote.duration_id}};
  return old.useReservationStay===false?{stay:null}:{};
 }
 if(room.useReservationStay===false){
  if(!room.start||!Number.isFinite(room.start.getTime())||!room.durationId)throw new Error('Select a valid custom room stay.');
  return {stay:{scheduled_start:old&&remote&&room.start.getTime()===old.checkIn.getTime()?remote.scheduled_start:room.start.toISOString(),duration_id:old&&remote&&room.durationId===old.durationId?remote.duration_id:room.durationId}};
 }
 return old?.useReservationStay===false?{stay:null}:{};
}
