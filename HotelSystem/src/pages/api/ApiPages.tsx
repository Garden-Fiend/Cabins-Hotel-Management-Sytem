import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AvailabilityCalendar } from "../../components/AvailabilityCalendar";
import { CalendarToolbar } from "../../components/CalendarToolbar";
import { addDays, addMonths } from "../../lib/calendar";
import type { CalendarView } from "../../lib/calendar";
import { createHotelDateTime, formatHotelDate, getHotelDateParts } from "../../lib/hotelTime";
import { ApiGuestForm, ApiReservationForm } from "../../components/reservations/ApiReservationForms";
import { apiInstant, formatPhp, presentReservation } from "../../app/api/presentation";
import { useApi } from "../../app/api/useApi";
import { errorMessage } from "../../app/api/client";

const card = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
function date(value: string) { return formatHotelDate(apiInstant(value), { dateStyle: "medium", timeStyle: "short" }); }

export function ApiDashboard() {
  const api = useApi(), navigate = useNavigate();
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [draft, setDraft] = useState<{ room?: string; start?: Date } | null>(null);
  const data = api.data!;
  function move(direction: number) {
    setAnchor(current => view === "year" ? createHotelDateTime(getHotelDateParts(current).year + direction, 1, 1)
      : view === "month" ? addMonths(current, direction) : addDays(current, direction * (view === "week" ? 7 : 1)));
  }
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold">Persisted reservations</h1>
    <p>PostgreSQL records · Asia/Manila · Single-room direct bookings</p>
    <button className="rounded bg-slate-900 px-4 py-2 text-white" disabled={api.refreshing || draft !== null} onClick={() => setDraft({})}>New reservation</button>
    <div className={draft ? "grid gap-4 xl:grid-cols-[2fr_1fr]" : ""}>
      <div className={card}>
        <CalendarToolbar view={view} anchorDate={anchor} onViewChange={setView} onPrevious={() => move(-1)} onNext={() => move(1)} onToday={() => setAnchor(new Date())} />
        <AvailabilityCalendar rooms={[...new Set([...data.references.rooms.map(item => item.number), ...data.reservations.map(item => item.pricing.snapshot.lines[0].room_number)])]}
          stays={data.reservations.map(item => presentReservation(item).stay)} view={view} anchorDate={anchor}
          onStayClick={stay => { if (stay.reservationId) navigate(`/reservations/${stay.reservationId}`); }}
          onRoomTimeSelect={draft || api.refreshing ? undefined : (number, start) => {
            const room = data.references.rooms.find(item => item.number === number);
            if (room) setDraft({ room: room.id, start });
          }} />
      </div>
      {draft && <ApiReservationForm initialRoom={draft.room} initialStart={draft.start} onClose={() => setDraft(null)} onSaved={saved => { setDraft(null); navigate(`/reservations/${saved.id}`); }} />}
    </div>
    <ApiReservationList />
  </div>;
}

export function ApiReservationList() {
  const api = useApi();
  return <section className="space-y-3" aria-label="Saved reservations">
    {api.data!.reservations.length === 0 ? <p>No persisted reservations.</p> : api.data!.reservations.map(record =>
      <article className={card} key={record.id} data-reservation-id={record.id}>
        <Link className="font-semibold text-blue-800 underline" to={`/reservations/${record.id}`}>{record.reference} · {record.guest.name}</Link>
        <p>Room {record.pricing.snapshot.lines[0].room_number} · {date(record.allocation.scheduled_start)} – {date(record.allocation.scheduled_end)}</p>
        <p>Captured accommodation: {formatPhp(record.pricing.snapshot.total_minor)} · Version {record.version}</p>
        <p>{record.note}</p>
      </article>)}
  </section>;
}

