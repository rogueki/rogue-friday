import {
  AdapterError,
  createId,
  type AdapterContext, type AdapterFactory, type AdapterHealthReport, type CallContext, type CapabilitySet,
  type CommunicationPort, type FridayAdapter, type IdParam, type ListThreadsParams, type Page, type PageParams,
  type Single,
} from "@friday/adapter-core";
import {
  CONTRACT_VERSION, type AdapterManifest, type Channel, type ChannelKind, type ChannelStatus, type Message,
  type Participant, type SourceDescriptor, type Thread,
} from "@friday/sdk";
import type { MailAccount, MailAccountsService } from "./mail-accounts";
import type { MessengerCatalogItem, MessengerCatalogService } from "./messenger-catalog";
import type { TelephonyService, TelephonyStatus } from "./telephony";

export const NATIVE_COMMUNICATION_PROVIDER_ID = "friday-communication";
export const NATIVE_COMMUNICATION_CONFIG_SCHEMA_ID = "urn:friday:adapter:friday-communication:config";
export const nativeCommunicationConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: NATIVE_COMMUNICATION_CONFIG_SCHEMA_ID,
  title: "Friday-Kommunikation (Postfach & Messenger)",
  description: "Eingebauter Adapter ohne Einstellungen: zeigt E-Mail-Postfach, Messenger und Telefonie aus den Skill-Konten von F.R.I.D.A.Y.",
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;
export const nativeCommunicationManifest: AdapterManifest = {
  id: NATIVE_COMMUNICATION_PROVIDER_ID,
  name: "Friday-Kommunikation (Postfach & Messenger)",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "communication",
  // Read only; drafts and sends stay on the native mail/messenger routes with their own preview + approval flow.
  capabilities: ["communication.read"],
  configSchemaRef: NATIVE_COMMUNICATION_CONFIG_SCHEMA_ID,
  secretFields: [],
};

const DEFAULT_TTL_MS = 15_000;
const DEFAULT_WAIT_MS = 3_500;
const MAILBOX = "INBOX";
const MAIL_PAGE_SIZE = 25;
const MAIL_MAX_PAGE = 20;
const INBOX_CACHE_LIMIT = 50;
const THREAD_CACHE_LIMIT = 5_000;
const THREAD_ID_PATTERN = /^thr_[0-9A-Za-z]{26}$/;
const UID_PATTERN = /^[1-9][0-9]{0,17}$/;
const NO_ACCESS = { read: false, send: false } as const;

type ChannelSystem = SourceDescriptor["system"];
type MailList = Awaited<ReturnType<MailAccountsService["list"]>>;
type Envelopes = Awaited<ReturnType<MailAccountsService["envelopes"]>>;
type CatalogList = Awaited<ReturnType<MessengerCatalogService["list"]>>;

type ProbeResult<T> = { ok: true; value: T; at: number } | { ok: false; error: unknown; at: number };

interface EnvelopeItem {
  id: string;
  subject: string;
  from: string;
  date: string;
  flags: string[];
}
interface ThreadRef {
  accountId: string;
  mailbox: string;
  uid: string;
  uidValidity: string;
  thread: Thread;
}
interface ProbeSet {
  context: AdapterContext;
  sources: NativeCommunicationSources;
  mail: CachedProbe<MailList>;
  catalog: CachedProbe<CatalogList>;
  telephony: CachedProbe<TelephonyStatus>;
}

const MESSENGER_CHANNELS: ReadonlyArray<{ key: ChannelKind; name: string }> = [
  { key: "telegram", name: "Telegram" },
  { key: "whatsapp", name: "WhatsApp" },
  { key: "discord", name: "Discord" },
  { key: "sms", name: "SMS" },
];

const channelIdOf = (key: string): string => createId("chan", `friday-communication:${key}`);
const toIsoAt = (at: number): string => new Date(at).toISOString();
const sourceOf = (system: ChannelSystem, at: string): SourceDescriptor =>
  ({ adapterId: NATIVE_COMMUNICATION_PROVIDER_ID, system, lastSyncedAt: at });

/** Timer that never keeps the process alive; the caller clears it once its race is decided. */
function delay(ms: number): { promise: Promise<undefined>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), Math.max(0, ms));
    handle = timer;
    if (typeof timer.unref === "function") timer.unref();
  });
  return { promise, cancel: () => { if (handle !== undefined) clearTimeout(handle); } };
}

