import { CONTRACT_VERSION, type CommandResponse } from "@friday/sdk";
import { createId } from "@friday/observability";
import type { HandlerResult, RequestContext } from "../http/context";

/**
 * Command texts the web client sends as intents (apps/web `useVoiceUi`); the Control API maps them to the voice
 * pipeline instead of treating them as free-text requests for an agent.
 */
export const VOICE_START_COMMAND = "Sprachaufnahme starten";
export const FOCUS_MODE_COMMAND = "Fokus-Modus umschalten";

export type BuiltinIntent = "voice_start" | "focus_toggle";

const squash = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const VOICE_START = new Set([squash(VOICE_START_COMMAND), "starte sprachaufnahme", "sprachaufnahme beginnen"]);
const FOCUS_TOGGLE = new Set([squash(FOCUS_MODE_COMMAND), "fokusmodus umschalten", "fokus modus umschalten", "schalte den fokus modus um"]);

export function matchBuiltinIntent(text: string): BuiltinIntent | null {
  const key = squash(text);
  if (VOICE_START.has(key)) return "voice_start";
  if (FOCUS_TOGGLE.has(key)) return "focus_toggle";
  return null;
}


/**
 * Executes a built-in intent. The voice adapter is asked first (so an offline voice module answers 503 and a missing
 * capability `CAPABILITY_MISSING` like every other voice call); the pipeline itself is only controllable in
 * mock mode, where the world simulates it. With the mock commands adapter the world's own command service recognizes
 * the intents (so they run through the regular command port and show up in the command history); `delegate` is that
 * regular path. Only a mixed setup (live commands adapter next to a mock world) drives the world directly.
 */
export async function executeBuiltinIntent(ctx: RequestContext, intent: BuiltinIntent, delegate: () => Promise<HandlerResult>): Promise<HandlerResult> {
  const voice = ctx.runtime.registry.getPort("voice");
  const status = await voice.getVoiceStatus({}, ctx.call);
  const world = ctx.runtime.world;
  const commandsAreMock = ctx.runtime.registry.listAdapters().some((info) => info.manifest.category === "commands" && info.provider.startsWith("mock-"));
  if (world && commandsAreMock) return delegate();
  return { status: 200, body: executeDirectly(ctx, intent, status.data.focusMode) };
}

function executeDirectly(ctx: RequestContext, intent: BuiltinIntent, focusMode: boolean): CommandResponse {
  const world = ctx.runtime.world;
  const commandId = createId("cmd");
  const base = { contractVersion: CONTRACT_VERSION, commandId, requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, correlationId: ctx.correlationId } as const;
  const opContext = { correlationId: ctx.correlationId, actor: ctx.actor };

  if (!world) {
    return { ...base, status: "rejected", riskTier: null, result: { message: "Der Voice-Adapter kann die Sprachaufnahme nicht fernsteuern." } };
  }

  if (intent === "voice_start") {
    if (focusMode) {
      return { ...base, status: "rejected", result: { message: "Der Fokus-Modus ist aktiv. Bitte zuerst den Fokus-Modus beenden." } };
    }
    world.voice.setMode("listening");
    return { ...base, status: "executed", result: { message: "Sprachaufnahme gestartet.", targetRoute: "/voice" } };
  }

  const enable = !focusMode;
  const outcome = enable
    ? world.commands.pause({ scope: "voice", reason: "Fokus-Modus" }, opContext)
    : world.commands.resume({ scope: "voice", reason: "Fokus-Modus beendet" }, opContext);
  return { ...base, status: "executed", result: { message: outcome.message ?? (enable ? "Fokus-Modus aktiviert." : "Fokus-Modus beendet.") } };
}

