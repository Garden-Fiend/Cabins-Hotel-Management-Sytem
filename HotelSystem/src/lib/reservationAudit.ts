import type { HotelConfigurationData } from "../features/configuration/types";
import type { ReservationAuditEntry, ReservationGuest } from "../types/reservation";
import { formatHotelDate } from "./hotelTime";

type Data = Record<string, unknown>;
function object(value: unknown): Data { return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {}; }
function parse(value?: string): unknown { if (value === undefined) return undefined; try { return JSON.parse(value); } catch { return value; } }
function text(value: unknown, fallback = "Not recorded") { return typeof value === "string" || typeof value === "number" ? String(value) : fallback; }
function safeText(value: unknown, fallback: string) {
  const label = text(value, fallback);
  return !label.trim() || /[{}[\]]|\b\w+_\w+\b/.test(label) ? fallback : label;
}
function auditDate(value: unknown) {
  if (typeof value !== "string") return "Not recorded";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) return "Not recorded";
  const [, y, m, d, h, min, sec, ms] = match;
  return formatHotelDate(new Date(Date.UTC(Number(y), Number(m)-1, Number(d), Number(h), Number(min), Number(sec), Number((ms ?? "0").padEnd(3, "0").slice(0,3)))), { dateStyle: "medium", timeStyle: "short" });
}
export interface AuditActivity { description: string; actor: string; occurredAt: Date; sourceIndex: number; }

