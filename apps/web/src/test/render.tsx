import { createJarvisClient, type AdapterInfo, type Capabilities, type OverviewResponse } from "@jarvis/sdk";
import { ToastProvider } from "@jarvis/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { setApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { CapabilitiesContext } from "@/lib/capabilities";

export const NEVER_RESOLVES: typeof fetch = () => new Promise<Response>(() => undefined);

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function capabilitiesOf(modules: Record<string, Record<string, boolean>>): Capabilities {
  return { contractVersion: "1.0.0", modules } as unknown as Capabilities;
}

export function adapterInfoOf(partial: { id: string; category: AdapterInfo["manifest"]["category"]; name?: string; health?: Partial<AdapterInfo["health"]> } & Partial<Omit<AdapterInfo, "manifest" | "health">>): AdapterInfo {
  const { id, category, name, health, ...rest } = partial;
  return {
    manifest: { id, name: name ?? id, adapterVersion: "1.0.0", contractVersion: "1.0.0", apiVersion: "v1", category, capabilities: [], configSchemaRef: "urn:test", secretFields: [] },
    health: {
      adapterId: id,
      status: "online",
      lifecycle: "ONLINE",
      latencyMs: 12,
      lastSuccessAt: "2026-10-14T08:14:00Z",
      lastError: null,
      checkedAt: "2026-10-14T08:15:00Z",
      consecutiveFailures: 0,
      circuit: "closed",
      ...health,
    },
    enabled: true,
    provider: "test",
    mode: "live",
    ...rest,
  };
}

interface RenderOptions {
  overview?: OverviewResponse;
  /** Adapter list seeded into the cache; without it `/adapters` goes through `fetchImpl` like any other request. */
  adapters?: readonly AdapterInfo[];
  capabilities?: Capabilities;
  fetchImpl?: typeof fetch;
}

/** Renders with a fresh QueryClient (cache seeded from `overview`), a fake-fetch SDK client and a capability document. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (options.overview) queryClient.setQueryData(queryKeys.overview, options.overview);
  if (options.adapters) {
    queryClient.setQueryData(queryKeys.adapters.list({}), {
      contractVersion: "1.0.0",
      items: options.adapters,
      pageInfo: { nextCursor: null, hasNextPage: false },
      freshness: { state: "fresh", asOf: "2026-10-14T08:15:00Z" },
      sources: [],
    });
  }
  setApiClient(createJarvisClient({ baseUrl: "http://jarvis.test", fetch: options.fetchImpl ?? NEVER_RESOLVES }));
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <CapabilitiesContext.Provider value={{ capabilities: options.capabilities, isLoading: !options.capabilities, isError: false }}>
          {ui}
        </CapabilitiesContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
