import { describe, expect, it } from "vitest";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { getBreakfastProducts, getSellableProducts } from "./inventoryProducts";
import { buildReservationPriceLines } from "./reservationDraftPricing";
import { calculateReservationPrice } from "./reservationPricing";

describe("shared inventory products", () => {
  it("requires explicit breakfast eligibility independently of category and selling price", () => {
    expect(getSellableProducts(sampleConfiguration).some((item) => item.id === "pancit-canton")).toBe(true);
    expect(getBreakfastProducts(sampleConfiguration, "meal").some((item) => item.id === "pancit-canton")).toBe(false);
    const configuration = { ...sampleConfiguration, breakfastEligibleItems: [{ inventoryItemId: "potato-chips", kind: "beverage" as const, enabled: true }] };
    expect(getBreakfastProducts(configuration, "beverage")[0]).toMatchObject({ id: "potato-chips", price: 35, enabled: true });
    expect(getBreakfastProducts(configuration, "meal")).toEqual([]);
  });
  it("blocks inactive products/categories and sale-disabled products without erasing references", () => {
    const configuration = { ...sampleConfiguration, catalogItems: sampleConfiguration.catalogItems.map((item) => item.id === "coffee" ? { ...item, enabled: false } : item.id === "filipino" ? { ...item, availableForSale: false } : item), inventoryCategories: sampleConfiguration.inventoryCategories.map((item) => item.id === "snacks" ? { ...item, enabled: false } : item) };
    expect(getBreakfastProducts(configuration, "beverage").find((item) => item.id === "coffee")?.enabled).toBe(false);
    expect(getSellableProducts(configuration).some((item) => ["coffee", "filipino", "potato-chips"].includes(item.id))).toBe(false);
    expect(getBreakfastProducts(configuration, "meal").find((item) => item.id === "filipino")?.enabled).toBe(true);
  });
  it("charges captured purchases once while the same product is complimentary for breakfast", () => {
    const draft = { roomNumber: "101", roomTypeId: "standard", roomType: "Standard", useReservationStay: true, durationId: "1-night", priceLocked: true, capturedRoomPrice: 2200, capturedCurrency: "PHP", charges: [{ id: "purchase-1", catalogId: "filipino", label: "Filipino breakfast", quantity: 2, unitPrice: 150, usage: "purchase" as const }], breakfast: { "2026-11-11:0": { status: "included" as const, meal: "filipino", drink: "coffee" } } };
    const configuration = { ...sampleConfiguration, catalogItems: sampleConfiguration.catalogItems.map((item) => ({ ...item, price: 999 })) };
    const lines = buildReservationPriceLines([draft], "1-night", configuration);
    expect(lines.filter((line) => line.catalogId === "filipino")).toHaveLength(1);
    expect(lines.find((line) => line.usage === "purchase")).toMatchObject({ amount: 300, unitPrice: 150 });
    expect(lines.find((line) => line.usage === "complimentary_breakfast")?.amount).toBe(0);
    expect(calculateReservationPrice(lines, [], []).amountOwed).toBe(2500);
  });
});