class CachedProbe<T> {
  private result: ProbeResult<T> | undefined;
  private inflight: Promise<void> | undefined;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  /**
   * Stale-while-revalidate: a successful result younger than ttl is returned at once; an older successful result is
   * returned at once while a refresh runs in the background; without a successful result (none yet or last one failed)
   * the call waits up to waitMs for a (deduplicated) load and returns whatever result exists afterwards (may be undefined).
   */
  async read(waitMs: number): Promise<ProbeResult<T> | undefined> {
    const current = this.result;
    if (current?.ok) {
      if (this.now() - current.at < this.ttlMs) return current;
      this.start();
      return current;
    }
    const inflight = this.start();
    const timer = delay(waitMs);
    try {
      await Promise.race([inflight, timer.promise]);
    } finally {
      timer.cancel();
    }
    return this.result;
  }

  /** Starts a load without waiting (used to warm the cache at initialize). */
  warm(): void {
    this.start();
  }

  private start(): Promise<void> {
    if (this.inflight) return this.inflight;
    // Promise.resolve().then() also catches loads that throw synchronously, and the rejection handler keeps a failing
    // probe from surfacing as an unhandled rejection.
    const settled = Promise.resolve()
      .then(this.load)
      .then(
        (value) => { this.result = { ok: true, value, at: this.now() }; },
        (error: unknown) => { this.result = { ok: false, error, at: this.now() }; },
      )
      .finally(() => { this.inflight = undefined; });
    this.inflight = settled;
    return settled;
  }
}

function buildChannel(
  key: string,
  kind: ChannelKind,
  name: string,
  status: ChannelStatus,
  capabilities: { read: boolean; send: boolean },
  at: number,
  system: ChannelSystem,
  address?: string,
): Channel {
  const iso = toIsoAt(at);
  return {
    id: channelIdOf(key),
    version: 1,
    createdAt: iso,
    updatedAt: iso,
    source: sourceOf(system, iso),
    kind,
    name,
    status,
    capabilities: { read: capabilities.read, draft: false, send: capabilities.send },
    unreadCount: 0,
    lastSyncAt: status === "online" || status === "degraded" ? iso : null,
    ...(address ? { address } : {}),
  };
}

function hasMailCredentials(account: MailAccount): boolean {
  return account.authMode === "password" ? account.secretState.imapPassword : account.secretState.oauthRefreshToken;
}

function orderAccounts(accounts: MailAccount[], defaultAccountId: string | null): MailAccount[] {
  if (!defaultAccountId) return accounts;
  const preferred = accounts.find((account) => account.id === defaultAccountId);
  if (!preferred) return accounts;
  return [preferred, ...accounts.filter((account) => account.id !== defaultAccountId)];
}

function messengerStatus(item: MessengerCatalogItem | undefined): ChannelStatus {
  if (!item || !item.configured) return "not_configured";
  if (item.connectionState === "connected") return "online";
  if (item.connectionState === "disconnected") return "offline";
  return item.gatewayRunning ? "degraded" : "offline";
}

/** "Name <addr>" -> name + address; a bare value is both. Blank input has no participant. */
function parseParticipant(value: string): Participant | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = /^(.*)<([^<>]+)>$/.exec(trimmed);
  if (!match) return { name: trimmed, address: trimmed };
  const address = (match[2] ?? "").trim();
  const name = (match[1] ?? "").trim().replace(/^"(.*)"$/, "$1").trim();
  return { name: name || address, address };
}

/** Envelopes arrive as untyped JSON; anything unexpected is skipped instead of breaking the whole list. */
function readEnvelope(raw: unknown): EnvelopeItem | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const { id, subject, from, date, flags } = record;
  if (typeof id !== "string" || !UID_PATTERN.test(id)) return undefined;
  if (typeof subject !== "string" || typeof from !== "string" || typeof date !== "string") return undefined;
  if (!Array.isArray(flags)) return undefined;
  const normalized: string[] = [];
  for (const flag of flags as unknown[]) {
    if (typeof flag !== "string") return undefined;
    normalized.push(flag);
  }
  return { id, subject, from, date, flags: normalized };
}

const invalidCursor = (): AdapterError =>
  new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });

const encodeThreadCursor = (page: number, skip: number): string =>
  Buffer.from(`p:${page}:${skip}`).toString("base64url");

function decodeThreadCursor(cursor: string | null | undefined): { page: number; skip: number } {
  if (!cursor) return { page: 1, skip: 0 };
  const match = /^p:(\d+):(\d+)$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) throw invalidCursor();
  const page = Number(match[1]);
  const skip = Number(match[2]);
  if (page < 1 || page > MAIL_MAX_PAGE) throw invalidCursor();
  return { page, skip };
}

export interface NativeCommunicationSources {
  mailAccounts: Pick<MailAccountsService, "list" | "envelopes" | "search" | "message">;
  messengerCatalog: Pick<MessengerCatalogService, "list">;
  telephony: Pick<TelephonyService, "status">;
}

