export const HOTEL_TIME_ZONE = "Asia/Manila";
const HOTEL_UTC_OFFSET_MINUTES = 8 * 60;

export interface HotelDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getHotelDateParts(date: Date): HotelDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HOTEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function createHotelDateTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) -
      HOTEL_UTC_OFFSET_MINUTES * 60_000,
  );
}

export function parseHotelDateTimeInput(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, year, month, day, hour, minute] = match.map(Number);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59
  ) {
    return new Date(Number.NaN);
  }
  return createHotelDateTime(year, month, day, hour, minute);
}

export function toHotelDateTimeInput(date: Date) {
  const parts = getHotelDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function hotelDateKey(date: Date) {
  const parts = getHotelDateParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function startOfHotelDay(date: Date) {
  const parts = getHotelDateParts(date);
  return createHotelDateTime(parts.year, parts.month, parts.day);
}

export function addHotelDays(date: Date, count: number) {
  const parts = getHotelDateParts(date);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return createHotelDateTime(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second,
  );
}

export function isValidHotelTime(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function hotelDateAtTime(date: Date, time: string) {
  const match = isValidHotelTime(time)
    ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
    : null;
  if (!match) return new Date(Number.NaN);
  const [, rawHour, rawMinute] = match;
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const parts = getHotelDateParts(date);
  return createHotelDateTime(
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
  );
}

export function formatHotelDate(
  date: Date,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-PH", {
    ...options,
    timeZone: HOTEL_TIME_ZONE,
  }).format(date);
}
