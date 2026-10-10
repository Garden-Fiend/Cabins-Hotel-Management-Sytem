import { describe, expect, it } from "vitest";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { setInclusionQuantity, switchInclusionDefaults, validateDefaultInclusions } from "./roomTypeInclusions";

const empty = { inclusions: {}, inclusionOrigins: {} };
describe("room type default inclusions", () => {
  it("populates configured quantities, replaces inherited defaults, and preserves manual additions", () => {
    let selection = switchInclusionDefaults(empty, sampleConfiguration, "deluxe");
    expect(selection.inclusions).toEqual({ "bottled-water": 2, "toiletry-kit": 2, "welcome-drink": 1 });
    selection = setInclusionQuantity(selection, "parking", 1);
    selection = switchInclusionDefaults(selection, sampleConfiguration, "standard");
    expect(selection.inclusions).toEqual({ "parking": 1, "bottled-water": 1 });
    for (let i = 0; i < 4; i++) selection = switchInclusionDefaults(selection, sampleConfiguration, i % 2 ? "standard" : "deluxe");
    expect(selection.inclusions).toEqual({ "parking": 1, "bottled-water": 1 });
  });
  it("keeps overridden shared defaults but removes overridden defaults missing from the new type", () => {
    let selection = setInclusionQuantity(switchInclusionDefaults(empty, sampleConfiguration, "deluxe"), "bottled-water", 3);
    selection = switchInclusionDefaults(selection, sampleConfiguration, "standard");
    expect(selection.inclusions["bottled-water"]).toBe(3);
    selection = switchInclusionDefaults(selection, sampleConfiguration, "suite");
    expect(selection.inclusions).toEqual({});
    selection = switchInclusionDefaults(selection, sampleConfiguration, "deluxe");
    expect(selection.inclusions["bottled-water"]).toBe(2);
  });
  it("restores a removed inherited default on a new type and never accumulates duplicate quantities", () => {
    const removed = setInclusionQuantity(switchInclusionDefaults(empty, sampleConfiguration, "deluxe"), "bottled-water", 0);
    const restored = switchInclusionDefaults(removed, sampleConfiguration, "standard");
    expect(restored.inclusions).toEqual({ "bottled-water": 1 });
    expect(removed.inclusions["bottled-water"]).toBe(0);
    const manual = setInclusionQuantity(empty, "bottled-water", 4);
    expect(switchInclusionDefaults(manual, sampleConfiguration, "deluxe").inclusions["bottled-water"]).toBe(4);
  });
  it("rejects duplicates, missing references and invalid quantities", () => {
    expect(validateDefaultInclusions([{ catalogId: "towels", quantity: 1 }, { catalogId: "towels", quantity: 2 }], sampleConfiguration)).toMatch(/once/);
    for (const quantity of [0, -1, 1.5, NaN]) expect(validateDefaultInclusions([{ catalogId: "towels", quantity }], sampleConfiguration)).toMatch(/positive whole/);
    expect(validateDefaultInclusions([{ catalogId: "coffee", quantity: 1 }], sampleConfiguration)).toMatch(/existing inclusion/);
  });
  it("does not inherit archived products or mutate existing selections after configuration edits", () => {
    const selection = switchInclusionDefaults(empty, sampleConfiguration, "standard");
    const changed = { ...sampleConfiguration, catalogItems: sampleConfiguration.catalogItems.map((item) => ({ ...item, enabled: false })) };
    expect(switchInclusionDefaults(empty, changed, "standard").inclusions).toEqual({});
    expect(selection.inclusions).toEqual({ "bottled-water": 1 });
  });
});
