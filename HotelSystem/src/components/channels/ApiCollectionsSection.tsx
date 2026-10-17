import {useEffect,useState} from 'react';
import {useApi} from '../../app/api/useApi';
import {useMutation} from '../../app/api/useMutation';
import {duplicateReview,emptyCollection,collectionDecimal} from '../../app/api/collections';
import type {CollectionRead,CollectionInput,ObligationInput,CollectionRecord} from '../../app/api/collections';
import type {ReservationSnapshot} from '../../types/reservation';
import {CollectionFields,ObligationFields} from './CollectionFields';
import {PaymentAllocationControls} from './PaymentAllocationControls';

export function ApiCollectionsSection({reservation}:{reservation:ReservationSnapshot}){
 const api=useApi();
 const [data,setData]=useState<CollectionRead>(),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false);
 const [draft,setDraft]=useState(emptyCollection),[obligation,setObligation]=useState<ObligationInput>({status:'unknown',evidence:''});
 const [context,setContext]=useState('current'),[version,setVersion]=useState(reservation.serverVersion!),[reviewed,setReviewed]=useState(false);
 const [history,setHistory]=useState<{id:string;source_id:string;source_label:string}[]>([]);
 const [committed,setCommitted]=useState(false);
 const [generation,setGeneration]=useState(0);
 const scope=`hms-collections:${api.client.baseUrl}:${api.data!.references.company.id}:${reservation.id}`;
 const mutation=useMutation((body:CollectionInput&{expected_version:number},key:string)=>api.client.recordCollection(reservation.id,body,key),scope);
 const review=useMutation((body:ObligationInput&{expected_version:number;expected_pricing_id:string;expected_capture_id:string|null},key:string)=>api.client.reviewObligation(reservation.id,body,key),`${scope}:basis`);
 const busy=loading||mutation.pending||review.pending;
 async function reload(){
  setLoading(true);setReviewed(false);
  try{
   const [value,captures]=await Promise.all([api.client.collections(reservation.id),api.client.bookingFinancialHistory(reservation.id)]);
   setData(value);setHistory(captures);setVersion(value.summary.reservation_version);setCommitted(false);setReviewed(true);
   mutation.reviewedLatest();review.reviewedLatest();
   setNotice(`Loaded reservation v${value.summary.reservation_version}. Review preserved draft and current balances before saving.`);
   return value;
  }catch(error){setNotice(error instanceof Error?error.message:'Unable to load collection history.');}finally{setLoading(false);}
 }
 useEffect(()=>{
  let active=true;
  Promise.all([api.client.collections(reservation.id),api.client.bookingFinancialHistory(reservation.id)]).then(([value,captures])=>{
   if(!active)return;setData(value);setHistory(captures);setVersion(value.summary.reservation_version);setReviewed(true);
   setDraft(previous=>({...previous,source_id:value.summary.source_id,capture_id:value.summary.capture_id}));
  }).catch(error=>{if(active)setNotice(error instanceof Error?error.message:'Unable to load collection history.');});
  return ()=>{active=false;};
 },[api.client,reservation.id]);
 async function finish(result:unknown){if(!result)return;setCommitted(true);setReviewed(false);setGeneration(value=>value+1);setDraft({...emptyCollection(),source_id:draft.source_id,capture_id:draft.capture_id});setNotice('Record committed. Reload before another write.');try{await api.loadReservation(reservation.id);await reload();}catch{setNotice('Record committed; reload failed. Use Reload latest context, not a new write.');}}
 const summary=data?.summary;
 const money=(amount:number|null|undefined)=>amount===null||amount===undefined?'Unknown / requires review':`PHP ${collectionDecimal(amount)}`;
 function selectOriginal(record:CollectionRecord|undefined){
  if(!record){setDraft({...draft,related_transaction_id:null});return;}
  setDraft({...draft,related_transaction_id:record.id,collector:record.collector,component:record.component,source_id:record.source_id,capture_id:record.capture_id,payment_method:record.payment_method,amount_minor:0});
 }
 return <section aria-label="Guest collections" className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="text-lg font-semibold">Guest collection / refund / reversal</h2>
 <button type="button" disabled={busy||mutation.uncertain||review.uncertain} onClick={()=>void reload()}>Reload latest context and review</button>
 {notice&&<p role="status">{notice}</p>}{mutation.error&&<p role="alert">{mutation.error}</p>}{review.error&&<p role="alert">{review.error}</p>}
 {mutation.uncertain&&<button disabled={busy} onClick={()=>void mutation.retryOriginal().then(finish)}>Confirm original collection request</button>}
 {review.uncertain&&<button disabled={busy} onClick={()=>void review.retryOriginal().then(finish)}>Confirm original obligation request</button>}
 {summary&&<><dl className="grid gap-2 sm:grid-cols-2">{[['Guest accommodation obligation',summary.accommodation_obligation_minor],['Accommodation residual',summary.accommodation_residual_minor],['Separately payable hotel charges',summary.hotel_charges_minor],['Hotel charges residual',summary.hotel_charges_residual_minor],['Net hotel collection',summary.net_hotel_minor],['Verified channel collection (not hotel receipt)',summary.net_channel_minor],['Guest balance (negative is credit for review)',summary.guest_balance_minor]].map(([label,amount])=><div key={label as string}><dt>{label}</dt><dd>{money(amount as number|null)}</dd></div>)}</dl><p>Coverage: {summary.coverage_status}. {summary.unresolved_components.join(', ')}. Channel payout: not recorded (B8).</p><p>Reported OTA guest amount: {money(reservation.bookingFinancialCapture?.input.guest_paid_minor)}. Hotel contractual accommodation: {money(reservation.bookingFinancialCapture?.figures.contractual_accommodation_minor)}.</p>
 {summary.obligation&&<p>Last obligation review: {summary.obligation.evidence} / {summary.obligation.recorded_at}. A pricing or commercial change requires new review.</p>}
 <details><summary>Review guest accommodation obligation</summary><form onSubmit={e=>{e.preventDefault();void review.submit({...obligation,expected_version:version,expected_pricing_id:summary.pricing_id,expected_capture_id:summary.capture_id}).then(finish);}}><fieldset disabled={busy||committed||!reviewed||mutation.uncertain||review.uncertain}><ObligationFields value={obligation} onChange={setObligation}/><button>Save reviewed obligation</button></fieldset></form></details>
 <details><summary>Record verified collection / refund / reversal</summary><form onSubmit={e=>{e.preventDefault();void mutation.submit({...draft,expected_version:version}).then(finish);}}><fieldset disabled={busy||committed||!reviewed||mutation.uncertain||review.uncertain} className="space-y-3">
 <label>Transaction<select value={draft.kind} onChange={e=>{setContext('current');setDraft({...emptyCollection(),kind:e.target.value as CollectionInput['kind'],source_id:summary.source_id,capture_id:summary.capture_id});}}>{['collection','refund','reversal'].map(kind=><option key={kind}>{kind}</option>)}</select></label>
 {draft.kind==='collection'?<label>Collection ledger<select value={context} onChange={e=>{setContext(e.target.value);const selected=history.find(c=>c.id===e.target.value);setDraft({...draft,source_id:selected?.source_id??summary.source_id,capture_id:selected?.id??summary.capture_id});}}><option value="current">Current source/capture at draft review</option>{history.map(c=><option key={c.id} value={c.id}>Preserved: {c.source_label} / {c.id}</option>)}</select></label>:<label>Original collection<select value={draft.related_transaction_id??''} onChange={e=>selectOriginal(data.items.find(row=>row.id===e.target.value))}><option value="">Select original collection</option>{data.items.filter(row=>row.kind==='collection').map(row=><option key={row.id} value={row.id}>{row.id} / {row.collector} / {money(row.amount_minor)}</option>)}</select></label>}
 <p>Draft attribution: source {draft.source_id} / capture {draft.capture_id??'direct'}. Reload preserves this attribution; explicitly select a ledger to change it.</p>
 <CollectionFields key={`${generation}:${draft.kind}:${draft.related_transaction_id??''}`} value={draft} onChange={setDraft} review={duplicateReview(mutation.failure)}/>
 <button disabled={draft.amount_minor<=0||(draft.kind!=='collection'&&!draft.related_transaction_id)}>Record verification</button></fieldset></form></details>
 <details><summary>Source totals and obligation review history</summary>{summary.source_rollups?.map(row=><p key={row.source_id}>{row.source_id}: hotel {money(row.hotel_minor)}; channel {money(row.channel_minor)}</p>)}{summary.obligation_history?.map(row=><p key={row.id}>{row.recorded_at} / {row.status}: {money(row.accommodation_minor)} / {row.evidence}</p>)}</details>
 <PaymentAllocationControls id={reservation.id} data={data} onReload={async()=>{try{await api.loadReservation(reservation.id);return await reload();}catch{setNotice('Allocation committed or context changed; reload failed. Reload before another write.');return undefined;}}}/>
 <h3>Immutable collection history ({data.total})</h3>{data.items.map(row=><p key={row.id}>{row.kind} / {row.collector} / {row.component}: {money(row.amount_minor)} / {row.reference||row.id} / {row.payment_method??'channel evidence'} / {row.declaration} / {row.actor} / {row.recorded_at} / {row.source_label} / booking {row.external_reference||'none'} / capture {row.capture_id??'direct'} / original {row.related_transaction_id??'none'} / {row.reason}</p>)}
 {data.items.length<data.total&&<button disabled={busy} onClick={async()=>{setLoading(true);try{const next=await api.client.collections(reservation.id,data.items.length);setData({...next,items:[...data.items,...next.items]});}catch(error){setNotice(String(error));}finally{setLoading(false);}}}>Load older transactions</button>}
 </>}
 </section>;
}
