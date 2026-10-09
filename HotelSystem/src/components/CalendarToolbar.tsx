import type { CalendarView } from "../lib/calendar";
import type { ReactNode } from "react";

interface CalendarToolbarProps {
  view: CalendarView;
  anchorDate: Date;
  onViewChange: (view: CalendarView) => void;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  rightContent?: ReactNode;
}

function formatTitle(view: CalendarView, date: Date) {
  const options: Intl.DateTimeFormatOptions =
    view === "year"
      ? { year: "numeric" }
      : view === "day"
        ? {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          }
        : {
            month: "long",
            year: "numeric",
          };

  return new Intl.DateTimeFormat("en-PH", {
    ...options,
    timeZone: "Asia/Manila",
  }).format(date);
}

export function CalendarToolbar({
  view,
  anchorDate,
  onViewChange,
  onPrevious,
  onNext,
  onToday,
  rightContent,
}: CalendarToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 md:gap-4">
      {/* Date navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          className="rounded-md border border-slate-200 px-2.5 py-2 text-sm hover:bg-slate-50 md:px-3"
          aria-label="Previous period"
        >
          ←
        </button>

        <button
          type="button"
          onClick={onToday}
          className="rounded-md border border-slate-200 px-2.5 py-2 text-sm font-medium hover:bg-slate-50 md:px-3"
        >
          Today
        </button>

        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-slate-200 px-2.5 py-2 text-sm hover:bg-slate-50 md:px-3"
          aria-label="Next period"
        >
          →
        </button>

        <h2 className="ml-1 text-base font-semibold text-slate-800 md:ml-2 md:text-lg">
          {formatTitle(view, anchorDate)}
        </h2>
      </div>

      {/* View selector */}
      <div className="flex flex-wrap rounded-md border border-slate-200 p-1">
        {(["day", "week", "month", "year"] as CalendarView[]).map(
          (option) => (
            <button
              key={option}
              type="button"
              onClick={() => onViewChange(option)}
              className={`
                rounded px-2.5 py-1.5 text-xs capitalize md:px-3 md:text-sm
                ${
                  view === option
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }
              `}
            >
              {option}
            </button>
          ),
        )}
      </div>
      {rightContent}
    </div>
  );
}