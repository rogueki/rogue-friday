import type { Agent, VoiceDomainTask } from "@friday/sdk";
import type { Handler } from "../http/context";
import { ApiError } from "../util/errors";

type Ctx = Parameters<Handler>[0];
export type DomainKey = VoiceDomainTask["domain"];

export const DOMAIN_RESULT_HINT = "Schliesse mit einer kurzen, vorlesbaren Zusammenfassung des Ergebnisses ab (hoechstens fuenf Saetze, keine Tabellen).";
// Hermes profiles carry the domain as profile name; the mock world only has display names.
export const DOMAIN_NAME: Record<DomainKey, RegExp> = {
  research: /^recherche/i, tasks: /^(task|aufgaben)/i, alerts: /^(alert|alarm|warn)/i, audit: /^(audit|pr(ue|ü)f)/i,
};
export const DOMAINS: ReadonlyArray<DomainKey> = ["research", "tasks", "alerts", "audit"];

// Same order and words as classify_domain in installer/voice/domain_task_voice.py: first match wins, else tasks.
const DOMAIN_PATTERNS: ReadonlyArray<readonly [DomainKey, RegExp]> = [
  ["audit", /\b(pruef|prüf|ueberpruef|überprüf|kontrollier|audit|nachweis)/i],
  ["alerts", /\b(warn|alarm|ueberwach|überwach|schwellenwert)/i],
  ["research", /\b(recherch|such|finde heraus|vergleich|informier|quellen)/i],
];

export function classifyDomain(text: string): DomainKey {
  return DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "tasks";
}

export async function resolveDomainAgent(ctx: Ctx, domain: DomainKey): Promise<Agent> {
  const agents = (await ctx.runtime.registry.getPort("agents").listAgents({ limit: 200 }, ctx.call)).items;
  const agent = agents.find((entry) => entry.source.externalId === domain) ??
    agents.find((entry) => DOMAIN_NAME[domain].test(entry.name));
  if (!agent) throw new ApiError({ code: "CAPABILITY_MISSING", message: `Fuer den Bereich ${domain} ist kein Agent eingerichtet.` });
  return agent;
}

export function domainTaskTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}…` : collapsed;
}