import type { HotelConfigurationData, BreakfastProductType } from "../features/configuration/types";

export function isActiveProduct(configuration: HotelConfigurationData, id: string) {
  const product = configuration.catalogItems.find((item) => item.id === id);
  return Boolean(product?.enabled && !product.archived && configuration.inventoryCategories.some((category) => category.id === product.categoryId && category.enabled));
}

export function getBreakfastProducts(configuration: HotelConfigurationData, kind: BreakfastProductType) {
  return (configuration.breakfastEligibleItems ?? []).filter((item) => item.kind === kind).flatMap((eligibility) => {
    const product = configuration.catalogItems.find((item) => item.id === eligibility.inventoryItemId);
    return product ? [{ ...product, enabled: eligibility.enabled && isActiveProduct(configuration, product.id) }] : [];
  });
}

export function getSellableProducts(configuration: HotelConfigurationData) {
  return configuration.catalogItems.filter((product) => product.category === "ordinary" && product.availableForSale !== false && isActiveProduct(configuration, product.id));
}
