import type {AnyReservationDto,MultiReservationDto,ReferencesDto,ReservationDto} from './contracts';
import type {ReservationSnapshot,AppliedDiscount} from '../../types/reservation';
import {richReservation} from './richPresentation';
import {apiInstant} from './presentation';

/** Reuse single-room line formatting; combine each allocation once without inventing a primary room. */
export function richMultiReservation(dto:MultiReservationDto,refs:ReferencesDto):ReservationSnapshot{
  const active=dto.allocations.filter(a=>!a.removed_at);
  const pieces=active.map(a=>{
    const line=dto.pricing.snapshot.lines.find(l=>l.allocation_id===a.id)!;
    const charges=(dto.pricing.snapshot.charges??[]).filter(c=>c.allocation_id===a.id);
    const owns=(scope:string,target:string)=>scope==='reservation'||scope==='room'&&target===a.room_id||scope==='item'&&charges.some(c=>c.id===target);
    const view:ReservationDto={...dto,allocation:a,status:a.state==='reserved'?'confirmed':a.state==='removed'?'cancelled':a.state,
      pricing:{...dto.pricing,snapshot:{...dto.pricing.snapshot,lines:[line],charges,discounts:dto.pricing.snapshot.discounts?.filter(d=>owns(d.scope,d.target_id)),price_overrides:dto.pricing.snapshot.price_overrides?.filter(d=>owns(d.scope,d.line_id.replace(/^room:/,'')))}}};
    const piece=richReservation(view,refs);
    piece.rooms[0].useReservationStay=a.uses_reservation_stay??true;piece.rooms[0].allocationId=a.id;piece.rooms[0].allocationState=a.state==='removed'?'cancelled':a.state;
    return piece;
  });
  const mapId=(id:string)=>{const line=dto.pricing.snapshot.lines.find(l=>`room:${l.room_id}`===id);return line?`room:${line.room_number}`:id;};
  const deduplicate=<T extends {id:string}>(items:T[])=>[...new Map(items.map(i=>[i.id,i])).values()];
  const discounts=deduplicate(pieces.flatMap(p=>p.pricing.discounts)).map(d=>({...d,allocations:dto.pricing.snapshot.discounts?.find(raw=>raw.id===d.id)?.allocations.map(a=>({lineId:mapId(a.line_id),amount:a.amount_minor/100}))})).sort((a,b)=>(a.order??0)-(b.order??0));
  const overrides=deduplicate(pieces.flatMap(p=>p.pricing.priceOverrides??[]));
  const originalSubtotal=[...dto.pricing.snapshot.lines,...(dto.pricing.snapshot.charges??[])].reduce((sum,line)=>sum+BigInt(line.amount_minor),0n);
  const common=pieces[0];
  const asIntent=(d:AppliedDiscount)=>{const item=pieces.flatMap(p=>p.discounts).find(item=>item.id===d.id)!;return item;};
  return {...common,checkIn:apiInstant(dto.shared_start),checkOut:apiInstant(dto.shared_end),...(dto.stay_defaults?{stayDefaults:{start:apiInstant(dto.stay_defaults.scheduled_start),end:apiInstant(dto.stay_defaults.scheduled_end),durationId:dto.stay_defaults.duration_id}}:{}),status:dto.status,aggregateStatus:dto.aggregate_status,actualCheckInAt:undefined,actualCheckOutAt:undefined,
    rooms:pieces.flatMap(p=>p.rooms),
    occupancyLockRoomNumbers:active.filter(a=>a.state==='cancelled'&&a.actual_check_in&&!a.actual_check_out).map(a=>a.room_number),
    discounts:[...(dto.pricing.snapshot.price_overrides??[]),...(dto.pricing.snapshot.discounts??[])].map(d=>asIntent({id:d.id} as AppliedDiscount)),
    pricing:{...common.pricing,lines:pieces.flatMap(p=>p.pricing.lines),discounts,priceOverrides:overrides,subtotal:Number(originalSubtotal)/100,
      discountTotal:(dto.pricing.snapshot.discount_total_minor??0)/100,priceOverrideTotal:(dto.pricing.snapshot.price_override_total_minor??0)/100,
      amountOwed:dto.pricing.snapshot.total_minor/100},
    audit:dto.audit.map(e=>({eventType:'updated',action:e.description??humanEvent(e.event_type),actor:e.actor,occurredAt:apiInstant(e.occurred_at)}))};
}
function humanEvent(event:string){return ({'reservation.multi_create':'Created reservation and assigned rooms','reservation.multi_edit':'Updated room assignments and captured billing','reservation.multi_check_in':'Checked in selected room(s)','reservation.multi_check_out':'Checked out selected room(s)','reservation.multi_cancel':'Cancelled selected room(s)','reservation.multi_no_show':'Recorded room no-show','reservation.multi_record_departure':'Recorded guest departure'} as Record<string,string>)[event]??event;}
export function singleCanonical(value:AnyReservationDto|undefined):ReservationDto|undefined{return value?.allocation===null?undefined:value;}
