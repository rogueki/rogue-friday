import { expect } from "vitest";
import type { ApiClient } from "../helpers";

/**
 * Stages a knowledge write (memory create/update/delete/conflict resolve, file rename/delete) and returns the
 * preview id. The repeat must carry the identical request plus `X-Action-Preview-Id` (`confirmedHeaders`).
 */
export async function stageKnowledgeWrite(client: ApiClient, method: "POST" | "PATCH" | "DELETE", path: string,
  body?: unknown, headers: Record<string, string> = {}): Promise<string> {
  const staged = await client.request(method, path, body !== undefined ? { body, headers } : { headers });
  expect(staged.statusCode, staged.body).toBe(403);
  expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
  expect(staged.json().error.details.stage).toBe("preview");
  return staged.json().error.details.previewId as string;
}

/** Headers for the confirmed repeat of a staged write: the unchanged request plus its preview id. */
export function confirmedHeaders(previewId: string, headers: Record<string, string> = {}): Record<string, string> {
  return { ...headers, "x-action-preview-id": previewId };
}
