"use client";

import { call } from "../call";
import { getApiClient } from "../client";

/** Liveness probe for the bottom-bar network chip. */
export const healthApi = {
  fetchHealth: (signal?: AbortSignal) => call(getApiClient().GET("/api/v1/health", { signal })),
};