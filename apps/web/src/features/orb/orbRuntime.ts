import { clearOrbStatus, orbAudioHandle, orbBridgeHandle, publishOrbStatus } from "./orbHub";
import type { OrbAudioSources } from "./bridge/audioSources";
import { createOrbAudioSources } from "./bridge/audioSources";
import {
  createAudioAnalyzer,
  createOrbController,
  createOrbDemo,
  createOrbEventBridge,
  createServiceLevelSource,
  createSpeechEnvelopeSource,
  type OrbAudioFrameSource,
  type OrbController,
  type OrbEventBridge,
} from "./orbApi";

/**
 * The one orb controller of the app: created lazily on the client (together with the orb chunk), shared by the
 * realtime router, the browser audio path, the debug panel and the rendered orb. Nothing here is React state.
 */
export interface OrbRuntime {
  readonly controller: OrbController;
  readonly bridge: OrbEventBridge;
  readonly sources: OrbAudioSources;
  readonly demo: ReturnType<typeof createOrbDemo>;
  createAnalyzer(context: BaseAudioContext, source: AudioNode, kind: "input" | "output"): OrbAudioFrameSource;
}

let runtime: OrbRuntime | null = null;
let unsubscribeStatus: (() => void) | null = null;

export function getOrbRuntime(): OrbRuntime {
  if (runtime) return runtime;
  const controller = createOrbController();
  const bridge = createOrbEventBridge(controller);
  const sources = createOrbAudioSources(controller, { createServiceLevelSource, createSpeechEnvelopeSource });
  runtime = {
    controller,
    bridge,
    sources,
    demo: createOrbDemo(controller),
    createAnalyzer: (context, source, kind) => createAudioAnalyzer(context, source, { kind }),
  };
  const publish = (): void => {
    const { status } = controller.getState();
    publishOrbStatus({
      mode: status.mode,
      ...(status.activityText ? { activityText: status.activityText } : {}),
      progress: status.progressMode === "determinate" && typeof status.progress === "number" ? status.progress : null,
      progressMode: status.progressMode,
      activeAgentCount: status.activeAgentCount ?? 0,
      ...(status.currentAgentName ? { currentAgentName: status.currentAgentName } : {}),
    });
  };
  unsubscribeStatus = controller.subscribe(publish);
  publish();
  orbBridgeHandle.attach(bridge);
  orbAudioHandle.attach(sources);
  return runtime;
}

/** Test seam: drops the singleton so each test starts from a fresh controller. */
export function resetOrbRuntimeForTests(): void {
  unsubscribeStatus?.();
  unsubscribeStatus = null;
  clearOrbStatus();
  runtime?.sources.dispose();
  runtime?.controller.dispose();
  orbBridgeHandle.detach();
  orbAudioHandle.detach();
  runtime = null;
}
