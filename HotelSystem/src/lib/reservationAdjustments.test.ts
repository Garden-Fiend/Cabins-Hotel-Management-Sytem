import { describe, expect, it, vi } from "vitest";
import { adjustmentIdentityError, createAdjustment, removeAdjustment } from "./reservationAdjustments";

describe("adjustment identity", () => {
  const original = [{ id: "legacy", amount: 100, reason: "A" }];
  it("retries collisions without rewriting legacy identities", () => {
    const candidates = ["legacy", "legacy", "new"];
    const next = createAdjustment(original, 200, "B", () => candidates.shift()!);
    expect(next.id).toBe("new");
    expect(removeAdjustment([...original, next], "legacy")).toEqual([next]);
    expect(original).toEqual([{ id: "legacy", amount: 100, reason: "A" }]);
  });
  it("rejects exhausted or failed generation without mutation", () => {
    expect(() => createAdjustment(original, 200, "B", () => "legacy")).toThrow("unique");
    expect(() => createAdjustment(original, 200, "B", () => { throw new Error("unavailable"); })).toThrow("unavailable");
    expect(original).toHaveLength(1);
  });
  it("fails clearly when secure UUID support is unavailable", () => {
    vi.stubGlobal("crypto", {});
    try { expect(() => createAdjustment(original, 200, "B")).toThrow("HTTPS"); expect(original).toHaveLength(1); }
    finally { vi.unstubAllGlobals(); }
  });
  it("refuses ambiguous removal and unresolved save identities", () => {
    const duplicate = [...original, { ...original[0], amount: 200, reason: "B" }];
    expect(() => removeAdjustment(duplicate, "legacy")).toThrow("preserved");
    expect(adjustmentIdentityError(duplicate)).toContain("repair");
    expect(adjustmentIdentityError([{ id: " " }])).toContain("integrity");
    expect(removeAdjustment(original, "unknown")).toEqual(original);
    expect(duplicate).toHaveLength(2);
  });
});
