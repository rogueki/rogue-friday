"use client";

import { call } from "../call";
import { getApiClient } from "../client";

/** Binary Content Studio endpoints: ElevenLabs speech and finished production artifacts, both delivered as blobs. */
export const contentStudioMediaApi = {
  createSpeech: (body: { text: string; voiceId: string; confirmed: true }, idempotencyKey: string): Promise<Blob> =>
    call(getApiClient().POST("/api/v1/content-studio/elevenlabs/speech", {
      body,
      params: { header: { "Idempotency-Key": idempotencyKey } },
      parseAs: "blob",
    })),
  downloadProductionArtifact: (id: string): Promise<Blob> =>
    call(getApiClient().GET("/api/v1/content-studio/production-jobs/{id}/artifact", {
      params: { path: { id } },
      parseAs: "blob",
    })),
};
