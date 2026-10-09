import type { HotelConfigurationData } from "../features/configuration/types";
import { roundMoney } from "./money";

export interface RoomAccommodationPrice {
  amount: number;
  currency: string;
}

export interface RoomPriceBasis extends RoomAccommodationPrice {
  rateId: string;
  unitPrice: number;
  quantity: number;
}

export function getRoomPriceBasis(
  configuration: Pick<
    HotelConfigurationData,
    "roomTypePrices" | "durations" | "currency"
  >,
  roomTypeId: string,
  durationId: string,
): RoomPriceBasis | undefined {
  const duration = configuration.durations.find(
    (item) => item.id === durationId && item.enabled,
  );
  if (!duration) return undefined;

  if (duration.bookingType === "hourly") {
    const rate = configuration.roomTypePrices.find(
      (item) =>
        item.enabled &&
        item.roomTypeId === roomTypeId &&
        item.bookingType === "hourly" &&
        item.durationId === durationId,
    );
    return rate ? { amount: roundMoney(rate.amount, rate.currency), currency: rate.currency, rateId: rate.id, unitPrice: roundMoney(rate.amount, rate.currency), quantity: 1 } : undefined;
  }

  const nightlyRate = configuration.roomTypePrices.find(
    (item) =>
      item.enabled &&
      item.roomTypeId === roomTypeId &&
      item.bookingType === "overnight",
  );
  const nights = duration.nights;
  if (!nightlyRate || !Number.isInteger(nights) || (nights ?? 0) < 1) {
    return undefined;
  }

  return {
    amount: roundMoney(roundMoney(nightlyRate.amount, nightlyRate.currency) * (nights ?? 0), nightlyRate.currency),
    currency: nightlyRate.currency,
    rateId: nightlyRate.id,
    unitPrice: roundMoney(nightlyRate.amount, nightlyRate.currency),
    quantity: nights ?? 0,
  };
}

export function getRoomAccommodationPrice(
  configuration: Pick<HotelConfigurationData, "roomTypePrices" | "durations" | "currency">,
  roomTypeId: string,
  durationId: string,
): RoomAccommodationPrice | undefined {
  const basis = getRoomPriceBasis(configuration, roomTypeId, durationId);
  return basis ? { amount: basis.amount, currency: basis.currency } : undefined;
}
