import type { Stay } from "../../types/booking";
import type { CalendarReservationContext } from "../../types/reservation";
import { findClash } from "../../utils/availability";

import {
  calendarStayClassName,
  getCalendarDates,
  getCalendarRange,
  getYearStayPosition,
} from "../../lib/calendar";
import { createHotelDateTime, getHotelDateParts } from "../../lib/hotelTime";

interface YearCalendarProps {
  rooms: string[];
  stays: Stay[];
  anchorDate: Date;
  onStayClick?: (stay: Stay) => void;
  onRoomTimeSelect?: (roomId: string, start: Date) => void;
  draftContexts: CalendarReservationContext[];
  onDraftContextClick?: (reservationId: string) => void;
}

const ROOM_WIDTH = 96;
const MIN_MONTH_WIDTH = 90;
const ROW_HEIGHT = 64;

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function YearCalendar({
  rooms,
  stays,
  anchorDate,
  onStayClick,
  onRoomTimeSelect,
  draftContexts,
  onDraftContextClick,
}: YearCalendarProps) {
  const months = getCalendarDates("year", anchorDate);
  const calendarRange = getCalendarRange("year", anchorDate);

  const minimumCalendarWidth = ROOM_WIDTH + months.length * MIN_MONTH_WIDTH;

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
            gridTemplateColumns: `repeat(
              ${months.length},
              minmax(${MIN_MONTH_WIDTH}px, 1fr)
            )`,
          }}
        >
          {months.map((month) => (
            <div
              key={month.toISOString()}
              className="
                flex items-center justify-center
                border-r border-slate-200
                text-sm font-semibold text-slate-700
              "
              style={{
                height: ROW_HEIGHT,
              }}
            >
              {formatMonth(month)}
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
            <div key={room} className="contents">
              {/* =========================
                  ROOM NAME
              ========================== */}

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
                    gridTemplateColumns: `repeat(
                      ${months.length},
                      minmax(${MIN_MONTH_WIDTH}px, 1fr)
                    )`,
                  }}
                >
                  {months.map((month) => {
                    const parts = getHotelDateParts(month);
                    const start = createHotelDateTime(
                      parts.year,
                      parts.month,
                      1,
                      14,
                    );
                    const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
                    return (
                    <button
                      key={month.toISOString()}
                      type="button"
                      aria-label={`Select Room ${room} in ${formatMonth(month)} ${parts.year}`}
                      disabled={Boolean(findClash(stays, room, start, end))}
                      onClick={() => onRoomTimeSelect?.(room, start)}
                      className="border-r border-slate-100 bg-transparent hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-slate-50/70"
                    />
                    );
                  })}
                </div>

                {draftContexts
                  .filter((context) => context.roomId === room)
                  .map((context) => {
                    const position = getYearStayPosition(
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
                    const position = getYearStayPosition(
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
                        title={`${stay.guest} — ${stay.status.replace(
                          "_",
                          " ",
                        )}`}
                        className={`pointer-events-auto absolute top-2 z-10 h-12 min-w-0 cursor-pointer overflow-hidden rounded-md border px-3 text-left text-xs font-medium shadow-sm transition hover:shadow-md ${calendarStayClassName(stay)}`}
                        style={{
                          left: `${position.startRatio * 100}%`,
                          width: `${position.widthRatio * 100}%`,
                          marginLeft: "4px",
                          marginRight: "4px",
                        }}
                      >
                        <div className="truncate font-semibold leading-4">
                          {stay.guest}
                        </div>

                        <div className="truncate text-[10px] leading-3 opacity-70">
                          {stay.status.replace("_", " ")}
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
