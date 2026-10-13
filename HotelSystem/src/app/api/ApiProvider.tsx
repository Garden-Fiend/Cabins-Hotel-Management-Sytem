import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "./client";
import type { ApiClient } from "./client";
import type { ApiData } from "./store";
import { ApiContext } from "./store";
import type { ReservationDto } from "./contracts";
import { presentReservation } from "./presentation";

export function ApiProvider({ client, children }: { client: ApiClient; children: React.ReactNode }) {
  const [data, setData] = useState<ApiData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const generation = useRef(0);
  const mutations = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const current = ++generation.current, beforeMutations = mutations.current;
    setRefreshing(true); setLoadError("");
    try {
      const [references, guests, reservations] = await Promise.all([
        client.references(signal), client.guests(signal), client.reservations(signal),
      ]);
      if (signal?.aborted || current !== generation.current) return;
      if (references.company.currency !== "PHP" || references.company.hotel_timezone !== "Asia/Manila")
        throw new Error("Unsupported hotel currency/timezone.");
      reservations.forEach(item => {
        presentReservation(item);
        if (item.company_id !== references.company.id) throw new Error("Reservation company mismatch.");
      });
      if (guests.some(item => item.company_id !== references.company.id)) throw new Error("Guest company mismatch.");
      if (beforeMutations !== mutations.current) throw new Error("Saved data changed during refresh. Refresh again; your saved changes are retained.");
      setData({ references, guests, reservations });
    } catch (error) {
      if (!signal?.aborted && current === generation.current) setLoadError(errorMessage(error));
    } finally {
      if (!signal?.aborted && current === generation.current) setRefreshing(false);
    }
  }, [client]);
  // Client is fixed for this configured application instance. Abort the StrictMode first mount.
  useEffect(() => {
    const controller = new AbortController();
    const startup = window.setTimeout(() => { void refresh(controller.signal); }, 0);
    return () => { window.clearTimeout(startup); controller.abort(); };
  }, [refresh]);
  function installReservation(record: ReservationDto) {
    try { presentReservation(record); }
    catch { throw new ApiError("Invalid canonical reservation response.", 0, "invalid_response", true); }
    mutations.current++;
    setData(current => {
      if (!current) return current;
      const existing = current.reservations.find(item => item.id === record.id);
      if (existing && existing.version > record.version) return current;
      return { ...current,
        guests: current.guests.some(item => item.id === record.guest.id) ? current.guests : [...current.guests, record.guest],
        reservations: existing ? current.reservations.map(item => item.id === record.id ? record : item) : [...current.reservations, record],
      };
    });
    return record;
  }
  return <ApiContext.Provider value={{ client, data, loadError, refreshing, refresh,
    loadReservation: async id => installReservation(await client.reservation(id)),
    createGuest: async (body, key) => {
      const guest = await client.createGuest(body, key);
      if (!guest.id || !guest.name) throw new ApiError("Invalid saved guest response.", 0, "invalid_response", true);
      mutations.current++;
      setData(current => current ? { ...current, guests: [...current.guests.filter(item => item.id !== guest.id), guest] } : current);
      return guest;
    },
    createReservation: async (body, key) => installReservation(await client.createReservation(body, key)),
    patchReservation: async (id, body, key) => installReservation(await ("scheduled_start" in body ? "charges" in body ? client.editStayCharges(id, body, key) : client.editStay(id, body, key) : "charges" in body ? client.editCharges(id, body, key) : "adjustments" in body ? client.editBilling(id, body, key) : "guest_id" in body ? client.editDetails(id, body, key) : client.patchReservation(id, body, key))),
    lifecycleReservation: async (id, action, body, key) => {
      const saved = installReservation(await client.lifecycleReservation(id, action, body, key));
      await refresh(); // Refresh canonical room occupancy/readiness with the accepted aggregate.
      return saved;
    },
    roomReadiness: async (id, body, key) => {
      const saved = await client.roomReadiness(id, body, key);
      if (saved.id !== id || !Number.isInteger(saved.version) || saved.version! < 1)
        throw new ApiError("Invalid canonical room response.", 0, "invalid_response", true);
      mutations.current++;
      setData(current => current ? { ...current, references: { ...current.references,
        rooms: current.references.rooms.map(room => room.id === id && (room.version ?? 0) <= saved.version! ? saved : room),
      } } : current);
      return saved;
    },
    saveDefinition: async (kind, id, body, key) => {
      const saved = await client.saveDefinition(kind, id, body, key);
      if (!saved.id || !Number.isInteger(saved.version) || saved.version < 1)
        throw new ApiError("Invalid saved definition response.", 0, "invalid_response", true);
      mutations.current++;
      await refresh();
      return saved;
    },
  }}>{children}</ApiContext.Provider>;
}
