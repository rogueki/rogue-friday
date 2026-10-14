"use client";

import { Suspense } from "react";
import { ApprovalsPage } from "@/features/approvals/ApprovalsPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ApprovalsPage />
    </Suspense>
  );
}
