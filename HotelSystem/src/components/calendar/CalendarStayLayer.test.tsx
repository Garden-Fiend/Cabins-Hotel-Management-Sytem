import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { CalendarStayLayer } from "./CalendarStayLayer";
import { competingStays } from "../../lib/calendarInteraction";
import type { Stay } from "../../types/booking";

const stay: Stay = { id: 1, room: "101", guest: "Short Guest", status: "confirmed", checkIn: new Date(0), checkOut: new Date(3600000) };
const second = { ...stay, id: 2, guest: "Adjacent Guest", checkIn: new Date(3600000), checkOut: new Date(7200000) };
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1000, left: 0, right: 1000, top: 0, bottom: 64, height: 64, x: 0, y: 0, toJSON() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const positionFor = (value: Stay) => ({ startRatio: value.id === 1 ? 0.5 : 0.5005, endRatio: value.id === 1 ? 0.5005 : 0.501, widthRatio: 0.0005 });

it("retains exact subpixel geometry and supplies a distinct accessible target", () => {
  const open = vi.fn();
  render(<CalendarStayLayer stays={[stay]} now={new Date(0)} positionFor={positionFor} onStayClick={open} />);
  const bar = screen.getByTestId("occupancy-interval");
  expect(bar.style.width).toBe("0.05%");
  expect(bar.style.left).toBe("50%");
  expect(bar.style.padding).toBe("0px");
  const target = screen.getByRole("button", { name: /Short stay: Short Guest, Room 101/ });
  fireEvent.click(target, { detail: 0 });
  expect(open).toHaveBeenCalledWith(stay);
});
it("requires an explicit choice for competing pointer targets", () => {
  const open = vi.fn();
  render(<CalendarStayLayer stays={[second, stay]} now={new Date(0)} positionFor={positionFor} onStayClick={open} />);
  fireEvent.click(screen.getByRole("button", { name: /Short stay: Short Guest/ }), { detail: 1, clientX: 500 });
  expect(open).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Choose reservation" });
  expect(dialog.textContent).toContain("Adjacent Guest");
  fireEvent.click(screen.getByRole("button", { name: /^Adjacent Guest,/ }));
  expect(open).toHaveBeenCalledWith(second);
});
it("uses half-open duration targets and leaves distant empty positions alone", () => {
  const entries = [{ stay, position: { startRatio: 0.1, endRatio: 0.2, widthRatio: 0.1 } }, { stay: second, position: { startRatio: 0.2, endRatio: 0.3, widthRatio: 0.1 } }];
  expect(competingStays(entries, 1000, 200)).toEqual([second]);
  expect(competingStays(entries, 1000, 500)).toEqual([]);
});
