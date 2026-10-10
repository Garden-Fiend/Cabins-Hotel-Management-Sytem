import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AvailabilityCalendar } from "../components/AvailabilityCalendar";
import { CalendarToolbar } from "../components/CalendarToolbar";
import { ReservationPane } from "../components/reservations/ReservationPane";
import { useReservationDemo } from "../app/useReservationDemo";
import { useReservationActions } from "../app/useReservationActions";
import { addDays, addMonths, type CalendarView } from "../lib/calendar";
import {
  createHotelDateTime,
  formatHotelDate,
  getHotelDateParts,
  hotelDateAtTime,
} from "../lib/hotelTime";
import type { Stay } from "../types/booking";
import type {
  CalendarReservationContext,
  ReservationSnapshot,
} from "../types/reservation";

export function DashboardPage() {
  const {
    reservations,
    setReservations,
    stays,
    setStays,
    guests,
    setGuests,
    configuration,
  } = useReservationDemo();
  const lifecycle = useReservationActions();
  const navigate = useNavigate();
  const calendarRooms = configuration.rooms
    .filter(
      (room) =>
        room.enabled ||
        stays.some(
          (stay) =>
            stay.room === room.number &&
            (stay.status !== "cancelled" || stay.occupancyLocked),
        ),
    )
    .map((room) => room.number);
  const [view, setView] = useState<CalendarView>("month");
  const [anchorDate, setAnchorDate] = useState(new Date());
  const [selectedStay, setSelectedStay] = useState<Stay | null>(null);
  const [reservationPaneOpen, setReservationPaneOpen] = useState(false);
  const [reservationCheckIn, setReservationCheckIn] = useState(new Date());
  const [initialRoom, setInitialRoom] = useState<string | undefined>();
  const [editingReservation, setEditingReservation] =
    useState<ReservationSnapshot | null>(null);
  const [draftContexts, setDraftContexts] =
    useState<CalendarReservationContext[]>([]);
  const [reservationNotice, setReservationNotice] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [pendingCalendarCancellation, setPendingCalendarCancellation] =
    useState<string | null>(null);
  const dashboardContentRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [reservationPaneHeight, setReservationPaneHeight] =
    useState<number | null>(null);

  useLayoutEffect(() => {
    if (!reservationPaneOpen) return;

    const updatePaneHeight = () => {
      const contentTop = dashboardContentRef.current?.getBoundingClientRect().top;
      const calendarBottom = calendarRef.current?.getBoundingClientRect().bottom;
      if (contentTop === undefined || calendarBottom === undefined) return;
      setReservationPaneHeight(Math.max(0, calendarBottom - contentTop));
    };

    updatePaneHeight();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePaneHeight);
    if (dashboardContentRef.current) {
      resizeObserver?.observe(dashboardContentRef.current);
    }
    if (calendarRef.current) {
      resizeObserver?.observe(calendarRef.current);
    }
    window.addEventListener("resize", updatePaneHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePaneHeight);
    };
  }, [
    anchorDate,
    calendarRooms.length,
    reservationPaneOpen,
    reservationNotice,
    view,
  ]);

  function goPrevious() {
    setAnchorDate((current) => {
      const next = new Date(current);

      switch (view) {
        case "day":
          return addDays(next, -1);

        case "week":
          return addDays(next, -7);

        case "month":
          return addMonths(next, -1);

        case "year":
          return createHotelDateTime(getHotelDateParts(next).year - 1, 1, 1);
      }
    });
  }

  function goNext() {
    setAnchorDate((current) => {
      const next = new Date(current);

      switch (view) {
        case "day":
          return addDays(next, 1);

        case "week":
          return addDays(next, 7);

        case "month":
          return addMonths(next, 1);

        case "year":
          return createHotelDateTime(getHotelDateParts(next).year + 1, 1, 1);
      }
    });
  }

  function goToday() {
    setAnchorDate(new Date());
  }

  function openReservationPane() {
    setSelectedStay(null);
    setReservationCheckIn(
      hotelDateAtTime(new Date(), configuration.defaultCheckInTime),
    );
    setInitialRoom(undefined);
    setEditingReservation(null);
    setDraftContexts([]);
    setReservationNotice("");
    setReservationPaneOpen(true);
  }

  function openFromCalendar(roomId: string, start: Date) {
    const room = configuration.rooms.find((item) => item.number === roomId);
    const roomType = configuration.roomTypes.find(
      (item) => item.id === room?.roomTypeId,
    );
    const operationalStatus = configuration.roomStatuses.find(
      (status) => status.id === room?.roomStatusId,
    );
    if (
      !room?.enabled ||
      room.archived ||
      !roomType?.enabled ||
      roomType.archived ||
      !operationalStatus?.enabled ||
      operationalStatus.blocksReservation
    ) {
      setReservationNotice(
        `Room ${roomId} is unavailable (${operationalStatus?.label ?? "disabled"}) and cannot be reserved.`,
      );
      return;
    }
    setReservationCheckIn(start);
    setInitialRoom(roomId);
    setEditingReservation(null);
    setDraftContexts([]);
    setReservationNotice("");
    setReservationPaneOpen(true);
  }

  const syncDraftContexts = useCallback(
    (nextContexts: { roomId: string; start: Date; end: Date }[]) => {
      setDraftContexts((current) => {
        const nextSignature = nextContexts
          .map(
            (context) =>
              `${context.roomId}:${context.start.getTime()}:${context.end.getTime()}`,
          )
          .join("|");
        const currentSignature = current
          .map(
            (context) =>
              `${context.roomId}:${context.start.getTime()}:${context.end.getTime()}`,
          )
          .join("|");
        return currentSignature === nextSignature ? current : nextContexts;
      });
    },
    [],
  );

  function openForEdit(reservation: ReservationSnapshot) {
    setEditingReservation(reservation);
    setReservationCheckIn(reservation.checkIn);
    setInitialRoom(undefined);
    setDraftContexts(
      reservation.rooms.map((room) => ({
        roomId: room.roomNumber,
        start: room.checkIn,
        end: room.checkOut,
        reservationId: reservation.id,
      })),
    );
    setReservationNotice("");
    setReservationPaneOpen(true);
  }

  function closeReservationPane() {
    setReservationPaneOpen(false);
    setEditingReservation(null);
    setInitialRoom(undefined);
    setDraftContexts([]);
  }

  function handleReservationCreated(
    reservation: ReservationSnapshot,
    createdStays: Stay[],
  ) {
    setStays((current) => [...current, ...createdStays]);
    setReservations((current) => [...current, reservation]);
    closeReservationPane();
    setReservationNotice(
      `Reservation ${reservation.id} created in this session. Captured pricing and room settings are held in page memory; this demo does not persist bookings to a server.`,
    );
  }

  function handleReservationSaved(
    reservation: ReservationSnapshot,
    updatedStays: Stay[],
  ) {
    setReservations((current) =>
      current.map((item) => (item.id === reservation.id ? reservation : item)),
    );
    setStays((current) => [
      ...current.filter((stay) => stay.reservationId !== reservation.id),
      ...updatedStays,
    ]);
    closeReservationPane();
    setReservationNotice(
      `${reservation.id} updated in this session. Changes are not persisted to a server.`,
    );
  }

  function handleReservationCancelled(
    reservationId: string,
    guestHasVacated: boolean,
  ) {
    lifecycle.cancel(reservationId, guestHasVacated);
    closeReservationPane();
    setReservationNotice(
      `${reservationId} cancelled. ${guestHasVacated ? "Assigned rooms are Dirty and available." : "Room occupancy remains locked until guest departure is recorded."}`,
    );
  }

  function handleStayClick(stay: Stay) {
    setReservationPaneOpen(false);
    setEditingReservation(null);
    setDraftContexts([]);
    setSelectedStay(stay);
  }

  const calendarStays = stays
    .filter(
      (stay) =>
        showInactive ||
        (stay.status !== "cancelled" &&
          stay.status !== "checked_out" &&
          stay.status !== "no_show") ||
        stay.occupancyLocked,
    )
    .map((stay) => {
      const room = configuration.rooms.find((item) => item.number === stay.room);
      const roomStatus = configuration.roomStatuses.find(
        (item) => item.id === room?.roomStatusId,
      );
      return {
        ...stay,
        housekeepingState: room?.housekeepingState,
        roomOperational: Boolean(roomStatus?.enabled && !roomStatus.blocksReservation),
      };
    });

  const currentDraftContexts = draftContexts.map((context) => ({
    ...context,
    reservationId: editingReservation?.id,
  }));
  const displayedStay = selectedStay
    ? stays.find((stay) => stay.id === selectedStay.id) ?? selectedStay
    : null;

  return (
    <div
      ref={dashboardContentRef}
      className={
        reservationPaneOpen
          ? "min-w-0 space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(25rem,32rem)] lg:items-start lg:gap-4 lg:space-y-0"
          : "space-y-6"
      }
    >
      <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Overview
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Dashboard
          </h1>
        </div>
        <button
          type="button"
          onClick={openReservationPane}
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          + Create Reservation
        </button>
      </div>

      {reservationNotice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
            reservationNotice.startsWith("Room ")
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
          role="status"
        >
          <span>{reservationNotice}</span>
          <button
            type="button"
            onClick={() => setReservationNotice("")}
            aria-label="Dismiss reservation confirmation"
            className="font-semibold underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <CalendarToolbar
          view={view}
          anchorDate={anchorDate}
          onViewChange={setView}
          onPrevious={goPrevious}
          onNext={goNext}
          onToday={goToday}
          rightContent={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <div
                className="flex flex-wrap gap-x-3 gap-y-1"
                aria-label="Calendar occupancy legend"
              >
                <span className="font-semibold text-slate-700">
                  Occupancy:
                </span>
                <span className="text-slate-600">● Vacant</span>
                <span className="text-blue-800">● Reserved</span>
                <span className="text-emerald-800">● Occupied</span>
                <span className="text-rose-800">● Overdue</span>

              </div>
              <label className="flex items-center gap-2 font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(event) => setShowInactive(event.target.checked)}
                />
                Show inactive reservations
              </label>
            </div>
          }
        />
      </div>

      <div className="min-w-0">
        <div
          ref={calendarRef}
          className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <AvailabilityCalendar
            rooms={calendarRooms}
            stays={calendarStays}
            view={view}
            anchorDate={anchorDate}
            onStayClick={handleStayClick}
            onRoomTimeSelect={openFromCalendar}
            draftContexts={currentDraftContexts}
            onDraftContextClick={(reservationId) => {
              const reservation = reservations.find(
                (item) => item.id === reservationId,
              );
              if (reservation) {
                navigate(`/reservations/${encodeURIComponent(reservation.id)}`);
              }
            }}
          />
        </div>

        {!reservationPaneOpen && displayedStay && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/40 p-4"
            onClick={() => setSelectedStay(null)}
          >
            {(() => {
              const reservation = reservations.find(
                (item) => item.id === displayedStay.reservationId,
              );
              const guest = reservation
                ? guests.find((item) => item.id === reservation.guestId)
                : undefined;
              const room = configuration.rooms.find(
                (item) => item.number === displayedStay.room,
              );
              const assignedRooms =
                reservation?.rooms.map((assignedRoom) => {
                  const assignedConfiguration = configuration.rooms.find(
                    (item) => item.number === assignedRoom.roomNumber,
                  );
                  return {
                    ...assignedRoom,
                    housekeepingState:
                      assignedConfiguration?.housekeepingState ?? "unknown",
                  };
                }) ?? [];
              const roomNotReady =
                reservation?.status === "confirmed" &&
                reservation.checkIn > new Date() &&
                assignedRooms.some(
                  (assignedRoom) =>
                    assignedRoom.housekeepingState === "dirty" ||
                    assignedRoom.housekeepingState === "cleaning",
                );
              return (
                <section
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="reservation-summary-title"
                  className="max-h-[min(90vh,48rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Reservation summary
                      </p>
                      <h2
                        id="reservation-summary-title"
                        className="mt-1 text-lg font-bold"
                      >
                        {guest?.name ?? displayedStay.guest}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedStay(null)}
                      aria-label="Close reservation summary"
                      className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
                    >
                      ×
                    </button>
                  </div>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-500">Reservation</dt>
                      <dd>{reservation?.id ?? "Local stay"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Assigned room(s)</dt>
                      <dd>
                        {assignedRooms.length
                          ? assignedRooms
                              .map(
                                (assignedRoom) =>
                                  `${assignedRoom.roomNumber} · ${assignedRoom.housekeepingState}`,
                              )
                              .join(", ")
                          : `${displayedStay.room} · ${room?.housekeepingState ?? "unknown"}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Check-in</dt>
                      <dd>{formatHotelDate(reservation?.checkIn ?? displayedStay.checkIn, { dateStyle: "medium", timeStyle: "short" })}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Check-out</dt>
                      <dd>{formatHotelDate(reservation?.checkOut ?? displayedStay.checkOut, { dateStyle: "medium", timeStyle: "short" })}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Stage</dt>
                      <dd className="capitalize">{displayedStay.occupancyLocked ? "cancelled · occupancy locked" : (reservation?.status ?? displayedStay.status).replace("_", " ")}</dd>
                    </div>
                  </dl>
                  {roomNotReady && (
                    <p
                      role="alert"
                      className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900"
                    >
                      Room Not Ready — confirmed reservation has a Dirty or
                      Cleaning assigned room.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {reservation && (
                      <>
                        {(reservation.status === "confirmed" || reservation.status === "reserved") && (
                          <button
                            type="button"
                            onClick={() => lifecycle.checkIn(reservation.id)}
                            className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Check in
                          </button>
                        )}
                        {reservation.status === "checked_in" && (
                          <button
                            type="button"
                            onClick={() => lifecycle.checkOut(reservation.id)}
                            className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Check out
                          </button>
                        )}
                        {(reservation.status === "confirmed" ||
                          reservation.status === "reserved" ||
                          reservation.status === "checked_in") && (
                          <button
                            type="button"
                            onClick={() =>
                              setPendingCalendarCancellation(reservation.id)
                            }
                            className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800"
                          >
                            Cancel
                          </button>
                        )}
                        {(reservation.status === "confirmed" ||
                          reservation.status === "reserved") && (
                          <button
                            type="button"
                            onClick={() => lifecycle.noShow(reservation.id)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                          >
                            No-show
                          </button>
                        )}
                        {reservation.occupancyLockRoomNumbers?.length ? (
                          <button
                            type="button"
                            onClick={() => lifecycle.recordDeparture(reservation.id)}
                            className="rounded-lg bg-rose-800 px-3 py-2 text-sm font-semibold text-white"
                          >
                            Record Guest Departure
                          </button>
                        ) : null}
                        {reservation.status !== "cancelled" &&
                          reservation.status !== "checked_out" &&
                          reservation.status !== "no_show" && (
                            <button
                              type="button"
                              onClick={() => openForEdit(reservation)}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                            >
                              Edit
                            </button>
                          )}
                        <Link
                          to={`/reservations/${encodeURIComponent(reservation.id)}`}
                          title="View Full Details"
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                        >
                          Expand
                        </Link>
                      </>
                    )}
                  </div>
                  {lifecycle.message && (
                    <p aria-live="polite" className="mt-3 text-sm text-slate-600">
                      {lifecycle.message}
                    </p>
                  )}
                </section>
              );
            })()}
          </div>
        )}

        {pendingCalendarCancellation && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
            <section
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="calendar-cancel-title"
              className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            >
              <h2 id="calendar-cancel-title" className="text-lg font-bold">
                Cancel reservation?
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {reservations.find((item) => item.id === pendingCalendarCancellation)
                  ?.status === "checked_in"
                  ? "Has the guest vacated all assigned rooms?"
                  : "The reservation will remain in history and release its assigned rooms."}
              </p>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingCalendarCancellation(null)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
                >
                  Keep reservation
                </button>
                {reservations.find((item) => item.id === pendingCalendarCancellation)
                  ?.status === "checked_in" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        lifecycle.cancel(pendingCalendarCancellation, false);
                        setPendingCalendarCancellation(null);
                      }}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800"
                    >
                      No, retain occupancy lock
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        lifecycle.cancel(pendingCalendarCancellation, true);
                        setPendingCalendarCancellation(null);
                      }}
                      className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Yes, guest vacated
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      lifecycle.cancel(pendingCalendarCancellation, true);
                      setPendingCalendarCancellation(null);
                    }}
                    className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Confirm cancellation
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      </div>
      {reservationPaneOpen && (
        <div
          className="contents lg:block lg:min-h-0"
          style={{
            height:
              reservationPaneHeight === null
                ? undefined
                : `${reservationPaneHeight}px`,
          }}
        >
          <ReservationPane
            key={editingReservation?.id ?? `create-${reservationCheckIn.getTime()}`}
            stays={stays}
            guests={guests}
            initialCheckIn={reservationCheckIn}
            initialRoom={initialRoom}
            initialReservation={editingReservation ?? undefined}
            onClose={closeReservationPane}
            onCreated={handleReservationCreated}
            onSaved={handleReservationSaved}
            onCancelReservation={handleReservationCancelled}
            onGuestCreated={(guest) =>
              setGuests((current) =>
                current.some((item) => item.id === guest.id)
                  ? current
                  : [
                      ...current,
                      { ...guest, stayCount: 0, segment: "New" as const },
                    ],
              )
            }
            onDraftContextChange={syncDraftContexts}
          />
        </div>
      )}
    </div>
  );
}
