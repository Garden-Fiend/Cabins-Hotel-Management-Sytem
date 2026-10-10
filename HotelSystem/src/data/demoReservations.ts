import { illustrativeReservations } from "./channelSamples";
import {
  historicalRoomRates,
  reservationCurrency,
  reservationRooms,
  roomRates,
  sampleRooms,
  sampleGuests,
} from "./datasample";
import { calculateReservationPrice } from "../lib/reservationPricing";
import { createHotelDateTime } from "../lib/hotelTime";
import type { Stay } from "../types/booking";
import type {
  ReservationAuditEntry,
  ReservationBreakfastSnapshot,
  ReservationDiscount,
  ReservationRoomSnapshot,
  ReservationSnapshot,
} from "../types/reservation";

type SampleRoom = Omit<
  ReservationRoomSnapshot,
  "inclusions" | "charges" | "breakfast"
> & {
  inclusions?: ReservationRoomSnapshot["inclusions"];
  charges?: ReservationRoomSnapshot["charges"];
  breakfast?: ReservationBreakfastSnapshot[];
};

function room(
  roomNumber: string,
  checkIn: Date,
  checkOut: Date,
  durationId: string,
  capturedRoomPrice: number,
  options: Partial<SampleRoom> = {},
): ReservationRoomSnapshot {
  const roomType =
    reservationRooms.find((option) => option.number === roomNumber)?.type ??
    "Standard";
  return {
    roomNumber,
    roomTypeId:
      sampleRooms.find((option) => option.number === roomNumber)?.roomTypeId ??
      "standard",
    roomType,
    checkIn,
    checkOut,
    durationId,
    adults: 2,
    children: 0,
    capturedRoomPrice,
    capturedCurrency: reservationCurrency,
    inclusions: [],
    charges: [],
    breakfast: [],
    ...options,
  };
}

