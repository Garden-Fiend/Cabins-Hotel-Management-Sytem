import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { demoReservations } from "../../data/demoReservations";
import { ReservationPane } from "./ReservationPane";

it("preserves legacy duplicate rows and refuses both ambiguous removal and no-op save", () => {
  const saved = { ...demoReservations[0], adjustments: [{ id: "duplicate", amount: 100, reason: "Legacy A" }, { id: "duplicate", amount: 200, reason: "Legacy B" }] };
  const before = JSON.stringify(saved);
  const onSave = vi.fn();
  function Harness() {
    const { guests, stays } = useReservationDemo();
    return <ReservationPane initialCheckIn={saved.checkIn} initialReservation={saved} guests={guests} stays={stays} onClose={() => {}} onCreated={onSave} onSaved={onSave} onGuestCreated={() => {}} />;
  }
  // Duplicate-key diagnostics belong to the deliberate legacy fixture, not newly created rows.
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<ReservationDemoProvider><Harness /></ReservationDemoProvider>);
    const details = screen.getByText(/Billing adjustments/, { selector: "summary" }).closest("details")!;
    details.setAttribute("open", "");
    fireEvent.click(within(details.querySelector("li")!).getByRole("button", { name: "Remove" }));
    expect(details.querySelectorAll("li")).toHaveLength(2);
    const save = screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText(/reviewed repair/i).length).toBeGreaterThan(0);
    expect(JSON.stringify(saved)).toBe(before);
  } finally { consoleError.mockRestore(); }
});
