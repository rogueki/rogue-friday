"use client";

import type { Agent, AgentResponse } from "@friday/sdk";
import { useCallback, useMemo } from "react";
import { useT } from "@/i18n";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/queryKeys";
import { useRunStagedWrite, useStagedWriteBusy } from "@/lib/api/stagedWrite";
import { useCapabilityState, type CapabilityState } from "@/lib/capabilities";
import { ACTION_STATUSES, type AgentActionId } from "./model";

export interface AgentActionState {
  gate: CapabilityState;
  blockedReason?: string;
}

/** Capability and status gating of the agent actions (PLAN §31.3: only when the adapter supports them). */
export function useAgentActionStates(agent: Agent | undefined): Record<AgentActionId, AgentActionState> {
  const { t } = useT();
  const pause = useCapabilityState("agents", "pause");
  const resume = useCapabilityState("agents", "resume");
  const stop = useCapabilityState("agents", "stop");
  const assign = useCapabilityState("agents", "assignTask");
  const updateTask = useCapabilityState("tasks", "update");
  return useMemo(() => {
    const wrongStatus = t("agents.action.reason.status");
    const only = (action: keyof typeof ACTION_STATUSES): string | undefined => (agent && ACTION_STATUSES[action].includes(agent.status) ? undefined : wrongStatus);
    // Assigning an agent to a task is a task update on the wire, so both capabilities are needed.
    const assignGate: CapabilityState = assign !== "available" ? assign : updateTask;
    return {
      pause: { gate: pause, blockedReason: only("pause") },
      resume: { gate: resume, blockedReason: only("resume") },
      stop: { gate: stop, blockedReason: only("stop") },
      assignTask: { gate: assignGate, blockedReason: agent?.status === "offline" ? wrongStatus : undefined },
    };
  }, [agent, pause, resume, stop, assign, updateTask, t]);
}

const AGENT_ACTION_PATHS = {
  pause: "/api/v1/agents/{id}/pause",
  resume: "/api/v1/agents/{id}/resume",
  stop: "/api/v1/agents/{id}/stop",
} as const;

/**
 * Pause / resume / stop as staged writes: the server shows a preview first and executes only after the user
 * confirms the unchanged action in the shared StagedWriteConfirmHost dialog.
 */
export function useAgentCommands() {
  const { t } = useT();
  const runStagedWrite = useRunStagedWrite();
  const busy = useStagedWriteBusy();

  const run = useCallback(
    (action: "pause" | "resume" | "stop", agent: Agent) => {
      const message = { pause: "agents.toast.paused", resume: "agents.toast.resumed", stop: "agents.toast.stopped" } as const;
      void runStagedWrite({
        send: (previewId) =>
          call(getApiClient().POST(AGENT_ACTION_PATHS[action], {
            params: { path: { id: agent.id } },
            ...(previewId ? { headers: { "X-Action-Preview-Id": previewId } } : {}),
          })) as Promise<AgentResponse>,
        successMessage: t(message[action]),
        subject: agent.name,
        invalidateKeys: [queryKeys.agents.all, queryKeys.overview],
      });
    },
    [runStagedWrite, t],
  );

  return { run, pending: busy };
}
