import {useState} from 'react';
import {useApi} from '../../app/api/useApi';
import {useMutation} from '../../app/api/useMutation';
import {collectionDecimal} from '../../app/api/collections';
import type {AllocationInput,CollectionRead} from '../../app/api/collections';
import {parseMinor} from '../../lib/channelFinance';

export function PaymentAllocationControls({id,data,onReload}:{id:string;data:CollectionRead;onReload:()=>Promise<CollectionRead|undefined>}){
 const api=useApi(),summary=data.summary;
 const [kind,setKind]=useState<'allocate'|'release'>('allocate'),[payment,setPayment]=useState(''),[component,setComponent]=useState<'accommodation'|'hotel_charges'>('hotel_charges');
 const [release,setRelease]=useState(''),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[notice,setNotice]=useState(''),[committed,setCommitted]=useState(false),[reviewing,setReviewing]=useState(false);
 const mutation=useMutation((body:AllocationInput,key:string)=>api.client.allocatePayment(id,body,key),`hms-payment-allocation:${api.client.baseUrl}:${api.data!.references.company.id}:${id}`);
 const history=summary.allocation_history??[];
 const active=history.filter(row=>row.kind==='allocate').map(row=>({...row,remaining:row.amount_minor-history.filter(event=>event.release_of===row.id).reduce((total,event)=>total+event.amount_minor,0)})).filter(row=>row.remaining>0);
 const capacities=summary.payment_capacities??[];
 const money=(value:number|null|undefined)=>value===null||value===undefined?'Requires review':`PHP ${collectionDecimal(value)}`;
 async function finish(result:unknown){if(!result)return;setCommitted(true);setNotice('Allocation command committed. Reload latest context before another write.');const refreshed=await onReload();if(refreshed){setCommitted(false);setAmount('');setReason('');setNotice('Allocation history and current funds reloaded.');}}
 async function reload(){setReviewing(true);try{const refreshed=await onReload();if(refreshed){setCommitted(false);mutation.reviewedLatest();setNotice('Latest context loaded. Review your retained allocation draft before saving.');}}finally{setReviewing(false);}}
 return <section aria-label="Payment allocations" className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">Payment allocation and unapplied funds</h3>
 <dl>{[['Allocated hotel funds',summary.allocated_hotel_minor],['Unapplied hotel payment funds',summary.unapplied_hotel_minor],['Verified OTA obligation coverage',summary.allocated_channel_minor],['Unapplied channel funds (not hotel cash)',summary.unapplied_channel_minor]].map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{money(value as number|undefined)}</dd></div>)}</dl>
 <p>Discounts reduce charges; they never create transferable cash. OTA accommodation funds cannot pay hotel extras. Unclassified adjustments require review before allocation. A signed credit is not automatic refund permission.</p>
 {capacities.map(row=><p key={row.payment_id}>{row.payment_id} / {row.collector}: remaining original funds {money(row.remaining_minor)}; allocated {money(row.allocated_minor)}; unapplied {money(row.unapplied_minor)}; refund capacity {money(row.refundable_minor)} (subject to B7 correction rules).</p>)}
 {notice&&<p role="status">{notice}</p>}{mutation.error&&<p role="alert">{mutation.error}</p>}
 <button type="button" disabled={mutation.pending||mutation.uncertain||reviewing} onClick={()=>void reload()}>Reload and review allocation context</button>
 {mutation.uncertain&&<button type="button" disabled={mutation.pending} onClick={()=>void mutation.retryOriginal().then(finish)}>Confirm original allocation request</button>}
 <form onSubmit={e=>{e.preventDefault();try{const parsed=parseMinor(amount,'PHP');if(!parsed)throw Error('Enter a positive allocation amount');const original=active.find(row=>row.id===release);void mutation.submit({expected_version:summary.reservation_version,expected_pricing_id:summary.pricing_id,expected_obligation_id:summary.allocation_obligation_id??null,kind,payment_id:kind==='release'?original?.payment_id??'':payment,component:kind==='release'?original?.component??component:component,amount_minor:parsed,release_of:kind==='release'?release:null,reason}).then(finish);}catch(error){setNotice(error instanceof Error?error.message:'Invalid allocation amount');}}}>
 <fieldset disabled={mutation.pending||mutation.uncertain||mutation.conflict||committed||reviewing} className="grid gap-3 sm:grid-cols-2">
 <label>Allocation action<select value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="allocate">Apply available hotel funds</option><option value="release">Release an active allocation</option></select></label>
 {kind==='allocate'?<><label>Original hotel payment<select required value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Choose payment</option>{capacities.filter(row=>row.collector==='hotel'&&row.unapplied_minor>0).map(row=><option key={row.payment_id} value={row.payment_id}>{row.payment_id}: {money(row.unapplied_minor)}</option>)}</select></label><label>Target obligation component<select value={component} onChange={e=>setComponent(e.target.value as typeof component)}><option value="accommodation">Accommodation</option><option value="hotel_charges">Hotel meals / extras</option></select></label></>:<label>Original active allocation<select required value={release} onChange={e=>setRelease(e.target.value)}><option value="">Choose allocation</option>{active.map(row=><option key={row.id} value={row.id}>{row.id} / {row.component}: {money(row.remaining)}</option>)}</select></label>}
 <label>Allocation amount (PHP)<input required value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Allocation review reason<input required value={reason} onChange={e=>setReason(e.target.value)}/></label><button>Save reviewed allocation</button>
 </fieldset></form>
 <details><summary>Allocation and release history ({history.length})</summary>{history.map(row=><p key={row.id}>{row.id}: {row.kind} / payment {row.payment_id} / target {id}:{row.component} / {money(row.amount_minor)} / pricing {row.pricing_id} / obligation {row.obligation_id??'canonical'} / release of {row.release_of??'none'} / {row.provenance}: {row.reason} / {row.actor} / {row.recorded_at}</p>)}</details>
 </section>;
}
