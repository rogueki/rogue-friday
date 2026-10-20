import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { IntegrationEvent } from "../services/durable-memory";
import type { MemorySettings } from "../services/durable-memory";
import { stableUserId } from "../security/auth-service";
import { conflict, forbidden, validationFailed } from "../util/errors";

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const durableMemoryHandlers: Partial<Record<OperationId, Handler>> = {
  async putDurableMemorySettings(ctx) {
    const settings = ctx.runtime.durableMemory.setSettings(ctx.body as Pick<MemorySettings, "enabled" | "privateMode" | "channels">);
    ctx.audit.action = "memory.capture_settings_changed";
    ctx.audit.after = { enabled: settings.enabled, privateMode: settings.privateMode, channels: settings.channels };
    return { status: 200, body: single(settings) };
  },
  async reindexDurableMemory(ctx) {
    ctx.runtime.durableMemory.reindex();
    const status = ctx.runtime.durableMemory.status();
    ctx.audit.action = "memory.index_rebuilt";
    ctx.audit.after = { indexState: status.indexState };
    return { status: 200, body: single(status) };
  },
  async getDurableMemoryStatus(ctx) {
    return { status: 200, body: single(ctx.runtime.durableMemory.status()) };
  },
  async captureDurableMemoryEvent(ctx) {
    let event = ctx.body as IntegrationEvent;
    if (ctx.hermesMemoryBridgeAuthorized) {
      if (!ctx.runtime.auth.ownerPasswordConfigured() || event.channel !== "hermes" || event.source !== "hermes/cli" ||
          event.identityId !== "owner" ||
          event.eventType === "user_utterance" && (event.actor.type !== "user" || event.actor.id !== "owner") ||
          event.eventType !== "user_utterance" && (event.actor.type !== "assistant" || event.actor.id !== "friday"))
        throw forbidden("Hermes-Gedächtnisereignis ist nicht an den lokalen Besitzer gebunden.");
      const owner = stableUserId("owner");
      event = { ...event, identityId: owner, actor: event.actor.type === "user" ? { ...event.actor, id: owner } : event.actor };
    } else if (ctx.voiceBridgeAuthorized) {
      if (!ctx.runtime.auth.ownerPasswordConfigured() || ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote ||
          event.channel !== "voice" || event.source !== "voice/friday" || event.identityId !== "owner" ||
          event.eventType === "user_utterance" && (event.actor.type !== "user" || event.actor.id !== "owner") ||
          event.eventType !== "user_utterance" && (event.actor.type !== "assistant" || event.actor.id !== "friday")) {
        throw forbidden("Voice-Gedächtnisereignis ist nicht an den lokalen Besitzer gebunden.");
      }
      if (!ctx.runtime.settings.area("voice").voiceHistoryEnabled) {
        return { status: 200, body: single({ eventId: event.eventId, accepted: false, pending: false }) };
      }
      const owner = stableUserId("owner");
      event = { ...event, identityId: owner, actor: event.actor.type === "user" ? { ...event.actor, id: owner } : event.actor };
    } else if (!ctx.principal || event.identityId !== ctx.principal.userId ||
        event.eventType === "user_utterance" && event.actor.id !== ctx.principal.userId ||
        event.channel === "voice" || event.channel === "hermes") {
      throw forbidden("Gedächtnisereignis gehört nicht zur bestätigten Identität.");
    }
    try {
      const result = ctx.runtime.durableMemory.capture(event);
      ctx.audit.action = "memory.event_captured";
      ctx.audit.after = { eventId: result.eventId, accepted: result.accepted, pending: result.pending };
      return { status: 200, body: single(result) };
    } catch (error) {
      if (error instanceof Error && error.message === "Event ID conflict") throw conflict("Ereignis-ID ist bereits anders belegt.");
      throw validationFailed("Gedächtnisereignis ist ungültig oder nicht dauerhaft speicherbar.");
    }
  },
  async searchDurableMemory(ctx) {
    const ownerVoice = ctx.voiceBridgeAuthorized && ctx.runtime.auth.ownerPasswordConfigured() &&
      !(ctx.runtime.auth.devMode && ctx.runtime.config.server.allowRemote) && ctx.query.identityId === "owner";
    const ownerHermes = ctx.hermesMemoryBridgeAuthorized && ctx.runtime.auth.ownerPasswordConfigured() &&
      ctx.query.identityId === "owner";
    const identity = ownerVoice || ownerHermes ? stableUserId("owner") : ctx.principal?.userId;
    if (!identity || !(ownerVoice || ownerHermes) && ctx.query.identityId !== identity) throw forbidden("Identität ist nicht bestätigt.");
    return { status: 200, body: single({ items: ctx.runtime.durableMemory.search(
      String(ctx.query.query ?? ""), identity, Number(ctx.query.limit ?? 20)) }) };
  },
  async forgetDurableMemoryEvent(ctx) {
    try {
      const result = ctx.runtime.durableMemory.forget(ctx.pathParams.eventId ?? "", ctx.principal!.userId);
      ctx.audit.action = "memory.event_forgotten";
      ctx.audit.after = { eventId: result.eventId, deleted: result.deleted };
      return { status: 200, body: single(result) };
    } catch { throw conflict("Gedächtniseintrag konnte nicht gelöscht werden."); }
  },
  async correctDurableMemoryEvent(ctx) {
    try {
      const result = ctx.runtime.durableMemory.correct(ctx.pathParams.eventId ?? "", (ctx.body as { text: string }).text,
        ctx.principal!.userId);
      ctx.audit.action = "memory.event_corrected";
      ctx.audit.after = { eventId: result.eventId, replacementEventId: result.replacementEventId };
      return { status: 200, body: single(result) };
    } catch { throw conflict("Gedächtniseintrag konnte nicht korrigiert werden."); }
  },
  async backupDurableMemory(ctx) {
    const result = ctx.runtime.durableMemory.backup();
    ctx.audit.action = "memory.backup_created";
    ctx.audit.after = { eventCount: result.eventCount };
    return { status: 200, body: single(result) };
  },
  async restoreDurableMemory(ctx) {
    const body = ctx.body as { backupPath: string; targetVaultPath: string };
    try {
      const result = ctx.runtime.durableMemory.restore(body.backupPath, body.targetVaultPath);
      ctx.audit.action = "memory.restore_tested";
      ctx.audit.after = { eventCount: result.eventCount };
      return { status: 200, body: single(result) };
    } catch { throw validationFailed("Backup konnte nicht in einen neuen, isolierten Vault wiederhergestellt werden."); }
  },
  async retryDurableMemory(ctx) {
    ctx.runtime.durableMemory.flush();
    return { status: 200, body: single(ctx.runtime.durableMemory.status()) };
  },
};
