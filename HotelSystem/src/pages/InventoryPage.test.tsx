import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { InventoryPage } from "./InventoryPage";

describe("inventory catalog", () => {
  it("keeps special breakfast categories stable and creates a typed product", () => {
    render(
      <ReservationDemoProvider>
        <InventoryPage />
      </ReservationDemoProvider>,
    );

    const breakfastCategory = screen
      .getAllByText("Breakfast Items")[0]
      .closest("div")?.parentElement as HTMLElement;
    expect(
      within(breakfastCategory).queryByRole("button", { name: "Delete" }),
    ).toBeNull();
    expect(
      within(breakfastCategory).queryByRole("button", { name: "Archive" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Pancakes" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "special-breakfast" },
    });
    fireEvent.change(screen.getByLabelText("Breakfast product type"), {
      target: { value: "meal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));

    expect(screen.getByText("Pancakes · meal")).toBeTruthy();
  });

  it("archives a product without removing saved historical catalog data", () => {
    render(
      <ReservationDemoProvider>
        <InventoryPage />
      </ReservationDemoProvider>,
    );

    const productRow = screen.getByText("Extra bed").closest("tr") as HTMLElement;
    fireEvent.click(
      within(productRow).getByRole("button", { name: "Archive" }),
    );
    expect(within(productRow).getByText("Archived")).toBeTruthy();
  });
});
