import { afterEach, describe, expect, it, vi } from "vitest";
import { startDashboardRefreshFallback } from "./dashboardRefresh";

describe("dashboard refresh fallback", () => {
  afterEach(() => vi.useRealTimers());

  it("invalidates active data at the configured interval only when visible and online", () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn();
    let visible = true;
    let online = true;
    const stop = startDashboardRefreshFallback({ invalidateQueries }, 10, false, () => visible, () => online);
    vi.advanceTimersByTime(10_000);
    expect(invalidateQueries).toHaveBeenCalledExactlyOnceWith({ refetchType: "active" });
    visible = false;
    vi.advanceTimersByTime(10_000);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    visible = true;
    online = false;
    vi.advanceTimersByTime(10_000);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    stop();
    online = true;
    vi.advanceTimersByTime(20_000);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("does not poll while realtime is online", () => {
    vi.useFakeTimers();
    const invalidateQueries = vi.fn();
    startDashboardRefreshFallback({ invalidateQueries }, 5, true);
    vi.advanceTimersByTime(10_000);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
