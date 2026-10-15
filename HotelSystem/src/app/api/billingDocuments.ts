import { ApiError } from "./client";
import type { ReservationDto, GuestDto } from "./contracts";
import { apiInstant, formatPhp } from "./presentation";
import { formatHotelDate } from "../../lib/hotelTime";
export const billDate=(value:string)=>formatHotelDate(apiInstant(value),{dateStyle:"medium",timeStyle:"short"});

export interface BillingDocumentDto {
  id:string;company_id:string;reservation_id:string;source_pricing_id:string;source_reservation_version:number;
  document_type:"operational_bill";status:"draft"|"finalized";number:string|null;currency:"PHP";total_minor:number;
  capture:{schema_version:1|2|3;allocations?:import("./contracts").MultiAllocationDto[];reservation_reference:string;reservation_status:string;guest:GuestDto;allocation_id:string|null;scheduled_start:string;scheduled_end:string;pricing:ReservationDto["pricing"]};
  capture_hash:string;version:number;created_at:string;finalized_at:string|null;created_by:string;finalized_by:string|null;attribution:"local_development";created_request_key:string;finalized_request_key:string|null;
  lines:{source_line_id:string;source_kind:"accommodation"|"purchase"|"extra_charge";source_id:string;label:string;quantity:number;original_unit_amount_minor:number;effective_unit_amount_minor:number;original_amount_minor:number;effective_amount_minor:number;discount_minor:number;final_amount_minor:number}[];
}
export function checkedDocument(value:BillingDocumentDto, company?:string, reservation?:string, mutation=false, documentId?:string):BillingDocumentDto {
  try {
    if(!value.id || value.document_type!=="operational_bill" || value.currency!=="PHP" || value.capture.pricing.snapshot.currency!==value.currency || (documentId && value.id!==documentId) || (company && value.company_id!==company) || (reservation && value.reservation_id!==reservation) || value.capture.guest.company_id!==value.company_id || value.source_pricing_id!==value.capture.pricing.id || value.total_minor!==value.capture.pricing.snapshot.total_minor || !Number.isInteger(value.source_reservation_version) || value.source_reservation_version<1)throw new Error();
    if(value.status==="draft" ? value.version!==1 || value.number!==null || value.finalized_at!==null : value.status!=="finalized" || value.version!==2 || !value.number || !value.finalized_at)throw new Error();
    formatPhp(value.total_minor);apiInstant(value.created_at);if(value.finalized_at)apiInstant(value.finalized_at);
    if(!Array.isArray(value.lines) || !value.lines.length)throw new Error();
    for(const line of value.lines){if(!Number.isInteger(line.quantity)||line.quantity<1)throw new Error();for(const key of ["original_unit_amount_minor","effective_unit_amount_minor","original_amount_minor","effective_amount_minor","discount_minor","final_amount_minor"] as const)formatPhp(line[key]);}
    return value;
  }catch{throw new ApiError("Invalid billing-document response. Reload the authoritative document.",0,"invalid_response",mutation);}
}
export function billMoney(minor:number){return `${minor<0 ? "−" : ""}${formatPhp(Math.abs(minor))}`;}
export function billingError(error:unknown):string {
  if(error instanceof ApiError){
    if(error.uncertain)return "The billing request outcome is unconfirmed. Retry the original request to confirm it; do not start another draft or finalization.";
    if(error.code==="stale_billing_source")return "This draft's reservation changed. Reload documents and reservation, review the difference, then explicitly create a new draft. The old capture is unchanged.";
    if(error.code==="version_conflict")return "The reservation or document version changed. Reload documents and reservation before reviewing the next action.";
    if(error.code==="bill_already_finalized" || error.code==="document_finalized")return "A bill is already finalized. Reload documents to view the immutable result; it cannot be reopened or replaced here.";
  }
  return error instanceof Error ? error.message : "Billing-document request failed. No demo data was substituted.";
}
