import { useContext } from "react";

import { ReservationDemoContext } from "./reservationDemoStore";

export function useReservationDemo() {
  const context = useContext(ReservationDemoContext);
  if (!context) {
    throw new Error(
      "useReservationDemo must be used within ReservationDemoProvider",
    );
  }
  return context;
}
