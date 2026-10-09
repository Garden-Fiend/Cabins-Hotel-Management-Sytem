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
  } = useReservationDemo();
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoom);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [roomFormVisible, setRoomFormVisible] = useState(false);
  const [roomTypeForm, setRoomTypeForm] = useState<RoomTypeForm>({
    label: "",
    defaultCapacity: "2",
    amenities: [],
  });
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
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

  function saveRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const number = roomForm.number.trim();
    const activeRoomType = roomTypes.find(
      (item) => item.id === roomForm.roomTypeId && item.enabled,
    );
    const duplicate = configuration.rooms.some(
      (room) =>
        room.number.toLowerCase() === number.toLowerCase() &&
        room.id !== editingRoomId,
    );
    if (!number || !activeRoomType || duplicate) {
      setNotice(
        duplicate
          ? "A room with that number already exists."
          : "Enter a room number and select an active room type.",
      );
      return;
    }
    if (
      roomForm.capacityOverride &&
      (!Number.isInteger(Number(roomForm.capacityOverride)) ||
        Number(roomForm.capacityOverride) < 1)
    ) {
      setNotice("Room capacity overrides must be positive whole numbers.");
      return;
    }
    const current = editingRoomId
      ? configuration.rooms.find((item) => item.id === editingRoomId)
      : undefined;
    const next: RoomConfiguration = {
      id: current?.id ?? makeId("room", number),
      number,
      roomTypeId: activeRoomType.id,
      displayType: roomForm.displayType.trim() || activeRoomType.label,
      roomStatusId: roomForm.roomStatusId,
      enabled: current?.enabled ?? true,
      archived: current?.archived ?? false,
      housekeepingState: current?.housekeepingState ?? "clean",
      ...(roomForm.capacityOverride
        ? { capacityOverride: Number(roomForm.capacityOverride) }
        : {}),
      description: roomForm.description.trim(),
      amenitiesAdditions: roomForm.amenities.filter(
        (amenity) => !roomTypeDefaults(activeRoomType.id).includes(amenity),
      ),
      amenitiesRemovals: roomTypeDefaults(activeRoomType.id).filter(
        (amenity) => !roomForm.amenities.includes(amenity),
      ),
      operationalNotes: roomForm.operationalNotes.trim(),
      occupancyLockReservationId: current?.occupancyLockReservationId,
    };
    setConfiguration((currentConfig) => ({
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

  function setReadiness(roomId: string, state: HousekeepingState) {
    setConfiguration((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.id === roomId ? { ...room, housekeepingState: state } : room,
      ),
    }));
  }

  function saveRoomType(event: React.FormEvent<HTMLFormElement>) {
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
    const existing = roomTypes.find((item) => item.id === editingRoomTypeId);
    const next: RoomTypeConfiguration = {
      id: existing?.id ?? makeId("room-type", label),
      label,
      enabled: existing?.enabled ?? true,
      archived: existing?.archived ?? false,
      defaultCapacity,
      amenities: roomTypeForm.amenities,
    };
    setConfiguration((current) => ({
      ...current,
      roomTypes: current.roomTypes.some((item) => item.id === next.id)
        ? current.roomTypes.map((item) =>
            item.id === next.id ? next : item,
          )
        : [...current.roomTypes, next],
    }));
    setRoomTypeForm({ label: "", defaultCapacity: "2", amenities: [] });
    setEditingRoomTypeId(null);
    setSelectedRoomTypeId(null);
    setRoomTypeFormVisible(false);
    setNotice(`Room type ${label} saved.`);
  }

  function editRoomType(roomType: RoomTypeConfiguration) {
    setEditingRoomTypeId(roomType.id);
    setSelectedRoomTypeId(roomType.id);
    setRoomTypeFormVisible(true);
    setRoomTypeForm({
      label: roomType.label,
      defaultCapacity: String(roomType.defaultCapacity),
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
            <button
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
              <button
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
                    .filter((item) => item.enabled && !item.archived)
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
                <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                  {editingRoomId ? "Save room" : "Add room"}
                </button>
                <button
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
                        {roomType?.label ?? room.roomTypeId} · {room.displayType}
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
                      aria-label={`Room ${room.number} status`}
                      value={room.roomStatusId}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        setConfiguration((current) => ({
                          ...current,
                          rooms: current.rooms.map((item) =>
                            item.id === room.id
                              ? { ...item, roomStatusId: event.target.value }
                              : item,
                          ),
                        }))
                      }
                      className="rounded-full border-0 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 focus:ring-2 focus:ring-amber-500"
                    >
                      {configuration.roomStatuses.map((item) => (
                        <option key={item.id} value={item.id}>
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
                      disabled={room.housekeepingState === "cleaning" || Boolean(currentStay)}
                      onClick={() => setReadiness(room.id, "cleaning")}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40"
                    >
                      Start cleaning
                    </button>
                    <button
                      type="button"
                      disabled={room.housekeepingState === "clean" || Boolean(currentStay)}
                      onClick={() => setReadiness(room.id, "clean")}
                      className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40"
                    >
                      Mark Clean
                    </button>
                    {room.enabled && !room.archived ? (
                      <button
                        type="button"
                        disabled={reservations.some(
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
                      <button
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
                      <button
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
            <button
              type="button"
              onClick={() => {
                setEditingRoomTypeId(null);
                setSelectedRoomTypeId(null);
                setRoomTypeForm({
                  label: "",
                  defaultCapacity: "2",
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
                  defaultCapacity: "2",
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
              <button
                type="button"
                aria-label="Close room type form"
                onClick={() => {
                  setEditingRoomTypeId(null);
                  setSelectedRoomTypeId(null);
                  setRoomTypeForm({
                    label: "",
                    defaultCapacity: "2",
                    amenities: [],
                  });
                  setRoomTypeFormVisible(false);
                }}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold"
              >
                Close
              </button>
            </div>
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
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                {editingRoomTypeId ? "Save room type" : "Add room type"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingRoomTypeId(null);
                  setSelectedRoomTypeId(null);
                  setRoomTypeForm({
                    label: "",
                    defaultCapacity: "2",
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
                        disabled={activeAssignments.length > 0}
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
                      <button
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
                      <button
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
