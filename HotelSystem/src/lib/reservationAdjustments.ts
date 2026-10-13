import type { ReservationAdjustment } from "../types/reservation";

export function adjustmentIdentityError(items: readonly Pick<ReservationAdjustment, "id">[]): string | undefined {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim() || ids.has(item.id)) return "Adjustment identity integrity error. Records are preserved; a reviewed repair is required before saving or removing ambiguous adjustments.";
    ids.add(item.id);
  }
}

export function createAdjustment(items: readonly ReservationAdjustment[], amount: number, reason: string, generate: () => string = () => {
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure UUID generation is unavailable. Use HTTPS or trustworthy localhost; no adjustment was created.");
  return globalThis.crypto.randomUUID();
}): ReservationAdjustment {
  const error = adjustmentIdentityError(items);
  if (error) throw new Error(error);
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = generate();
    if (id.trim() && !items.some(item => item.id === id)) return { id, amount, reason };
  }
  throw new Error("Unable to generate a unique adjustment identity. No adjustment was created; retry in a secure browser.");
}

export function removeAdjustment(items: readonly ReservationAdjustment[], id: string): ReservationAdjustment[] {
  const matches = items.filter(item => item.id === id);
  if (matches.length > 1) throw new Error("Adjustment identity integrity error. Removal refused; both records are preserved. A reviewed repair is required.");
  return matches.length ? items.filter(item => item.id !== id) : [...items];
}
