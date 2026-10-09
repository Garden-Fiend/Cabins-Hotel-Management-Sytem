import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useReservationActions } from "../app/useReservationActions";
import { useReservationDemo } from "../app/useReservationDemo";
import { ReservationPane } from "../components/reservations/ReservationPane";
import { formatHotelDate } from "../lib/hotelTime";
import { getRoomAccommodationPrice } from "../lib/roomPricing";
import type { ReservationSnapshot } from "../types/reservation";
import { AppliedDiscountDescription } from "../components/reservations/AppliedDiscountDescription";
import { SavedLineAmounts } from "../components/reservations/SavedLineAmounts";

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amount);
}

function dateTime(value: Date | undefined) {
  return value
    ? formatHotelDate(value, { dateStyle: "medium", timeStyle: "short" })
    : "Not recorded";
}

export function ReservationDetailPage() {
  const { reservationId = "" } = useParams();
  const {
    reservations,
    setReservations,
    stays,
    setStays,
    guests,
    setGuests,
    configuration,
  } = useReservationDemo();
  const actions = useReservationActions();
  const [editing, setEditing] = useState(false);
  const [cancelChoice, setCancelChoice] = useState<"vacated" | "occupied" | null>(
    null,
  );
  const reservation = reservations.find((item) => item.id === reservationId);

  if (!reservation) {
    return (
      <div className={cardClass}>
        <h1 className="text-xl font-bold">Reservation not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This reservation may have been removed from the current in-memory session.
        </p>
        <Link className="mt-4 inline-block text-blue-800 underline" to="/reservations">
          Back to reservations
        </Link>
      </div>
    );
  }

  const guest = guests.find((item) => item.id === reservation.guestId);
  const currency =
    reservation.rooms[0]?.capturedCurrency ?? configuration.currency;
  const canCancel =
    reservation.status === "confirmed" ||
    reservation.status === "reserved" ||
    reservation.status === "checked_in";
  const sourceOption = configuration.bookingSources.find(
    (item) => item.id === reservation.bookingSourceId,
  );
  const isInactiveCatalogItem = (catalogId?: string) =>
    Boolean(
      catalogId &&
        !configuration.catalogItems.some(
          (item) =>
            item.id === catalogId && item.enabled && !item.archived,
        ),
    );

  function saveReservation(
    nextReservation: ReservationSnapshot,
    nextStays: typeof stays,
  ) {
    setReservations((current) =>
      current.some((item) => item.id === nextReservation.id)
        ? current.map((item) =>
            item.id === nextReservation.id ? nextReservation : item,
          )
        : [...current, nextReservation],
    );
    setStays((current) => [
      ...current.filter((stay) => stay.reservationId !== nextReservation.id),
      ...nextStays,
    ]);
    setEditing(false);
  }

  function cancel(guestHasVacated: boolean) {
    actions.cancel(reservationId, guestHasVacated);
    setCancelChoice(null);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/reservations" className="text-sm text-blue-800 underline">
            ← All reservations
          </Link>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Reservation details
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {reservation.id}
          </h1>
          <p className="mt-2 capitalize text-sm text-slate-600">
            Status: {reservation.status === "no_show" ? "No-show" : reservation.status.replace("_", " ")}
            {" · "}
            {guest?.name ?? "Unknown guest"}
            {" · "}
            {reservation.bookingSourceLabel}
            {sourceOption && !sourceOption.enabled
              ? " (inactive historical item)"
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {reservation.status === "confirmed" ||
          reservation.status === "reserved" ? (
            <>
              <button
                type="button"
                onClick={() => actions.checkIn(reservation.id)}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Check in
              </button>
              <button
                type="button"
                onClick={() => actions.noShow(reservation.id)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                Mark No-show
              </button>
            </>
          ) : null}
          {reservation.status === "checked_in" && (
            <button
              type="button"
              onClick={() => actions.checkOut(reservation.id)}
              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white"
            >
              Check out
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelChoice("vacated")}
              className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800"
            >
              Cancel reservation
            </button>
          )}
          {reservation.occupancyLockRoomNumbers?.length ? (
            <button
              type="button"
              onClick={() => actions.recordDeparture(reservation.id)}
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
                onClick={() => setEditing(true)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                Edit details
              </button>
            )}
          <Link
            to={`/reservations/${encodeURIComponent(reservation.id)}/print?layout=document`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Print document
          </Link>
          <Link
            to={`/reservations/${encodeURIComponent(reservation.id)}/print?layout=thermal`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Print thermal
          </Link>
        </div>
      </header>

      {actions.message && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {actions.message}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => actions.setMessage("")}
          >
            Dismiss
          </button>
        </p>
      )}

      {reservation.occupancyLockRoomNumbers?.length ? (
        <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Guest occupancy remains locked for room(s){" "}
          {reservation.occupancyLockRoomNumbers.join(", ")}. Record departure before releasing availability.
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Guest and stay</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-slate-500">Guest</dt>
            <dd>{guest?.name ?? "Unknown guest"}</dd>
            <dt className="text-slate-500">Phone</dt>
            <dd>{guest?.phone || "Not provided"}</dd>
            <dt className="text-slate-500">Email</dt>
            <dd>{guest?.email || "Not provided"}</dd>
            <dt className="text-slate-500">Booking source</dt>
            <dd>{reservation.bookingSourceLabel}</dd>
            <dt className="text-slate-500">Scheduled check-in</dt>
            <dd>{dateTime(reservation.checkIn)}</dd>
            <dt className="text-slate-500">Scheduled check-out</dt>
            <dd>{dateTime(reservation.checkOut)}</dd>
            <dt className="text-slate-500">Actual check-in</dt>
            <dd>{dateTime(reservation.actualCheckInAt)}</dd>
            <dt className="text-slate-500">Actual check-out</dt>
            <dd>{dateTime(reservation.actualCheckOutAt)}</dd>
            <dt className="text-slate-500">Reservation note</dt>
            <dd className="whitespace-pre-wrap">{reservation.note || "None"}</dd>
          </dl>
        </section>

        <section className={cardClass}>
          <h2 className="text-lg font-semibold">Saved price summary</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {reservation.pricing.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-4">
                <span>
                  Original: {line.label}
                  {line.roomNumber ? ` · Room ${line.roomNumber}` : ""}
                  {line.quantity && line.quantity > 1
                    ? ` × ${line.quantity}`
                    : ""}
                  {line.taxDetails ? ` · ${line.taxDetails}` : ""}
                </span>
                <SavedLineAmounts line={line} currency={currency} />
              </li>
            ))}
            <li className="flex justify-between border-t border-slate-200 pt-2">
              <span>Original subtotal</span>
              <span>{money(reservation.pricing.subtotal, currency)}</span>
            </li>
            {reservation.pricing.discounts.map((discount) => (
              <li key={discount.id} className="flex justify-between">
                <AppliedDiscountDescription discount={discount} currency={currency} />
                <span>−{money(discount.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between"><span>Total discounts</span><span>{money(reservation.pricing.discountTotal, currency)}</span></li>
            {reservation.adjustments.map((adjustment) => (
              <li key={adjustment.id} className="flex justify-between">
                <span>Adjustment · {adjustment.reason}</span>
                <span>{money(adjustment.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-slate-200 pt-2 font-bold">
              <span>Amount owed (no payment data recorded)</span>
              <span>{money(reservation.pricing.amountOwed, currency)}</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            These amounts are saved reservation snapshots; they are not recalculated from current catalog or rate settings.
          </p>
        </section>
      </div>

      <section className={cardClass}>
        <h2 className="text-lg font-semibold">Assigned rooms and saved inclusions</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {reservation.rooms.map((room) => (
            <article key={room.roomNumber} className="rounded-xl border border-slate-200 p-4">
              <h3 className="font-semibold">
                Room {room.roomNumber} · {room.roomType}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Housekeeping readiness:{" "}
                {configuration.rooms.find(
                  (item) => item.number === room.roomNumber,
                )?.housekeepingState ?? "unknown"}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {dateTime(room.checkIn)} – {dateTime(room.checkOut)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {room.adults} adult(s), {room.children} child(ren)
              </p>
              {(() => {
                const currentRate = getRoomAccommodationPrice(
                  configuration,
                  room.roomTypeId,
                  room.durationId,
                );
                return (
                  <p className="mt-1 text-sm text-slate-600">
                    Saved rate: {money(room.capturedRoomPrice, room.capturedCurrency)}
                    {currentRate
                      ? ` · ${money(currentRate.amount, currentRate.currency)} current`
                      : ""}
                  </p>
                );
              })()}
              <p className="mt-3 text-sm font-medium">Inclusions and charges</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-600">
                {room.inclusions.map((inclusion) => (
                  <li key={inclusion.catalogId}>
                    {inclusion.label} × {inclusion.quantity} (included)
                    {!configuration.catalogItems.some(
                      (item) =>
                        item.id === inclusion.catalogId &&
                        item.enabled &&
                        !item.archived,
                    )
                      ? " · inactive historical item"
                      : ""}
                  </li>
                ))}
                {room.charges.map((charge) => (
                  <li key={charge.id}>
                    {charge.label} × {charge.quantity} ·{" "}
                    {money(charge.quantity * charge.unitPrice, room.capturedCurrency)}
                    {charge.taxDetails ? ` · ${charge.taxDetails}` : ""}
                    {!configuration.catalogItems.some(
                      (item) =>
                        item.id === charge.catalogId &&
                        item.enabled &&
                        !item.archived,
                    )
                      ? " · inactive historical item"
                      : ""}
                  </li>
                ))}
                {!room.inclusions.length && !room.charges.length && (
                  <li>No saved inclusions or extra charges.</li>
                )}
              </ul>
              <p className="mt-3 text-sm font-medium">Breakfast</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-600">
                {room.breakfast.map((breakfast, index) => (
                  <li key={`${breakfast.stayDate}-${breakfast.guestNumber}-${index}`}>
                    {breakfast.stayDate} · Guest {breakfast.guestNumber}:{" "}
                    {breakfast.status === "skipped"
                      ? "Skipped"
                      : `${breakfast.mealLabel ?? "Meal"} + ${breakfast.beverageLabel ?? "Beverage"} (included)`}
                    {breakfast.status === "included" &&
                    (isInactiveCatalogItem(breakfast.mealId) ||
                      isInactiveCatalogItem(breakfast.beverageId))
                      ? " · inactive historical item"
                      : ""}
                  </li>
                ))}
                {!room.breakfast.length && <li>No breakfast selection saved.</li>}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-semibold">Audit history</h2>
        <ol className="mt-4 space-y-3 text-sm text-slate-600">
          {reservation.audit.map((event, index) => (
            <li key={`${event.occurredAt.getTime()}-${index}`}>
              <span className="font-medium text-slate-900">{event.action}</span>
              {" · "}
              {dateTime(event.occurredAt)}
              {" · "}
              {event.actor}
              {(event.before || event.after) && (
                <span className="block text-xs text-slate-500">
                  {event.before ? `Before: ${event.before} ` : ""}
                  {event.after ? `After: ${event.after}` : ""}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {cancelChoice && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cancel-confirm-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
          >
            <h2 id="cancel-confirm-title" className="text-lg font-bold">
              Cancel reservation?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {reservation.status === "checked_in"
                ? "Has the guest vacated all assigned rooms?"
                : "Cancel this confirmed reservation?"}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelChoice(null)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
              >
                Keep reservation
              </button>
              {reservation.status === "checked_in" ? (
                <>
                  <button
                    type="button"
                    onClick={() => cancel(false)}
                    className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-semibold text-rose-800"
                  >
                    No, retain occupancy lock
                  </button>
                  <button
                    type="button"
                    onClick={() => cancel(true)}
                    className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
                  >
                    Yes, guest vacated
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => cancel(true)}
                  className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
                >
                  Confirm cancellation
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40">
          <ReservationPane
            stays={stays}
            guests={guests}
            initialCheckIn={reservation.checkIn}
            initialReservation={reservation}
            onClose={() => setEditing(false)}
            onCreated={saveReservation}
            onSaved={saveReservation}
            onCancelReservation={(id, vacated) => {
              actions.cancel(id, vacated);
              setEditing(false);
            }}
            onGuestCreated={(createdGuest) =>
              setGuests((current) =>
                current.some((item) => item.id === createdGuest.id)
                  ? current
                  : [
                      ...current,
                      { ...createdGuest, stayCount: 0, segment: "New" as const },
                    ],
              )
            }
          />
        </div>
      )}
    </div>
  );
}
