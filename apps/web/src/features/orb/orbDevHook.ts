import type { OrbAudioFrame } from "./orbApi";
import type { OrbRuntime } from "./orbRuntime";

/**
 * Dev/QA handle on the orb runtime for E2E and the debug panel: `window.__FRIDAY_ORB__.controller.setMode("working")`.
 * Only installed while the server enables the dev scenario features (never in a production configuration), like
 * `__FRIDAY_ORB_TEST__`.
 */
export interface OrbDevHook extends Pick<OrbRuntime, "controller" | "bridge" | "sources" | "demo"> {
  /** Reads the audio frames the scene would see right now (copies, safe to serialise). */
  readAudio(): { input: OrbAudioFrame; output: OrbAudioFrame; speechEnvelopeActive: boolean };
}

declare global {
  interface Window {
    __FRIDAY_ORB__?: OrbDevHook;
  }
}

export function installOrbDevHook(runtime: OrbRuntime, createInputs: () => ReturnType<OrbDevHook["readAudio"]>): () => void {
  const inputs = createInputs();
  window.__FRIDAY_ORB__ = {
    controller: runtime.controller,
    bridge: runtime.bridge,
    sources: runtime.sources,
    demo: runtime.demo,
    readAudio: () => {
      runtime.controller.readFrame(performance.now(), inputs);
      return { input: { ...inputs.input }, output: { ...inputs.output }, speechEnvelopeActive: inputs.speechEnvelopeActive };
    },
  };
  return () => {
    delete window.__FRIDAY_ORB__;
  };
}
