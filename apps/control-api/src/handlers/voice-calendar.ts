import { createHash } from "node:crypto";
import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { stableUserId } from "../security/auth-service";
import { checkedLocalEvent, LocalCalendarService, type LocalEventInput } from "../services/local-calendar";
import { conflict, forbidden, validationFailed } from "../util/errors";

interface VoiceRequest {
  action: "create" | "update" | "delete";
  targetTitle?: string;
  title?: string;
  start?: string;
  end?: string;
  timeZone?: string;
}
interface ConfirmRequest { request: VoiceRequest; token: string; targetId: string; version: number }
const ownerId = stableUserId("owner");
const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });
const fingerprint = (request: VoiceRequest, targetId: string, version: number) => createHash("sha256")
  .update(JSON.stringify([request.action, request.targetTitle ?? null, request.title ?? null, request.start ?? null, request.end ?? null, request.timeZone ?? null, targetId, version]))
  .digest("hex");

function assertVoice(ctx: Parameters<Handler>[0]): void {
  if (!ctx.voiceBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured() || ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) {
    throw forbidden("Kalender-Sprachaktionen erfordern den lokalen Voice-Dienst und ein eingerichtetes Besitzerkonto.");
  }
}

function target(calendar: LocalCalendarService, request: VoiceRequest) {
  if (!request.targetTitle?.trim()) throw validationFailed("Der Titel des bestehenden Termins fehlt.");
  const matches = calendar.findOwnerByTitle(ownerId, request.targetTitle);
  if (matches.length !== 1) throw conflict(matches.length ? "Mehrere lokale Termine tragen diesen Titel. Bitte im Dashboard bearbeiten." : "Kein eindeutiger lokaler Termin mit diesem Titel gefunden.");
  return matches[0]!;
}

function eventInput(request: VoiceRequest, previous?: { title: string; start: string; end: string; timeZone: string }): LocalEventInput {
  const start = request.start ?? previous?.start ?? "";
  const end = request.end ?? (request.start && previous ? new Date(Date.parse(request.start) + Date.parse(previous.end) - Date.parse(previous.start)).toISOString() : previous?.end) ?? "";
  return checkedLocalEvent({ title: request.title ?? previous?.title ?? "", start, end, timeZone: request.timeZone ?? previous?.timeZone ?? "" });
}

export const voiceCalendarHandlers: Partial<Record<OperationId, Handler>> = {
  async previewVoiceLocalCalendar(ctx) {
    assertVoice(ctx);
    const request = ctx.body as VoiceRequest;
    const calendar = new LocalCalendarService(ctx.runtime.db);
    const existing = request.action === "create" ? null : target(calendar, request);
    if (request.action !== "delete") eventInput(request, existing ?? undefined);
    const targetId = existing?.id ?? "";
    const version = existing?.version ?? 0;
    const { token, claims } = ctx.runtime.approvalTokens.issue({ approvalId: fingerprint(request, targetId, version), userId: ownerId, action: `calendar.voice.${request.action}` });
    const data = { token, expiresAt: new Date(claims.expiresAt).toISOString(), targetId, version,
      action: request.action, event: request.action === "delete" ?
        { title: existing!.title, start: existing!.start, end: existing!.end, timeZone: existing!.timeZone } : eventInput(request, existing ?? undefined) };
    return { status: 200, body: single(data) };
  },
  async confirmVoiceLocalCalendar(ctx) {
    assertVoice(ctx);
    if (!ctx.idempotencyKey) throw validationFailed("Idempotency-Key ist fuer Sprachtermine erforderlich.");
    const { request, token, targetId, version } = ctx.body as ConfirmRequest;
    const calendar = new LocalCalendarService(ctx.runtime.db);
    if (request.action === "create" && (targetId !== "" || version !== 0)) throw validationFailed("Ungueltige Terminbestaetigung.");
    if (request.action !== "create") {
      const current = target(calendar, request);
      if (current.id !== targetId || current.version !== version) throw conflict("Der Termin wurde inzwischen geaendert. Bitte erneut vorlesen lassen.");
    }
    const valid = ctx.runtime.approvalTokens.consume(token, { approvalId: fingerprint(request, targetId, version), userId: ownerId, action: `calendar.voice.${request.action}` });
    if (!valid.ok) throw conflict("Die gesprochene Bestaetigung ist ungueltig, abgelaufen oder bereits verwendet.");
    const result = request.action === "create" ? calendar.create(eventInput(request), ownerId) :
      request.action === "update" ? calendar.update(targetId, eventInput(request, calendar.get(targetId)), ownerId, version) :
        calendar.get(targetId);
    if (request.action === "delete") calendar.delete(targetId, ownerId, version);
    ctx.audit.action = `calendar.voice_${request.action}`;
    ctx.audit.after = { id: result.id, version: result.version };
    return { status: request.action === "create" ? 201 : 200, body: single(result), headers: { "Idempotent-Replayed": "false" } };
  },
};
