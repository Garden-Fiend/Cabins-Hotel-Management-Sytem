export interface GuestDto { id: string; company_id: string; name: string; phone: string; email: string }
export interface GuestInput { name: string; phone?: string; email?: string }
export interface CreateInput {
  guest_id: string; booking_source_id: string; room_id: string; duration_id: string;
  scheduled_start: string; adults: number; children: number; note: string;
}
export interface PatchInput { expected_version: number; note?: string; adults?: number; children?: number }
export interface DetailsEditInput extends PatchInput { guest_id: string }
export interface AdjustmentInput { id: string; amount_minor: number; reason: string }
export interface BillingEditInput extends DetailsEditInput { adjustments: AdjustmentInput[] }
export interface ChargeInput { id: string; product_id: string; quantity: number; usage: "purchase" }
export interface ChargesEditInput extends DetailsEditInput { charges: ChargeInput[]; adjustments?: AdjustmentInput[] }
export interface StayEditInput extends DetailsEditInput { room_id: string; duration_id: string; scheduled_start: string; adjustments?: AdjustmentInput[] }
export interface StayChargesEditInput extends StayEditInput { charges: ChargeInput[] }
export type LifecycleAction = "check-in" | "check-out" | "cancel" | "no-show" | "record-departure";
export interface LifecycleInput { expected_version: number; guest_has_vacated?: boolean }
export interface CapturedLineDto {
  kind: "accommodation"; room_id: string; room_number: string; room_type_id: string;
  room_type_label: string; duration_id: string; duration_source_id: string; rate_id: string;
  rate_source_id: string; booking_kind: "hourly" | "overnight"; unit_amount_minor: number;
  quantity: number; amount_minor: number; currency: "PHP";
}
export interface ReservationDto {
  id: string; company_id: string; business_number: number; reference: string; version: number;
  status: "confirmed" | "reserved" | "checked_in" | "checked_out" | "cancelled" | "no_show";
  guest: GuestDto; booking_source_id: string; note: string; created_at: string; updated_at: string;
  allocation: {
    id: string; room_id: string; duration_id: string; scheduled_start: string; scheduled_end: string;
    actual_check_in: string | null; actual_check_out: string | null; adults: number; children: number;
    blocks_availability: boolean;
  };
  pricing: { id: string; revision: number; reservation_version: number; captured_at: string;
    snapshot: { schema_version: 1 | 2 | 3; calculation_version: "direct-accommodation-v1" | "direct-adjustments-v1" | "direct-charges-v1"; currency: "PHP";
      hotel_timezone: "Asia/Manila"; tax_status: "not_configured"; tax_minor: 0;
      lines: [CapturedLineDto]; total_minor: number; adjustments?: AdjustmentInput[];
      charges?: (ChargeInput & { label: string; unit_amount_minor: number; amount_minor: number; currency: "PHP" })[] } };
  audit: { id: string; event_type: string; actor: string; attribution: "local_development";
    reservation_version: number; occurred_at: string }[];
}
export interface ReferencesDto {
  capabilities?: string[];
  company: { id: string; name: string; currency: "PHP"; hotel_timezone: "Asia/Manila";
    default_check_in_time: string; default_check_out_time: string };
  room_types: { id: string; source_id: string; label: string; enabled: boolean; default_capacity: number; version?: number; archived?: boolean; amenities?: string[] }[];
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
  booking_sources: { id: string; source_id: "direct"; label: string; enabled: boolean }[];
  inventory_categories?: { id: string; version: number; label: string; type: "ordinary" | "amenities"; enabled: boolean; system_defined: false }[];
  catalog_products?: { id: string; version: number; label: string; category_id: string; unit_amount_minor: number; currency: "PHP"; enabled: boolean; archived: boolean; available_for_sale: boolean }[];
}

export interface DefinitionMap {
  categories: { label: string; type: "ordinary" | "amenities"; enabled: boolean };
  products: { label: string; category_id: string; unit_amount_minor: number; currency: "PHP"; enabled: boolean; archived: boolean; available_for_sale: boolean };
  "room-types": { label: string; enabled: boolean; archived: boolean; default_capacity: number; amenities: string[] };
  rooms: { number: string; room_type_id: string; display_name: string; enabled: boolean; archived: boolean; operational: boolean;
    operational_status?: "operational" | "housekeeping" | "maintenance" | "unavailable";
    capacity_override: number | null; description: string; operational_notes: string; amenities_additions: string[]; amenities_removals: string[] };
  durations: { label: string; kind: "hourly" | "overnight"; minutes: number | null; nights: number | null; enabled: boolean };
  rates: { room_type_id: string; booking_kind: "hourly" | "overnight"; duration_id: string | null; unit_amount_minor: number; currency: "PHP"; enabled: boolean };
}
export type DefinitionKind = keyof DefinitionMap;
