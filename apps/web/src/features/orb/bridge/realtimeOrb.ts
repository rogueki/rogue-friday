import type { Overview, VoiceStatus } from "@friday/sdk";
import type { QueryClient } from "@tanstack/react-query";
import { browserAudio, setBrowserAudioPassiveProbe } from "@/features/voice/browserAudio";
import { queryKeys } from "@/lib/api/queryKeys";
import { orbAudioHandle, orbBridgeHandle } from "../orbHub";
import { createOrbRealtimeRouter, isMicrophonePassive, type OrbRealtimeRouter } from "./routeRealtimeToOrb";

interface Envelope<T> {
  data: T;
}

/**
 * Router instance of the app's realtime layer: cache-backed truths come from the query cache (updated before an event
 * is routed), everything else flows through the deferred bridge handles that attach once the orb chunk has loaded.
 */
export function createRealtimeOrbRouter(queryClient: QueryClient): OrbRealtimeRouter {
  const overview = (): Overview | undefined => queryClient.getQueryData<Envelope<Overview>>(queryKeys.overview)?.data;
  const voice = (): VoiceStatus | undefined => queryClient.getQueryData<Envelope<VoiceStatus>>(queryKeys.voice.status)?.data ?? overview()?.voice ?? undefined;
  setBrowserAudioPassiveProbe(() => isMicrophonePassive(voice()));
  const router = createOrbRealtimeRouter({
    bridge: orbBridgeHandle.proxy,
    audio: orbAudioHandle.proxy,
    browserVoiceActive: () => browserAudio.snapshot().active,
    pendingApprovalIds: () => (overview()?.openApprovals ?? []).filter((approval) => approval.status === "pending").map((approval) => approval.id),
  });
  return {
    ...router,
    dispose: () => {
      setBrowserAudioPassiveProbe(() => false);
      router.dispose();
    },
  };
}
