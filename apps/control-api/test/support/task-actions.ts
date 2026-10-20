import { expect } from "vitest";
import type { TaskCreateRequest } from "@friday/sdk";
import type { ApiClient } from "../helpers";

/** Exercise the public API decision chain when a test needs a real created task fixture. */
export async function createApprovedTask(client: ApiClient, body: TaskCreateRequest, idempotencyKey?: string,
  extraHeaders: Record<string, string> = {}) {
  const headers = { ...extraHeaders, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) };
  const staged = await client.post("/api/v1/tasks", body, { headers });
  expect(staged.statusCode, staged.body).toBe(403);
  expect(staged.json().error.code).toBe("APPROVAL_REQUIRED");
  expect(staged.json().error.details.stage).toBe("preview");
  const previewId = staged.json().error.details.previewId as string;
  const confirmed = await client.post("/api/v1/tasks", body,
    { headers: { ...headers, "x-action-preview-id": previewId } });
  if (confirmed.statusCode === 201) return { task: confirmed.json().data, staged, confirmed, decision: null, previewId };
  expect(confirmed.statusCode, confirmed.body).toBe(403);
  expect(confirmed.json().error.details.stage).toBe("approval");
  const approvalId = confirmed.json().error.details.approvalId as string;
  const opened = await client.get(`/api/v1/approvals/${approvalId}`);
  expect(opened.statusCode, opened.body).toBe(200);
  const decision = await client.post(`/api/v1/approvals/${approvalId}/approve`, {},
    { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } });
  expect(decision.statusCode, decision.body).toBe(200);
  const receipt = String(decision.json().data.executionResult);
  const taskId = /^Aufgabe (task_[0-9A-Za-z]{26}) angelegt\.$/.exec(receipt)?.[1];
  expect(taskId, receipt).toBeTruthy();
  const taskResponse = await client.get(`/api/v1/tasks/${taskId}`);
  expect(taskResponse.statusCode, taskResponse.body).toBe(200);
  return { task: taskResponse.json().data, staged, confirmed, decision, previewId };
}
