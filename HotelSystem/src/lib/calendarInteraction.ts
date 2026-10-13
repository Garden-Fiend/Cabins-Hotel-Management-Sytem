import type { Stay } from "../types/booking";
import type { TimelinePosition } from "./calendar";

export function competingStays(entries: { stay: Stay; position: TimelinePosition }[], width: number, x: number) {
  return entries.filter(({ position }) => {
    const start = position.startRatio * width;
    const end = position.endRatio * width;
    const targetStart = Math.max(0, Math.min(width - 16, start - 8));
    return end - start < 1 ? x >= targetStart && x < targetStart + 16 : x >= start && x < end;
  }).map(entry => entry.stay).sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime() || a.id - b.id);
}
