import { CONTRACT_VERSION, type CommandResponse, type VoiceReadAnswer, type VoiceReadRequest, type VoiceReadResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { executeReadQuery, parseReadQueryIntent, VOICE_READ_KINDS } from "../services/read-query-intent";
import { ApiError, forbidden } from "../util/errors";

type Ctx = Parameters<Handler>[0];

const MAX_ANSWER_LENGTH = 4000;
const NOT_UNDERSTOOD = "Das kann ich per Stimme nicht nachsehen.";
const NOT_RELEASED = "Diese Abfrage ist per Stimme nicht freigegeben. Bitte im Dashboard nachsehen.";

const single = (data: VoiceReadAnswer): VoiceReadResponse =>
  ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

/** Same gate as the other voice routes: local bridge, configured owner, no remote dev mode. */
function requireVoiceBridge(ctx: Ctx): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() ||
    ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
    throw forbidden("Sprachabfragen erfordern den lokalen Voice-Dienst und ein eingerichtetes Besitzerkonto.");
  }
}

export const voiceReadHandlers: Partial<Record<OperationId, Handler>> = {
  async readVoiceQuery(ctx) {
    requireVoiceBridge(ctx);
    const { text } = ctx.body as VoiceReadRequest;
    const intent = parseReadQueryIntent(text);
    if (intent === null)
      return { status: 200, body: single({ kind: null, status: "unsupported", answer: NOT_UNDERSTOOD }) };
    if (intent.kind === "clarify")
      return { status: 200, body: single({ kind: "clarify", status: "clarify", answer: intent.message }) };
    if (!VOICE_READ_KINDS.has(intent.kind))
      return { status: 200, body: single({ kind: intent.kind, status: "unsupported", answer: NOT_RELEASED }) };
    const result = await executeReadQuery(ctx, intent);
    const message = (result.body as CommandResponse).result?.message;
    if (typeof message !== "string") throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Keine Antwort verfügbar." });
    return { status: 200, body: single({ kind: intent.kind, status: "answered", answer: message.slice(0, MAX_ANSWER_LENGTH) }) };
  },
};
