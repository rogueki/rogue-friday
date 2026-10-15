"use client";

import type { Role, Session } from "@friday/sdk";
import { isFridayApiError } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { setCsrfToken } from "./api/client";
import { getRestoredIdentity, isApiUnreachable, subscribeUnreachable } from "./offlineCache/controller";
import { coreQueries } from "./api/domains/core";
import { BootScreen, FatalErrorScreen } from "@/components/FullScreen";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface SessionInfo {
  status: SessionStatus;
  session: Session | null;
  role: Role | null;
  displayName: string | null;
  error: unknown;
  /**
   * The API is unreachable and the identity comes from the offline cache of the last session (read-only, no token).
   * `session` stays null in this state; `savedAt` is when the cached data was written.
   */
  offline: boolean;
  offlineSavedAt: number | null;
  refetch: () => void;
}

/** Session state from GET /auth/session. A 401 and `authenticated: false` both mean "log in"; anything else is an outage. */
export function useSession(): SessionInfo {
  const query = useQuery(coreQueries.session());
  const session = query.data?.data ?? null;

  useEffect(() => {
    setCsrfToken(session?.csrfToken ?? null);
  }, [session?.csrfToken]);

  // Only an unreachable API (never a 401) may fall back to the stored identity; the cookie stays the only credential.
  // The flag survives the retries of the session query (a refetch without data resets its status to pending), so the
  // gate does not flip back to the boot screen every few seconds while the API is away.
  const unreachable = useSyncExternalStore(subscribeUnreachable, isApiUnreachable, () => false);
  const cached = !session && unreachable ? getRestoredIdentity() : null;

  let status: SessionStatus;
  if (cached) status = "authenticated";
  else if (query.isPending) status = "loading";
  else if (isFridayApiError(query.error) && (query.error.code === "UNAUTHENTICATED" || query.error.status === 401)) status = "unauthenticated";
  else if (query.isError && !session) status = "error";
  else status = session?.authenticated ? "authenticated" : "unauthenticated";

  return {
    status,
    session,
    role: session?.role ?? (cached ? (cached.identity.role as Role) : null),
    displayName: session?.user?.displayName ?? cached?.identity.displayName ?? null,
    error: query.error,
    offline: cached !== null,
    offlineSavedAt: cached?.savedAt ?? null,
    refetch: () => void query.refetch(),
  };
}

/** Renders children only for an authenticated session; otherwise redirects to /login or shows the outage screen. */
export function SessionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const info = useSession();

  useEffect(() => {
    if (info.status === "unauthenticated") router.replace("/login");
  }, [info.status, router]);

  if (info.status === "loading" || info.status === "unauthenticated") return <BootScreen />;
  if (info.status === "error") return <FatalErrorScreen error={info.error} onRetry={info.refetch} />;
  return <>{children}</>;
}
