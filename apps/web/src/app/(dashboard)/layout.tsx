"use client";

import type { ReactNode } from "react";
import { AppShell } from "@/features/shell/AppShell";
import { SessionGate } from "@/lib/session";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionGate>
      <AppShell>{children}</AppShell>
    </SessionGate>
  );
}
