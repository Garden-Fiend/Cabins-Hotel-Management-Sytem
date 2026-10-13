import { describe, expect, it } from "vitest";
import { reservationEditInput } from "./reservationEditInput";
import type { ReservationDto, ReferencesDto } from "./contracts";
import type { ReservationSnapshot } from "../../types/reservation";

const start = new Date("2026-11-10T06:07:12.123Z");
const original = { id: "reservation", guestId: "original-guest", serverVersion: 1, note: "Original", adjustments: [],
  rooms: [{ roomNumber: "101", durationId: "old-duration", checkIn: start, adults: 2, children: 1 }] } as unknown as ReservationSnapshot;
const canonical = { id: "reservation", guest: { id: "remote-guest" },
  allocation: { room_id: "remote-room", duration_id: "remote-duration", scheduled_start: "2026-11-11T06:07:12.123456Z" },
  pricing: { snapshot: { adjustments: [] } } } as unknown as ReservationDto;
const refs = { capabilities: ["reservation.guest-edit.v1", "reservation.stay-edit.v1", "reservation.adjustments.v1", "reservation.purchases.v1"],
  rooms: [{ id: "original-room", number: "101" }, { id: "new-room", number: "202" }] } as ReferencesDto;
const draft = { guestId: original.guestId, note: original.note, adults: 2, children: 1,
  roomNumber: "101", durationId: "old-duration", start, adjustments: [] };

describe("reservation edit intents", () => {
  it("preserves remotely edited untouched fields after explicit review", () => {
    expect(reservationEditInput(original, { ...draft, note: "My draft" }, canonical, refs, 5))
      .toEqual({ expected_version: 5, note: "My draft" });
    expect(reservationEditInput(original, { ...draft, roomNumber: "202" }, canonical, refs, 5))
      .toEqual({ expected_version: 5, guest_id: "remote-guest", room_id: "new-room",
        duration_id: "remote-duration", scheduled_start: "2026-11-11T06:07:12.123456Z" });
  });
  it("combines changed stay, guest, counts and adjustments into one command", () => {
    expect(reservationEditInput(original, { ...draft, guestId: "my-guest", durationId: "my-duration", children: 0,
      adjustments: [{ id: "adjustment", amount: -100.25, reason: "Correction" }] }, canonical, refs, 5))
      .toEqual({ expected_version: 5, guest_id: "my-guest", children: 0, room_id: "remote-room",
        duration_id: "my-duration", scheduled_start: canonical.allocation.scheduled_start,
        adjustments: [{ id: "adjustment", amount_minor: -10025, reason: "Correction" }] });
  });
  it("keeps unchanged large captured minor amounts exact when another adjustment is added", () => {
    const captured = { id: "large", amount_minor: Number.MAX_SAFE_INTEGER, reason: "Captured" };
    const prior = { ...original, adjustments: [{ id: captured.id, amount: captured.amount_minor / 100, reason: captured.reason }] };
    const current = { ...canonical, pricing: { ...canonical.pricing, snapshot: { ...canonical.pricing.snapshot, adjustments: [captured] } } };
    const body = reservationEditInput(prior, { ...draft, adjustments: [...prior.adjustments, { id: "new", amount: -1, reason: "Reduction" }] }, current, refs, 5);
    expect(body && "adjustments" in body && body.adjustments?.[0]).toEqual(captured);
  });
  it("does not authorize no-op requests, unknown versions or unsupported changes", () => {
    expect(reservationEditInput(original, draft, canonical, refs, 1)).toBeUndefined();
    expect(() => reservationEditInput(original, { ...draft, note: "Changed" }, canonical, refs, 0)).toThrow("version");
    expect(() => reservationEditInput(original, { ...draft, roomNumber: "202" }, canonical, { ...refs, capabilities: [] }, 1)).toThrow("not supported");
  });
  it("sends product identities and quantities without trusting client unit prices", () => {
    const body = reservationEditInput(original, { ...draft, roomNumber: "202", charges: [{ id: "line", catalogId: "product", quantity: 3,
      label: "Forged label", unitPrice: 0.01, usage: "purchase" }] }, canonical, refs, 5);
    expect(body).toEqual({ expected_version: 5, guest_id: "remote-guest", room_id: "new-room", duration_id: "remote-duration",
      scheduled_start: canonical.allocation.scheduled_start, charges: [{ id: "line", product_id: "product", quantity: 3, usage: "purchase" }] });
  });
});
