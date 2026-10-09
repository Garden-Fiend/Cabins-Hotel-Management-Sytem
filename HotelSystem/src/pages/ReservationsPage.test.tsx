import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { createHotelDateTime } from "../lib/hotelTime";
import { ReservationDetailPage } from "./ReservationDetailPage";
import { ReservationsPage } from "./ReservationsPage";
import { ReservationPrintPage } from "./ReservationPrintPage";

function renderReservations(initialEntry = "/reservations") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ReservationDemoProvider>
        <Routes>
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route
            path="/reservations/:reservationId"
            element={<ReservationDetailPage />}
          />
          <Route
            path="/reservations/:reservationId/print"
            element={<ReservationPrintPage />}
          />
        </Routes>
      </ReservationDemoProvider>
    </MemoryRouter>,
  );
}

describe("reservation operations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(createHotelDateTime(2026, 10, 8, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters the reservation table and opens full saved details", () => {
    renderReservations();

    fireEvent.change(screen.getByLabelText("Search guest or reservation ID"), {
      target: { value: "DEMO-8" },
    });
    const row = screen.getByRole("row", { name: /DEMO-8/ });
    expect(within(row).getByText("Charlie Brown")).toBeTruthy();
    fireEvent.click(within(row).getByRole("link", { name: "DEMO-8" }));

    expect(screen.getByRole("heading", { name: "DEMO-8" })).toBeTruthy();
    expect(screen.getByText(/Agoda \(inactive historical item\)/)).toBeTruthy();
    expect(screen.getAllByText(/American breakfast/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Legacy minibar/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₱7,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₱7,800/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Print document" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Print thermal" })).toBeTruthy();
  });

  it("checks in and checks out all rooms while marking the room Dirty", () => {
    renderReservations();

    const row = screen.getByRole("row", { name: /DEMO-6/ });
    fireEvent.click(within(row).getByRole("button", { name: "Check out" }));

    expect(screen.getByRole("status").textContent).toContain("checked out");
    expect(within(row).getByText("checked out")).toBeTruthy();
    fireEvent.click(within(row).getByRole("link", { name: "DEMO-6" }));
    expect(screen.getByText("Housekeeping readiness: dirty")).toBeTruthy();
  });

  it("keeps actual check-in timestamps and audit entries when editing", () => {
    vi.setSystemTime(createHotelDateTime(2026, 10, 14, 17));
    renderReservations("/reservations/DEMO-2");

    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    expect(screen.getByRole("status").textContent).toContain("checked in");
    expect(screen.getAllByText(/Oct 14, 2026, 5:00 PM/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    const pane = screen.getByRole("dialog", { name: "Edit reservation" });
    fireEvent.click(
      within(pane).getByRole("button", { name: "Save Changes" }),
    );

    expect(screen.getAllByText(/Oct 14, 2026, 5:00 PM/).length).toBeGreaterThan(0);
    expect(screen.getByText("Guest checked in")).toBeTruthy();
  });

  it("retains checked-in occupancy on cancellation until departure is recorded", () => {
    renderReservations("/reservations/DEMO-6");

    fireEvent.click(screen.getByRole("button", { name: "Cancel reservation" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Cancel reservation?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "No, retain occupancy lock",
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain("202");

    fireEvent.click(
      screen.getByRole("button", { name: "Record Guest Departure" }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Housekeeping readiness: dirty")).toBeTruthy();
  });

  it("marks a confirmed reservation No-show and prints only saved snapshots", () => {
    vi.setSystemTime(createHotelDateTime(2026, 10, 19, 15));
    renderReservations("/reservations/DEMO-3");

    fireEvent.click(screen.getByRole("button", { name: "Mark No-show" }));
    expect(screen.getByText(/Status: No-show/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Print document" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Print thermal" }));
    expect(screen.getByRole("heading", { name: "Reservation record" })).toBeTruthy();
    const printDocument = screen.getByRole("article");
    expect(printDocument.hasAttribute("data-reservation-print-document")).toBe(true);
    expect(document.querySelector("style")?.textContent).toContain(
      "body * { visibility: hidden !important; }",
    );
    expect(document.querySelector("style")?.textContent).toContain(
      "[data-reservation-print-document] *",
    );
    expect(screen.getByText("Amount owed")).toBeTruthy();
    expect(screen.getByText(/No payment record is available/)).toBeTruthy();
  });
});
