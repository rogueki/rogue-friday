import { CONTRACT_VERSION, type AdapterManifest, type CommandHistoryEntry, type QuickCommand } from "@jarvis/sdk";
import { ADAPTER_CATEGORIES, CATEGORY_LABEL, adapterIdFor, defaultCapabilities } from "../core/constants";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import { adapterSecretFields } from "./settings";
import type { AdapterRuntime } from "../world/state";

export function buildAdapters(ctx: SeedContext): AdapterRuntime[] {
  const modules = defaultCapabilities(CONTRACT_VERSION).modules as unknown as Record<string, Record<string, unknown> | undefined>;
  return ADAPTER_CATEGORIES.map((category) => {
    const moduleFlags = modules[category] ?? {};
    const capabilityNames = Object.entries(moduleFlags)
      .filter(([name, value]) => value === true && name !== "sources")
      .map(([name]) => `${category}.${name}`);
    const manifest: AdapterManifest = {
      id: adapterIdFor(category),
      name: `Mock ${CATEGORY_LABEL[category]}`,
      adapterVersion: "1.0.0",
      contractVersion: CONTRACT_VERSION,
      apiVersion: "v1",
      category,
      capabilities: capabilityNames,
      configSchemaRef: `adapters/${adapterIdFor(category)}/config.schema.json`,
      secretFields: adapterSecretFields(category),
    };
    return {
      category,
      manifest,
      enabled: true,
      provider: adapterIdFor(category),
      mode: "online",
      latencyMs: ctx.rng.int(2, 9),
      lastSuccessAt: ctx.at(-ctx.rng.int(1, 30) * 1000),
      lastSyncedAt: ctx.at(-ctx.rng.int(5, 60) * 1000),
      lastError: null,
      consecutiveFailures: 0,
      circuit: "closed",
      latencyOverrideMs: null,
      errorRateOverride: null,
    };
  });
}

export function buildQuickCommands(): QuickCommand[] {
  return [
    { id: "new-task", label: "Neue Aufgabe", icon: "plus-square", commandText: "Lege eine neue Aufgabe an: ", targetRoute: "/tasks", enabled: true, requiredCapability: "tasks.create", requiresConfirmation: true },
    { id: "summarize-mail", label: "Mails zusammenfassen", icon: "mail", commandText: "Fasse meine wichtigen E-Mails zusammen", targetRoute: "/communication", enabled: true, requiredCapability: "communication.read", requiresConfirmation: false },
    { id: "day-briefing", label: "Tagesbriefing", icon: "sun", commandText: "Erstelle mein Tagesbriefing", targetRoute: null, enabled: true, requiredCapability: "commands.execute", requiresConfirmation: false },
    { id: "today-events", label: "Termine heute", icon: "calendar", commandText: "Zeige meine Termine für heute", targetRoute: "/calendar", enabled: true, requiredCapability: "calendar.read", requiresConfirmation: false },
    { id: "search-memory", label: "Memory durchsuchen", icon: "brain", commandText: "Suche im Gedächtnis nach ", targetRoute: "/memory", enabled: true, requiredCapability: "memory.search", requiresConfirmation: false },
    { id: "system-check", label: "System-Check", icon: "activity", commandText: "Prüfe den Systemzustand", targetRoute: "/system", enabled: true, requiredCapability: "system.healthcheck", requiresConfirmation: false },
    { id: "start-research", label: "Recherche starten", icon: "search", commandText: "Recherchiere zum Thema: ", targetRoute: "/research", enabled: true, requiredCapability: "commands.execute", requiresConfirmation: true },
    { id: "pause-all", label: "Alles pausieren", icon: "pause", commandText: "Pausiere alle Aufgaben", targetRoute: null, enabled: true, requiredCapability: "commands.pause", requiresConfirmation: true },
  ];
}

export function buildCommandHistory(ctx: SeedContext): CommandHistoryEntry[] {
  const entries: { text: string; origin: CommandHistoryEntry["origin"]; status: CommandHistoryEntry["status"]; tier: CommandHistoryEntry["riskTier"]; agoMs: number; redacted?: boolean }[] = [
    { text: "Fasse meine wichtigen E-Mails zusammen", origin: "quick_command", status: "accepted", tier: 1, agoMs: 42 * MIN },
    { text: "Wie sieht mein Tag morgen aus?", origin: "voice", status: "executed", tier: 1, agoMs: 2 * HOUR },
    { text: "Sende die Terminbestätigung an Frau Becker", origin: "text", status: "requires_approval", tier: 2, agoMs: 35 * MIN },
    { text: "Suche im Gedächtnis nach Zahlungsziel Becker", origin: "palette", status: "executed", tier: 1, agoMs: 5 * HOUR },
    { text: "Öffne die Aufgaben", origin: "palette", status: "executed", tier: 1, agoMs: 6 * HOUR },
    { text: "Pausiere alle Aufgaben", origin: "text", status: "executed", tier: 1, agoMs: 1 * DAY },
    { text: "Der Zugangscode lautet ••••", origin: "voice", status: "rejected", tier: null, agoMs: 1 * DAY + 3 * HOUR, redacted: true },
    { text: "Recherchiere Förderprogramme für Photovoltaik", origin: "text", status: "accepted", tier: 1, agoMs: 3 * DAY + 3 * HOUR },
  ];
  return entries.map((entry) => ({
    id: ctx.id("cmd"),
    version: 1,
    createdAt: ctx.at(-entry.agoMs),
    updatedAt: ctx.at(-entry.agoMs),
    source: ctx.src("commands"),
    text: entry.text,
    redacted: entry.redacted ?? false,
    origin: entry.origin,
    status: entry.status,
    riskTier: entry.tier,
    executedAt: ctx.at(-entry.agoMs),
    correlationId: ctx.id("corr"),
    repeatable: !(entry.redacted ?? false) && entry.status !== "rejected",
  }));
}
