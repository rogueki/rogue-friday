"use client";

import type { WakeEnrollmentSample, WakeEnrollmentStatus } from "@friday/sdk";
import { call } from "../call";
import { getApiClient } from "../client";

export type { WakeEnrollmentStatus };

/** Enrollment of the activation phrase: status, job control and the probes captured on the device. */
export const wakeEnrollmentApi = {
  status: (): Promise<WakeEnrollmentStatus> => call(getApiClient().GET("/api/v1/voice/wake-enrollment")),
  start: (phrase: string): Promise<WakeEnrollmentStatus> =>
    call(getApiClient().POST("/api/v1/voice/wake-enrollment/start", { body: { phrase } })),
  addSample: (body: WakeEnrollmentSample): Promise<WakeEnrollmentStatus> =>
    call(getApiClient().POST("/api/v1/voice/wake-enrollment/samples", { body })),
  train: (jobId: string): Promise<WakeEnrollmentStatus> =>
    call(getApiClient().POST("/api/v1/voice/wake-enrollment/train", { body: { jobId } })),
  discard: (jobId: string): Promise<WakeEnrollmentStatus> =>
    call(getApiClient().POST("/api/v1/voice/wake-enrollment/discard", { body: { jobId } })),
};
