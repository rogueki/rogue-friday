"use client";

import type { ActionResult, LoginRequest, SessionResponse } from "@jarvis/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { clearOfflineCache } from "../../offlineCache/controller";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";

export function useLogin() {
  const queryClient = useQueryClient();
  return useApiMutation<SessionResponse, LoginRequest & IntentVars>({
    label: "Anmeldung",
    silent: true,
    mutationFn: ({ username, password }) => call(getApiClient().POST("/api/v1/auth/login", { body: { username, password } })),
    // A new identity invalidates everything that was cached for the previous one.
    invalidate: (data) => {
      queryClient.setQueryData(queryKeys.session, data);
      return [queryKeys.capabilities, queryKeys.settings.root, queryKeys.overview];
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useApiMutation<ActionResult, IntentVars>({
    label: "Abmeldung",
    mutationFn: () => call(getApiClient().POST("/api/v1/auth/logout")),
    invalidate: () => {
      queryClient.clear();
      // Logout also removes the stored offline cache: nothing of this session may stay readable in the browser.
      clearOfflineCache();
      return [];
    },
  });
}
