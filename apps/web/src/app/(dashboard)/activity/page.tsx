"use client";

import { Suspense } from "react";
import { ActivityPage } from "@/features/activity/ActivityPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ActivityPage />
    </Suspense>
  );
}
