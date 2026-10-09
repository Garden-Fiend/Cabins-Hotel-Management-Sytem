import type { AppliedDiscount } from "../../types/reservation";

export function AppliedDiscountDescription({ discount, currency }: { discount: AppliedDiscount; currency: string }) {
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);
  return <span>
    Discount · {discount.label}
    {discount.sourcePresetId && <span className="block text-xs text-slate-500">
      Preset · {discount.scope} · {discount.targetId || "reservation"}
      {discount.method === "final_price" && <> · unit {money(discount.baseUnitPrice ?? 0)} → {money(discount.discountedUnitPrice ?? 0)} × {discount.quantity ?? 1}</>}
      {discount.order !== undefined && <> · order {discount.order + 1}</>}
    </span>}
  </span>;
}
