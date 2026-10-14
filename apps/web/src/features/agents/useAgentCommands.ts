"use client";

import type { Agent } from "@jarvis/sdk";
import { useToast } from "@jarvis/ui";
import { useCallback, useMemo } from "react";
import { useT } from "@/i18n";
import { useAgentAction } from "@/lib/api/domains/agents";
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

/** Pause / resume / stop with success toasts; failures are toasted by the global mutation handler. */
export function useAgentCommands() {
  const { t } = useT();
  const { toast } = useToast();
  const pause = useAgentAction("pause");
  const resume = useAgentAction("resume");
  const stop = useAgentAction("stop");

  const run = useCallback(
    (action: "pause" | "resume" | "stop", agent: Agent) => {
      const mutation = { pause, resume, stop }[action];
      const message = { pause: "agents.toast.paused", resume: "agents.toast.resumed", stop: "agents.toast.stopped" } as const;
      // A failure is already shown by the global mutation error toast, so the rejection is only acknowledged here.
      mutation.mutateAsync({ id: agent.id }).then(
        () => toast({ title: t(message[action]), description: agent.name, tone: "green", duration: 3500 }),
        () => undefined,
      );
    },
    [pause, resume, stop, toast, t],
  );

  return { run, pending: pause.isPending || resume.isPending || stop.isPending };
}
