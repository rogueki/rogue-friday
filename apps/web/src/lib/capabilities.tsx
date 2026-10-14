"use client";

import type { Capabilities } from "@jarvis/sdk";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { coreQueries } from "./api/domains/core";

export type CapabilityModule = keyof Capabilities["modules"];
export type CapabilityState = "available" | "read-only" | "missing";

type ModuleFlags = Record<string, unknown>;

export function capabilityState(capabilities: Capabilities | undefined, module: string, action: string): CapabilityState {
  const flags = (capabilities?.modules as Record<string, ModuleFlags> | undefined)?.[module];
  if (!flags) return "missing";
  if (flags[action] === true) return "available";
  const canRead = flags.read === true || flags.execute === true;
  return canRead && action !== "read" ? "read-only" : "missing";
}

/** `"tasks.create"` style path as used by QuickCommand.requiredCapability. */
export function capabilityPathState(capabilities: Capabilities | undefined, path: string): CapabilityState {
  const [module = "", action = "read"] = path.split(".");
  return capabilityState(capabilities, module, action);
}

interface CapabilitiesValue {
  capabilities: Capabilities | undefined;
  isLoading: boolean;
  isError: boolean;
}

export const CapabilitiesContext = createContext<CapabilitiesValue>({ capabilities: undefined, isLoading: true, isError: false });

/** Loads /capabilities once; every action in the UI is enabled or disabled from this document (PLAN §9.3). */
export function CapabilitiesProvider({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const query = useQuery({ ...coreQueries.capabilities(), enabled });
  const value = useMemo<CapabilitiesValue>(
    () => ({ capabilities: query.data, isLoading: query.isPending && enabled, isError: query.isError }),
    [query.data, query.isPending, query.isError, enabled],
  );
  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilities(): CapabilitiesValue {
  return useContext(CapabilitiesContext);
}

export function useCapabilityState(module: CapabilityModule, action: string): CapabilityState {
  const { capabilities } = useCapabilities();
  return capabilityState(capabilities, module, action);
}

/** `true` only when the capability is explicitly granted. While capabilities load, nothing is enabled. */
export function useCapability(module: CapabilityModule, action: string): boolean {
  return useCapabilityState(module, action) === "available";
}
