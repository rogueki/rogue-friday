"use client";

import type { Role, Session } from "@jarvis/sdk";
import { isJarvisApiError } from "@jarvis/sdk";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { setCsrfToken } from "./api/client";
import { coreQueries } from "./api/domains/core";
import { BootScreen, FatalErrorScreen } from "@/components/FullScreen";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface SessionInfo {
  status: SessionStatus;
  session: Session | null;
  role: Role | null;
  displayName: string | null;
  error: unknown;
  refetch: () => void;
}

/** Session state from GET /auth/session. A 401 and `authenticated: false` both mean "log in"; anything else is an outage. */
export function useSession(): SessionInfo {
  const query = useQuery(coreQueries.session());
  const session = query.data?.data ?? null;

  useEffect(() => {
    setCsrfToken(session?.csrfToken ?? null);
  }, [session?.csrfToken]);

  let status: SessionStatus;
  if (query.isPending) status = "loading";
  else if (isJarvisApiError(query.error) && (query.error.code === "UNAUTHENTICATED" || query.error.status === 401)) status = "unauthenticated";
  else if (query.isError && !session) status = "error";
  else status = session?.authenticated ? "authenticated" : "unauthenticated";

  return {
    status,
    session,
    role: session?.role ?? null,
    displayName: session?.user?.displayName ?? null,
    error: query.error,
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
