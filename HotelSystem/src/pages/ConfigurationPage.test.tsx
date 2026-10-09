import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReservationDemoProvider } from "../app/ReservationDemoContext";
import { ConfigurationPage } from "./ConfigurationPage";

function renderConfiguration() {
  return render(
    <ReservationDemoProvider>
      <ConfigurationPage />
    </ReservationDemoProvider>,
  );
}

describe("hotel configuration", () => {
  it("edits configuration data in the shared in-memory provider", () => {
    renderConfiguration();
    const standardRow = screen.getByRole("row", { name: /Standard/ });
    fireEvent.click(within(standardRow).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("row", { name: /Executive/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /^Standard/ })).toBeNull();
  });

  it("saves the configurable default overnight times", () => {
    renderConfiguration();
    fireEvent.change(screen.getByLabelText("Default check-in"), {
      target: { value: "15:00" },
    });
    fireEvent.change(screen.getByLabelText("Default checkout"), {
      target: { value: "11:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save hotel settings" }));
    expect(screen.getByRole("status").textContent).toContain(
      "Hotel defaults and currency updated",
    );
  });

  it("configures hourly packages and a single nightly base rate", () => {
    renderConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "Room Prices" }));

    expect(screen.getByRole("combobox", { name: "Hourly package" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Rate type" }), {
      target: { value: "overnight" },
    });
    expect(screen.queryByRole("combobox", { name: "Hourly package" })).toBeNull();
    expect(screen.getByRole("spinbutton", { name: "Price" })).toBeTruthy();
  });

  it("does not offer room-specific rates in physical room configuration", () => {
    renderConfiguration();
    fireEvent.click(screen.getByRole("button", { name: "Rooms" }));
    expect(screen.queryByLabelText(/price override/i)).toBeNull();
  });
});
