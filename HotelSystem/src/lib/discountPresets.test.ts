import { describe, expect, it } from "vitest";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import type { ReservationPriceLine } from "../types/reservation";
import { capturePreset, getApplicablePresets, isAppliedPresetCompatible, validateDiscountPreset } from "./discountPresets";
import { getRoomPriceBasis } from "./roomPricing";
import { calculateReservationPrice } from "./reservationPricing";

export const standardLine: ReservationPriceLine = { id: "room:101", label: "Standard", kind: "room", roomNumber: "101", roomTypeId: "standard", rateId: "standard-6-hours", currency: "PHP", amount: 1100, baseUnitPrice: 1100, pricingQuantity: 1 };
export const laundryLine: ReservationPriceLine = { id: "charge-1", label: "Laundry", kind: "charge", roomNumber: "101", catalogId: "laundry", currency: "PHP", amount: 360, baseUnitPrice: 120, unitPrice: 120, quantity: 3, pricingQuantity: 3 };
const special = sampleConfiguration.discounts.find((item) => item.id === "standard-special")!;
const itemSpecial = sampleConfiguration.discounts.find((item) => item.id === "laundry-special")!;
const names = (line: ReservationPriceLine, scope: "room" | "item" = "room") => getApplicablePresets(sampleConfiguration, scope, line).map((item) => item.id);

describe("preset applicability", () => {
  it("offers Standard presets only for the matching room type", () => {
    expect(names(standardLine)).toContain("standard-special");
    expect(names({ ...standardLine, roomTypeId: "deluxe", rateId: "deluxe-6-hours" })).not.toContain("standard-special");
  });
  it("requires an exact enabled hourly rate and supports partial coverage", () => {
    expect(names({ ...standardLine, rateId: "standard-8-hours" })).not.toContain("standard-special");
    const configuration = { ...sampleConfiguration, roomTypePrices: sampleConfiguration.roomTypePrices.map((rate) => ({ ...rate, enabled: rate.id !== standardLine.rateId })) };
    expect(getApplicablePresets(configuration, "room", standardLine)).toEqual([]);
  });
  it("offers item presets by stable product ID regardless of label", () => {
    expect(names({ ...laundryLine, label: "Renamed" }, "item")).toContain("laundry-special");
    expect(names({ ...laundryLine, catalogId: "extra-bed" }, "item")).not.toContain("laundry-special");
  });
  it("keeps an active covered rate available when another covered rate is retired", () => {
    const configuration = { ...sampleConfiguration, roomTypePrices: sampleConfiguration.roomTypePrices.map((rate) => ({ ...rate, enabled: rate.id !== "standard-nightly" })) };
    expect(getApplicablePresets(configuration, "room", standardLine).map((preset) => preset.id)).toContain("standard-special");
  });
  it("offers global presets with no room or item context", () => {
    expect(getApplicablePresets(sampleConfiguration, "reservation").map((item) => item.id)).toEqual(["weekend-promo"]);
  });
  it("excludes disabled presets, room types and deleted items", () => {
    expect(getApplicablePresets({ ...sampleConfiguration, discounts: sampleConfiguration.discounts.map((item) => ({ ...item, enabled: false })) }, "reservation")).toEqual([]);
    expect(getApplicablePresets({ ...sampleConfiguration, roomTypes: [] }, "room", standardLine)).toEqual([]);
    expect(getApplicablePresets({ ...sampleConfiguration, catalogItems: [] }, "item", laundryLine)).toEqual([]);
  });
  it("excludes rates in a different currency and presets above a changed base", () => {
    expect(names({ ...standardLine, currency: "USD" })).toEqual([]);
    const configuration = { ...sampleConfiguration, roomTypePrices: sampleConfiguration.roomTypePrices.map((rate) => rate.id === "standard-6-hours" ? { ...rate, amount: 800 } : rate) };
    expect(getApplicablePresets(configuration, "room", { ...standardLine, amount: 800, baseUnitPrice: 800 })).not.toContainEqual(special);
  });
});

