import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReservationDemoProvider } from "../../app/ReservationDemoContext";
import { useReservationDemo } from "../../app/useReservationDemo";
import { createHotelDateTime } from "../../lib/hotelTime";
import { ReservationPane } from "./ReservationPane";
function Harness({onCreated=()=>{}}: {onCreated?:(...args:Parameters<React.ComponentProps<typeof ReservationPane>["onCreated"]>)=>void}) {
  const {guests,stays}=useReservationDemo();
  return <ReservationPane initialCheckIn={createHotelDateTime(2026,11,10,14)} initialRoom="101" guests={guests} stays={stays} onCreated={onCreated} onClose={()=>{}} onGuestCreated={()=>{}}/>;
}
function mount() {return render(<ReservationDemoProvider><Harness/></ReservationDemoProvider>);}
describe("front desk reservation layout",()=>{
  it("keeps the five main stages visible and optional controls collapsed",()=>{
    mount();
    for(const name of ["1. Primary guest","2. Reservation stay","3. Rooms","4. Booking information","5. Review & save"]) expect(screen.getByRole("heading",{name})).toBeTruthy();
    for(const help of ["Discounts","Billing adjustments","Reservation note"]) expect(screen.getByRole("button",{name:`Help: ${help}`}).closest("details")!.open).toBe(false);
    expect(screen.getByRole("button",{name:"Help: Price breakdown"}).closest("details")!.open).toBe(false);
    expect(screen.queryByText(/tax and payments are not included/)).toBeNull();
  });
  it("explains settings on hover, focus and tap, with Escape dismissal",()=>{
    mount();const help=screen.getByRole("button",{name:"Help: Discounts"});
    fireEvent.mouseEnter(help);expect(screen.getByRole("tooltip").textContent).toContain("manual room discount includes its extras");
    fireEvent.mouseLeave(help);expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(help);expect(help.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.keyDown(help,{key:"Escape"});expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(help);expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(help.closest("details")!.open).toBe(false);
    fireEvent.blur(help);expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("shows the remaining balance beside Save while keeping optional OTA inputs collapsed",()=>{
    const {container}=mount();fireEvent.change(screen.getByLabelText("Booking source *"),{target:{value:"booking-com"}});
    expect(screen.getByRole("button",{name:"Help: Channel accommodation total"}).closest("details")!.open).toBe(false);
    expect(screen.getByRole("button",{name:"Help: Commission estimates"}).closest("details")!.open).toBe(false);
    fireEvent.change(screen.getByLabelText("Verified collected amount (PHP)"),{target:{value:"100"}});
    fireEvent.change(screen.getByLabelText("Payment document reference"),{target:{value:"EXAMPLE-RECEIPT"}});
    fireEvent.click(screen.getByRole("button",{name:"Add verified collection"}));
    const footer=container.querySelector("footer")!;
    expect(within(footer).getByText("Guest balance")).toBeTruthy();
    expect(within(footer).getByText("\u20b11,000.00")).toBeTruthy();
  });
  it("shows an OTA reference validation error next to Create and saves after correction",async()=>{
    const onCreated=vi.fn();const {container}=render(<ReservationDemoProvider><Harness onCreated={onCreated}/></ReservationDemoProvider>);
    fireEvent.click(screen.getByRole("button",{name:/John Doe/}));
    fireEvent.change(screen.getByLabelText("Booking source *"),{target:{value:"booking-com"}});
    const create=screen.getByRole("button",{name:"Create Reservation"});fireEvent.click(create);
    expect(within(container.querySelector("footer")!).getByRole("alert").textContent).toContain("external booking reference is required");
    expect(create.getAttribute("aria-describedby")).toBe("reservation-save-error");expect(onCreated).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("External booking reference"),{target:{value:"BOOK-TEST"}});fireEvent.click(create);
    await waitFor(()=>expect(onCreated).toHaveBeenCalledOnce());
  });
  it("shows a missing override reason beside Save instead of silently ignoring the click",()=>{
    const {container}=mount();fireEvent.click(screen.getByRole("button",{name:/John Doe/}));
    fireEvent.change(screen.getByLabelText("Booking source *"),{target:{value:"booking-com"}});
    fireEvent.change(screen.getByLabelText("External booking reference"),{target:{value:"BOOK-TEST"}});
    fireEvent.change(screen.getByLabelText(/Confirmed accommodation \(PHP/),{target:{value:"900"}});
    fireEvent.click(screen.getByRole("button",{name:"Create Reservation"}));
    expect(within(container.querySelector("footer")!).getByRole("alert").textContent).toContain("override reason");
  });
  it("releases the save button after a failed save so staff can retry",async()=>{
    const onCreated=vi.fn().mockImplementationOnce(()=>{throw new Error("Example save failure");});
    const {container}=render(<ReservationDemoProvider><Harness onCreated={onCreated}/></ReservationDemoProvider>);
    fireEvent.click(screen.getByRole("button",{name:/John Doe/}));fireEvent.change(screen.getByLabelText("Booking source *"),{target:{value:"direct"}});
    fireEvent.click(screen.getByRole("button",{name:"Create Reservation"}));
    await waitFor(()=>expect(within(container.querySelector("footer")!).getByRole("alert").textContent).toBe("Example save failure"));
    const create=screen.getByRole("button",{name:"Create Reservation"}) as HTMLButtonElement;expect(create.disabled).toBe(false);fireEvent.click(create);
    await waitFor(()=>expect(onCreated).toHaveBeenCalledTimes(2));
  });

});
