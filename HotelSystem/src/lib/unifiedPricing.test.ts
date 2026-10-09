import { describe, expect, it } from "vitest";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import type { ReservationDiscount, ReservationPriceLine } from "../types/reservation";
import { capturePreset } from "./discountPresets";
import { calculateReservationPrice } from "./reservationPricing";
import { roundMoney } from "./money";

const room: ReservationPriceLine = { id: "room:101", label: "Room", kind: "room", roomNumber: "101", roomTypeId: "standard", rateId: "standard-nightly", amount: 5850, baseUnitPrice: 1950, pricingQuantity: 3, currency: "PHP" };
const item: ReservationPriceLine = { id: "item-a", label: "Mug", kind: "charge", roomNumber: "101", catalogId: "mug", unitPrice: 120, baseUnitPrice: 120, quantity: 3, amount: 360, currency: "PHP" };
const roomPreset: ReservationDiscount = { id: "room-special", label: "Room special", scope: "room", method: "final_price", value: 0, targetId: room.id, sourcePresetId: "special", targetRoomTypeId: "standard", rateId: "standard-nightly", discountedUnitPrice: 1750, baseUnitPrice: 1950, currency: "PHP" };
const itemPreset: ReservationDiscount = { id: "item-special", label: "Item special", scope: "item", method: "final_price", value: 0, targetId: item.id, sourcePresetId: "mug-special", targetItemId: "mug", discountedUnitPrice: 90, currency: "PHP" };
const manual = (scope: ReservationDiscount["scope"], method: "fixed" | "percentage", value: number, targetId = "", id = "manual"): ReservationDiscount => ({ id, label: id, scope, method, value, targetId });

