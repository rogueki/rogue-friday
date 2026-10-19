import { CONTRACT_VERSION } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { stableUserId } from "../security/auth-service";
import type { InboundMessage } from "../services/messenger-inbound";
import { forbidden, notFound } from "../util/errors";

const single = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const messengerInboundHandlers: Partial<Record<OperationId, Handler>> = {
  async captureMessengerInbound(ctx) {
    if (!ctx.messengerInboundBridgeAuthorized || !ctx.runtime.auth.ownerPasswordConfigured())
      throw forbidden("Messenger-Empfang erfordert die lokale Gateway-Dienstkennung und einen eingerichteten Owner.");
    const input = ctx.body as InboundMessage;
    const result = ctx.runtime.messengerInbound.receive(input);
    ctx.audit.action = "messenger.inbound.classified";
    ctx.audit.after = { platform: input.platform, reason: result.reason, captured: result.eventId !== null };
    return { status: 200, body: single(result), headers: { "Cache-Control": "no-store" } };
  },
  async listMessengerSenders(ctx) {
    if (!ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Owner ist nicht eingerichtet.");
    return { status: 200, body: single({ items: ctx.runtime.messengerInbound.observations() }),
      headers: { "Cache-Control": "no-store" } };
  },
  async linkMessengerSender(ctx) {
    if (!ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Owner ist nicht eingerichtet.");
    const item = ctx.runtime.messengerInbound.link(ctx.pathParams.id!, stableUserId("owner"));
    if (!item) throw notFound("Beobachteter Messenger-Absender");
    ctx.audit.action = "messenger.sender.link";
    ctx.audit.after = { platform: item.platform, observationId: item.id };
    return { status: 200, body: single(item) };
  },
  async unlinkMessengerSender(ctx) {
    if (!ctx.runtime.auth.ownerPasswordConfigured()) throw forbidden("Owner ist nicht eingerichtet.");
    const id = ctx.pathParams.id!;
    if (!ctx.runtime.messengerInbound.observation(id)) throw notFound("Beobachteter Messenger-Absender");
    ctx.runtime.messengerInbound.unlink(id);
    const item = ctx.runtime.messengerInbound.observation(id)!;
    ctx.audit.action = "messenger.sender.unlink";
    ctx.audit.after = { platform: item.platform, observationId: item.id };
    return { status: 200, body: single(item) };
  },
};
