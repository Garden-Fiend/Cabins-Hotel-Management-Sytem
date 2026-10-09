import { useCallback, useState } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useHotelConfiguration } from "../../features/configuration/useHotelConfiguration";
import type { HotelConfigurationData } from "../../features/configuration/types";
import { calculateReservationPrice } from "../../lib/reservationPricing";
import { getRoomAccommodationPrice } from "../../lib/roomPricing";
import { calculateTax } from "../../lib/tax";
import {
  addHotelDays,
  createHotelDateTime,
  formatHotelDate,
  hotelDateAtTime,
  hotelDateKey,
  parseHotelDateTimeInput,
  toHotelDateTimeInput,
} from "../../lib/hotelTime";
import { findClash } from "../../utils/availability";
import { buildReservationPriceLines } from "../../lib/reservationDraftPricing";
import { capturePreset, getApplicablePresets, isAppliedPresetCompatible } from "../../lib/discountPresets";
import { LineDiscountSelector } from "./LineDiscountSelector";
import type { Stay } from "../../types/booking";
import type {
  DiscountMethod,
  DiscountScope,
  ReservationGuest,
  ReservationAuditEntry,
  ReservationDiscount,
  ReservationPriceLine,
  ReservationRoomOption,
  ReservationSnapshot,
} from "../../types/reservation";

interface ReservationPaneProps {
  stays: Stay[];
  guests: ReservationGuest[];
  initialCheckIn: Date;
  initialRoom?: string;
  initialReservation?: ReservationSnapshot;
  onClose: () => void;
  onCreated: (reservation: ReservationSnapshot, stays: Stay[]) => void;
  onSaved?: (reservation: ReservationSnapshot, stays: Stay[]) => void;
  onCancelReservation?: (
    reservationId: string,
    guestHasVacated: boolean,
  ) => void;
  onGuestCreated: (guest: ReservationGuest) => void;
  onDraftContextChange?: (
    contexts: { roomId: string; start: Date; end: Date }[],
  ) => void;
}

interface ChargeDraft {
  id: string;
  catalogId: string;
  label: string;
  quantity: number;
  unitPrice: number;
}

interface BreakfastDraft {
  status: "included" | "skipped";
  meal: string;
  drink: string;
}

interface RoomDraft {
  roomNumber: string;
  roomTypeId: string;
  roomType: string;
  useReservationStay: boolean;
  checkIn: string;
  durationId: string;
  adults: number;
  children: number;
  capturedRoomPrice: number;
  capturedCurrency: string;
  priceLocked: boolean;
  capturedUnitPrice?: number;
  capturedPricingQuantity?: number;
  capturedRateId?: string;
  inclusions: Record<string, number>;
  charges: ChargeDraft[];
  breakfast: Record<string, BreakfastDraft>;
}

