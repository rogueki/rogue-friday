"use client";

import type { SttModelsStatus } from "@friday/sdk";
import { call } from "../call";
import { getApiClient } from "../client";

export type { SttModelsStatus };

/** Local Whisper models: inventory, download and cancellation of the running job. */
export const sttModelsApi = {
  status: (): Promise<SttModelsStatus> => call(getApiClient().GET("/api/v1/voice/stt-models")),
  download: (model: string): Promise<SttModelsStatus> =>
    call(getApiClient().POST("/api/v1/voice/stt-models/download", { body: { model } })),
  cancel: (jobId: string): Promise<SttModelsStatus> =>
    call(getApiClient().POST("/api/v1/voice/stt-models/cancel", { body: { jobId } })),
};
