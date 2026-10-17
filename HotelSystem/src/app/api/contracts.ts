export interface GuestDto { id: string; company_id: string; name: string; phone: string; email: string }
export interface GuestInput { name: string; phone?: string; email?: string }
export interface CreateInput {
  collections?:import('./collections').InitialCollections;
  guest_obligation?:import('./collections').ObligationInput;
  booking_financials?:import('./bookingFinancials').BookingFinancialInput;
  breakfast?: BreakfastInput[];
  inclusions?: InclusionInput[];
  guest_id: string; booking_source_id: string; room_id: string; duration_id: string;
  scheduled_start: string; adults: number; children: number; note: string; discounts?: ManualDiscountInput[]; charges?: ChargeInput[]; adjustments?: AdjustmentInput[];
}
export interface PatchInput { expected_version: number; note?: string; adults?: number; children?: number }
export interface DetailsEditInput extends PatchInput { guest_id: string }
export interface InclusionInput { product_id: string; quantity: number; overridden?: boolean }
export interface InclusionCaptureDto extends InclusionInput { label: string; source: "default" | "manual"; overridden: boolean }
export interface InclusionsEditInput extends DetailsEditInput { inclusions: InclusionInput[]; discounts?: ManualDiscountInput[]; charges?: ChargeInput[]; adjustments?: AdjustmentInput[] }
export interface BreakfastInput { service_date: string; guest_number: number; status: "included" | "skipped"; meal_id?: string; beverage_id?: string }
export interface BreakfastCaptureDto extends BreakfastInput { meal_label?: string | null; beverage_label?: string | null; quantity: 1; unit_amount_minor: 0; amount_minor: 0 }
export interface BreakfastEditInput extends DetailsEditInput { breakfast: BreakfastInput[]; inclusions?: InclusionInput[]; discounts?: ManualDiscountInput[]; charges?: ChargeInput[]; adjustments?: AdjustmentInput[] }
export interface AdjustmentInput { id: string; amount_minor: number; reason: string }
export interface ManualDiscountInput { id: string; label: string; scope: "reservation" | "room" | "item"; method: "fixed" | "percentage" | "final_price"; value: string; target_id: string; currency: "PHP"; preset_id?: string | null }
export interface PriceOverrideCaptureDto { id:string;preset_id:string;preset_version:number;label:string;scope:"room"|"item";line_id:string;target_id:string;rate_id:string|null;currency:"PHP";original_unit_amount_minor:number;replacement_unit_amount_minor:number;quantity:number;effect_minor:number;provenance:"preset_final_price";applied_at:string }
export interface ManualDiscountCaptureDto extends ManualDiscountInput { provenance: "manual" | "preset"; preset_version?: number | null; preset_target_id?: string | null; preset_rate_id?: string | null; applied_at: string; amount_minor: number; order: number; allocations: { line_id: string; amount_minor: number }[] }
export interface DiscountsEditInput extends DetailsEditInput { discounts: ManualDiscountInput[]; charges?: ChargeInput[]; adjustments?: AdjustmentInput[] }
export interface BillingEditInput extends DetailsEditInput { discounts?: ManualDiscountInput[]; adjustments: AdjustmentInput[] }
export interface ChargeInput { id: string; product_id: string; quantity: number; usage: "purchase" | "extra_charge" }
export interface ChargesEditInput extends DetailsEditInput { discounts?: ManualDiscountInput[]; charges: ChargeInput[]; adjustments?: AdjustmentInput[] }
export interface StayEditInput extends DetailsEditInput { breakfast?: BreakfastInput[]; inclusions?: InclusionInput[]; discounts?: ManualDiscountInput[]; room_id: string; duration_id: string; scheduled_start: string; adjustments?: AdjustmentInput[] }
export interface StayChargesEditInput extends StayEditInput { charges: ChargeInput[] }
export type LifecycleAction = "check-in" | "check-out" | "cancel" | "no-show" | "record-departure";
export interface LifecycleInput { expected_version: number; guest_has_vacated?: boolean }
export interface CapturedLineDto {
  allocation_id?:string; kind: "accommodation"; room_id: string; room_number: string; room_type_id: string;
  room_type_label: string; duration_id: string; duration_source_id: string; rate_id: string;
  rate_source_id: string; booking_kind: "hourly" | "overnight"; unit_amount_minor: number;
  quantity: number; amount_minor: number; currency: "PHP";
}
export interface ReservationDto {
  booking_source_label?:string|null;
  id: string; company_id: string; business_number: number; reference: string; version: number;
  status: "confirmed" | "reserved" | "checked_in" | "checked_out" | "cancelled" | "no_show";
  guest: GuestDto; booking_source_id: string; note: string; created_at: string; updated_at: string;
  allocation: {
    breakfast?: BreakfastCaptureDto[];
    inclusions?: InclusionCaptureDto[];
    id: string; room_id: string; duration_id: string; scheduled_start: string; scheduled_end: string;
    actual_check_in: string | null; actual_check_out: string | null; adults: number; children: number;
    blocks_availability: boolean;
  };
  pricing: { id: string; revision: number; reservation_version: number; captured_at: string;
    snapshot: { channel?:import('./bookingFinancials').BookingFinancialCapture; channel_figures?:import('./bookingFinancials').BookingFinancialCapture['figures']; schema_version: 1 | 2 | 3 | 4 | 5 | 6 | 7; calculation_version: "direct-accommodation-v1" | "direct-adjustments-v1" | "direct-charges-v1" | "direct-manual-discounts-v1" | "direct-unit-overrides-v1" | "direct-multi-room-v1" | "channel-capture-v1"; currency: "PHP";
      price_overrides?:PriceOverrideCaptureDto[];price_override_total_minor?:number;
      hotel_timezone: "Asia/Manila"; tax_status: "not_configured"; tax_minor: 0;
      discounts?: ManualDiscountCaptureDto[]; discount_total_minor?: number; pipeline_version?: 2;
      lines: CapturedLineDto[]; total_minor: number; adjustments?: AdjustmentInput[];
      charges?: (ChargeInput & { allocation_id?:string; label: string; unit_amount_minor: number; amount_minor: number; currency: "PHP" })[] } };
  audit: { description?:string|null; id: string; event_type: string; actor: string; attribution: "local_development";
    reservation_version: number; occurred_at: string }[];
}
export type MultiAllocationDto = ReservationDto["allocation"] & {state:"reserved"|"checked_in"|"checked_out"|"cancelled"|"no_show"|"removed";removed_at:string|null;room_number:string;room_type_label:string;uses_reservation_stay?:boolean};
export interface MultiReservationDto extends Omit<ReservationDto,"allocation"> {
  allocation:null;allocations:MultiAllocationDto[];aggregate_status:string;
    shared_start:string;shared_end:string;shared_duration_id:string|null;stay_mode?:"independent";stay_defaults?:{scheduled_start:string;scheduled_end:string;duration_id:string};
}
export type AnyReservationDto=ReservationDto|MultiReservationDto;
export interface MultiAllocationInput {stay?:{scheduled_start:string;duration_id:string;scheduled_end?:string}|null;id?:string;room_id:string;adults:number;children:number;charges:ChargeInput[];inclusions?:InclusionInput[];breakfast:BreakfastInput[]}
export interface MultiCreateInput {collections?:import('./collections').InitialCollections;guest_obligation?:import('./collections').ObligationInput;booking_financials?:import('./bookingFinancials').BookingFinancialInput;guest_id:string;booking_source_id:string;duration_id:string;scheduled_start:string;note:string;allocations:MultiAllocationInput[];discounts:ManualDiscountInput[];adjustments:AdjustmentInput[]}
export interface MultiEditInput extends MultiCreateInput {expected_version:number}
export interface ReferencesDto {
  discount_presets?: (DefinitionMap["discount-presets"] & {id:string;version:number})[];
  breakfast_eligible_items?: { product_id: string; kind: "meal" | "beverage"; enabled: boolean }[];
  capabilities?: string[];
  company: { id: string; name: string; currency: "PHP"; hotel_timezone: "Asia/Manila";
    breakfast_version?: number;
    default_check_in_time: string; default_check_out_time: string };
  room_types: { id: string; source_id: string; label: string; enabled: boolean; default_capacity: number; version?: number; archived?: boolean; amenities?: string[]; default_inclusions?: InclusionInput[] }[];
  rooms: { id: string; room_type_id: string; number: string; display_name: string; enabled: boolean;
    version?: number;
    archived: boolean; operational: boolean; housekeeping: "clean" | "dirty" | "cleaning";
    operational_status?: "operational" | "housekeeping" | "maintenance" | "unavailable" | null;
    capacity_override: number | null; current_occupancy_allocation_id: string | null;
    description?: string; operational_notes?: string; amenities_additions?: string[]; amenities_removals?: string[] }[];
  durations: { id: string; source_id: string; kind: "hourly" | "overnight";
    label?: string; version?: number;
    minutes: number | null; nights: number | null; enabled: boolean }[];
  rates: { id: string; source_id: string; room_type_id: string; booking_kind: "hourly" | "overnight";
    version?: number;
    duration_id: string | null; currency: "PHP"; unit_amount_minor: number; enabled: boolean }[];
  booking_sources: import('./sourceInputs').SourceDto[];
  source_agreements?: import('./sourceInputs').AgreementDto[];
  inventory_categories?: { id: string; version: number; label: string; type: "ordinary" | "amenities" | "extra" | "inclusion" | "breakfast"; enabled: boolean; system_defined: boolean }[];
  catalog_products?: { id: string; version: number; label: string; category_id: string; unit_amount_minor: number; currency: "PHP"; enabled: boolean; archived: boolean; available_for_sale: boolean }[];
}

