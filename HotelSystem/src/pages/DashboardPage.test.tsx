import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { useReservationDemo } from "../app/useReservationDemo";
import { DashboardPage } from "./DashboardPage";

function SetRoomDirty({ roomNumber }: { roomNumber: string }) {
  const { setConfiguration } = useReservationDemo();
  useEffect(() => {
    setConfiguration((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.number === roomNumber
          ? { ...room, housekeepingState: "dirty" }
          : room,
      ),
    }));
  }, [roomNumber, setConfiguration]);
  return null;
}

function ReservationDetailsTestRoute() {
  const { reservationId } = useParams();
  return <div>Reservation details for {reservationId}</div>;
}

function renderDashboard(options: { dirtyRoomNumber?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ReservationDemoProvider>
        {options.dirtyRoomNumber && (
          <SetRoomDirty roomNumber={options.dirtyRoomNumber} />
        )}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route
            path="/reservations/:reservationId"
            element={<ReservationDetailsTestRoute />}
          />
        </Routes>
      </ReservationDemoProvider>
    </MemoryRouter>,
  );
}

function openReservationFromDashboard() {
  fireEvent.click(
    screen.getByRole("button", { name: "+ Create Reservation" }),
  );
  return screen.getByRole("dialog", { name: "Create reservation" });
}

function completeReservation(dialog: HTMLElement, roomNumber = "203") {
  fireEvent.click(within(dialog).getByRole("button", { name: /John Doe/ }));
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: "Choose available room" }),
    { target: { value: roomNumber } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "+ Add room" }));
  fireEvent.change(
    within(dialog).getByRole("combobox", { name: "Booking source *" }),
    { target: { value: "direct" } },
  );
}