interface AdjustmentDraft {
  id: string;
  amount: number;
  reason: string;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";
const sectionClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
const roomSectionClass = "rounded-lg border border-slate-200 bg-white p-3";

function ReservationStageHeading({ step, title }: { step: number; title: string }) {
  return (
    <h3 aria-label={`${step}. ${title}`} className="flex items-center gap-3 text-base font-semibold text-slate-900">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
        {step}
      </span>
      {title}
    </h3>
  );
}

function toDateTimeInput(date: Date) {
  return toHotelDateTimeInput(date);
}

function parseDateTimeInput(value: string) {
  return parseHotelDateTimeInput(value);
}

function getDuration(
  id: string,
  durations: HotelConfigurationData["durations"],
) {
  return durations.find((duration) => duration.id === id);
}

function getStayEnd(
  checkInInput: string,
  durationId: string,
  durations: HotelConfigurationData["durations"],
  defaultCheckOutTime: string,
) {
  const start = parseDateTimeInput(checkInInput);
  const duration = getDuration(durationId, durations);
  if (duration?.bookingType === "overnight") {
    return hotelDateAtTime(
      addHotelDays(start, duration.nights ?? 0),
      defaultCheckOutTime,
    );
  }
  return new Date(start.getTime() + (duration?.minutes ?? 0) * 60_000);
}

function formatDateTime(date: Date) {
  return formatHotelDate(date, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatMoney(amount: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getBreakfastDates(checkIn: Date, checkOut: Date) {
  const dates: Date[] = [];
  const start = addHotelDays(checkIn, 1);
  let date = createHotelDateTime(
    Number(hotelDateKey(start).slice(0, 4)),
    Number(hotelDateKey(start).slice(5, 7)),
    Number(hotelDateKey(start).slice(8, 10)),
  );

  while (date.getTime() < checkOut.getTime()) {
    dates.push(date);
    date = addHotelDays(date, 1);
  }

  return dates;
}

function getBreakfastKey(date: Date, guestIndex: number) {
  return `${hotelDateKey(date)}:${guestIndex}`;
}

function groupRoomsByType(rooms: ReservationRoomOption[]) {
  return rooms.reduce<Record<string, ReservationRoomOption[]>>(
    (groups, room) => {
      (groups[room.type] ??= []).push(room);
      return groups;
    },
    {},
  );
}

function isOperationallyAvailable(
  roomNumber: string,
  configuration: HotelConfigurationData,
) {
  const room = configuration.rooms.find((item) => item.number === roomNumber);
  const roomType = configuration.roomTypes.find(
    (item) => item.id === room?.roomTypeId,
  );
  const status = configuration.roomStatuses.find(
    (item) => item.id === room?.roomStatusId,
  );
  return Boolean(
    room?.enabled &&
      roomType?.enabled &&
      status?.enabled &&
      !status.blocksReservation,
  );
}

function buildAuditEntries(
  previous: ReservationSnapshot | undefined,
  next: ReservationSnapshot,
  occurredAt: Date,
): ReservationAuditEntry[] {
  const entries: ReservationAuditEntry[] = [];
  const add = (
    eventType: ReservationAuditEntry["eventType"],
    action: string,
    before?: unknown,
    after?: unknown,
  ) => {
    entries.push({
      eventType,
      action,
      occurredAt,
      actor: "Local demo user",
      ...(before === undefined ? {} : { before: JSON.stringify(before) }),
      ...(after === undefined ? {} : { after: JSON.stringify(after) }),
    });
  };

  if (!previous) {
    add("created", "Reservation created", undefined, next.id);
    next.rooms.forEach((room) => {
      add("room_added", `Room ${room.roomNumber} added`, undefined, room);
      add(
        "price_changed",
        `Captured price recorded for Room ${room.roomNumber}`,
        undefined,
        room.capturedRoomPrice,
      );
      if (room.inclusions.length) {
        add(
          "inclusion_changed",
          `Inclusions added for Room ${room.roomNumber}`,
          undefined,
          room.inclusions,
        );
      }
      if (room.charges.length) {
        add(
          "extra_changed",
          `Extras added for Room ${room.roomNumber}`,
          undefined,
          room.charges,
        );
      }
      if (room.breakfast.length) {
        add(
          "breakfast_changed",
          `Breakfast selections added for Room ${room.roomNumber}`,
          undefined,
          room.breakfast,
        );
      }
    });
    next.discounts.forEach((discount) =>
      add("discount_changed", `Discount added: ${discount.label}`, undefined, discount),
    );
    next.adjustments.forEach((adjustment) =>
      add("adjustment_changed", `Adjustment added: ${adjustment.reason}`, undefined, adjustment),
    );
    return entries;
  }

  if (previous.guestId !== next.guestId) {
    add("guest_changed", "Primary guest changed", previous.guestId, next.guestId);
  }
  if (
    previous.bookingSourceId !== next.bookingSourceId ||
    previous.bookingSourceLabel !== next.bookingSourceLabel
  ) {
    add("booking_source_changed", "Booking source changed", previous.bookingSourceLabel, next.bookingSourceLabel);
  }
  const oldRooms = new Map(previous.rooms.map((room) => [room.roomNumber, room]));
  const newRooms = new Map(next.rooms.map((room) => [room.roomNumber, room]));
  for (const [roomNumber, oldRoom] of oldRooms) {
    const updated = newRooms.get(roomNumber);
    if (!updated) {
      add("room_removed", `Room ${roomNumber} removed`, oldRoom, undefined);
      continue;
    }
    if (
      oldRoom.checkIn.getTime() !== updated.checkIn.getTime() ||
      oldRoom.checkOut.getTime() !== updated.checkOut.getTime() ||
      oldRoom.durationId !== updated.durationId
    ) {
      add("stay_changed", `Stay changed for Room ${roomNumber}`, oldRoom, updated);
    }
    if (
      oldRoom.adults !== updated.adults ||
      oldRoom.children !== updated.children
    ) {
      add(
        "occupancy_changed",
        `Occupancy changed for Room ${roomNumber}`,
        { adults: oldRoom.adults, children: oldRoom.children },
        { adults: updated.adults, children: updated.children },
      );
    }
    if (oldRoom.capturedRoomPrice !== updated.capturedRoomPrice) {
      add("price_changed", `Captured price changed for Room ${roomNumber}`, oldRoom.capturedRoomPrice, updated.capturedRoomPrice);
    }
    if (JSON.stringify(oldRoom.breakfast) !== JSON.stringify(updated.breakfast)) {
      add("breakfast_changed", `Breakfast changed for Room ${roomNumber}`, oldRoom.breakfast, updated.breakfast);
    }
      if (JSON.stringify(oldRoom.inclusions) !== JSON.stringify(updated.inclusions)) {
        add("inclusion_changed", `Inclusions changed for Room ${roomNumber}`, oldRoom.inclusions, updated.inclusions);
      }
    if (JSON.stringify(oldRoom.charges) !== JSON.stringify(updated.charges)) {
      add("extra_changed", `Extras changed for Room ${roomNumber}`, oldRoom.charges, updated.charges);
    }
  }
  for (const [roomNumber, added] of newRooms) {
    if (!oldRooms.has(roomNumber)) {
      add("room_added", `Room ${roomNumber} added`, undefined, added);
      add(
        "price_changed",
        `Captured price recorded for Room ${roomNumber}`,
        undefined,
        added.capturedRoomPrice,
      );
    }
  }
  if (JSON.stringify(previous.discounts) !== JSON.stringify(next.discounts)) {
    add("discount_changed", "Discounts changed", previous.discounts, next.discounts);
  }
  if (JSON.stringify(previous.adjustments) !== JSON.stringify(next.adjustments)) {
    add("adjustment_changed", "Manual adjustments changed", previous.adjustments, next.adjustments);
  }
  if (previous.note !== next.note) {
    add("updated", "Reservation note updated", previous.note, next.note);
  }
  return entries;
}

export function ReservationPane({
  stays,
  guests,
  initialCheckIn,
  initialRoom,
  initialReservation,
  onClose,
  onCreated,
  onSaved,
  onCancelReservation,
  onGuestCreated,
  onDraftContextChange,
}: ReservationPaneProps) {
  const { configuration } = useHotelConfiguration();
  const reservationDurations = configuration.durations;
  const activeRoomTypeIds = new Set(
    configuration.roomTypes
      .filter((roomType) => roomType.enabled && !roomType.archived)
      .map((roomType) => roomType.id),
  );
  const reservationRooms: ReservationRoomOption[] = configuration.rooms
    .filter(
      (room) =>
        room.enabled &&
        !room.archived &&
        activeRoomTypeIds.has(room.roomTypeId),
    )
    .map((room) => ({
      number: room.number,
      roomTypeId: room.roomTypeId,
      type:
        configuration.roomTypes.find((type) => type.id === room.roomTypeId)
          ?.label ?? room.roomTypeId,
    }));
  const reservationCurrency = configuration.currency;
  const formatReservationMoney = (amount: number, currency = reservationCurrency) =>
    formatMoney(amount, currency);
  const reservationInclusions = configuration.catalogItems.filter(
    (item) => item.category === "inclusion" && item.enabled && !item.archived,
  );
  const reservationExtraCharges = configuration.catalogItems.filter(
    (item) => (item.category === "extra" || item.category === "ordinary") && item.enabled && !item.archived,
  );
  const breakfastMeals = configuration.catalogItems.filter(
    (item) => item.category === "breakfast" && item.breakfastType === "meal",
  );
  const breakfastDrinks = configuration.catalogItems.filter(
    (item) => item.category === "breakfast" && item.breakfastType === "beverage",
  );
  const bookingSources = configuration.bookingSources;
  const configuredRoomPrice = (roomTypeId: string, durationId: string) =>
    getRoomAccommodationPrice(configuration, roomTypeId, durationId)?.amount;
  const configuredRoomCurrency = (roomTypeId: string, durationId: string) =>
    getRoomAccommodationPrice(configuration, roomTypeId, durationId)?.currency ??
    reservationCurrency;
  const availableDurationOptions = reservationDurations.filter(
    (duration) => duration.enabled,
  );
  const historicalDurationOptions = (initialReservation?.rooms ?? [])
    .filter(
      (room) =>
        !availableDurationOptions.some(
          (duration) => duration.id === room.durationId,
        ),
    )
    .map((room) => {
      const savedDefinition = reservationDurations.find(
        (duration) => duration.id === room.durationId,
      );
      return {
        id: room.durationId,
        label: savedDefinition?.label ?? "Inactive historical duration",
        minutes:
          savedDefinition?.minutes ??
          Math.round(
            (room.checkOut.getTime() - room.checkIn.getTime()) / 60_000,
          ),
        bookingType:
          savedDefinition?.bookingType ??
          ((room.checkOut.getTime() - room.checkIn.getTime()) / 60_000 >=
          1440
            ? "overnight"
            : "hourly"),
        enabled: false,
      };
    })
    .filter(
      (duration, index, all) =>
        all.findIndex((item) => item.id === duration.id) === index,
    );
  const availableDurations = [
    ...availableDurationOptions,
    ...historicalDurationOptions,
  ];
  const getConfiguredDuration = (id: string) =>
    getDuration(id, availableDurations);
  const enabledRooms = reservationRooms.filter((room) =>
    isOperationallyAvailable(room.number, configuration),
  );
  const canRetainAssignedRoom = (roomNumber: string) =>
    Boolean(
      initialReservation?.rooms.some(
        (room) => room.roomNumber === roomNumber,
      ),
    );
  const defaultDurationId =
    availableDurationOptions[0]?.id ?? reservationDurations[0]?.id ?? "";
  const paneRef = useRef<HTMLElement>(null);
  const reservationScrollRef = useRef<HTMLDivElement>(null);
  const roomsStageRef = useRef<HTMLElement>(null);
  const scrollToRoomsAfterCollapseRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const existingReservationId = initialReservation?.id;
  const initialDurationId = initialReservation
    ? (() => {
        const duration =
          initialReservation.checkOut.getTime() -
          initialReservation.checkIn.getTime();
        const exact = availableDurations.find(
          (option) => option.minutes * 60_000 === duration,
        );
        const firstRoom = initialReservation.rooms[0];
        const firstRoomMatchesReservation =
          firstRoom?.checkIn.getTime() ===
            initialReservation.checkIn.getTime() &&
          firstRoom.checkOut.getTime() ===
            initialReservation.checkOut.getTime();
        return (
          (firstRoomMatchesReservation ? firstRoom?.durationId : undefined) ??
          exact?.id ??
          firstRoom?.durationId ??
          defaultDurationId
        );
      })()
    : defaultDurationId;
  const [guestQuery, setGuestQuery] = useState("");
  const [guestId, setGuestId] = useState(initialReservation?.guestId ?? "");
  const guest = guests.find((option) => option.id === guestId) ?? null;
  const [showCreateGuest, setShowCreateGuest] = useState(false);
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [newGuestEmail, setNewGuestEmail] = useState("");
  const [checkInInput, setCheckInInput] = useState(
    toDateTimeInput(initialReservation?.checkIn ?? initialCheckIn),
  );
  const [durationId, setDurationId] = useState(initialDurationId);
  const [roomDrafts, setRoomDrafts] = useState<RoomDraft[]>(() => {
    if (initialReservation) {
      return initialReservation.rooms.map((savedRoom) => ({
        roomNumber: savedRoom.roomNumber,
        roomTypeId: savedRoom.roomTypeId,
        roomType: savedRoom.roomType,
        useReservationStay:
          savedRoom.checkIn.getTime() ===
            initialReservation.checkIn.getTime() &&
          savedRoom.checkOut.getTime() ===
            initialReservation.checkOut.getTime(),
        checkIn: toDateTimeInput(savedRoom.checkIn),
        durationId: savedRoom.durationId,
        adults: savedRoom.adults,
        children: savedRoom.children,
        capturedRoomPrice: savedRoom.capturedRoomPrice,
        capturedCurrency: savedRoom.capturedCurrency,
        priceLocked: true,
        capturedUnitPrice: savedRoom.capturedUnitPrice,
        capturedPricingQuantity: savedRoom.capturedPricingQuantity,
        capturedRateId: savedRoom.capturedRateId,
        inclusions: Object.fromEntries(
          savedRoom.inclusions.map((item) => [item.catalogId, item.quantity]),
        ),
        charges: savedRoom.charges.map((charge) => ({ ...charge })),
        breakfast: Object.fromEntries(
          savedRoom.breakfast.map((breakfast) => [
            `${breakfast.stayDate}:${breakfast.guestNumber - 1}`,
            {
              status: breakfast.status,
              meal: breakfast.mealId ?? breakfast.mealLabel ?? "",
              drink: breakfast.beverageId ?? breakfast.beverageLabel ?? "",
            },
          ]),
        ),
      }));
    }

    const room = reservationRooms.find((option) => option.number === initialRoom);

    return room
      ? [
          {
            roomNumber: room.number,
            roomTypeId: room.roomTypeId,
            roomType: room.type,
            useReservationStay: true,
            checkIn: toDateTimeInput(initialCheckIn),
            durationId: defaultDurationId,
            capturedRoomPrice: configuredRoomPrice(
              room.roomTypeId,
              defaultDurationId,
            ) ?? 0,
            capturedCurrency: configuredRoomCurrency(
              room.roomTypeId,
              defaultDurationId,
            ),
            priceLocked: false,
            adults: 2,
            children: 0,
            inclusions: {},
            charges: [],
            breakfast: {},
          },
        ]
      : [];
  });
  const [selectedRoomNumber, setSelectedRoomNumber] = useState("");
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (expandedRoom !== null || !scrollToRoomsAfterCollapseRef.current) return;
    scrollToRoomsAfterCollapseRef.current = false;
    const container = reservationScrollRef.current;
    const stage = roomsStageRef.current;
    if (!container || !stage) return;
    container.scrollTo?.({
      top: Math.max(0, container.scrollTop + stage.getBoundingClientRect().top - container.getBoundingClientRect().top - 20),
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
    });
  }, [expandedRoom]);
  const [bookingSource, setBookingSource] = useState(
    initialReservation?.bookingSourceId ?? "",
  );
  const [note, setNote] = useState(initialReservation?.note ?? "");
  const [discounts, setDiscounts] = useState<ReservationDiscount[]>(
    initialReservation?.discounts.map((discount) => ({ ...discount })) ?? [],
  );
  const [adjustments, setAdjustments] = useState<AdjustmentDraft[]>(
    initialReservation?.adjustments.map((adjustment) => ({ ...adjustment })) ??
      [],
  );
  const [discountScope, setDiscountScope] =
    useState<DiscountScope>("reservation");
  const [discountMethod, setDiscountMethod] =
    useState<DiscountMethod>("percentage");
  const [discountValue, setDiscountValue] = useState("10");
  const [manualDiscountLabel, setManualDiscountLabel] = useState("");
  const [editingDiscountId, setEditingDiscountId] = useState<string | null>(null);
  const [discountTarget, setDiscountTarget] = useState("");
  const [discountDefinitionId, setDiscountDefinitionId] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const [guestHasVacated, setGuestHasVacated] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reservationStayEdited, setReservationStayEdited] = useState(false);

  const reservationCheckIn = initialReservation && checkInInput === toDateTimeInput(initialReservation.checkIn) ? initialReservation.checkIn : parseDateTimeInput(checkInInput);
  const reservationCheckOut = initialReservation && !reservationStayEdited ? initialReservation.checkOut : getStayEnd(
    checkInInput,
    durationId,
    availableDurations,
    configuration.defaultCheckOutTime,
  );
  function getRoomStayStart(room: RoomDraft) {
    const saved = initialReservation?.rooms.find((item) => item.roomNumber === room.roomNumber);
    return saved && room.checkIn === toDateTimeInput(saved.checkIn) ? saved.checkIn : parseDateTimeInput(room.checkIn);
  }
  function getRoomStayEnd(room: RoomDraft) {
    const saved = initialReservation?.rooms.find((item) => item.roomNumber === room.roomNumber);
    if (saved && room.priceLocked && room.durationId === saved.durationId && room.checkIn === toDateTimeInput(saved.checkIn)) return saved.checkOut;
    return getStayEnd(room.checkIn, room.durationId, availableDurations, configuration.defaultCheckOutTime);
  }
  const filteredGuests = guests.filter((option) =>
    `${option.name} ${option.email} ${option.phone}`
      .toLowerCase()
      .includes(guestQuery.trim().toLowerCase()),
  );
  const groupedRooms = groupRoomsByType(reservationRooms);
  const availableRoomCount = enabledRooms.filter(
    (room) =>
      configuredRoomPrice(room.roomTypeId, durationId) !== undefined &&
      !roomDrafts.some((draft) => draft.roomNumber === room.number) &&
      !findClash(
        stays,
        room.number,
        reservationCheckIn,
        reservationCheckOut,
        undefined,
        existingReservationId,
      ),
  ).length;

  const priceLines = buildReservationPriceLines(roomDrafts, durationId, configuration, initialReservation);
  const invalidPresets = discounts.filter((discount) => !isAppliedPresetCompatible(discount, priceLines));
  const pricingResult = (() => {
    try {
      return { summary: calculateReservationPrice(priceLines, discounts.filter((discount) => !invalidPresets.includes(discount)), adjustments.map((adjustment) => adjustment.amount), {
        currency: priceLines[0]?.currency ?? reservationCurrency,
        staged: !initialReservation || initialReservation.pricing.pipelineVersion === 2 || discounts.some((discount) => discount.sourcePresetId),
      }), error: "" };
    } catch (error) {
      return { summary: initialReservation?.pricing ?? { lines: [], discounts: [], subtotal: 0, discountTotal: 0, adjustmentTotal: 0, amountOwed: 0 }, error: error instanceof Error ? error.message : "Unable to calculate prices." };
    }
  })();
  const priceSummary = pricingResult.summary;

  function selectLinePreset(line: ReservationPriceLine, presetId: string) {
    const scope = line.kind === "room" ? "room" : "item";
    const preset = getApplicablePresets(configuration, scope, line).find((item) => item.id === presetId);
    if (presetId && !preset) { setErrorMessage("This preset is not available for the selected price."); return; }
    setDiscounts((current) => [
      ...current.filter((item) => !(item.sourcePresetId && item.targetId === line.id)),
      ...(preset ? [capturePreset(preset, line)] : []),
    ]);
    markDirty();
  }

  function addReservationPreset() {
    const preset = getApplicablePresets(configuration, "reservation").find((item) => item.id === discountDefinitionId);
    if (!preset || preset.currency !== (priceLines[0]?.currency ?? reservationCurrency)) { setErrorMessage("Select an available reservation preset in the reservation currency."); return; }
    if (discounts.some((item) => item.sourcePresetId === preset.id && item.scope === "reservation")) { setErrorMessage("This reservation preset is already applied."); return; }
    setDiscounts((current) => [...current, capturePreset(preset)]);
    setDiscountDefinitionId(""); markDirty();
  }

  const roomConflicts = roomDrafts.filter((room) => {
    const roomCheckIn = room.useReservationStay
      ? reservationCheckIn
      : getRoomStayStart(room);
    const roomCheckOut = room.useReservationStay
      ? reservationCheckOut
      : getRoomStayEnd(room);

    return (
      (!isOperationallyAvailable(room.roomNumber, configuration) &&
        !canRetainAssignedRoom(room.roomNumber)) ||
      Boolean(
        findClash(
          stays,
          room.roomNumber,
          roomCheckIn,
          roomCheckOut,
          undefined,
          existingReservationId,
        ),
      )
    );
  });

  const invalidRoomStay = roomDrafts.some((room) => {
    const start = room.useReservationStay
      ? reservationCheckIn
      : getRoomStayStart(room);
    const end = room.useReservationStay
      ? reservationCheckOut
      : getRoomStayEnd(room);

    return (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end.getTime() <= start.getTime()
    );
  });
  const missingRoomPrice = roomDrafts.some(
    (room) =>
      !room.priceLocked &&
      configuredRoomPrice(
        room.roomTypeId,
        room.useReservationStay ? durationId : room.durationId,
      ) === undefined,
  );

  const selectedBookingSource = bookingSources.find(
    (source) => source.id === bookingSource,
  );
  const validBookingSource = Boolean(
    selectedBookingSource?.enabled ||
      (initialReservation?.bookingSourceId === bookingSource &&
        Boolean(bookingSource)),
  );
  const canCreate =
    Boolean(guest) &&
    roomDrafts.length > 0 &&
    validBookingSource &&
    !Number.isNaN(reservationCheckIn.getTime()) &&
    Boolean(getConfiguredDuration(durationId)) &&
    !invalidRoomStay &&
    !missingRoomPrice &&
    !invalidPresets.length &&
    !pricingResult.error &&
    !isSubmitting &&
    initialReservation?.status !== "cancelled";

  function markDirty() {
    setIsDirty(true);
    setErrorMessage("");
  }

  const requestClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }

