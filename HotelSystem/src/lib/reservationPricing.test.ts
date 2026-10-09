import { describe, expect, it } from "vitest";

import { calculateReservationPrice } from "./reservationPricing";

describe("calculateReservationPrice", () => {
  it("adds multiple rooms and charges, then applies ordered discounts and adjustments", () => {
    const summary = calculateReservationPrice(
      [
        {
          id: "room:101",
          label: "Room 101",
          amount: 1650,
          roomNumber: "101",
          kind: "room",
        },
        {
          id: "room:201",
          label: "Room 201",
          amount: 3200,
          roomNumber: "201",
          kind: "room",
        },
        {
          id: "charge-bed",
          label: "Extra bed",
          amount: 500,
          roomNumber: "101",
          kind: "charge",
        },
      ],
      [
        {
          id: "room-discount",
          label: "Room 101 discount",
          scope: "room",
          method: "percentage",
          value: 10,
          targetId: "101",
        },
        {
          id: "item-discount",
          label: "Bed discount",
          scope: "item",
          method: "fixed",
          value: 100,
          targetId: "charge-bed",
        },
        {
          id: "reservation-discount",
          label: "Reservation discount",
          scope: "reservation",
          method: "fixed",
          value: 200,
          targetId: "",
        },
      ],
      [150],
    );

    expect(summary.subtotal).toBe(5350);
    expect(summary.discountTotal).toBe(515);
    expect(summary.adjustmentTotal).toBe(150);
    expect(summary.amountOwed).toBe(4985);
  });

  it("caps discounts to the eligible amount and never makes the total negative", () => {
    const summary = calculateReservationPrice(
      [
        {
          id: "room:101",
          label: "Room 101",
          amount: 100,
          roomNumber: "101",
          kind: "room",
        },
      ],
      [
        {
          id: "discount-a",
          label: "First",
          scope: "reservation",
          method: "fixed",
          value: 80,
          targetId: "",
        },
        {
          id: "discount-b",
          label: "Second",
          scope: "reservation",
          method: "fixed",
          value: 80,
          targetId: "",
        },
      ],
      [-500],
    );

    expect(summary.discountTotal).toBe(100);
    expect(summary.amountOwed).toBe(0);
  });
});
