import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, runtimeConfiguration } from "./client";
import { apiInstant, formatPhp, phpDecimal, presentReservation } from "./presentation";
import type { ReservationDto } from "./contracts";

afterEach(() => vi.unstubAllGlobals());

describe("explicit mode and typed API boundary", () => {
  it("defaults only an unconfigured mode to demo and fails closed on invalid API configuration", () => {
    expect(runtimeConfiguration({}).mode).toBe("demo");
    expect(() => runtimeConfiguration({ VITE_HMS_DATA_MODE: "bad" })).toThrow();
    expect(() => runtimeConfiguration({ VITE_HMS_DATA_MODE: "api" })).toThrow("requires");
    expect(() => runtimeConfiguration({ VITE_HMS_DATA_MODE: "api", VITE_HMS_API_URL: "http://user:secret@localhost" })).toThrow();
    expect(runtimeConfiguration({ VITE_HMS_DATA_MODE: "api", VITE_HMS_API_URL: "http://127.0.0.1:8001/" })).toEqual({ mode: "api", baseUrl: "http://127.0.0.1:8001" });
  });
  it("loads all list pages rather than dropping records after the first hundred", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: `id-${i}` })))))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "last-id" }])));
    vi.stubGlobal("fetch", fetcher);
    expect(await new ApiClient("http://localhost").guests()).toHaveLength(101);
    expect(fetcher.mock.calls[1][0]).toContain("offset=100");
  });
  it("sends only allowlisted patch data and a supplied idempotency key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "saved" })));
    vi.stubGlobal("fetch", fetcher);
    await new ApiClient("http://localhost").patchReservation("uuid", { expected_version: 1, note: "Changed" }, "request-uuid");
    expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe("request-uuid");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expected_version: 1, note: "Changed" });
  });
  it("distinguishes an explicit 409 from an unconfirmed network mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "version_conflict", message: "Stale" }), { status: 409 })));
    await expect(new ApiClient("http://localhost").patchReservation("uuid", { expected_version: 1, note: "Changed" }, "key")).rejects.toMatchObject({ status: 409, uncertain: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    await expect(new ApiClient("http://localhost").createGuest({ name: "Guest" }, "key")).rejects.toMatchObject({ uncertain: true });
    await expect(new ApiClient("http://localhost").guests()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("canonical presentation adapter", () => {
  it("retains raw UUIDs/version/timestamp precision and uses the server business number for calendar display", () => {
    const dto = {
      id: "canonical-uuid", version: 4, business_number: 42, status: "confirmed", guest: { name: "Guest" },
      allocation: { id: "allocation-uuid", room_id: "room-uuid", scheduled_start: "2026-11-10T06:07:12.123456Z",
        scheduled_end: "2026-11-10T12:07:12.123456Z", actual_check_in: null, actual_check_out: null },
      pricing: { snapshot: { currency: "PHP", total_minor: 110000, lines: [{ room_id: "room-uuid", room_number: "101" }] } },
    } as ReservationDto;
    const presented = presentReservation(dto);
    expect(presented.canonical).toBe(dto);
    expect(presented.canonical.allocation.scheduled_start).toContain("123456");
    expect(presented.stay.id).toBe(42);
    expect(presented.stay.reservationId).toBe("canonical-uuid");
    expect(presented.stay.checkIn.getUTCMilliseconds()).toBe(123);
  });
  it("formats PHP from integer minor units without losing large-value cents", () => {
    expect(formatPhp(110000)).toBe("₱1,100.00");
    expect(formatPhp(Number.MAX_SAFE_INTEGER)).toBe("₱90,071,992,547,409.91");
    expect(phpDecimal(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(() => formatPhp(1.5)).toThrow();
    expect(() => apiInstant("2026-11-10T14:07:00")).toThrow();
  });
});
