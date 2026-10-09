// Round at monetary boundaries and do allocation arithmetic in integer minor units.
export function currencyDigits(currency = "PHP") {
  return new Intl.NumberFormat("en", { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits ?? 2;
}

export function toMinorUnits(amount: number, currency = "PHP") {
  if (!Number.isFinite(amount)) throw new Error("Money must be finite.");
  const scaled = amount * 10 ** currencyDigits(currency);
  const minor = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.max(1, Math.abs(scaled)));
  if (!Number.isSafeInteger(minor)) throw new Error("Money exceeds the supported precision.");
  return minor;
}

export function fromMinorUnits(amount: number, currency = "PHP") {
  return amount / 10 ** currencyDigits(currency);
}

export function roundMoney(amount: number, currency = "PHP") {
  return fromMinorUnits(toMinorUnits(amount, currency), currency);
}
