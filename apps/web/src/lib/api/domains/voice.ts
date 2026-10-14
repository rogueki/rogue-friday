"use client";

import type {
  ActionResult,
  VoiceDeviceListResponse,
  VoiceEnrollment,
  VoiceEnrollmentResponse,
  VoiceEnrollRequest,
  VoiceMetricsResponse,
  VoiceProfileListResponse,
  VoiceStatusResponse,
  VoiceTestRequest,
  VoiceTestResultResponse,
} from "@jarvis/sdk";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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

/** An enrollment job that has not reached a final state yet. */
export const isEnrollmentRunning = (job: VoiceEnrollment | undefined): boolean =>
  job !== undefined && (job.status === "queued" || job.status === "capturing" || job.status === "calibrating");

const ENROLLMENT_POLL_MS = 1500;

/**
 * Status of one enrollment job (GET /voice/enrollments/{id}, capability `voice.enroll`). Polls while the job runs and stops
 * by itself once it is completed, failed or cancelled; a finished job also refreshes the profile list.
 */
export function useVoiceEnrollment(id: string | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.voice.enrollment(id ?? ""),
    queryFn: async (): Promise<VoiceEnrollmentResponse> => {
      const response = await call(getApiClient().GET("/api/v1/voice/enrollments/{id}", { params: { path: { id: id ?? "" } } }));
      if (!isEnrollmentRunning(response.data)) void queryClient.invalidateQueries({ queryKey: queryKeys.voice.profiles });
      return response;
    },
    enabled: Boolean(id),
    staleTime: 0,
    refetchInterval: (query) => (isEnrollmentRunning(query.state.data?.data) || query.state.data === undefined ? ENROLLMENT_POLL_MS : false),
  });
}

export interface StartEnrollmentVars extends VoiceEnrollRequest, IntentVars {
  profileId: string;
}

/** POST /voice/profiles/{id}/enroll: starts the job (202); audio is captured by the voice service, never uploaded here. */
export function useStartEnrollment() {
  return useApiMutation<VoiceEnrollmentResponse, StartEnrollmentVars>({
    label: "Voice-Enrollment",
    mutationFn: ({ profileId, sampleTarget, recalibrate, idempotencyKey }) =>
      call(
        getApiClient().POST("/api/v1/voice/profiles/{id}/enroll", {
          params: { path: { id: profileId }, header: { "Idempotency-Key": idempotencyKey } },
          body: { ...(sampleTarget === undefined ? {} : { sampleTarget }), ...(recalibrate === undefined ? {} : { recalibrate }) },
        }),
      ),
    invalidate: [queryKeys.voice.profiles],
  });
}

/** DELETE /voice/history?confirm=true (owner, audited, capability `voice.deleteHistory`). */
export function useDeleteVoiceHistory() {
  return useApiMutation<ActionResult, IntentVars>({
    label: "Voice-History löschen",
    mutationFn: ({ idempotencyKey }) =>
      call(getApiClient().DELETE("/api/v1/voice/history", { params: { query: { confirm: true }, header: { "Idempotency-Key": idempotencyKey } } })),
    invalidate: [queryKeys.voice.status],
  });
}

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
