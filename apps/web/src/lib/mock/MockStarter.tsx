"use client";

import { useEffect } from "react";
import { startMocks } from "./bootstrap";

/**
 * Starts the in-browser mock platform and reports back. Loaded with `next/dynamic({ ssr: false })` only: `msw/browser`
 * is excluded for the node condition by msw itself, so this module must never enter the server-side compile.
 */
export default function MockStarter({ onReady, onError }: { onReady: () => void; onError: (error: unknown) => void }) {
  useEffect(() => {
    let cancelled = false;
    startMocks().then(
      () => !cancelled && onReady(),
      (error: unknown) => !cancelled && onError(error),
    );
    return () => {
      cancelled = true;
    };
  }, [onReady, onError]);
  return null;
}
