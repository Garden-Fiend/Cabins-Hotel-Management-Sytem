import {useState,useEffect} from 'react';
import type {BookingFinancialInput,CommercialTerms,BookingFinancialCapture} from '../../app/api/bookingFinancials';
import type {ChannelAgreement} from '../../features/channels/types';
import type {BookingSourceConfiguration} from '../../features/configuration/types';
import {applicableAgreement,createChannelTerms,parseMinor} from '../../lib/channelFinance';
import {phpDecimal} from '../../app/api/presentation';
import {ReservationChannelTermsEditor} from './ReservationChannelTermsEditor';

const input='mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export function ApiBookingFinancialFields({source,agreements,value,onChange,onValidity,onReviewDefinitions,captured}:{
 source:BookingSourceConfiguration;agreements:ChannelAgreement[];value:BookingFinancialInput;
 onChange:(value:BookingFinancialInput)=>void;onValidity:(valid:boolean)=>void;
 onReviewDefinitions?:()=>Promise<{sources:BookingSourceConfiguration[];agreements:ChannelAgreement[]}>;
 captured?:BookingFinancialCapture;
}){
 const [error,setError]=useState('');
 const [guestError,setGuestError]=useState('');
 const [reviewing,setReviewing]=useState(false),[notice,setNotice]=useState('');
 const [editorValid,setEditorValid]=useState(true);
 useEffect(()=>{onValidity(editorValid&&!error&&!guestError&&!reviewing);},[editorValid,error,guestError,reviewing,onValidity]);
 const [guest,setGuest]=useState(value.guest_paid_minor==null?'':phpDecimal(value.guest_paid_minor));
 const [manual,setManual]=useState<CommercialTerms|undefined>(value.manual_terms??undefined);
 const [method,setMethod]=useState<CommercialTerms['commission']['method']|''>(manual?.commission.method??'');
 const [collection,setCollection]=useState<CommercialTerms['payment']['collection']|''>(manual?.payment.collection??'');
 const [settlement,setSettlement]=useState<CommercialTerms['settlement']['method']|''>(manual?.settlement.method??'');
 const [basis,setBasis]=useState<CommercialTerms['commission']['basis']>(manual?.commission.basis??'confirmed_accommodation');
 const [rate,setRate]=useState(manual?String(manual.commission.rateBasisPoints/100):'');
 const [fixed,setFixed]=useState(manual?phpDecimal(manual.commission.fixedMinor):'');
 const [allow,setAllow]=useState(manual?.pricing.allowOverride??false);
 const retained=Boolean(captured&&captured.source_id===source.id&&captured.input.confirmation_date===value.confirmation_date&&captured.agreement_id===value.expected_agreement_id&&captured.agreement_version===value.expected_agreement_version);
 const historical:ChannelAgreement|undefined=retained&&captured?.agreement_id?{id:captured.agreement_id,channelId:source.id,
  version:captured.agreement_revision!,serverVersion:captured.agreement_version!,status:'active',currency:'PHP',
  effectiveFrom:captured.agreement_effective_from??captured.input.confirmation_date,effectiveTo:captured.agreement_effective_to??undefined,...captured.terms}:undefined;
 const agreement=retained?historical:value.confirmation_date?applicableAgreement(agreements,source.id,value.confirmation_date):undefined;
 const effective=agreement??(manual?{id:'manual',channelId:source.id,version:1,effectiveFrom:value.confirmation_date,
 status:'active' as const,currency:'PHP',...manual}:undefined);
 const terms={...createChannelTerms(source,effective,'PHP'),externalReference:value.external_reference,
 accommodationOverrideMinor:value.contractual_accommodation_minor??undefined,overrideReason:value.override_reason,
 referenceValueMinor:value.reference_value_minor??undefined,commissionableMinor:value.explicit_commission_basis_minor??undefined,
 commissionOverrideMinor:value.manual_commission_minor??undefined,
 collectionChoiceRequired:!value.collection,
 collection:{responsibility:value.collection??'hotel',status:'pending' as const,reference:'',transactions:[]}};
 function updateDate(date:string){
  const selected=date?applicableAgreement(agreements,source.id,date):undefined;
  onChange({...value,confirmation_date:date,expected_agreement_id:selected?.id??null,
   expected_agreement_version:selected?.serverVersion??null,expected_source_version:source.serverVersion!,
   manual_terms:selected?null:manual??null,
   collection:selected?.payment.collection==='channel'?'channel':selected?.payment.collection==='hotel'?'hotel':undefined});
 }
 async function reviewDefinitions(){
  if(!onReviewDefinitions||reviewing)return;setReviewing(true);
  try{const latest=await onReviewDefinitions();const selectedSource=latest.sources.find(s=>s.id===source.id);
   if(!selectedSource?.enabled)throw new Error('This source is disabled or missing; choose another source.');
   const selected=retained?historical:applicableAgreement(latest.agreements,source.id,value.confirmation_date);
   onChange({...value,expected_source_version:selectedSource.serverVersion!,expected_agreement_id:selected?.id??null,
    expected_agreement_version:selected?.serverVersion??null,manual_terms:selected?null:value.manual_terms});
   setError('');setNotice('Latest definitions loaded. Your amounts and reasons are retained; review the applicable terms before saving.');
  }catch(error){setError(error instanceof Error?error.message:'Unable to review current terms');}finally{setReviewing(false);}
 }
 return <fieldset disabled={reviewing} className="space-y-3">
  {onReviewDefinitions&&<button type="button" className="rounded border p-2" disabled={!editorValid||Boolean(guestError)} onClick={()=>{void reviewDefinitions();}}>Review latest source and agreement</button>}
  {notice&&<p role="status">{notice}</p>}
  <label className="block">External booking confirmation date<input aria-label="External booking confirmation date" type="date" required className={input} value={value.confirmation_date} onChange={e=>updateDate(e.target.value)}/></label>
  <p className="text-xs text-slate-600">Agreement selection uses this date, independently of arrival. {retained?`Retained captured ${agreement?`agreement v${agreement.version}`:'manual arrangement'}; current retirement or new definitions do not replace these booked terms.`:agreement?`Published agreement v${agreement.version}`:'No published agreement applies; enter a date and explicitly specify terms if needed.'}</p>
  {!agreement&&<details className="rounded-lg border p-3"><summary>Manually specified arrangement</summary>
   <p className="text-xs">These are booking-specific facts, not a published agreement.</p>
   <label>Commission method<select className={input} value={method} onChange={e=>setMethod(e.target.value as typeof method)}><option value="">Choose method</option>{['none','percentage','fixed','manual'].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Commission basis<select className={input} value={basis} onChange={e=>setBasis(e.target.value as typeof basis)}>{['confirmed_accommodation','reference_value','explicit_amount'].map(v=><option key={v}>{v}</option>)}</select></label>
   {method==='percentage'&&<label>Commission percent<input className={input} value={rate} onChange={e=>setRate(e.target.value)}/></label>}
   {method==='fixed'&&<label>Fixed commission PHP<input className={input} value={fixed} onChange={e=>setFixed(e.target.value)}/></label>}
   <label>Collection responsibility<select className={input} value={collection} onChange={e=>setCollection(e.target.value as typeof collection)}><option value="">Choose collector</option>{['hotel','channel','per_reservation'].map(v=><option key={v}>{v}</option>)}</select></label>
   <label>Settlement method<select className={input} value={settlement} onChange={e=>setSettlement(e.target.value as typeof settlement)}><option value="">Choose method</option>{['deducted','separate_invoice','offset','manual'].map(v=><option key={v}>{v}</option>)}</select></label>
   <label><input type="checkbox" checked={allow} onChange={e=>setAllow(e.target.checked)}/> Document permits accommodation override</label>
   <label>Manual arrangement reason<input className={input} value={value.manual_reason} onChange={e=>onChange({...value,manual_reason:e.target.value})}/></label>
   <button type="button" className="mt-2 rounded border p-2" onClick={()=>{try{
    if(!method||!collection||!settlement||!value.manual_reason.trim())throw new Error('Choose all arrangement terms and enter a reason.');
    const bps=method==='percentage'?parseMinor(rate,'PHP'):0;if(bps>10000)throw new Error('Commission cannot exceed 100%.');
    const selected:CommercialTerms={pricing:{allowOverride:allow,reasonRequired:true},commission:{method,basis,rateBasisPoints:bps,fixedMinor:method==='fixed'?parseMinor(fixed,'PHP'):0,allowOverride:false},payment:{collection},settlement:{method:settlement}};
    setManual(selected);onChange({...value,manual_terms:selected,collection:collection==='per_reservation'?undefined:collection});setError('');
   }catch(e){setError(e instanceof Error?e.message:'Invalid terms');}}}>Review and use manual arrangement</button>
  </details>}
  <ReservationChannelTermsEditor exactPhp key={`${source.id}:${effective?.id??'none'}:${value.confirmation_date}`} terms={terms} actor="local-development"
   capabilities={{manage_channels:false,edit_channel_terms:true,override_accommodation:true,verify_collection:false,confirm_commission:true,record_settlement:false,reconcile_settlement:false}}
   onCollection={()=>{throw new Error('Payment recording is unavailable.');}} onValidity={setEditorValid}
   onChange={next=>onChange({...value,external_reference:next.externalReference,collection:next.collectionChoiceRequired?undefined:next.collection.responsibility,
    contractual_accommodation_minor:next.accommodationOverrideMinor??null,override_reason:next.overrideReason,
    reference_value_minor:next.referenceValueMinor??null,explicit_commission_basis_minor:next.commissionableMinor??null,
    manual_commission_minor:next.commissionOverrideMinor??null})}/>
  <label className="block">Guest accommodation amount reported by booking document (PHP)<input className={input} value={guest} onChange={e=>{setGuest(e.target.value);try{onChange({...value,guest_paid_minor:e.target.value.trim()?parseMinor(e.target.value,'PHP'):null,guest_paid_status:e.target.value.trim()?'reported_paid':'unknown'});setGuestError('');}catch(error){setGuestError(error instanceof Error?error.message:'Invalid amount');}}}/></label>
  {(effective?.commission.method==='manual'||effective?.commission.allowOverride)&&<label className="block">Commission calculation reason<input className={input} value={value.override_reason} onChange={e=>onChange({...value,override_reason:e.target.value})}/></label>}
  <label>Guest amount status<select className={input} value={value.guest_paid_status} onChange={e=>onChange({...value,guest_paid_status:e.target.value as BookingFinancialInput['guest_paid_status']})}>{['unknown','reported_paid','expected'].map(v=><option key={v}>{v}</option>)}</select></label>
  <label>Guest / contractual amount difference<select className={input} value={value.difference_classification} onChange={e=>onChange({...value,difference_classification:e.target.value as BookingFinancialInput['difference_classification']})}>{['none','channel_funded','hotel_funded','unresolved'].map(v=><option key={v}>{v}</option>)}</select></label>
  <p className="text-xs text-slate-600">Contractual amount replaces accommodation only. Purchases, extras and adjustments stay separate. Reported guest payments and expected remittances do not record money received by the hotel. Saved figures are calculated by the server.</p>
  {(error||guestError)&&<p role="alert" className="text-red-700">{error||guestError}</p>}
 </fieldset>;
}
