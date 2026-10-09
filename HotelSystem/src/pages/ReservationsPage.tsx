import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useReservationDemo } from "../app/useReservationDemo";
import { useReservationActions } from "../app/useReservationActions";
import { formatHotelDate, hotelDateKey } from "../lib/hotelTime";

type OperationalView =
  | "all"
  | "arrivals"
  | "checked-in"
  | "departures";

function formatDate(date: Date) {
  return formatHotelDate(date, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amount);
}

export function ReservationsPage() {
  const { reservations, guests, configuration } = useReservationDemo();
  const { checkIn, checkOut, noShow, message, setMessage } =
    useReservationActions();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<OperationalView>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [status, setStatus] = useState("");
  const today = hotelDateKey(new Date());

  const filteredReservations = useMemo(
    () =>
      reservations.filter((reservation) => {
        const guestName =
          guests.find((guest) => guest.id === reservation.guestId)?.name ?? "";
        const searchMatches = `${reservation.id} ${guestName}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
        const roomMatches =
          !roomNumber ||
          reservation.rooms.some((room) => room.roomNumber === roomNumber);
        const statusMatches = !status || reservation.status === status;
        const fromMatches =
          !dateFrom || hotelDateKey(reservation.checkOut) >= dateFrom;
        const toMatches =
          !dateTo || hotelDateKey(reservation.checkIn) <= dateTo;
        const viewMatches =
          view === "all" ||
          (view === "arrivals" &&
            reservation.status === "confirmed" &&
            hotelDateKey(reservation.checkIn) === today) ||
          (view === "checked-in" && reservation.status === "checked_in") ||
          (view === "departures" &&
            reservation.status === "checked_in" &&
            hotelDateKey(reservation.checkOut) === today);
        return (
          searchMatches &&
          roomMatches &&
          statusMatches &&
          fromMatches &&
          toMatches &&
          viewMatches
        );
      }),
    [
      dateFrom,
      dateTo,
      guests,
      query,
      reservations,
      roomNumber,
      status,
      today,
      view,
    ],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Operations
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Reservations</h1>
          <p className="mt-2 text-sm text-slate-600">
            Reservation records and saved charges are held in memory and reset when the demo reloads.
          </p>
        </div>
        <Link
          to="/"
          className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Open Calendar
        </Link>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="Operational saved views">
        {([
          ["all", "All reservations"],
          ["arrivals", "Today's Arrivals"],
          ["checked-in", "Currently Checked In"],
          ["departures", "Today's Departures"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={view === id}
            onClick={() => setView(id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              view === id
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 xl:grid-cols-5">
        <label className="text-sm font-medium text-slate-700">
          Search guest or reservation ID
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          From
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          To
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Room
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={roomNumber}
            onChange={(event) => setRoomNumber(event.target.value)}
          >
            <option value="">All rooms</option>
            {configuration.rooms.map((room) => (
              <option key={room.id} value={room.number}>
                Room {room.number}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">
          Reservation stage
          <select
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All stages</option>
            {["confirmed", "checked_in", "checked_out", "cancelled", "no_show"].map(
              (item) => (
                <option key={item} value={item}>
                  {item === "no_show" ? "No-show" : item.replace("_", " ")}
                </option>
              ),
            )}
          </select>
        </label>
      </section>

      {message && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {message}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setMessage("")}
          >
            Dismiss
          </button>
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[58rem] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Reservation ID</th>
              <th className="px-4 py-3">Guest</th>
              <th className="px-4 py-3">Room</th>
              <th className="px-4 py-3">Check-in</th>
              <th className="px-4 py-3">Check-out</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredReservations.map((reservation) => {
              const guest = guests.find(
                (item) => item.id === reservation.guestId,
              );
              const currency =
                reservation.rooms[0]?.capturedCurrency ?? configuration.currency;
              return (
                <tr key={reservation.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold">
                    <Link
                      to={`/reservations/${encodeURIComponent(reservation.id)}`}
                      className="text-blue-800 underline underline-offset-2"
                    >
                      {reservation.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{guest?.name ?? "Unknown guest"}</td>
                  <td className="px-4 py-3">
                    {reservation.rooms.map((room) => room.roomNumber).join(", ")}
                  </td>
                  <td className="px-4 py-3">{formatDate(reservation.checkIn)}</td>
                  <td className="px-4 py-3">
                    {formatDate(reservation.actualCheckOutAt ?? reservation.checkOut)}
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {reservation.status === "no_show"
                      ? "No-show"
                      : reservation.status.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(reservation.pricing.amountOwed, currency)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {(reservation.status === "confirmed" ||
                        reservation.status === "reserved") && (
                        <>
                          <button
                            type="button"
                            onClick={() => checkIn(reservation.id)}
                            className="font-semibold text-amber-800 underline"
                          >
                            Check in
                          </button>
                          <button
                            type="button"
                            onClick={() => noShow(reservation.id)}
                            className="font-semibold text-slate-700 underline"
                          >
                            No-show
                          </button>
                        </>
                      )}
                      {reservation.status === "checked_in" && (
                        <button
                          type="button"
                          onClick={() => checkOut(reservation.id)}
                          className="font-semibold text-blue-800 underline"
                        >
                          Check out
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredReservations.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  No reservations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Date filters and saved views use Asia/Manila. Payment status is not shown because no payment data exists.
      </p>
    </div>
  );
}
