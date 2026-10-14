"use client";

import { Suspense } from "react";
import { AgentsPage } from "@/features/agents/AgentsPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AgentsPage />
    </Suspense>
  );
}