export interface DefinitionMap {
  "discount-presets": {label:string;scope:"reservation"|"room"|"item";method:"fixed"|"percentage"|"final_price";value:string;currency:"PHP";enabled:boolean;target_room_type_id:string|null;target_product_id:string|null;replacement_unit_amount_minor?:number|null;rate_prices?:{rate_id:string;unit_amount_minor:number}[]};
  breakfast: { expected_version: number; items: { product_id: string; kind: "meal" | "beverage"; enabled: boolean }[] };
  categories: { label: string; type: "ordinary" | "amenities" | "extra" | "inclusion" | "breakfast"; enabled: boolean };
  products: { label: string; category_id: string; unit_amount_minor: number; currency: "PHP"; enabled: boolean; archived: boolean; available_for_sale: boolean };
  "room-types": { label: string; enabled: boolean; archived: boolean; default_capacity: number; amenities: string[]; default_inclusions?: InclusionInput[] };
  rooms: { number: string; room_type_id: string; display_name: string; enabled: boolean; archived: boolean; operational: boolean;
    operational_status?: "operational" | "housekeeping" | "maintenance" | "unavailable";
    capacity_override: number | null; description: string; operational_notes: string; amenities_additions: string[]; amenities_removals: string[] };
  durations: { label: string; kind: "hourly" | "overnight"; minutes: number | null; nights: number | null; enabled: boolean };
  rates: { room_type_id: string; booking_kind: "hourly" | "overnight"; duration_id: string | null; unit_amount_minor: number; currency: "PHP"; enabled: boolean };
}
export type DefinitionKind = keyof DefinitionMap;
