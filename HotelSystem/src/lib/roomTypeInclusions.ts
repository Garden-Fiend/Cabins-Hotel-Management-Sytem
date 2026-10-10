import type { HotelConfigurationData } from "../features/configuration/types";
import type { InclusionOrigin } from "../types/reservation";

export interface InclusionSelection {
  inclusions: Record<string, number>;
  inclusionOrigins: Record<string, InclusionOrigin>;
}
export function validateDefaultInclusions(items: { catalogId: string; quantity: number }[], configuration: HotelConfigurationData) {
  if (new Set(items.map((item) => item.catalogId)).size !== items.length) return "Each inclusion can appear only once.";
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) return "Inclusion quantities must be positive whole numbers.";
  if (items.some((item) => !configuration.catalogItems.some((product) => product.id === item.catalogId && product.category === "inclusion"))) return "Select an existing inclusion.";
  return "";
}
export function switchInclusionDefaults(selection: InclusionSelection, configuration: HotelConfigurationData, roomTypeId: string): InclusionSelection {
  const inclusions: Record<string, number> = {};
  const inclusionOrigins: Record<string, InclusionOrigin> = {};
  for (const [id, quantity] of Object.entries(selection.inclusions)) {
    if (selection.inclusionOrigins[id]?.source !== "default") {
      inclusions[id] = quantity; inclusionOrigins[id] = { source: "manual" };
    }
  }
  for (const item of configuration.roomTypes.find((type) => type.id === roomTypeId)?.defaultInclusions ?? []) {
    const product = configuration.catalogItems.find((product) => product.id === item.catalogId);
    if (!product?.enabled || product.archived || product.category !== "inclusion" || !Number.isInteger(item.quantity) || item.quantity < 1) continue;
    if (inclusionOrigins[item.catalogId]?.source === "manual") continue;
    const origin = selection.inclusionOrigins[item.catalogId];
    const overridden = origin?.source === "default" && origin.overridden && selection.inclusions[item.catalogId] > 0;
    inclusions[item.catalogId] = overridden ? selection.inclusions[item.catalogId] : item.quantity;
    inclusionOrigins[item.catalogId] = { source: "default", ...(overridden ? { overridden: true } : {}) };
  }
  return { inclusions, inclusionOrigins };
}
export function setInclusionQuantity(selection: InclusionSelection, id: string, quantity: number): InclusionSelection {
  return { inclusions: { ...selection.inclusions, [id]: Math.max(0, Math.floor(quantity) || 0) }, inclusionOrigins: { ...selection.inclusionOrigins, [id]: selection.inclusionOrigins[id]?.source === "default" ? { source: "default", overridden: true } : { source: "manual" } } };
}
