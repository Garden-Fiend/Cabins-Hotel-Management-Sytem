import type { HotelConfigurationData } from "../features/configuration/types";
import type { ReservationPriceLine, ReservationSnapshot } from "../types/reservation";
import { getRoomPriceBasis } from "./roomPricing";
import { calculateTax } from "./tax";
import { roundMoney } from "./money";
import { getHotelDateParts } from "./hotelTime";

export interface RoomPricingDraft {
  roomNumber: string; roomTypeId: string; roomType: string;
  useReservationStay: boolean; durationId: string;
  priceLocked: boolean; capturedRoomPrice: number; capturedCurrency: string;
  capturedUnitPrice?: number; capturedPricingQuantity?: number; capturedRateId?: string;
  charges: { id: string; catalogId: string; label: string; quantity: number; unitPrice: number }[];
  breakfast: Record<string, { status: "included" | "skipped"; meal: string; drink: string }>;
}

export function buildReservationPriceLines(rooms: RoomPricingDraft[], durationId: string, configuration: HotelConfigurationData, saved?: ReservationSnapshot): ReservationPriceLine[] {
  return rooms.flatMap((room): ReservationPriceLine[] => {
    const duration = room.useReservationStay ? durationId : room.durationId;
    const basis = getRoomPriceBasis(configuration, room.roomTypeId, duration);
    const savedLine = saved?.pricing.lines.find((line) => line.id === `room:${room.roomNumber}`);
    const currency = room.priceLocked ? room.capturedCurrency : basis?.currency ?? configuration.currency;
    const price = room.priceLocked ? room.capturedRoomPrice : basis?.amount ?? room.capturedRoomPrice;
    const savedRoom = saved?.rooms.find((item) => item.roomNumber === room.roomNumber);
    const oldStart = savedRoom && getHotelDateParts(savedRoom.checkIn);
    const oldEnd = savedRoom && getHotelDateParts(savedRoom.checkOut);
    const legacyNights = oldStart && oldEnd && configuration.durations.find((item) => item.id === duration)?.bookingType === "overnight"
      ? Math.max(1, Math.round((Date.UTC(oldEnd.year, oldEnd.month - 1, oldEnd.day) - Date.UTC(oldStart.year, oldStart.month - 1, oldStart.day)) / 86_400_000)) : 1;
    const quantity = room.priceLocked ? room.capturedPricingQuantity ?? savedLine?.pricingQuantity ?? legacyNights : basis?.quantity ?? 1;
    const unitPrice = room.priceLocked ? room.capturedUnitPrice ?? savedLine?.baseUnitPrice ?? price / quantity : basis?.unitPrice ?? price;
    return [{
      id: `room:${room.roomNumber}`, label: room.priceLocked && savedLine ? savedLine.label : `Room ${room.roomNumber} · ${room.roomType} · ${configuration.durations.find((item) => item.id === duration)?.label ?? "Stay"}`,
      amount: roundMoney(price, currency), roomNumber: room.roomNumber, kind: "room", currency,
      roomTypeId: room.roomTypeId, rateId: room.priceLocked ? room.capturedRateId ?? savedLine?.rateId ?? basis?.rateId : basis?.rateId,
      baseUnitPrice: roundMoney(unitPrice, currency), pricingQuantity: quantity, ...calculateTax(price),
    }, ...room.charges.map((charge): ReservationPriceLine => ({
      id: charge.id, label: `${charge.label} × ${charge.quantity}`, amount: roundMoney(charge.quantity * roundMoney(charge.unitPrice, currency), currency),
      roomNumber: room.roomNumber, kind: "charge", catalogId: charge.catalogId,
      quantity: charge.quantity, unitPrice: roundMoney(charge.unitPrice, currency), baseUnitPrice: roundMoney(charge.unitPrice, currency),
      pricingQuantity: charge.quantity, currency, ...calculateTax(charge.quantity * charge.unitPrice),
    })), ...Object.entries(room.breakfast).filter(([, breakfast]) => breakfast.status === "included").map(([key, breakfast]): ReservationPriceLine => {
      const [stayDate, guestIndex] = key.split(":");
      return { id: `breakfast:${room.roomNumber}:${stayDate}:${guestIndex}`, label: `${stayDate} · Guest ${Number(guestIndex) + 1}: ${breakfast.meal} + ${breakfast.drink}`,
        amount: 0, roomNumber: room.roomNumber, kind: "breakfast", quantity: 1, unitPrice: 0, currency, ...calculateTax(0) };
    })];
  });
}
