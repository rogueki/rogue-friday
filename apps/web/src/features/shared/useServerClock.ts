"use client";

import { useMemo } from "react";
import { useMeta } from "@/lib/api/domains/core";

/**
 * Offset between the server clock (`meta.serverTime`) and the browser clock in ms. Relative times, expiry countdowns,
 * "überfällig" and outage start times are computed on the server's time so a wrong browser clock (or the mock clock)
 * never makes an approval look expired or an outage look like it lies in the future.
 */
export function useServerClockOffset(): number {
  const meta = useMeta();
  return useMemo(() => {
    const server = meta.data?.serverTime ? Date.parse(meta.data.serverTime) : Number.NaN;
    return Number.isNaN(server) ? 0 : server - meta.dataUpdatedAt;
  }, [meta.data?.serverTime, meta.dataUpdatedAt]);
}
