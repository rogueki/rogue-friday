/**
 * The only module of the web app that imports the orb controller surface from `@friday/orb`
 * (docs/ORB_REWORK_ANALYSIS.md §8 (h)); every other file imports from here. That keeps the controller wiring in one
 * place and lets the main bundle depend on types only: value imports from this module are confined to the lazily
 * loaded orb chunk (`orbRuntime.ts`).
 */
export { createAudioAnalyzer, createOrbController, createOrbDemo, createOrbEventBridge, createOrbFrameInputs, createServiceLevelSource, createSpeechEnvelopeSource } from "@friday/orb";
export type {
  ApprovalState,
  BackgroundWork,
  CreateOrbControllerOptions,
  OrbAudioFrame,
  OrbAudioFrameSource,
  OrbAudioLevels,
  OrbAudioSourceKind,
  OrbController,
  OrbControllerState,
  OrbDemo,
  OrbDemoName,
  OrbErrorInfo,
  OrbEventBridge,
  OrbFrameInputs,
  OrbLayerState,
  OrbProgressMode,
  OrbRuntimeStatus,
  OrbSeverity,
  OrbTaskInfo,
  PrimaryInteraction,
  ServiceLevelSource,
  SpeechEnvelopeSource,
  SystemHealthState,
} from "@friday/orb";
