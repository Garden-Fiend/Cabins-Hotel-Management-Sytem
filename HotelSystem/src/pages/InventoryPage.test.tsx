import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { InventoryPage } from "./InventoryPage";

describe("inventory catalog", () => {
  it("combines search with category pills and shows an empty result state", () => {
    render(<ReservationDemoProvider><InventoryPage /></ReservationDemoProvider>);
    fireEvent.change(screen.getByLabelText("Search inventory"), { target: { value: "Laundry" } });
    expect(screen.getByRole("button", { name: "View Laundry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View Extra bed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Breakfast Items" }));
    expect(screen.getByRole("heading", { name: "No items found" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search inventory"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "View Coffee" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View Laundry" })).toBeNull();
  });

  it("opens item details, saves edits, and restores focus when dismissed with Escape", () => {
    render(<ReservationDemoProvider><InventoryPage /></ReservationDemoProvider>);
    const card = screen.getByRole("button", { name: "View Extra bed" });
    card.focus();
    fireEvent.click(card);
    let dialog = screen.getByRole("dialog", { name: "Item details: Extra bed" });
    expect(within(dialog).getByLabelText("Product name")).toHaveProperty("value", "Extra bed");
    fireEvent.change(within(dialog).getByLabelText("Product name"), { target: { value: "Additional bed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save product" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const updatedCard = screen.getByRole("button", { name: "View Additional bed" });
    updatedCard.focus();
    fireEvent.click(updatedCard);
    dialog = screen.getByRole("dialog", { name: "Item details: Additional bed" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(updatedCard);
  });

  it("keeps special breakfast configuration stable and references a regular product", () => {
    render(
      <ReservationDemoProvider>
        <InventoryPage />
      </ReservationDemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage categories" }));
    const categoryDialog = screen.getByRole("dialog", { name: "Manage categories" });
    const breakfastCategory = within(categoryDialog).getByRole("heading", { name: "Breakfast Items" }).closest("article")!;
    expect(within(breakfastCategory).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(breakfastCategory).queryByRole("button", { name: "Archive" })).toBeNull();
    fireEvent.click(within(categoryDialog).getByRole("button", { name: "Close popup" }));
    fireEvent.click(screen.getByRole("button", { name: "Add product" }));

    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Pancakes" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "meals" },
    });
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add product" })).getByRole("button", { name: "Add product" }));

    expect(screen.getByRole("button", { name: "View Pancakes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage categories" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure breakfast" }));
    fireEvent.click(screen.getByLabelText("Breakfast eligible: Pancakes"));
    fireEvent.click(screen.getByRole("button", { name: "Save breakfast configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Close popup" }));
    fireEvent.click(screen.getByRole("button", { name: "Breakfast Items" }));
    expect(screen.getByRole("button", { name: "View Pancakes" })).toBeTruthy();
  });

  it("archives a product without removing saved historical catalog data", () => {
    render(
      <ReservationDemoProvider>
        <InventoryPage />
      </ReservationDemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View Extra bed" }));
    const dialog = screen.getByRole("dialog", { name: "Item details: Extra bed" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(screen.queryByRole("button", { name: "View Extra bed" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Show archived"));
    const card = screen.getByRole("button", { name: "View Extra bed" });
    expect(within(card).getByText("Archived")).toBeTruthy();
    fireEvent.click(card);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Item details: Extra bed" })).getByRole("button", { name: "Restore" }));
    expect(within(screen.getByRole("button", { name: "View Extra bed" })).getByText("Active")).toBeTruthy();
  });
});
