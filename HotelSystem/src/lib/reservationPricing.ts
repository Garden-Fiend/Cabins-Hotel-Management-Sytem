import type {
  ReservationDiscount,
  ReservationPriceLine,
  ReservationPriceSummary,
} from "../types/reservation";

export function calculateReservationPrice(
  lines: ReservationPriceLine[],
  discounts: ReservationDiscount[],
  adjustments: number[],
): ReservationPriceSummary {
  const remainingAmounts = new Map(
    lines.map((line) => [line.id, Math.max(0, line.amount)]),
  );

  const appliedDiscounts = discounts.map((discount) => {
    const eligibleLines = lines.filter((line) => {
      if (discount.scope === "reservation") {
        return true;
      }

      if (discount.scope === "room") {
        return line.roomNumber === discount.targetId;
      }

      return line.id === discount.targetId;
    });

    const eligibleTotal = eligibleLines.reduce(
      (total, line) => total + (remainingAmounts.get(line.id) ?? 0),
      0,
    );

    const requestedDiscount =
      discount.method === "percentage"
        ? eligibleTotal * (discount.value / 100)
        : discount.value;
    let discountRemaining = Math.min(
      eligibleTotal,
      Math.max(0, requestedDiscount),
    );

    for (const line of eligibleLines) {
      if (discountRemaining <= 0) {
        break;
      }

      const currentAmount = remainingAmounts.get(line.id) ?? 0;
      const lineDiscount = Math.min(currentAmount, discountRemaining);
      remainingAmounts.set(line.id, currentAmount - lineDiscount);
      discountRemaining -= lineDiscount;
    }

    return {
      id: discount.id,
      label: discount.label,
      amount: Math.min(eligibleTotal, Math.max(0, requestedDiscount)),
    };
  });

  const subtotal = lines.reduce(
    (total, line) => total + Math.max(0, line.amount),
    0,
  );
  const discountTotal = appliedDiscounts.reduce(
    (total, discount) => total + discount.amount,
    0,
  );
  const adjustmentTotal = adjustments.reduce(
    (total, adjustment) => total + adjustment,
    0,
  );

  return {
    lines,
    discounts: appliedDiscounts,
    subtotal,
    discountTotal,
    adjustmentTotal,
    amountOwed: Math.max(0, subtotal - discountTotal + adjustmentTotal),
  };
}

