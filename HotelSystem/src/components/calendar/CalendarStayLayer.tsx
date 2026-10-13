import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Stay } from "../../types/booking";
import { calendarStayClassName, getCalendarOccupancy, type TimelinePosition } from "../../lib/calendar";
import { formatHotelDate } from "../../lib/hotelTime";
import { competingStays } from "../../lib/calendarInteraction";

/** Time geometry, labels and short-stay targets are separate layers. */
export function CalendarStayLayer({ stays, positionFor, now, onStayClick }: {
  stays: Stay[]; positionFor: (stay: Stay) => TimelinePosition | null;
  now: Date; onStayClick?: (stay: Stay) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  const [choice, setChoice] = useState<{ stays: Stay[]; x: number } | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const entries = stays.flatMap(stay => {
    const position = positionFor(stay);
    return position ? [{ stay, position }] : [];
  });
  const label = (stay: Stay) => `${stay.guest}, Room ${stay.room}, ${stay.status === "checked_in" ? getCalendarOccupancy(stay, now) : stay.status.replace("_", " ")}, ${formatHotelDate(stay.checkIn, { dateStyle: "medium", timeStyle: "short" })} to ${formatHotelDate(stay.checkOut, { dateStyle: "medium", timeStyle: "short" })}`;
  function closeChoice() { setChoice(null); origin.current?.focus(); }
  function activate(stay: Stay, event: MouseEvent<HTMLButtonElement>) {
    // Keyboard activation already names an exact stay. Pointer collisions need a choice.
    const x = event.clientX - (root.current?.getBoundingClientRect().left ?? 0);
    const candidates = event.detail === 0 ? [stay] : competingStays(entries, width, x);
    if (candidates.length > 1) {
      origin.current = event.currentTarget;
      setChoice({ stays: candidates, x });
    } else onStayClick?.(stay);
  }
  return <div ref={root} className="pointer-events-none absolute inset-0" onKeyDown={event => { if (event.key === "Escape") closeChoice(); }}>
    {entries.map(({ stay, position }) => {
      const pixels = position.widthRatio * width;
      const tiny = width > 0 && pixels < 1;
      const status = stay.status === "checked_in" ? getCalendarOccupancy(stay, now) : stay.status.replace("_", " ");
      return <div key={stay.id}>
        <button type="button" data-testid="occupancy-interval" data-stay-id={stay.id}
          aria-label={label(stay)} aria-hidden={tiny || undefined} tabIndex={tiny ? -1 : 0} title={label(stay)}
          onClick={event => activate(stay, event)}
          className={`pointer-events-auto absolute top-2 z-10 h-12 min-w-0 overflow-hidden rounded-sm text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 ${calendarStayClassName(stay, now)}`}
          style={{ left: `${position.startRatio * 100}%`, width: `${position.widthRatio * 100}%`, padding: 0, border: 0 }}>
          <span className={pixels >= 80 ? "absolute inset-0 overflow-hidden px-3 py-2" : "sr-only"}>
            <span className="block truncate font-semibold">{stay.guest}</span>
            <span className="block truncate text-[10px] opacity-70">{status}</span>
          </span>
        </button>
        {tiny && <button type="button" aria-label={`Short stay: ${label(stay)}`} title={`Short stay: ${label(stay)}`}
          data-testid="short-stay-target" onClick={event => activate(stay, event)}
          className="pointer-events-auto absolute top-2 z-20 h-12 w-4 bg-transparent text-slate-900 focus-visible:outline-2"
          style={{ left: Math.max(0, Math.min(width - 16, position.startRatio * width - 8)), padding: 0, border: 0 }}>
          <span aria-hidden="true" className="absolute top-5 h-2 w-2 rotate-45 border border-white bg-slate-900" style={{ left: position.startRatio * width - Math.max(0, Math.min(width - 16, position.startRatio * width - 8)) - 4 }} />
        </button>}
      </div>;
    })}
    {choice && <div role="dialog" aria-label="Choose reservation" className="pointer-events-auto absolute top-0 z-30 w-80 rounded-lg border bg-white p-2 shadow-lg" style={{ left: Math.max(0, Math.min(width - 320, choice.x)) }}>
      <p className="mb-2 text-sm font-semibold">Choose reservation</p>
      {choice.stays.map((stay, index) => <button key={stay.id} autoFocus={index === 0} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-slate-100 focus-visible:outline-2" onClick={() => { setChoice(null); onStayClick?.(stay); }}>{label(stay)}</button>)}
      <button type="button" onClick={closeChoice} className="p-2 text-sm underline">Close choices</button>
    </div>}
  </div>;
}
