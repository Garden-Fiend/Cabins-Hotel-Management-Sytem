import {useState} from 'react';
import {useReservationDemo} from '../../app/useReservationDemo';
import {useApi} from '../../app/api/useApi';
import {useMutation} from '../../app/api/useMutation';
import type {ReservationSnapshot} from '../../types/reservation';
import type {BookingFinancialCapture,BookingFinancialInput} from '../../app/api/bookingFinancials';
import {presentReservation} from '../../app/api/presentation';
import {presentAgreement,presentSource} from '../../app/api/sourceInputs';
import {applicableAgreement} from '../../lib/channelFinance';
import {ApiBookingFinancialFields} from './ApiBookingFinancialFields';
import {emptyBookingFinancials} from '../../app/api/bookingFinancials';
import {BookingFinancialContents} from './BookingFinancialContents';
import {InventoryDialog} from '../../features/inventory/InventoryDialog';

export function BookingFinancialSection({reservation}:{reservation:ReservationSnapshot}){
 const {mode}=useReservationDemo();
 return mode==='api'?<ApiBookingFinancialSection key={reservation.id} reservation={reservation}/>:null;
}
function ApiBookingFinancialSection({reservation}:{reservation:ReservationSnapshot}){
 const api=useApi();
 const [refs,setRefs]=useState(api.data!.references);
 const sources=refs.booking_sources.map(presentSource),agreements=(refs.source_agreements??[]).map(presentAgreement);
 const [open,setOpen]=useState(false),[sourceId,setSourceId]=useState(reservation.bookingSourceId);
 const source=sources.find(s=>s.id===sourceId)!;
 const [draft,setDraft]=useState<BookingFinancialInput>(()=>structuredClone(reservation.bookingFinancialCapture?.input??emptyBookingFinancials(source)));
 const [reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[valid,setValid]=useState(true);
 const [version,setVersion]=useState(reservation.serverVersion!),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [history,setHistory]=useState<BookingFinancialCapture[]>([]),[committed,setCommitted]=useState<BookingFinancialCapture>();
 const mutation=useMutation(async(body:{expected_version:number;booking_source_id:string;booking_financials:BookingFinancialInput;reason:string},key:string)=>{
  const saved=await api.client.correctBookingFinancials(reservation.id,body,key);presentReservation(saved);return saved;
 },`hms-booking-financials:${api.client.baseUrl}:${api.data!.references.company.id}:${reservation.id}`);
 async function finish(saved:Awaited<ReturnType<typeof mutation.submit>>){
  if(!saved)return;setCommitted(saved.pricing.snapshot.channel);setNotice('Correction committed. Reloading the saved reservation.');
  try{await api.loadReservation(reservation.id);setHistory(await api.client.bookingFinancialHistory(reservation.id));setOpen(false);setReviewed(false);setVersion(saved.version);setCommitted(undefined);setNotice('Reviewed correction saved; previous captures retained.');}
  catch(error){setNotice(`Correction is saved. Reload the reservation before another correction. ${error instanceof Error?error.message:''}`);}
 }
 async function review(){setBusy(true);try{
  const [latest,references]=await Promise.all([api.loadReservation(reservation.id),api.client.references()]);setRefs(references);setVersion(latest.version);
  const selected=references.booking_sources.find(s=>s.id===sourceId);if(!selected)throw new Error('Source no longer available.');
  const prior=latest.pricing.snapshot.channel;
  const retain=prior&&prior.source_id===sourceId&&prior.input.confirmation_date===draft.confirmation_date&&prior.agreement_id===draft.expected_agreement_id&&prior.agreement_version===draft.expected_agreement_version;
  const agreement=retain?undefined:applicableAgreement((references.source_agreements??[]).map(presentAgreement),sourceId,draft.confirmation_date);
  setDraft({...draft,expected_source_version:selected.version!,expected_agreement_id:retain?prior.agreement_id:agreement?.id??null,expected_agreement_version:retain?prior.agreement_version:agreement?.serverVersion??null});
  setNotice(`Latest reservation v${latest.version}: ${latest.booking_source_label}, contractual accommodation PHP ${latest.pricing.snapshot.channel?.figures.contractual_accommodation_minor===undefined?'not captured':(latest.pricing.snapshot.channel.figures.contractual_accommodation_minor/100).toFixed(2)}. Your draft remains below; review all changes before confirming.`);
  mutation.reviewedLatest();setReviewed(true);
 }catch(error){setReviewed(false);setNotice(error instanceof Error?error.message:'Review failed');}finally{setBusy(false);}}
 const captured=committed??reservation.bookingFinancialCapture;
 return <section aria-label="Booking source financials" className="rounded-2xl border bg-white p-5 space-y-3">
  <h2 className="text-lg font-semibold">Booking source financials</h2>
  {captured?<BookingFinancialContents capture={captured}/>:<p>No commercial financial capture exists for this legacy/direct booking. No agreement has been inferred.</p>}
  {notice&&<p role="status">{notice}</p>}{mutation.error&&<p role="alert">{mutation.error}</p>}
  <button type="button" className="rounded border p-2" disabled={mutation.pending||Boolean(committed)} onClick={()=>setOpen(true)}>Review source / financial correction</button>
  <button type="button" className="ml-2 rounded border p-2" disabled={busy||mutation.pending} onClick={()=>{setBusy(true);void api.client.bookingFinancialHistory(reservation.id).then(setHistory).catch(e=>setNotice(e.message)).finally(()=>setBusy(false));}}>Load captured financial history</button>
  {history.map(c=><details key={c.id}><summary>Capture at reservation v{c.reservation_version}: {c.reason}</summary><BookingFinancialContents capture={c}/></details>)}
  {mutation.uncertain&&<button disabled={mutation.pending||busy} onClick={()=>{void mutation.retryOriginal().then(finish);}}>Confirm original financial correction request</button>}
  {open&&<InventoryDialog title="Review booking source and financial correction" onClose={()=>{if(!mutation.pending&&!mutation.uncertain&&!busy)setOpen(false);}}>
   <fieldset disabled={mutation.pending||busy||mutation.uncertain||Boolean(committed)} className="space-y-3">
    <p>Original source: {reservation.bookingSourceLabel}. Prior captures will remain. Finalized bills block this operation.</p>
    <label>Booking source<select className="block w-full rounded border p-2" value={sourceId} onChange={e=>{const selected=sources.find(s=>s.id===e.target.value)!;setSourceId(selected.id);setDraft(emptyBookingFinancials(selected));setReviewed(false);}}>{sources.map(s=><option key={s.id} value={s.id} disabled={!s.enabled&&s.id!==reservation.bookingSourceId}>{s.label}</option>)}</select></label>
    <ApiBookingFinancialFields captured={reservation.bookingFinancialCapture} key={sourceId} source={source} agreements={agreements} value={draft} onChange={next=>{setDraft(next);setReviewed(false);}} onValidity={setValid}/>
    <label>Correction reason<input className="block w-full rounded border p-2" value={reason} onChange={e=>{setReason(e.target.value);setReviewed(false);}}/></label>
    <button type="button" className="rounded border p-2" onClick={()=>{void review();}}>Load latest and review correction</button>
    <button type="button" className="ml-2 rounded border p-2" disabled={!reviewed||!reason.trim()||!valid} onClick={()=>{void mutation.submit({expected_version:version,booking_source_id:sourceId,booking_financials:draft,reason}).then(finish);}}>Confirm reviewed financial correction</button>
   </fieldset>
  </InventoryDialog>}
 </section>;
}
