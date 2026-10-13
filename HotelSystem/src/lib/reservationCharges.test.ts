import { expect, it, vi } from "vitest";
import { createChargeId } from "./reservationCharges";

it("refuses repeated purchase identities and leaves the input list untouched", () => {
  const prior = [{ id: "existing" }];
  const generate = vi.fn().mockReturnValue("existing");
  expect(() => createChargeId(prior, generate)).toThrow("unique purchase identity");
  expect(generate).toHaveBeenCalledTimes(8);
  expect(prior).toEqual([{ id: "existing" }]);
  expect(createChargeId(prior, vi.fn().mockReturnValueOnce("existing").mockReturnValueOnce("new"))).toBe("new");
});
