import type { Stay } from "../../types/booking";
import type { CalendarReservationContext } from "../../types/reservation";
import { findClash } from "../../utils/availability";

import {
  calendarStayClassName,
  getCalendarDates,
  getCalendarRange,
  getStayPosition,
} from "../../lib/calendar";
import { hotelDateAtTime } from "../../lib/hotelTime";

interface WeekCalendarProps {
  rooms: string[];
  stays: Stay[];
  anchorDate: Date;
  onStayClick?: (stay: Stay) => void;
  onRoomTimeSelect?: (roomId: string, start: Date) => void;
  draftContexts: CalendarReservationContext[];
  onDraftContextClick?: (reservationId: string) => void;
}

const ROOM_WIDTH = 96;
const MIN_DAY_WIDTH = 110;
const ROW_HEIGHT = 64;

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function WeekCalendar({
  rooms,
  stays,
  anchorDate,
  onStayClick,
  onRoomTimeSelect,
  draftContexts,
  onDraftContextClick,
}: WeekCalendarProps) {
  const dates = getCalendarDates("week", anchorDate);
  const calendarRange = getCalendarRange("week", anchorDate);

  const minimumCalendarWidth =
    ROOM_WIDTH + dates.length * MIN_DAY_WIDTH;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="grid w-full"
        style={{
          minWidth: minimumCalendarWidth,
          gridTemplateColumns: `${ROOM_WIDTH}px minmax(0, 1fr)`,
        }}
      >
        {/* =========================
            HEADER
        ========================== */}

        <div
          className="
            sticky left-0 z-30
            flex items-center
            border-b border-r border-slate-200
            bg-white
            px-4
            text-sm font-semibold text-slate-700
          "
          style={{
            height: ROW_HEIGHT,
          }}
        >
          Room
        </div>

        <div
          className="grid border-b border-slate-200"
          style={{
            gridTemplateColumns: `repeat(${dates.length}, minmax(${MIN_DAY_WIDTH}px, 1fr))`,
          }}
        >
          {dates.map((date) => (
            <div
              key={date.toISOString()}
              className="
                flex flex-col
                items-center justify-center
                border-r border-slate-200
              "
            >
              <span className="text-xs font-medium uppercase text-slate-400">
                {formatWeekday(date)}
              </span>

              <span className="text-sm font-semibold text-slate-700">
                {formatDay(date)}
              </span>
            </div>
          ))}
        </div>

        {/* =========================
            ROOMS
        ========================== */}

        {rooms.map((room) => {
          const roomStays = stays.filter(
            (stay) =>
              stay.room === room &&
              stay.checkIn < calendarRange.end &&
              stay.checkOut > calendarRange.start,
          );

          return (
            <div
              key={room}
              className="contents"
            >
              {/* Room name */}

              <div
                className="
                  sticky left-0 z-20
                  flex items-center
                  border-b border-r border-slate-200
                  bg-white
                  px-4
                "
                style={{
                  height: ROW_HEIGHT,
                }}
              >
                <span className="text-sm font-medium text-slate-700">
                  {room}
                </span>
              </div>

              {/* =========================
                  TIMELINE
              ========================== */}

              <div
                className="relative border-b border-slate-200"
                style={{
                  height: ROW_HEIGHT,
                }}
              >
                {/* =========================
                    DATE GRID LAYER
                ========================== */}

                <div
                  className="absolute inset-0 z-0 grid"
                  style={{
                    gridTemplateColumns: `repeat(${dates.length}, minmax(${MIN_DAY_WIDTH}px, 1fr))`,
                  }}
                >
                  {dates.map((date) => {
                    const start = hotelDateAtTime(date, "14:00");
                    const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
                    const unavailable = Boolean(
                      findClash(stays, room, start, end),
                    );
                    return (
                    <button
                      key={date.toISOString()}
                      type="button"
                      aria-label={`Select Room ${room} on ${new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeZone: "Asia/Manila",
                      }).format(date)}`}
                      disabled={unavailable}
                      onClick={() => onRoomTimeSelect?.(room, start)}
                      className="border-r border-slate-100 bg-transparent hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50/70"
                    />
                    );
                  })}
                </div>

                {draftContexts
                  .filter((context) => context.roomId === room)
                  .map((context) => {
                    const position = getStayPosition(
                      context.start,
                      context.end,
                      calendarRange,
                    );
                    if (!position) return null;
                    return (
                      <button
                        key={context.reservationId ?? "draft"}
                        type="button"
                        onClick={() =>
                          context.reservationId &&
                          onDraftContextClick?.(context.reservationId)
                        }
                        className="absolute top-1 z-[5] h-14 border-2 border-dashed border-emerald-500 bg-emerald-100/40"
                        style={{
                          left: `${position.startRatio * 100}%`,
                          width: `${position.widthRatio * 100}%`,
                        }}
                        aria-label={`Draft stay for Room ${room}`}
                      />
                    );
                  })}

                {/* =========================
                    RESERVATION LAYER
                ========================== */}

                <div className="pointer-events-none absolute inset-0">
                  {roomStays.map((stay) => {
                    const position = getStayPosition(
                      stay.checkIn,
                      stay.checkOut,
                      calendarRange,
                    );

                    if (!position) {
                      return null;
                    }

                    return (
                      <button
                        key={stay.id}
                        type="button"
                        onClick={() =>
                          onStayClick?.(stay)
                        }
                        className={`pointer-events-auto absolute top-2 z-10 h-12 min-w-0 cursor-pointer overflow-hidden rounded-md border px-3 text-left text-xs font-medium shadow-sm transition hover:shadow-md ${calendarStayClassName(stay)}`}
                        style={{
                          left: `${position.startRatio * 100}%`,
                          width: `${position.widthRatio * 100}%`,
                          marginLeft: "4px",
                          marginRight: "4px",
                        }}
                      >
                        <div className="truncate font-semibold">
                          {stay.guest}
                        </div>

                        <div className="mt-0.5 truncate text-[10px] opacity-70">
                          {stay.status.replace(
                            "_",
                            " ",
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}