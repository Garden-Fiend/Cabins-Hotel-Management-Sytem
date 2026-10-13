import { useReservationDemo } from "../app/useReservationDemo";

export function GuestsPage() {
  const { guests, reservations } = useReservationDemo();
  const guestsWithActivity = guests.map((guest) => ({
    ...guest,
    reservationCount: reservations.filter(
      (reservation) => reservation.guestId === guest.id,
    ).length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Guest CRM
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">
          Guests
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guestsWithActivity.map((guest) => (
          <div
            key={guest.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-semibold text-slate-900">{guest.name}</p>
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
                {guest.segment}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-600">
                {Math.max(guest.stayCount ?? 0, guest.reservationCount)} stays
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {guest.phone || "No phone"} · {guest.email || "No email"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
