import { validateDefaultInclusions } from "../lib/roomTypeInclusions";
import { normalizeRoomFields, roomDisplayName, roomReadinessError } from "../lib/roomConfiguration";
import { RoomTypeInclusionsEditor } from "../features/configuration/RoomTypeInclusionsEditor";
import { useState } from "react";

import { useReservationDemo } from "../app/useReservationDemo";
import type {
  HousekeepingState,
  RoomConfiguration,
  RoomTypeConfiguration,
} from "../features/configuration/types";

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

interface RoomForm {
  number: string;
  roomTypeId: string;
  displayType: string;
  roomStatusId: string;
  capacityOverride: string;
  description: string;
  amenities: string[];
  operationalNotes: string;
}

interface RoomTypeForm {
  defaultInclusions: NonNullable<RoomTypeConfiguration["defaultInclusions"]>;
  label: string;
  defaultCapacity: string;
  amenities: string[];
}

const emptyRoom: RoomForm = {
  number: "",
  roomTypeId: "",
  displayType: "",
  roomStatusId: "operational",
  capacityOverride: "",
  description: "",
  amenities: [],
  operationalNotes: "",
};

function toggleSelection(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function makeId(prefix: string, value: string) {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
}

export function RoomsPage() {
  const {
    stays,
    reservations,
    configuration,
    setConfiguration,
    mode,
    commands,
  } = useReservationDemo();
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoom);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editingRoomVersion, setEditingRoomVersion] = useState<number | undefined>();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomFormVisible, setRoomFormVisible] = useState(false);
  const [roomTypeForm, setRoomTypeForm] = useState<RoomTypeForm>({
    label: "",
    defaultCapacity: "2", defaultInclusions: [],
    amenities: [],
  });
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [editingTypeVersion, setEditingTypeVersion] = useState<number | undefined>();
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string | null>(null);
  const [roomTypeFormVisible, setRoomTypeFormVisible] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"rooms" | "room-types">("rooms");
  const now = new Date();
  const roomTypes = configuration.roomTypes;
  const amenityItems = configuration.catalogItems.filter(
    (item) =>
      item.category === "amenities" && item.enabled && !item.archived,
  );

  function resolveAmenityId(value: string) {
    return (
      amenityItems.find(
        (item) =>
          item.id === value || item.label.toLowerCase() === value.toLowerCase(),
      )?.id ?? value
    );
  }

  function amenityLabel(value: string) {
    return (
      configuration.catalogItems.find((item) => item.id === value)?.label ??
      value
    );
  }

  function roomTypeDefaults(roomTypeId: string) {
    return (
      roomTypes
        .find((roomType) => roomType.id === roomTypeId)
        ?.amenities.map(resolveAmenityId) ?? []
    );
  }

  async function saveRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = roomForm.number.trim();
    const current = editingRoomId
      ? configuration.rooms.find((item) => item.id === editingRoomId)
      : undefined;
    let normalized;
    try {
      normalized = normalizeRoomFields({ ...roomForm, housekeepingState: current?.housekeepingState ?? "clean" }, configuration, current);
      if (current && normalized.number !== current.number && (stays.some(stay => stay.room === current.number) || reservations.some(reservation => reservation.rooms.some(room => room.roomNumber === current.number)))) throw new Error("Room numbers referenced by reservations cannot be changed here.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Invalid room configuration."); return; }
    const next: RoomConfiguration = {
      ...current,
      id: current?.id ?? makeId("room", number),
      number,
      roomTypeId: normalized.roomTypeId,
      displayType: normalized.displayType,
      roomStatusId: roomForm.roomStatusId,
      enabled: current?.enabled ?? true,
      archived: current?.archived ?? false,
      housekeepingState: current?.housekeepingState ?? "clean",
      capacityOverride: normalized.capacityOverride,
      description: roomForm.description.trim(),
      amenitiesAdditions: roomForm.amenities.filter(
        (amenity) => !roomTypeDefaults(normalized.roomTypeId).includes(amenity),
      ),
      amenitiesRemovals: roomTypeDefaults(normalized.roomTypeId).filter(
        (amenity) => !roomForm.amenities.includes(amenity),
      ),
      operationalNotes: roomForm.operationalNotes.trim(),
      occupancyLockReservationId: current?.occupancyLockReservationId,
    };
    if (mode === "api") {
      if (!commands?.saveDefinition) return;
      try {
        await commands.saveDefinition("rooms", current?.id, {
          number, roomTypeId: normalized.roomTypeId, displayType: normalized.displayType,
          roomStatusId: roomForm.roomStatusId, enabled: current?.enabled ?? true,
          capacityOverride: roomForm.capacityOverride, description: roomForm.description,
          operationalNotes: roomForm.operationalNotes, amenities: roomForm.amenities,
        }, editingRoomVersion);
      } catch (error) { setNotice(error instanceof Error ? error.message : "Room save failed; draft retained."); return; }
    } else setConfiguration((currentConfig) => ({
      ...currentConfig,
      rooms: currentConfig.rooms.some((item) => item.id === next.id)
        ? currentConfig.rooms.map((item) =>
            item.id === next.id ? next : item,
          )
        : [...currentConfig.rooms, next],
    }));
    setRoomForm(emptyRoom);
    setEditingRoomId(null);
    setSelectedRoomId(null);
    setRoomFormVisible(false);
    setNotice(`Room ${number} saved.`);
  }

  function editRoom(room: RoomConfiguration) {
    setEditingRoomVersion(room.serverVersion);
    setEditingRoomId(room.id);
    setSelectedRoomId(room.id);
    setRoomFormVisible(true);
    setRoomForm({
      number: room.number,
      roomTypeId: room.roomTypeId,
      displayType: room.displayType,
      roomStatusId: room.roomStatusId,
      capacityOverride: room.capacityOverride?.toString() ?? "",
      description: room.description,
      amenities: [
        ...roomTypeDefaults(room.roomTypeId).filter(
          (amenity) =>
            !room.amenitiesRemovals.map(resolveAmenityId).includes(amenity),
        ),
        ...room.amenitiesAdditions.map(resolveAmenityId),
      ],
      operationalNotes: room.operationalNotes,
    });
    setTab("rooms");
  }

  async function setOperationalStatus(room: RoomConfiguration, status: string) {
    if (mode !== "api") {
      setConfiguration(current => ({ ...current, rooms: current.rooms.map(item => item.id === room.id ? { ...item, roomStatusId: status } : item) }));
      return;
    }
    if (!commands?.saveDefinition || !commands.canEditRoomStatus) return;
    try {
      await commands.saveDefinition("rooms", room.id, { number: room.number, roomTypeId: room.roomTypeId,
        displayType: room.displayType, roomStatusId: status, enabled: room.enabled, archived: room.archived ?? false,
        capacityOverride: room.capacityOverride?.toString() ?? "", description: room.description, operationalNotes: room.operationalNotes,
        amenities: [...roomTypeDefaults(room.roomTypeId).filter(id => !room.amenitiesRemovals.map(resolveAmenityId).includes(id)), ...room.amenitiesAdditions.map(resolveAmenityId)] }, room.serverVersion);
      setNotice(`Room ${room.number} status saved.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Status save failed; room state retained."); }
  }

  async function setReadiness(roomId: string, state: HousekeepingState) {
    const room = configuration.rooms.find(item => item.id === roomId);
    if (!room) return;
    if (mode === "api") {
      if (!commands?.readiness || state === "dirty") { setNotice("This readiness action is unavailable in API mode."); return; }
      try { await commands.readiness(room, state); setNotice("Readiness committed to PostgreSQL."); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Readiness was not saved."); }
      return;
    }
    const error = roomReadinessError(room, state, stays, new Date());
    if (error) { setNotice(error); return; }
    setConfiguration((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.id === roomId ? { ...room, housekeepingState: state } : room,
      ),
    }));
  }

  async function saveRoomType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = roomTypeForm.label.trim();
    const defaultCapacity = Number(roomTypeForm.defaultCapacity);
    if (
      !label ||
      !Number.isInteger(defaultCapacity) ||
      defaultCapacity < 1 ||
      roomTypes.some(
        (item) =>
          item.label.toLowerCase() === label.toLowerCase() &&
          item.id !== editingRoomTypeId,
      )
    ) {
      setNotice("Enter a unique room type name and a positive whole-number capacity.");
      return;
    }
    const inclusionError = validateDefaultInclusions(roomTypeForm.defaultInclusions, configuration);
    if (inclusionError) { setNotice(inclusionError); return; }
    const existing = roomTypes.find((item) => item.id === editingRoomTypeId);
    const next: RoomTypeConfiguration = {
      id: existing?.id ?? makeId("room-type", label),
      label,
      enabled: existing?.enabled ?? true,
      archived: existing?.archived ?? false,
      defaultCapacity,
      amenities: roomTypeForm.amenities,
      defaultInclusions: roomTypeForm.defaultInclusions.map((item) => ({ ...item })),
    };
    if (mode === "api") {
      if (!commands?.saveDefinition) return;
      try { await commands.saveDefinition("roomTypes", editingRoomTypeId ?? undefined, { label, defaultCapacity,
        amenities: roomTypeForm.amenities, enabled: next.enabled, archived: next.archived ?? false }, editingTypeVersion); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Room type save failed; draft retained."); return; }
    } else setConfiguration((current) => ({
      ...current,
      roomTypes: current.roomTypes.some((item) => item.id === next.id)
        ? current.roomTypes.map((item) =>
            item.id === next.id ? next : item,
          )
        : [...current.roomTypes, next],
    }));
    setRoomTypeForm({ label: "", defaultCapacity: "2", defaultInclusions: [], amenities: [] });
    setEditingRoomTypeId(null);
    setSelectedRoomTypeId(null);
    setRoomTypeFormVisible(false);
    setNotice(`Room type ${label} saved.`);
  }

  function editRoomType(roomType: RoomTypeConfiguration) {
    setEditingTypeVersion(roomType.serverVersion);
    setEditingRoomTypeId(roomType.id);
    setSelectedRoomTypeId(roomType.id);
    setRoomTypeFormVisible(true);
    setRoomTypeForm({
      label: roomType.label,
      defaultCapacity: String(roomType.defaultCapacity),
      defaultInclusions: (roomType.defaultInclusions ?? []).map((item) => ({ ...item })),
      amenities: roomType.amenities.map((amenity) =>
        resolveAmenityId(amenity),
      ),
    });
    setTab("room-types");
  }

  function referencedRoom(roomNumber: string) {
    return reservations.some((reservation) =>
      reservation.rooms.some((room) => room.roomNumber === roomNumber),
    );
  }

  const activeRooms = configuration.rooms.filter(
    (room) => room.enabled && !room.archived,
  );

  return (
    <div className="space-y-6">
      {mode === "api" && <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">API mode: supported readiness, room status and room/type edits persist. Archive and deletion controls and catalog inclusions are not yet supported.</p>}
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Inventory
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Rooms</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage physical rooms, shared room-type defaults, readiness, and reservation availability.
        </p>
      </header>

      {notice && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          {notice}
        </p>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        {([
          ["rooms", "Rooms"],
          ["room-types", "Room types"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold ${
              tab === id
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "rooms" ? (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
              type="button"
              onClick={() => {
                setEditingRoomId(null);
                setSelectedRoomId(null);
                setRoomForm(emptyRoom);
                setRoomFormVisible(true);
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Add room
            </button>
          </div>
          {roomFormVisible && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEditingRoomId(null);
                setSelectedRoomId(null);
                setRoomForm(emptyRoom);
                setRoomFormVisible(false);
              }
            }}
          >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-form-title"
            className={`${cardClass} max-h-[90vh] w-full max-w-2xl overflow-y-auto`}
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="room-form-title" className="text-lg font-semibold">
                {editingRoomId ? "Edit room" : "Add room"}
              </h2>
              <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
                type="button"
                aria-label="Close room form"
                onClick={() => {
                  setEditingRoomId(null);
                  setSelectedRoomId(null);
                  setRoomForm(emptyRoom);
                  setRoomFormVisible(false);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            <form onSubmit={saveRoom} className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                Room number
                <input
                  className={`${inputClass} mt-1`}
                  value={roomForm.number}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      number: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                Room type
                <select
                  className={`${inputClass} mt-1`}
                  value={roomForm.roomTypeId}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      roomTypeId: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Choose room type</option>
                  {roomTypes
                    .filter((item) => (item.enabled && !item.archived) || (editingRoomId !== null && item.id === configuration.rooms.find(room => room.id === editingRoomId)?.roomTypeId))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Room name or display type
                <input
                  className={`${inputClass} mt-1`}
                  value={roomForm.displayType}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      displayType: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Capacity override (optional)
                <input
                  className={`${inputClass} mt-1`}
                  type="number"
                  min="1"
                  value={roomForm.capacityOverride}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      capacityOverride: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                Description
                <textarea
                  className={`${inputClass} mt-1`}
                  rows={2}
                  value={roomForm.description}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Room amenities</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {amenityItems.map((amenity) => (
                    <label
                      key={amenity.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={roomForm.amenities.includes(amenity.id)}
                        onChange={() =>
                          setRoomForm((current) => ({
                            ...current,
                            amenities: toggleSelection(
                              current.amenities,
                              amenity.id,
                            ),
                          }))
                        }
                      />
                      {amenity.label}
                    </label>
                  ))}
                  {!amenityItems.length && (
                    <p className="text-sm text-slate-500">
                      Add amenities in Inventory to select them here.
                    </p>
                  )}
                </div>
              </fieldset>
              <label className="block text-sm font-medium">
                Operational notes
                <textarea
                  className={`${inputClass} mt-1`}
                  rows={2}
                  value={roomForm.operationalNotes}
                  onChange={(event) =>
                    setRoomForm((current) => ({
                      ...current,
                      operationalNotes: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="flex gap-2">
                <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                  {editingRoomId ? "Save room" : "Add room"}
                </button>
                <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
                  type="button"
                  onClick={() => {
                    setEditingRoomId(null);
                    setSelectedRoomId(null);
                    setRoomForm(emptyRoom);
                    setRoomFormVisible(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
          </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {configuration.rooms.map((room) => {
              const currentStay = stays.find(
                (stay) =>
                  stay.room === room.number &&
                  (stay.status === "checked_in" || stay.occupancyLocked) &&
                  stay.checkIn <= now,
              );
              const upcomingStay = stays.some(
                (stay) =>
                    stay.room === room.number &&
                    (stay.status === "confirmed" || stay.status === "reserved") &&
                    stay.checkOut > now,
              );
              const roomType = roomTypes.find(
                (item) => item.id === room.roomTypeId,
              );
              const status = configuration.roomStatuses.find(
                (item) => item.id === room.roomStatusId,
              );
              const operational = Boolean(
                status?.enabled && !status.blocksReservation,
              );
              const availability = currentStay
                ? currentStay.occupancyLocked
                  ? "Occupied · departure pending"
                  : "Occupied"
                : !operational
                  ? status?.label ?? "Unavailable"
                  : upcomingStay
                    ? "Reserved"
                    : "Available";
              const inheritedAmenities = roomType?.amenities ?? [];
              const amenities = [
                ...inheritedAmenities.filter(
                  (item) =>
                    !room.amenitiesRemovals
                      .map(resolveAmenityId)
                      .includes(resolveAmenityId(item)),
                ),
                ...room.amenitiesAdditions,
              ].map((item) => amenityLabel(resolveAmenityId(item)));
              const hasHistory = referencedRoom(room.number);
              return (
                <article
                  key={room.id}
                  tabIndex={0}
                  onClick={(event) => {
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("button, select, input, textarea, a")
                    ) {
                      return;
                    }
                    editRoom(room);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      event.target === event.currentTarget
                    ) {
                      event.preventDefault();
                      editRoom(room);
                    }
                  }}
                  className={`${cardClass} cursor-pointer transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    selectedRoomId === room.id
                      ? "border-slate-700 ring-1 ring-slate-700"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">Room {room.number}</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {roomType?.label ?? room.roomTypeId} · {roomDisplayName(room, configuration)}
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">
                      {availability}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-800">
                      Readiness: {room.housekeepingState}
                    </span>
                    <select
                      disabled={mode === "api" && (!commands?.canEditRoomStatus || commands.busy)}
                      aria-label={`Room ${room.number} status`}
                      value={room.roomStatusId}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => void setOperationalStatus(room, event.target.value)}
                      className="rounded-full border-0 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 focus:ring-2 focus:ring-amber-500"
                    >
                      {configuration.roomStatuses.map((item) => (
                        <option key={item.id} value={item.id} disabled={!item.enabled && item.id !== room.roomStatusId}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {!room.enabled || room.archived ? (
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    Capacity: {room.capacityOverride ?? roomType?.defaultCapacity ?? "—"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Amenities: {amenities.length ? amenities.join(", ") : "None"}
                  </p>
                  {room.description && (
                    <p className="mt-2 text-sm text-slate-600">{room.description}</p>
                  )}
                  {room.operationalNotes && (
                    <p className="mt-2 text-sm text-slate-600">
                      Notes: {room.operationalNotes}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={(mode === "api" && (!commands?.readiness || commands.busy)) || room.housekeepingState === "cleaning" || Boolean(currentStay)}
                      onClick={() => setReadiness(room.id, "cleaning")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                    >
                      Start cleaning
                    </button>
                    <button
                      type="button"
                      disabled={(mode === "api" && (!commands?.readiness || commands.busy)) || room.housekeepingState === "clean" || Boolean(currentStay)}
                      onClick={() => setReadiness(room.id, "clean")}
                      className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40"
                    >
                      Mark Clean
                    </button>
                    {room.enabled && !room.archived ? (
                      <button
                        type="button"
                        disabled={mode === "api" || reservations.some(
                          (reservation) =>
                            (reservation.status === "confirmed" ||
                              reservation.status === "checked_in" ||
                              reservation.occupancyLockRoomNumbers?.includes(room.number)) &&
                            reservation.rooms.some(
                              (assigned) => assigned.roomNumber === room.number,
                            ),
                        )}
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            rooms: current.rooms.map((item) =>
                              item.id === room.id
                                ? { ...item, enabled: false, archived: true }
                                : item,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
                      >
                        Archive
                      </button>
                    ) : (
                      <button disabled={mode === "api"}
                        type="button"
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            rooms: current.rooms.map((item) =>
                              item.id === room.id
                                ? { ...item, enabled: true, archived: false }
                                : item,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
                      >
                        Restore
                      </button>
                    )}
                    {!hasHistory && (
                      <button disabled={mode === "api"}
                        type="button"
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            rooms: current.rooms.filter(
                              (item) => item.id !== room.id,
                            ),
                          }))
                        }
                        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            {activeRooms.length === 0 && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
                No active rooms are configured.
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
              type="button"
              onClick={() => {
                setEditingRoomTypeId(null);
                setSelectedRoomTypeId(null);
                setRoomTypeForm({
                  label: "",
                  defaultCapacity: "2", defaultInclusions: [],
                  amenities: [],
                });
                setRoomTypeFormVisible(true);
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            >
              Add room type
            </button>
          </div>
          {roomTypeFormVisible && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEditingRoomTypeId(null);
                setSelectedRoomTypeId(null);
                setRoomTypeForm({
                  label: "",
                  defaultCapacity: "2", defaultInclusions: [],
                  amenities: [],
                });
                setRoomTypeFormVisible(false);
              }
            }}
          >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-type-form-title"
            className={`${cardClass} max-h-[90vh] w-full max-w-xl overflow-y-auto`}
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="room-type-form-title" className="text-lg font-semibold">
                {editingRoomTypeId ? "Edit room type" : "Add room type"}
              </h2>
              <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
                type="button"
                aria-label="Close room type form"
                onClick={() => {
                  setEditingRoomTypeId(null);
                  setSelectedRoomTypeId(null);
                  setRoomTypeForm({
                    label: "",
                    defaultCapacity: "2", defaultInclusions: [],
                    amenities: [],
                  });
                  setRoomTypeFormVisible(false);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              >
                Close
              </button>
            </div>
            {notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}
            <form onSubmit={saveRoomType} className="mt-4 space-y-3">
              <label className="block text-sm font-medium">
                Name
                <input
                  className={`${inputClass} mt-1`}
                  value={roomTypeForm.label}
                  onChange={(event) =>
                    setRoomTypeForm((current) => ({
                      ...current,
                      label: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label className="block text-sm font-medium">
                Default capacity
                <input
                  className={`${inputClass} mt-1`}
                  type="number"
                  min="1"
                  step="1"
                  value={roomTypeForm.defaultCapacity}
                  onChange={(event) =>
                    setRoomTypeForm((current) => ({
                      ...current,
                      defaultCapacity: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <fieldset>
                <legend className="text-sm font-medium">Default amenities</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {amenityItems.map((amenity) => (
                    <label
                      key={amenity.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={roomTypeForm.amenities.includes(amenity.id)}
                        onChange={() =>
                          setRoomTypeForm((current) => ({
                            ...current,
                            amenities: toggleSelection(
                              current.amenities,
                              amenity.id,
                            ),
                          }))
                        }
                      />
                      {amenity.label}
                    </label>
                  ))}
                  {!amenityItems.length && (
                    <p className="text-sm text-slate-500">
                      Add amenities in Inventory to select them here.
                    </p>
                  )}
                </div>
              </fieldset>
              <fieldset disabled={mode === "api"}><RoomTypeInclusionsEditor configuration={configuration} value={roomTypeForm.defaultInclusions} onChange={(defaultInclusions) => setRoomTypeForm((current) => ({ ...current, defaultInclusions }))} /></fieldset>
              <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {editingRoomTypeId ? "Save room type" : "Add room type"}
              </button>
              <button disabled={mode === "api" && (!commands?.saveDefinition || commands.busy)}
                type="button"
                onClick={() => {
                  setEditingRoomTypeId(null);
                  setSelectedRoomTypeId(null);
                  setRoomTypeForm({
                    label: "",
                    defaultCapacity: "2", defaultInclusions: [],
                    amenities: [],
                  });
                  setRoomTypeFormVisible(false);
                }}
                className="ml-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
            </form>
            <p className="mt-4 text-xs text-slate-500">
              Configure inherited prices in Configuration. Room-level price overrides take precedence for the matching duration only.
            </p>
          </section>
          </div>
          )}
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {roomTypes.map((roomType) => {
              const assignedRooms = configuration.rooms.filter(
                (room) => room.roomTypeId === roomType.id,
              );
              const activeAssignments = assignedRooms.filter(
                (room) => room.enabled && !room.archived,
              );
              const usedByReservation = reservations.some((reservation) =>
                reservation.rooms.some(
                  (room) => room.roomTypeId === roomType.id,
                ),
              );
              return (
                <article
                  key={roomType.id}
                  tabIndex={0}
                  onClick={(event) => {
                    if (
                      event.target instanceof HTMLElement &&
                      event.target.closest("button, select, input, textarea, a")
                    ) {
                      return;
                    }
                    editRoomType(roomType);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.key === "Enter" || event.key === " ") &&
                      event.target === event.currentTarget
                    ) {
                      event.preventDefault();
                      editRoomType(roomType);
                    }
                  }}
                  className={`${cardClass} cursor-pointer transition hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    selectedRoomTypeId === roomType.id
                      ? "border-slate-700 ring-1 ring-slate-700"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold">{roomType.label}</h2>
                    {!roomType.enabled && (
                      <span className="text-xs text-slate-500">Archived</span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Capacity: {roomType.defaultCapacity}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Default amenities:{" "}
                    {roomType.amenities
                      .map((amenity) => amenityLabel(resolveAmenityId(amenity)))
                      .join(", ") || "None"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    Assigned rooms: {activeAssignments.length}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {roomType.enabled ? (
                      <button
                        type="button"
                        disabled={mode === "api" || activeAssignments.length > 0}
                        title={
                          activeAssignments.length > 0
                            ? "Reassign rooms before archiving this type."
                            : undefined
                        }
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            roomTypes: current.roomTypes.map((item) =>
                              item.id === roomType.id
                                ? { ...item, enabled: false, archived: true }
                                : item,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                      >
                        Archive
                      </button>
                    ) : (
                      <button disabled={mode === "api"}
                        type="button"
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            roomTypes: current.roomTypes.map((item) =>
                              item.id === roomType.id
                                ? { ...item, enabled: true, archived: false }
                                : item,
                            ),
                          }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
                      >
                        Restore
                      </button>
                    )}
                    {assignedRooms.length === 0 && !usedByReservation && (
                      <button disabled={mode === "api"}
                        type="button"
                        onClick={() =>
                          setConfiguration((current) => ({
                            ...current,
                            roomTypes: current.roomTypes.filter(
                              (item) => item.id !== roomType.id,
                            ),
                            roomTypePrices: current.roomTypePrices.filter(
                              (item) => item.roomTypeId !== roomType.id,
                            ),
                          }))
                        }
                        className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700"
                      >
                        Delete permanently
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
