/**
 * Type-only facade of `@jarvis/orb` for the app's TypeScript program (mapped in tsconfig `paths`).
 *
 * Why: `@react-three/fiber` augments the global JSX namespace with every three.js element. Once it is part of the same
 * program, `ElementType` in `@jarvis/ui` (HudPanel's polymorphic `as` prop) collapses to `never`. Bundlers (Next,
 * Vitest) still resolve the real package; only the compiler sees this surface, which mirrors packages/orb/src/index.ts
 * for the symbols the app uses. Keep in sync when the orb API changes.
 */
import type { ComponentType, CSSProperties } from "react";
import type { OrbSettings as WireOrbSettings, OrbSnapshot, OrbStatus, OrbLayers } from "@jarvis/sdk";

export type OrbActivationTarget =
  | { kind: "approval"; approvalId?: string }
  | { kind: "error" }
  | { kind: "task"; taskId: string }
  | { kind: "activity" }
  | { kind: "command" };

export interface OrbSettings {
  preset: "gold" | "amber" | "calm" | "dense";
  size: number;
  intensity: number;
  speed: number;
  particleDensity: number;
  audioReactive: boolean;
  mouseParallax: boolean;
  bloom: boolean;
  quality: "auto" | "low" | "medium" | "high" | "ultra";
  animations: "full" | "reduced" | "off";
  renderer: "auto" | "3d" | "2d";
  statusAccentColors: Record<string, string>;
}

export type JarvisOrbProps = {
  settings?: Partial<OrbSettings>;
  onActivate?: (target: OrbActivationTarget) => void;
  onVoiceToggle?: () => void;
  /** Display name interpolated into the default labels (default "F.R.I.D.A.Y."). */
  assistantName?: string;
  locale?: "de" | "en";
  className?: string;
  style?: CSSProperties;
  showPerf?: boolean;
  onRendererChange?: (renderer: "3d" | "2d") => void;
} & ({ snapshot: OrbSnapshot; status?: undefined; layers?: undefined } | { status: OrbStatus; layers?: OrbLayers; snapshot?: undefined });

export const JarvisOrb: ComponentType<JarvisOrbProps>;
export function orbSettingsFromWire(wire: WireOrbSettings): Partial<OrbSettings>;
export type { OrbSnapshot, OrbStatus, OrbLayers };
