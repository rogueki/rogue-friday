import type { VisualTargets } from "../visual/deriveVisualTargets";
import { createLiveParams, type LiveParams } from "./liveParams";

/** Fresh live params initialised from the given targets (test helper). */
export function liveFor(targets: VisualTargets): LiveParams {
  return createLiveParams(targets);
}
