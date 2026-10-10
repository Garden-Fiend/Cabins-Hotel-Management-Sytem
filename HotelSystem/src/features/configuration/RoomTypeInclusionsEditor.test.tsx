import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { RoomsPage } from "../../pages/RoomsPage";
import { ConfigurationPage } from "../../pages/ConfigurationPage";

describe("room-type inclusion editing", () => {
  it("edits inclusions inside the room-type dialog, saves together and discards cancelled edits", () => {
    render(<ReservationDemoProvider><RoomsPage /></ReservationDemoProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Room types" }));
    expect(screen.queryByLabelText("Add default inclusion")).toBeNull();
    const open = (name: string) => fireEvent.click(screen.getByRole("heading", { name }).closest("article")!);
    open("Standard");
    let dialog = screen.getByRole("dialog", { name: "Edit room type" });
    expect(within(dialog).getByLabelText("Default Bottled water quantity")).toHaveProperty("value", "1");
    expect(within(screen.getByLabelText("Add default inclusion")).queryByRole("option", { name: "Bottled water" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Add default inclusion"), { target: { value: "towels" } });
    fireEvent.change(screen.getByLabelText("Default Towels quantity"), { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save room type" }));
    open("Deluxe");
    expect(screen.queryByLabelText("Default Towels quantity")).toBeNull();
    expect(screen.getByLabelText("Default Bottled water quantity")).toHaveProperty("value", "2");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    open("Standard");
    dialog = screen.getByRole("dialog", { name: "Edit room type" });
    expect(screen.getByLabelText("Default Towels quantity")).toHaveProperty("value", "3");
    fireEvent.click(screen.getByRole("button", { name: "Remove default Towels" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    open("Standard");
    expect(screen.getByLabelText("Default Towels quantity")).toHaveProperty("value", "3");
  });
  it("includes default inclusions in Configuration room-type edits and saves them with the row", () => {
    render(<ReservationDemoProvider><ConfigurationPage /></ReservationDemoProvider>);
    const row = screen.getByRole("row", { name: /Standard/ });
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Default Bottled water quantity")).toHaveProperty("value", "1");
    fireEvent.change(screen.getByLabelText("Default Bottled water quantity"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(within(screen.getByRole("row", { name: /Standard/ })).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Default Bottled water quantity")).toHaveProperty("value", "4");
    fireEvent.change(screen.getByLabelText("Default Bottled water quantity"), { target: { value: "0" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
    expect(screen.getByRole("status").textContent).toContain("positive whole numbers");
    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    fireEvent.click(within(screen.getByRole("row", { name: /Standard/ })).getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Default Bottled water quantity")).toHaveProperty("value", "4");
  });
});
