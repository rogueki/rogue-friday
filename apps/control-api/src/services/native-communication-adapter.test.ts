import { AdapterRegistry, type CommunicationPort } from "@friday/adapter-core";
import { createCorrelationId } from "@friday/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeCommunicationFactory,
  NATIVE_COMMUNICATION_PROVIDER_ID,
  type NativeCommunicationSources,
} from "./native-communication-adapter";

const registries: AdapterRegistry[] = [];

const call = () => ({ correlationId: createCorrelationId(), actor: { type: "user" as const, id: "usr_test" } });

function catalogItem(platform: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { platform, source: "builtin", fields: [], configured: false, gatewayRunning: false,
    connectionState: "unknown", exactSendSupported: false, nativeSetupAvailable: false, ...overrides };
}

function envelope(id: string, flags: string[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, subject: "Wartung am Freitag", from: "Katharina Becker <k.becker@beispiel.example>",
    date: "2026-10-19T09:30:00Z", flags, ...overrides };
}

function mailList(accounts: Record<string, unknown>[], defaultAccountId: string | null = null) {
  return { accounts, defaultAccountId };
}

function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "work", displayName: "Geschäft", email: "erik@example.test", authMode: "password",
    secretState: { imapPassword: true, smtpPassword: true, oauthRefreshToken: false }, ...overrides };
}

const withAccount = () => vi.fn(async () => mailList([account()], "work"));

function mailSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    list: vi.fn(async () => mailList([])),
    envelopes: vi.fn(async () => ({ items: [], uidValidity: "42" })),
    search: vi.fn(async () => ({ items: [], uidValidity: "42" })),
    message: vi.fn(async () => ({})),
    ...overrides,
  };
}

function fakeSources(overrides: Record<string, unknown> = {}): NativeCommunicationSources {
  return {
    mailAccounts: mailSource(),
    messengerCatalog: { list: vi.fn(async () => ({ pin: "d923a5eb", items: [] })) },
    telephony: { status: vi.fn(async () => ({ configured: false, ready: false, ariReachable: false })) },
    ...overrides,
  } as unknown as NativeCommunicationSources;
}

async function start(sources: NativeCommunicationSources): Promise<{ registry: AdapterRegistry; port: CommunicationPort }> {
  const registry = new AdapterRegistry({ allowlist: [NATIVE_COMMUNICATION_PROVIDER_ID] });
  registries.push(registry);
  registry.registerFactory(NATIVE_COMMUNICATION_PROVIDER_ID,
    createNativeCommunicationFactory(() => sources, { ttlMs: 60_000, waitMs: 200 }));
  await registry.initialize({ mode: "live",
    adapters: { communication: { provider: NATIVE_COMMUNICATION_PROVIDER_ID, enabled: true, retry: false, circuitBreaker: false } } });
  return { registry, port: registry.getPort("communication") };
}

afterEach(async () => {
  for (const registry of registries.splice(0)) await registry.shutdownAll();
});

