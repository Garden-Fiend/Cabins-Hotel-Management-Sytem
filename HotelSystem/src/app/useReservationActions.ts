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
    mode,
    commands,
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
    async (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      if (mode === "api") {
        if (!commands?.lifecycle) { setMessage("This lifecycle command is not supported by the connected API."); return false; }
        try {
          await commands.lifecycle(reservation, "check-in");
          setMessage("Lifecycle change committed to PostgreSQL.");
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Lifecycle failed; no success confirmed.");
          return false;
        }
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
    [apply, configuration, reservations, stays, mode, commands],
  );

  const checkOut = useCallback(
    async (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      if (mode === "api") {
        if (!commands?.lifecycle) { setMessage("This lifecycle command is not supported by the connected API."); return false; }
        try {
          await commands.lifecycle(reservation, "check-out");
          setMessage("Lifecycle change committed to PostgreSQL.");
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Lifecycle failed; no success confirmed.");
          return false;
        }
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
    [apply, configuration, reservations, stays, mode, commands],
  );

  const cancel = useCallback(
    async (reservationId: string, guestHasVacated: boolean) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      if (mode === "api") {
        if (!commands?.lifecycle) { setMessage("This lifecycle command is not supported by the connected API."); return false; }
        try {
          await commands.lifecycle(reservation, "cancel", guestHasVacated);
          setMessage("Lifecycle change committed to PostgreSQL.");
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Lifecycle failed; no success confirmed.");
          return false;
        }
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
    [apply, configuration, reservations, stays, mode, commands],
  );

  const recordDeparture = useCallback(
    async (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      if (mode === "api") {
        if (!commands?.lifecycle) { setMessage("This lifecycle command is not supported by the connected API."); return false; }
        try {
          await commands.lifecycle(reservation, "record-departure");
          setMessage("Lifecycle change committed to PostgreSQL.");
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Lifecycle failed; no success confirmed.");
          return false;
        }
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
    [apply, configuration, reservations, stays, mode, commands],
  );

  const noShow = useCallback(
    async (reservationId: string) => {
      const reservation = reservations.find((item) => item.id === reservationId);
      if (!reservation) {
        setMessage(`Reservation ${reservationId} was not found.`);
        return false;
      }
      if (mode === "api") {
        if (!commands?.lifecycle) { setMessage("This lifecycle command is not supported by the connected API."); return false; }
        try {
          await commands.lifecycle(reservation, "no-show");
          setMessage("Lifecycle change committed to PostgreSQL.");
          return true;
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Lifecycle failed; no success confirmed.");
          return false;
        }
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
    [apply, configuration, reservations, stays, mode, commands],
  );

  return { checkIn, checkOut, cancel, recordDeparture, noShow, message, setMessage };
}
