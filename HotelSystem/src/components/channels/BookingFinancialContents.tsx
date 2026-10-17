import type {BookingFinancialCapture} from '../../app/api/bookingFinancials';
import {billMoney} from '../../app/api/billingDocuments';

export function BookingFinancialContents({capture:c}:{capture:BookingFinancialCapture}){
 const f=c.figures;
 return <div className="space-y-2 text-sm">
  <p>{c.source_label} · external reference: {c.input.external_reference||'Not supplied'} · confirmation date: {c.input.confirmation_date}</p>
  <p>{c.provenance==='published_agreement'?`Captured agreement v${c.agreement_revision}`:`Manually specified arrangement: ${c.input.manual_reason}`}</p>
  <dl className="grid gap-2 sm:grid-cols-2">{[
   ['Standard accommodation',billMoney(f.standard_accommodation_minor)],
   ['Accommodation after hotel reductions',billMoney(f.discounted_accommodation_minor)],
   ['Contractual accommodation',billMoney(f.contractual_accommodation_minor)],
   ['Accommodation replacement effect',billMoney(f.accommodation_adjustment_minor)],
   ['Additional charges at commercial capture',billMoney(f.additional_charges_minor)],
   ['Guest accommodation amount',f.guest_paid_minor===null?'Unknown':`${billMoney(f.guest_paid_minor)} (${f.guest_paid_status.replaceAll('_',' ')})`],
   ['Guest/contract difference classification',f.difference_classification.replaceAll('_',' ')],
   ['Commission obligation',`${billMoney(f.commission_minor)}; ${c.input.manual_commission_minor!=null&&c.terms.commission.method!=='manual'?'booking-specific override':c.terms.commission.method}`],
   ['Commission basis',f.commission_basis_minor===null?'Not required / not supplied':billMoney(f.commission_basis_minor)],
   ['Collection responsibility',f.collection],['Settlement method',f.settlement_method.replaceAll('_',' ')],
   ['Expected channel remittance',f.expected_settlement_minor===null?'Not determined':billMoney(f.expected_settlement_minor)],
   ['Bill total at commercial capture',billMoney(f.total_minor)],
  ].map(([label,value])=><div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>
  <p>These are contractual expectations and reported booking facts. No hotel payment receipt or settlement is recorded here. Later operational edits may change the bill; its current total is shown separately.</p>
  <p>Capture reason: {c.reason}{c.input.override_reason?`; ${c.input.override_reason}`:''}</p>
 </div>;
}
