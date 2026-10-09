import type {
  ReservationCatalogItem,
  BookingSourceOption,
  ReservationDuration,
  ReservationGuest,
  ReservationConfigOption,
  ReservationRoomOption,
} from "../types/reservation";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import type {
  RoomConfiguration,
  RoomTypeConfiguration,
} from "../features/configuration/types";

export interface SampleRoom extends ReservationRoomOption {
  displayType: string;
  maintenanceStatus?: "housekeeping" | "maintenance";
  enabled: boolean;
}

export interface SampleGuest extends ReservationGuest {
  stayCount: number;
  segment: "New" | "Returning" | "VIP" | "Loyal";
}

export interface SampleRoomType extends ReservationConfigOption {
  rates: Record<string, number>;
}

const roomTypeName = (id: string, types: RoomTypeConfiguration[]) =>
  types.find((roomType) => roomType.id === id)?.label ?? id;
const roomStatusIdByLabel = (label: string) =>
  sampleConfiguration.roomStatuses.find((status) => status.label === label)?.id;

const demoSnapshotRates: Record<string, Record<string, number>> = {
  Standard: {
    "6-hours": 1100,
    "8-hours": 1300,
    "12-hours": 1650,
    "1-night": 2200,
    "2-nights": 4100,
    "3-nights": 5900,
  },
  Deluxe: {
    "6-hours": 1500,
    "8-hours": 1800,
    "12-hours": 2200,
    "1-night": 2900,
    "2-nights": 5400,
    "3-nights": 7800,
  },
  Suite: {
    "6-hours": 2200,
    "8-hours": 2600,
    "12-hours": 3200,
    "1-night": 4200,
    "2-nights": 7900,
    "3-nights": 11500,
  },
};

export const sampleRoomTypes: SampleRoomType[] =
  sampleConfiguration.roomTypes.map((roomType) => ({
    ...roomType,
    rates: demoSnapshotRates[roomType.label] ?? {},
  }));

export const sampleRooms: SampleRoom[] = sampleConfiguration.rooms.map(
  (room: RoomConfiguration) => {
    const operationalStatus = sampleConfiguration.roomStatuses.find(
      (status) => status.id === room.roomStatusId,
    );
    return {
      number: room.number,
      roomTypeId: room.roomTypeId,
      type: roomTypeName(room.roomTypeId, sampleConfiguration.roomTypes),
      displayType: room.displayType,
      enabled: room.enabled,
      ...(operationalStatus?.id === roomStatusIdByLabel("Housekeeping")
        ? { maintenanceStatus: "housekeeping" as const }
        : operationalStatus?.blocksReservation
          ? { maintenanceStatus: "maintenance" as const }
          : {}),
    };
  },
);

export const rooms = sampleRooms.map((room) => room.number);
export const reservationRooms: ReservationRoomOption[] = sampleRooms.map(
  ({ number, roomTypeId, type }) => ({ number, roomTypeId, type }),
);

export const sampleGuests: SampleGuest[] = [
  {
    id: "guest-john-doe",
    name: "John Doe",
    phone: "+63 917 555 0101",
    email: "john@example.com",
    stayCount: 4,
    segment: "Returning",
  },
  {
    id: "guest-jane-smith",
    name: "Jane Smith",
    phone: "+63 917 555 0102",
    email: "jane@example.com",
    stayCount: 2,
    segment: "VIP",
  },
  {
    id: "guest-alice-johnson",
    name: "Alice Johnson",
    phone: "+63 917 555 0103",
    email: "alice@example.com",
    stayCount: 6,
    segment: "Loyal",
  },
  {
    id: "guest-bob-wilson",
    name: "Bob Wilson",
    phone: "+63 917 555 0104",
    email: "bob@example.com",
    stayCount: 1,
    segment: "New",
  },
  {
    id: "guest-charlie-brown",
    name: "Charlie Brown",
    phone: "",
    email: "",
    stayCount: 1,
    segment: "New",
  },
  {
    id: "guest-david-miller",
    name: "David Miller",
    phone: "",
    email: "",
    stayCount: 1,
    segment: "New",
  },
  {
    id: "guest-emma-davis",
    name: "Emma Davis",
    phone: "+63 917 555 0105",
    email: "emma@example.com",
    stayCount: 3,
    segment: "Returning",
  },
];

export const reservationDurations: ReservationDuration[] =
  sampleConfiguration.durations;

export const bookingSources: BookingSourceOption[] =
  sampleConfiguration.bookingSources;

export const reservationInclusions: ReservationCatalogItem[] =
  sampleConfiguration.catalogItems.filter((item) => item.category === "inclusion");

export const reservationExtraCharges: ReservationCatalogItem[] =
  sampleConfiguration.catalogItems.filter((item) => item.category === "extra");

export const breakfastMeals: ReservationConfigOption[] =
  sampleConfiguration.catalogItems
    .filter((option) => option.category === "breakfast" && option.breakfastType === "meal")
    .map(({ id, label, enabled }) => ({ id, label, enabled }));

export const breakfastDrinks: ReservationConfigOption[] =
  sampleConfiguration.catalogItems
    .filter((option) => option.category === "breakfast" && option.breakfastType === "beverage")
    .map(({ id, label, enabled }) => ({ id, label, enabled }));

export const roomRates: Record<string, Record<string, number>> =
  Object.fromEntries(
    sampleRoomTypes.map((roomType) => [roomType.label, roomType.rates]),
  );

export const reservationCurrency = "PHP";

export const historicalRoomRates: Record<string, Record<string, number>> = {
  Deluxe: { "3-nights": 7000 },
};

export const demoLoginFormValues = {
  email: "admin@hotel.local",
  password: "password",
};