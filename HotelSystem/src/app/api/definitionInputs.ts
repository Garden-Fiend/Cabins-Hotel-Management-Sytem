import type { ConfigurationValue, HotelConfigurationData } from "../../features/configuration/types";
import { parseMinor } from "../../lib/channelFinance";
import type { DefinitionKind, DefinitionMap } from "./contracts";

export type DefinitionSection = "roomTypes" | "rooms" | "durations" | "roomTypePrices" | "catalogItems" | "inventoryCategories";
export interface DefinitionIntent { kind: DefinitionKind; id?: string; body: DefinitionMap[DefinitionKind] & { expected_version?: number } }

export function definitionIntent(section: DefinitionSection, id: string | undefined, values: Record<string, ConfigurationValue>, configuration: HotelConfigurationData, version?: number, defaultInclusions?: { catalogId: string; quantity: number }[]): DefinitionIntent {
  if (id && (!version || !Number.isInteger(version))) throw new Error("Reload this definition and reopen it before saving.");
  const text = (key: string) => String(values[key] ?? "").trim();
  const list = (key: string): string[] => Array.isArray(values[key]) ? values[key] as string[] : [];
  const enabled = values.enabled === undefined ? true : values.enabled === true;
  let kind: DefinitionKind, body: DefinitionMap[DefinitionKind];
  if (section === "inventoryCategories") {
    if (!["ordinary", "amenities"].includes(text("type")) && !(["extra", "inclusion", "breakfast"].includes(text("type")) && configuration.inventoryCategories.some(c => c.id === id && c.systemDefined && c.type === text("type")))) throw new Error("This category type is not supported by the server.");
    kind = "categories"; body = { label: text("label"), type: text("type") as "ordinary" | "amenities" | "extra" | "inclusion" | "breakfast", enabled };
  } else if (section === "catalogItems") {
    const previous = configuration.catalogItems.find(item => item.id === id);
    kind = "products"; body = { label: text("label"), category_id: text("categoryId"), enabled,
      archived: values.archived === undefined ? previous?.archived ?? false : values.archived === true, available_for_sale: values.availableForSale === true && configuration.inventoryCategories.find(c => c.id === text("categoryId"))?.type === "ordinary",
      unit_amount_minor: parseMinor(text("price"), "PHP"), currency: "PHP" };
  } else if (section === "roomTypes") {
    const previous = configuration.roomTypes.find(r => r.id === id);
    kind = "room-types";
    body = { label: text("label"), default_capacity: Number(values.defaultCapacity), amenities: list("amenities"), enabled,
      ...(defaultInclusions !== undefined ? { default_inclusions: defaultInclusions.map(i => ({ product_id: i.catalogId, quantity: i.quantity })) } : {}),
      archived: values.archived === undefined ? previous?.archived ?? false : values.archived === true };
  } else if (section === "rooms") {
    const previous = configuration.rooms.find(r => r.id === id);
    if (values.housekeepingState !== undefined && text("housekeepingState") !== (previous?.housekeepingState ?? "clean"))
      throw new Error("Change readiness using Start cleaning / Mark Clean. This form preserves readiness.");
    if (!["operational", "housekeeping", "maintenance", "unavailable"].includes(text("roomStatusId"))) throw new Error("Select a supported room status.");
    const inherited = configuration.roomTypes.find(r => r.id === text("roomTypeId"))?.amenities ?? [];
    const selected = list("amenities");
    kind = "rooms";
    body = { number: text("number"), room_type_id: text("roomTypeId"), display_name: text("displayType"), enabled,
      archived: values.archived === undefined ? previous?.archived ?? false : values.archived === true,
      operational: text("roomStatusId") === "operational",
      operational_status: text("roomStatusId") as "operational" | "housekeeping" | "maintenance" | "unavailable",
      capacity_override: text("capacityOverride") ? Number(values.capacityOverride) : null,
      description: text("description"), operational_notes: text("operationalNotes"),
      amenities_additions: selected.filter(a => !inherited.includes(a)), amenities_removals: inherited.filter(a => !selected.includes(a)) };
  } else if (section === "durations") {
    if (!["hourly", "overnight"].includes(text("bookingType"))) throw new Error("Select a supported booking kind.");
    kind = "durations";
    body = { label: text("label"), kind: text("bookingType") as "hourly" | "overnight", enabled,
      minutes: text("bookingType") === "hourly" ? Number(values.minutes) : null,
      nights: text("bookingType") === "overnight" ? Number(values.nights) : null };
  } else {
    if (text("currency") !== "PHP") throw new Error("Persistent rates currently support PHP only.");
    if (!["hourly", "overnight"].includes(text("bookingType"))) throw new Error("Select a supported booking kind.");
    kind = "rates";
    const previous = configuration.roomTypePrices.find(r => r.id === id);
    const unchangedNumericAmount = typeof values.amount === "number" && values.amount === previous?.amount;
    body = { room_type_id: text("roomTypeId"), booking_kind: text("bookingType") as "hourly" | "overnight",
      duration_id: text("bookingType") === "hourly" ? text("durationId") : null,
      unit_amount_minor: unchangedNumericAmount && previous?.serverAmountMinor !== undefined ? previous.serverAmountMinor : parseMinor(text("amount"), "PHP"), currency: "PHP", enabled };
  }
  return { kind, id, body: { ...body, ...(id ? { expected_version: version } : {}) } };
}
