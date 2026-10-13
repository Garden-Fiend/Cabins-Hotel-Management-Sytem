import { expect, it } from "vitest";
import { formatReservationAudit } from "./reservationAudit";
import { sampleConfiguration } from "../features/configuration/sampleConfiguration";
import { sampleGuests } from "../data/datasample";
import type { ReservationAuditEntry } from "../types/reservation";

it("discloses duplicate historical identities without losing amounts or rewriting audit", () => {
  const records: ReservationAuditEntry[] = [{ eventType: "adjustment_changed", action: "Manual adjustments changed", actor: "Local demo user", occurredAt: new Date(0), before: JSON.stringify([{ id: "duplicate", amount: 100, reason: "A" }, { id: "duplicate", amount: 200, reason: "B" }]), after: "[]" }];
  const raw = JSON.stringify(records);
  const result = formatReservationAudit(records, sampleConfiguration, sampleGuests).map(item => item.description).join(" ");
  expect(result).toContain("integrity warning");
  expect(result).toContain("100.00");
  expect(result).toContain("200.00");
  expect(JSON.stringify(records)).toBe(raw);
});
