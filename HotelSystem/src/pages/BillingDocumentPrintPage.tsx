import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../app/api/useApi";
import type { BillingDocumentDto } from "../app/api/billingDocuments";
import { checkedDocument, billingError } from "../app/api/billingDocuments";
import { BillingDocumentContents } from "../components/billing/BillingDocumentContents";

export function BillingDocumentPrintPage(){
  const {documentId=""}=useParams(),api=useApi(),client=api.client;
  const [record,setRecord]=useState<BillingDocumentDto|null>(null),[error,setError]=useState(""),[attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true);
  useEffect(()=>{const abort=new AbortController();const startup=window.setTimeout(()=>{setLoading(true);setError("");setRecord(null);client.billingDocument(documentId,abort.signal).then(r=>{if(r.id!==documentId)throw new Error("Billing document identity mismatch.");if(!abort.signal.aborted)setRecord(checkedDocument(r));}).catch(e=>{if(!abort.signal.aborted)setError(billingError(e));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});},0);return()=>{window.clearTimeout(startup);abort.abort();};},[client,documentId,attempt]);
  return <main className="mx-auto min-h-screen max-w-6xl space-y-4 bg-white p-6">
    <style>{`@media print { @page {margin:14mm} .billing-print-controls {display:none!important} body {background:white!important} [data-billing-document] {padding:0!important} table {font-size:10px!important} tr {break-inside:avoid} }`}</style>
    <div className="billing-print-controls space-x-4">{record?.id===documentId && <><Link className="underline" to={`/reservations/${record.reservation_id}`}>Back to reservation</Link><button className="rounded-lg border px-4 py-2" onClick={()=>window.print()}>Print statement</button></>}</div>
    {loading && <p role="status">Loading persisted billing document…</p>}{error && <div role="alert">{error}<button className="billing-print-controls ml-3 underline" onClick={()=>setAttempt(a=>a+1)}>Retry document read</button></div>}
    {record?.id===documentId && <BillingDocumentContents document={record} companyName={api.data?.references.company.id===record.company_id ? api.data.references.company.name : undefined}/>}
  </main>;
}