export function formatReservationAudit(records: ReservationAuditEntry[], configuration: HotelConfigurationData, guests: ReservationGuest[], currency = configuration.currency): AuditActivity[] {
  const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(value) : "Not recorded";
  const catalog = (id: unknown) => configuration.catalogItems.find((item) => item.id === id)?.label ?? "Retired item";
  const roomType = (id: unknown) => configuration.roomTypes.find((item) => item.id === id)?.label ?? "Retired room type";
  const duration = (id: unknown) => configuration.durations.find((item) => item.id === id)?.label ?? "Retired duration";
  const guest = (id: unknown) => guests.find((item) => item.id === id)?.name ?? "Guest not recorded";
  const descriptions = (record: ReservationAuditEntry): string[] => {
    const before = parse(record.before); const after = parse(record.after);
    const old = object(before); const next = object(after);
    const result: string[] = [];
    const change = (label: string, a: unknown, b: unknown, format: (value: unknown) => string = text) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) result.push(a === undefined ? `${label} recorded: ${format(b)}` : b === undefined ? `${label} removed (previously ${format(a)})` : `${label} changed from ${format(a)} to ${format(b)}`);
    };
    const room = next.roomNumber ?? old.roomNumber ?? /Room ([^ ]+)/.exec(record.action)?.[1];
    const suffix = room ? ` for Room ${text(room)}` : "";
    switch (record.eventType) {
      case "channel_terms_changed": case "channel_settlement_changed":
        if (old.field || next.field) result.push(`${text(next.field ?? old.field)} changed from ${text(old.display)} to ${text(next.display)}`);
        else result.push(record.action);
        break;
      case "guest_changed": change("Primary guest", before, after, guest); break;
      case "booking_source_changed": change("Booking source", before, after, (value) => configuration.bookingSources.find((item) => item.id === value)?.label ?? safeText(value, "Booking source not recorded")); break;
      case "price_changed": change(`Room rate${suffix}`, before, after, (value) => typeof value === "number" ? money(value) : safeText(value, "Not recorded")); break;
      case "stay_changed":
        change("Room", old.roomNumber, next.roomNumber);
        change(`Scheduled check-in${suffix}`, old.checkIn, next.checkIn, auditDate);
        change(`Scheduled checkout${suffix}`, old.checkOut, next.checkOut, auditDate);
        change(`Duration${suffix}`, old.durationId, next.durationId, duration);
        change(`Room type${suffix}`, old.roomTypeId, next.roomTypeId, (value) => value === old.roomTypeId ? safeText(old.roomType, roomType(value)) : safeText(next.roomType, roomType(value)));
        if (!Object.keys(old).length && !Object.keys(next).length) change("Stay duration", before, after, (value) => safeText(value, "Not recorded"));
        break;
      case "occupancy_changed": change(`Adult count${suffix}`, old.adults, next.adults); change(`Child count${suffix}`, old.children, next.children); break;
      case "inclusion_changed": case "extra_changed": case "breakfast_changed": case "discount_changed": case "adjustment_changed": {
        const list = (value: unknown) => Array.isArray(value) ? value.map(object) : Object.keys(object(value)).length ? [object(value)] : [];
        const key = (item: Data) => text(item.id ?? item.catalogId ?? `${item.stayDate}:${item.guestNumber}`);
        if (record.eventType === "adjustment_changed" && [list(before), list(after)].some(items => new Set(items.map(key)).size !== items.length)) {
          result.push("Adjustment identity integrity warning: historical duplicate IDs make this change ambiguous. Original audit records are preserved; a reviewed repair is required.");
          for (const [label, items] of [["Before", list(before)], ["After", list(after)]] as const) {
            items.forEach((item, index) => result.push(`${label} adjustment ${index + 1}: ${text(item.reason)}, ${money(item.amount)}`));
          }
          break;
        }
        const previous = new Map(list(before).map((item) => [key(item), item]));
        const current = new Map(list(after).map((item) => [key(item), item]));
        for (const id of new Set([...previous.keys(), ...current.keys()])) {
          const a = previous.get(id) ?? {}; const b = current.get(id) ?? {};
          const label = safeText(b.label ?? a.label ?? (record.eventType === "inclusion_changed" || record.eventType === "extra_changed" ? catalog(b.catalogId ?? a.catalogId) : record.eventType === "breakfast_changed" ? `Breakfast on ${text(b.stayDate ?? a.stayDate)}, Guest ${text(b.guestNumber ?? a.guestNumber)}` : b.reason ?? a.reason), record.eventType === "discount_changed" ? "Discount" : "Item");
          if (record.eventType === "breakfast_changed") {
            change(`${label} status`, a.status, b.status, (value) => value === "included" ? "Complimentary" : value === "skipped" ? "Skipped" : "Not recorded");
            change(`${label} meal`, a.mealId ?? a.mealLabel, b.mealId ?? b.mealLabel, (value) => value === a.mealId ? safeText(a.mealLabel, catalog(value)) : value === b.mealId ? safeText(b.mealLabel, catalog(value)) : safeText(value, "Meal not recorded"));
            change(`${label} beverage`, a.beverageId ?? a.beverageLabel, b.beverageId ?? b.beverageLabel, (value) => value === a.beverageId ? safeText(a.beverageLabel, catalog(value)) : value === b.beverageId ? safeText(b.beverageLabel, catalog(value)) : safeText(value, "Beverage not recorded"));
          } else {
            change(`${label} quantity${suffix}`, a.quantity, b.quantity);
            change(`${label} unit price${suffix}`, a.unitPrice, b.unitPrice, money);
            change(`${label} amount`, a.amount, b.amount, money);
            change(`${label} name`, a.label, b.label, (value) => safeText(value, "Not recorded"));
            change(`${label} reason`, a.reason, b.reason, (value) => safeText(value, "Not recorded"));
            change(`${label} discount method`, a.method, b.method, (value) => value === "percentage" ? "Percentage" : value === "fixed" ? "Fixed amount" : value === "final_price" ? "Final unit price" : "Not recorded");
            change(`${label} discount value`, a.value, b.value, (value) => (b.method ?? a.method) === "percentage" ? `${text(value)}%` : money(value));
            change(`${label} final unit price`, a.discountedUnitPrice, b.discountedUnitPrice, money);
            change(`${label} scope`, a.scope, b.scope, (value) => value === "item" ? "Item" : value === "room" ? "Room" : value === "reservation" ? "Reservation" : "Not recorded");
            change(`${label} target`, a.targetId, b.targetId, (value) => {
              const room = configuration.rooms.find((item) => item.id === value || item.number === value || `room:${item.number}` === value);
              if (room) return `Room ${room.number}`;
              if ((b.scope ?? a.scope) === "reservation") return "Entire reservation";
              return (b.scope ?? a.scope) === "item" ? `${catalog(b.targetItemId ?? a.targetItemId)} charge` : "Saved room assignment";
            });
            change(`${label} room type`, a.targetRoomTypeId, b.targetRoomTypeId, roomType);
            change(`${label} product`, a.targetItemId, b.targetItemId, catalog);
            change(`${label} base unit price`, a.baseUnitPrice, b.baseUnitPrice, money);
            change(`${label} currency`, a.currency, b.currency, (value) => safeText(value, "Not recorded"));
            change(`${label} charge classification`, a.usage, b.usage, (value) => value === "purchase" ? "Purchased item" : value === "extra_charge" ? "Extra charge" : "Not recorded");
            change(`${label} tax amount`, a.taxAmount, b.taxAmount, money);
            change(`${label} tax description`, a.taxDetails, b.taxDetails, (value) => safeText(value, "Not recorded"));
          }
        }
        if (!result.length && !list(before).length && !list(after).length) change(record.eventType === "breakfast_changed" ? "Breakfast selection" : record.eventType === "extra_changed" ? "Additional charges" : record.eventType === "discount_changed" ? "Discount" : record.eventType === "adjustment_changed" ? "Adjustment" : "Inclusions", before, after, (value) => safeText(value, "Not recorded"));
        break;
      }
      case "room_added": {
        const known = configuration.rooms.find((item) => item.id === after || item.number === after);
        return [`${next.roomNumber ? `Room ${text(next.roomNumber)}` : known ? `Room ${known.number}` : safeText(after, "Room assignment")} added${next.roomType ? ` - ${safeText(next.roomType, "Room type not recorded")}` : ""}`];
      }
      case "room_removed": {
        const known = configuration.rooms.find((item) => item.id === before || item.number === before);
        return [`${old.roomNumber ? `Room ${text(old.roomNumber)}` : known ? `Room ${known.number}` : safeText(before, "Room assignment")} removed`];
      }
      case "updated": if (record.action === "Reservation note updated") change("Reservation note", before, after, (value) => safeText(value, "Not recorded")); break;
    }
    const fallback: Partial<Record<ReservationAuditEntry["eventType"], string>> = { created: "Reservation created", checked_in: "Guest checked in", checked_out: "Guest checked out", cancelled: "Reservation cancelled", no_show: "Reservation marked No-show", departure_recorded: "Guest departure recorded" };
    return result.length ? result : [fallback[record.eventType] ?? (/^[A-Z][a-z]+ /.test(record.action) ? safeText(record.action, "Reservation updated") : "Reservation updated")];
  };
  return records.map((record, sourceIndex) => ({ record, sourceIndex })).sort((a, b) => b.record.occurredAt.getTime() - a.record.occurredAt.getTime() || a.sourceIndex - b.sourceIndex).flatMap(({ record, sourceIndex }) => descriptions(record).map((description) => ({ description, actor: record.actor?.trim() || "Actor not recorded", occurredAt: record.occurredAt, sourceIndex })));
}
