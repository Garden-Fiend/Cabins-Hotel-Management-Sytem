import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { router } from "../app/router";

function renderRoute(path: string) {
  const memoryRouter = createMemoryRouter(router.routes, { initialEntries: [path] });
  render(
    <ReservationDemoProvider>
      <RouterProvider router={memoryRouter} />
    </ReservationDemoProvider>,
  );
  return memoryRouter;
}

describe("discounts page routing", () => {
  it("opens the entire discount module directly at /discounts", () => {
    renderRoute("/discounts");
    expect(screen.getByRole("heading", { name: "Discounts", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Discount Presets" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Discounts" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
    expect(screen.getByLabelText("Discount Name")).toBeTruthy();
    expect(screen.getByLabelText("Nightly discounted price")).toBeTruthy();
  });

  it("navigates from configuration and retains saved presets when changing pages", async () => {
    const memoryRouter = renderRoute("/configuration");
    expect(screen.queryByRole("button", { name: "Discounts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create Discount" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Discounts" }));
    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/discounts"));
    fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
    fireEvent.change(screen.getByLabelText("Discount Name"), { target: { value: "Page courtesy" } });
    fireEvent.change(screen.getByLabelText("Apply To"), { target: { value: "reservation" } });
    fireEvent.change(screen.getByLabelText("Discount Method"), { target: { value: "fixed" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Discount" }));
    expect(screen.getByRole("row", { name: /Page courtesy/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Configuration" }));
    await waitFor(() => expect(memoryRouter.state.location.pathname).toBe("/configuration"));
    fireEvent.click(screen.getByRole("link", { name: "Discounts" }));
    await waitFor(() => expect(screen.getByRole("row", { name: /Page courtesy/ })).toBeTruthy());
  });
});