describe("dashboard reservation flow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("places occupancy colors and inactive-reservation controls beside the calendar toolbar", () => {
    renderDashboard();

    const toolbarButton = screen.getByRole("button", { name: "Today" });
    const legend = screen.getByLabelText("Calendar occupancy legend");
    const inactiveFilter = screen.getByRole("checkbox", {
      name: "Show inactive reservations",
    });
    const toolbarPanel = toolbarButton.closest(".rounded-2xl");

    expect(legend.textContent).toContain("Reserved");
    expect(legend.textContent).toContain("Overdue");
    expect(toolbarPanel).not.toBeNull();
    expect(legend.closest(".rounded-2xl")).toBe(toolbarPanel);
    expect(inactiveFilter.closest(".rounded-2xl")).toBe(toolbarPanel);
  });

  it("opens a prefilled draft from an available calendar room/date cell", async () => {
    renderDashboard();

    fireEvent.click(
      screen.getByRole("button", { name: "Select Room 101 on Oct 1, 2026" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Create reservation",
    });
    expect(dialog.parentElement?.className).toContain("lg:h-full");
    expect(dialog.parentElement?.className).toContain("lg:min-h-0");
    expect(
      within(dialog).getByLabelText("Check-in *"),
    ).toHaveProperty("value", "2026-10-01T14:00");
    expect(
      within(dialog).getByRole("heading", { name: "1. Primary guest" }),
    ).toBeTruthy();
    expect(within(dialog).getByText("Room 101 · Standard")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Draft stay for Room 101" }),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /John Doe/ }));
    fireEvent.change(
      within(dialog).getByRole("combobox", { name: "Booking source *" }),
      { target: { value: "direct" } },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Reservation" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "created in this session",
      ),
    );
    expect(
      screen.getByRole("button", { name: /^John Doe, Room .*confirmed,/ }),
    ).toBeTruthy();
  }, 15000);

  it("opens a compact summary and lets staff expand or edit an existing reservation", () => {
    renderDashboard();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show inactive reservations" }),
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Alice Johnson, Room .*confirmed,/ })[0],
    );

    expect(
      screen.getByRole("dialog", { name: "Alice Johnson" }),
    ).toBeTruthy();
    expect(screen.getByText("Reservation summary")).toBeTruthy();
    expect(screen.getByText("DEMO-2")).toBeTruthy();
    expect(screen.getByText(/102 · clean, 201 · clean/)).toBeTruthy();
    expect(screen.getByText(/Oct 14, 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Expand" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit reservation" });
    expect(within(dialog).getByText("Alice Johnson")).toBeTruthy();
    expect(within(dialog).getByText("Room 102 · Standard")).toBeTruthy();
    expect(within(dialog).getByText("Room 201 · Suite")).toBeTruthy();
    expect(
      within(dialog).queryByText(/is unavailable|are unavailable/),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Save Changes" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
  });

  it("closes the reservation summary popup when the backdrop is clicked", () => {
    renderDashboard();
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Alice Johnson, Room .*confirmed,/ })[0],
    );

    const popup = screen.getByRole("dialog", { name: "Alice Johnson" });
    fireEvent.click(popup.parentElement!);

    expect(screen.queryByRole("dialog", { name: "Alice Johnson" })).toBeNull();
  });

  it("opens the same reservation details from the calendar bar and warns when a room is not ready", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T07:00:00.000Z"));
    renderDashboard({ dirtyRoomNumber: "102" });

    fireEvent.click(
      screen.getAllByRole("button", { name: /^Alice Johnson, Room .*confirmed,/ })[0],
    );

    expect(screen.getByRole("alert").textContent).toContain("Room Not Ready");
    expect(screen.getByText(/102 · dirty, 201 · clean/)).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Expand" }));
    expect(screen.getByText("Reservation details for DEMO-2")).toBeTruthy();
  });

  it("applies the configured hotel checkout time to overnight stays", () => {
    renderDashboard();
    const dialog = openReservationFromDashboard();
    const checkIn = within(dialog).getByLabelText("Check-in *");
    fireEvent.change(checkIn, { target: { value: "2026-10-01T23:30" } });
    fireEvent.change(within(dialog).getByLabelText("Duration *"), {
      target: { value: "1-night" },
    });

    expect(within(dialog).getByText("Oct 2, 2026, 12:00 PM")).toBeTruthy();
  });

  it("only offers active booking sources and operationally available rooms", () => {
    renderDashboard();
    const dialog = openReservationFromDashboard();

    const roomOptions = within(dialog)
      .getByRole("combobox", { name: "Choose available room" })
      .querySelectorAll("option");
    expect(
      Array.from(roomOptions).find((option) => option.getAttribute("value") === "103")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      Array.from(roomOptions).find((option) => option.getAttribute("value") === "106")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(dialog)
        .getByRole("combobox", { name: "Booking source *" })
        .querySelector('option[value="agoda"]'),
    ).toBeNull();
    expect(
      within(dialog)
        .getByLabelText("Duration *")
        .querySelectorAll("option").length,
    ).toBe(6);
  });

  it("creates, edits, and cancels a reservation in the same in-memory collection", async () => {
    renderDashboard();
    let dialog = openReservationFromDashboard();
    completeReservation(dialog);

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Reservation" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "created in this session",
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Local demo reservations" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /^John Doe, Room .*confirmed,/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    dialog = screen.getByRole("dialog", { name: "Edit reservation" });
    expect(within(dialog).getByLabelText("Reservation note")).toHaveProperty(
      "value",
      "",
    );
    fireEvent.change(within(dialog).getByLabelText("Reservation note"), {
      target: { value: "Late arrival" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save Changes" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("updated"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^John Doe, Room .*confirmed,/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    dialog = screen.getByRole("dialog", { name: "Edit reservation" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Cancel Reservation" }),
    );
    const cancelDialog = within(dialog).getByRole("alertdialog", {
      name: "Cancel Reservation?",
    });
    fireEvent.click(
      within(cancelDialog).getByRole("button", {
        name: "Cancel Reservation",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("cancelled"),
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show inactive reservations" }),
    );
    expect(
      screen.getByRole("button", { name: /^John Doe, Room .*cancelled,/ }),
    ).toBeTruthy();

    const nextDialog = openReservationFromDashboard();
    const roomOption = within(nextDialog)
      .getByRole("combobox", { name: "Choose available room" })
      .querySelector('option[value="203"]');
    expect(roomOption?.hasAttribute("disabled")).toBe(false);
  }, 15000);

  it("requires confirmation before discarding a dirty draft and handles Escape", () => {
    renderDashboard();
    const dialog = openReservationFromDashboard();
    fireEvent.change(screen.getByLabelText("Reservation note"), {
      target: { value: "Keep this draft" },
    });
    fireEvent.keyDown(document, { key: "Escape" });

    const discardDialog = screen.getByRole("alertdialog", {
      name: "Discard changes?",
    });
    expect(discardDialog).toBeTruthy();
    fireEvent.click(
      within(discardDialog).getByRole("button", { name: "Keep Editing" }),
    );
    expect(screen.getByRole("dialog", { name: "Create reservation" })).toBe(
      dialog,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(
      within(
        screen.getByRole("alertdialog", { name: "Discard changes?" }),
      ).getByRole("button", { name: "Discard" }),
    );
    expect(screen.queryByRole("dialog", { name: "Create reservation" })).toBeNull();
  });

  it("locks background scrolling only while the pane is full-screen on mobile", () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    const { unmount } = renderDashboard();
    openReservationFromDashboard();
    expect(document.body.style.overflow).not.toBe("hidden");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    fireEvent.resize(window);
    expect(document.body.style.overflow).toBe("hidden");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });
    fireEvent.resize(window);
    expect(document.body.style.overflow).not.toBe("hidden");

    unmount();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalWidth,
    });
  });
});
