import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { ReservationPane } from "./ReservationPane";
import { createHotelDateTime } from "../../lib/hotelTime";
import type { ReservationSnapshot } from "../../types/reservation";

function Harness({ saved, save }: { saved?: ReservationSnapshot; save: (reservation: ReservationSnapshot) => void }) {
  const { guests, stays, setConfiguration } = useReservationDemo();
  return <><button onClick={() => setConfiguration((current) => ({ ...current, roomTypes: current.roomTypes.map((type) => ({ ...type, defaultInclusions: [{ catalogId: "bottled-water", quantity: 99 }] })) }))}>Change defaults</button>
    <ReservationPane initialCheckIn={createHotelDateTime(2026, 11, 10, 14)} initialRoom={saved ? undefined : "101"} initialReservation={saved} guests={guests} stays={stays} onClose={() => {}} onCreated={save} onSaved={save} onGuestCreated={() => {}} /></>;
}
function mount(save: (reservation: ReservationSnapshot) => void, saved?: ReservationSnapshot) { return render(<ReservationDemoProvider><Harness saved={saved} save={save} /></ReservationDemoProvider>); }
describe("default inclusions in reservations", () => {
  it("populates defaults, preserves manual selections through room changes, and freezes saved quantities", async () => {
    const save = vi.fn(); const view = mount(save);
    fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
    fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "direct" } });
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByLabelText("Bottled water quantity")).toHaveProperty("value", "1");
    fireEvent.change(screen.getByLabelText("Bottled water quantity"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Assigned room 101"), { target: { value: "102" } });
    expect(screen.getByLabelText("Bottled water quantity")).toHaveProperty("value", "0");
    fireEvent.change(screen.getByLabelText("Assigned room 102"), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText("Bottled water quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Towels quantity"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Assigned room 101"), { target: { value: "107" } });
    expect(screen.getByLabelText("Bottled water quantity")).toHaveProperty("value", "3");
    expect(screen.getByLabelText("Toiletry kit quantity")).toHaveProperty("value", "2");
    expect(screen.getByLabelText("Towels quantity")).toHaveProperty("value", "2");
    fireEvent.change(screen.getByLabelText("Bottled water quantity"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Assigned room 107"), { target: { value: "101" } });
    expect(screen.getByLabelText("Bottled water quantity")).toHaveProperty("value", "1");
    expect(screen.getByLabelText("Toiletry kit quantity")).toHaveProperty("value", "0");
    fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const saved = save.mock.calls[0][0] as ReservationSnapshot;
    expect(saved.rooms[0].inclusions).toEqual([{ catalogId: "towels", label: "Towels", quantity: 2 }, { catalogId: "bottled-water", label: "Bottled water", quantity: 1 }]);
    expect(saved.rooms[0].inclusionOrigins?.["towels"].source).toBe("manual");
    view.unmount();
    const update = vi.fn(); mount(update, saved);
    fireEvent.click(screen.getByRole("button", { name: "Change defaults" }));
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(screen.getByLabelText("Bottled water quantity")).toHaveProperty("value", "1");
    fireEvent.change(screen.getByLabelText("Reservation note"), { target: { value: "Unrelated note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].rooms[0].inclusions).toEqual(saved.rooms[0].inclusions);
  });
});
