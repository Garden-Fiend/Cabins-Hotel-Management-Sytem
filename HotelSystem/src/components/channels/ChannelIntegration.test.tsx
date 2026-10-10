import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { demoChannelCapabilities } from "../../app/permissions";
import { ReservationPane } from "../reservations/ReservationPane";
import { ReservationDetailPage } from "../../pages/ReservationDetailPage";
import { ReservationPrintPage } from "../../pages/ReservationPrintPage";
import { ConfigurationPage } from "../../pages/ConfigurationPage";
import { createHotelDateTime } from "../../lib/hotelTime";
import { demoReservations } from "../../data/demoReservations";
import type { ReservationSnapshot } from "../../types/reservation";
function Pane({ saved, onSave }: {
    saved?: ReservationSnapshot;
    onSave: (r: ReservationSnapshot) => void;
}) { const { guests, stays } = useReservationDemo(); return <ReservationPane initialCheckIn={createHotelDateTime(2026, 11, 10, 14)} initialRoom={saved ? undefined : "101"} initialReservation={saved} guests={guests} stays={stays} onCreated={onSave} onSaved={onSave} onClose={() => { }} onGuestCreated={() => { }}/>; }
const saved = () => structuredClone(demoReservations.find(r => r.id === "CHANNEL-2")!);
describe("channel screen integration", () => {
    it("captures a channel agreement and external accommodation total without assuming collection", async () => {
        const onSave = vi.fn();
        render(<ReservationDemoProvider>
        <Pane onSave={onSave}/>
        </ReservationDemoProvider>);
        fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
        fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "booking-com" } });
        expect(screen.getByText(/Verification: pending/)).toBeTruthy();
        fireEvent.change(screen.getByLabelText("External booking reference"), { target: { value: "BOOK-TEST" } });
        fireEvent.change(screen.getByLabelText(/Confirmed accommodation \(PHP/), { target: { value: "800.01" } });
        fireEvent.change(screen.getByLabelText("Override reason"), { target: { value: "Confirmed documentation" } });
        fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const r = onSave.mock.calls[0][0] as ReservationSnapshot;
        expect(r.channelTerms!.agreement!.channelId).toBe("booking-com");
        expect(r.pricing.channel!.confirmedAccommodationMinor).toBe(80001);
        expect(r.pricing.channel!.verifiedCollectionMinor).toBe(0);
    });
    it("records verified collection during reservation entry without implying a payout", async () => {
        const onSave = vi.fn();
        render(<ReservationDemoProvider>
        <Pane onSave={onSave}/>
        </ReservationDemoProvider>);
        fireEvent.click(screen.getByRole("button", { name: /John Doe/ }));
        fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "booking-com" } });
        fireEvent.change(screen.getByLabelText("External booking reference"), { target: { value: "PREPAID-TEST" } });
        fireEvent.change(screen.getByLabelText("Verified collected amount (PHP)"), { target: { value: "100" } });
        fireEvent.change(screen.getByLabelText("Payment document reference"), { target: { value: "DOCUMENT-TEST" } });
        fireEvent.click(screen.getByRole("button", { name: "Add verified collection" }));
        fireEvent.click(screen.getByRole("button", { name: "Create Reservation" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const r = onSave.mock.calls[0][0] as ReservationSnapshot;
        expect(r.pricing.channel!.verifiedCollectionMinor).toBe(10000);
        expect(r.channelTerms!.collection.status).toBe("partial");
        expect(r.channelTerms!.confirmedEntitlement).toBeUndefined();
        expect(r.audit.filter(a => a.action.includes("DOCUMENT-TEST"))).toHaveLength(1);
    });
    it("requires source review and retains earlier verified financial terms", async () => {
        const original = saved(), onSave = vi.fn();
        render(<ReservationDemoProvider>
        <Pane saved={original} onSave={onSave}/>
        </ReservationDemoProvider>);
        fireEvent.change(screen.getByLabelText("Booking source *"), { target: { value: "booking-com" } });
        expect(screen.getByRole("dialog", { name: "Review booking source change" })).toBeTruthy();
        expect((screen.getByLabelText("Booking source *") as HTMLSelectElement).value).toBe("agoda");
        fireEvent.click(screen.getByRole("button", { name: "Confirm reviewed source change" }));
        fireEvent.change(screen.getByLabelText("External booking reference"), { target: { value: "NEW-REFERENCE" } });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const r = onSave.mock.calls[0][0] as ReservationSnapshot;
        expect(r.bookingSourceId).toBe("booking-com");
        expect(r.supersededChannelTerms![0].collection.transactions).toEqual(original.channelTerms!.collection.transactions);
        expect(r.pricing.channel!.verifiedCollectionMinor).toBe(240000);
    });
    it("rejects invalid edited financial input instead of saving its previous valid amount", async () => {
        const onSave = vi.fn();
        render(<ReservationDemoProvider>
        <Pane saved={saved()} onSave={onSave}/>
        </ReservationDemoProvider>);
        fireEvent.change(screen.getByLabelText(/Confirmed accommodation \(PHP/), { target: { value: "invalid" } });
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(screen.getByText(/Correct channel amounts/)).toBeTruthy();
        expect(onSave).not.toHaveBeenCalled();
    });
    it("keeps retired channels visible and gates accounting controls centrally", () => {
        const capabilities = { ...demoChannelCapabilities, confirm_commission: false, record_settlement: false, reconcile_settlement: false };
        render(<ReservationDemoProvider capabilities={capabilities}>
        <MemoryRouter initialEntries={["/reservations/CHANNEL-2"]}>
        <Routes>
        <Route path="/reservations/:reservationId" element={<ReservationDetailPage />}/>
        </Routes>
        </MemoryRouter>
        </ReservationDemoProvider>);
        expect(screen.getByRole("heading", { name: /Channel booking details/ })).toBeTruthy();
        expect(screen.queryByRole("heading", { name: "Channel financials" })).toBeNull();
        expect(screen.getByText(/inactive historical item/)).toBeTruthy();
    });
    it("records guest verification independently of an existing partial hotel batch payout", () => {
        render(<ReservationDemoProvider>
        <MemoryRouter initialEntries={["/reservations/CHANNEL-2"]}>
        <Routes>
        <Route path="/reservations/:reservationId" element={<ReservationDetailPage />}/>
        </Routes>
        </MemoryRouter>
        </ReservationDemoProvider>);
        fireEvent.change(screen.getByLabelText("Verified amount (PHP)"), { target: { value: "120" } });
        fireEvent.change(screen.getByLabelText("Document / collection reference"), { target: { value: "VERIFY-EXTRAS" } });
        fireEvent.click(screen.getByRole("button", { name: "Record verification" }));
        expect(screen.getAllByText(/VERIFY-EXTRAS/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Covers 2 reservation/)).toBeTruthy();
        expect(screen.getByText(/Illustrative partial batch payout/)).toBeTruthy();
    });
    it("records and reconciles a new batch payout without changing guest charges",()=>{
        render(<ReservationDemoProvider><MemoryRouter initialEntries={["/reservations/CHANNEL-2"]}><Routes><Route path="/reservations/:reservationId" element={<ReservationDetailPage/>}/></Routes></MemoryRouter></ReservationDemoProvider>);
        const billing=screen.getByRole("region",{name:"Channel guest billing"}).textContent;
        fireEvent.change(screen.getByLabelText("Payout / statement reference"),{target:{value:"NEW-BATCH-TEST"}});
        fireEvent.change(screen.getByLabelText("Settlement allocation CHANNEL-2"),{target:{value:"100"}});
        fireEvent.change(screen.getByLabelText("Settlement allocation CHANNEL-12"),{target:{value:"200"}});
        fireEvent.click(screen.getByRole("button",{name:"Record settlement"}));
        const transaction=screen.getByText(/^Reference NEW-BATCH-TEST/).closest("div")!;
        expect(within(transaction).getByText(/Covers 2 reservation/)).toBeTruthy();
        fireEvent.change(within(transaction).getByLabelText("Reconciliation for NEW-BATCH-TEST"),{target:{value:"reconciled"}});
        fireEvent.change(within(transaction).getByLabelText("Reconciliation explanation for NEW-BATCH-TEST"),{target:{value:"Matched statement and bank receipt"}});
        fireEvent.click(within(transaction).getByRole("button",{name:"Update reconciliation"}));
        expect(within(transaction).getByText(/payout.*reconciled/)).toBeTruthy();
        expect(screen.getByRole("region",{name:"Channel guest billing"}).textContent).toBe(billing);
    });
    it("prints guest balances without the accounting controls", () => {
        render(<ReservationDemoProvider>
        <MemoryRouter initialEntries={["/reservations/CHANNEL-2/print"]}>
        <Routes>
        <Route path="/reservations/:reservationId/print" element={<ReservationPrintPage />}/>
        </Routes>
        </MemoryRouter>
        </ReservationDemoProvider>);
        expect(screen.getByRole("region", { name: "Channel guest billing" })).toBeTruthy();
        expect(screen.getByText("Guest balance (negative means credit)")).toBeTruthy();
        expect(screen.queryByText("Channel financials")).toBeNull();
    });
    it("adds configurable channels in the existing Booking Sources section", () => {
        render(<ReservationDemoProvider>
        <ConfigurationPage />
        </ReservationDemoProvider>);
        fireEvent.click(screen.getByRole("button", { name: "Booking Sources" }));
        fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
        fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Local travel partner" } });
        fireEvent.change(screen.getByLabelText("Classification"), { target: { value: "agent" } });
        fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
        const source = screen.getByText("Local travel partner").closest("li")!;
        expect(within(source).getByText(/agent/)).toBeTruthy();
        fireEvent.click(within(source).getByRole("button", { name: "New agreement version" }));
        expect(screen.getByRole("heading", { name: "Agreement version 1" })).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Save agreement" }));
        expect(screen.getByText(/Version 1 \/ draft/)).toBeTruthy();
    });
});