export interface NativeCommunicationOptions {
  /** How long a successful probe is reused before it is refreshed in the background (default 15_000). */
  ttlMs?: number;
  /** How long a call waits for a probe that has no usable result yet (default 3_500, below the 5 s port timeout). */
  waitMs?: number;
}

export function createNativeCommunicationFactory(
  sources: () => NativeCommunicationSources,
  options: NativeCommunicationOptions = {},
): AdapterFactory<"communication"> {
  return {
    providerId: NATIVE_COMMUNICATION_PROVIDER_ID,
    category: "communication",
    configSchema: nativeCommunicationConfigSchema,
    modes: ["live", "hybrid"],
    create: () => new NativeCommunicationAdapter(sources, options),
  };
}

export class NativeCommunicationAdapter implements FridayAdapter, CommunicationPort {
  readonly manifest = nativeCommunicationManifest;
  private context: AdapterContext | undefined;
  private probes: ProbeSet | undefined;
  /** Envelope pages by `${accountId}\u0000${page}\u0000${q}`; every page is one WSL round trip. */
  private readonly inbox = new Map<string, CachedProbe<Envelopes>>();
  /** Thread id -> native address, so getThread does not have to rescan the mailbox. */
  private readonly threads = new Map<string, ThreadRef>();
  private readonly ttlMs: number;
  private readonly waitMs: number;

