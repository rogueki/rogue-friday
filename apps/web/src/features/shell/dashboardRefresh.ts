import type { QueryClient } from "@tanstack/react-query";

/** Poll active dashboard data only while the event stream is unavailable; honor visibility and browser offline state. */
export function startDashboardRefreshFallback(
  queryClient: Pick<QueryClient, "invalidateQueries">,
  seconds: number,
  realtimeOnline: boolean,
  isVisible: () => boolean = () => document.visibilityState === "visible",
  isOnline: () => boolean = () => navigator.onLine,
): () => void {
  if (realtimeOnline || !Number.isFinite(seconds) || seconds < 1) return () => {};
  const timer = setInterval(() => {
    if (isVisible() && isOnline()) void queryClient.invalidateQueries({ refetchType: "active" });
  }, seconds * 1000);
  return () => clearInterval(timer);
}
