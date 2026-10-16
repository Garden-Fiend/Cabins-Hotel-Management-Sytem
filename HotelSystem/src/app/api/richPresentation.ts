import type { HotelConfigurationData } from "../../features/configuration/types";
import {presentSource,presentAgreement,sourceLabel} from './sourceInputs';
import type { ReservationSnapshot, ReservationAuditEntry, AppliedDiscount, ReservationDiscount } from "../../types/reservation";
import type { ReferencesDto, AnyReservationDto } from "./contracts";
import {richMultiReservation} from './multiPresentation';
import { apiInstant, presentReservation } from "./presentation";

export function richConfiguration(refs: ReferencesDto): HotelConfigurationData {
  return {
    currency: refs.company.currency,
    breakfastVersion: refs.company.breakfast_version,
    breakfastEligibleItems: (refs.breakfast_eligible_items ?? []).map(i => ({ inventoryItemId: i.product_id, kind: i.kind, enabled: i.enabled })),
    defaultCheckInTime: refs.company.default_check_in_time.slice(0, 5),
    defaultCheckOutTime: refs.company.default_check_out_time.slice(0, 5),
    roomTypes: refs.room_types.map(r => ({ id: r.id, serverVersion: r.version, archived: r.archived, label: r.label, enabled: r.enabled, defaultCapacity: r.default_capacity, amenities: r.amenities ?? [], defaultInclusions: (r.default_inclusions ?? []).map(i => ({ catalogId: i.product_id, quantity: i.quantity })) })),
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
    bookingSources: refs.booking_sources.map(presentSource),
    channelAgreements: (refs.source_agreements??[]).map(presentAgreement),
    // These capabilities are unavailable, not populated from demo fixtures.
    inventoryCategories: (refs.inventory_categories ?? []).map(r => ({ id: r.id, serverVersion: r.version, label: r.label, type: r.type, enabled: r.enabled, systemDefined: r.system_defined })),
    catalogItems: (refs.catalog_products ?? []).map(r => ({ id: r.id, serverVersion: r.version, serverUnitAmountMinor: r.unit_amount_minor, label: r.label,
      categoryId: r.category_id, category: refs.inventory_categories?.find(c => c.id === r.category_id)?.type ?? "ordinary",
      price: r.unit_amount_minor / 100, enabled: r.enabled, archived: r.archived, availableForSale: r.available_for_sale })),
    discounts: (refs.discount_presets ?? []).map(d => ({id:d.id,serverVersion:d.version,serverValue:d.value,label:d.label,scope:d.scope,method:d.method,value:Number(d.value),currency:d.currency,enabled:d.enabled,targetRoomTypeId:d.target_room_type_id ?? undefined,targetItemId:d.target_product_id ?? undefined,
      serverReplacementMinor:d.replacement_unit_amount_minor ?? undefined,serverRatePrices:d.rate_prices,
      discountedUnitPrice:d.replacement_unit_amount_minor == null ? undefined : d.replacement_unit_amount_minor / 100,
      rates:d.rate_prices?.map(r => ({rateId:r.rate_id,discountedUnitPrice:r.unit_amount_minor/100}))})),
  };
}