describe("preset definition validation", () => {
  it.each([
    { label: "" }, { label: "Weekend promotion" }, { currency: "USD" },
    { rates: [] }, { rates: [{ rateId: "standard-6-hours", discountedUnitPrice: -1 }] },
    { rates: [{ rateId: "standard-6-hours", discountedUnitPrice: 1101 }] },
    { rates: [{ rateId: "missing", discountedUnitPrice: 10 }] },
    { targetRoomTypeId: "missing" },
  ])("rejects invalid room definitions %j", (changes) => {
    expect(validateDiscountPreset({ ...special, ...changes }, sampleConfiguration).length).toBeGreaterThan(0);
  });
  it("accepts a zero final price and partial rate coverage", () => {
    expect(validateDiscountPreset({ ...special, rates: [{ rateId: "standard-6-hours", discountedUnitPrice: 0 }] }, sampleConfiguration)).toEqual([]);
  });
  it.each([0, -1, 101, Number.NaN])("rejects invalid percentage %s", (value) => {
    expect(validateDiscountPreset({ ...special, method: "percentage", value }, sampleConfiguration).length).toBeGreaterThan(0);
  });
  it("rejects a reservation final price", () => {
    expect(validateDiscountPreset({ ...special, scope: "reservation" }, sampleConfiguration).length).toBeGreaterThan(0);
  });
  it("rejects invalid item unit prices and missing fixed values", () => {
    expect(validateDiscountPreset({ ...itemSpecial, discountedUnitPrice: 121 }, sampleConfiguration).length).toBeGreaterThan(0);
    expect(validateDiscountPreset({ ...itemSpecial, method: "fixed", value: Number.NaN }, sampleConfiguration).length).toBeGreaterThan(0);
  });
});

describe("captured selections", () => {
  it("keeps applied prices independent of edited, disabled and deleted presets", () => {
    const applied = capturePreset(special, standardLine);
    const original = calculateReservationPrice([standardLine], [applied], []);
    for (const discounts of [[], [{ ...special, enabled: false }], [{ ...special, rates: [{ rateId: "standard-6-hours", discountedUnitPrice: 0 }] }]]) {
      const configuration = { ...sampleConfiguration, discounts };
      expect(getApplicablePresets(configuration, "room", standardLine).length).toBeLessThanOrEqual(1);
      expect(calculateReservationPrice([standardLine], [applied], [])).toEqual(original);
    }
  });
  it("invalidates changed room type, hourly duration and removed targets", () => {
    const applied = capturePreset(special, standardLine);
    expect(isAppliedPresetCompatible(applied, [{ ...standardLine, roomTypeId: "deluxe" }])).toBe(false);
    expect(isAppliedPresetCompatible(applied, [{ ...standardLine, rateId: "standard-8-hours" }])).toBe(false);
    expect(isAppliedPresetCompatible(applied, [])).toBe(false);
  });
  it("retains nightly selection across changed night counts", () => {
    const basis = getRoomPriceBasis(sampleConfiguration, "standard", "2-nights")!;
    const line = { ...standardLine, rateId: basis.rateId, amount: basis.amount, baseUnitPrice: basis.unitPrice, pricingQuantity: basis.quantity };
    const applied = capturePreset(special, line);
    expect(isAppliedPresetCompatible(applied, [{ ...line, pricingQuantity: 3, amount: 6600 }])).toBe(true);
    expect(isAppliedPresetCompatible(applied, [{ ...line, rateId: "standard-6-hours" }])).toBe(false);
  });
  it("snapshots all scope, target and rate identifiers", () => {
    const applied = capturePreset(special, standardLine);
    expect(applied).toMatchObject({ sourcePresetId: special.id, sourcePresetName: special.label, scope: "room", method: "final_price", targetId: standardLine.id, targetRoomTypeId: "standard", rateId: standardLine.rateId, baseUnitPrice: 1100, discountedUnitPrice: 950, quantity: 1, currency: "PHP" });
    expect(applied.appliedAt).toBeInstanceOf(Date);
  });
});