function audit(
  eventType: ReservationAuditEntry["eventType"],
  action: string,
  occurredAt: Date,
  before?: string,
  after?: string,
): ReservationAuditEntry {
  return {
    eventType,
    action,
    occurredAt,
    actor: "Sample hotel staff",
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

function reservation(
  id: string,
  guestId: string,
  status: ReservationSnapshot["status"],
  bookingSourceId: string,
  bookingSourceLabel: string,
  rooms: ReservationRoomSnapshot[],
  options: {
    discounts?: ReservationDiscount[];
    adjustments?: ReservationSnapshot["adjustments"];
    note?: string;
    audit?: ReservationAuditEntry[];
    createdAt?: Date;
  } = {},
): ReservationSnapshot {
  const lines = rooms.flatMap((assignedRoom) => [
    {
      id: `room:${assignedRoom.roomNumber}`,
      label: `Room ${assignedRoom.roomNumber} · ${assignedRoom.roomType}`,
      amount: assignedRoom.capturedRoomPrice,
      roomNumber: assignedRoom.roomNumber,
      kind: "room" as const,
    },
    ...assignedRoom.charges.map((charge) => ({
      id: charge.id,
      label: `${charge.label} × ${charge.quantity}`,
      amount: charge.quantity * charge.unitPrice,
      roomNumber: assignedRoom.roomNumber,
      kind: "charge" as const,
    })),
  ]);
  const discounts = options.discounts ?? [];
  const adjustments = options.adjustments ?? [];
  const pricing = calculateReservationPrice(
    lines,
    discounts,
    adjustments.map((adjustment) => adjustment.amount),
  );
  const checkIn = new Date(
    Math.min(...rooms.map((assignedRoom) => assignedRoom.checkIn.getTime())),
  );
  const checkOut = new Date(
    Math.max(...rooms.map((assignedRoom) => assignedRoom.checkOut.getTime())),
  );
  const createdAt = options.createdAt ?? checkIn;

  return {
    id,
    status,
    guestId,
    bookingSourceId,
    bookingSourceLabel,
    checkIn,
    checkOut,
    note: options.note ?? "",
    rooms,
    discounts,
    adjustments,
    pricing,
    audit:
      options.audit ??
      [audit("created", "Reservation created", createdAt, undefined, id)],
    createdAt,
  };
}

const d = (day: number, hour = 14) => createHotelDateTime(2026, 10, day, hour);
const guestId = (name: string) =>
  sampleGuests.find((guest) => guest.name === name)?.id ?? "";

export const demoReservations: ReservationSnapshot[] = [
  reservation(
    "DEMO-1",
    guestId("John Doe"),
    "checked_out",
    "direct",
    "Direct",
    [
      room(
        "101",
        createHotelDateTime(2026, 9, 21, 14),
        createHotelDateTime(2026, 9, 24, 14),
        "3-nights",
        roomRates.Standard["3-nights"],
      ),
    ],
    {
      audit: [
        audit("created", "Reservation created", createHotelDateTime(2026, 9, 1), undefined, "DEMO-1"),
        audit("checked_in", "Guest checked in", createHotelDateTime(2026, 9, 21), "confirmed", "checked_in"),
        audit("checked_out", "Guest checked out", createHotelDateTime(2026, 9, 24), "checked_in", "checked_out"),
      ],
    },
  ),
  reservation(
    "DEMO-2",
    guestId("Alice Johnson"),
    "confirmed",
    "website",
    "Website",
    [
      room("102", d(14), d(16), "2-nights", roomRates.Standard["2-nights"], {
        adults: 2,
        children: 1,
        inclusions: [
          { catalogId: "welcome-drink", label: "Welcome drink", quantity: 2 },
          { catalogId: "parking", label: "Parking", quantity: 1 },
        ],
        charges: [
          { id: "extra-bed-102", catalogId: "extra-bed", label: "Extra bed", quantity: 1, unitPrice: 500 },
          { id: "laundry-102", catalogId: "laundry", label: "Laundry", quantity: 3, unitPrice: 120 },
        ],
      }),
      room("201", d(14, 16), d(15, 16), "1-night", roomRates.Suite["1-night"], {
        adults: 1,
        children: 0,
      }),
    ],
    {
      note: "Second room has an independent one-night stay.",
      audit: [
        audit("created", "Reservation created", d(10)),
        audit("room_removed", "Room 203 removed", d(11), "Room 203 · Standard", undefined),
        audit("room_added", "Room 201 added", d(11), undefined, "Room 201 · Suite"),
        audit("guest_changed", "Primary guest changed", d(11), "guest-bob-wilson", "guest-alice-johnson"),
        audit("stay_changed", "Room stay adjusted", d(11), "1 night", "2 nights"),
        audit("extra_changed", "Room extras updated", d(11), "Extra bed × 1", "Extra bed × 1; Laundry × 3"),
      ],
    },
  ),
  reservation(
    "DEMO-3",
    guestId("Jane Smith"),
    "confirmed",
    "booking-com",
    "Booking.com",
    [
      room("204", d(18), d(21), "3-nights", roomRates.Standard["3-nights"], {
        adults: 2,
        children: 1,
        breakfast: [
          { stayDate: "2026-10-19", guestNumber: 1, status: "included", mealId: "filipino", mealLabel: "Filipino breakfast", beverageId: "coffee", beverageLabel: "Coffee" },
          { stayDate: "2026-10-19", guestNumber: 2, status: "included", mealId: "continental", mealLabel: "Continental", beverageId: "juice", beverageLabel: "Juice" },
          { stayDate: "2026-10-19", guestNumber: 3, status: "skipped" },
          { stayDate: "2026-10-20", guestNumber: 1, status: "included", mealId: "vegetarian", mealLabel: "Vegetarian", beverageId: "tea", beverageLabel: "Tea" },
          { stayDate: "2026-10-20", guestNumber: 2, status: "skipped" },
        ],
      }),
    ],
  ),
  reservation(
    "DEMO-4",
    guestId("Emma Davis"),
    "confirmed",
    "phone",
    "Phone",
    [room("202", d(12), d(14), "2-nights", roomRates.Suite["2-nights"], {
      charges: [
        { id: "d4-laundry", catalogId: "laundry", label: "Laundry", quantity: 2, unitPrice: 120 },
      ],
    })],
    {
      discounts: [
        { id: "d4-room", label: "Suite discount", scope: "room", method: "percentage", value: 10, targetId: "202" },
        { id: "d4-extra", label: "Laundry promotion", scope: "item", method: "fixed", value: 100, targetId: "d4-laundry" },
        { id: "d4-reservation", label: "Loyal guest discount", scope: "reservation", method: "fixed", value: 200, targetId: "" },
      ],
      adjustments: [
        { id: "adjustment-d4-late-arrival", amount: 150, reason: "Late arrival service" },
      ],
      audit: [
        audit("created", "Reservation created", d(10)),
        audit("discount_changed", "Room discount added", d(10), "none", "10% on Room 202"),
        audit("discount_changed", "Item discount added", d(10), "none", "₱100 Laundry promotion"),
        audit("discount_changed", "Reservation discount added", d(10), "none", "₱200 Loyal guest discount"),
        audit("adjustment_changed", "Manual adjustment added", d(10), "none", "+₱150 Late arrival service"),
      ],
    },
  ),
  reservation(
    "DEMO-5",
    guestId("Bob Wilson"),
    "cancelled",
    "agoda",
    "Agoda",
    [room("106", d(9), d(11), "2-nights", roomRates.Deluxe["2-nights"])],
    {
      note: "Historical booking via Agoda; this source is now disabled.",
      audit: [
        audit("created", "Reservation created", d(1)),
        audit("cancelled", "Reservation cancelled", d(4), "confirmed", "cancelled"),
      ],
    },
  ),
  reservation(
    "DEMO-6",
    guestId("Bob Wilson"),
    "checked_in",
    "walk-in",
    "Walk-in",
    [room("202", d(8), d(10), "2-nights", roomRates.Suite["2-nights"])],
    {
      discounts: [
        { id: "d6-single", label: "Walk-in promotion", scope: "reservation", method: "percentage", value: 5, targetId: "" },
      ],
      audit: [audit("created", "Reservation created", d(2)), audit("checked_in", "Guest checked in", d(8), "confirmed", "checked_in")],
    },
  ),
  reservation(
    "DEMO-7",
    guestId("David Miller"),
    "checked_out",
    "direct",
    "Direct",
    [room("104", d(4), d(6), "2-nights", roomRates.Standard["2-nights"])],
    { audit: [audit("created", "Reservation created", d(1)), audit("checked_in", "Guest checked in", d(4)), audit("checked_out", "Guest checked out", d(6, 11))] },
  ),
  reservation(
    "DEMO-8",
    guestId("Charlie Brown"),
    "confirmed",
    "agoda",
    "Agoda",
    [room("107", d(10), d(13), "3-nights", historicalRoomRates.Deluxe["3-nights"], {
      charges: [
        { id: "legacy-extra-107", catalogId: "legacy-minibar", label: "Legacy minibar", quantity: 2, unitPrice: 75 },
      ],
      inclusions: [
        { catalogId: "legacy-turn-down", label: "Turn-down service", quantity: 1 },
      ],
      breakfast: [
        { stayDate: "2026-10-11", guestNumber: 1, status: "included", mealId: "legacy-american", mealLabel: "American breakfast", beverageId: "legacy-soda", beverageLabel: "Soda" },
      ],
    })],
    {
      note: "Captured historical room rate remains ₱7,000 although the current 3-night rate is ₱7,800.",
      audit: [
        audit("created", "Reservation created", d(1)),
        audit("price_changed", "Historical rate captured", d(1), "₱7,800 current", "₱7,000 captured"),
        audit("breakfast_changed", "Historical disabled breakfast options retained", d(1), undefined, "American breakfast + Soda"),
        audit("extra_changed", "Historical extras retained", d(1), undefined, "Legacy minibar × 2"),
      ],
    },
  ),
  reservation(
    "DEMO-9",
    guestId("Charlie Brown"),
    "no_show",
    "direct",
    "Direct",
    [room("203", d(2), d(3), "1-night", roomRates.Standard["1-night"])],
    {
      audit: [
        audit("created", "Reservation created", d(1)),
        audit("no_show", "Reservation marked No-show", d(3), "confirmed", "no_show"),
      ],
    },
  ),
];

demoReservations.push(...illustrativeReservations(demoReservations[0]));

export const demoStays: Stay[] = demoReservations.flatMap((reservation, index) =>
  reservation.rooms.map((assignedRoom, roomIndex) => ({
    id: index * 10 + roomIndex + 1,
    reservationId: reservation.id,
    room: assignedRoom.roomNumber,
    guest: sampleGuests.find((guest) => guest.id === reservation.guestId)?.name ?? "",
    checkIn: assignedRoom.checkIn,
    checkOut: assignedRoom.checkOut,
    status:
      reservation.status === "confirmed" || reservation.status === "reserved"
        ? "confirmed"
        : reservation.status === "checked_in"
          ? "checked_in"
          : reservation.status === "checked_out"
            ? "checked_out"
            : reservation.status === "no_show"
              ? "no_show"
              : "cancelled",
  })),
);
