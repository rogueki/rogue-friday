import type { Settings, TaskCreateRequest } from "@friday/sdk";
import { validationFailed } from "../util/errors";

/** Resolve the native Kanban worker policy before staging an approval. */
export function routeAgentTask(body: TaskCreateRequest, settings: Settings["modelsRouting"]): TaskCreateRequest {
  const route = settings.routes.find((item) => item.taskKind === "agent-task");
  if (!route) return body;
  const target = route.model.trim() || settings.defaultModel.trim();
  if (body.model === undefined && !/^[a-z][a-z0-9-]*:[^\s:][^\s]*$/i.test(target)) {
    throw validationFailed("Die Agent-Aufgabenroute braucht Anbieter:Modell.",
      [{ path: "modelsRouting.routes.agent-task.model", message: "Anbieter:Modell erforderlich" }]);
  }
  return {
    ...body,
    ...(body.model === undefined ? { model: target } : {}),
    ...(body.reasoningLevel === undefined ? { reasoningLevel: route.reasoningLevel } : {}),
  };
}

export function taskModelPreview(body: TaskCreateRequest): string {
  return body.model ? ` Modell: ${body.model}; Denkstufe: ${body.reasoningLevel ?? "Profilvorgabe"}.` : "";
}