describe("NativeCommunicationAdapter", () => {
  it("lists every channel as not configured and stays online", async () => {
    const sources = fakeSources({
      messengerCatalog: { list: vi.fn(async () => ({ pin: "d923a5eb", items: [
        catalogItem("telegram"), catalogItem("whatsapp"), catalogItem("discord"), catalogItem("sms"),
      ] })) },
    });
    const { registry, port } = await start(sources);
    const page = await port.listChannels({}, call());
    expect(page.items.map((channel) => channel.kind)).toEqual(["email", "telegram", "whatsapp", "discord", "sms", "phone"]);
    expect(page.items.every((channel) => channel.status === "not_configured")).toBe(true);
    expect(page.items.every((channel) => !channel.capabilities.read && !channel.capabilities.send && !channel.capabilities.draft)).toBe(true);
    expect(page.freshness.state).toBe("fresh");
    expect(registry.aggregateCapabilities().modules.communication).toMatchObject({ read: true, send: false, draft: false });
    await registry.checkHealth(NATIVE_COMMUNICATION_PROVIDER_ID);
    expect(registry.listAdapters()[0]?.health.status).toBe("online");
  });

  it("maps configured mail, messengers and telephony channels", async () => {
    const sources = fakeSources({
      mailAccounts: mailSource({ list: vi.fn(async () => mailList([account()], "work")) }),
      messengerCatalog: { list: vi.fn(async () => ({ pin: "d923a5eb", items: [
        catalogItem("telegram", { configured: true, connectionState: "connected", gatewayRunning: true, exactSendSupported: true }),
        catalogItem("whatsapp", { configured: true, connectionState: "disconnected", exactSendSupported: true }),
        catalogItem("discord", { configured: true, connectionState: "unknown", gatewayRunning: true, exactSendSupported: true }),
      ] })) },
      telephony: { status: vi.fn(async () => ({ configured: true, ready: true, ariReachable: true })) },
    });
    const { port } = await start(sources);
    const first = await port.listChannels({}, call());
    expect(first.items.find((channel) => channel.kind === "email")).toMatchObject({
      status: "online", address: "erik@example.test", capabilities: { read: true, draft: false, send: true } });
    expect(first.items.find((channel) => channel.kind === "telegram")).toMatchObject({ status: "online", capabilities: { send: true } });
    expect(first.items.find((channel) => channel.kind === "whatsapp")?.status).toBe("offline");
    expect(first.items.find((channel) => channel.kind === "discord")?.status).toBe("degraded");
    expect(first.items.find((channel) => channel.kind === "phone")?.status).toBe("online");
    const second = await port.listChannels({}, call());
    expect(second.items.map((channel) => channel.id)).toEqual(first.items.map((channel) => channel.id));
  });

  it("marks channels offline and stale when the bridge is unreachable", async () => {
    const down = vi.fn(async () => { throw new Error("bridge down"); });
    const sources = fakeSources({
      mailAccounts: mailSource({ list: down, envelopes: down, search: down, message: down }),
      messengerCatalog: { list: down },
      telephony: { status: down },
    });
    const { port } = await start(sources);
    const page = await port.listChannels({}, call());
    expect(page.items.map((channel) => channel.status)).toEqual(["offline", "offline", "offline", "offline", "offline", "offline"]);
    expect(page.freshness.state).toBe("stale");
  });

  it("maps envelopes to threads and short-circuits unsupported filters", async () => {
    const envelopes = vi.fn(async () => ({ items: [
      envelope("101", ["seen", "answered"]),
      envelope("102", ["flagged"], { subject: "Rechnung", from: "erik@example.test" }),
    ], uidValidity: "42" }));
    const search = vi.fn(async () => ({ items: [], uidValidity: "42" }));
    const sources = fakeSources({ mailAccounts: mailSource({ list: withAccount(), envelopes, search }) });
    const { port } = await start(sources);
    const page = await port.listThreads({}, call());
    expect(page.items.map((thread) => thread.status)).toEqual(["replied", "open"]);
    expect(page.items.map((thread) => thread.priority)).toEqual(["P3", "P2"]);
    expect(page.items.map((thread) => thread.unreadCount)).toEqual([0, 1]);
    expect(page.items[0]?.participants[0]).toEqual({ name: "Katharina Becker", address: "k.becker@beispiel.example" });
    expect(envelopes).toHaveBeenCalledTimes(1);
    const before = envelopes.mock.calls.length;
    expect((await port.listThreads({ needsReply: true }, call())).items).toEqual([]);
    expect(envelopes).toHaveBeenCalledTimes(before);
    expect((await port.listThreads({ status: ["archived"] }, call())).items).toEqual([]);
    expect(envelopes).toHaveBeenCalledTimes(before);
    expect((await port.listThreads({ channelId: "chan_other" }, call())).items).toEqual([]);
    expect(envelopes).toHaveBeenCalledTimes(before);
    await port.listThreads({ q: "Wartung" }, call());
    expect(search).toHaveBeenCalledWith("work", "INBOX", "Wartung", 1);
  });

  it("pages through the native inbox with cached envelope reads", async () => {
    const items = Array.from({ length: 25 }, (_, index) => envelope(String(index + 1), index === 0 ? ["seen"] : []));
    const envelopes = vi.fn(async () => ({ items, uidValidity: "42" }));
    const sources = fakeSources({ mailAccounts: mailSource({ list: withAccount(), envelopes }) });
    const { port } = await start(sources);
    const first = await port.listThreads({ limit: 10 }, call());
    expect(first.items).toHaveLength(10);
    expect(first.pageInfo.nextCursor).toBeTruthy();
    const second = await port.listThreads({ limit: 10, cursor: first.pageInfo.nextCursor }, call());
    expect(second.items).toHaveLength(10);
    expect(second.items[0]?.source.externalId).toBe("INBOX/11");
    const third = await port.listThreads({ limit: 10, cursor: second.pageInfo.nextCursor }, call());
    expect(third.items).toHaveLength(5);
    expect(third.pageInfo.nextCursor).not.toBeNull();
    expect(envelopes).toHaveBeenCalledTimes(1);
  });

  it("fails with ADAPTER_UNAVAILABLE when mail is down and returns an empty page without an account", async () => {
    const down = vi.fn(async () => { throw new Error("bridge down"); });
    const broken = fakeSources({ mailAccounts: mailSource({ list: down, envelopes: down, search: down, message: down }) });
    const { port } = await start(broken);
    await expect(port.listThreads({}, call())).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    const idle = fakeSources();
    const { port: idlePort } = await start(idle);
    expect((await idlePort.listThreads({}, call())).items).toEqual([]);
  });

  it("returns thread details and tolerates a missing body", async () => {
    const envelopes = vi.fn(async () => ({ items: [envelope("201", ["seen"], { subject: "Rückruf" })], uidValidity: "42" }));
    const message = vi.fn(async () => ({ bodyText: "Bitte um Rückruf.", to: "erik@example.test" }));
    const sources = fakeSources({ mailAccounts: mailSource({ list: withAccount(), envelopes, message }) });
    const { port } = await start(sources);
    const page = await port.listThreads({}, call());
    const id = page.items[0]?.id ?? "";
    const single = await port.getThread({ id }, call());
    expect(single.data.messages?.length).toBe(1);
    expect(single.data.messages?.[0]).toMatchObject({ direction: "inbound", bodyText: "Bitte um Rückruf." });
    expect(message).toHaveBeenCalledWith("work", "INBOX", "201", "42");
    await expect(port.getThread({ id: "thr_00000000000000000000000000" }, call())).rejects.toMatchObject({ code: "NOT_FOUND" });
    message.mockRejectedValueOnce(new Error("body down"));
    const withoutBody = await port.getThread({ id }, call());
    expect(withoutBody.data.messages).toBeUndefined();
  });
});
