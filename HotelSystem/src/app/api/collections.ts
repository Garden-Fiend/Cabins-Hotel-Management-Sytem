import {phpDecimal} from './presentation';
export function collectionDecimal(minor:number){return `${minor<0?'-':''}${phpDecimal(Math.abs(minor))}`;}
export type ObligationInput = {status:'known'|'unknown'; accommodation_minor?:number|null; evidence:string};
export type CollectionInput = {
 kind:'collection'|'refund'|'reversal'; collector:'hotel'|'channel'; component:'accommodation'|'hotel_charges';
 amount_minor:number; currency:'PHP'; payment_method?:string|null; reference:string; declaration:'partial'|'confirmed';
 source_id?:string|null; capture_id?:string|null; related_transaction_id?:string|null; reason:string;
 duplicate_token?:string; duplicate_acknowledged?:boolean; duplicate_justification?:string;
};
export type CollectionRecord = CollectionInput & {id:string;source_id:string;capture_id:string|null;source_label:string;external_reference:string;actor:string;recorded_at:string;reservation_version:number};
export type InitialCollections=CollectionInput|CollectionInput[];
export type DuplicateReview = {initial_ordinal?:number|null;duplicate_token:string;matches:{id:string;reservation_id:string;amount_minor:number;kind:string}[]};
export type AllocationEvent={id:string;sequence:number;payment_id:string;component:'accommodation'|'hotel_charges';kind:'allocate'|'release';amount_minor:number;pricing_id:string;obligation_id:string|null;release_of:string|null;provenance:string;reason:string;actor:string;recorded_at:string};
export type AllocationInput={expected_version:number;expected_pricing_id:string;expected_obligation_id:string|null;kind:'allocate'|'release';payment_id:string;component:'accommodation'|'hotel_charges';amount_minor:number;release_of?:string|null;reason:string};
export type CollectionSummary = {
 reservation_version:number;pricing_id:string;capture_id:string|null;source_id:string;currency:'PHP';
 accommodation_obligation_minor:number|null;hotel_charges_minor:number;accommodation_residual_minor:number|null;
 hotel_charges_residual_minor:number;guest_balance_minor:number|null;coverage_status:string;unresolved_components:string[];
 net_hotel_minor:number;net_channel_minor:number;payout_status:string;
 obligation: (ObligationInput & {id:string;pricing_id:string;capture_id:string|null;recorded_at:string})|null;
 obligation_history?: (ObligationInput & {id:string;recorded_at:string})[];
 source_rollups?: {source_id:string;hotel_minor:number;channel_minor:number}[];
 allocated_hotel_minor?:number;unapplied_hotel_minor?:number;allocated_channel_minor?:number;unapplied_channel_minor?:number;
 allocation_obligation_id?:string|null;allocation_history?:AllocationEvent[];
 component_outstanding?:Record<'accommodation'|'hotel_charges',number|null>;
 component_credits?:Record<'accommodation'|'hotel_charges',number>;
 payment_capacities?:{payment_id:string;collector:'hotel'|'channel';component:string;remaining_minor:number;refundable_minor:number;allocated_minor:number;unapplied_minor:number}[];
};
export type CollectionRead = {items:CollectionRecord[];total:number;summary:CollectionSummary};
export function duplicateReview(value:unknown):DuplicateReview|undefined {
 const details=(value as {details?:Partial<DuplicateReview>}|undefined)?.details;
 return typeof details?.duplicate_token==='string'&&Array.isArray(details.matches)?details as DuplicateReview:undefined;
}
export function emptyCollection():CollectionInput {return {kind:'collection',collector:'hotel',component:'accommodation',amount_minor:0,currency:'PHP',payment_method:'cash',reference:'',declaration:'partial',reason:''};}
