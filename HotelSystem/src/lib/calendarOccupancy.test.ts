import { describe, expect, it } from "vitest";
import { calendarStayClassName, getCalendarOccupancy, getStayPosition, getCalendarRange } from "./calendar";
import { createHotelDateTime } from "./hotelTime";

const noon = createHotelDateTime(2026, 10, 10, 12);
describe("calendar occupancy colors", () => {
  it("uses occupancy rather than operational or housekeeping status", () => {
    expect(calendarStayClassName({ status: "draft" }, noon)).toContain("bg-slate-100");
    expect(calendarStayClassName({ status: "reserved", housekeepingState: "dirty", roomOperational: false }, noon)).toContain("bg-blue-50");
    expect(calendarStayClassName({ status: "confirmed", housekeepingState: "clean" }, noon)).toContain("bg-blue-50");
    expect(calendarStayClassName({ status: "checked_in", checkOut: noon, housekeepingState: "dirty" }, noon)).toContain("bg-emerald-50");
    expect(calendarStayClassName({ status: "checked_in", checkOut: noon }, createHotelDateTime(2026, 10, 10, 12, 1))).toContain("bg-rose-100");
  });
  it("respects the current scheduled checkout after extension", () => {
    const now = createHotelDateTime(2026, 10, 10, 12, 1);
    expect(getCalendarOccupancy({ status: "checked_in", checkOut: noon }, now)).toBe("overdue");
    expect(getCalendarOccupancy({ status: "checked_in", checkOut: createHotelDateTime(2026, 10, 10, 15) }, now)).toBe("occupied");
  });
  it("preserves completed/inactive styling and positioning", () => {
    for (const status of ["checked_out", "cancelled", "no_show"]) expect(calendarStayClassName({ status, checkOut: noon }, createHotelDateTime(2026, 10, 11))).toBe("border-slate-300 bg-slate-100 text-slate-500 opacity-70");
    const position = getStayPosition(createHotelDateTime(2026, 10, 10, 6), noon, getCalendarRange("day", noon));
    expect(position?.widthRatio).toBe(0.25);
  });
});
