import type { Stay } from "../types/booking";
import type { CalendarView } from "../lib/calendar";
import type { CalendarReservationContext } from "../types/reservation";

import { DayCalendar } from "./calendar/DayCalendar";
import { WeekCalendar } from "./calendar/WeekCalendar";
import { MonthCalendar } from "./calendar/MonthCalendar";
import { YearCalendar } from "./calendar/YearCalendar";

interface AvailabilityCalendarProps {
  rooms: string[];
  stays: Stay[];
  view: CalendarView;
  anchorDate: Date;
  onStayClick?: (stay: Stay) => void;
  onRoomTimeSelect?: (roomId: string, start: Date) => void;
  draftContexts?: CalendarReservationContext[];
  onDraftContextClick?: (reservationId: string) => void;
}

export function AvailabilityCalendar({
  rooms,
  stays,
  view,
  anchorDate,
  onStayClick,
  onRoomTimeSelect,
  draftContexts = [],
  onDraftContextClick,
}: AvailabilityCalendarProps) {
  switch (view) {
    case "day":
      return (
        <DayCalendar
          rooms={rooms}
          stays={stays}
          anchorDate={anchorDate}
          onStayClick={onStayClick}
          onRoomTimeSelect={onRoomTimeSelect}
          draftContexts={draftContexts}
          onDraftContextClick={onDraftContextClick}
        />
      );

    case "week":
      return (
        <WeekCalendar
          rooms={rooms}
          stays={stays}
          anchorDate={anchorDate}
          onStayClick={onStayClick}
          onRoomTimeSelect={onRoomTimeSelect}
          draftContexts={draftContexts}
          onDraftContextClick={onDraftContextClick}
        />
      );

    case "month":
      return (
        <MonthCalendar
          rooms={rooms}
          stays={stays}
          anchorDate={anchorDate}
          onStayClick={onStayClick}
          onRoomTimeSelect={onRoomTimeSelect}
          draftContexts={draftContexts}
          onDraftContextClick={onDraftContextClick}
        />
      );

    case "year":
      return (
        <YearCalendar
          rooms={rooms}
          stays={stays}
          anchorDate={anchorDate}
          onStayClick={onStayClick}
          onRoomTimeSelect={onRoomTimeSelect}
          draftContexts={draftContexts}
          onDraftContextClick={onDraftContextClick}
        />
      );
  }
}