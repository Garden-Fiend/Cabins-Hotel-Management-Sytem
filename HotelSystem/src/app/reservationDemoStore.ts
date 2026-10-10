import type { ChannelSettlement } from "../features/channels/types";
import type { ChannelCapabilities } from "./permissions";
import { createContext } from "react";

import type { Stay } from "../types/booking";
import type { ReservationSnapshot } from "../types/reservation";
import type { SampleGuest } from "../data/datasample";
import type { HotelConfigurationData } from "../features/configuration/types";

export interface ReservationDemoContextValue {
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
