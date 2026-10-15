import {useState,useEffect} from 'react';
import {useReservationDemo} from '../../app/useReservationDemo';
import type {ReservationSnapshot,ReservationRoomSnapshot} from '../../types/reservation';
import type {HotelConfigurationData} from '../../features/configuration/types';
import {formatHotelDate} from '../../lib/hotelTime';

function useClock(){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>window.clearInterval(timer);},[]);return now;}
function reason(room:ReservationRoomSnapshot,configuration:HotelConfigurationData,action:'check-in'|'check-out',now:number){
 if(action==='check-out')return room.allocationState==='checked_in'?'':'Room is not currently checked in.';
 if(room.allocationState!=='reserved')return 'Room is not reserved for check-in.';
 if(now<room.checkIn.getTime()||now>=room.checkOut.getTime())return 'Check-in is available only during the scheduled stay.';
 const physical=configuration.rooms.find(r=>r.number===room.roomNumber);
 if(!physical?.enabled||physical.archived||physical.roomStatusId!=='operational')return 'Room must be active and operational.';
 if(physical.housekeepingState!=='clean')return 'Room must be Clean before check-in.';
 return '';
}
export function MultiRoomHeaderActions({reservation}:{reservation:ReservationSnapshot}){
 const {commands,configuration}=useReservationDemo();const [notice,setNotice]=useState('');const now=useClock();
 if(!reservation.aggregateStatus)return null;
 async function act(action:'check-in'|'check-out'){try{setNotice('');await commands!.allocationLifecycle!(reservation,action);}catch(error){setNotice(error instanceof Error?error.message:'Lifecycle change was not confirmed.');}}
 return <div className="w-full space-y-2 rounded-lg border border-slate-200 p-3"><p className="font-semibold capitalize">Room occupancy: {reservation.aggregateStatus.replaceAll('_',' ')}</p><div className="flex flex-wrap gap-2">{(['check-in','check-out'] as const).map(action=>{
  const blocked=reservation.rooms.map(r=>reason(r,configuration,action,now)).find(Boolean);
  return <div key={action}><button type="button" disabled={Boolean(blocked)||!commands?.allocationLifecycle||commands.busy} title={blocked} onClick={()=>void act(action)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{action==='check-in'?'Check In All':'Check Out All'}</button>{blocked&&<p className="mt-1 max-w-xs text-xs text-slate-600">{blocked} Use individual room actions below for mixed states.</p>}</div>;
 })}</div>{notice&&<p role="alert">{notice}</p>}</div>;
}
export function RoomAllocationsSection({reservation}:{reservation:ReservationSnapshot}){
 const {commands,configuration}=useReservationDemo();const [notice,setNotice]=useState('');const now=useClock();
 if(!reservation.aggregateStatus)return null;
 const date=(value:Date)=>formatHotelDate(value,{dateStyle:'medium',timeStyle:'short'});
 async function act(action:'check-in'|'check-out',id:string){try{setNotice('');await commands!.allocationLifecycle!(reservation,action,id);}catch(error){setNotice(error instanceof Error?error.message:'Room action was not confirmed.');}}
 return <section aria-label="Room allocations" className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Room allocations</h2><p className="text-sm text-slate-600">One reservation and one bill; each room has its own occupancy. Each room follows its own scheduled stay.</p>
  <div className="mt-3 grid gap-3 md:grid-cols-2">{reservation.rooms.map(room=><article key={room.allocationId} data-allocation-id={room.allocationId} className="rounded-lg border p-4"><h3 className="font-semibold">Room {room.roomNumber} · {room.roomType}</h3><p className="capitalize">{room.allocationState?.replaceAll('_',' ')}</p><p>{date(room.checkIn)} – {date(room.checkOut)}</p><p>Duration: {configuration.durations?.find(d=>d.id===room.durationId)?.label??room.durationId}; {room.capturedPricingQuantity ?? 1} unit(s)</p><p>{room.adults} adults · {room.children} children</p><p>Captured accommodation: {new Intl.NumberFormat('en-PH',{style:'currency',currency:room.capturedCurrency}).format(room.capturedRoomPrice)}</p>
    {room.actualCheckInAt&&<p>Actual check-in: {date(room.actualCheckInAt)}</p>}{room.actualCheckOutAt&&<p>Actual checkout: {date(room.actualCheckOutAt)}</p>}
    <div className="mt-2 flex gap-2">{(['check-in','check-out'] as const).map(action=>{const blocked=reason(room,configuration,action,now);return <button key={action} type="button" aria-label={`${action==='check-in'?'Check in':'Check out'} room ${room.roomNumber}`} title={blocked} disabled={!!blocked||!commands?.allocationLifecycle||commands.busy} onClick={()=>void act(action,room.allocationId!)} className="rounded border px-3 py-2 text-sm disabled:opacity-40">{action==='check-in'?'Check In':'Check Out'}</button>;})}</div>
    {room.allocationState==='checked_in'&&room.checkOut.getTime()<now&&<p className="mt-2 font-semibold text-red-700">Overdue: physical occupancy remains locked until checkout.</p>}
  </article>)}</div>{notice&&<p role="alert" className="mt-3 text-rose-700">{notice}</p>}
 </section>;
}
