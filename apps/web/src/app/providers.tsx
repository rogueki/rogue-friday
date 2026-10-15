"use client";

import { ToastProvider, useToast } from "@jarvis/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BootScreen, FatalErrorScreen } from "@/components/FullScreen";
import { createQueryClient, type ErrorSink } from "@/lib/api/queryClient";
import { queryKeys } from "@/lib/api/queryKeys";
import { clearOfflineCache, restoreOfflineCache, startOfflineCache } from "@/lib/offlineCache/controller";
import { CapabilitiesProvider } from "@/lib/capabilities";
import { RealtimeProvider } from "@/lib/realtime/RealtimeProvider";
import { useSession } from "@/lib/session";
import { AppSettingsProvider } from "@/lib/settings";

/** Connects the (non-React) QueryClient error handling to the toast provider. */
function ErrorSinkBridge({ sinkRef, queryClient }: { sinkRef: { current: ErrorSink | null }; queryClient: QueryClient }) {
  const { toast } = useToast();
  useEffect(() => {
    sinkRef.current = {
      notify: ({ title, description, tone }) => toast({ title, description, tone, duration: tone === "red" ? 9000 : 7000 }),
      onUnauthenticated: () => {
        // A rejected session means the stored data no longer belongs to anybody who may read it.
        clearOfflineCache();
        void queryClient.invalidateQueries({ queryKey: queryKeys.session });
      },
    };
    return () => {
      sinkRef.current = null;
    };
  }, [sinkRef, queryClient, toast]);
  return null;
}

/** Session-dependent providers: settings/theme, capabilities and the realtime stream only run for an authenticated user. */
function AuthenticatedProviders({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const authenticated = status === "authenticated";
  return (
    <AppSettingsProvider enabled={authenticated}>
      <CapabilitiesProvider enabled={authenticated}>
        <RealtimeProvider enabled={authenticated}>{children}</RealtimeProvider>
      </CapabilitiesProvider>
    </AppSettingsProvider>
  );
}

// The env check sits directly in front of the import so the bundler removes the whole mock stack from normal builds.
const MockStarter = process.env.NEXT_PUBLIC_JARVIS_MSW === "1" ? dynamic(() => import("@/lib/mock/MockStarter"), { ssr: false }) : null;

/** Starts MSW (standalone mock mode) before the first request leaves the app. */
function MockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"ready" | "starting" | "failed">(MockStarter ? "starting" : "ready");
  const [error, setError] = useState<unknown>(null);
  const onReady = useCallback(() => setState("ready"), []);
  const onError = useCallback((reason: unknown) => {
    console.error("Mock-Plattform konnte nicht gestartet werden", reason);
    setError(reason);
    setState("failed");
  }, []);
  if (state === "starting" && MockStarter) {
    return (
      <>
        <MockStarter onReady={onReady} onError={onError} />
        <BootScreen />
      </>
    );
  }
  if (state === "failed") return <FatalErrorScreen error={error} onRetry={() => window.location.reload()} />;
  return <>{children}</>;
}

/**
 * The app is a client-side application (static export, no server data). The UI library renders portals (toasts, overlays)
 * that exist only in the browser, so the tree is mounted after hydration and the server HTML is only the boot screen.
 */
function ClientOnly({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <BootScreen />;
}

export function Providers({ children }: { children: ReactNode }) {
  const sinkRef = useRef<ErrorSink | null>(null);
  const [queryClient] = useState(() => {
    const client = createQueryClient(() => sinkRef.current);
    // Browser only (the server render has no storage): last known read data, marked as offline-cache until refreshed.
    if (typeof window !== "undefined") restoreOfflineCache(client);
    return client;
  });
  useEffect(() => {
    const controller = startOfflineCache(queryClient, { onRecovered: () => void queryClient.invalidateQueries() });
    return controller.dispose;
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <ClientOnly>
        <ToastProvider>
          <ErrorSinkBridge sinkRef={sinkRef} queryClient={queryClient} />
          <MockGate>
            <AuthenticatedProviders>{children}</AuthenticatedProviders>
          </MockGate>
        </ToastProvider>
      </ClientOnly>
    </QueryClientProvider>
  );
}
