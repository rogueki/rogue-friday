export type { OrbHealth, OrbLayers, OrbMode, OrbSnapshot, OrbStatus } from "./contract-types";
export {
  DEFAULT_ORB_SETTINGS,
  QUALITY_ORDER,
  QUALITY_PROFILES,
  getQualityProfile,
  resolveQuality,
  orbSettingsFromWire,
  resolveSettings,
} from "./settings";
export type {
  AudioFixtureName,
  OrbAnimations,
  OrbPreset,
  OrbQualityLevel,
  OrbQualitySetting,
  OrbRenderer,
  OrbSettings,
  OrbTestClock,
  QualityProfile,
} from "./settings";

export {
  SUCCESS_FLASH_MS,
  arbitrateOrbState,
  createOrbActor,
  layersFromStatus,
  normalizeProgress,
  orbMachine,
  selectOrbLayers,
  selectOrbMode,
  selectOrbSnapshot,
  toInternalLayers,
  toOrbLayers,
  selectOrbStatus,
} from "./machine/orbMachine";
export type { OrbInternalLayers, OrbMachineContext, OrbMachineEvent, OrbMachineSnapshot } from "./machine/orbMachine";

export {
  ACCENT_DEFAULTS,
  RING_AXES,
  RING_NAMES,
  deriveFromStatus,
  deriveVisualTargets,
  transitionDurationMs,
  transitionTimeConstants,
} from "./visual/deriveVisualTargets";
export type { DeriveInput, TransitionTimes, VisualTargets } from "./visual/deriveVisualTargets";

export { JarvisOrb, detectWebGL } from "./JarvisOrb";
export type { JarvisOrbProps } from "./JarvisOrb";
export { OrbFallback2D } from "./fallback/OrbFallback2D";
export type { OrbFallback2DProps } from "./fallback/OrbFallback2D";
export { OrbPerfOverlay, readPerfSnapshot } from "./debug/OrbPerfOverlay";
export type { OrbPerfSnapshot } from "./debug/OrbPerfOverlay";
export { OrbOverlay } from "./OrbOverlay";

export { DEFAULT_ASSISTANT_NAME, ORB_LABELS_DE, ORB_LABELS_EN, activationTarget, buildAriaSentence, createOrbLabels, formatRuntime, resolveLabels } from "./labels";
export type { OrbActivationTarget, OrbLabelLocale, OrbLabelOptions, OrbLabels } from "./labels";

export {
  AUDIO_FIXTURE_NAMES,
  AudioSmoother,
  HALO_SMOOTHING,
  audioFixtureLevel,
  sampleAudioFixture,
  smoothAudioLevel,
} from "./audio/fixtures";

export { AdaptiveQuality } from "./scene/adaptiveQuality";
export type { OrbDebugProbe } from "./scene/OrbScene";

export { resolveAudioLevel, toAudioLevelReader } from "./audio/audioSource";
export type { OrbAudioLevelReader, OrbAudioSourceRef } from "./audio/audioSource";
