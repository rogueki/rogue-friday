"use client";

import type { OrbActivationTarget } from "@friday/orb";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useVoiceUi } from "@/features/voice/useVoiceUi";
import { useUiStore } from "@/lib/uiStore";

/** Where an orb click/Enter goes (PLAN §21), as a pure function so the routing is testable without React. */
export type OrbRoute =
  | { kind: "navigate"; href: string }
  | { kind: "drawer"; drawer: "activity" | "error" }
  | { kind: "palette" };

export function routeOrbActivation(target: OrbActivationTarget): OrbRoute {
  switch (target.kind) {
    case "approval":
      return { kind: "navigate", href: target.approvalId ? `/approvals?approval=${encodeURIComponent(target.approvalId)}` : "/approvals" };
    case "task":
      return { kind: "navigate", href: `/tasks?task=${encodeURIComponent(target.taskId)}` };
    case "error":
      return { kind: "drawer", drawer: "error" };
    case "command":
      return { kind: "palette" };
    case "activity":
      return { kind: "drawer", drawer: "activity" };
  }
}

export function useOrbActions(): { onActivate: (target: OrbActivationTarget) => void; onVoiceToggle: () => void } {
  const router = useRouter();
  const voice = useVoiceUi();
  const { setActivityDrawerOpen, setErrorDetailOpen, setPaletteOpen } = useUiStore.getState();
  const toggleVoice = voice.toggle;

  const onActivate = useCallback(
    (target: OrbActivationTarget) => {
      const route = routeOrbActivation(target);
      if (route.kind === "navigate") router.push(route.href);
      else if (route.kind === "palette") setPaletteOpen(true);
      else if (route.drawer === "error") setErrorDetailOpen(true);
      else setActivityDrawerOpen(true);
    },
    [router, setActivityDrawerOpen, setErrorDetailOpen, setPaletteOpen],
  );
  return { onActivate, onVoiceToggle: toggleVoice };
}
