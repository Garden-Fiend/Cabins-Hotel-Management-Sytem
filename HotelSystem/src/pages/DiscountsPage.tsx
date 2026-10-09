import { DiscountPresetsEditor } from "../features/discounts/DiscountPresetsEditor";

export function DiscountsPage() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Pricing
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Discounts</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage reusable room, item, and reservation discount presets.
          Staff choose when to apply them to a reservation.
        </p>
      </header>
      <DiscountPresetsEditor />
    </div>
  );
}
