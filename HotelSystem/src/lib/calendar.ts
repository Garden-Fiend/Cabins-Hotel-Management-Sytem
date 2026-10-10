import {
  addHotelDays,
  createHotelDateTime,
  getHotelDateParts,
} from "./hotelTime";

export type CalendarView =
  | "day"
  | "week"
  | "month"
  | "year";

export type CalendarOccupancy = "vacant" | "reserved" | "occupied" | "overdue";
export const calendarOccupancyColors: Record<CalendarOccupancy, string> = {
  vacant: "border-slate-300 bg-slate-100 text-slate-700",
  reserved: "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100",
  occupied: "border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  overdue: "border-rose-400 bg-rose-100 text-rose-900 hover:bg-rose-200",
};
export function getCalendarOccupancy(stay: { status: string; checkOut?: Date }, now = new Date()): CalendarOccupancy {
  if (stay.status === "checked_in") return stay.checkOut && now.getTime() > stay.checkOut.getTime() ? "overdue" : "occupied";
  return stay.status === "confirmed" || stay.status === "reserved" ? "reserved" : "vacant";
}
export function calendarStayClassName(stay: { status: string; checkOut?: Date; housekeepingState?: "clean" | "dirty" | "cleaning"; roomOperational?: boolean }, now = new Date()) {
  if (stay.status === "cancelled" || stay.status === "no_show" || stay.status === "checked_out") {
    return "border-slate-300 bg-slate-100 text-slate-500 opacity-70";
  }
  return calendarOccupancyColors[getCalendarOccupancy(stay, now)];
}

export interface CalendarRange {
  start: Date;
  end: Date;
}

export interface TimelinePosition {
  startRatio: number;
  endRatio: number;
  widthRatio: number;
}

export function addDays(date: Date, days: number) {
  return addHotelDays(date, days);
}

export function addMonths(date: Date, months: number) {
  const parts = getHotelDateParts(date);
  const next = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  return createHotelDateTime(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
}

export function startOfDay(date: Date) {
  const parts = getHotelDateParts(date);
  return createHotelDateTime(parts.year, parts.month, parts.day);
}

export function startOfWeek(date: Date) {
  const result = startOfDay(date);
  const parts = getHotelDateParts(result);
  const day = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();

  // Monday = first day of week
  const difference = day === 0 ? -6 : 1 - day;

  return addHotelDays(result, difference);
}

export function startOfMonth(date: Date) {
  const parts = getHotelDateParts(date);
  return createHotelDateTime(parts.year, parts.month, 1);
}

export function startOfYear(date: Date) {
  const parts = getHotelDateParts(date);
  return createHotelDateTime(parts.year, 1, 1);
}

export function getCalendarRange(
  view: CalendarView,
  anchorDate: Date,
): CalendarRange {
  switch (view) {
    case "day": {
      const start = startOfDay(anchorDate);

      return {
        start,
        end: addDays(start, 1),
      };
    }

    case "week": {
      const start = startOfWeek(anchorDate);

      return {
        start,
        end: addDays(start, 7),
      };
    }

    case "month": {
      const start = startOfMonth(anchorDate);

      return {
        start,
        end: addMonths(start, 1),
      };
    }

    case "year": {
      const start = startOfYear(anchorDate);
      const parts = getHotelDateParts(start);

      return {
        start,
        end: createHotelDateTime(parts.year + 1, 1, 1),
      };
    }
  }
}

export function getCalendarDates(
  view: CalendarView,
  anchorDate: Date,
) {
  switch (view) {
    case "day":
      return [startOfDay(anchorDate)];

    case "week": {
      const start = startOfWeek(anchorDate);

      return Array.from(
        { length: 7 },
        (_, index) => addDays(start, index),
      );
    }

    case "month": {
      const start = startOfMonth(anchorDate);

      const parts = getHotelDateParts(anchorDate);
      const daysInMonth = new Date(
        Date.UTC(parts.year, parts.month, 0),
      ).getUTCDate();

      return Array.from(
        { length: daysInMonth },
        (_, index) => addDays(start, index),
      );
    }

    case "year":
      return Array.from(
        { length: 12 },
        (_, index) =>
          createHotelDateTime(getHotelDateParts(anchorDate).year, index + 1, 1),
      );
  }
}

/**
 * Converts a datetime into a position inside a timeline.
 *
 * 0   = beginning of timeline
 * 0.5 = halfway through timeline
 * 1   = end of timeline
 *
 * The result is intentionally fractional.
 * No rounding is performed.
 */
export function getTimelineRatio(
  date: Date,
  range: CalendarRange,
) {
  const totalDuration =
    range.end.getTime() - range.start.getTime();

  if (totalDuration <= 0) {
    return 0;
  }

  const elapsed =
    date.getTime() - range.start.getTime();

  return elapsed / totalDuration;
}

/**
 * Calculates the visible portion of a stay inside
 * the calendar's current timeline.
 *
 * The stay itself is never modified.
 */
export function getStayPosition(
  checkIn: Date,
  checkOut: Date,
  range: CalendarRange,
): TimelinePosition | null {
  if (checkOut <= checkIn) {
    return null;
  }

  // Completely outside the visible calendar.
  if (
    checkOut <= range.start ||
    checkIn >= range.end
  ) {
    return null;
  }

  const visibleStart =
    checkIn < range.start
      ? range.start
      : checkIn;

  const visibleEnd =
    checkOut > range.end
      ? range.end
      : checkOut;

  const startRatio = getTimelineRatio(
    visibleStart,
    range,
  );

  const endRatio = getTimelineRatio(
    visibleEnd,
    range,
  );

  return {
    startRatio,
    endRatio,
    widthRatio: endRatio - startRatio,
  };
}


export function getYearStayPosition(
  checkIn: Date,
  checkOut: Date,
  range: CalendarRange,
): TimelinePosition | null {
  if (checkOut <= checkIn) {
    return null;
  }

  // Completely outside the visible year.
  if (
    checkOut <= range.start ||
    checkIn >= range.end
  ) {
    return null;
  }

  const visibleStart =
    checkIn < range.start
      ? range.start
      : checkIn;

  const visibleEnd =
    checkOut > range.end
      ? range.end
      : checkOut;

  const totalMonths = 12;

  function monthIndex(date: Date) {
    const dateParts = getHotelDateParts(date);
    const rangeParts = getHotelDateParts(range.start);
    return (
      (dateParts.year - rangeParts.year) * 12 +
      (dateParts.month - rangeParts.month)
    );
  }

  function ratioInsideMonth(date: Date) {
    const parts = getHotelDateParts(date);
    const monthStart = createHotelDateTime(parts.year, parts.month, 1);
    const monthEnd = addMonths(monthStart, 1);

    return getTimelineRatio(date, {
      start: monthStart,
      end: monthEnd,
    });
  }

  const startPosition =
    monthIndex(visibleStart) +
    ratioInsideMonth(visibleStart);

  const endPosition =
    monthIndex(visibleEnd) +
    ratioInsideMonth(visibleEnd);

  const startRatio =
    startPosition / totalMonths;

  const endRatio =
    endPosition / totalMonths;

  return {
    startRatio,
    endRatio,
    widthRatio: endRatio - startRatio,
  };
}
/**
 * Keeps a ratio safely inside the timeline.
 */
export function clampRatio(ratio: number) {
  return Math.min(1, Math.max(0, ratio));
}