"use client";

import { Skeleton } from "@friday/ui";
import dynamic from "next/dynamic";
import { useT } from "@/i18n";
import type { OrbSlotProps } from "./OrbSlotInner";

export function OrbPlaceholder() {
  const { t } = useT();
  return (
    <div className="web-orb-placeholder">
      <Skeleton variant="circle" width="62%" height="62%" label={t("orb.loading")} />
    </div>
  );
}

// three.js and the scene are the heaviest chunk of the app and WebGL does not exist during the static export, so the
// whole orb integration is loaded lazily and client-only. Swapping the orb implementation touches OrbSlotInner only.
export const OrbSlot = dynamic<OrbSlotProps>(() => import("./OrbSlotInner").then((module) => module.OrbSlotInner), {
  ssr: false,
  loading: () => <OrbPlaceholder />,
});

export type { OrbSlotProps };