export function richReservation(dto: AnyReservationDto, refs: ReferencesDto): ReservationSnapshot {
  presentReservation(dto);
  if(dto.allocation===null)return richMultiReservation(dto,refs);
  const a = dto.allocation, line = dto.pricing.snapshot.lines[0], amount = line.amount_minor / 100;
  const mapLineId = (id: string) => id === `room:${line.room_id}` ? `room:${line.room_number}` : id;
  const overrides: (AppliedDiscount & ReservationDiscount)[] = (dto.pricing.snapshot.price_overrides ?? []).map(d => ({id:d.id,label:d.label,scope:d.scope,method:"final_price",value:0,targetId:mapLineId(d.line_id),sourcePresetId:d.preset_id,sourcePresetName:d.label,targetRoomTypeId:d.scope === "room" ? d.target_id : undefined,targetItemId:d.scope === "item" ? d.target_id : undefined,rateId:d.rate_id ?? undefined,currency:d.currency,baseUnitPrice:d.original_unit_amount_minor/100,discountedUnitPrice:d.replacement_unit_amount_minor/100,quantity:d.quantity,appliedAt:apiInstant(d.applied_at),amount:d.effect_minor/100,allocations:[{lineId:mapLineId(d.line_id),amount:d.effect_minor/100}]}));
  const effect = (id:string) => (dto.pricing.snapshot.price_overrides ?? []).filter(o=>o.line_id === id).reduce((sum,o)=>sum+o.effect_minor,0);
  const applied: (AppliedDiscount & ReservationDiscount)[] = (dto.pricing.snapshot.discounts ?? []).map(d => ({ id: d.id, label: d.label, scope: d.scope, method: d.method,
    ...(d.preset_id ? {sourcePresetId:d.preset_id,sourcePresetName:d.label,targetRoomTypeId:d.scope === "room" ? d.preset_target_id ?? undefined : undefined,targetItemId:d.scope === "item" ? d.preset_target_id ?? undefined : undefined,rateId:d.preset_rate_id ?? undefined} : {}),
    value: Number(d.value), targetId: d.scope === "room" ? d.preset_id ? `room:${line.room_number}` : line.room_number : d.target_id, currency: d.currency, appliedAt: apiInstant(d.applied_at),
    amount: d.amount_minor / 100, order: d.order, allocations: d.allocations.map(a => ({ lineId: mapLineId(a.line_id), amount: a.amount_minor / 100 })) }));
  const events: Record<string, ReservationAuditEntry["eventType"]> = {
    "reservation.created": "created", "reservation.updated": "updated", "reservation.check_in": "checked_in",
    "reservation.check_out": "checked_out", "reservation.cancel": "cancelled", "reservation.no_show": "no_show",
    "reservation.record_departure": "departure_recorded",
  };
  return {
    id: dto.id, serverVersion: dto.version, status: dto.status, guestId: dto.guest.id,
    bookingSourceId: dto.booking_source_id, bookingSourceLabel: sourceLabel(dto.booking_source_id,dto.booking_source_label,refs.booking_sources),
    checkIn: apiInstant(a.scheduled_start), checkOut: apiInstant(a.scheduled_end), note: dto.note,
    createdAt: apiInstant(dto.created_at), actualCheckInAt: a.actual_check_in ? apiInstant(a.actual_check_in) : undefined,
    actualCheckOutAt: a.actual_check_out ? apiInstant(a.actual_check_out) : undefined,
    occupancyLockRoomNumbers: dto.status === "cancelled" && a.actual_check_in && !a.actual_check_out ? [line.room_number] : [],
    rooms: [{ allocationId:a.id, roomNumber: line.room_number, roomTypeId: line.room_type_id, roomType: line.room_type_label,
      checkIn: apiInstant(a.scheduled_start), checkOut: apiInstant(a.scheduled_end), durationId: a.duration_id,
      adults: a.adults, children: a.children, capturedRoomPrice: amount, capturedCurrency: line.currency,
      capturedUnitPrice: line.unit_amount_minor / 100, capturedPricingQuantity: line.quantity, capturedRateId: line.rate_id,
      inclusions: (a.inclusions ?? []).filter(i => i.quantity > 0).map(i => ({ catalogId: i.product_id, label: i.label, quantity: i.quantity })), inclusionOrigins: Object.fromEntries((a.inclusions ?? []).map(i => [i.product_id, { source: i.source, ...(i.overridden ? { overridden: true } : {}) }])), charges: (dto.pricing.snapshot.charges ?? []).map(item => ({ id: item.id, catalogId: item.product_id, usage: item.usage,
        label: item.label, quantity: item.quantity, unitPrice: item.unit_amount_minor / 100 })), breakfast: (a.breakfast ?? []).map(i => ({ stayDate: i.service_date, guestNumber: i.guest_number, status: i.status, mealId: i.meal_id ?? undefined, beverageId: i.beverage_id ?? undefined, mealLabel: i.meal_label ?? undefined, beverageLabel: i.beverage_label ?? undefined, quantity: 1, unitPrice: 0, lineTotal: 0 })), actualCheckInAt: a.actual_check_in ? apiInstant(a.actual_check_in) : undefined,
      actualCheckOutAt: a.actual_check_out ? apiInstant(a.actual_check_out) : undefined }],
    discounts: [...overrides,...applied].map(({ amount: _amount, order: _order, allocations: _allocations, ...intent }) => { void _amount; void _order; void _allocations; return intent; }), adjustments: (dto.pricing.snapshot.adjustments ?? []).map(item => ({ id: item.id, amount: item.amount_minor / 100, reason: item.reason })),
    pricing: { discounts: [...applied].sort((a, b) => a.order! - b.order!), ...(dto.pricing.snapshot.pipeline_version ? { pipelineVersion: dto.pricing.snapshot.pipeline_version } : {}), lines: [{ id: `room:${line.room_number}`, label: `Room ${line.room_number} · ${line.room_type_label}`,
      roomNumber: line.room_number, kind: "room", amount, effectiveAmount: (line.amount_minor-effect(`room:${line.room_id}`))/100, effectiveUnitPrice:(line.amount_minor-effect(`room:${line.room_id}`))/line.quantity/100, finalAmount: (line.amount_minor - effect(`room:${line.room_id}`) - (dto.pricing.snapshot.discounts ?? []).flatMap(d => d.allocations).filter(a => a.line_id === `room:${line.room_id}`).reduce((sum, a) => sum + a.amount_minor, 0)) / 100, baseUnitPrice: line.unit_amount_minor / 100,
      pricingQuantity: line.quantity, rateId: line.rate_id, currency: line.currency, roomTypeId: line.room_type_id },
      ...(dto.pricing.snapshot.charges ?? []).map(item => ({ id: item.id, catalogId: item.product_id, usage: item.usage,
        label: item.label, roomNumber: line.room_number, kind: "charge" as const, amount: item.amount_minor / 100, effectiveAmount: (item.amount_minor-effect(item.id))/100, effectiveUnitPrice:(item.amount_minor-effect(item.id))/item.quantity/100, finalAmount: (item.amount_minor - effect(item.id) - (dto.pricing.snapshot.discounts ?? []).flatMap(d => d.allocations).filter(a => a.line_id === item.id).reduce((sum, a) => sum + a.amount_minor, 0)) / 100, quantity: item.quantity, unitPrice: item.unit_amount_minor / 100, currency: item.currency }))],
      ...(overrides.length ? {priceOverrides:overrides,priceOverrideTotal:(dto.pricing.snapshot.price_override_total_minor ?? 0)/100} : {}),
      subtotal: Number((dto.pricing.snapshot.charges ?? []).reduce((sum, item) => sum + BigInt(item.amount_minor), BigInt(line.amount_minor))) / 100, discountTotal: (dto.pricing.snapshot.discount_total_minor ?? 0) / 100, adjustmentTotal: Number((dto.pricing.snapshot.adjustments ?? []).reduce((sum, item) => sum + BigInt(item.amount_minor), 0n)) / 100, amountOwed: dto.pricing.snapshot.total_minor / 100 },
    audit: dto.audit.map(e => ({ eventType: events[e.event_type] ?? "updated",
      action: e.event_type, actor: e.actor, occurredAt: apiInstant(e.occurred_at) })),
  };
}
