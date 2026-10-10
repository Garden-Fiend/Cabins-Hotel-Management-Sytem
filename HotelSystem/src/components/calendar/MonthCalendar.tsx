import type { Stay } from "../../types/booking";
import type { CalendarReservationContext } from "../../types/reservation";
import { findClash } from "../../utils/availability";

import {
  calendarStayClassName,
  getCalendarOccupancy,
  getCalendarDates,
  getCalendarRange,
  getStayPosition,
} from "../../lib/calendar";
import { hotelDateAtTime } from "../../lib/hotelTime";

interface MonthCalendarProps {
  now?: Date;
  rooms: string[];
  stays: Stay[];
  anchorDate: Date;
  onStayClick?: (stay: Stay) => void;
  onRoomTimeSelect?: (roomId: string, start: Date) => void;
  draftContexts: CalendarReservationContext[];
  onDraftContextClick?: (reservationId: string) => void;
}

const ROOM_WIDTH = 96;
const MIN_DAY_WIDTH = 88;
const ROW_HEIGHT = 64;

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function MonthCalendar({
  now = new Date(),
  rooms,
  stays,
  anchorDate,
  onStayClick,
  onRoomTimeSelect,
  draftContexts,
  onDraftContextClick,
}: MonthCalendarProps) {
  const dates = getCalendarDates("month", anchorDate);
  const calendarRange = getCalendarRange("month", anchorDate);

  const timelineWidth = dates.length * MIN_DAY_WIDTH;
  const minimumCalendarWidth = ROOM_WIDTH + timelineWidth;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="min-w-max"
        style={{
          minWidth: minimumCalendarWidth,
        }}
      >
        {/* =========================
            HEADER
        ========================== */}

        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-white">
          <div
            className="
              sticky left-0 z-30
              flex shrink-0 items-center
              border-r border-slate-200
              bg-white
              px-4
              text-sm font-semibold text-slate-700
            "
            style={{
              width: ROOM_WIDTH,
            }}
          >
            Room
          </div>

          <div className="flex">
            {dates.map((date) => (
              <div
                key={date.toISOString()}
                className="
                  flex shrink-0 flex-col
                  items-center justify-center
                  border-r border-slate-200
                "
                style={{
                  width: MIN_DAY_WIDTH,
                  height: ROW_HEIGHT,
                }}
              >
                <span className="text-xs font-medium uppercase text-slate-400">
                  {formatMonth(date)}
                </span>

                <span className="text-sm font-semibold text-slate-700">
                  {formatDay(date)}
                </span>
              </div>
            ))}
          </div>
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
              className="flex border-b border-slate-200 last:border-b-0"
              style={{
                height: ROW_HEIGHT,
              }}
            >
              {/* Room name */}

              <div
                className="
                  sticky left-0 z-10
                  flex shrink-0 items-center
                  border-r border-slate-200
                  bg-white
                  px-4
                "
                style={{
                  width: ROOM_WIDTH,
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
                className="relative shrink-0"
                style={{
                  width: timelineWidth,
                  height: ROW_HEIGHT,
                }}
              >
                {/* =========================
                    DATE GRID LAYER
                ========================== */}

                <div className="absolute inset-0 z-0 flex">
                  {dates.map((date) => (
                    <button
                      key={date.toISOString()}
                      type="button"
                      aria-label={`Select Room ${room} on ${new Intl.DateTimeFormat("en-PH", {
                        dateStyle: "medium",
                        timeZone: "Asia/Manila",
                      }).format(date)}`}
                      disabled={Boolean(
                        findClash(
                          stays,
                          room,
                          hotelDateAtTime(date, "14:00"),
                          new Date(hotelDateAtTime(date, "14:00").getTime() + 12 * 60 * 60 * 1000),
                        ),
                      )}
                      onClick={() => {
                        const start = hotelDateAtTime(date, "14:00");
                        onRoomTimeSelect?.(room, start);
                      }}
                      className="shrink-0 border-r border-slate-100 bg-slate-50 hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50/70"
                      style={{
                        width: MIN_DAY_WIDTH,
                      }}
                    />
                  ))}
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
                        onClick={() => onStayClick?.(stay)}
                        className={`pointer-events-auto absolute top-2 z-10 h-12 min-w-0 cursor-pointer overflow-hidden rounded-md border px-3 text-left text-xs font-medium shadow-sm transition hover:shadow-md ${calendarStayClassName(stay, now)}`}
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
                          {stay.status === "checked_in" ? getCalendarOccupancy(stay, now) : stay.status.replace("_", " ")}
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