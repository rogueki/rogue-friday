"use client";

import { Suspense } from "react";
import { SettingsPage } from "@/features/settings/SettingsPage";

export default function Page() {
  // The selected area lives in the query string (`/settings?area=theme`), which needs a Suspense boundary in a static export.
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  );
}
