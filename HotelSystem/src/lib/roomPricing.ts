import type { HotelConfigurationData } from "../features/configuration/types";

export interface RoomAccommodationPrice {
  amount: number;
  currency: string;
}

export function getRoomAccommodationPrice(
  configuration: Pick<
    HotelConfigurationData,
    "roomTypePrices" | "durations" | "currency"
  >,
  roomTypeId: string,
  durationId: string,
): RoomAccommodationPrice | undefined {
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
    return rate ? { amount: rate.amount, currency: rate.currency } : undefined;
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
    amount: nightlyRate.amount * (nights ?? 0),
    currency: nightlyRate.currency,
  };
}
