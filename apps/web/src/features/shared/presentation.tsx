import type { AgentStatus as WireAgentStatus, AttentionItem, HealthStatus, Notification, Priority, Severity as WireSeverity } from "@jarvis/sdk";
import type { AgentStatus, HealthState, Severity, Tone } from "@jarvis/ui";
import { AlertTriangle, Bell, Bot, CalendarDays, Clock, Code2, Cpu, Database, FlaskConical, Globe, ListChecks, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

const ICON = { strokeWidth: 1.5 } as const;

export function severityFromWire(severity: WireSeverity): Severity {
  switch (severity) {
    case "info":
      return "info";
    case "warning":
      return "warn";
    default:
      return "critical";
  }
}

export function severityFromPriority(priority: Priority): Severity {
  if (priority === "P0") return "critical";
  if (priority === "P1" || priority === "P2") return "warn";
  return "info";
}

export function healthStateFromWire(status: HealthStatus | undefined): HealthState {
  switch (status) {
    case "online":
      return "ok";
    case "degraded":
      return "degraded";
    case "offline":
      return "down";
    case "paused":
      return "maintenance";
    default:
      return "unknown";
  }
}

export function toneFromHealth(status: HealthStatus | undefined): Tone {
  switch (status) {
    case "online":
      return "green";
    case "degraded":
      return "amber";
    case "offline":
      return "red";
    case "paused":
      return "blue";
    default:
      return "muted";
  }
}

export interface AttentionVisual {
  icon: ReactNode;
  tone: Tone;
  route: string;
}

export function attentionVisual(item: AttentionItem): AttentionVisual {
  const severity = severityFromWire(item.severity);
  const severityTone: Tone = severity === "critical" ? "red" : severity === "warn" ? "amber" : "cyan";
  switch (item.kind) {
    case "approval":
      return { icon: <ShieldCheck {...ICON} />, tone: "amber", route: item.targetRoute };
    case "mail":
      return { icon: <Mail {...ICON} />, tone: severityTone === "cyan" ? "cyan" : severityTone, route: item.targetRoute };
    case "blocked_task":
      return { icon: <TriangleAlert {...ICON} />, tone: "red", route: item.targetRoute };
    case "overdue_task":
      return { icon: <Clock {...ICON} />, tone: "amber", route: item.targetRoute };
    case "system":
      return { icon: <Cpu {...ICON} />, tone: severityTone, route: item.targetRoute };
    default:
      return { icon: <AlertTriangle {...ICON} />, tone: severityTone, route: item.targetRoute };
  }
}

export function notificationIcon(category: Notification["category"]): ReactNode {
  switch (category) {
    case "approval":
      return <ShieldCheck {...ICON} />;
    case "mail":
      return <Mail {...ICON} />;
    case "calendar":
      return <CalendarDays {...ICON} />;
    case "system":
    case "adapter":
      return <Cpu {...ICON} />;
    case "task":
    case "automation":
      return <Clock {...ICON} />;
    default:
      return <Bell {...ICON} />;
  }
}

/** Wire agent status -> the five-state vocabulary of the AgentCard. */
export function agentCardStatus(status: WireAgentStatus): AgentStatus {
  switch (status) {
    case "working":
    case "starting":
      return "active";
    case "waiting":
      return "busy";
    case "error":
      return "error";
    case "paused":
      return "blocked";
    case "offline":
      return "offline";
    default:
      return "standby";
  }
}

const AGENT_TONES: readonly Tone[] = ["green", "cyan", "violet", "amber", "blue", "teal"];

export function agentTone(accent: string | undefined, index: number): Tone {
  const named = AGENT_TONES.find((tone) => tone === accent);
  return named ?? AGENT_TONES[index % AGENT_TONES.length] ?? "cyan";
}

/** Icon by agent role/name keywords (German and English), generic bot otherwise. */
export function agentIconFor(name: string, role: string): ReactNode {
  const text = `${name} ${role}`.toLowerCase();
  if (/(cod|entwickl|develop)/.test(text)) return <Code2 {...ICON} />;
  if (/(recher|research)/.test(text)) return <FlaskConical {...ICON} />;
  if (/(memory|gedächt|gedaecht|wissen)/.test(text)) return <Database {...ICON} />;
  if (/(browser|web)/.test(text)) return <Globe {...ICON} />;
  if (/(task|aufgab|plan)/.test(text)) return <ListChecks {...ICON} />;
  if (/(system|ops|monitor)/.test(text)) return <ShieldCheck {...ICON} />;
  return <Bot {...ICON} />;
}
