import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiContext, type ApiContextValue } from "../../app/api/store";
import { ApiError } from "../../app/api/client";
import { ApiGuestForm } from "./ApiReservationForms";

function setup(createGuest = vi.fn()) {
  render(<ApiContext.Provider value={{createGuest, refreshing:false} as unknown as ApiContextValue}><ApiGuestForm /></ApiContext.Provider>);
  const opener = screen.getByRole("button", {name:"Create guest"});
  opener.focus(); fireEvent.click(opener);
  return opener;
}

describe("API guest popup", () => {
  it("resets cancelled inputs and returns focus to the create button", () => {
    const opener = setup();
    expect(screen.getByRole("dialog", {name:"Create guest"})).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Guest name"), {target:{value:"Cancelled guest"}});
    fireEvent.click(screen.getByRole("button", {name:"Cancel"}));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    expect((screen.getByLabelText("Guest name") as HTMLInputElement).value).toBe("");
  });

  it("retains a failed draft and closes only after a confirmed successful retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError("Invalid guest",422,"validation_error"))
      .mockResolvedValueOnce({id:"guest",name:"Retained guest",phone:"",email:""});
    setup(save);
    fireEvent.change(screen.getByLabelText("Guest name"), {target:{value:"Retained guest"}});
    fireEvent.click(screen.getByRole("button", {name:"Save guest"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Invalid guest"));
    expect((screen.getByLabelText("Guest name") as HTMLInputElement).value).toBe("Retained guest");
    fireEvent.click(screen.getByRole("button", {name:"Save guest"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps an uncertain request available for an identical-key retry", async () => {
    const save=vi.fn().mockRejectedValueOnce(new ApiError("Lost response",0,"network_error",true))
      .mockResolvedValueOnce({id:"guest",name:"Uncertain guest",phone:"",email:""});
    setup(save);
    fireEvent.change(screen.getByLabelText("Guest name"), {target:{value:"Uncertain guest"}});
    fireEvent.click(screen.getByRole("button", {name:"Save guest"}));
    await screen.findByRole("button", {name:"Retry original guest request"});
    fireEvent.keyDown(document,{key:"Escape"});
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Retry original guest request"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  });
});
