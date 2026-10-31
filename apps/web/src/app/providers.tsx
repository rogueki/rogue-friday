"use client";

import { ToastProvider, useToast } from "@friday/ui";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BootScreen } from "@/components/FullScreen";
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
          <AuthenticatedProviders>{children}</AuthenticatedProviders>
        </ToastProvider>
      </ClientOnly>
    </QueryClientProvider>
  );
}
