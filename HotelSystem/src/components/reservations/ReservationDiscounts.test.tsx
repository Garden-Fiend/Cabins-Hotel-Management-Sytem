import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { ReservationPane } from "./ReservationPane";
import type { ReservationSnapshot } from "../../types/reservation";
import { createHotelDateTime } from "../../lib/hotelTime";
import { ReservationPrintPage } from "../../pages/ReservationPrintPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const start = createHotelDateTime(2026, 11, 10, 14);
function Harness({ saved, onSave = () => {} }: { saved?: ReservationSnapshot; onSave?: (reservation: ReservationSnapshot) => void }) {
  const { configuration, setConfiguration, guests, stays } = useReservationDemo();
  return <>
    <button type="button" onClick={() => setConfiguration((current) => ({ ...current,
      discounts: [], defaultCheckOutTime: "09:00",
      roomTypePrices: current.roomTypePrices.map((rate) => ({ ...rate, amount: 9999 })),
      catalogItems: current.catalogItems.map((item) => ({ ...item, price: 777 })),
      durations: current.durations.map((duration) => ({ ...duration, minutes: 999, nights: 9 })),
    }))}>Change configuration</button>
    <ReservationPane initialCheckIn={start} initialRoom={saved ? undefined : "101"} initialReservation={saved}
      guests={guests} stays={stays} onClose={() => {}} onCreated={onSave} onSaved={onSave} onGuestCreated={() => {}} />
    <output aria-label="Configured currency">{configuration.currency}</output>
  </>;
}
function mount(saved?: ReservationSnapshot, onSave?: (reservation: ReservationSnapshot) => void) {
  return render(<ReservationDemoProvider><Harness saved={saved} onSave={onSave} /></ReservationDemoProvider>);
}
function completeGuest() {
  fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
  fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "direct" } });
}

describe("contextual discount application", () => {
  it("collapses room settings, scrolls the pane to Stage 3 and retains entered values", () => {
    mount();
    const stage = screen.getByRole("heading", { name: "3. Rooms" }).closest("section")!;
    const scrollContainer = stage.parentElement!;
    const scrollTo = vi.fn();
    Object.defineProperty(scrollContainer, "scrollTo", { value: scrollTo, configurable: true });
    scrollContainer.scrollTop = 600;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ top: 250 } as DOMRect);
    vi.spyOn(scrollContainer, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    const configure = screen.getByRole("button", { name: "Configure" });
    fireEvent.click(configure);
    expect(configure.getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(screen.getByLabelText("Adults"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Adults")).toBeNull();
    expect(configure.getAttribute("aria-expanded")).toBe("false");
    expect(scrollTo).toHaveBeenCalledWith({ top: 730, behavior: "smooth" });
    expect(document.activeElement).toBe(configure);
    fireEvent.click(configure);
    expect((screen.getByLabelText("Adults") as HTMLInputElement).value).toBe("3");
  });

  it("keeps presets read-only, applies reservation presets explicitly and edits/removes manual discounts", () => {
    mount(); completeGuest();
    const roomSelector = screen.getByLabelText("Room 101 discount");
    expect(within(roomSelector).getByRole("option", { name: "Standard Special Rate" })).toBeTruthy();
    fireEvent.change(roomSelector, { target: { value: "standard-special" } });
    expect(screen.getByText(/preset, read-only/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton", { name: "Discounted Unit Price" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Reservation preset"), { target: { value: "weekend-promo" } });
    expect(screen.queryByRole("button", { name: "Remove Weekend promotion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply reservation preset" }));
    expect(screen.getByRole("button", { name: "Remove Weekend promotion" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Manual discount label"), { target: { value: "Courtesy" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add discount" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit manual discount" }));
    fireEvent.change(screen.getByLabelText("Percentage"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save manual discount" }));
    expect(screen.getByText(/Courtesy.*5%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Courtesy" }));
    expect(screen.queryByRole("button", { name: "Remove Courtesy" })).toBeNull();
  });
  it("warns and blocks saving an incompatible duration until the discount is removed", () => {
    mount(); completeGuest();
    fireEvent.change(screen.getByLabelText("Room 101 discount"), { target: { value: "standard-special" } });
    fireEvent.change(screen.getByLabelText("Duration *"), { target: { value: "8-hours" } });
    expect(screen.getByRole("alert").textContent).toContain("no longer matches");
    expect(screen.getByRole("button", { name: "Create Reservation" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove Standard Special Rate" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Create Reservation" }).hasAttribute("disabled")).toBe(false);
  });
  it("applies item presets only to their selected line and removes them with that line", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    fireEvent.change(screen.getByLabelText("Add extra charge"), { target: { value: "laundry" } });
    fireEvent.change(screen.getByLabelText("Laundry quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Laundry × 3 discount"), { target: { value: "laundry-special" } });
    expect(screen.getByRole("button", { name: "Remove Laundry Special Price" })).toBeTruthy();
    const selector = screen.getByLabelText("Laundry × 3 discount");
    const chargeRow = selector.closest("div.flex")! as HTMLElement;
    fireEvent.click(within(chargeRow).getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("button", { name: "Remove Laundry Special Price" })).toBeNull();
    expect(screen.getByText(/Charge removed; its targeted discounts/)).toBeTruthy();
  });
  it("preserves prices, nights, selections and stay timestamps after configuration changes and unrelated edits", async () => {
    const save = vi.fn();
    const first = mount(undefined, save); completeGuest();
    fireEvent.change(screen.getByLabelText("Duration *"), { target: { value: "2-nights" } });
    fireEvent.change(screen.getByLabelText("Room 101 discount"), { target: { value: "standard-special" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as ReservationSnapshot;
    expect(saved.pricing).toMatchObject({ subtotal: 4400, discountTotal: 500, amountOwed: 3900 });
    first.unmount();
    const update = vi.fn(); mount(saved, update);
    fireEvent.click(screen.getByRole("button", { name: "Change configuration" }));
    expect(screen.getByRole("option", { name: /Standard Special Rate \(saved historical preset\)/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reservation note"), { target: { value: "Unrelated edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const result = update.mock.calls[0][0] as ReservationSnapshot;
    expect(result.pricing.amountOwed).toBe(3900);
    expect(result.pricing.discounts[0]).toMatchObject({ quantity: 2, baseUnitPrice: 2200, discountedUnitPrice: 1950 });
    expect(result.rooms[0].checkOut).toEqual(saved.rooms[0].checkOut);
    expect(result.checkOut).toEqual(saved.checkOut);
  });
  it("prints captured base prices and discounts without consulting current preset definitions", async () => {
    const save = vi.fn(); const first = mount(undefined, save); completeGuest();
    fireEvent.change(screen.getByLabelText("Room 101 discount"), { target: { value: "standard-special" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as ReservationSnapshot; first.unmount();
    function PrintFixture() {
      const { setReservations, setConfiguration } = useReservationDemo();
      return <><button onClick={() => { setReservations([saved]); setConfiguration((current) => ({ ...current, discounts: [] })); }}>Load snapshot</button><ReservationPrintPage /></>;
    }
    render(<MemoryRouter initialEntries={[`/reservations/${saved.id}/print`]}><ReservationDemoProvider><Routes><Route path="/reservations/:reservationId/print" element={<PrintFixture />} /></Routes></ReservationDemoProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Load snapshot" }));
    expect(screen.getByText(/Discount · Standard Special Rate/)).toBeTruthy();
    expect(screen.getByText(/unit ₱1,100.00 → ₱950.00 × 1/)).toBeTruthy();
    expect(screen.getAllByText("₱950.00").length).toBeGreaterThan(0);
  });
});
