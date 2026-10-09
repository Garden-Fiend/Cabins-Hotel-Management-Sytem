import type { HotelConfigurationData } from "../features/configuration/types";
import type { DiscountDefinitionConfiguration } from "../features/discounts/types";
import type { ReservationDiscount, ReservationPriceLine } from "../types/reservation";
import { roundMoney } from "./money";

export function isChargeableItem(item: HotelConfigurationData["catalogItems"][number]) {
  return item.enabled && !item.archived && (item.category === "extra" || item.category === "ordinary");
}

export function validateDiscountPreset(preset: DiscountDefinitionConfiguration, configuration: HotelConfigurationData): string[] {
  const errors: string[] = [];
  if (!preset.label.trim()) errors.push("Enter a discount name.");
  if (configuration.discounts.some((item) => item.id !== preset.id && item.label.trim().toLowerCase() === preset.label.trim().toLowerCase())) errors.push("A discount with this name already exists.");
  if (preset.currency !== configuration.currency) errors.push("Use the current hotel currency.");
  if (preset.method !== "final_price" && (!Number.isFinite(preset.value) || preset.value <= 0 || (preset.method === "percentage" && preset.value > 100))) errors.push("Enter a positive value; percentages cannot exceed 100%.");
  if (preset.scope === "reservation" && preset.method === "final_price") errors.push("Reservation presets cannot set a final price.");
  if (preset.scope === "room") {
    if (!configuration.roomTypes.some((item) => item.id === preset.targetRoomTypeId && item.enabled && !item.archived)) errors.push("Select an active room type.");
    if (preset.method === "final_price") {
      if (!preset.rates?.length) errors.push("Enter at least one discounted rate. Blank rates are excluded.");
      const seen = new Set<string>();
      for (const override of preset.rates ?? []) {
        const rate = configuration.roomTypePrices.find((item) => item.id === override.rateId && item.roomTypeId === preset.targetRoomTypeId && item.enabled);
        const durationActive = rate?.bookingType === "overnight" || configuration.durations.some((item) => item.id === rate?.durationId && item.enabled && item.bookingType === "hourly");
        if (!rate || !durationActive || rate.currency !== preset.currency || !Number.isFinite(override.discountedUnitPrice) || override.discountedUnitPrice < 0 || roundMoney(override.discountedUnitPrice, preset.currency) > roundMoney(rate.amount, preset.currency) || seen.has(override.rateId)) errors.push("Discounted rates must match active rates, use the same currency, and be between zero and the base price.");
        seen.add(override.rateId);
      }
    }
  }
  if (preset.scope === "item") {
    const item = configuration.catalogItems.find((item) => item.id === preset.targetItemId && isChargeableItem(item));
    if (!item) errors.push("Select an active chargeable item.");
    if (preset.method === "final_price" && (!Number.isFinite(preset.discountedUnitPrice) || (preset.discountedUnitPrice ?? -1) < 0 || !item || roundMoney(preset.discountedUnitPrice ?? 0, preset.currency) > roundMoney(item.price, preset.currency))) errors.push("Discounted unit price must be between zero and the item base price.");
  }
  return [...new Set(errors)];
}

// Current configuration governs new selection, never saved applied values.
export function getApplicablePresets(configuration: HotelConfigurationData, scope: ReservationDiscount["scope"], line?: ReservationPriceLine) {
  return configuration.discounts.filter((preset) => {
    if (!preset.enabled || preset.scope !== scope || preset.currency !== (line?.currency ?? configuration.currency)) return false;
    const contextualDefinition = scope === "room" && preset.method === "final_price"
      ? { ...preset, rates: preset.rates?.filter((rate) => rate.rateId === line?.rateId) }
      : preset;
    if (validateDiscountPreset(contextualDefinition, configuration).length) return false;
    if (scope === "reservation") return true;
    if (!line) return false;
    if (scope === "room") {
      if (line.kind !== "room" || line.roomTypeId !== preset.targetRoomTypeId) return false;
      const rate = configuration.roomTypePrices.find((item) => item.id === line.rateId && item.enabled && item.roomTypeId === line.roomTypeId && item.currency === line.currency);
      if (!rate) return false;
      if (rate.bookingType === "hourly" && !configuration.durations.some((duration) => duration.id === rate.durationId && duration.enabled && duration.bookingType === "hourly")) return false;
      if (preset.method !== "final_price") return true;
      const price = preset.rates?.find((item) => item.rateId === line.rateId)?.discountedUnitPrice;
      return price !== undefined && price <= (line.baseUnitPrice ?? line.amount);
    }
    if (line.kind !== "charge" || line.catalogId !== preset.targetItemId) return false;
    return preset.method !== "final_price" || (preset.discountedUnitPrice ?? Infinity) <= (line.baseUnitPrice ?? line.unitPrice ?? 0);
  });
}

export function capturePreset(preset: DiscountDefinitionConfiguration, line?: ReservationPriceLine, now = new Date()): ReservationDiscount {
  const price = preset.scope === "room" ? preset.rates?.find((item) => item.rateId === line?.rateId)?.discountedUnitPrice : preset.discountedUnitPrice;
  if (preset.scope !== "reservation" && !line) throw new Error("A preset requires a target line.");
  if (preset.method === "final_price" && price === undefined) throw new Error("The preset does not cover this rate.");
  return {
    id: crypto.randomUUID(), label: preset.label, sourcePresetId: preset.id,
    sourcePresetName: preset.label, scope: preset.scope, method: preset.method,
    value: preset.value, targetId: preset.scope === "reservation" ? "" : line!.id,
    targetRoomTypeId: preset.targetRoomTypeId, targetItemId: preset.targetItemId,
    rateId: line?.rateId, currency: preset.currency,
    baseUnitPrice: line?.baseUnitPrice ?? line?.unitPrice,
    discountedUnitPrice: price === undefined ? undefined : roundMoney(price, preset.currency),
    quantity: line?.pricingQuantity ?? line?.quantity ?? 1, appliedAt: now,
  };
}

export function isAppliedPresetCompatible(discount: ReservationDiscount, lines: ReservationPriceLine[]) {
  if (!discount.sourcePresetId || discount.scope === "reservation") return true;
  const line = lines.find((item) => item.id === discount.targetId);
  if (!line || line.currency !== discount.currency) return false;
  if (discount.scope === "room" && (line.kind !== "room" || line.roomTypeId !== discount.targetRoomTypeId || (discount.rateId && line.rateId !== discount.rateId))) return false;
  if (discount.scope === "item" && (line.kind !== "charge" || line.catalogId !== discount.targetItemId)) return false;
  return discount.method !== "final_price" || (discount.discountedUnitPrice ?? Infinity) <= (line.baseUnitPrice ?? line.unitPrice ?? 0);
}
