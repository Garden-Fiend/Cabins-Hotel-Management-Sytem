import type { ReservationChannelTerms, ChannelPricingSnapshot } from "../features/channels/types";
export type DiscountScope = "reservation" | "room" | "item";
export type DiscountMethod = "fixed" | "percentage";
export type DiscountPresetMethod = DiscountMethod | "final_price";
export type ReservationStatus =
  | "confirmed"
  | "reserved"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface ReservationGuest {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export interface BookingSourceOption {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ReservationConfigOption {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ReservationRoomOption {
  number: string;
  roomTypeId: string;
  type: string;
}

export interface ReservationDuration {
  id: string;
  label: string;
  minutes: number;
}

export interface ReservationCatalogItem {
  id: string;
  label: string;
  price: number;
  enabled?: boolean;
}

export interface ReservationInclusionSnapshot {
  catalogId: string;
  label: string;
  quantity: number;
}

export interface ReservationDiscount {
  id: string;
  label: string;
  scope: DiscountScope;
  method: DiscountPresetMethod;
  value: number;
  targetId: string;
  sourcePresetId?: string;
  sourcePresetName?: string;
  targetRoomTypeId?: string;
  targetItemId?: string;
  rateId?: string;
  currency?: string;
  baseUnitPrice?: number;
  discountedUnitPrice?: number;
  quantity?: number;
  appliedAt?: Date;
}

export interface ReservationPriceLine {
  id: string;
  label: string;
  amount: number;
  roomNumber: string;
  kind: "room" | "charge" | "breakfast";
  usage?: "purchase" | "extra_charge" | "complimentary_breakfast";
  catalogId?: string;
  quantity?: number;
  unitPrice?: number;
  taxAmount?: number;
  taxDetails?: string;
  currency?: string;
  roomTypeId?: string;
  rateId?: string;
  baseUnitPrice?: number;
  pricingQuantity?: number;
  effectiveUnitPrice?: number;
  effectiveAmount?: number;
  finalAmount?: number;
}

export interface AppliedDiscount {
  id: string;
  label: string;
  amount: number;
  value?: number;
  currency?: string;
  rateId?: string;
  targetRoomTypeId?: string;
  targetItemId?: string;
  sourcePresetId?: string;
  sourcePresetName?: string;
  scope?: DiscountScope;
  method?: DiscountPresetMethod;
  targetId?: string;
  baseUnitPrice?: number;
  discountedUnitPrice?: number;
  quantity?: number;
  order?: number;
  appliedAt?: Date;
  allocations?: { lineId: string; amount: number }[];
}

export interface ReservationPriceSummary {
  channel?: ChannelPricingSnapshot;
  lines: ReservationPriceLine[];
  discounts: AppliedDiscount[];
  subtotal: number;
  discountTotal: number;
  adjustmentTotal: number;
  amountOwed: number;
  pipelineVersion?: 2;
}

export interface ReservationChargeSnapshot {
  usage?: "purchase" | "extra_charge";
  id: string;
  catalogId: string;
  label: string;
  quantity: number;
  unitPrice: number;
  taxAmount?: number;
  taxDetails?: string;
}

export interface ReservationBreakfastSnapshot {
  stayDate: string;
  guestNumber: number;
  status: "included" | "skipped";
  mealId?: string;
  mealLabel?: string;
  beverageId?: string;
  beverageLabel?: string;
  quantity?: number;
  unitPrice?: 0;
  lineTotal?: 0;
}

export type InclusionOrigin = { source: "default" | "manual"; overridden?: boolean };

export interface ReservationRoomSnapshot {
  inclusionOrigins?: Record<string, InclusionOrigin>;
  roomNumber: string;
  roomTypeId: string;
  roomType: string;
  checkIn: Date;
  checkOut: Date;
  durationId: string;
  adults: number;
  children: number;
  capturedRoomPrice: number;
  capturedCurrency: string;
  inclusions: ReservationInclusionSnapshot[];
  charges: ReservationChargeSnapshot[];
  breakfast: ReservationBreakfastSnapshot[];
  actualCheckInAt?: Date;
  actualCheckOutAt?: Date;
  capturedUnitPrice?: number;
  capturedPricingQuantity?: number;
  capturedRateId?: string;
}

export interface ReservationAdjustment {
  id: string;
  amount: number;
  reason: string;
}

export interface ReservationAuditEntry {
  visibility?: "accounting";
  eventType:
    | "created"
    | "room_added"
    | "room_removed"
    | "guest_changed"
    | "occupancy_changed"
    | "stay_changed"
    | "price_changed"
    | "discount_changed"
    | "adjustment_changed"
    | "breakfast_changed"
    | "extra_changed"
    | "inclusion_changed"
    | "channel_terms_changed"
    | "channel_settlement_changed"
    | "booking_source_changed"
    | "checked_in"
    | "checked_out"
    | "cancelled"
    | "no_show"
    | "departure_recorded"
    | "updated";
  action: string;
  occurredAt: Date;
  actor: string;
  before?: string;
  after?: string;
}

export interface CalendarReservationContext {
  roomId: string;
  start: Date;
  end: Date;
  reservationId?: string;
}

export interface ReservationSnapshot {
  serverVersion?: number;
  channelTerms?: ReservationChannelTerms;
  supersededChannelTerms?: ReservationChannelTerms[];
  id: string;
  status: ReservationStatus;
  guestId: string;
  bookingSourceId: string;
  bookingSourceLabel: string;
  checkIn: Date;
  checkOut: Date;
  note: string;
  rooms: ReservationRoomSnapshot[];
  discounts: ReservationDiscount[];
  adjustments: ReservationAdjustment[];
  pricing: ReservationPriceSummary;
  audit: ReservationAuditEntry[];
  createdAt: Date;
  actualCheckInAt?: Date;
  actualCheckOutAt?: Date;
  occupancyLockRoomNumbers?: string[];
}
