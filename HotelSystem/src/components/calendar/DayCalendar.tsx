import type { Stay } from "../../types/booking";
import type { CalendarReservationContext } from "../../types/reservation";
import { findClash } from "../../utils/availability";

import {
  calendarStayClassName,
  getCalendarRange,
  getStayPosition,
} from "../../lib/calendar";
import { createHotelDateTime, getHotelDateParts, hotelDateAtTime } from "../../lib/hotelTime";

interface DayCalendarProps {
  rooms: string[];
  stays: Stay[];
  anchorDate: Date;
  onStayClick?: (stay: Stay) => void;
  onRoomTimeSelect?: (roomId: string, start: Date) => void;
  draftContexts: CalendarReservationContext[];
  onDraftContextClick?: (reservationId: string) => void;
}

const ROOM_WIDTH = 96;
const HOUR_WIDTH = 64;
const ROW_HEIGHT = 64;

function formatHour(hour: number) {
  const date = createHotelDateTime(2000, 1, 1, hour);

  return new Intl.DateTimeFormat("en-PH", {
    hour: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function DayCalendar({
  rooms,
  stays,
  anchorDate,
  onStayClick,
  onRoomTimeSelect,
  draftContexts,
  onDraftContextClick,
}: DayCalendarProps) {
  const calendarRange = getCalendarRange(
    "day",
    anchorDate,
  );

  const hours = Array.from(
    { length: 24 },
    (_, index) => index,
  );

  const timelineWidth = hours.length * HOUR_WIDTH;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <div
        className="min-w-max"
        style={{
          width: ROOM_WIDTH + timelineWidth,
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
              height: ROW_HEIGHT,
            }}
          >
            Room
          </div>

          <div
            className="flex"
            style={{
              width: timelineWidth,
            }}
          >
            {hours.map((hour) => (
              <div
                key={hour}
                className="
                  flex shrink-0
                  items-center justify-center
                  border-r border-slate-200
                  text-xs font-medium
                  text-slate-400
                "
                style={{
                  width: HOUR_WIDTH,
                  height: ROW_HEIGHT,
                }}
              >
                {formatHour(hour)}
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
              {/* Room */}

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
                    HOUR GRID
                ========================== */}

                <div className="absolute inset-0 z-0 flex">
                  {hours.map((hour) => (
                    <button
                      key={hour}
                      type="button"
                      aria-label={`Select Room ${room} at ${formatHour(hour)}`}
                      disabled={Boolean(
                        (() => {
                          const start = hotelDateAtTime(
                            calendarRange.start,
                            `${String(hour).padStart(2, "0")}:00`,
                          );
                          return findClash(
                            stays,
                            room,
                            start,
                            new Date(start.getTime() + 12 * 60 * 60 * 1000),
                          );
                        })(),
                      )}
                      className="
                        shrink-0
                        border-r border-slate-100
                        bg-transparent hover:bg-blue-50
                      "
                      onClick={(event) => {
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        const fraction = Math.max(
                          0,
                          Math.min(
                            1,
                            (event.clientX - bounds.left) / bounds.width,
                          ),
                        );
                        const parts = getHotelDateParts(calendarRange.start);
                        const start = createHotelDateTime(
                          parts.year,
                          parts.month,
                          parts.day,
                          hour,
                          Math.floor(fraction * 60),
                        );
                        onRoomTimeSelect?.(room, start);
                      }}
                      style={{
                        width: HOUR_WIDTH,
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
                    RESERVATIONS
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