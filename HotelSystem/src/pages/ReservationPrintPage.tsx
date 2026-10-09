import { Link, useParams, useSearchParams } from "react-router-dom";

import { useReservationDemo } from "../app/useReservationDemo";
import { formatHotelDate } from "../lib/hotelTime";
import { AppliedDiscountDescription } from "../components/reservations/AppliedDiscountDescription";
import { SavedLineAmounts } from "../components/reservations/SavedLineAmounts";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
  }).format(amount);
}

function dateTime(value: Date) {
  return formatHotelDate(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ReservationPrintPage() {
  const { reservationId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const layout = searchParams.get("layout") === "thermal" ? "thermal" : "document";
  const { reservations, guests, configuration } = useReservationDemo();
  const reservation = reservations.find((item) => item.id === reservationId);

  if (!reservation) {
    return (
      <main className="p-8">
        <p>Reservation not found in the current in-memory session.</p>
        <Link to="/reservations" className="text-blue-800 underline">
          Back to reservations
        </Link>
      </main>
    );
  }

  const guest = guests.find((item) => item.id === reservation.guestId);
  const currency =
    reservation.rooms[0]?.capturedCurrency ?? configuration.currency;
  const thermal = layout === "thermal";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 print:min-h-0 print:bg-white print:p-0">
      <style>{`
        @media print {
          @page { margin: ${thermal ? "4mm" : "14mm"}; }
          body { background: white !important; }
          body * { visibility: hidden !important; }
          [data-reservation-print-document],
          [data-reservation-print-document] * {
            visibility: visible !important;
          }
          [data-reservation-print-document] {
            position: fixed !important;
            inset: 0 auto auto 0 !important;
            width: ${thermal ? "72mm" : "100%"} !important;
            max-width: none !important;
            margin: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
      <div className="print:hidden mx-auto mb-4 flex max-w-4xl flex-wrap items-center gap-2">
        <Link
          to={`/reservations/${encodeURIComponent(reservation.id)}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
        >
          Back to details
        </Link>
        <button
          type="button"
          onClick={() =>
            setSearchParams({ layout: thermal ? "document" : "thermal" })
          }
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
        >
          Use {thermal ? "document" : "thermal"} layout
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Print
        </button>
      </div>
      <article
        data-reservation-print-document
        className={`mx-auto bg-white text-slate-900 ${
          thermal
            ? "w-full max-w-[80mm] p-3 text-xs print:w-[72mm] print:max-w-none print:p-0"
            : "max-w-4xl rounded-xl border border-slate-200 p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0"
        }`}
      >
        <header className="border-b border-slate-300 pb-4">
          <h1 className={thermal ? "text-lg font-bold" : "text-2xl font-bold"}>
            Reservation record
          </h1>
          <p className="mt-1 font-semibold">{reservation.id}</p>
          <p className="mt-1 capitalize">{reservation.status.replace("_", " ")}</p>
        </header>
        <section className={`grid gap-2 border-b border-slate-300 py-4 ${thermal ? "grid-cols-1" : "grid-cols-2"}`}>
          <p><strong>Guest:</strong> {guest?.name ?? "Unknown guest"}</p>
          <p><strong>Phone:</strong> {guest?.phone || "Not provided"}</p>
          <p><strong>Email:</strong> {guest?.email || "Not provided"}</p>
          <p><strong>Source:</strong> {reservation.bookingSourceLabel}</p>
          <p><strong>Check-in:</strong> {dateTime(reservation.checkIn)}</p>
          <p><strong>Check-out:</strong> {dateTime(reservation.checkOut)}</p>
          {reservation.actualCheckInAt && (
            <p><strong>Actual check-in:</strong> {dateTime(reservation.actualCheckInAt)}</p>
          )}
          {reservation.actualCheckOutAt && (
            <p><strong>Actual check-out:</strong> {dateTime(reservation.actualCheckOutAt)}</p>
          )}
        </section>
        <section className="border-b border-slate-300 py-4">
          <h2 className="font-bold">Rooms, inclusions, and breakfast</h2>
          {reservation.rooms.map((room) => (
            <div key={room.roomNumber} className="mt-3 break-inside-avoid">
              <p className="font-semibold">
                Room {room.roomNumber} · {room.roomType}
              </p>
              <p>{dateTime(room.checkIn)} – {dateTime(room.checkOut)}</p>
              <p>
                {room.adults} adult(s), {room.children} child(ren) ·{" "}
                {money(room.capturedRoomPrice, room.capturedCurrency)}
              </p>
              {room.inclusions.map((item) => (
                <p key={item.catalogId}>
                  Included: {item.label} × {item.quantity}
                </p>
              ))}
              {room.charges.map((item) => (
                <p key={item.id}>
                  Charge: {item.label} × {item.quantity} ·{" "}
                  {money(item.quantity * item.unitPrice, room.capturedCurrency)}
                </p>
              ))}
              {room.breakfast.map((item, index) => (
                <p key={`${item.stayDate}-${item.guestNumber}-${index}`}>
                  Breakfast {item.stayDate}, Guest {item.guestNumber}:{" "}
                  {item.status === "skipped"
                    ? "Skipped"
                    : `${item.mealLabel ?? "Meal"} + ${item.beverageLabel ?? "Beverage"} (included)`}
                </p>
              ))}
            </div>
          ))}
        </section>
        <section className="py-4">
          <h2 className="font-bold">Saved charges</h2>
          <ul className="mt-2 space-y-1">
            {reservation.pricing.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-2">
                <span>
                  Original: {line.label}
                  {line.roomNumber ? ` · Room ${line.roomNumber}` : ""}
                  {line.taxDetails ? ` (${line.taxDetails})` : ""}
                </span>
                <SavedLineAmounts line={line} currency={currency} />
              </li>
            ))}
            <li className="flex justify-between border-t border-slate-300 pt-2">
              <span>Original subtotal</span>
              <span>{money(reservation.pricing.subtotal, currency)}</span>
            </li>
            {reservation.pricing.discounts.map((discount) => (
              <li key={discount.id} className="flex justify-between gap-2">
                <AppliedDiscountDescription discount={discount} currency={currency} />
                <span>−{money(discount.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between"><span>Total discounts</span><span>{money(reservation.pricing.discountTotal, currency)}</span></li>
            {reservation.adjustments.map((adjustment) => (
              <li key={adjustment.id} className="flex justify-between gap-2">
                <span>Adjustment · {adjustment.reason}</span>
                <span>{money(adjustment.amount, currency)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-slate-300 pt-2 font-bold">
              <span>Amount owed</span>
              <span>{money(reservation.pricing.amountOwed, currency)}</span>
            </li>
          </ul>
          <p className="mt-4 text-[0.7rem]">
            Amounts reflect the saved reservation snapshot. No payment record is available.
          </p>
        </section>
        {reservation.note && (
          <section className="border-t border-slate-300 py-4">
            <h2 className="font-bold">Reservation note</h2>
            <p className="mt-1 whitespace-pre-wrap">{reservation.note}</p>
          </section>
        )}
      </article>
    </main>
  );
}
