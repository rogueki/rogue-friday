import { createContext, useContext, type MutableRefObject } from "react";
import type { OrbSettings, QualityProfile } from "../settings";
import type { VisualTargets } from "../visual/deriveVisualTargets";
import type { LiveParams } from "./liveParams";
import type { SharedUniforms } from "./materials";

export interface OrbSceneContextValue {
  live: MutableRefObject<LiveParams>;
  targets: MutableRefObject<VisualTargets>;
  shared: SharedUniforms;
  profile: QualityProfile;
  settings: OrbSettings;
  /** True when the scene runs on the deterministic test clock. */
  fixedClock: boolean;
}

export const OrbSceneContext = createContext<OrbSceneContextValue | null>(null);

export function useOrb(): OrbSceneContextValue {
  const ctx = useContext(OrbSceneContext);
  if (!ctx) throw new Error("useOrb must be used inside <OrbScene>");
  return ctx;
}
