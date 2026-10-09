import { useReservationDemo } from "../../app/useReservationDemo";

export function useHotelConfiguration() {
  const { configuration, setConfiguration } = useReservationDemo();
  return { configuration, setConfiguration };
}
