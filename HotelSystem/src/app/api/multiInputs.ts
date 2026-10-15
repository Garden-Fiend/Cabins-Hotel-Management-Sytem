import type {AnyReservationDto,MultiAllocationInput,MultiCreateInput,ReferencesDto,ManualDiscountInput,ChargeInput} from './contracts';
import type {CommandRoomInput} from '../reservationDemoStore';
import type {ReservationSnapshot,ReservationDiscount,ReservationAdjustment} from '../../types/reservation';
import {manualDiscountInputs} from './discountInputs';
import {breakfastInputs,breakfastIdentity,mergeBreakfastInputs} from './breakfastInputs';
import {mergeInclusionInputs,previousInclusionInputs,inclusionIdentity} from './inclusionInputs';
import {toMinorUnits} from '../../lib/money';
import {allocationStayInput,roomStayChanged} from './allocationStayInputs';
import {apiInstant} from './presentation';
import {hotelDateKey,createHotelDateTime} from '../../lib/hotelTime';

type Draft={rooms?:CommandRoomInput[];guestId?:string;bookingSourceId?:string;durationId?:string;start?:Date;note:string;discounts?:ReservationDiscount[];adjustments?:ReservationAdjustment[];breakfastDates?:string[]};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function merge<T extends {id:string}>(before:T[],draft:T[],remote:T[]):T[]{
 const original=new Map(before.map(i=>[i.id,i])),local=new Map(draft.map(i=>[i.id,i]));
 const result=remote.filter(i=>!original.has(i.id)||local.has(i.id)).map(i=>local.has(i.id)&&(!original.has(i.id)||!same(original.get(i.id),local.get(i.id)))?local.get(i.id)!:i);
 for(const i of draft)if(!result.some(r=>r.id===i.id)&&(!original.has(i.id)||!same(original.get(i.id),i)))result.push(i);
 return result;
}
export function hasMultiChanges(original:ReservationSnapshot,input:Draft){
 if(input.note!==original.note||(input.guestId!==undefined&&input.guestId!==original.guestId)||(input.durationId!==undefined&&input.durationId!==(original.stayDefaults?.durationId??original.rooms[0]?.durationId))||(input.start!==undefined&&input.start.getTime()!==(original.stayDefaults?.start??original.checkIn).getTime()))return true;
 if(!same(input.discounts??[],original.discounts)||!same(input.adjustments??[],original.adjustments)||input.rooms?.length!==original.rooms.length)return true;
 return input.rooms.some(room=>{const old=original.rooms.find(r=>r.roomNumber===room.roomNumber);if(!old||roomStayChanged(room,old)||old.adults!==room.adults||old.children!==room.children)return true;
   const c=(items:CommandRoomInput['charges'])=>items.map(i=>({id:i.id,catalogId:i.catalogId,quantity:i.quantity,usage:i.usage??'purchase'}));
   return !same(c(old.charges),c(room.charges))||inclusionIdentity(previousInclusionInputs(old))!==inclusionIdentity((room.inclusions??[]).map(i=>({product_id:i.catalogId,quantity:i.quantity,overridden:i.overridden})))||breakfastIdentity(breakfastInputs(old.breakfast))!==breakfastIdentity(breakfastInputs(room.breakfast));});
}
export function multiReservationInput(input:Draft,refs:ReferencesDto,original?:ReservationSnapshot,canonical?:AnyReservationDto):MultiCreateInput{
 if(!input.rooms?.length)throw new Error('Select at least one room.');
 const current=canonical?.allocation===null?canonical.allocations.filter(a=>!a.removed_at):canonical?[canonical.allocation]:[];
 const roomId=(number:string)=>{const room=refs.rooms.find(r=>r.number===number.replace(/^room:/,''));if(!room)throw new Error('Reload room references before saving.');return room.id;};
 const discountInputs=(items:ReservationDiscount[]):ManualDiscountInput[]=>items.map(item=>manualDiscountInputs([item],item.scope==='room'?roomId(item.targetId):'',canonical)[0]);
 const charge=(c:CommandRoomInput['charges'][number]):ChargeInput=>({id:c.id,product_id:c.catalogId,quantity:c.quantity,usage:c.usage??'purchase'});
 const remoteCharges=canonical?.pricing.snapshot.charges??[];
 const allocations:MultiAllocationInput[]=input.rooms.flatMap(room=>{
   const old=original?.rooms.find(r=>r.roomNumber===room.roomNumber),remote=old?current.find(a=>a.id===old.allocationId||a.room_id===roomId(old.roomNumber)):undefined;
   const ownerCharges=remoteCharges.filter(c=>canonical?.allocation!==null||c.allocation_id===remote?.id).map(c=>({id:c.id,product_id:c.product_id,quantity:c.quantity,usage:c.usage}));
   const oldBreakfast=breakfastInputs(old?.breakfast??[]),localBreakfast=breakfastInputs(room.breakfast);
   if(old&&canonical&&!remote){
     const oldCharges=old.charges.map(charge),localCharges=room.charges.map(charge);
     const localInclusions=(room.inclusions??[]).map(i=>({product_id:i.catalogId,quantity:i.quantity,overridden:i.overridden}));
     if(roomStayChanged(room,old)||old.adults!==room.adults||old.children!==room.children||!same(oldCharges,localCharges)||breakfastIdentity(oldBreakfast)!==breakfastIdentity(localBreakfast)||inclusionIdentity(previousInclusionInputs(old))!==inclusionIdentity(localInclusions))throw new Error('A room you edited was removed remotely. Review that room before saving; it will not be silently re-added.');
     return [];
   }
   const adults=old&&room.adults===old.adults&&remote?remote.adults:room.adults;
   const children=old&&room.children===old.children&&remote?remote.children:room.children;
   const dates=room.breakfastDates??input.breakfastDates;
   const reviewedStay=old&&remote&&!roomStayChanged(room,old)?remote:undefined;
   const reviewedLine=reviewedStay?canonical?.pricing.snapshot.lines.find(l=>l.room_id===reviewedStay.room_id):undefined;
   const allowed=(item:typeof localBreakfast[number])=>{
     if(item.guest_number>adults+children)return false;
     if(reviewedStay&&reviewedLine){const [y,m,d]=item.service_date.split('-').map(Number);return reviewedLine.booking_kind==='overnight'&&item.service_date>hotelDateKey(apiInstant(reviewedStay.scheduled_start))&&createHotelDateTime(y,m,d).getTime()<apiInstant(reviewedStay.scheduled_end).getTime();}
     return !dates||dates.includes(item.service_date);
   };
   for(const item of localBreakfast){
     const before=oldBreakfast.find(i=>i.service_date===item.service_date&&i.guest_number===item.guest_number);
     if(!allowed(item)&&breakfastIdentity(before?[before]:[])!==breakfastIdentity([item]))throw new Error('The reviewed guest count or stay excludes a breakfast you edited. Review counts/dates or clear that selection before saving.');
   }
   const inclusions=room.inclusions?.map(i=>({product_id:i.catalogId,quantity:i.quantity,...(i.overridden?{overridden:true}:{})}));
   return [{...allocationStayInput(room,old,remote),...(remote?{id:remote.id}:{}),room_id:roomId(room.roomNumber),adults:old&&room.adults===old.adults&&remote?remote.adults:room.adults,children:old&&room.children===old.children&&remote?remote.children:room.children,
    charges:old&&remote?merge(old.charges.map(charge),room.charges.map(charge),ownerCharges):room.charges.map(charge),
    ...(inclusions?{inclusions:old&&remote?mergeInclusionInputs(previousInclusionInputs(old),inclusions,remote.inclusions??[]):inclusions}:{}),
    breakfast:(old&&remote?mergeBreakfastInputs(oldBreakfast,localBreakfast,remote.breakfast??[]):localBreakfast).filter(allowed)}];
 });
 // Remote additions are untouched; a reviewed retry must not silently remove them.
 if(original&&canonical)for(const a of current)if(!original.rooms.some(r=>r.allocationId===a.id||roomId(r.roomNumber)===a.room_id)&&!allocations.some(i=>i.room_id===a.room_id))allocations.push({id:a.id,room_id:a.room_id,adults:a.adults,children:a.children,charges:remoteCharges.filter(c=>c.allocation_id===a.id).map(c=>({id:c.id,product_id:c.product_id,quantity:c.quantity,usage:c.usage})),inclusions:a.inclusions?.map(i=>({product_id:i.product_id,quantity:i.quantity,overridden:i.overridden})),breakfast:breakfastInputs((a.breakfast??[]).map(b=>({stayDate:b.service_date,guestNumber:b.guest_number,status:b.status,mealId:b.meal_id??undefined,beverageId:b.beverage_id??undefined})))});
 const currentDiscounts:ManualDiscountInput[]=[...(canonical?.pricing.snapshot.discounts??[]).map(d=>({id:d.id,label:d.label,scope:d.scope,method:d.method,value:d.value,target_id:d.target_id,currency:d.currency,...(d.preset_id?{preset_id:d.preset_id}:{})})),...(canonical?.pricing.snapshot.price_overrides??[]).map(d=>({id:d.id,label:d.label,scope:d.scope,method:'final_price' as const,value:'0',target_id:d.scope==='room'?d.line_id.replace(/^room:/,''):d.line_id,currency:d.currency,preset_id:d.preset_id}))];
 const adjustment=(a:ReservationAdjustment)=>{const old=original?.adjustments.find(o=>o.id===a.id),raw=canonical?.pricing.snapshot.adjustments?.find(o=>o.id===a.id);return {id:a.id,amount_minor:old?.amount===a.amount&&raw?raw.amount_minor:toMinorUnits(a.amount,'PHP'),reason:a.reason};};
 const unchangedStart=original&&input.start?.getTime()===(original.stayDefaults?.start??original.checkIn).getTime();
 return {guest_id:original&&input.guestId===original.guestId&&canonical?canonical.guest.id:input.guestId??canonical?.guest.id??'',booking_source_id:input.bookingSourceId??canonical?.booking_source_id??'',
  duration_id:original&&input.durationId===(original.stayDefaults?.durationId??original.rooms[0].durationId)&&canonical?(canonical.allocation===null?(canonical.stay_defaults?.duration_id??canonical.shared_duration_id??input.durationId??''):canonical.allocation.duration_id):input.durationId??'',
  scheduled_start:unchangedStart&&canonical?(canonical.allocation===null?(canonical.stay_defaults?.scheduled_start??canonical.shared_start):canonical.allocation.scheduled_start):input.start!.toISOString(),note:original&&input.note===original.note&&canonical?canonical.note:input.note,allocations,
  discounts:original&&canonical?merge(discountInputs(original.discounts),discountInputs(input.discounts??[]),currentDiscounts):discountInputs(input.discounts??[]),
  adjustments:original&&canonical?merge(original.adjustments.map(adjustment),(input.adjustments??[]).map(adjustment),canonical.pricing.snapshot.adjustments??[]):(input.adjustments??[]).map(adjustment)};
}
