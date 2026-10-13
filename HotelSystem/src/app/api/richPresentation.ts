import type { HotelConfigurationData } from "../../features/configuration/types";
import type { ReservationSnapshot, ReservationAuditEntry } from "../../types/reservation";
import type { ReferencesDto, ReservationDto } from "./contracts";
import { apiInstant, presentReservation } from "./presentation";

export function richConfiguration(refs: ReferencesDto): HotelConfigurationData {
  return {
    currency: refs.company.currency,
    defaultCheckInTime: refs.company.default_check_in_time.slice(0, 5),
    defaultCheckOutTime: refs.company.default_check_out_time.slice(0, 5),
    roomTypes: refs.room_types.map(r => ({ id: r.id, serverVersion: r.version, archived: r.archived, label: r.label, enabled: r.enabled, defaultCapacity: r.default_capacity, amenities: r.amenities ?? [] })),
    rooms: refs.rooms.map(r => ({ id: r.id, serverVersion: r.version, number: r.number, roomTypeId: r.room_type_id, displayType: r.display_name,
      enabled: r.enabled, archived: r.archived, roomStatusId: r.operational_status ?? (r.operational ? "operational" : "unavailable"),
      housekeepingState: r.housekeeping, capacityOverride: r.capacity_override ?? undefined,
      description: r.description ?? "", operationalNotes: r.operational_notes ?? "", amenitiesAdditions: r.amenities_additions ?? [], amenitiesRemovals: r.amenities_removals ?? [] })),
    roomStatuses: [{ id: "operational", label: "Operational", enabled: true, blocksReservation: false },
      { id: "housekeeping", label: "Housekeeping", enabled: true, blocksReservation: true },
      { id: "maintenance", label: "Maintenance", enabled: true, blocksReservation: true },
      ...(refs.rooms.some(r => r.operational_status === "unavailable" || (!r.operational_status && !r.operational)) ? [{ id: "unavailable", label: "Unavailable (legacy)", enabled: false, blocksReservation: true }] : [])],
    durations: refs.durations.map(r => ({ id: r.id, serverVersion: r.version, label: r.label || r.source_id, enabled: r.enabled, bookingType: r.kind,
      minutes: r.minutes ?? (r.nights ?? 1) * 1440, nights: r.nights ?? undefined })),
    roomTypePrices: refs.rates.map(r => ({ id: r.id, serverVersion: r.version, serverAmountMinor: r.unit_amount_minor, roomTypeId: r.room_type_id, bookingType: r.booking_kind,
      durationId: r.duration_id ?? undefined, amount: r.unit_amount_minor / 100, currency: r.currency, enabled: r.enabled })),
    bookingSources: refs.booking_sources.map(r => ({ id: r.id, label: r.label, enabled: r.enabled, classification: "direct" })),
    // These capabilities are unavailable, not populated from demo fixtures.
    inventoryCategories: (refs.inventory_categories ?? []).map(r => ({ id: r.id, serverVersion: r.version, label: r.label, type: r.type, enabled: r.enabled, systemDefined: r.system_defined })),
    catalogItems: (refs.catalog_products ?? []).map(r => ({ id: r.id, serverVersion: r.version, serverUnitAmountMinor: r.unit_amount_minor, label: r.label,
      categoryId: r.category_id, category: refs.inventory_categories?.find(c => c.id === r.category_id)?.type ?? "ordinary",
      price: r.unit_amount_minor / 100, enabled: r.enabled, archived: r.archived, availableForSale: r.available_for_sale })),
    discounts: [],
  };
}

export function richReservation(dto: ReservationDto, refs: ReferencesDto): ReservationSnapshot {
  presentReservation(dto);
  const a = dto.allocation, line = dto.pricing.snapshot.lines[0], amount = line.amount_minor / 100;
  const events: Record<string, ReservationAuditEntry["eventType"]> = {
    "reservation.created": "created", "reservation.updated": "updated", "reservation.check_in": "checked_in",
    "reservation.check_out": "checked_out", "reservation.cancel": "cancelled", "reservation.no_show": "no_show",
    "reservation.record_departure": "departure_recorded",
  };
  return {
    id: dto.id, serverVersion: dto.version, status: dto.status, guestId: dto.guest.id,
    bookingSourceId: dto.booking_source_id, bookingSourceLabel: refs.booking_sources.find(s => s.id === dto.booking_source_id)?.label ?? "Direct",
    checkIn: apiInstant(a.scheduled_start), checkOut: apiInstant(a.scheduled_end), note: dto.note,
    createdAt: apiInstant(dto.created_at), actualCheckInAt: a.actual_check_in ? apiInstant(a.actual_check_in) : undefined,
    actualCheckOutAt: a.actual_check_out ? apiInstant(a.actual_check_out) : undefined,
    occupancyLockRoomNumbers: dto.status === "cancelled" && a.actual_check_in && !a.actual_check_out ? [line.room_number] : [],
    rooms: [{ roomNumber: line.room_number, roomTypeId: line.room_type_id, roomType: line.room_type_label,
      checkIn: apiInstant(a.scheduled_start), checkOut: apiInstant(a.scheduled_end), durationId: a.duration_id,
      adults: a.adults, children: a.children, capturedRoomPrice: amount, capturedCurrency: line.currency,
      capturedUnitPrice: line.unit_amount_minor / 100, capturedPricingQuantity: line.quantity, capturedRateId: line.rate_id,
      inclusions: [], charges: (dto.pricing.snapshot.charges ?? []).map(item => ({ id: item.id, catalogId: item.product_id, usage: item.usage,
        label: item.label, quantity: item.quantity, unitPrice: item.unit_amount_minor / 100 })), breakfast: [], actualCheckInAt: a.actual_check_in ? apiInstant(a.actual_check_in) : undefined,
      actualCheckOutAt: a.actual_check_out ? apiInstant(a.actual_check_out) : undefined }],
    discounts: [], adjustments: (dto.pricing.snapshot.adjustments ?? []).map(item => ({ id: item.id, amount: item.amount_minor / 100, reason: item.reason })),
    pricing: { discounts: [], lines: [{ id: `room:${line.room_number}`, label: `Room ${line.room_number} · ${line.room_type_label}`,
      roomNumber: line.room_number, kind: "room", amount, baseUnitPrice: line.unit_amount_minor / 100,
      pricingQuantity: line.quantity, rateId: line.rate_id, currency: line.currency, roomTypeId: line.room_type_id },
      ...(dto.pricing.snapshot.charges ?? []).map(item => ({ id: item.id, catalogId: item.product_id, usage: item.usage,
        label: item.label, roomNumber: line.room_number, kind: "charge" as const, amount: item.amount_minor / 100, quantity: item.quantity, unitPrice: item.unit_amount_minor / 100, currency: item.currency }))],
      subtotal: Number((dto.pricing.snapshot.charges ?? []).reduce((sum, item) => sum + BigInt(item.amount_minor), BigInt(line.amount_minor))) / 100, discountTotal: 0, adjustmentTotal: Number((dto.pricing.snapshot.adjustments ?? []).reduce((sum, item) => sum + BigInt(item.amount_minor), 0n)) / 100, amountOwed: dto.pricing.snapshot.total_minor / 100 },
    audit: dto.audit.map(e => ({ eventType: events[e.event_type] ?? "updated",
      action: e.event_type, actor: e.actor, occurredAt: apiInstant(e.occurred_at) })),
  };
}
