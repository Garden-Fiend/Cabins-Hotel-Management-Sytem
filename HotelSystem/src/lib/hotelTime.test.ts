import { describe, expect, it } from "vitest";

import {
  createHotelDateTime,
  formatHotelDate,
  getHotelDateParts,
  hotelDateKey,
  parseHotelDateTimeInput,
  toHotelDateTimeInput,
} from "./hotelTime";
import { getCalendarRange } from "./calendar";

describe("Asia/Manila time boundary", () => {
  it("round-trips date-time inputs independent of the browser timezone", () => {
    const value = "2026-10-08T14:35";
    const date = parseHotelDateTimeInput(value);

    expect(toHotelDateTimeInput(date)).toBe(value);
    expect(hotelDateKey(date)).toBe("2026-10-08");
    expect(formatHotelDate(date, { dateStyle: "medium", timeStyle: "short" })).toContain(
      "2:35 PM",
    );
  });

  it("builds calendar ranges from the hotel-local date", () => {
    const anchor = createHotelDateTime(2026, 10, 8, 23, 30);
    const range = getCalendarRange("day", anchor);

    expect(getHotelDateParts(range.start)).toMatchObject({
      year: 2026,
      month: 10,
      day: 8,
      hour: 0,
    });
    expect(getHotelDateParts(range.end)).toMatchObject({
      year: 2026,
      month: 10,
      day: 9,
      hour: 0,
    });
  });

  it("rejects impossible hotel-local date-time input", () => {
    expect(parseHotelDateTimeInput("2026-02-30T14:00").getTime()).toBeNaN();
    expect(parseHotelDateTimeInput("2026-10-08T24:00").getTime()).toBeNaN();
  });
});
