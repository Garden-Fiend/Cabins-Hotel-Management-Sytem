import { useMemo, useState } from "react";

import { useHotelConfiguration } from "../features/configuration/useHotelConfiguration";
import type {
  HotelConfigurationData,
  ConfigurationValue,
  ConfigurationSection,
} from "../features/configuration/types";
import { configurationSections } from "../features/configuration/types";
import { isValidHotelTime } from "../lib/hotelTime";

type SectionKey = ConfigurationSection["id"];
type ConfigRow = Record<string, ConfigurationValue> & { id: string; enabled: boolean };
type FieldKind = "text" | "number" | "select" | "toggle" | "checkboxes";

interface FieldDefinition {
  key: string;
  label: string;
  kind?: FieldKind;
  options?: { value: string; label: string }[];
  visibleWhen?: { key: string; value: string };
}

const panelClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

function getRows(section: SectionKey, data: HotelConfigurationData): ConfigRow[] {
  const amenityId = (value: string) =>
    data.catalogItems.find(
      (item) =>
        item.category === "amenities" &&
        (item.id === value || item.label.toLowerCase() === value.toLowerCase()),
    )?.id ?? value;
  switch (section) {
    case "roomTypes":
      return data.roomTypes.map((item) => ({
        ...item,
        amenities: item.amenities.map(amenityId),
      }));
    case "rooms":
      return data.rooms.map((item) => ({
        id: item.id,
        number: item.number,
        roomTypeId: item.roomTypeId,
        displayType: item.displayType,
        roomStatusId: item.roomStatusId,
        enabled: item.enabled,
        archived: item.archived ?? false,
        housekeepingState: item.housekeepingState,
        capacityOverride: item.capacityOverride ?? "",
        description: item.description,
        amenities: [
          ...(data.roomTypes.find((type) => type.id === item.roomTypeId)
            ?.amenities.map(amenityId)
            .filter(
              (amenity) =>
                !item.amenitiesRemovals.map(amenityId).includes(amenity),
            ) ?? []),
          ...item.amenitiesAdditions.map(amenityId),
        ],
        operationalNotes: item.operationalNotes,
      }));
    case "durations":
      return data.durations.map((item) => ({ ...item }));
    case "bookingSources":
      return data.bookingSources.map((item) => ({ ...item }));
    case "catalogItems":
      return data.catalogItems.map((item) => ({ ...item }));
    case "roomTypePrices":
      return data.roomTypePrices.map((item) => ({ ...item }));
    case "discounts":
      return data.discounts.map((item) => ({ ...item }));
    case "roomStatuses":
      return data.roomStatuses.map((item) => ({ ...item }));
  }
}

