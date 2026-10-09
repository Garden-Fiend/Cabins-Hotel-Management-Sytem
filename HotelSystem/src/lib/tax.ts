export interface TaxCalculation {
  taxAmount: number;
  taxDetails: string;
}

export function calculateTax(taxableAmount: number): TaxCalculation {
  void taxableAmount;
  return {
    taxAmount: 0,
    taxDetails: "No tax configured",
  };
}
