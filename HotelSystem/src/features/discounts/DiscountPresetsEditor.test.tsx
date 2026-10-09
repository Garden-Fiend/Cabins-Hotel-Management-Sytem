import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { DiscountPresetsEditor } from "./DiscountPresetsEditor";

function openBuilder() {
  render(<ReservationDemoProvider><DiscountPresetsEditor /></ReservationDemoProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
}

describe("unified discount builder", () => {
  it("loads configured rates and saves partial coverage including zero", () => {
    openBuilder();
    fireEvent.change(screen.getByLabelText("Discount Name"), { target: { value: "Free short stay" } });
    fireEvent.change(screen.getByLabelText("6 hours discounted price"), { target: { value: "0" } });
    expect(screen.getByLabelText("Nightly discounted price")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    const row = screen.getByRole("row", { name: /Free short stay/ });
    expect(within(row).getByText("Final Price")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("6 hours discounted price") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("8 hours discounted price") as HTMLInputElement).value).toBe("");
  });
  it("requires at least one rate and rejects above-base prices", () => {
    openBuilder();
    fireEvent.change(screen.getByLabelText("Discount Name"), { target: { value: "Invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    expect(screen.getByRole("status").textContent).toContain("at least one");
    fireEvent.change(screen.getByLabelText("6 hours discounted price"), { target: { value: "99999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    expect(screen.getByRole("status").textContent).toContain("base price");
  });
  it("builds item final prices, searches, disables and deletes presets", () => {
    openBuilder();
    fireEvent.change(screen.getByLabelText("Discount Name"), { target: { value: "Transfer offer" } });
    fireEvent.change(screen.getByLabelText("Apply To"), { target: { value: "item" } });
    fireEvent.change(screen.getByLabelText("Applicable Item"), { target: { value: "airport-transfer" } });
    fireEvent.change(screen.getByLabelText("Discounted Unit Price"), { target: { value: "700" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    fireEvent.change(screen.getByLabelText("Search discounts"), { target: { value: "Transfer offer" } });
    const row = screen.getByRole("row", { name: /Transfer offer/ });
    fireEvent.click(within(row).getByRole("button", { name: "Disable" }));
    expect(within(row).getByText("Disabled")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("row", { name: /Transfer offer/ })).toBeNull();
  });
  it("offers only fixed and percentage methods for reservation presets", () => {
    openBuilder();
    fireEvent.change(screen.getByLabelText("Apply To"), { target: { value: "reservation" } });
    expect(screen.queryByRole("option", { name: "Set Discounted Price" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Discount Name"), { target: { value: "Student offer" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    expect(screen.getByRole("row", { name: /Student offer/ })).toBeTruthy();
  });
});
