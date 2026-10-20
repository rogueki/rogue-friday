import type { Settings, TaskCreateRequest } from "@friday/sdk";
import { validationFailed } from "../util/errors";

/** Resolve the native Kanban worker policy before staging an approval. */
export function routeAgentTask(body: TaskCreateRequest, settings: Settings["modelsRouting"]): TaskCreateRequest {
  if (body.provider && (!body.model || !/^[a-z][a-z0-9-]*$/i.test(body.provider))) {
    throw validationFailed("Ein Task-Anbieter braucht eine gueltige Modell-ID.",
      [{ path: "provider", message: "Anbieter nur zusammen mit Modell" }]);
  }
  const route = settings.routes.find((item) => item.taskKind === "agent-task");
  if (!route) return body;
  const target = route.model.trim() || settings.defaultModel.trim();
  const parsed = /^([a-z][a-z0-9-]*):([^\s:][^\s]*)$/i.exec(target);
  if (body.model === undefined && !parsed) {
    throw validationFailed("Die Agent-Aufgabenroute braucht Anbieter:Modell.",
      [{ path: "modelsRouting.routes.agent-task.model", message: "Anbieter:Modell erforderlich" }]);
  }
  return {
    ...body,
    ...(body.model === undefined ? { model: parsed![2], provider: parsed![1] } : {}),
    ...(body.reasoningLevel === undefined ? { reasoningLevel: route.reasoningLevel } : {}),
  };
}

export function taskModelPreview(body: TaskCreateRequest): string {
  return body.model ? ` Modell: ${body.provider ? `${body.provider}:` : ""}${body.model}; Denkstufe: ${body.reasoningLevel ?? "Profilvorgabe"}.` : "";
}