export function ApiReservationDetail() {
  const api = useApi();
  const { reservationId = "" } = useParams();
  const record = api.data!.reservations.find(item => item.id === reservationId);
  const [editing, setEditing] = useState(false), [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  async function reload() {
    try { await api.loadReservation(reservationId); setFailure(""); }
    catch (error) { setFailure(errorMessage(error)); }
  }
  function saved() { setEditing(false); setNotice("Changes saved to PostgreSQL."); }
  if (!record) return <section className={card}><h1>Reservation not found</h1><p>No demo record was substituted.</p><button onClick={() => void reload()}>Load reservation from server</button>{failure && <p role="alert">{failure}</p>}</section>;
  return <div className="space-y-4">
    <Link to="/reservations" className="underline">All reservations</Link>
    <section className={card}>
      <h1 className="text-2xl font-bold">{record.reference}</h1>
      <p>{record.guest.name} · {record.status} · Version {record.version}</p>
      <p>Room {record.pricing.snapshot.lines[0].room_number} · {record.pricing.snapshot.lines[0].room_type_label}</p>
      <p>{date(record.allocation.scheduled_start)} – {date(record.allocation.scheduled_end)}</p>
      <p>{record.allocation.adults} adults · {record.allocation.children} children</p>
      <p data-testid="saved-note">{record.note || "No reservation notes"}</p>
      <p className="font-semibold">Captured accommodation: {formatPhp(record.pricing.snapshot.total_minor)}</p>
      <p>Captured unit rate: {formatPhp(record.pricing.snapshot.lines[0].unit_amount_minor)} × {record.pricing.snapshot.lines[0].quantity}</p>
      <p className="text-sm">Tax is not configured. This is an operational charge, not an accounting invoice.</p>
      <button className="mt-3 rounded bg-slate-900 px-4 py-2 text-white" disabled={editing || api.refreshing} onClick={() => setEditing(true)}>Edit notes and guest counts</button>
      <button className="ml-3 underline" disabled={editing} onClick={() => void reload()}>Reload server record</button>
      {notice && <p role="status">{notice}</p>}{failure && <p role="alert">{failure}</p>}
    </section>
    {editing && <ApiReservationForm key={record.id} record={record} onClose={() => setEditing(false)} onSaved={saved} />}
    <section className={card}><h2 className="font-semibold">Server audit</h2>{record.audit.map(event => <p key={event.id}>{event.event_type} · Version {event.reservation_version} · {event.actor} · {date(event.occurred_at)}</p>)}</section>
    <p>Check-in/out, cancellation, room/date changes, adjustments, collections and printing invoices are unavailable in API mode.</p>
  </div>;
}

export function ApiGuests() {
  const api = useApi();
  return <div className="space-y-4"><h1 className="text-2xl font-bold">Persisted guests</h1><ApiGuestForm />
    {api.data!.guests.map(guest => <article className={card} key={guest.id}><h2>{guest.name}</h2><p>{guest.phone || "No phone"} · {guest.email || "No email"}</p></article>)}
    <p>Guest editing, deletion and CRM segmentation are unavailable.</p></div>;
}

export function ApiReferences() {
  const refs = useApi().data!.references;
  return <section className={card}><h1 className="text-2xl font-bold">Reference configuration · Read only</h1>
    <p>{refs.company.name} · {refs.company.currency} · {refs.company.hotel_timezone}</p>
    <p>Check-in {refs.company.default_check_in_time} · Checkout {refs.company.default_check_out_time}</p>
    {refs.rooms.map(room => <p key={room.id}>Room {room.number} · {room.housekeeping} · {room.operational ? "Operational" : "Non-operational"} · {room.enabled && !room.archived ? "Enabled" : "Unavailable"}</p>)}
    {refs.rates.map(rate => <p key={rate.id}>{rate.source_id} · {formatPhp(rate.unit_amount_minor)} · {rate.enabled ? "Enabled" : "Disabled"}</p>)}
    <p>Configuration and room-readiness changes are unavailable.</p>
  </section>;
}

export function ApiUnsupported() { return <section className={card}><h1>Workflow unavailable in API mode</h1><p>No local changes are saved as backend records.</p><Link to="/">Return to persisted reservations</Link></section>; }
