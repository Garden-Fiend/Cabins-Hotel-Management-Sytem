import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useReservationDemo } from "../../app/useReservationDemo";
import { useApi } from "../../app/api/useApi";
import { useMutation } from "../../app/api/useMutation";
import { billingError, billMoney, billDate, checkedDocument } from "../../app/api/billingDocuments";
import type { BillingDocumentDto } from "../../app/api/billingDocuments";
import { InventoryDialog } from "../../features/inventory/InventoryDialog";
import { BillingDocumentContents } from "./BillingDocumentContents";

const button="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40";
export function BillingDocumentsSection({reservationId}:{reservationId:string}){
  const {mode}=useReservationDemo();
  return <section aria-label="Billing Documents" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold">Billing Documents</h2>
    {mode==="api" ? <ApiBillingDocuments key={reservationId} reservationId={reservationId}/> : <p className="mt-2 text-sm">Billing documents are API-backed functionality. Demo mode does not create or finalize documents.</p>}
  </section>;
}

export function ApiBillingDocuments({reservationId}:{reservationId:string}){
  const api=useApi(),client=api.client,company=api.data!.references.company.id;
  const live=api.data!.reservations.find(r=>r.id===reservationId);
  const [documents,setDocuments]=useState<BillingDocumentDto[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(true),[readError,setReadError]=useState("");
  const [selected,setSelected]=useState<string|null>(null),[confirm,setConfirm]=useState(false),[notice,setNotice]=useState("");
  const [preparing,setPreparing]=useState(false),running=useRef(false),generation=useRef(0);
  const scope=`hms-billing:${client.baseUrl}:${company}:${reservationId}`;
  const create=useMutation(async(body:{expected_reservation_version:number},key:string)=>checkedDocument(await client.createBillingDraft(reservationId,body,key),company,reservationId,true),`${scope}:create`,billingError);
  const finalize=useMutation(async(input:{id:string;expected_version:number},key:string)=>checkedDocument(await client.finalizeBill(input.id,{expected_version:input.expected_version},key),company,reservationId,true,input.id),`${scope}:finalize`,billingError);
  const load=useCallback(async()=>{
    const current=++generation.current;setLoading(true);setReadError("");
    try{const records=await client.billingDocuments(reservationId);records.forEach(r=>checkedDocument(r,company,reservationId));if(current===generation.current){setDocuments(records);setLoaded(true);return true;}return false;}
    catch(error){if(current===generation.current)setReadError(billingError(error));return false;}
    finally{if(current===generation.current)setLoading(false);}
  },[client,company,reservationId]);
  useEffect(()=>{const marker=generation;const startup=window.setTimeout(()=>void load(),0);return()=>{window.clearTimeout(startup);marker.current++;};},[load]);
  function install(record:BillingDocumentDto){setDocuments(current=>[...current.filter(d=>d.id!==record.id),current.find(d=>d.id===record.id && d.version>record.version) ?? record]);}
  async function accept(record:BillingDocumentDto){
    generation.current++;install(record);setSelected(record.id);setConfirm(false);setNotice("Server commit confirmed. Reloading the authoritative document.");
    try{const latest=checkedDocument(await client.billingDocument(record.id),company,reservationId,false,record.id);install(latest);setNotice(latest.status==="finalized" ? "Finalization confirmed by the server." : "Billing draft committed. Review its captured contents.");await load();}
    catch(error){setReadError(`Commit confirmed, but reloading failed: ${billingError(error)} Displaying the last confirmed document.`);setLoading(false);}
  }
  async function execute(action:()=>Promise<BillingDocumentDto|undefined>){
    if(running.current)return;running.current=true;setPreparing(true);setNotice("");
    try{const result=await action();if(result)await accept(result);}
    catch(error){setReadError(billingError(error));}
    finally{running.current=false;setPreparing(false);}
  }
  async function reload(){
    if(running.current)return;running.current=true;setPreparing(true);setReadError("");
    try{await api.loadReservation(reservationId);if(await load()){create.reviewedLatest();finalize.reviewedLatest();}}catch(error){setReadError(billingError(error));}finally{running.current=false;setPreparing(false);}
  }
  async function review(id:string){if(running.current)return;running.current=true;setPreparing(true);setReadError("");try{const record=checkedDocument(await client.billingDocument(id),company,reservationId,false,id);install(record);setSelected(id);setConfirm(false);}catch(error){setReadError(billingError(error));}finally{running.current=false;setPreparing(false);}}
  const doc=documents.find(d=>d.id===selected),finalized=documents.some(d=>d.status==="finalized");
  const currentDraft=documents.some(d=>d.status==="draft" && d.source_reservation_version===live?.version);
  const uncertain=create.uncertain || finalize.uncertain,busy=preparing || create.pending || finalize.pending;
  const stale=doc?.status==="draft" && doc.source_reservation_version!==live?.version;
  const eligible=!!live && ["confirmed","reserved","checked_in","checked_out"].includes(live.status);
  const controls=<>
    {busy && <p role="status">Loading or saving billing document…</p>}
    {doc?.status==="draft" && <button className={button} disabled={loading || busy} onClick={()=>void reload()}>Reload documents and reservation</button>}
    {readError && <p role="alert">{readError}</p>}
    {create.error && <p role="alert">{create.error}</p>}{finalize.error && <p role="alert">{finalize.error}</p>}
    {notice && <p role="status">{notice}</p>}
    {create.uncertain && <button className={button} disabled={busy} onClick={()=>void execute(create.retryOriginal)}>Retry original draft request</button>}
    {finalize.uncertain && <button className={button} disabled={busy} onClick={()=>void execute(finalize.retryOriginal)}>Retry original finalization request</button>}
  </>;
  return <div className="mt-3 space-y-3">
    <p className="text-sm">Current Reservation Billing remains editable operational state. Billing Documents preserve fixed historical snapshots.</p>
    {loading && <p role="status">Loading billing documents…</p>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!loaded || loading || busy || uncertain || !eligible || finalized || currentDraft} onClick={()=>void execute(async()=>{const source=await api.loadReservation(reservationId);return create.submit({expected_reservation_version:source.version});})}>Create Billing Draft</button>
      <button className={button} disabled={loading || busy} onClick={()=>void reload()}>Reload documents and reservation</button></div>
    {currentDraft && !finalized && <p>An existing draft captures this reservation version. Review it before creating another.</p>}
    {finalized && <p>A finalized bill already exists. Further bills require the future correction workflow.</p>}
    {!doc && controls}
    {loaded && !documents.length && <p>No billing documents have been created for this reservation.</p>}
    {!!documents.length && <ul className="space-y-2">{documents.map(d=><li key={d.id} className="rounded-lg border p-3"><p className="font-semibold">{d.status==="finalized" ? `Finalized · ${d.number}` : "Draft"} · {billMoney(d.total_minor)}</p><p>Created: {billDate(d.created_at)}{d.finalized_at ? ` · Finalized: ${billDate(d.finalized_at)}` : ""}</p>
      {d.status==="draft" && d.source_reservation_version!==live?.version && <p className="text-amber-800">Source changed — this draft is stale. Review before explicitly creating a new draft.</p>}
      <button className={button} disabled={busy} onClick={()=>void review(d.id)}>View {d.number ?? "draft"}</button> <Link className="underline" to={`/billing-documents/${d.id}/print`}>Print {d.number ?? "draft"}</Link></li>)}</ul>}
    {doc && <InventoryDialog title="Billing Document" onClose={()=>{if(!busy){setSelected(null);setConfirm(false);}}}>
      {controls}<p className="my-3 rounded-lg bg-sky-50 p-3">Current Reservation Billing: {live ? billMoney(live.pricing.snapshot.total_minor) : "Unavailable"}; captured Billing Document: {billMoney(doc.total_minor)}. Reservation version {live?.version ?? "unknown"}; captured version {doc.source_reservation_version}.</p>
      {stale && <p role="alert">This draft is stale. Its capture is unchanged. Reload documents and reservation, review, then explicitly create a new draft.</p>}
      <BillingDocumentContents document={doc} companyName={api.data?.references.company.name}/>
      <Link className="underline" to={`/billing-documents/${doc.id}/print`}>Print operational statement</Link>
      {doc.status==="draft" && <button className={`${button} ml-3`} disabled={busy || uncertain || stale || finalized} onClick={()=>setConfirm(true)}>Finalize Bill</button>}
      {confirm && doc.status==="draft" && <section role="alertdialog" aria-label="Finalize bill confirmation" className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4"><h2 className="font-bold">Finalize this bill?</h2><p>The captured document will become immutable and receive a permanent internal bill number. Later reservation changes will not modify it. A finalized bill cannot be reopened or deleted through the application.</p><button className={button} disabled={busy || uncertain || stale} onClick={()=>void execute(()=>finalize.submit({id:doc.id,expected_version:doc.version}))}>Confirm finalization</button> <button className={button} disabled={busy} onClick={()=>setConfirm(false)}>Cancel finalization</button></section>}
    </InventoryDialog>}
  </div>;
}
