import type { ChannelSettlement } from "../features/channels/types";
import type { ChannelCapabilities } from "./permissions";
import { createContext } from "react";

import type { Stay } from "../types/booking";
import type { ReservationSnapshot } from "../types/reservation";
import type { ReservationAdjustment, ReservationChargeSnapshot, ReservationDiscount } from "../types/reservation";
import type { SampleGuest } from "../data/datasample";
import type { HotelConfigurationData, RoomConfiguration, ConfigurationValue } from "../features/configuration/types";

export interface CommandRoomInput {useReservationStay?:boolean;start?:Date;durationId?:string;breakfastDates?:string[];roomNumber:string;adults:number;children:number;charges:ReservationChargeSnapshot[];inclusions?:{catalogId:string;quantity:number;overridden?:boolean}[];breakfast:import('../types/reservation').ReservationBreakfastSnapshot[]}

export interface ReservationDemoContextValue {
  mode?: "demo" | "api";
  commands?: {
    error?: string;
    conflict?: boolean;
    reviewMessage?: string;
    reviewLatest?: () => Promise<void>;
    busy?: boolean;
    canEditMultiple?:boolean;canEditCustomStays?:boolean;
    allocationLifecycle?:(original:ReservationSnapshot,action:"check-in"|"check-out",allocationId?:string)=>Promise<void>;
    canEditGuest?: boolean;
    canEditStay?: boolean;
    canEditAdjustments?: boolean;
    canEditDiscounts?: boolean;
    canEditPresets?: boolean;
    savePreset?: (preset: import("../features/discounts/types").DiscountDefinitionConfiguration, create?: boolean) => Promise<void>;
    loadPresets?: () => Promise<import("../features/discounts/types").DiscountDefinitionConfiguration[]>;
    canEditPurchases?: boolean;
    canEditExtraCharges?: boolean;
    canEditInclusions?: boolean;
    canEditBreakfast?: boolean;
    saveBreakfast?: (items: { inventoryItemId: string; kind: "meal" | "beverage"; enabled: boolean }[], version: number) => Promise<void>;
    loadBreakfast?: () => Promise<{ version: number; items: { inventoryItemId: string; kind: "meal" | "beverage"; enabled: boolean }[] }>;
    canEditRoomStatus?: boolean;
    lifecycle?: (original: ReservationSnapshot, action: "check-in" | "check-out" | "cancel" | "no-show" | "record-departure", vacated?: boolean) => Promise<void>;
    readiness?: (room: RoomConfiguration, state: "clean" | "cleaning") => Promise<void>;
    saveDefinition?: (section: "roomTypes" | "rooms" | "durations" | "roomTypePrices" | "catalogItems" | "inventoryCategories", id: string | undefined, values: Record<string, ConfigurationValue>, version?: number, defaultInclusions?: { catalogId: string; quantity: number }[]) => Promise<void>;
    create: (input: { rooms?:CommandRoomInput[]; breakfastDates?: string[]; breakfast?: import("../types/reservation").ReservationBreakfastSnapshot[]; inclusions?: { catalogId: string; quantity: number; overridden?: boolean }[]; charges?: ReservationChargeSnapshot[]; adjustments?: ReservationAdjustment[]; discounts?: ReservationDiscount[]; guestId: string; bookingSourceId: string; roomNumber: string; durationId: string; start: Date; adults: number; children: number; note: string }) => Promise<ReservationSnapshot>;
    patch: (original: ReservationSnapshot, input: { rooms?:CommandRoomInput[]; breakfastDates?: string[]; breakfast?: import("../types/reservation").ReservationBreakfastSnapshot[]; inclusions?: { catalogId: string; quantity: number; overridden?: boolean }[]; discounts?: ReservationDiscount[]; charges?: ReservationChargeSnapshot[]; adjustments?: ReservationAdjustment[]; guestId?: string; roomNumber?: string; durationId?: string; start?: Date; note: string; adults: number; children: number }) => Promise<ReservationSnapshot>;
    createGuest: (input: { name: string; phone: string; email: string }) => Promise<SampleGuest>;
  };
  capabilities: ChannelCapabilities;
  actor: string;
  settlements: ChannelSettlement[];
  setSettlements: React.Dispatch<React.SetStateAction<ChannelSettlement[]>>;
  reservations: ReservationSnapshot[];
  setReservations: React.Dispatch<
    React.SetStateAction<ReservationSnapshot[]>
  >;
  stays: Stay[];
  setStays: React.Dispatch<React.SetStateAction<Stay[]>>;
  guests: SampleGuest[];
  setGuests: React.Dispatch<React.SetStateAction<SampleGuest[]>>;
  configuration: HotelConfigurationData;
  setConfiguration: React.Dispatch<
    React.SetStateAction<HotelConfigurationData>
  >;
}

export const ReservationDemoContext =
  createContext<ReservationDemoContextValue | null>(null);
