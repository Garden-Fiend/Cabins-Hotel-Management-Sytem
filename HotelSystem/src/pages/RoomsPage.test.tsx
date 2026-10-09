import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { createHotelDateTime } from "../lib/hotelTime";
import { InventoryPage } from "./InventoryPage";
import { RoomsPage } from "./RoomsPage";

describe("room inventory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(createHotelDateTime(2026, 10, 8, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows reservation availability separately from operational status", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );

    const room202 = screen.getByText("Room 202").closest("article");
    expect(room202?.textContent).toContain("Occupied");
    expect(room202?.textContent).toContain("Suite");

    const room201 = screen.getByText("Room 201").closest("article");
    expect(room201?.textContent).toContain("Reserved");

    const room106 = screen.getByText("Room 106").closest("article");
    expect(room106?.textContent).toContain("Maintenance");
  });

  it("prevents duplicate room numbers and supports readiness transitions", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add room" }));
    fireEvent.change(screen.getByLabelText("Room number"), {
      target: { value: "101" },
    });
    fireEvent.change(screen.getByLabelText("Room type"), {
      target: { value: "standard" },
    });
    fireEvent.submit(screen.getByLabelText("Room number").closest("form")!);
    expect(screen.getByRole("status").textContent).toContain(
      "A room with that number already exists.",
    );

    const room103 = screen.getByText("Room 103").closest("article") as HTMLElement;
    fireEvent.click(
      within(room103).getByRole("button", { name: "Mark Clean" }),
    );
    expect(within(room103).getByText(/Readiness: clean/)).toBeTruthy();
  });

  it("opens the room form from its card and edits operational status inline", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );

    expect(screen.queryByLabelText("Room number")).toBeNull();
    const room101 = screen.getByText("Room 101").closest("article") as HTMLElement;
    fireEvent.click(room101);

    expect(screen.getByRole("dialog", { name: "Edit room" })).toBeTruthy();
    expect(screen.getByLabelText("Room number")).toHaveProperty("value", "101");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    const status = within(room101).getByRole("combobox", {
      name: "Room 101 status",
    });
    fireEvent.change(status, { target: { value: "maintenance" } });
    expect(status).toHaveProperty("value", "maintenance");
  });

  it("opens a blank room form from Add room with amenity checkboxes", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add room" }));
    expect(screen.getByLabelText("Room number")).toHaveProperty("value", "");
    expect(screen.queryByLabelText(/price override/i)).toBeNull();

    const amenities = screen.getByRole("group", { name: "Room amenities" });
    expect(within(amenities).getByRole("checkbox", { name: "Wi-Fi" })).toBeTruthy();
    expect(
      within(amenities).getByRole("checkbox", { name: "Mini fridge" }),
    ).toBeTruthy();
  });

  it("offers checkbox-based default amenities for room types", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Room types" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Suite").closest("article")!);
    expect(screen.getByRole("dialog", { name: "Edit room type" })).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Default amenities" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Air conditioning" }),
    ).toBeTruthy();
  });

  it("opens a blank room-type form from Add room type", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Room types" }));
    fireEvent.click(screen.getByRole("button", { name: "Add room type" }));

    expect(screen.getByRole("dialog", { name: "Add room type" })).toBeTruthy();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");
  });

  it("adds products to the Amenities catalog category without a price", () => {
    render(
      <ReservationDemoProvider>
        <InventoryPage />
      </ReservationDemoProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: "Balcony" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "special-amenities" },
    });
    expect(
      screen.getByText("Amenity catalog items do not have a price."),
    ).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Add product" })).getByRole("button", { name: "Add product" }));
    expect(screen.getByText("Balcony")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Product saved for this session.",
    );
  });

  it("prevents archiving a room type while active rooms still use it", () => {
    render(
      <ReservationDemoProvider>
        <RoomsPage />
      </ReservationDemoProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Room types" }));
    const suite = screen.getByText("Suite").closest("article") as HTMLElement;
    expect(
      within(suite).getByRole("button", { name: "Archive" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
