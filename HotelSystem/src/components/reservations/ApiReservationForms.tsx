import { useState } from "react";
import type { FormEvent } from "react";
import { hotelDateAtTime, parseHotelDateTimeInput, toHotelDateTimeInput } from "../../lib/hotelTime";
import { errorMessage } from "../../app/api/client";
import type { CreateInput, GuestDto, GuestInput, PatchInput, ReservationDto } from "../../app/api/contracts";
import { formatPhp } from "../../app/api/presentation";
import { useApi } from "../../app/api/useApi";
import { useMutation } from "../../app/api/useMutation";

const input = "mt-1 block w-full rounded border border-slate-300 p-2";
const button = "rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50";

export function ApiGuestForm({ onSaved }: { onSaved?: (guest: GuestDto) => void }) {
  const api = useApi();
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const mutation = useMutation<GuestInput, GuestDto>(api.createGuest);
  async function submit(event: FormEvent) {
    event.preventDefault(); setNotice("");
    const guest = await (mutation.uncertain ? mutation.retryOriginal() : mutation.submit({ name, phone, email }));
    if (guest) { setNotice(`Guest ${guest.name} saved.`); onSaved?.(guest); setName(""); setPhone(""); setEmail(""); }
  }
  return <form onSubmit={submit} aria-label="Create guest" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Create guest</h2>
    <fieldset disabled={mutation.pending || mutation.uncertain || api.refreshing} className="space-y-3">
      <label className="block">Guest name<input className={input} value={name} onChange={e => setName(e.target.value)} required maxLength={200} /></label>
      <label className="block">Phone<input className={input} value={phone} onChange={e => setPhone(e.target.value)} maxLength={100} /></label>
      <label className="block">Email<input className={input} type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} /></label>
    </fieldset>
    {mutation.error && <p role="alert" className="text-red-800">{mutation.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button className={button} disabled={mutation.pending || api.refreshing}>
      {mutation.pending ? "Saving guest…" : mutation.uncertain ? "Retry original guest request" : "Save guest"}
    </button>
    <p className="text-sm text-slate-600">Guest creation is saved independently of a reservation.</p>
  </form>;
}

export function ApiReservationForm({ record, initialRoom, initialStart, onSaved, onClose }: {
  record?: ReservationDto; initialRoom?: string; initialStart?: Date;
  onSaved: (record: ReservationDto) => void; onClose: () => void;
}) {
  const api = useApi();
  const refs = api.data!.references;
  const [guest, setGuest] = useState("");
  const [room, setRoom] = useState(initialRoom ?? "");
  const [duration, setDuration] = useState("");
  const [start, setStart] = useState(() => toHotelDateTimeInput(initialStart ?? hotelDateAtTime(new Date(), refs.company.default_check_in_time.slice(0, 5))));
  const [note, setNote] = useState(record?.note ?? "");
  const [adults, setAdults] = useState(String(record?.allocation.adults ?? 2));
  const [children, setChildren] = useState(String(record?.allocation.children ?? 0));
  const [version, setVersion] = useState(record?.version ?? 1);
  const [baseline, setBaseline] = useState(() => ({ note: record?.note ?? "", adults: String(record?.allocation.adults ?? 2), children: String(record?.allocation.children ?? 0) }));
  const [localError, setLocalError] = useState("");
  const [review, setReview] = useState("");
  const mutation = useMutation<CreateInput | PatchInput, ReservationDto>((body, key) =>
    record ? api.patchReservation(record.id, body as PatchInput, key) : api.createReservation(body as CreateInput, key));
  const selectedRoom = refs.rooms.find(item => item.id === room);
  const selectedDuration = refs.durations.find(item => item.id === duration);
  const rate = refs.rates.find(item => item.enabled && item.room_type_id === selectedRoom?.room_type_id
    && item.booking_kind === selectedDuration?.kind
    && (item.booking_kind === "overnight" || item.duration_id === duration));
  const quantity = selectedDuration?.kind === "overnight" ? selectedDuration.nights ?? 1 : 1;
  const direct = refs.booking_sources.find(item => item.enabled && item.source_id === "direct");
  async function submit(event: FormEvent) {
    event.preventDefault(); setLocalError(""); setReview("");
    if (mutation.uncertain) {
      const saved = await mutation.retryOriginal();
      if (saved) onSaved(saved);
      return;
    }
    let payload: CreateInput | PatchInput;
    if (record) {
      payload = { expected_version: version,
        ...(note !== baseline.note ? { note } : {}),
        ...(adults !== baseline.adults ? { adults: Number(adults) } : {}),
        ...(children !== baseline.children ? { children: Number(children) } : {}) };
      if (Object.keys(payload).length === 1) { setLocalError("No changes to save."); return; }
    }
    else {
      const instant = parseHotelDateTimeInput(start);
      if (!direct || !Number.isFinite(instant.getTime())) { setLocalError("Select a direct source and valid hotel arrival time."); return; }
      payload = { guest_id: guest, booking_source_id: direct.id, room_id: room, duration_id: duration,
        scheduled_start: instant.toISOString(), note, adults: Number(adults), children: Number(children) };
    }
    const saved = await mutation.submit(payload);
    if (saved) onSaved(saved); // Never close/reset or display a local synthetic reservation.
  }
  async function loadLatest() {
    if (!record) return;
    try {
      const latest = await api.loadReservation(record.id);
      if (note === baseline.note) setNote(latest.note);
      if (adults === baseline.adults) setAdults(String(latest.allocation.adults));
      if (children === baseline.children) setChildren(String(latest.allocation.children));
      setBaseline({ note: latest.note, adults: String(latest.allocation.adults), children: String(latest.allocation.children) });
      setVersion(latest.version); mutation.reviewedLatest();
      setReview(`Latest version ${latest.version} loaded. Your edits are retained; untouched fields are updated. Review before saving.`);
    } catch (failure) { setLocalError(errorMessage(failure)); }
  }
  const disabled = mutation.pending || mutation.uncertain || api.refreshing;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Reservation pane">
    <h2 className="mb-3 text-xl font-semibold">{record ? `Edit ${record.reference}` : "New direct reservation"}</h2>
    {!record && <details className="mb-4"><summary>Create a new guest</summary><ApiGuestForm onSaved={item => setGuest(item.id)} /></details>}
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
        {!record && <>
          <label>Guest<select aria-label="Guest" className={input} value={guest} required onChange={e => setGuest(e.target.value)}>
            <option value="">Select guest</option>{api.data!.guests.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Room<select aria-label="Room" className={input} value={room} required onChange={e => { setRoom(e.target.value); setDuration(""); }}>
            <option value="">Select room</option>{refs.rooms.filter(item => item.enabled && !item.archived && item.operational
              && item.current_occupancy_allocation_id === null && refs.room_types.some(type => type.id === item.room_type_id && type.enabled))
              .map(item => <option key={item.id} value={item.id}>{item.number} {item.display_name}</option>)}
          </select></label>
          <label>Duration<select aria-label="Duration" className={input} value={duration} required onChange={e => setDuration(e.target.value)}>
            <option value="">Select duration</option>{refs.durations.filter(item => item.enabled).map(item =>
              <option key={item.id} value={item.id}>{item.kind === "hourly" ? `${item.minutes! / 60} hours` : `${item.nights} night(s)`}</option>)}
          </select></label>
          <label>Arrival (Asia/Manila)<input className={input} type="datetime-local" required value={start} onChange={e => setStart(e.target.value)} /></label>
        </>}
        <label>Adults<input className={input} type="number" required min={1} max={2147483647} step={1} value={adults} onChange={e => setAdults(e.target.value)} /></label>
        <label>Children<input className={input} type="number" required min={0} max={2147483647} step={1} value={children} onChange={e => setChildren(e.target.value)} /></label>
        <label className="sm:col-span-2">Reservation notes<textarea aria-label="Reservation notes" className={input} maxLength={4000} value={note} onChange={e => setNote(e.target.value)} /></label>
      </fieldset>
      <p>{record ? `Captured price: ${formatPhp(record.pricing.snapshot.total_minor)} · Editing version ${version}`
        : rate && Number.isSafeInteger(rate.unit_amount_minor * quantity) ? `Estimated accommodation: ${formatPhp(rate.unit_amount_minor * quantity)}. Final price is confirmed by the server.`
          : "Select a room and duration with an enabled rate. The server confirms the final price."}</p>
      {(localError || mutation.error) && <p role="alert" className="text-red-800">{localError || mutation.error}</p>}
      {review && <p role="status">{review}</p>}
      {mutation.conflict && <button type="button" className="underline" onClick={() => void loadLatest()}>Load latest version; keep my draft</button>}
      <div className="flex gap-3">
        <button className={button} disabled={mutation.pending || api.refreshing || (!mutation.uncertain && !record && (!rate || !direct))}>
          {mutation.pending ? "Saving…" : mutation.uncertain ? "Retry original request" : record ? "Save changes" : "Save reservation"}
        </button>
        <button type="button" onClick={onClose} disabled={mutation.pending || mutation.uncertain}>Close</button>
      </div>
      <p className="text-sm text-slate-600">Only single-room direct bookings and notes/guest-count edits are supported. Room/date changes, lifecycle actions, discounts, extras and payments are unavailable.</p>
    </form>
  </section>;
}
