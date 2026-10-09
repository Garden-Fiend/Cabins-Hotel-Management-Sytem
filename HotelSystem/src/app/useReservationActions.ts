import { useCallback, useState } from "react";

import {
  cancelReservation as cancelReservationRecord,
  checkInReservation,
  checkOutReservation,
  markReservationNoShow,
  recordGuestDeparture,
} from "../lib/reservationLifecycle";
import { useReservationDemo } from "./useReservationDemo";

export function useReservationActions() {
  const {
    reservations,
    setReservations,
    stays,
    setStays,
    configuration,
    setConfiguration,
  } = useReservationDemo();
  const [message, setMessage] = useState("");

  const apply = useCallback(
    (reservationId: string, nextReservation: (typeof reservations)[number], nextStays: typeof stays, nextConfiguration: typeof configuration) => {
      setReservations((current) =>
        current.map((item) =>
          item.id === reservationId ? nextReservation : item,
        ),
      );
      setStays(nextStays);
      setConfiguration(nextConfiguration);
    },
    [setConfiguration, setReservations, setStays],
  );

  const checkIn = useCallback(
    (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      const result = checkInReservation(
        reservation,
        stays,
        configuration,
        new Date(),
      );
      if (!result.state) {
        setMessage(result.errors.join(" "));
        return false;
      }
      apply(
        reservationId,
        result.state.reservation,
        result.state.stays,
        result.state.configuration,
      );
      setMessage(`${reservationId} checked in.`);
      return true;
    },
    [apply, configuration, reservations, stays],
  );

  const checkOut = useCallback(
    (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      const result = checkOutReservation(
        reservation,
        stays,
        configuration,
        new Date(),
      );
      if (!result.state) {
        setMessage(result.errors.join(" "));
        return false;
      }
      apply(
        reservationId,
        result.state.reservation,
        result.state.stays,
        result.state.configuration,
      );
      setMessage(`${reservationId} checked out. Assigned rooms are Dirty.`);
      return true;
    },
    [apply, configuration, reservations, stays],
  );

  const cancel = useCallback(
    (reservationId: string, guestHasVacated: boolean) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      const state = cancelReservationRecord(
        reservation,
        stays,
        configuration,
        guestHasVacated,
        new Date(),
      );
      apply(reservationId, state.reservation, state.stays, state.configuration);
      setMessage(
        state.reservation.occupancyLockRoomNumbers?.length
          ? `${reservationId} cancelled. Occupancy remains locked until guest departure is recorded.`
          : `${reservationId} cancelled.`,
      );
      return true;
    },
    [apply, configuration, reservations, stays],
  );

  const recordDeparture = useCallback(
    (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      const result = recordGuestDeparture(
        reservation,
        stays,
        configuration,
        new Date(),
      );
      if (!result.state) {
        setMessage(result.error ?? "Guest departure could not be recorded.");
        return false;
      }
      apply(
        reservationId,
        result.state.reservation,
        result.state.stays,
        result.state.configuration,
      );
      setMessage(`${reservationId} departure recorded. Assigned rooms are Dirty.`);
      return true;
    },
    [apply, configuration, reservations, stays],
  );

  const noShow = useCallback(
    (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      const result = markReservationNoShow(
        reservation,
        stays,
        configuration,
        new Date(),
      );
      if (!result.state) {
        setMessage(result.error ?? "Reservation could not be marked No-show.");
        return false;
      }
      apply(
        reservationId,
        result.state.reservation,
        result.state.stays,
        result.state.configuration,
      );
      setMessage(`${reservationId} marked No-show.`);
      return true;
    },
    [apply, configuration, reservations, stays],
  );

  return { checkIn, checkOut, cancel, recordDeparture, noShow, message, setMessage };
}
