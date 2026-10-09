import { useState } from "react";

import { demoReservations, demoStays } from "../data/demoReservations";
import { sampleGuests } from "../data/datasample";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import type { HotelConfigurationData } from "../features/configuration/types";
import type { Stay } from "../types/booking";
import type { ReservationSnapshot } from "../types/reservation";
import { ReservationDemoContext } from "./reservationDemoStore";

export function ReservationDemoProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [reservations, setReservations] =
    useState<ReservationSnapshot[]>(demoReservations);
  const [stays, setStays] = useState<Stay[]>(demoStays);
  const [guests, setGuests] = useState(sampleGuests);
  const [configuration, setConfiguration] =
    useState<HotelConfigurationData>(sampleConfiguration);

  return (
    <ReservationDemoContext.Provider
      value={{
        reservations,
        setReservations,
        stays,
        setStays,
        guests,
        setGuests,
        configuration,
        setConfiguration,
      }}
    >
      {children}
    </ReservationDemoContext.Provider>
  );
}
