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
  // A stored overview is the truth the router compares against: approvals the orb still shows but the overview no longer
  // lists (missed or wiped events, e.g. after a reconnect) are released instead of pinning waiting_approval forever.
  const overviewKey = JSON.stringify(queryKeys.overview);
  const unsubscribeOverview = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "success" && JSON.stringify(event.query.queryKey) === overviewKey) router.reconcileApprovals();
  });
  return {
    ...router,
    dispose: () => {
      unsubscribeOverview();
      setBrowserAudioPassiveProbe(() => false);
      router.dispose();
    },
  };
}
