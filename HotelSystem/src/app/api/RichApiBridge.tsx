import { useRef, useState } from "react";
import { ReservationDemoContext } from "../reservationDemoStore";
import { useApi } from "./useApi";
import { richConfiguration, richReservation } from "./richPresentation";
import { presentReservation } from "./presentation";
import { useMutation } from "./useMutation";
import type { CreateInput, GuestInput, LifecycleAction, LifecycleInput } from "./contracts";
import { reservationEditInput, type ReservationEditInput } from "./reservationEditInput";
import { definitionIntent, type DefinitionIntent } from "./definitionInputs";

export function RichApiBridge({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const scope = `hms-pending:${api.client.baseUrl}:${api.data?.references.company.id}`;
  const create = useMutation(api.createReservation, `${scope}:create`);
  const guest = useMutation(api.createGuest, `${scope}:guest`);
  const patch = useMutation((input: { id: string; body: ReservationEditInput }, key: string) => api.patchReservation(input.id, input.body, key), `${scope}:patch`);
  const lifecycle = useMutation((input: { id: string; action: LifecycleAction; body: LifecycleInput }, key: string) => api.lifecycleReservation(input.id, input.action, input.body, key), `${scope}:lifecycle`);
  const readiness = useMutation((input: { id: string; body: { expected_version: number; housekeeping: "clean" | "cleaning" } }, key: string) => api.roomReadiness(input.id, input.body, key), `${scope}:readiness`);
  const definition = useMutation((input: DefinitionIntent, key: string) => api.saveDefinition(input.kind, input.id, input.body, key), `${scope}:definition`);
  const [reviewMessage, setReviewMessage] = useState("");
  const reviewed = useRef<{ id: string; version: number } | null>(null);
  const lastEdit = useRef<string | null>(null);
  if (!api.data) return null;
  const { references, reservations, guests } = api.data;
  const configuration = richConfiguration(references);
  configuration.rooms = configuration.rooms.map(room => {
    const pointer = references.rooms.find(r => r.id === room.id)?.current_occupancy_allocation_id;
    const owner = reservations.find(r => r.status === "cancelled" && r.allocation.id === pointer);
    return { ...room, occupancyLockReservationId: owner?.id };
  });
  const unsupported = () => { throw new Error("This operation is not available in API mode. No records were changed."); };
  return <ReservationDemoContext.Provider value={{ mode: "api", actor: "local-development",
    capabilities: { manage_channels: false, edit_channel_terms: false, override_accommodation: false,
      verify_collection: false, confirm_commission: false, record_settlement: false, reconcile_settlement: false },
    reservations: reservations.map(r => richReservation(r, references)), stays: reservations.map(r => presentReservation(r).stay),
    guests, configuration, settlements: [],
    setReservations: unsupported, setStays: unsupported, setGuests: unsupported, setConfiguration: unsupported, setSettlements: unsupported,
    commands: {
      canEditGuest: references.capabilities?.includes("reservation.guest-edit.v1"),
      canEditStay: references.capabilities?.includes("reservation.stay-edit.v1"),
      canEditAdjustments: references.capabilities?.includes("reservation.adjustments.v1"),
      canEditPurchases: references.capabilities?.includes("reservation.purchases.v1"),
      canEditRoomStatus: references.capabilities?.includes("room.status.v1"),
      error: create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error,
      busy: lifecycle.pending || readiness.pending || definition.pending || create.pending || patch.pending || guest.pending || api.refreshing,
      saveDefinition: references.capabilities?.includes("configuration.definitions.v1") ? async (section, id, values, version) => {
        const result = await definition.submit(definitionIntent(section, id, values, configuration, version));
        if (!result) throw new Error("Configuration save was not confirmed. Your draft is retained. " + (definition.error || "Resolve the API error before retrying."));
      } : undefined,
      readiness: references.capabilities?.includes("room.readiness.v1") ? async (room, state) => {
        if (!room.serverVersion) throw new Error("Reload room data before changing readiness.");
        const saved = await readiness.submit({ id: room.id, body: { expected_version: room.serverVersion, housekeeping: state } });
        if (!saved) throw new Error("Readiness change was not confirmed. Reload/review stale state or retry the unchanged action.");
      } : undefined,
      lifecycle: references.capabilities?.includes("reservation.lifecycle.v1") ? async (original, action, vacated) => {
        const body: LifecycleInput = { expected_version: original.serverVersion! };
        if (action === "cancel") body.guest_has_vacated = vacated;
        const result = await lifecycle.submit({ id: original.id, action, body });
        if (!result) throw new Error("Lifecycle change was not confirmed. " + (lifecycle.error || "Refresh/review conflicts or retry the unchanged command."));
      } : undefined,
      conflict: patch.conflict,
      reviewMessage,
      reviewLatest: async () => {
        if (!lastEdit.current) return;
        try {
          const latest = await api.loadReservation(lastEdit.current);
          reviewed.current = { id: latest.id, version: latest.version };
          setReviewMessage(`Latest server version ${latest.version}: guest ${latest.guest.name}; room ${latest.pricing.snapshot.lines[0].room_number}; arrival ${latest.allocation.scheduled_start}; duration ${latest.allocation.duration_id}; note “${latest.note}”; adults ${latest.allocation.adults}, children ${latest.allocation.children}. Your draft is unchanged. Review it before saving again.`);
          patch.reviewedLatest();
        } catch (error) { setReviewMessage(error instanceof Error ? error.message : "Unable to load latest version. No retry authorized."); }
      },
      create: async input => {
        const room = references.rooms.find(r => r.number === input.roomNumber);
        if (!room) throw new Error("Select a server-owned room.");
        const body: CreateInput = { guest_id: input.guestId, booking_source_id: input.bookingSourceId, room_id: room.id,
          duration_id: input.durationId, scheduled_start: input.start.toISOString(), adults: input.adults, children: input.children, note: input.note };
        const result = await create.submit(body);
        if (!result) throw new Error("Reservation was not confirmed. Resolve the API error below and retry the same draft.");
        return richReservation(result, references);
      },
      patch: async (original, input) => {
        lastEdit.current = original.id;
        const commandBody = reservationEditInput(original, input, reservations.find(r => r.id === original.id), references,
          reviewed.current?.id === original.id ? reviewed.current.version : original.serverVersion!);
        if (!commandBody) return original;
        const result = await patch.submit({ id: original.id, body: commandBody });
        if (!result) throw new Error("Edit was not confirmed. Your draft is retained. Resolve the API error below before retrying.");
        reviewed.current = null;
        return richReservation(result, references);
      },
      createGuest: async input => {
        const result = await guest.submit(input as GuestInput);
        if (!result) throw new Error("Guest was not confirmed. Keep the same details and retry after resolving the API error.");
        return result;
      },
    },
  }}>
    {reviewMessage && <p role="status" className="m-4 rounded-xl border bg-sky-50 p-3">{reviewMessage}</p>}
    {(create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error) && <div role="alert" className="m-4 rounded-xl border border-rose-300 bg-rose-50 p-4">
      {create.error || patch.error || guest.error || lifecycle.error || readiness.error || definition.error}
      {definition.uncertain && <button className="ml-3 underline" onClick={() => void definition.retryOriginal()}>Confirm original configuration request</button>}
      {readiness.uncertain && <button className="ml-3 underline" onClick={() => void readiness.retryOriginal()}>Confirm original readiness request</button>}
      {lifecycle.uncertain && <button className="ml-3 underline" onClick={() => void lifecycle.retryOriginal()}>Confirm original lifecycle request</button>}
      {create.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"][aria-label="Create reservation"]')) {
          setReviewMessage("Use Create Reservation in the open, unchanged draft to confirm its original request, or close it before recovering here."); return;
        }
        void create.retryOriginal();
      }}>Confirm original reservation request</button>}
      {patch.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"][aria-label="Edit reservation"]')) {
          setReviewMessage("Use Save Changes in the open, unchanged draft to confirm its original edit, or close it before recovering here."); return;
        }
        void patch.retryOriginal();
      }}>Confirm original edit request</button>}
      {guest.uncertain && <button className="ml-3 underline" onClick={() => {
        if (document.querySelector('[role="dialog"]')) {
          setReviewMessage("Retry the unchanged guest details in the open pane, or close it before recovering here."); return;
        }
        void guest.retryOriginal();
      }}>Confirm original guest request</button>}
    </div>}
    {children}
  </ReservationDemoContext.Provider>;
}
