import { createContext, useContext, type MutableRefObject } from "react";
import type { OrbAudioSourceRef } from "../audio/audioSource";
import type { OrbFrameInputs } from "../controller/types";
import type { OrbSettings, QualityProfile } from "../settings";
import type { VisualTargets } from "../visual/deriveVisualTargets";
import type { LiveParams } from "./liveParams";
import type { SharedUniforms } from "./materials";

/** Where the camera rig put the orb, in canvas pixels (written by `OrbCameraRig`, read by the debug probe). */
export interface OrbFit {
  /** Radius of the nominal visible orb (outer rings included) in CSS pixels. */
  radiusPx: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface OrbSceneContextValue {
  live: MutableRefObject<LiveParams>;
  targets: MutableRefObject<VisualTargets>;
  shared: SharedUniforms;
  profile: QualityProfile;
  settings: OrbSettings;
  /** True when the scene runs on the deterministic test clock. */
  fixedClock: boolean;
  /** Live audio level reader polled every frame (falls back to `targets.audioLevel` when absent). */
  audioSource?: OrbAudioSourceRef;
  /** Controller frame reader (analysed audio frames); absent for the legacy snapshot/reader path. */
  readFrames?: (nowMs: number, inputs: OrbFrameInputs) => void;
  /** Preallocated per-frame audio inputs. */
  inputs: OrbFrameInputs;
  /** Fraction of the usable panel height covered by the nominal visible orb (default 0.72). */
  fillRatio: number;
  fit: OrbFit;
}

export const OrbSceneContext = createContext<OrbSceneContextValue | null>(null);

export function useOrb(): OrbSceneContextValue {
  const ctx = useContext(OrbSceneContext);
  if (!ctx) throw new Error("useOrb must be used inside <OrbScene>");
  return ctx;
}
