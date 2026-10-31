"use client";

import type { LinuxEnrollmentSample, LinuxEnrollmentStatus } from "@friday/sdk";
import { call } from "../call";
import { getApiClient } from "../client";

export type LinuxEnrollmentKind = "wake" | "short" | "negatives" | "speech";
export type { LinuxEnrollmentStatus };

/** Enrollment of the Linux wake phrase: status, captured probes and model training. */
export const linuxEnrollmentApi = {
  status: (): Promise<LinuxEnrollmentStatus> => call(getApiClient().GET("/api/v1/voice/linux-enrollment")),
  addSample: (body: LinuxEnrollmentSample): Promise<LinuxEnrollmentStatus> =>
    call(getApiClient().POST("/api/v1/voice/linux-enrollment/samples", { body })),
  train: (): Promise<LinuxEnrollmentStatus> => call(getApiClient().POST("/api/v1/voice/linux-enrollment/train")),
};
