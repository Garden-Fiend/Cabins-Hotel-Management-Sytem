import type {ChannelAgreement} from '../../features/channels/types';
import type {BookingSourceConfiguration} from '../../features/configuration/types';
import type {ReservationPriceSummary} from '../../types/reservation';
import {toMinorUnits} from '../../lib/money';

export type CommercialTerms=Pick<ChannelAgreement,'pricing'|'commission'|'payment'|'settlement'>;
export function emptyBookingFinancials(source:BookingSourceConfiguration):BookingFinancialInput{
 return {confirmation_date:'',external_reference:'',expected_source_version:source.serverVersion!,
 expected_agreement_id:null,expected_agreement_version:null,guest_paid_status:'unknown',
 difference_classification:'none',collection:undefined,override_reason:'',manual_reason:''};
}
export interface BookingFinancialInput {
 confirmation_date:string;external_reference:string;expected_source_version:number;
 expected_agreement_id:string|null;expected_agreement_version:number|null;
 contractual_accommodation_minor?:number|null;guest_paid_minor?:number|null;
 guest_paid_status:'reported_paid'|'expected'|'unknown';
 difference_classification:'channel_funded'|'hotel_funded'|'unresolved'|'none';
 collection:'hotel'|'channel'|undefined;reference_value_minor?:number|null;explicit_commission_basis_minor?:number|null;
 manual_commission_minor?:number|null;override_reason:string;manual_reason:string;manual_terms?:CommercialTerms|null;
}
export interface BookingFinancialCapture {
 id:string;source_id:string;source_label:string;classification:BookingSourceConfiguration['classification'];
 agreement_id:string|null;agreement_revision:number|null;agreement_version:number|null;
 agreement_effective_from?:string|null;agreement_effective_to?:string|null;
 provenance:'published_agreement'|'manual_arrangement';captured_at:string;actor:string;reservation_version:number;reason:string;
 input:BookingFinancialInput;terms:CommercialTerms;
 figures:{standard_accommodation_minor:number;discounted_accommodation_minor:number;contractual_accommodation_minor:number;
 accommodation_adjustment_minor:number;additional_charges_minor:number;total_minor:number;
 guest_paid_minor:number|null;guest_paid_status:BookingFinancialInput['guest_paid_status'];difference_minor:number|null;
 difference_classification:BookingFinancialInput['difference_classification'];commission_basis_minor:number|null;
 commission_minor:number;collection:'hotel'|'channel';settlement_method:ChannelAgreement['settlement']['method'];
 expected_settlement_minor:number|null;hotel_received_minor:0};
}
/** Draft estimate only. Sum final lines so unit replacements are never counted twice. */
export function bookingFinancialPreview(base:ReservationPriceSummary,contract?:number|null):ReservationPriceSummary{
 const minor=(value:bigint)=>{const result=Number(value);if(!Number.isSafeInteger(result))throw new Error('Booking estimate exceeds exact PHP range.');return result;};
 const sum=(values:number[])=>minor(values.reduce((total,value)=>total+BigInt(toMinorUnits(value,'PHP')),0n));
 const rooms=base.lines.filter(l=>l.kind==='room'),charges=base.lines.filter(l=>l.kind!=='room');
 const standard=sum(rooms.map(l=>l.amount)),discounted=sum(rooms.map(l=>l.finalAmount??l.amount));
 const accommodation=contract??discounted,additions=sum(charges.map(l=>l.finalAmount??l.amount));
 if(!Number.isSafeInteger(accommodation)||accommodation<0)throw new Error('Invalid contractual accommodation amount.');
 const total=Math.max(0,minor(BigInt(accommodation)+BigInt(additions)+BigInt(toMinorUnits(base.adjustmentTotal,'PHP'))));
 return {...base,amountOwed:total/100,channel:{currency:'PHP',standardAccommodationMinor:standard,
  discountedAccommodationMinor:discounted,confirmedAccommodationMinor:accommodation,
  accommodationAdjustmentMinor:accommodation-discounted,additionalChargesMinor:additions,
  totalGuestChargesMinor:total,verifiedCollectionMinor:0,guestBalanceMinor:total,roomAllocations:[]}};
}
