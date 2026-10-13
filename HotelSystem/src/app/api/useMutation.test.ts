import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import { useMutation } from "./useMutation";

describe("explicit mutation outcome handling", () => {
  it("recovers the original request key/body across a remount", async () => {
    const scope = "test-pending-remount";
    sessionStorage.removeItem(scope);
    const save = vi.fn().mockRejectedValueOnce(new ApiError("Lost reply", 0, "network_error", true)).mockResolvedValueOnce({ id: "saved" });
    const first = renderHook(() => useMutation(save, scope));
    await act(async () => { await first.result.current.submit({ note: "Original" }); });
    first.unmount();
    const second = renderHook(() => useMutation(save, scope));
    expect(second.result.current.uncertain).toBe(true);
    await act(async () => { await second.result.current.retryOriginal(); });
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(sessionStorage.getItem(scope)).toBeNull();
  });
  it("retains the original body/key when a response is uncertain and replays it", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError("Unconfirmed", 0, "network_error", true))
      .mockResolvedValueOnce({ id: "canonical" });
    const { result } = renderHook(() => useMutation(save));
    await act(async () => { await result.current.submit({ note: "Kept draft" }); });
    expect(result.current.uncertain).toBe(true);
    await act(async () => { await result.current.retryOriginal(); });
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(result.current.uncertain).toBe(false);
  });
  it("does not resubmit a changed body while the original outcome is unconfirmed", async () => {
    const save = vi.fn().mockRejectedValue(new ApiError("Unconfirmed", 0, "network_error", true));
    const { result } = renderHook(() => useMutation(save));
    await act(async () => { await result.current.submit({ note: "Original" }); });
    await act(async () => { await result.current.submit({ note: "Changed" }); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain("Resolve the original");
  });
  it("distinguishes known stale rejection and permits an explicit reviewed retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError("Stale", 409, "version_conflict"))
      .mockResolvedValueOnce({ version: 3 });
    const { result } = renderHook(() => useMutation(save));
    await act(async () => { await result.current.submit({ expected_version: 1, note: "Draft" }); });
    expect(result.current.conflict).toBe(true);
    expect(result.current.uncertain).toBe(false);
    await act(async () => { result.current.reviewedLatest(); });
    await act(async () => { await result.current.submit({ expected_version: 2, note: "Draft" }); });
    expect(save.mock.calls[0][1]).not.toBe(save.mock.calls[1][1]);
  });
});
