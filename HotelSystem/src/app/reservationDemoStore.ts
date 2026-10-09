import { createContext } from "react";

import type { Stay } from "../types/booking";
import type { ReservationSnapshot } from "../types/reservation";
import type { SampleGuest } from "../data/datasample";
import type { HotelConfigurationData } from "../features/configuration/types";

export interface ReservationDemoContextValue {
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