    if (isDirty) {
      setShowDiscardPrompt(true);
      return;
    }

    onClose();
  }, [isDirty, isSubmitting, onClose, setShowDiscardPrompt]);

  function addRoom() {
    const option = reservationRooms.find(
      (room) => room.number === selectedRoomNumber,
    );

    if (!option || roomDrafts.some((room) => room.roomNumber === option.number)) {
      return;
    }
    if (!isOperationallyAvailable(option.number, configuration)) {
      setErrorMessage(`Room ${option.number} is unavailable for maintenance.`);
      return;
    }
    if (configuredRoomPrice(option.roomTypeId, durationId) === undefined) {
      setErrorMessage(
        `No active price is configured for ${option.type} and this duration.`,
      );
      return;
    }

    const clash = findClash(
      stays,
      option.number,
      reservationCheckIn,
      reservationCheckOut,
      undefined,
      existingReservationId,
    );
    if (clash) {
      setErrorMessage(
        `Room ${option.number} is unavailable for the selected stay period.`,
      );
      return;
    }

    setRoomDrafts((current) => [
      ...current,
      {
        roomNumber: option.number,
        roomTypeId: option.roomTypeId,
        roomType: option.type,
        useReservationStay: true,
        checkIn: checkInInput,
        durationId,
        capturedRoomPrice: configuredRoomPrice(
          option.roomTypeId,
          durationId,
        ) ?? 0,
        capturedCurrency: configuredRoomCurrency(
          option.roomTypeId,
          durationId,
        ),
        priceLocked: false,
        adults: 2,
        children: 0,
        inclusions: {},
        charges: [],
        breakfast: {},
      },
    ]);
    setSelectedRoomNumber("");
    setExpandedRoom(option.number);
    markDirty();
  }

  function updateRoom(roomNumber: string, update: Partial<RoomDraft>) {
    setRoomDrafts((current) =>
      current.map((room) =>
        room.roomNumber === roomNumber
          ? {
              ...room,
              ...update,
              ...(update.durationId !== undefined ||
              update.useReservationStay !== undefined
                ? { priceLocked: false }
                : {}),
            }
          : room,
      ),
    );
    markDirty();
  }

  function removeRoom(roomNumber: string) {
    const removedChargeIds =
      roomDrafts
        .find((room) => room.roomNumber === roomNumber)
        ?.charges.map((charge) => charge.id) ?? [];
    setRoomDrafts((current) =>
      current.filter((room) => room.roomNumber !== roomNumber),
    );
    setDiscounts((current) =>
      current.filter(
        (discount) =>
          !(discount.scope === "room" && (discount.targetId === roomNumber || discount.targetId === `room:${roomNumber}`)) &&
          !(discount.scope === "item" && removedChargeIds.includes(discount.targetId)),
      ),
    );
    setExpandedRoom(null);
    setErrorMessage("Room removed; its targeted discounts were removed too.");
    setIsDirty(true);
  }

  function addCharge(roomNumber: string, catalogId: string) {
    const option = reservationExtraCharges.find((item) => item.id === catalogId);
    if (!option?.enabled) {
      return;
    }

    setRoomDrafts((current) =>
      current.map((room) =>
        room.roomNumber === roomNumber
          ? {
              ...room,
              charges: [
                ...room.charges,
                {
                  id: `charge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  catalogId: option.id,
                  label: option.label,
                  quantity: 1,
                  unitPrice: option.price,
                },
              ],
            }
          : room,
      ),
    );
    markDirty();
  }

  function addDiscount() {
    const value = Number(discountValue);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (discountMethod === "percentage" && value > 100)
    ) {
      setErrorMessage(
        discountMethod === "percentage"
          ? "Enter a discount between 0 and 100 percent."
          : "Enter a discount greater than zero.",
      );
      return;
    }

    if (
      (discountScope === "room" && !discountTarget) ||
      (discountScope === "item" && !discountTarget)
    ) {
      setErrorMessage("Select the room or charge this discount applies to.");
      return;
    }
    if ((discountScope === "room" && !roomDrafts.some((room) => room.roomNumber === discountTarget)) || (discountScope === "item" && !priceLines.some((line) => line.id === discountTarget && line.kind === "charge"))) {
      setErrorMessage("Select an existing room or charge line for the manual discount.");
      return;
    }

    const label = manualDiscountLabel.trim() ||
      (discountScope === "reservation" ? "Reservation discount" : discountScope === "room" ? `Room ${discountTarget} discount` : "Charge discount");
    const manualDiscount: ReservationDiscount = {
        id: editingDiscountId ?? crypto.randomUUID(),
        label,
        scope: discountScope,
        method: discountMethod,
        value,
        targetId: discountScope === "reservation" ? "" : discountTarget,
      };
    setDiscounts((current) => editingDiscountId ? current.map((item) => item.id === editingDiscountId ? manualDiscount : item) : [...current, manualDiscount]);
    setEditingDiscountId(null);
    setManualDiscountLabel("");
    setDiscountValue("");
    setDiscountTarget("");
    setDiscountDefinitionId("");
    markDirty();
  }

  function addAdjustment() {
    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount === 0 || !adjustmentReason.trim()) {
      setErrorMessage(
        "Enter a non-zero adjustment amount and a reason for it.",
      );
      return;
    }

    setAdjustments((current) => [
      ...current,
      {
        id: `adjustment-${Date.now()}`,
        amount,
        reason: adjustmentReason.trim(),
      },
    ]);
    setAdjustmentAmount("");
    setAdjustmentReason("");
    markDirty();
  }

  function createGuest() {
    const name = newGuestName.trim();
    if (!name) {
      setErrorMessage("Enter the guest's name.");
      return;
    }

    const createdGuest: ReservationGuest = {
      id: `guest-${crypto.randomUUID()}`,
      name,
      phone: newGuestPhone.trim(),
      email: newGuestEmail.trim(),
    };
    onGuestCreated(createdGuest);
    setGuestId(createdGuest.id);
    setGuestQuery("");
    setShowCreateGuest(false);
    setNewGuestName("");
    setNewGuestPhone("");
    setNewGuestEmail("");
    markDirty();
  }

  async function submitReservation() {
    if (initialReservation && !isDirty) {
      onSaved?.(initialReservation, stays.filter((stay) => stay.reservationId === initialReservation.id));
      return;
    }
    if (!canCreate) {
      return;
    }

    if (roomConflicts.length > 0) {
      const roomNames = roomConflicts
        .map((room) => `Room ${room.roomNumber}`)
        .join(", ");
      setErrorMessage(
        `${roomNames} ${roomConflicts.length === 1 ? "is" : "are"} no longer available for the selected stay period.`,
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    await new Promise((resolve) => window.setTimeout(resolve, 350));

    const nextStayId = Math.max(0, ...stays.map((stay) => stay.id)) + 1;
    const nextReservationNumber =
      Math.max(
        0,
        ...stays.map((stay) =>
          Number(/(?:RES|DEMO)-(\d+)/.exec(stay.reservationId ?? "")?.[1] ?? 0),
        ),
      ) + 1;
    const reservationId =
      initialReservation?.id ??
      `RES-${String(nextReservationNumber).padStart(5, "0")}`;
    const createdStays: Stay[] = roomDrafts.map((room, index) => {
      const roomCheckIn = room.useReservationStay
        ? reservationCheckIn
        : getRoomStayStart(room);
      const roomCheckOut = room.useReservationStay
        ? reservationCheckOut
        : getRoomStayEnd(room);

      return {
        id:
          stays.find(
            (stay) =>
              stay.reservationId === reservationId &&
              stay.room === room.roomNumber,
          )?.id ?? nextStayId + index,
        reservationId,
        room: room.roomNumber,
        guest: guest?.name ?? "",
        checkIn: roomCheckIn,
        checkOut: roomCheckOut,
        status:
          stays.find(
            (stay) =>
              stay.reservationId === reservationId &&
              stay.room === room.roomNumber,
          )?.status ??
          (initialReservation?.status === "checked_in"
            ? "checked_in"
            : initialReservation?.status === "checked_out"
              ? "checked_out"
              : initialReservation?.status === "no_show"
                ? "no_show"
              : initialReservation?.status === "cancelled"
                ? "cancelled"
                : "confirmed"),
      };
    });

    const createdAt = new Date();
    const reservation: ReservationSnapshot = {
      id: reservationId,
      status: initialReservation?.status ?? "confirmed",
      guestId: guest?.id ?? "",
      bookingSourceId: bookingSource,
      bookingSourceLabel:
        (initialReservation?.bookingSourceId === bookingSource
          ? initialReservation.bookingSourceLabel
          : bookingSources.find((source) => source.id === bookingSource)?.label) ??
        initialReservation?.bookingSourceLabel ??
        bookingSource,
      checkIn: reservationCheckIn,
      checkOut: reservationCheckOut,
      note,
      actualCheckInAt: initialReservation?.actualCheckInAt,
      actualCheckOutAt: initialReservation?.actualCheckOutAt,
      occupancyLockRoomNumbers:
        initialReservation?.occupancyLockRoomNumbers,
      rooms: roomDrafts.map((room) => {
        const roomCheckIn = room.useReservationStay
          ? reservationCheckIn
          : getRoomStayStart(room);
        const roomCheckOut = room.useReservationStay
          ? reservationCheckOut
          : getRoomStayEnd(room);
        const savedRoom = initialReservation?.rooms.find(
          (saved) => saved.roomNumber === room.roomNumber,
        );

        return {
          roomNumber: room.roomNumber,
          roomTypeId: room.roomTypeId,
          roomType: room.roomType,
          checkIn: roomCheckIn,
          checkOut: roomCheckOut,
          actualCheckInAt: savedRoom?.actualCheckInAt,
          actualCheckOutAt: savedRoom?.actualCheckOutAt,
          durationId: room.useReservationStay ? durationId : room.durationId,
          adults: room.adults,
          children: room.children,
          capturedRoomPrice: room.priceLocked
            ? room.capturedRoomPrice
            : configuredRoomPrice(
                room.roomTypeId,
                room.useReservationStay ? durationId : room.durationId,
              ) ?? room.capturedRoomPrice,
          capturedUnitPrice: priceLines.find((line) => line.id === `room:${room.roomNumber}`)?.baseUnitPrice,
          capturedPricingQuantity: priceLines.find((line) => line.id === `room:${room.roomNumber}`)?.pricingQuantity,
          capturedRateId: priceLines.find((line) => line.id === `room:${room.roomNumber}`)?.rateId,
          capturedCurrency: room.priceLocked
            ? room.capturedCurrency
            : configuredRoomCurrency(
                room.roomTypeId,
                room.useReservationStay ? durationId : room.durationId,
              ),
          inclusions: Object.entries(room.inclusions)
            .filter(([, quantity]) => quantity > 0)
            .map(([catalogId, quantity]) => ({
              catalogId,
              label:
                savedRoom?.inclusions.find(
                  (item) => item.catalogId === catalogId,
                )?.label ??
                reservationInclusions.find((item) => item.id === catalogId)?.label ??
                catalogId,
              quantity,
            })),
          charges: room.charges.map((charge) => ({
            ...charge,
            ...calculateTax(charge.quantity * charge.unitPrice),
          })),
          breakfast: Object.entries(room.breakfast)
            .map(([key, value]) => {
              const [stayDate, guestNumber] = key.split(":");
              const savedBreakfast = savedRoom?.breakfast.find(
                (item) =>
                  item.stayDate === stayDate &&
                  item.guestNumber === Number(guestNumber) + 1,
              );
              const mealOption = breakfastMeals.find(
                (item) => item.id === value.meal,
              );
              const drinkOption = breakfastDrinks.find(
                (item) => item.id === value.drink,
              );
              return {
                stayDate,
                guestNumber: Number(guestNumber) + 1,
                status: value.status,
                quantity: 1,
                unitPrice: 0 as const,
                lineTotal: 0 as const,
                ...(value.status === "included"
                  ? {
                      mealId: breakfastMeals.find((item) => item.id === value.meal)?.id ?? value.meal,
                      mealLabel:
                        savedBreakfast?.mealId === value.meal
                          ? savedBreakfast.mealLabel ?? value.meal
                          : mealOption?.label ?? value.meal,
                      beverageId: drinkOption?.id ?? value.drink,
                      beverageLabel:
                        savedBreakfast?.beverageId === value.drink
                          ? savedBreakfast.beverageLabel ?? value.drink
                          : drinkOption?.label ?? value.drink,
                    }
                  : {}),
              };
            })
            .filter(
              (breakfast) =>
                breakfast.guestNumber <= room.adults + room.children,
            ),
        };
      }),
      discounts: discounts.map((discount) => {
        const applied = priceSummary.discounts.find((item) => item.id === discount.id);
        return { ...discount, baseUnitPrice: applied?.baseUnitPrice ?? discount.baseUnitPrice, quantity: applied?.quantity ?? discount.quantity };
      }),
      adjustments: adjustments.map(({ id, amount, reason }) => ({
        id,
        amount,
        reason,
      })),
      pricing: {
        ...priceSummary,
        lines: priceSummary.lines.map((line) => ({ ...line })),
        discounts: priceSummary.discounts.map((discount) => ({ ...discount })),
      },
      audit: [],
      createdAt: initialReservation?.createdAt ?? createdAt,
    };
    reservation.audit = [
      ...(initialReservation?.audit ?? []),
      ...buildAuditEntries(initialReservation ?? undefined, reservation, createdAt),
    ];

    if (initialReservation) {
      onSaved?.(reservation, createdStays);
    } else {
      onCreated(reservation, createdStays);
    }
  }

  const currentContexts = roomDrafts.map((room) => ({
    roomId: room.roomNumber,
    start: room.useReservationStay
      ? reservationCheckIn
      : getRoomStayStart(room),
    end: room.useReservationStay
      ? reservationCheckOut
      : getRoomStayEnd(room),
  }));
  const contextSignature = currentContexts
    .map(
      (context) =>
        `${context.roomId}:${context.start.getTime()}:${context.end.getTime()}`,
    )
    .join("|");
  const lastContextSignature = useRef("");
  const escapeActionRef = useRef(requestClose);

  useEffect(() => {
    escapeActionRef.current = () => {
      if (showCancelPrompt) {
        setShowCancelPrompt(false);
        return;
      }
      if (showDiscardPrompt) {
        setShowDiscardPrompt(false);
        return;
      }
      requestClose();
    };
  }, [requestClose, showCancelPrompt, showDiscardPrompt]);

  useEffect(() => {
    if (lastContextSignature.current === contextSignature) {
      return;
    }
    lastContextSignature.current = contextSignature;
    onDraftContextChange?.(currentContexts);
  }, [contextSignature, currentContexts, onDraftContextChange]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    openerRef.current = previousFocus;
    const previousOverflow = document.body.style.overflow;
    const updateBodyOverflow = () => {
      document.body.style.overflow =
        window.innerWidth >= 1024 ? previousOverflow : "hidden";
    };
    updateBodyOverflow();
    window.addEventListener("resize", updateBodyOverflow);
    const firstControl =
      paneRef.current?.querySelector<HTMLElement>("#guest-search") ??
      paneRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])",
      );
    firstControl?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        escapeActionRef.current();
        return;
      }

      if (event.key !== "Tab" || !paneRef.current) {
        return;
      }

      const focusable = Array.from(
        paneRef.current.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.closest("[hidden]"));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateBodyOverflow);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 lg:static lg:z-auto lg:h-full lg:min-h-0 lg:bg-transparent"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={paneRef}
        aria-label={initialReservation ? "Edit reservation" : "Create reservation"}
        aria-modal="true"
        className="flex h-full w-full max-w-none flex-col bg-white shadow-2xl lg:w-full lg:min-w-0 lg:rounded-xl lg:border lg:border-slate-200"
        role="dialog"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {initialReservation ? initialReservation.id : "New booking"}
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">
              {initialReservation ? "Edit Reservation" : "Create Reservation"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Demo workflow · prices and availability use sample data
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={isSubmitting}
            aria-label="Close reservation pane"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div ref={reservationScrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-100/70 px-4 py-5 sm:px-5">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800"
            >
              {errorMessage}
            </div>
          )}

          <section className={sectionClass}>
            <div>
              <ReservationStageHeading step={1} title="Primary guest" />
              <p className="mt-1 text-sm text-slate-500">
                One guest is associated with the whole reservation.
              </p>
            </div>

            {guest ? (
              <div className="flex items-start justify-between rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="font-semibold text-slate-900">{guest.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {guest.phone || "No phone provided"}
                  </p>
                  <p className="text-sm text-slate-600">
                    {guest.email || "No email provided"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setGuestId("");
                    markDirty();
                  }}
                  className="text-sm font-medium text-slate-600 underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <label className="sr-only" htmlFor="guest-search">
                  Search guests
                </label>
                <input
                  id="guest-search"
                  className={inputClass}
                  onChange={(event) => setGuestQuery(event.target.value)}
                  placeholder="Search guest by name, email, or phone"
                  value={guestQuery}
                />

                {filteredGuests.length > 0 ? (
                  <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {filteredGuests.map((option) => (
                      <li key={option.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setGuestId(option.id);
                            markDirty();
                          }}
                          className="w-full px-3 py-2.5 text-left hover:bg-slate-50"
                        >
                          <span className="block text-sm font-medium text-slate-900">
                            {option.name}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {option.phone} · {option.email}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No guests found.</p>
                )}

                {!showCreateGuest ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateGuest(true);
                      setNewGuestName(guestQuery);
                    }}
                    className="text-sm font-semibold text-slate-800 underline underline-offset-2"
                  >
                    + Create new guest
                  </button>
                ) : (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                    <label className="block">
                      <span className={labelClass}>Full name *</span>
                      <input
                        className={inputClass}
                        onChange={(event) => setNewGuestName(event.target.value)}
                        value={newGuestName}
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className={labelClass}>Phone</span>
                        <input
                          className={inputClass}
                          onChange={(event) =>
                            setNewGuestPhone(event.target.value)
                          }
                          value={newGuestPhone}
                        />
                      </label>
                      <label className="block">
                        <span className={labelClass}>Email</span>
                        <input
                          className={inputClass}
                          onChange={(event) =>
                            setNewGuestEmail(event.target.value)
                          }
                          type="email"
                          value={newGuestEmail}
                        />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={createGuest}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                      >
                        Use guest
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCreateGuest(false)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <section className={sectionClass}>
            <div>
              <ReservationStageHeading step={2} title="Reservation stay" />
              <p className="mt-1 text-sm text-slate-500">
                Check-out is calculated from the configured duration.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Check-in *</span>
                <input
                  className={inputClass}
                  onChange={(event) => {
                    setReservationStayEdited(true);
                    setCheckInInput(event.target.value);
                    markDirty();
                  }}
                  required
                  type="datetime-local"
                  value={checkInInput}
                />
              </label>
              <label>
                <span className={labelClass}>Duration *</span>
                <select
                  className={inputClass}
                  onChange={(event) => {
                    const nextDurationId = event.target.value;
                    setReservationStayEdited(true);
                    setDurationId(nextDurationId);
                    setRoomDrafts((current) =>
                      current.map((room) =>
                        room.useReservationStay
                          ? { ...room, priceLocked: false }
                          : room,
                      ),
                    );
                    if (
                      !initialReservation &&
                      getConfiguredDuration(nextDurationId)?.bookingType ===
                        "overnight"
                    ) {
                      const currentCheckIn = parseDateTimeInput(checkInInput);
                      setCheckInInput(
                        toDateTimeInput(
                          hotelDateAtTime(
                            currentCheckIn,
                            configuration.defaultCheckInTime,
                          ),
                        ),
                      );
                    }
                    markDirty();
                  }}
                  value={durationId}
                >
                  {availableDurations.map((duration) => (
                    <option key={duration.id} value={duration.id}>
                      {duration.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              Check-out:{" "}
              <span className="font-semibold">
                {Number.isNaN(reservationCheckOut.getTime())
                  ? "Invalid date"
                  : formatDateTime(reservationCheckOut)}
              </span>
            </p>
          </section>

          <section ref={roomsStageRef} className={sectionClass}>
            <div>
              <ReservationStageHeading step={3} title="Rooms" />
              <p className="mt-1 text-sm text-slate-500">
                Rooms can have different room types and individual settings.
              </p>
            </div>

            {roomDrafts.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
                Add at least one available room to continue.
              </p>
            ) : (
              <div className="space-y-3">
                {roomDrafts.map((room) => {
                  const roomStay = room.useReservationStay
                    ? {
                        start: reservationCheckIn,
                        end: reservationCheckOut,
                        durationId,
                      }
                    : {
                        start: getRoomStayStart(room),
                        end: getRoomStayEnd(room),
                        durationId: room.durationId,
                      };
                  const conflict =
                    (!isOperationallyAvailable(
                      room.roomNumber,
                      configuration,
                    ) &&
                      !canRetainAssignedRoom(room.roomNumber)) ||
                    Boolean(
                      findClash(
                        stays,
                        room.roomNumber,
                        roomStay.start,
                        roomStay.end,
                        undefined,
                        existingReservationId,
                      ),
                    );
                  const displayedPrice = room.priceLocked
                    ? room.capturedRoomPrice
                    : configuredRoomPrice(
                        room.roomTypeId,
                        roomStay.durationId,
                      ) ??
                      room.capturedRoomPrice;
                  const guestCount = room.adults + room.children;
                  const inclusionOptions = reservationInclusions.filter(
                    (item) =>
                      item.enabled || (room.inclusions[item.id] ?? 0) > 0,
                  );
                  const breakfastDates = getBreakfastDates(
                    roomStay.start,
                    roomStay.end,
                  );

                  return (
                    <article
                      key={room.roomNumber}
                      className="overflow-hidden rounded-xl border border-slate-200"
                    >
                      <div className="flex items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-semibold text-slate-900">
                            Room {room.roomNumber} · {room.roomType}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">
                            {room.adults} adults · {room.children} children
                          </p>
                          <p className="mt-1 text-sm font-semibold text-slate-900">
                            {formatReservationMoney(
                              displayedPrice,
                              room.priceLocked
                                ? room.capturedCurrency
                                : configuredRoomCurrency(
                                    room.roomTypeId,
                                    roomStay.durationId,
                                  ),
                            )}
                          </p>
                          {conflict && (
                            <p className="mt-2 text-xs font-medium text-rose-700">
                              Unavailable for this stay period
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            aria-expanded={expandedRoom === room.roomNumber}
                            aria-controls={expandedRoom === room.roomNumber ? `room-settings-${encodeURIComponent(room.roomNumber)}` : undefined}
                            onClick={() =>
                              setExpandedRoom((current) =>
                                current === room.roomNumber
                                  ? null
                                  : room.roomNumber,
                              )
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                          >
                            {expandedRoom === room.roomNumber
                              ? "Hide settings"
                              : "Configure"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRoom(room.roomNumber)}
                            aria-label={`Remove room ${room.roomNumber}`}
                            className="rounded-lg px-2 py-2 text-sm text-slate-500 hover:bg-slate-100"
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="px-4 pb-3">
                        <LineDiscountSelector configuration={configuration} line={priceLines.find((line) => line.id === `room:${room.roomNumber}`)!} discounts={discounts} summary={priceSummary} onSelect={selectLinePreset} />
                      </div>
                      {expandedRoom === room.roomNumber && (
                        <div id={`room-settings-${encodeURIComponent(room.roomNumber)}`} className="space-y-4 border-t border-slate-200 bg-slate-100/70 p-4">
                          <div className={roomSectionClass}>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Stay
                            </h4>
                            <div className="mt-2 flex flex-wrap gap-4 text-sm">
                              <label className="flex items-center gap-2">
                                <input
                                  checked={room.useReservationStay}
                                  name={`stay-${room.roomNumber}`}
                                  onChange={() =>
                                    updateRoom(room.roomNumber, {
                                      useReservationStay: true,
                                    })
                                  }
                                  type="radio"
                                />
                                Same as reservation
                              </label>
                              <label className="flex items-center gap-2">
                                <input
                                  checked={!room.useReservationStay}
                                  name={`stay-${room.roomNumber}`}
                                  onChange={() =>
                                    updateRoom(room.roomNumber, {
                                      useReservationStay: false,
                                      checkIn: checkInInput,
                                      durationId,
                                    })
                                  }
                                  type="radio"
                                />
                                Custom stay
                              </label>
                            </div>
                            {!room.useReservationStay && (
                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <label>
                                  <span className={labelClass}>Check-in</span>
                                  <input
                                    className={inputClass}
                                    onChange={(event) =>
                                      updateRoom(room.roomNumber, {
                                        checkIn: event.target.value,
                                      })
                                    }
                                    type="datetime-local"
                                    value={room.checkIn}
                                  />
                                </label>
                                <label>
                                  <span className={labelClass}>Duration</span>
                                  <select
                                    className={inputClass}
                                    onChange={(event) =>
                                      updateRoom(room.roomNumber, {
                                        durationId: event.target.value,
                                      })
                                    }
                                    value={room.durationId}
                                  >
                                    {availableDurations.map((duration) => (
                                      <option
                                        key={duration.id}
                                        value={duration.id}
                                      >
                                        {duration.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <p className="text-sm text-slate-600 sm:col-span-2">
                                  Check-out:{" "}
                                  {Number.isNaN(roomStay.end.getTime())
                                    ? "Invalid date"
                                    : formatDateTime(roomStay.end)}
                                </p>
                              </div>
                            )}
                          </div>

                          <div className={roomSectionClass}>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Occupancy
                            </h4>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              {(["adults", "children"] as const).map((key) => (
                                <label key={key}>
                                  <span className={labelClass}>
                                    {key === "adults" ? "Adults" : "Children"}
                                  </span>
                                  <input
                                    className={inputClass}
                                    min={key === "adults" ? 1 : 0}
                                    onChange={(event) =>
                                      updateRoom(room.roomNumber, {
                                        [key]: Math.max(
                                          key === "adults" ? 1 : 0,
                                          Number(event.target.value) || 0,
                                        ),
                                      })
                                    }
                                    type="number"
                                    value={room[key]}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className={roomSectionClass}>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Inclusions
                            </h4>
                            <div className="mt-2 space-y-2">
                              {inclusionOptions.map((item) => (
                                <label
                                  key={item.id}
                                  className="flex items-center justify-between gap-3 text-sm text-slate-700"
                                >
                                  <span>
                                    {item.label}
                                    {!item.enabled ? " (inactive historical item)" : ""}
                                  </span>
                                  <input
                                    aria-label={`${item.label} quantity`}
                                    className="w-20 rounded-md border border-slate-300 px-2 py-1.5"
                                    min={0}
                                    onChange={(event) =>
                                      updateRoom(room.roomNumber, {
                                        inclusions: {
                                          ...room.inclusions,
                                          [item.id]: Math.max(
                                            0,
                                            Number(event.target.value) || 0,
                                          ),
                                        },
                                      })
                                    }
                                    type="number"
                                    value={room.inclusions[item.id] ?? 0}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className={roomSectionClass}>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Extra charges
                            </h4>
                            {room.charges.length === 0 ? (
                              <p className="mt-1 text-sm text-slate-500">
                                No extra charges
                              </p>
                            ) : (
                              <div className="mt-2 space-y-2">
                                {room.charges.map((charge) => (
                                  <div
                                    key={charge.id}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-2.5 text-sm"
                                  >
                                    <span>
                                      {charge.label} ·{" "}
                                      {formatReservationMoney(charge.unitPrice)} each
                                      {reservationExtraCharges.find(
                                        (item) => item.id === charge.catalogId,
                                      )?.enabled === false
                                        ? " · inactive historical item"
                                        : ""}
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <input
                                        aria-label={`${charge.label} quantity`}
                                        className="w-16 rounded-md border border-slate-300 px-2 py-1"
                                        min={1}
                                        onChange={(event) => {
                                          const quantity = Math.max(
                                            1,
                                            Number(event.target.value) || 1,
                                          );
                                          updateRoom(room.roomNumber, {
                                            charges: room.charges.map((item) =>
                                              item.id === charge.id
                                                ? { ...item, quantity }
                                                : item,
                                            ),
                                          });
                                        }}
                                        type="number"
                                        value={charge.quantity}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRoomDrafts((current) =>
                                            current.map((draft) =>
                                              draft.roomNumber ===
                                              room.roomNumber
                                                ? {
                                                    ...draft,
                                                    charges:
                                                      draft.charges.filter(
                                                        (item) =>
                                                          item.id !== charge.id,
                                                      ),
                                                  }
                                                : draft,
                                            ),
                                          );
                                          setDiscounts((current) =>
                                            current.filter(
                                              (discount) =>
                                                discount.targetId !== charge.id,
                                            ),
                                          );
                                          setErrorMessage("Charge removed; its targeted discounts were removed too.");
                                          setIsDirty(true);
                                        }}
                                        className="text-slate-500 underline"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                    <LineDiscountSelector configuration={configuration} line={priceLines.find((line) => line.id === charge.id)!} discounts={discounts} summary={priceSummary} onSelect={selectLinePreset} />
                                  </div>
                                ))}
                              </div>
                            )}
                            <select
                              aria-label="Add extra charge"
                              className={`${inputClass} mt-2`}
                              onChange={(event) => {
                                if (event.target.value) {
                                  addCharge(room.roomNumber, event.target.value);
                                  event.target.value = "";
                                }
                              }}
                              value=""
                            >
                              <option value="">+ Add charge</option>
                              {reservationExtraCharges.map((item) => (
                                <option
                                  key={item.id}
                                  value={item.id}
                                  disabled={!item.enabled}
                                >
                                  {item.label}
                                  {!item.enabled
                                    ? " (inactive historical item)"
                                    : ` · ${formatReservationMoney(item.price)}`}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className={roomSectionClass}>
                            <h4 className="text-sm font-semibold text-slate-900">
                              Breakfast
                            </h4>
                            <p className="mt-1 text-xs text-slate-500">
                              Optional per guest and breakfast date. Unrecorded
                              is the default.
                            </p>
                            {breakfastDates.length === 0 ? (
                              <p className="mt-2 text-sm text-slate-500">
                                No breakfast dates in this stay.
                              </p>
                            ) : (
                              <div className="mt-3 space-y-3">
                                {breakfastDates.map((date) => (
                                  <div
                                    key={date.toISOString()}
                                    className="rounded-lg bg-white p-3"
                                  >
                                    <p className="mb-2 text-sm font-medium text-slate-800">
                                      {new Intl.DateTimeFormat("en-PH", {
                                        dateStyle: "medium",
                                      }).format(date)}
                                    </p>
                                    <div className="space-y-3">
                                      {Array.from(
                                        { length: guestCount },
                                        (_, index) => {
                                          const key = getBreakfastKey(
                                            date,
                                            index,
                                          );
                                          const breakfast =
                                            room.breakfast[key];
                                          const mealOptions = breakfastMeals
                                            .filter(
                                              (item) =>
                                                item.enabled ||
                                                item.id === breakfast?.meal,
                                            )
                                            .concat(
                                              breakfast?.meal &&
                                                !breakfastMeals.some(
                                                  (item) =>
                                                    item.id === breakfast.meal,
                                                )
                                                ? [{
                                                    id: breakfast.meal,
                                                    label: breakfast.meal,
                                                  category: "breakfast" as const,
                                                  categoryId: "special-breakfast",
                                                  breakfastType: "meal" as const,
                                                  price: 0,
                                                  enabled: false,
                                                }]
                                                : [],
                                            );
                                          const drinkOptions = breakfastDrinks
                                            .filter(
                                              (item) =>
                                                item.enabled ||
                                                item.id === breakfast?.drink,
                                            )
                                            .concat(
                                              breakfast?.drink &&
                                                !breakfastDrinks.some(
                                                  (item) =>
                                                    item.id === breakfast.drink,
                                                )
                                                ? [{
                                                    id: breakfast.drink,
                                                    label: breakfast.drink,
                                                  category: "breakfast" as const,
                                                  categoryId: "special-breakfast",
                                                  breakfastType: "beverage" as const,
                                                  price: 0,
                                                  enabled: false,
                                                }]
                                                : [],
                                            );
                                          return (
                                            <div
                                              key={key}
                                              className="space-y-2 border-t border-slate-100 pt-2"
                                            >
                                              <p className="text-xs font-medium text-slate-700">
                                                Guest {index + 1}
                                              </p>
                                              <select
                                                className={inputClass}
                                                onChange={(event) => {
                                                  const value =
                                                    event.target.value;
                                                  const breakfastState = {
                                                    ...room.breakfast,
                                                  };
                                                  if (value === "unrecorded") {
                                                    delete breakfastState[key];
                                                  } else {
                                                    breakfastState[key] = {
                                                      status:
                                                        value as BreakfastDraft["status"],
                                                      meal:
                                                        breakfast?.meal ??
                                                        breakfastMeals[0].id,
                                                      drink:
                                                        breakfast?.drink ??
                                                        breakfastDrinks[0].id,
                                                    };
                                                  }
                                                  updateRoom(room.roomNumber, {
                                                    breakfast: breakfastState,
                                                  });
                                                }}
                                                value={
                                                  breakfast?.status ??
                                                  "unrecorded"
                                                }
                                              >
                                                <option value="unrecorded">
                                                  Unrecorded
                                                </option>
                                                <option value="included">
                                                  Breakfast
                                                </option>
                                                <option value="skipped">
                                                  Skip breakfast
                                                </option>
                                              </select>
                                              {breakfast?.status ===
                                                "included" && (
                                                <div className="grid grid-cols-2 gap-2">
                                                  <select
                                                    className={inputClass}
                                                    onChange={(event) =>
                                                      updateRoom(
                                                        room.roomNumber,
                                                        {
                                                          breakfast: {
                                                            ...room.breakfast,
                                                            [key]: {
                                                              ...breakfast,
                                                              meal:
                                                                event.target
                                                                  .value,
                                                            },
                                                          },
                                                        },
                                                      )
                                                    }
                                                    value={breakfast.meal}
                                                  >
                                                    {mealOptions.map(
                                                      (meal) => (
                                                        <option
                                                          key={meal.id}
                                                          value={meal.id}
                                                          disabled={!meal.enabled}
                                                        >
                                                          {meal.label}
                                                          {!meal.enabled
                                                            ? " (inactive historical option)"
                                                            : ""}
                                                        </option>
                                                      ),
                                                    )}
                                                  </select>
                                                  <select
                                                    className={inputClass}
                                                    onChange={(event) =>
                                                      updateRoom(
                                                        room.roomNumber,
                                                        {
                                                          breakfast: {
                                                            ...room.breakfast,
                                                            [key]: {
                                                              ...breakfast,
                                                              drink:
                                                                event.target
                                                                  .value,
                                                            },
                                                          },
                                                        },
                                                      )
                                                    }
                                                    value={breakfast.drink}
                                                  >
                                                    {drinkOptions.map(
                                                      (drink) => (
                                                        <option
                                                          key={drink.id}
                                                          value={drink.id}
                                                          disabled={!drink.enabled}
                                                        >
                                                          {drink.label}
                                                          {!drink.enabled
                                                            ? " (inactive historical option)"
                                                            : ""}
                                                        </option>
                                                      ),
                                                    )}
                                                  </select>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        },
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex justify-end border-t border-slate-300 pt-4">
                            <button
                              type="button"
                              onClick={(event) => {
                                const article = event.currentTarget.closest("article");
                                scrollToRoomsAfterCollapseRef.current = true;
                                setExpandedRoom(null);
                                const toggle = article?.querySelector<HTMLButtonElement>("button[aria-expanded]");
                                toggle?.focus({ preventScroll: true });
                              }}
                              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                            >
                              Done
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            <div className="flex gap-2">
              <select
                aria-label="Choose available room"
                className={`${inputClass} min-w-0`}
                onChange={(event) => setSelectedRoomNumber(event.target.value)}
                value={selectedRoomNumber}
              >
                <option value="">Select an available room</option>
                {Object.entries(groupedRooms).map(([type, options]) => (
                  <optgroup key={type} label={type}>
                    {options.map((room) => {
                      const alreadyAdded = roomDrafts.some(
                        (draft) => draft.roomNumber === room.number,
                      );
                      const unavailable = Boolean(
                        !isOperationallyAvailable(
                          room.number,
                          configuration,
                        ) ||
                        findClash(
                          stays,
                          room.number,
                          reservationCheckIn,
                          reservationCheckOut,
                          undefined,
                          existingReservationId,
                        ),
                      );
                      const missingPrice =
                        configuredRoomPrice(room.roomTypeId, durationId) ===
                        undefined;
                      return (
                        <option
                          key={room.number}
                          disabled={alreadyAdded || unavailable || missingPrice}
                          value={room.number}
                        >
                          Room {room.number} ·{" "}
                          {alreadyAdded
                            ? "Already added"
                            : missingPrice
                              ? "No price configured"
                            : unavailable
                              ? isOperationallyAvailable(
                                  room.number,
                                  configuration,
                                )
                                ? "Overlapping reservation"
                                : "Maintenance"
                              : "Available"}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedRoomNumber}
                onClick={addRoom}
                className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                + Add room
              </button>
            </div>
            {availableRoomCount === 0 && (
              <p className="text-sm text-slate-600">
                No more rooms are available for this stay period. Try changing
                the dates or removing a selected room.
              </p>
            )}
          </section>

          <section className={sectionClass}>
            <div>
              <ReservationStageHeading step={4} title="Booking information" />
            </div>
            <label>
              <span className={labelClass}>Booking source *</span>
              <select
                className={inputClass}
                onChange={(event) => {
                  setBookingSource(event.target.value);
                  markDirty();
                }}
                value={bookingSource}
              >
                <option value="">Choose source</option>
                {initialReservation &&
                  bookingSource === initialReservation.bookingSourceId &&
                  !bookingSources.some((source) => source.id === bookingSource) && (
                    <option value={bookingSource} disabled>
                      {initialReservation.bookingSourceLabel} (unconfigured historical source)
                    </option>
                  )}
                {bookingSources
                  .filter(
                    (source) =>
                      source.enabled ||
                      source.id === initialReservation?.bookingSourceId,
                  )
                  .map((source) => (
                  <option
                    key={source.id}
                    value={source.id}
                    disabled={!source.enabled}
                  >
                    {source.label}
                    {!source.enabled ? " (inactive historical source)" : ""}
                  </option>
                  ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>Reservation note</span>
              <textarea
                className={inputClass}
                maxLength={1000}
                onChange={(event) => {
                  setNote(event.target.value);
                  markDirty();
                }}
                placeholder="Add a note for this reservation"
                rows={3}
                value={note}
              />
            </label>
          </section>

          <section className={sectionClass}>
            <div>
              <ReservationStageHeading step={5} title="Discounts" />
              <p className="mt-1 text-sm text-slate-500">
                Final-price presets apply first, then room/item reductions, then reservation-wide reductions. Manual room discounts include that room's extras. Lines never fall below zero.
              </p>
            </div>
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <h4 className="font-semibold">Reservation Discounts</h4>
              <label><span className={labelClass}>Reservation preset</span>
                <select className={inputClass} value={discountDefinitionId} onChange={(event) => setDiscountDefinitionId(event.target.value)}>
                  <option value="">Select preset</option>
                  {getApplicablePresets(configuration, "reservation").filter((item) => item.currency === (priceLines[0]?.currency ?? reservationCurrency)).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium" disabled={!discountDefinitionId} onClick={addReservationPreset}>Apply reservation preset</button>
              <p className="text-xs text-slate-500">Staff verify eligibility. Selection alone does not apply the preset.</p>
            </div>
            {discounts.length > 0 && (
              <ul className="space-y-2">
                {discounts.map((discount, index) => (
                  <li
                    key={discount.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {index + 1}. {discount.label} ·{" "}
                      {discount.method === "final_price" ? `${formatReservationMoney(discount.discountedUnitPrice ?? 0, discount.currency)} per unit` : discount.method === "percentage"
                        ? `${discount.value}%`
                        : formatReservationMoney(discount.value)}
                      {discount.sourcePresetId ? " (preset, read-only)" : " (manual)"}
                    </span>
                    {!discount.sourcePresetId && <button type="button" className="ml-auto mr-3 text-slate-500 underline" onClick={() => {
                      setEditingDiscountId(discount.id); setManualDiscountLabel(discount.label);
                      setDiscountScope(discount.scope); setDiscountTarget(discount.targetId);
                      setDiscountMethod(discount.method as DiscountMethod); setDiscountValue(String(discount.value));
                    }}>Edit manual discount</button>}
                    <button
                      type="button"
                      aria-label={`Remove ${discount.label}`}
                      onClick={() => {
                        if (editingDiscountId === discount.id) setEditingDiscountId(null);
                        setDiscounts((current) =>
                          current.filter((item) => item.id !== discount.id),
                        );
                        markDirty();
                      }}
                      className="text-slate-500 underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="font-semibold">Manual Discount</h4>
            <label><span className={labelClass}>Manual discount label</span><input className={inputClass} value={manualDiscountLabel} onChange={(event) => setManualDiscountLabel(event.target.value)} /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Applies to</span>
                <select
                  className={inputClass}
                  onChange={(event) => {
                    const scope = event.target.value as DiscountScope;
                    setDiscountScope(scope);
                    setDiscountTarget("");
                    markDirty();
                  }}
                  value={discountScope}
                >
                  <option value="reservation">Reservation</option>
                  <option value="room">Room</option>
                  <option value="item">Charge item</option>
                </select>
              </label>
              <label>
                <span className={labelClass}>Discount type</span>
                <select
                  className={inputClass}
                  onChange={(event) => {
                    setDiscountMethod(event.target.value as DiscountMethod);
                    markDirty();
                  }}
                  value={discountMethod}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </label>
              {discountScope !== "reservation" && (
                <label>
                  <span className={labelClass}>Target</span>
                  <select
                    className={inputClass}
                    onChange={(event) => {
                      setDiscountTarget(event.target.value);
                      markDirty();
                    }}
                    value={discountTarget}
                  >
                    <option value="">Choose target</option>
                    {discountScope === "room"
                      ? roomDrafts.map((room) => (
                          <option
                            key={room.roomNumber}
                            value={room.roomNumber}
                          >
                            Room {room.roomNumber}
                          </option>
                        ))
                      : roomDrafts.flatMap((room) =>
                          room.charges.map((charge) => (
                            <option key={charge.id} value={charge.id}>
                              Room {room.roomNumber} · {charge.label}
                            </option>
                          )),
                        )}
                  </select>
                </label>
              )}
              <label>
                <span className={labelClass}>
                  {discountMethod === "percentage"
                    ? "Percentage"
                    : "Amount"}
                </span>
                <input
                  className={inputClass}
                  min="0.01"
                  max={discountMethod === "percentage" ? 100 : undefined}
                  onChange={(event) => {
                    setDiscountValue(event.target.value);
                    markDirty();
                  }}
                  step={discountMethod === "percentage" ? "0.01" : "1"}
                  type="number"
                  value={discountValue}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={addDiscount}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              {editingDiscountId ? "Save manual discount" : "+ Add discount"}
            </button>
            {editingDiscountId && <button type="button" className="ml-2 text-sm underline" onClick={() => { setEditingDiscountId(null); setManualDiscountLabel(""); setDiscountValue(""); }}>Cancel manual edit</button>}
          </section>

          <section className={sectionClass}>
            <div>
              <ReservationStageHeading step={6} title="Manual adjustments" />
              <p className="mt-1 text-sm text-slate-500">
                A reason is required. Positive values add to the amount owed;
                negative values reduce it.
              </p>
            </div>
            {adjustments.length > 0 && (
              <ul className="space-y-2">
                {adjustments.map((adjustment) => (
                  <li
                    key={adjustment.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {adjustment.reason} ·{" "}
                      {formatReservationMoney(adjustment.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustments((current) =>
                          current.filter((item) => item.id !== adjustment.id),
                        );
                        markDirty();
                      }}
                      className="text-slate-500 underline"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Amount</span>
                <input
                  className={inputClass}
                  onChange={(event) => {
                    setAdjustmentAmount(event.target.value);
                    markDirty();
                  }}
                  placeholder="e.g. 200 or -200"
                  step="0.01"
                  type="number"
                  value={adjustmentAmount}
                />
              </label>
              <label>
                <span className={labelClass}>Reason *</span>
                <input
                  className={inputClass}
                  onChange={(event) => {
                    setAdjustmentReason(event.target.value);
                    markDirty();
                  }}
                  value={adjustmentReason}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={addAdjustment}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
            >
              Apply adjustment
            </button>
          </section>

          <section className={`${sectionClass} pb-6`}>
            <div>
              <ReservationStageHeading step={7} title="Pricing" />
              <p className="mt-1 text-sm text-slate-500">
                Preview only · tax and payments are not included.
              </p>
            </div>
            <div className="space-y-2">
              {priceSummary.lines.map((line) => (
                <div
                  key={line.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <span className="text-slate-600">Original: {line.label}</span>
                  <span className="shrink-0 font-medium text-slate-900">
                    {formatReservationMoney(line.amount)}
                  </span>
                </div>
              ))}
              {priceSummary.lines.length === 0 && (
                <p className="text-sm text-slate-500">Add a room to see pricing.</p>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                <span className="text-slate-600">Original subtotal</span>
                <span className="font-medium">{formatReservationMoney(priceSummary.subtotal)}</span>
              </div>
              {priceSummary.discounts.map((discount) => (
                <div
                  key={discount.id}
                  className="flex justify-between text-sm text-emerald-700"
                >
                  <span>{discount.label}</span>
                  <span>−{formatReservationMoney(discount.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm"><span>Total discounts</span><span>{formatReservationMoney(priceSummary.discountTotal)}</span></div>
              {adjustments.map((adjustment) => (
                <div
                  key={adjustment.id}
                  className="flex justify-between text-sm text-slate-700"
                >
                  <span>Adjustment · {adjustment.reason}</span>
                  <span>{formatReservationMoney(adjustment.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
                <span>Amount owed</span>
                <span>{formatReservationMoney(priceSummary.amountOwed)}</span>
              </div>
              <p className="text-xs text-slate-500">
                Original prices and applied reductions are captured for this reservation in memory.
              </p>
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 z-10 shrink-0 border-t border-slate-200 bg-white px-5 py-4 shadow-[0_-4px_12px_rgba(15,23,42,0.04)] sm:px-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-600">
              Amount owed
            </span>
            <span className="text-lg font-bold text-slate-900">
              {formatReservationMoney(priceSummary.amountOwed)}
            </span>
          </div>
          {invalidPresets.length > 0 && <p role="alert" className="mb-3 text-sm text-rose-700">{invalidPresets.map((item) => item.label).join(", ")} no longer matches the selected room, duration, or item. Remove it or select a compatible preset before saving. The incompatible preset is excluded from this preview.</p>}
          {pricingResult.error && <p role="alert" className="mb-3 text-sm text-rose-700">{pricingResult.error}</p>}
          {roomConflicts.length > 0 && (
            <p className="mb-3 text-xs text-rose-700">
              Recheck availability:{" "}
              {roomConflicts.map((room) => `Room ${room.roomNumber}`).join(", ")}{" "}
              {roomConflicts.length === 1 ? "is" : "are"} unavailable.
            </p>
          )}
          {missingRoomPrice && (
            <p className="mb-3 text-xs text-rose-700">
              An active room price is required for every newly assigned room and duration.
            </p>
          )}
          <div className="flex gap-3">
            {initialReservation &&
              initialReservation.status !== "cancelled" &&
              initialReservation.status !== "checked_out" &&
              initialReservation.status !== "no_show" && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowCancelPrompt(true)}
                className="rounded-lg border border-rose-200 px-3 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Cancel Reservation
              </button>
            )}
            <button
              type="button"
              onClick={requestClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canCreate}
              onClick={submitReservation}
              className="flex-[1.5] rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isSubmitting
                ? initialReservation
                  ? "Saving changes…"
                  : "Creating reservation…"
                : initialReservation
                  ? "Save Changes"
                  : "Create Reservation"}
            </button>
          </div>
        </footer>

        {showDiscardPrompt && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-5">
            <div
              aria-labelledby="discard-title"
              aria-modal="true"
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
              role="alertdialog"
            >
              <h3
                className="text-lg font-bold text-slate-900"
                id="discard-title"
              >
                Discard changes?
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Your reservation has unsaved changes.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiscardPrompt(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white"
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
        {showCancelPrompt && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-5">
            <div
              aria-labelledby="cancel-title"
              aria-modal="true"
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
              role="alertdialog"
            >
              <h3
                className="text-lg font-bold text-slate-900"
                id="cancel-title"
              >
                Cancel Reservation?
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                {initialReservation?.status === "checked_in"
                  ? "Confirm whether the guest has vacated. If not, the room remains locked until departure is recorded."
                  : "This will cancel the reservation hold. The reservation and its charges remain in history."}
              </p>
              {initialReservation?.status === "checked_in" && (
                <fieldset className="mt-4 space-y-2 text-sm text-slate-700">
                  <legend className="font-medium">Has the guest vacated?</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="guest-vacated"
                      checked={guestHasVacated === true}
                      onChange={() => setGuestHasVacated(true)}
                    />
                    Yes, the guest has vacated
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="guest-vacated"
                      checked={guestHasVacated === false}
                      onChange={() => setGuestHasVacated(false)}
                    />
                    No, the guest has not vacated
                  </label>
                </fieldset>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancelPrompt(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  Keep Reservation
                </button>
                <button
                  type="button"
                  disabled={
                    isSubmitting ||
                    (initialReservation?.status === "checked_in" &&
                      guestHasVacated === null)
                  }
                  onClick={() => {
                    if (!initialReservation || !onCancelReservation) return;
                    setIsSubmitting(true);
                    onCancelReservation(
                      initialReservation.id,
                      initialReservation.status === "checked_in"
                        ? guestHasVacated === true
                        : true,
                    );
                  }}
                  className="rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Cancel Reservation
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
