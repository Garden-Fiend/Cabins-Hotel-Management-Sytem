import type { AppliedDiscount, ReservationDiscount, ReservationPriceLine, ReservationPriceSummary } from "../types/reservation";
import { fromMinorUnits, roundMoney, toMinorUnits } from "./money";
import { isAppliedPresetCompatible } from "./discountPresets";

export function calculateReservationPrice(
  lines: ReservationPriceLine[], discounts: ReservationDiscount[], adjustments: number[],
  options: { currency?: string; staged?: boolean } = {},
): ReservationPriceSummary {
  const currency = options.currency ?? lines.find((line) => line.currency)?.currency ?? "PHP";
  if (lines.some((line) => line.currency && line.currency !== currency)) throw new Error("Reservation price lines must use one currency.");
  const staged = options.staged ?? discounts.some((discount) => discount.sourcePresetId);
  const remaining = new Map(lines.map((line) => [line.id, Math.max(0, toMinorUnits(line.amount, currency))]));
  if (remaining.size !== lines.length) throw new Error("Price line IDs must be unique.");
  const effective = new Map(remaining);
  const overrides = new Set<string>();
  const ordered = staged ? [
    ...discounts.filter((item) => item.method === "final_price"),
    ...discounts.filter((item) => item.method !== "final_price" && item.scope !== "reservation"),
    ...discounts.filter((item) => item.scope === "reservation" && item.method !== "final_price"),
  ] : discounts;
  const applied: AppliedDiscount[] = ordered.map((discount, order) => {
    if (!Number.isFinite(discount.value) || discount.value < 0 || (discount.method === "percentage" && discount.value > 100)) throw new Error("Invalid discount value.");
    if (discount.currency && discount.currency !== currency) throw new Error("Discount currency must match reservation currency.");
    if (!isAppliedPresetCompatible(discount, lines)) throw new Error(`Preset ${discount.label} no longer matches its target. Remove it or select a compatible preset.`);
    const eligible = lines.filter((line) => discount.scope === "reservation" ||
      (discount.sourcePresetId ? line.id === discount.targetId : discount.scope === "room" ? line.roomNumber === discount.targetId : line.id === discount.targetId));
    const eligibleTotal = eligible.reduce((total, line) => total + (remaining.get(line.id) ?? 0), 0);
    let reduction: number;
    if (discount.method === "final_price") {
      if (!discount.sourcePresetId || discount.scope === "reservation" || eligible.length !== 1) throw new Error("Final prices require one room or item preset target.");
      const line = eligible[0];
      if (overrides.has(line.id)) throw new Error("Only one final-price preset is allowed per line.");
      overrides.add(line.id);
      const unitPrice = discount.discountedUnitPrice;
      const quantity = line.pricingQuantity ?? line.quantity ?? discount.quantity ?? 1;
      if (!Number.isFinite(unitPrice) || (unitPrice ?? -1) < 0 || !Number.isInteger(quantity) || quantity < 1) throw new Error("Invalid final unit price or quantity.");
      const final = toMinorUnits(roundMoney(unitPrice ?? 0, currency) * quantity, currency);
      if (final > eligibleTotal) throw new Error("A discounted price cannot exceed its base price.");
      reduction = eligibleTotal - final;
    } else {
      reduction = Math.min(eligibleTotal, discount.method === "percentage" ? Math.round(eligibleTotal * discount.value / 100) : toMinorUnits(discount.value, currency));
    }
    let pending = reduction;
    const allocations = eligible.map((line) => {
      const amount = Math.min(remaining.get(line.id) ?? 0, pending);
      remaining.set(line.id, (remaining.get(line.id) ?? 0) - amount);
      pending -= amount;
      if (discount.method === "final_price") effective.set(line.id, remaining.get(line.id) ?? 0);
      return { lineId: line.id, amount: fromMinorUnits(amount, currency) };
    });
    return {
      ...discount, amount: fromMinorUnits(reduction, currency), order,
      discountedUnitPrice: discount.method === "final_price" ? roundMoney(discount.discountedUnitPrice ?? 0, currency) : discount.discountedUnitPrice,
      baseUnitPrice: eligible.length === 1 ? eligible[0].baseUnitPrice ?? eligible[0].unitPrice : discount.baseUnitPrice,
      quantity: eligible.length === 1 ? eligible[0].pricingQuantity ?? eligible[0].quantity ?? discount.quantity : discount.quantity,
      allocations,
    };
  });
  const subtotalMinor = lines.reduce((sum, line) => sum + Math.max(0, toMinorUnits(line.amount, currency)), 0);
  const discountMinor = applied.reduce((sum, item) => sum + toMinorUnits(item.amount, currency), 0);
  const adjustmentMinor = adjustments.reduce((sum, amount) => sum + toMinorUnits(amount, currency), 0);
  return {
    lines: lines.map((line) => ({ ...line, amount: roundMoney(line.amount, currency),
      effectiveAmount: fromMinorUnits(effective.get(line.id) ?? 0, currency),
      effectiveUnitPrice: roundMoney(fromMinorUnits(effective.get(line.id) ?? 0, currency) / (line.pricingQuantity ?? line.quantity ?? 1), currency),
      finalAmount: fromMinorUnits(remaining.get(line.id) ?? 0, currency),
    })),
    discounts: applied, subtotal: fromMinorUnits(subtotalMinor, currency),
    discountTotal: fromMinorUnits(discountMinor, currency), adjustmentTotal: fromMinorUnits(adjustmentMinor, currency),
    amountOwed: fromMinorUnits(Math.max(0, subtotalMinor - discountMinor + adjustmentMinor), currency),
    ...(staged ? { pipelineVersion: 2 as const } : {}),
  };
}

