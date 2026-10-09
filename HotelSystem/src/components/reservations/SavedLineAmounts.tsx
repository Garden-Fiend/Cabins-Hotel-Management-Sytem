import type { ReservationPriceLine } from "../../types/reservation";

export function SavedLineAmounts({ line, currency }: { line: ReservationPriceLine; currency: string }) {
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount);
  return <span className="text-right">
    <span className="block">{money(line.amount)}</span>
    {line.effectiveAmount !== undefined && line.effectiveAmount !== line.amount && <span className="block text-xs text-slate-500">After final-price preset: {money(line.effectiveAmount)}</span>}
    {line.finalAmount !== undefined && line.finalAmount !== line.amount && <span className="block text-xs text-slate-500">After all discounts: {money(line.finalAmount)}</span>}
  </span>;
}