function fieldsFor(
  section: SectionKey,
  data: HotelConfigurationData,
): FieldDefinition[] {
  const roomTypeOptions = data.roomTypes.map((item) => ({
    value: item.id,
    label: item.label,
  }));
  const durationOptions = data.durations.map((item) => ({
    value: item.id,
    label: item.label,
  }));
  const amenityOptions = data.catalogItems
    .filter(
      (item) =>
        item.category === "amenities" && item.enabled && !item.archived,
    )
    .map((item) => ({ value: item.id, label: item.label }));
  switch (section) {
    case "roomTypes":
      return [
        { key: "label", label: "Name" },
        { key: "defaultCapacity", label: "Default capacity", kind: "number" },
        { key: "amenities", label: "Default amenities", kind: "checkboxes", options: amenityOptions },
      ];
    case "bookingSources":
      return [{ key: "label", label: "Name" }];
    case "rooms":
      return [
        { key: "number", label: "Room number" },
        { key: "roomTypeId", label: "Room type", kind: "select", options: roomTypeOptions },
        { key: "displayType", label: "Display name" },
        { key: "capacityOverride", label: "Capacity override", kind: "number" },
        { key: "description", label: "Description" },
        { key: "amenities", label: "Room amenities", kind: "checkboxes", options: amenityOptions },
        { key: "operationalNotes", label: "Operational notes" },
        {
          key: "housekeepingState",
          label: "Housekeeping readiness",
          kind: "select",
          options: [
            { value: "clean", label: "Clean" },
            { value: "dirty", label: "Dirty" },
            { value: "cleaning", label: "Cleaning" },
          ],
        },
        {
          key: "roomStatusId",
          label: "Operational status",
          kind: "select",
          options: data.roomStatuses.map((item) => ({ value: item.id, label: item.label })),
        },
      ];
    case "durations":
      return [
        { key: "label", label: "Name" },
        { key: "minutes", label: "Duration in minutes", kind: "number" },
        {
          key: "bookingType",
          label: "Booking type",
          kind: "select",
          options: [
            { value: "hourly", label: "Hourly" },
            { value: "overnight", label: "Overnight" },
          ],
        },
        {
          key: "nights",
          label: "Number of nights",
          kind: "number",
          visibleWhen: { key: "bookingType", value: "overnight" },
        },
      ];
    case "catalogItems":
      return [
        { key: "label", label: "Name" },
        {
          key: "categoryId",
          label: "Category",
          kind: "select",
          options: data.inventoryCategories
            .filter((category) => category.enabled)
            .map((category) => ({ value: category.id, label: category.label })),
        },
        {
          key: "breakfastType",
          label: "Breakfast type (special category only)",
          kind: "select",
          options: [
            { value: "meal", label: "Meal" },
            { value: "beverage", label: "Beverage" },
          ],
        },
        { key: "price", label: "Unit price", kind: "number" },
      ];
    case "roomTypePrices":
      return [
        { key: "roomTypeId", label: "Room type", kind: "select", options: roomTypeOptions },
        {
          key: "bookingType",
          label: "Rate type",
          kind: "select",
          options: [
            { value: "hourly", label: "Hourly package" },
            { value: "overnight", label: "Nightly base rate" },
          ],
        },
        {
          key: "durationId",
          label: "Hourly package",
          kind: "select",
          options: durationOptions.filter(
            (duration) =>
              data.durations.some(
                (item) =>
                  item.id === duration.value &&
                  item.enabled &&
                  item.bookingType === "hourly",
              ),
          ),
          visibleWhen: { key: "bookingType", value: "hourly" },
        },
        { key: "amount", label: "Price", kind: "number" },
        { key: "currency", label: "Currency" },
      ];
    case "discounts":
      return [
        { key: "label", label: "Name" },
        {
          key: "method",
          label: "Method",
          kind: "select",
          options: [
            { value: "fixed", label: "Fixed amount" },
            { value: "percentage", label: "Percentage" },
          ],
        },
        { key: "value", label: "Value", kind: "number" },
        {
          key: "scope",
          label: "Applies to",
          kind: "select",
          options: [
            { value: "reservation", label: "Reservation" },
            { value: "room", label: "Room" },
            { value: "item", label: "Item" },
          ],
        },
      ];
    case "roomStatuses":
      return [{ key: "label", label: "Name" }];
  }
}

function defaultFields(section: SectionKey, data: HotelConfigurationData) {
  return {
    enabled: true,
    ...(section === "roomStatuses" ? { blocksReservation: true } : {}),
    ...(section === "roomTypePrices" ? { bookingType: "hourly" } : {}),
    ...(section === "rooms" ? { amenities: [], capacityOverride: "" } : {}),
    ...(section === "roomTypes" ? { amenities: [] } : {}),
    ...Object.fromEntries(
    fieldsFor(section, data).map((field) => {
      const value =
        field.kind === "checkboxes"
          ? []
          : field.options?.[0]?.value ?? (field.kind === "toggle" ? false : "");
      return [field.key, value];
    }),
    ),
  } as Record<string, ConfigurationValue>;
}

function stringValue(fields: Record<string, ConfigurationValue>, key: string) {
  return String(fields[key] ?? "").trim();
}

