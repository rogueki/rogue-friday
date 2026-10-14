"use client";

import type {
  ActionResult,
  VoiceDeviceListResponse,
  VoiceMetricsResponse,
  VoiceProfileListResponse,
  VoiceStatusResponse,
  VoiceTestRequest,
  VoiceTestResultResponse,
} from "@jarvis/sdk";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "../call";
import { getApiClient } from "../client";
import { useApiMutation, type IntentVars } from "../mutation";
import { queryKeys } from "../queryKeys";
import { staleTimes } from "../staleTimes";

export const voiceQueries = {
  status: () =>
    queryOptions({
      queryKey: queryKeys.voice.status,
      queryFn: (): Promise<VoiceStatusResponse> => call(getApiClient().GET("/api/v1/voice/status")),
      staleTime: staleTimes.voice,
    }),
  metrics: () =>
    queryOptions({
      queryKey: queryKeys.voice.metrics,
      queryFn: (): Promise<VoiceMetricsResponse> => call(getApiClient().GET("/api/v1/voice/metrics")),
      staleTime: staleTimes.voice,
    }),
  profiles: () =>
    queryOptions({
      queryKey: queryKeys.voice.profiles,
      queryFn: (): Promise<VoiceProfileListResponse> => call(getApiClient().GET("/api/v1/voice/profiles")),
      staleTime: staleTimes.voice,
    }),
  devices: () =>
    queryOptions({
      queryKey: queryKeys.voice.devices,
      queryFn: (): Promise<VoiceDeviceListResponse> => call(getApiClient().GET("/api/v1/voice/devices")),
      staleTime: staleTimes.voice,
    }),
};

export const useVoiceStatus = () => useQuery(voiceQueries.status());
export const useVoiceMetrics = () => useQuery(voiceQueries.metrics());
export const useVoiceProfiles = () => useQuery(voiceQueries.profiles());
export const useVoiceDevices = () => useQuery(voiceQueries.devices());

export function useStopVoice() {
  return useApiMutation<ActionResult, IntentVars>({
    label: "Sprachausgabe stoppen",
    mutationFn: ({ idempotencyKey }) => call(getApiClient().POST("/api/v1/voice/stop", { params: { header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: [queryKeys.voice.status, queryKeys.orb],
  });
}

export function useVoiceTest() {
  return useApiMutation<VoiceTestResultResponse, VoiceTestRequest & IntentVars>({
    label: "Sprachtest",
    mutationFn: ({ idempotencyKey: _key, ...body }) => call(getApiClient().POST("/api/v1/voice/test", { body })),
    invalidate: [queryKeys.voice.metrics],
  });
}
