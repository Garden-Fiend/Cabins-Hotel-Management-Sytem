import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { ReservationPane } from "./ReservationPane";
import { createHotelDateTime } from "../../lib/hotelTime";
import type { ReservationSnapshot } from "../../types/reservation";

function Harness({ saved, onSave }: { saved?: ReservationSnapshot; onSave: (reservation: ReservationSnapshot) => void }) {
  const { guests, stays, setConfiguration } = useReservationDemo();
  return <><button onClick={() => setConfiguration((current) => ({ ...current, breakfastEligibleItems: [], catalogItems: current.catalogItems.map((item) => ({ ...item, enabled: false, price: 999 })) }))}>Retire catalog</button>
    <ReservationPane initialCheckIn={createHotelDateTime(2026, 11, 10, 14)} initialRoom={saved ? undefined : "101"} initialReservation={saved} guests={guests} stays={stays} onClose={() => {}} onCreated={onSave} onSaved={onSave} onGuestCreated={() => {}} /></>;
}
function mount(onSave: (reservation: ReservationSnapshot) => void, saved?: ReservationSnapshot) {
  return render(<ReservationDemoProvider><Harness saved={saved} onSave={onSave} /></ReservationDemoProvider>);
}
function configure() { fireEvent.click(screen.getByRole("button", { name: "Configure" })); }

describe("reservation purchases and complimentary breakfast", () => {
  it("separates purchases from extras and preserves captured purchases after retiring inventory", async () => {
    const save = vi.fn(); const view = mount(save);
    fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
    fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "direct" } });
    configure();
    expect(within(screen.getByLabelText("Add extra charge")).queryByRole("option", { name: /Coffee/ })).toBeNull();
    expect(screen.queryByText("Guest 1")).toBeNull();
    fireEvent.change(screen.getByLabelText("Add purchased item"), { target: { value: "coffee" } });
    fireEvent.change(screen.getByLabelText("Coffee quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as ReservationSnapshot;
    expect(saved.rooms[0].charges[0]).toMatchObject({ usage: "purchase", catalogId: "coffee", quantity: 2, unitPrice: 50 });
    expect(saved.pricing.amountOwed).toBe(1200);
    expect(saved.pricing.lines.filter((line) => line.catalogId === "coffee")).toHaveLength(1);
    view.unmount();
    const update = vi.fn(); mount(update, saved); configure();
    fireEvent.click(screen.getByRole("button", { name: "Retire catalog" }));
    expect(screen.getByLabelText("Coffee quantity")).toHaveProperty("value", "2");
    expect(within(screen.getByLabelText("Add purchased item")).queryByRole("option", { name: /Coffee/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Coffee quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].pricing.amountOwed).toBe(1250);
  });
  it("provides nightly breakfast choices from eligibility and keeps saved selections after eligibility removal", async () => {
    const save = vi.fn(); const view = mount(save);
    fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
    fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "direct" } });
    fireEvent.change(screen.getByLabelText("Duration *"), { target: { value: "1-night" } });
    configure();
    const statuses = screen.getAllByRole("combobox").filter((select) => within(select).queryByRole("option", { name: "Skip breakfast" }));
    expect(statuses).toHaveLength(2);
    fireEvent.change(statuses[0], { target: { value: "included" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as ReservationSnapshot;
    expect(saved.rooms[0].breakfast[0]).toMatchObject({ mealId: "filipino", beverageId: "coffee", unitPrice: 0, lineTotal: 0 });
    expect(saved.pricing.amountOwed).toBe(2200);
    view.unmount();
    const update = vi.fn(); mount(update, saved); configure();
    fireEvent.click(screen.getByRole("button", { name: "Retire catalog" }));
    expect(screen.getByRole("option", { name: /Filipino breakfast.*inactive/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reservation note"), { target: { value: "Unrelated edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].rooms[0].breakfast).toEqual(saved.rooms[0].breakfast);
  });
});
