import { useReservationDemo } from "../../app/useReservationDemo";
import { can } from "../../app/permissions";
import { formatReservationAudit } from "../../lib/reservationAudit";
import { formatHotelDate } from "../../lib/hotelTime";
import type { HotelConfigurationData } from "../../features/configuration/types";
import type { ReservationSnapshot, ReservationGuest } from "../../types/reservation";

export function ReservationAuditHistory({ reservation, configuration, guests }: { reservation: ReservationSnapshot; configuration: HotelConfigurationData; guests: ReservationGuest[] }) {
  const {capabilities} = useReservationDemo();
  const accountingVisible = can(capabilities,"confirm_commission") || can(capabilities,"record_settlement") || can(capabilities,"reconcile_settlement");
  const entries = formatReservationAudit(reservation.audit.filter(entry=>entry.visibility !== "accounting" || accountingVisible), configuration, guests, reservation.rooms[0]?.capturedCurrency ?? configuration.currency);
  return <ol className="mt-4 divide-y divide-slate-100 text-sm">{entries.map((entry, index) => <li key={`${entry.sourceIndex}-${index}`} className="py-3 first:pt-0">
    <p className="font-medium text-slate-900">{entry.description}</p>
    <p className="mt-1 text-xs text-slate-500">By {entry.actor} · <time dateTime={entry.occurredAt.toISOString()}>{formatHotelDate(entry.occurredAt, { dateStyle: "medium", timeStyle: "short" })}</time></p>
  </li>)}{!entries.length && <li>No activity recorded.</li>}</ol>;
}
