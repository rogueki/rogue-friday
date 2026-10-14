import { createJarvisClient, type Capabilities, type OverviewResponse } from "@jarvis/sdk";
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

interface RenderOptions {
  overview?: OverviewResponse;
  capabilities?: Capabilities;
  fetchImpl?: typeof fetch;
}

/** Renders with a fresh QueryClient (cache seeded from `overview`), a fake-fetch SDK client and a capability document. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  if (options.overview) queryClient.setQueryData(queryKeys.overview, options.overview);
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
