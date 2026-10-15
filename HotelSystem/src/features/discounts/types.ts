export interface DiscountDefinitionConfiguration {
  serverVersion?: number;
  serverValue?: string;
  serverReplacementMinor?: number;
  serverRatePrices?: {rate_id:string;unit_amount_minor:number}[];
  id: string;
  label: string;
  method: "fixed" | "percentage" | "final_price";
  value: number;
  scope: "reservation" | "room" | "item";
  enabled: boolean;
  targetRoomTypeId?: string;
  targetItemId?: string;
  currency?: string;
  discountedUnitPrice?: number;
  rates?: { rateId: string; discountedUnitPrice: number }[];
}
