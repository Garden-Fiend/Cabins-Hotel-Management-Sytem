import type { DiscountDefinitionConfiguration } from "../discounts/types";

export type ConfigurationValue = string | number | boolean | string[];

export interface RoomTypeConfiguration {
  id: string;
  label: string;
  enabled: boolean;
  archived?: boolean;
  defaultCapacity: number;
  amenities: string[];
}

export interface RoomStatusConfiguration {
  id: string;
  label: string;
  enabled: boolean;
  blocksReservation: boolean;
}

export interface RoomConfiguration {
  id: string;
  number: string;
  roomTypeId: string;
  displayType: string;
  roomStatusId: string;
  enabled: boolean;
  archived?: boolean;
  housekeepingState: HousekeepingState;
  capacityOverride?: number;
  description: string;
  amenitiesAdditions: string[];
  amenitiesRemovals: string[];
  operationalNotes: string;
  occupancyLockReservationId?: string;
}

export type HousekeepingState = "clean" | "dirty" | "cleaning";

export interface DurationConfiguration {
  id: string;
  label: string;
  minutes: number;
  enabled: boolean;
  bookingType: "hourly" | "overnight";
  nights?: number;
}

export interface BookingSourceConfiguration {
  id: string;
  label: string;
  enabled: boolean;
}

export type CatalogCategory =
  | "inclusion"
  | "extra"
  | "breakfast"
  | "amenities"
  | "ordinary";

export type BreakfastProductType = "meal" | "beverage";

export interface InventoryCategoryConfiguration {
  id: string;
  label: string;
  type: CatalogCategory;
  enabled: boolean;
  systemDefined: boolean;
}

export interface CatalogConfiguration {
  id: string;
  label: string;
  category: CatalogCategory;
  categoryId: string;
  breakfastType?: BreakfastProductType;
  price: number;
  enabled: boolean;
  archived?: boolean;
}

export interface RoomTypePriceConfiguration {
  id: string;
  roomTypeId: string;
  bookingType: "hourly" | "overnight";
  durationId?: string;
  amount: number;
  currency: string;
  enabled: boolean;
}

export interface HotelConfigurationData {
  roomTypes: RoomTypeConfiguration[];
  rooms: RoomConfiguration[];
  durations: DurationConfiguration[];
  bookingSources: BookingSourceConfiguration[];
  catalogItems: CatalogConfiguration[];
  inventoryCategories: InventoryCategoryConfiguration[];
  roomTypePrices: RoomTypePriceConfiguration[];
  discounts: DiscountDefinitionConfiguration[];
  roomStatuses: RoomStatusConfiguration[];
  defaultCheckInTime: string;
  defaultCheckOutTime: string;
  currency: string;
}

export type ConfigurationSection = {
  id: keyof Pick<
    HotelConfigurationData,
    | "roomTypes"
    | "rooms"
    | "durations"
    | "bookingSources"
    | "catalogItems"
    | "roomTypePrices"
    | "roomStatuses"
  >;
  group: "Rooms & Inventory" | "Booking" | "Catalog" | "Pricing" | "Operations";
  label: string;
  description: string;
};

export const configurationSections: ConfigurationSection[] = [
  {
    id: "roomTypes",
    group: "Rooms & Inventory",
    label: "Room Types",
    description: "Manage the room categories assigned to physical rooms.",
  },
  {
    id: "rooms",
    group: "Rooms & Inventory",
    label: "Rooms",
    description: "Manage physical rooms, their room type, and operational status.",
  },
  {
    id: "durations",
    group: "Booking",
    label: "Durations",
    description: "Configure the exact supported reservation durations.",
  },
  {
    id: "bookingSources",
    group: "Booking",
    label: "Booking Sources",
    description: "Choose which channels staff can select for new reservations.",
  },
  {
    id: "catalogItems",
    group: "Catalog",
    label: "Inclusions & Extras",
    description: "Manage included services and optional room-level charges.",
  },
  {
    id: "roomTypePrices",
    group: "Pricing",
    label: "Room Prices",
    description: "Configure hourly package prices and one base nightly rate per room type.",
  },
  {
    id: "roomStatuses",
    group: "Operations",
    label: "Room Statuses",
    description: "Manage operational statuses separately from reservation occupancy.",
  },
];
