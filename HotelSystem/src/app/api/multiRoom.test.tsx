import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import type {MultiReservationDto,ReferencesDto} from './contracts';
import {presentReservation} from './presentation';
import {richReservation} from './richPresentation';
import {multiReservationInput,hasMultiChanges} from './multiInputs';
import {ReservationDemoContext} from '../reservationDemoStore';
import type {ReservationDemoContextValue} from '../reservationDemoStore';
import {MultiRoomHeaderActions,RoomAllocationsSection} from '../../components/reservations/AllocationOperations';
import {calendarStayClassName} from '../../lib/calendar';

const start='2026-11-10T06:07:12.123456Z',end='2026-11-10T12:07:12.123456Z';
function fixture():MultiReservationDto{
 const allocations=[['a','r1','101'],['b','r2','102']].map(([id,room_id,number])=>({id,room_id,room_number:number,room_type_label:'Captured '+number,state:'reserved' as const,removed_at:null,duration_id:'duration',scheduled_start:start,scheduled_end:end,actual_check_in:null,actual_check_out:null,adults:2,children:0,blocks_availability:true,inclusions:[],breakfast:[]}));
 const lines=allocations.map((a,i)=>({allocation_id:a.id,kind:'accommodation' as const,room_id:a.room_id,room_number:a.room_number,room_type_id:'type',room_type_label:a.room_type_label,duration_id:'duration',duration_source_id:'6-hours',rate_id:'rate'+i,rate_source_id:'standard',booking_kind:'hourly' as const,unit_amount_minor:i?170000:110000,quantity:1,amount_minor:i?170000:110000,currency:'PHP' as const}));
 return {id:'reservation',company_id:'company',business_number:1,reference:'HMS-1',version:1,status:'confirmed',guest:{id:'guest',company_id:'company',name:'Guest',phone:'',email:''},booking_source_id:'source',note:'Original',created_at:start,updated_at:start,allocation:null,allocations,aggregate_status:'reserved',shared_start:start,shared_end:end,shared_duration_id:'duration',pricing:{id:'pricing',revision:1,reservation_version:1,captured_at:start,snapshot:{schema_version:6,calculation_version:'direct-multi-room-v1',currency:'PHP',hotel_timezone:'Asia/Manila',tax_status:'not_configured',tax_minor:0,lines,charges:[],discounts:[],discount_total_minor:0,price_overrides:[],price_override_total_minor:0,adjustments:[],pipeline_version:2,total_minor:280000}},audit:[]};
}
const refs={booking_sources:[{id:'source',label:'Direct'}],rooms:[{id:'r1',number:'101'},{id:'r2',number:'102'},{id:'r3',number:'103'}]} as ReferencesDto;
function draft(dto=fixture()){
 const original=richReservation(dto,refs);
 return {original,input:{rooms:original.rooms.map(r=>({roomNumber:r.roomNumber,adults:r.adults,children:r.children,charges:r.charges,inclusions:[],breakfast:r.breakfast})),guestId:original.guestId,bookingSourceId:original.bookingSourceId,durationId:'duration',start:original.checkIn,note:original.note,discounts:original.discounts,adjustments:original.adjustments}};
}
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('multi-room canonical projection and edits',()=>{
 it('projects one canonical stay per allocation without a primary-room alias or duplicate financial total',()=>{
  const dto=fixture(),presentation=presentReservation(dto),snapshot=richReservation(dto,refs);
  expect(presentation.stays.map(s=>s.id)).toEqual(['a','b']);expect('stay' in presentation).toBe(false);
  expect(presentation.stays.every(s=>s.reservationId===dto.id)).toBe(true);
  expect(snapshot.rooms.map(r=>r.capturedRoomPrice)).toEqual([1100,1700]);expect(snapshot.pricing.amountOwed).toBe(2800);expect(snapshot.pricing.subtotal).toBe(2800);expect(snapshot.pricing.lines).toHaveLength(2);
 });
 it('uses allocation occupancy independently for calendar colors and excludes removed history',()=>{
  const dto=fixture();dto.allocations[0].state='checked_in';dto.allocations[0].actual_check_in=start;dto.status='checked_in';dto.aggregate_status='partially_checked_in';
  const stays=presentReservation(dto).stays;expect(stays.map(s=>s.status)).toEqual(['checked_in','reserved']);expect(stays.map(s=>s.occupancyLocked)).toEqual([true,false]);
  dto.allocations[0].state='checked_out';dto.allocations[0].actual_check_out='2026-11-10T08:00:00Z';expect(presentReservation(dto).stays[0].occupancyLocked).toBe(false);
  dto.allocations[0].removed_at=end;expect(presentReservation(dto).stays.map(s=>s.id)).toEqual(['b']);
 });
 it('rejects a corrupt shared-stay mapping',()=>{const dto=fixture();dto.allocations[1].scheduled_end=start;expect(()=>presentReservation(dto)).toThrow(/shared-stay/);});
 it('retains canonical IDs and full timestamp precision on an unchanged edit',()=>{
  const dto=fixture(),{original,input}=draft(dto),body=multiReservationInput(input,refs,original,dto);
  expect(body.allocations.map(a=>a.id)).toEqual(['a','b']);expect(body.scheduled_start).toBe(start);expect(body.duration_id).toBe('duration');
  expect(multiReservationInput(input,refs).allocations.every(a=>!a.id)).toBe(true);
 });
 it('reviewed retry preserves untouched remote counts, note and newly added room',()=>{
  const dto=fixture(),{original,input}=draft(dto),remote=structuredClone(dto);remote.version=2;remote.allocations[0].adults=5;remote.note='Remote';remote.allocations.push({...remote.allocations[1],id:'c',room_id:'r3',room_number:'103'});remote.pricing.snapshot.lines.push({...remote.pricing.snapshot.lines[1],allocation_id:'c',room_id:'r3',room_number:'103'});
  const body=multiReservationInput(input,refs,original,remote);expect(body.allocations).toHaveLength(3);expect(body.allocations[0].adults).toBe(5);expect(body.note).toBe('Remote');
  input.note='Local note';expect(multiReservationInput(input,refs,original,remote).note).toBe('Local note');
 });
 it('explicit local removal does not resurrect an original room and room discounts target the intended UUID',()=>{
  const dto=fixture(),{original,input}=draft(dto);input.rooms=input.rooms.slice(1);input.discounts=[{id:'d',label:'Room courtesy',scope:'room',method:'percentage',value:10,targetId:'102'}];
  const body=multiReservationInput(input,refs,original,dto);expect(body.allocations.map(a=>a.id)).toEqual(['b']);expect(body.discounts[0].target_id).toBe('r2');
 });
});
describe('original detail allocation actions',()=>{
 it('keeps overdue, completed and reserved calendar colors allocation-specific',()=>{
  const dto=fixture();dto.allocations[0].state='checked_in';dto.allocations[0].actual_check_in=start;
  const now=new Date(new Date(end).getTime()+1);
  let stays=presentReservation(dto).stays;
  expect(calendarStayClassName(stays[0],now)).toContain('bg-rose-100');
  expect(calendarStayClassName(stays[1],now)).toContain('bg-blue-50');
  dto.allocations[0].state='checked_out';dto.allocations[0].actual_check_out=end;
  stays=presentReservation(dto).stays;
  expect(calendarStayClassName(stays[0],now)).toContain('bg-slate-100');
  expect(calendarStayClassName(stays[1],now)).toContain('bg-blue-50');
 });
 it('does not resurrect a remotely removed room on reviewed retry',()=>{
  const dto=fixture(),{original,input}=draft(dto),remote=structuredClone(dto);
  remote.allocations[1].removed_at=end;
  expect(multiReservationInput(input,refs,original,remote).allocations.map(a=>a.id)).toEqual(['a']);
  input.rooms[1].adults=4;
  expect(()=>multiReservationInput(input,refs,original,remote)).toThrow(/removed remotely/);
 });
 it('detects a no-op and rejects reviewed quota loss of an edited breakfast',()=>{
  const dto=fixture(),{original,input}=draft(dto);
  expect(hasMultiChanges(original,input)).toBe(false);
  input.note='Changed';expect(hasMultiChanges(original,input)).toBe(true);
  input.rooms[0].breakfast=[{stayDate:'2026-11-11',guestNumber:2,status:'included',mealId:'meal',beverageId:'drink'}];
  const remote=structuredClone(dto);remote.allocations[0].adults=1;
  expect(()=>multiReservationInput(input,refs,original,remote)).toThrow(/excludes a breakfast/);
 });
 it('disables invalid bulk transitions for mixed states but targets an eligible individual room',()=>{
  vi.useFakeTimers();vi.setSystemTime('2026-11-10T08:00:00Z');const dto=fixture();dto.allocations[0].state='checked_in';dto.allocations[0].actual_check_in=start;dto.status='checked_in';dto.aggregate_status='partially_checked_in';const reservation=richReservation(dto,refs),action=vi.fn(async()=>{});
  const configuration={rooms:reservation.rooms.map(r=>({number:r.roomNumber,enabled:true,roomStatusId:'operational',housekeepingState:'clean'}))};
  const value={mode:'api',configuration,commands:{allocationLifecycle:action,busy:false}} as unknown as ReservationDemoContextValue;
  render(<ReservationDemoContext.Provider value={value}><MultiRoomHeaderActions reservation={reservation}/><RoomAllocationsSection reservation={reservation}/></ReservationDemoContext.Provider>);
  expect(screen.getByRole('button',{name:'Check In All'}).hasAttribute('disabled')).toBe(true);expect(screen.getByRole('button',{name:'Check Out All'}).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Check in room 102'}));expect(action).toHaveBeenCalledWith(reservation,'check-in','b');expect(screen.getByRole('region',{name:'Room allocations'})).toBeTruthy();
 });
});

function independentDraft(){
 const dto=fixture();dto.stay_mode='independent';dto.stay_defaults={scheduled_start:start,scheduled_end:end,duration_id:'duration'};
 dto.shared_duration_id=null;dto.shared_end='2026-11-14T04:00:00Z';
 dto.allocations[0].uses_reservation_stay=true;
 Object.assign(dto.allocations[1],{uses_reservation_stay:false,scheduled_start:'2026-11-12T06:07:12.123456Z',scheduled_end:dto.shared_end,duration_id:'night2'});
 Object.assign(dto.pricing.snapshot.lines[1],{duration_id:'night2',booking_kind:'overnight',quantity:2,amount_minor:340000});
 dto.pricing.snapshot.total_minor=450000;
 const original=richReservation(dto,refs);
 const input={rooms:original.rooms.map(r=>({roomNumber:r.roomNumber,adults:r.adults,children:r.children,charges:r.charges,inclusions:[],breakfast:r.breakfast,useReservationStay:r.useReservationStay,start:r.checkIn,durationId:r.durationId})),guestId:original.guestId,bookingSourceId:original.bookingSourceId,durationId:'duration',start:original.stayDefaults!.start,note:original.note,discounts:original.discounts,adjustments:original.adjustments};
 return {dto,original,input};
}
describe('B3 independent room stays',()=>{
 it('rejects contradictory parent aggregate dates instead of projecting a false room span',()=>{
  const {dto}=independentDraft();dto.shared_end=end;expect(()=>presentReservation(dto)).toThrow(/independent allocation range/);
 });
 it('projects own calendar intervals and the derived overall range without repeating the financial total',()=>{
  const {dto,original}=independentDraft(),stays=presentReservation(dto).stays;
  expect(stays[0].checkOut.toISOString()).toBe('2026-11-10T12:07:12.123Z');
  expect(stays[1].checkIn.toISOString()).toBe('2026-11-12T06:07:12.123Z');
  expect(original.checkOut.toISOString()).toBe(dto.shared_end.replace('00Z','00.000Z'));
  expect(original.pricing.amountOwed).toBe(4500);expect(original.rooms.map(r=>r.useReservationStay)).toEqual([true,false]);
 });
 it('round-trips custom identity and full timestamps while leaving B2 omitted fields compatible',()=>{
  const {dto,original,input}=independentDraft();expect(hasMultiChanges(original,input)).toBe(false);
  const body=multiReservationInput(input,refs,original,dto);
  expect(body.scheduled_start).toBe(start);expect(body.allocations[0].stay).toBeUndefined();
  expect(body.allocations[1].stay).toEqual({scheduled_start:dto.allocations[1].scheduled_start,duration_id:'night2'});
  input.rooms[1].start=new Date('2026-11-13T06:00:00Z');expect(hasMultiChanges(original,input)).toBe(true);
  expect(multiReservationInput(input,refs,original,dto).allocations[1].stay?.scheduled_start).toBe('2026-11-13T06:00:00.000Z');
 });
 it('sends an intentional reset separately from an omitted custom stay',()=>{
  const {dto,original,input}=independentDraft();input.rooms[1].useReservationStay=true;input.rooms[1].start=input.start;input.rooms[1].durationId=input.durationId;
  expect(multiReservationInput(input,refs,original,dto).allocations[1].stay).toBeNull();
 });
 it('preserves reviewed remote dates and duration on untouched rooms',()=>{
  const {dto,original,input}=independentDraft();const remote=structuredClone(dto);
  remote.allocations[1].scheduled_start='2026-11-13T06:07:12.999999Z';remote.allocations[1].duration_id='night3';
  input.note='Local note';const body=multiReservationInput(input,refs,original,remote);
  expect(body.allocations[1].stay).toEqual({scheduled_start:remote.allocations[1].scheduled_start,duration_id:'night3'});
  expect(body.note).toBe('Local note');
 });
 it('rejects a local edited breakfast excluded by the reviewed remote room stay',()=>{
  const {dto,original,input}=independentDraft(),remote=structuredClone(dto);
  input.rooms[1].breakfast=[{stayDate:'2026-11-13',guestNumber:1,status:'included',mealId:'meal',beverageId:'drink'}];
  remote.allocations[1].scheduled_start='2026-11-14T06:00:00Z';
  expect(()=>multiReservationInput(input,refs,original,remote)).toThrow(/excludes a breakfast/);
 });
 it('computes overdue per allocation rather than using the parent latest checkout',()=>{
  const {dto}=independentDraft();dto.allocations[0].state='checked_in';dto.allocations[0].actual_check_in=start;
  const stays=presentReservation(dto).stays,now=new Date('2026-11-11T00:00:00Z');
  expect(calendarStayClassName(stays[0],now)).toContain('bg-rose-100');expect(calendarStayClassName(stays[1],now)).toContain('bg-blue-50');
 });
});
