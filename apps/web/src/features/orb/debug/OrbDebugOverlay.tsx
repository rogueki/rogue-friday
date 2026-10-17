"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMeta } from "@/lib/api/domains/core";
import OrbDebugPanel from "./OrbDebugPanel";

/**
 * Floating orb lab on the overview (`/?orbDebug=1`), so the orb can be watched while its controls are used. Development
 * only: it renders nothing unless the server enables the dev scenario features, and the caller loads it behind
 * `process.env.NODE_ENV !== "production"`.
 */
export default function OrbDebugOverlay() {
  const enabled = Boolean(useMeta().data?.features["devScenarios"]);
  const [requested, setRequested] = useState(false);
  useEffect(() => setRequested(new URLSearchParams(window.location.search).get("orbDebug") === "1"), []);
  if (!enabled || !requested) return null;
  // Portal: the AI-core panel clips (overflow/clip-path), the lab must not.
  return createPortal(
    <aside className="orb-debug-overlay" aria-label="Orb-Labor" data-testid="orb-debug-overlay">
      <OrbDebugPanel />
    </aside>,
    document.body,
  );
}