  constructor(
    private readonly sources: () => NativeCommunicationSources,
    options: NativeCommunicationOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  }

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
    const sources = this.sources();
    const now = (): number => context.clock.now();
    const probes: ProbeSet = {
      context,
      sources,
      mail: new CachedProbe(() => sources.mailAccounts.list(), this.ttlMs, now),
      catalog: new CachedProbe(() => sources.messengerCatalog.list(), this.ttlMs, now),
      telephony: new CachedProbe(() => sources.telephony.status(), this.ttlMs, now),
    };
    this.probes = probes;
    // Warm at start-up: the first dashboard call would otherwise wait for three WSL round trips.
    probes.mail.warm();
    probes.catalog.warm();
    probes.telephony.warm();
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...nativeCommunicationManifest.capabilities] };
  }

  async shutdown(): Promise<void> {
    // The runtime owns the services; the adapter only drops its references and caches.
    this.probes = undefined;
    this.context = undefined;
    this.inbox.clear();
    this.threads.clear();
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    // In-process adapter: per-channel truth lives in the channel list, not in adapter health.
    if (!this.context || !this.probes)
      return { status: "offline", latencyMs: null, message: "Adapter ist nicht aktiv", errorCode: "ADAPTER_UNAVAILABLE" };
    return { status: "online", latencyMs: 0 };
  }

  async listChannels(_params: PageParams, _call: CallContext): Promise<Page<Channel>> {
    const probes = this.ready();
    const now = probes.context.clock.now();
    const [mail, catalog, telephony] = await Promise.all([
      probes.mail.read(this.waitMs),
      probes.catalog.read(this.waitMs),
      probes.telephony.read(this.waitMs),
    ]);
    const items: Channel[] = [
      ...this.emailChannels(mail, now),
      ...this.messengerChannels(catalog, now),
      this.phoneChannel(telephony, now),
    ];
    const fresh = [mail, catalog, telephony].every(
      (result) => result !== undefined && result.ok && now - result.at < this.ttlMs,
    );
    const asOf = toIsoAt(now);
    return {
      items,
      pageInfo: { nextCursor: null, hasNextPage: false, totalCount: items.length },
      freshness: { state: fresh ? "fresh" : "stale", asOf },
      sources: [sourceOf("friday", asOf)],
    };
  }

  async listThreads(params: ListThreadsParams, _call: CallContext): Promise<Page<Thread>> {
    const probes = this.ready();
    const now = probes.context.clock.now();
    const emptyPage = (): Page<Thread> => {
      const asOf = toIsoAt(now);
      return {
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 },
        freshness: { state: "fresh", asOf },
        sources: [sourceOf("himalaya", asOf)],
      };
    };
    // The native mailbox neither classifies replies nor keeps drafts, so those filters can only be empty.
    if (params.needsReply === true || params.hasDraft === true) return emptyPage();
    if (
      params.status !== undefined && params.status.length > 0 &&
      !params.status.includes("open") && !params.status.includes("replied")
    ) return emptyPage();
    const mail = await probes.mail.read(this.waitMs);
    if (!mail || !mail.ok)
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach in Friday-Ubuntu ist nicht erreichbar.", retryable: true });
    const account =
      mail.value.accounts.find((candidate) => candidate.id === mail.value.defaultAccountId) ?? mail.value.accounts[0];
    if (!account || !hasMailCredentials(account)) return emptyPage();
    const channelId = channelIdOf(`email:${account.id}`);
    if (params.channelId !== undefined && params.channelId !== channelId) return emptyPage();
    const { page, skip } = decodeThreadCursor(params.cursor);
    const trimmedQuery = params.q?.trim().slice(0, 100);
    const q = trimmedQuery && trimmedQuery.length > 0 ? trimmedQuery : undefined;
    const probe = this.inboxProbe(probes, account.id, page, q);
    const pageResult = await probe.read(this.waitMs);
    if (!pageResult)
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Das Postfach wird noch geladen. Bitte gleich erneut versuchen.", retryable: true });
    if (!pageResult.ok) throw pageResult.error;
    const threads: Thread[] = [];
    for (const raw of pageResult.value.items) {
      const envelope = readEnvelope(raw);
      if (!envelope) continue;
      threads.push(this.toThread(account.id, channelId, envelope, pageResult.value.uidValidity, pageResult.at));
    }
    const filtered = threads.filter((thread) =>
      (params.status === undefined || params.status.length === 0 || params.status.includes(thread.status)) &&
      (params.priority === undefined || params.priority.length === 0 || params.priority.includes(thread.priority)));
    const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 50)));
    const items = filtered.slice(skip, skip + limit);
    const nextCursor = skip + limit < filtered.length
      ? encodeThreadCursor(page, skip + limit)
      : pageResult.value.items.length >= MAIL_PAGE_SIZE && page < MAIL_MAX_PAGE
        ? encodeThreadCursor(page + 1, 0)
        : null;
    const asOf = toIsoAt(pageResult.at);
    return {
      items,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
      freshness: { state: now - pageResult.at < this.ttlMs ? "fresh" : "stale", asOf },
      sources: [sourceOf("himalaya", asOf)],
    };
  }

  async getThread({ id }: IdParam, call: CallContext): Promise<Single<Thread>> {
    const probes = this.ready();
    let ref = THREAD_ID_PATTERN.test(id) ? this.threads.get(id) : undefined;
    if (!ref) {
      await this.listThreads({}, call);
      ref = this.threads.get(id);
    }
    if (!ref)
      throw new AdapterError({ code: "NOT_FOUND", message: "Unterhaltung nicht gefunden.", retryable: false, details: { id } });
    const message = await this.fetchMessage(probes, ref);
    const asOf = toIsoAt(probes.context.clock.now());
    return {
      data: message ? { ...ref.thread, messages: [message] } : ref.thread,
      freshness: { state: "fresh", asOf },
    };
  }

  private ready(): ProbeSet {
    if (!this.probes)
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Der Adapter ist nicht aktiv.", retryable: false });
    return this.probes;
  }

  private emailChannels(result: ProbeResult<MailList> | undefined, now: number): Channel[] {
    if (!result || !result.ok) {
      const status: ChannelStatus = result ? "offline" : "degraded";
      return [buildChannel("email", "email", "E-Mail Postfach", status, NO_ACCESS, result?.at ?? now, "himalaya")];
    }
    const { accounts, defaultAccountId } = result.value;
    if (accounts.length === 0)
      return [buildChannel("email", "email", "E-Mail Postfach", "not_configured", NO_ACCESS, result.at, "himalaya")];
    return orderAccounts(accounts, defaultAccountId).map((account) => {
      const credentials = hasMailCredentials(account);
      const sendReady = account.authMode === "password"
        ? account.secretState.smtpPassword
        : account.secretState.oauthRefreshToken;
      // send=true is honest: the native mail route exists and always goes through preview + approval.
      return buildChannel(
        `email:${account.id}`,
        "email",
        account.displayName || account.email,
        credentials ? "online" : "not_configured",
        { read: credentials, send: credentials && sendReady },
        result.at,
        "himalaya",
        account.email,
      );
    });
  }

  private messengerChannels(result: ProbeResult<CatalogList> | undefined, now: number): Channel[] {
    const items = result?.ok ? result.value.items : undefined;
    return MESSENGER_CHANNELS.map(({ key, name }) => {
      const at = result?.at ?? now;
      if (items === undefined) {
        const status: ChannelStatus = result === undefined ? "degraded" : "offline";
        return buildChannel(key, key, name, status, NO_ACCESS, at, "hermes");
      }
      const item = items.find((candidate) => candidate.platform === key);
      const status = messengerStatus(item);
      const send = item !== undefined && item.configured && item.exactSendSupported && status !== "offline";
      return buildChannel(key, key, name, status, { read: false, send }, at, "hermes");
    });
  }

  private phoneChannel(result: ProbeResult<TelephonyStatus> | undefined, now: number): Channel {
    let status: ChannelStatus;
    if (result === undefined) status = "degraded";
    else if (!result.ok) status = "offline";
    else if (!result.value.configured) status = "not_configured";
    else if (result.value.ready) status = "online";
    else if (!result.value.ariReachable) status = "offline";
    else status = "degraded";
    return buildChannel("phone", "phone", "Telefon", status, NO_ACCESS, result?.at ?? now, "asterisk");
  }

  private inboxProbe(probes: ProbeSet, accountId: string, page: number, q: string | undefined): CachedProbe<Envelopes> {
    const key = `${accountId}\u0000${page}\u0000${q ?? ""}`;
    const cached = this.inbox.get(key);
    if (cached) return cached;
    const { mailAccounts } = probes.sources;
    const probe = new CachedProbe<Envelopes>(
      () => (q ? mailAccounts.search(accountId, MAILBOX, q, page) : mailAccounts.envelopes(accountId, MAILBOX, page)),
      this.ttlMs,
      () => probes.context.clock.now(),
    );
    if (this.inbox.size >= INBOX_CACHE_LIMIT) this.inbox.clear();
    this.inbox.set(key, probe);
    return probe;
  }

  private toThread(
    accountId: string,
    channelId: string,
    envelope: EnvelopeItem,
    uidValidity: string | null,
    at: number,
  ): Thread {
    const seed = `friday-communication:${accountId}:${MAILBOX}:${uidValidity ?? ""}:${envelope.id}`;
    const parsedDate = Date.parse(envelope.date);
    const timestamp = Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : toIsoAt(at);
    const participant = parseParticipant(envelope.from);
    const thread: Thread = {
      id: createId("thr", seed),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
      source: { ...sourceOf("himalaya", toIsoAt(at)), externalId: `${MAILBOX}/${envelope.id}` },
      channelId,
      channelKind: "email",
      subject: envelope.subject.trim() || "(kein Betreff)",
      participants: participant ? [participant] : [],
      priority: envelope.flags.includes("flagged") ? "P2" : "P3",
      summary: null,
      needsReply: false,
      deadline: null,
      status: envelope.flags.includes("answered") ? "replied" : "open",
      linkedTaskId: null,
      messageCount: 1,
      unreadCount: envelope.flags.includes("seen") ? 0 : 1,
      hasDraft: false,
      draftIds: [],
      extractedEvents: [],
      extractedTasks: [],
      suggestedReply: null,
    };
    // Without uidValidity the uid cannot be addressed again, so the thread is not remembered.
    if (uidValidity !== null) {
      if (this.threads.size >= THREAD_CACHE_LIMIT) this.threads.clear();
      this.threads.set(thread.id, { accountId, mailbox: MAILBOX, uid: envelope.id, uidValidity, thread });
    }
    return thread;
  }

  private async fetchMessage(probes: ProbeSet, ref: ThreadRef): Promise<Message | undefined> {
    // Body fetch is best effort: without it the detail view still shows the header, so a failure or a slow bridge
    // must not fail the whole getThread call. The catch keeps the raced promise from rejecting unhandled.
    const request = probes.sources.mailAccounts
      .message(ref.accountId, ref.mailbox, ref.uid, ref.uidValidity)
      .catch(() => undefined);
    const timer = delay(this.waitMs);
    let raw: Record<string, unknown> | undefined;
    try {
      raw = await Promise.race([request, timer.promise]);
    } finally {
      timer.cancel();
    }
    const bodyText = raw?.bodyText;
    if (typeof bodyText !== "string") return undefined;
    const thread = ref.thread;
    const recipients: Participant[] = [];
    const rawTo = raw?.to;
    if (typeof rawTo === "string") {
      for (const part of rawTo.split(",")) {
        const participant = parseParticipant(part);
        if (participant) recipients.push(participant);
      }
    }
    return {
      id: createId("msg", `friday-communication:${ref.accountId}:${ref.mailbox}:${ref.uidValidity}:${ref.uid}`),
      version: 1,
      createdAt: thread.lastMessageAt,
      updatedAt: thread.lastMessageAt,
      source: thread.source,
      threadId: thread.id,
      direction: "inbound",
      from: thread.participants[0] ?? { name: "Unbekannt", address: "" },
      to: recipients,
      sentAt: thread.lastMessageAt,
      bodyText,
      aiSummary: null,
      attachments: [],
    };
  }
}
