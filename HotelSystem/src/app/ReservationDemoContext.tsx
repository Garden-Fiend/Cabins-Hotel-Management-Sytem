import { illustrativeSettlements } from "../data/channelSamples";
import { demoChannelCapabilities, type ChannelCapabilities } from "./permissions";
import type { ChannelSettlement } from "../features/channels/types";
import { useState } from "react";

import { demoReservations, demoStays } from "../data/demoReservations";
import { sampleGuests } from "../data/datasample";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import type { HotelConfigurationData } from "../features/configuration/types";
import type { Stay } from "../types/booking";
import type { ReservationSnapshot } from "../types/reservation";
import { ReservationDemoContext } from "./reservationDemoStore";

export function ReservationDemoProvider({
  children, capabilities = demoChannelCapabilities, actor = "Local demo user",
}: {
  children: React.ReactNode; capabilities?: ChannelCapabilities; actor?: string;
}) {
  const [settlements, setSettlements] = useState<ChannelSettlement[]>(illustrativeSettlements);
  const [reservations, setReservations] =
    useState<ReservationSnapshot[]>(demoReservations);
  const [stays, setStays] = useState<Stay[]>(demoStays);
  const [guests, setGuests] = useState(sampleGuests);
  const [configuration, setConfiguration] =
    useState<HotelConfigurationData>(sampleConfiguration);

  return (
    <ReservationDemoContext.Provider
      value={{
        capabilities, actor, settlements, setSettlements,
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