describe("unified pricing pipeline", () => {
  it("replaces an hourly package without deriving a percentage", () => {
    const line = { ...room, amount: 1100, baseUnitPrice: 1100, pricingQuantity: 1, rateId: "standard-6-hours" };
    const preset = capturePreset(sampleConfiguration.discounts.find((preset) => preset.id === "standard-special")!, line);
    expect(calculateReservationPrice([line], [preset], []).amountOwed).toBe(950);
  });
  it("multiplies discounted nightly unit price by captured nights", () => {
    const summary = calculateReservationPrice([room], [roomPreset], []);
    expect(summary).toMatchObject({ subtotal: 5850, discountTotal: 600, amountOwed: 5250 });
    expect(summary.discounts[0]).toMatchObject({ baseUnitPrice: 1950, discountedUnitPrice: 1750, quantity: 3, order: 0, amount: 600 });
  });
  it("multiplies item final unit prices by quantity", () => {
    expect(calculateReservationPrice([item], [itemPreset], [])).toMatchObject({ subtotal: 360, discountTotal: 90, amountOwed: 270 });
  });
  it("applies fixed item presets as total line reductions", () => {
    expect(calculateReservationPrice([item], [{ ...itemPreset, method: "fixed", value: 30 }], []).amountOwed).toBe(330);
  });
  it("applies percentage item presets against remaining amounts", () => {
    expect(calculateReservationPrice([item], [{ ...itemPreset, method: "percentage", value: 25 }], []).amountOwed).toBe(270);
  });
  it("orders final prices, manual line reductions, then reservation percentages", () => {
    const oneNight = { ...room, amount: 1950, pricingQuantity: 1 };
    const summary = calculateReservationPrice([oneNight], [manual("reservation", "percentage", 10), manual("room", "fixed", 100, "101", "courtesy"), roomPreset], []);
    expect(summary.amountOwed).toBe(1485);
    expect(summary.discounts.map((discount) => discount.amount)).toEqual([200, 100, 165]);
    expect(summary.discounts.map((discount) => discount.order)).toEqual([0, 1, 2]);
  });
  it("preserves manual room scope including extras, while preset room scope is accommodation only", () => {
    const summary = calculateReservationPrice([room, item], [{ ...roomPreset, method: "percentage", value: 10 }, manual("room", "percentage", 10, "101")], []);
    expect(summary.discounts.map((discount) => discount.amount)).toEqual([585, 562.5]);
  });
  it("applies one product preset only to the selected repeated charge line", () => {
    const summary = calculateReservationPrice([item, { ...item, id: "item-b" }], [itemPreset], []);
    expect(summary.amountOwed).toBe(630);
    expect(summary.lines.map((line) => line.finalAmount)).toEqual([270, 360]);
  });
  it("handles multiple rooms of the same and different types independently", () => {
    const second = { ...room, id: "room:102", roomNumber: "102" };
    const deluxe = { ...room, id: "room:201", roomNumber: "201", roomTypeId: "deluxe", rateId: "deluxe-nightly" };
    expect(calculateReservationPrice([room, second, deluxe], [roomPreset], []).discountTotal).toBe(600);
  });
  it("preserves stable ordering within each reduction stage", () => {
    expect(calculateReservationPrice([item], [manual("item", "fixed", 100, item.id), manual("item", "percentage", 50, item.id, "second")], [], { staged: true }).discounts.map((discount) => discount.amount)).toEqual([100, 130]);
  });
  it("caps reductions, retains signed adjustments and never goes negative", () => {
    expect(calculateReservationPrice([item], [itemPreset, manual("item", "fixed", 1000, item.id)], [-10])).toMatchObject({ discountTotal: 360, adjustmentTotal: -10, amountOwed: 0 });
    expect(calculateReservationPrice([item], [itemPreset], [25]).amountOwed).toBe(295);
  });
  it("maintains original subtotal identity without double counting", () => {
    const summary = calculateReservationPrice([room, item], [roomPreset, itemPreset, manual("reservation", "fixed", 100)], []);
    expect(summary).toMatchObject({ subtotal: 6210, discountTotal: 790, amountOwed: 5420 });
    expect(summary.amountOwed).toBe(summary.subtotal - summary.discountTotal + summary.adjustmentTotal);
    expect(summary.lines[0]).toMatchObject({ amount: 5850, effectiveAmount: 5250, effectiveUnitPrice: 1750 });
  });
  it("allows zero final prices and rejects competing overrides", () => {
    expect(calculateReservationPrice([item], [{ ...itemPreset, discountedUnitPrice: 0 }], []).amountOwed).toBe(0);
    expect(() => calculateReservationPrice([item], [itemPreset, { ...itemPreset, id: "duplicate" }], [])).toThrow(/one final-price/);
  });
  it("rejects invalid final prices, target mismatches and mixed currencies", () => {
    expect(() => calculateReservationPrice([item], [{ ...itemPreset, discountedUnitPrice: 121 }], [])).toThrow(/match|base price/);
    expect(() => calculateReservationPrice([item], [{ ...itemPreset, discountedUnitPrice: -1 }], [])).toThrow();
    expect(() => calculateReservationPrice([item], [{ ...itemPreset, targetItemId: "fish" }], [])).toThrow(/matches/);
    expect(() => calculateReservationPrice([item, { ...room, currency: "USD" }], [], [])).toThrow(/currency/);
  });
  it("rounds money and percentage reductions consistently", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(1.5, "JPY")).toBe(2);
    expect(roundMoney(1.2345, "KWD")).toBe(1.235);
    const summary = calculateReservationPrice([{ ...item, amount: 0.05 }], [manual("reservation", "percentage", 10)], [0.1, 0.2]);
    expect(summary).toMatchObject({ discountTotal: 0.01, adjustmentTotal: 0.3, amountOwed: 0.34 });
  });
  it("preserves legacy manual order when no new pipeline is selected", () => {
    const legacy = calculateReservationPrice([item], [manual("reservation", "percentage", 10), manual("item", "fixed", 100, item.id, "second")], []);
    expect(legacy.amountOwed).toBe(224);
    expect(calculateReservationPrice([item], [manual("reservation", "percentage", 10), manual("item", "fixed", 100, item.id, "second")], [], { staged: true }).amountOwed).toBe(234);
  });
  it("rounds a discounted unit price before multiplying its quantity", () => {
    const summary = calculateReservationPrice([item], [{ ...itemPreset, discountedUnitPrice: 1.005 }], []);
    expect(summary.amountOwed).toBe(3.03);
  });
});
