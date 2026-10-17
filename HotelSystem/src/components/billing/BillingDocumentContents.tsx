import type { BillingDocumentDto } from "../../app/api/billingDocuments";
import {BookingFinancialContents} from '../channels/BookingFinancialContents';
import { billMoney, billDate } from "../../app/api/billingDocuments";

export function BillingDocumentContents({document:doc,companyName}:{document:BillingDocumentDto;companyName?:string}){
  const pricing=doc.capture.pricing.snapshot;
  return <article data-billing-document className="space-y-4 bg-white p-5 text-slate-900">
    <header><h1 className="text-2xl font-bold">Operational Billing Statement</h1>
      <p className="text-lg font-bold">{doc.status==="draft" ? "DRAFT — not finalized" : `Finalized · ${doc.number}`}</p>
      {companyName && <p>{companyName} <span className="text-xs">(current company name)</span></p>}<p className="text-xs">Company ID: {doc.company_id}</p>
      <p>Billing Document — fixed historical snapshot</p><p>Document ID: {doc.id}</p>
      <p>Created: {billDate(doc.created_at)}</p>{doc.finalized_at && <p>Finalized: {billDate(doc.finalized_at)}</p>}
      <p>Guest: {doc.capture.guest.name}</p><p>Reservation: {doc.capture.reservation_reference}</p>
      <p>{billDate(doc.capture.scheduled_start)} – {billDate(doc.capture.scheduled_end)}</p>
      <p className="text-xs">Source reservation version {doc.source_reservation_version}; pricing revision {doc.capture.pricing.revision}. This is not a tax invoice, official receipt or accounting posting.</p>
    </header>
    {doc.capture.allocations&&<section aria-label="Captured room stays"><h2 className="font-semibold">Captured room stays</h2>{doc.capture.allocations.map(room=>{
      const line=pricing.lines.find(line=>line.allocation_id===room.id);
      return <p key={room.id}>Room {room.room_number}: {billDate(room.scheduled_start)} – {billDate(room.scheduled_end)}; {line?.booking_kind}, {line?.quantity} {line?.booking_kind==='overnight'?'night(s)':'package'}.</p>;
    })}</section>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="text-left font-semibold">Captured charges</caption><thead><tr>{["Charge","Qty","Original unit","Effective unit","Original amount","After unit replacement","Captured reductions","Final line amount"].map(s=><th key={s} className="p-2">{s}</th>)}</tr></thead>
      <tbody>{doc.lines.map(line=><tr key={line.source_line_id} className="border-t"><td className="p-2">{line.label}<span className="block text-xs">{line.source_kind.replaceAll("_"," ")}</span></td><td>{line.quantity}</td>{(["original_unit_amount_minor","effective_unit_amount_minor","original_amount_minor","effective_amount_minor","discount_minor","final_amount_minor"] as const).map(key=><td key={key} className="p-2">{billMoney(line[key])}</td>)}</tr>)}</tbody></table></div>
    {(pricing.price_overrides ?? []).length>0 && <section><h2 className="font-semibold">Unit-price replacements</h2>{pricing.price_overrides!.map(o=><p key={o.id}>{o.label}: {billMoney(o.original_unit_amount_minor)} → {billMoney(o.replacement_unit_amount_minor)} × {o.quantity}; effect {billMoney(o.effect_minor)}</p>)}<p>Total replacement effect: {billMoney(pricing.price_override_total_minor ?? 0)}</p></section>}
    <section><h2 className="font-semibold">Discounts</h2>{(pricing.discounts ?? []).map(d=><p key={d.id}>{d.label} ({d.provenance==="preset"?"preset":"manual"}, {d.scope}): {billMoney(d.amount_minor)}</p>)}<p>Total discounts: {billMoney(pricing.discount_total_minor ?? 0)}</p></section>
    <section><h2 className="font-semibold">Signed adjustments</h2>{!(pricing.adjustments ?? []).length && <p>None</p>}{(pricing.adjustments ?? []).map(a=><p key={a.id}>{a.reason}: {billMoney(a.amount_minor)}</p>)}</section>
    {pricing.channel&&<section><h2 className="font-semibold">Captured booking financials</h2><BookingFinancialContents capture={pricing.channel}/></section>}
    <p className="border-t pt-3 text-xl font-bold">Final payable total: {billMoney(doc.total_minor)}</p>
    <p className="text-xs">Adjustments and the final zero clamp are included in the payable total. Captured values are read-only and are not recalculated from current configuration.</p>
  </article>;
}