function stringArrayValue(
  fields: Record<string, ConfigurationValue>,
  key: string,
) {
  const value = fields[key];
  return Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function numberValue(fields: Record<string, ConfigurationValue>, key: string) {
  return Number(fields[key]);
}

function booleanValue(fields: Record<string, ConfigurationValue>, key: string) {
  return fields[key] === true || fields[key] === "true";
}

function replaceItem<T extends { id: string; enabled: boolean }>(
  items: T[],
  next: T,
) {
  const existing = items.some((item) => item.id === next.id);
  return existing
    ? items.map((item) => (item.id === next.id ? next : item))
    : [...items, next];
}

function makeId(section: SectionKey, fields: Record<string, ConfigurationValue>) {
  const category =
    section === "catalogItems"
      ? `${stringValue(fields, "categoryId")}-`
      : "";
  const value =
    stringValue(fields, "label") ||
    stringValue(fields, "number") ||
    (section === "roomTypePrices"
      ? `${stringValue(fields, "roomTypeId")}-${stringValue(fields, "bookingType")}${stringValue(fields, "durationId") ? `-${stringValue(fields, "durationId")}` : ""}`
      : `${stringValue(fields, "roomTypeId")}-${stringValue(fields, "durationId")}`);
  const slug = `${category}${value}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${section}-${slug || Date.now()}`;
}

export function ConfigurationPage() {
  const { configuration, setConfiguration } = useHotelConfiguration();
  const [activeSection, setActiveSection] = useState<SectionKey>("roomTypes");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, ConfigurationValue>>(
    () => defaultFields("roomTypes", configuration),
  );
  const [notice, setNotice] = useState("");
  const [defaultCheckInTime, setDefaultCheckInTime] = useState(
    configuration.defaultCheckInTime,
  );
  const [defaultCheckOutTime, setDefaultCheckOutTime] = useState(
    configuration.defaultCheckOutTime,
  );
  const [hotelCurrency, setHotelCurrency] = useState(configuration.currency);

  const activeMetadata = configurationSections.find(
    (item) => item.id === activeSection,
  )!;
  const currentFields = useMemo(
    () => fieldsFor(activeSection, configuration),
    [activeSection, configuration],
  );
  const visibleFields = currentFields.filter(
    (field) =>
      !field.visibleWhen ||
      stringValue(fields, field.visibleWhen.key) === field.visibleWhen.value,
  );
  const rows = getRows(activeSection, configuration);

  function selectSection(section: SectionKey) {
    setActiveSection(section);
    setEditingId(null);
    setFields(defaultFields(section, configuration));
    setNotice("");
  }

  function editRow(row: ConfigRow) {
    setEditingId(row.id);
    const editable = Object.fromEntries(
      currentFields.map((field) => [field.key, row[field.key] ?? ""]),
    );
    setFields({
      ...editable,
      enabled: row.enabled,
      ...(activeSection === "roomStatuses"
        ? { blocksReservation: row.blocksReservation }
        : {}),
    });
    setNotice("");
  }

  function persist(id: string, values: Record<string, ConfigurationValue>) {
    setConfiguration((current) => {
      switch (activeSection) {
        case "roomTypes":
          return {
            ...current,
            roomTypes: replaceItem(current.roomTypes, {
              id,
              label: stringValue(values, "label"),
              enabled: booleanValue(values, "enabled"),
              defaultCapacity: numberValue(values, "defaultCapacity"),
              amenities: stringArrayValue(values, "amenities"),
            }),
          };
        case "rooms":
          {
            const existingRoom = current.rooms.find((item) => item.id === id);
            const toAmenityId = (value: string) =>
              current.catalogItems.find(
                (item) =>
                  item.category === "amenities" &&
                  (item.id === value ||
                    item.label.toLowerCase() === value.toLowerCase()),
              )?.id ?? value;
            const inheritedAmenities =
              current.roomTypes
                .find(
                  (roomType) =>
                    roomType.id === stringValue(values, "roomTypeId"),
                )
                ?.amenities.map(toAmenityId) ?? [];
            const selectedAmenities = stringArrayValue(
              values,
              "amenities",
            ).map(toAmenityId);
            return {
              ...current,
              rooms: replaceItem(current.rooms, {
                id,
                number: stringValue(values, "number"),
                roomTypeId: stringValue(values, "roomTypeId"),
                displayType: stringValue(values, "displayType"),
                roomStatusId: stringValue(values, "roomStatusId"),
                enabled: booleanValue(values, "enabled"),
                archived: booleanValue(values, "archived"),
                housekeepingState: stringValue(values, "housekeepingState") as "clean" | "dirty" | "cleaning",
                capacityOverride:
                  stringValue(values, "capacityOverride") === ""
                    ? undefined
                    : numberValue(values, "capacityOverride"),
                description: stringValue(values, "description"),
                amenitiesAdditions: selectedAmenities.filter(
                  (item) => !inheritedAmenities.includes(item),
                ),
                amenitiesRemovals: inheritedAmenities.filter(
                  (item) => !selectedAmenities.includes(item),
                ),
                operationalNotes: stringValue(values, "operationalNotes"),
                occupancyLockReservationId: existingRoom?.occupancyLockReservationId,
              }),
            };
          }
        case "durations":
          return {
            ...current,
            durations: replaceItem(current.durations, {
              id,
              label: stringValue(values, "label"),
              minutes: numberValue(values, "minutes"),
              enabled: booleanValue(values, "enabled"),
              bookingType: stringValue(values, "bookingType") as "hourly" | "overnight",
              ...(stringValue(values, "bookingType") === "overnight"
                ? { nights: numberValue(values, "nights") }
                : {}),
            }),
          };
        case "bookingSources":
          return {
            ...current,
            bookingSources: replaceItem(current.bookingSources, {
              id,
              label: stringValue(values, "label"),
              enabled: booleanValue(values, "enabled"),
            }),
          };
        case "catalogItems": {
          const category = current.inventoryCategories.find(
            (item) => item.id === stringValue(values, "categoryId"),
          );
          const productCategory = category?.type ?? "ordinary";
          return {
            ...current,
            catalogItems: replaceItem(current.catalogItems, {
              id,
              label: stringValue(values, "label"),
              category: productCategory,
              categoryId: category?.id ?? "",
              ...(productCategory === "breakfast"
                ? { breakfastType: stringValue(values, "breakfastType") as "meal" | "beverage" }
                : {}),
              price:
                productCategory === "breakfast" ||
                productCategory === "amenities"
                  ? 0
                  : numberValue(values, "price"),
              enabled: booleanValue(values, "enabled"),
            }),
          };
        }
        case "roomTypePrices":
          return {
            ...current,
            roomTypePrices: replaceItem(current.roomTypePrices, {
              id,
              roomTypeId: stringValue(values, "roomTypeId"),
              bookingType: stringValue(values, "bookingType") as "hourly" | "overnight",
              ...(stringValue(values, "bookingType") === "hourly"
                ? { durationId: stringValue(values, "durationId") }
                : {}),
              amount: numberValue(values, "amount"),
              currency: stringValue(values, "currency").toUpperCase(),
              enabled: booleanValue(values, "enabled"),
            }),
          };
        case "discounts":
          return {
            ...current,
            discounts: replaceItem(current.discounts, {
              id,
              label: stringValue(values, "label"),
              method: stringValue(values, "method") as "fixed" | "percentage",
              value: numberValue(values, "value"),
              scope: stringValue(values, "scope") as "reservation" | "room" | "item",
              enabled: booleanValue(values, "enabled"),
            }),
          };
        case "roomStatuses":
          return {
            ...current,
            roomStatuses: replaceItem(current.roomStatuses, {
              id,
              label: stringValue(values, "label"),
              blocksReservation: booleanValue(values, "blocksReservation"),
              enabled: booleanValue(values, "enabled"),
            }),
          };
        default:
          return current;
      }
    });
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label =
      stringValue(fields, "label") ||
      stringValue(fields, "number") ||
      `${stringValue(fields, "roomTypeId")} ${stringValue(fields, "durationId")}`;
    const optionalKeys = new Set(["capacityOverride", "description", "amenities", "operationalNotes"]);
    const requiredFields = visibleFields.filter(
      (field) =>
        field.kind !== "toggle" &&
        field.kind !== "checkboxes" &&
        !optionalKeys.has(field.key),
    );
    if (requiredFields.some((field) => !stringValue(fields, field.key))) {
      setNotice("Complete all required fields before saving.");
      return;
    }
    if (
      visibleFields.some(
        (field) =>
          field.kind === "number" &&
          (!Number.isFinite(numberValue(fields, field.key)) ||
            numberValue(fields, field.key) < 0),
      )
    ) {
      setNotice("Numeric values must be zero or greater.");
      return;
    }
    if (
      activeSection === "roomTypePrices" &&
      !/^[A-Z]{3}$/.test(stringValue(fields, "currency").toUpperCase())
    ) {
      setNotice("Currency must be a three-letter ISO code, such as PHP.");
      return;
    }
    if (
      activeSection === "durations" &&
      numberValue(fields, "minutes") <= 0
    ) {
      setNotice("Duration must be greater than zero minutes.");
      return;
    }
    if (
      activeSection === "durations" &&
      stringValue(fields, "bookingType") === "overnight" &&
      (!Number.isInteger(numberValue(fields, "nights")) ||
        numberValue(fields, "nights") < 1)
    ) {
      setNotice("Overnight durations must specify a positive whole number of nights.");
      return;
    }
    if (
      activeSection === "discounts" &&
      stringValue(fields, "method") === "percentage" &&
      numberValue(fields, "value") > 100
    ) {
      setNotice("Percentage discounts cannot exceed 100%.");
      return;
    }
    if (
      visibleFields.some((field) => field.key === "label") &&
      getRows(activeSection, configuration).some((row) => {
        const sameLabel =
          String(row.label).trim().toLowerCase() ===
          stringValue(fields, "label").toLowerCase();
        const sameCategory =
          !("category" in row) ||
          row.category === stringValue(fields, "category");
        return sameLabel && sameCategory && row.id !== editingId;
      })
    ) {
      setNotice("An entry with this name already exists in this category.");
      return;
    }
    if (
      activeSection === "rooms" &&
      configuration.rooms.some(
        (item) =>
          item.number.toLowerCase() ===
            stringValue(fields, "number").toLowerCase() &&
          item.id !== editingId,
      )
    ) {
      setNotice("A room with this number already exists.");
      return;
    }
    if (
      activeSection === "roomTypes" &&
      !booleanValue(fields, "enabled") &&
      configuration.rooms.some(
        (room) =>
          room.roomTypeId === editingId &&
          room.enabled &&
          !room.archived,
      )
    ) {
      setNotice("Reassign or archive rooms before disabling this room type.");
      return;
    }
    if (
      activeSection === "rooms" &&
      stringValue(fields, "capacityOverride") &&
      (!Number.isInteger(numberValue(fields, "capacityOverride")) ||
        numberValue(fields, "capacityOverride") < 1)
    ) {
      setNotice("Room capacity overrides must be positive whole numbers.");
      return;
    }
    if (
      activeSection === "roomTypePrices" &&
      configuration.roomTypePrices.some(
        (item) =>
          item.roomTypeId === stringValue(fields, "roomTypeId") &&
          item.bookingType === stringValue(fields, "bookingType") &&
          (item.bookingType === "overnight" ||
            item.durationId === stringValue(fields, "durationId")) &&
          item.id !== editingId,
      )
    ) {
      setNotice("A price already exists for this room type and pricing package.");
      return;
    }
    if (
      activeSection === "roomTypePrices" &&
      configuration.roomTypePrices.some(
        (item) =>
          item.currency !== stringValue(fields, "currency").toUpperCase() &&
          item.id !== editingId,
      )
    ) {
      setNotice("All room rates must use the same hotel currency.");
      return;
    }
    const id = editingId ?? makeId(activeSection, fields);
    persist(id, { ...fields, enabled: fields.enabled ?? true });
    setEditingId(null);
    setFields(defaultFields(activeSection, configuration));
    setNotice(`${label || "Configuration"} saved for this session.`);
  }

  function toggleRow(row: ConfigRow) {
    if (
      activeSection === "roomTypes" &&
      row.enabled &&
      configuration.rooms.some(
        (room) =>
          room.roomTypeId === row.id &&
          room.enabled &&
          !room.archived,
      )
    ) {
      setNotice("Reassign or archive rooms before disabling this room type.");
      return;
    }
    persist(row.id, { ...row, enabled: !row.enabled });
    setNotice(`${String(row.label ?? row.number ?? row.id)} updated.`);
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Administration
        </p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">Configuration</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Manage the hotel options used by room inventory and reservation workflows.
          Changes are held in memory for this session; historical reservations keep
          their captured values.
        </p>
      </header>

      <section className={panelClass}>
        <h2 className="text-base font-semibold text-slate-900">
          Default stay times
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Used for new overnight reservations. Existing reservations keep their saved timestamps.
          All dates and times use Asia/Manila.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-slate-700">
            <span className="mb-1 block">Default check-in</span>
            <input
              type="time"
              className={inputClass}
              value={defaultCheckInTime}
              onChange={(event) => setDefaultCheckInTime(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            <span className="mb-1 block">Default checkout</span>
            <input
              type="time"
              className={inputClass}
              value={defaultCheckOutTime}
              onChange={(event) => setDefaultCheckOutTime(event.target.value)}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            <span className="mb-1 block">Hotel currency</span>
            <input
              type="text"
              maxLength={3}
              className={`${inputClass} uppercase`}
              value={hotelCurrency}
              onChange={(event) => setHotelCurrency(event.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (
                !isValidHotelTime(defaultCheckInTime) ||
                !isValidHotelTime(defaultCheckOutTime) ||
                !/^[A-Z]{3}$/.test(hotelCurrency)
              ) {
                setNotice("Enter valid hotel times and a three-letter currency code.");
                return;
              }
              setConfiguration((current) => ({
                ...current,
                defaultCheckInTime,
                defaultCheckOutTime,
                currency: hotelCurrency,
                roomTypePrices: current.roomTypePrices.map((price) => ({
                  ...price,
                  currency: hotelCurrency,
                })),
              }));
              setNotice("Hotel defaults and currency updated for this session.");
            }}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Save hotel settings
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(14rem,0.65fr)_minmax(0,2fr)]">
        <nav aria-label="Configuration categories" className={`${panelClass} h-fit`}>
          <div className="space-y-5">
            {(["Rooms & Inventory", "Booking", "Catalog", "Pricing", "Operations"] as const).map(
              (group) => (
                <section key={group}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {group}
                  </h2>
                  <div className="space-y-1">
                    {configurationSections
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => selectSection(item.id)}
                          className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${
                            activeSection === item.id
                              ? "bg-slate-900 text-white"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                  </div>
                </section>
              ),
            )}
          </div>
        </nav>

        <div className="space-y-5">
          <section className={panelClass}>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {activeMetadata.label}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {activeMetadata.description}
              </p>
            </div>

            {notice && (
              <p role="status" className="mb-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                {notice}
              </p>
            )}

            <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
              {visibleFields.map((field) => (
                <div key={field.key} className="block text-sm font-medium text-slate-700">
                  <span className="mb-1.5 block">{field.label}</span>
                  {field.kind === "toggle" ? (
                    <input
                      aria-label={field.label}
                      type="checkbox"
                      checked={booleanValue(fields, field.key)}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          [field.key]: event.target.checked,
                        }))
                      }
                    />
                  ) : field.kind === "checkboxes" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(field.options ?? []).map((option) => {
                        const selected = stringArrayValue(fields, field.key);
                        return (
                          <label
                            key={option.value}
                            className="flex items-center gap-2"
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(option.value)}
                              onChange={() =>
                                setFields((current) => ({
                                  ...current,
                                  [field.key]: selected.includes(option.value)
                                    ? selected.filter(
                                        (value) => value !== option.value,
                                      )
                                    : [...selected, option.value],
                                }))
                              }
                            />
                            {option.label}
                          </label>
                        );
                      })}
                      {!(field.options?.length) && (
                        <p className="text-sm font-normal text-slate-500">
                          Add amenity items in Inventory to select them here.
                        </p>
                      )}
                    </div>
                  ) : field.kind === "select" ? (
                    <select
                      aria-label={field.label}
                      className={inputClass}
                      value={String(fields[field.key] ?? "")}
                      onChange={(event) =>
                        setFields((current) => {
                          const value = event.target.value;
                          return {
                            ...current,
                            [field.key]: value,
                            ...(activeSection === "roomTypePrices" &&
                            field.key === "bookingType"
                              ? {
                                  durationId:
                                    value === "hourly"
                                      ? configuration.durations.find(
                                          (duration) =>
                                            duration.bookingType === "hourly",
                                        )?.id ?? ""
                                      : "",
                                }
                              : {}),
                          };
                        })
                      }
                    >
                      {field.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.label}
                      className={inputClass}
                      type={field.kind === "number" ? "number" : "text"}
                      min={field.kind === "number" ? 0 : undefined}
                      step={field.kind === "number" ? "any" : undefined}
                      required
                      value={String(fields[field.key] ?? "")}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          [field.key]:
                            field.kind === "number"
                              ? event.target.value === ""
                                ? ""
                                : Number(event.target.value)
                              : event.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
              <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={booleanValue(fields, "enabled")}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                Enabled
              </label>
              {activeSection === "roomStatuses" && (
                <p className="self-end pb-2 text-xs text-slate-500">
                  Reservation blocking behavior is application-defined.
                </p>
              )}
              <div className="flex items-center gap-2 sm:col-span-2">
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  {editingId ? "Save changes" : "Add configuration"}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setFields(defaultFields(activeSection, configuration));
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                  >
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className={`${panelClass} overflow-x-auto`}>
            <h2 className="mb-4 text-base font-semibold text-slate-900">
              Current {activeMetadata.label.toLowerCase()}
            </h2>
            <table className="w-full min-w-[38rem] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Configuration</th>
                  <th className="px-3 py-2">Details</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const title = String(row.label ?? row.number ?? row.id);
                  const details = visibleFields
                    .filter((field) => field.key !== "label")
                    .map((field) => {
                      const optionLabel = field.options?.find(
                        (option) => option.value === String(row[field.key]),
                      )?.label;
                      const value = row[field.key];
                      return `${field.label}: ${
                        typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : optionLabel ?? String(value ?? "")
                      }`;
                    })
                    .join(" · ");
                  const detailsWithStatus =
                    activeSection === "roomStatuses"
                      ? [
                          details,
                          `Blocks reservations: ${row.blocksReservation ? "Yes" : "No"}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : details;
                  return (
                    <tr key={row.id}>
                      <td className="px-3 py-3 font-medium text-slate-900">{title}</td>
                      <td className="px-3 py-3 text-slate-600">{detailsWithStatus || "—"}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          row.enabled ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                        }`}>
                          {row.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex gap-3">
                          <button
                            type="button"
                            onClick={() => editRow(row)}
                            className="font-semibold text-slate-700 underline underline-offset-2"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleRow(row)}
                            className="font-semibold text-slate-700 underline underline-offset-2"
                          >
                            {row.enabled ? "Disable" : "Enable"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
