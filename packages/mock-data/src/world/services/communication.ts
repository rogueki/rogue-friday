import type {
  Approval,
  Channel,
  Draft,
  DraftCreateRequest,
  DraftSendRequest,
  DraftUpdateRequest,
  Message,
  Participant,
  Priority,
  Thread,
} from "@friday/sdk";
import { MockApiError, conflict, notFound } from "../../core/errors";
import { asBool, asList, clone, compareDesc, matchesQuery, priorityRank, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { checkEnum, pageOf, PRIORITIES, THREAD_STATUSES, type Query } from "./shared";

export type ThreadListQuery = Query<"listThreads">;
export type ChannelListQuery = Query<"listChannels">;
export type DraftListQuery = Query<"listDrafts">;

const DRAFT_STATUSES = ["draft", "pending_approval", "approved", "sent", "failed", "discarded"] as const;

const OWNER_ADDRESS: Participant = { name: "Erik Brandt", address: "erik.brandt@gmx.example", role: "owner" };

export class CommunicationService {
  constructor(private readonly w: MockWorld) {}

  findThread(id: string): Thread {
    const thread = this.w.state.threads.find((candidate) => candidate.id === id);
    if (!thread) throw notFound("Thread", id);
    return thread;
  }

  findDraft(id: string): Draft {
    const draft = this.w.state.drafts.find((candidate) => candidate.id === id);
    if (!draft) throw notFound("Entwurf", id);
    return draft;
  }

  findChannel(id: string): Channel {
    const channel = this.w.state.channels.find((candidate) => candidate.id === id);
    if (!channel) throw notFound("Kanal", id);
    return channel;
  }

  listChannels(query: ChannelListQuery = {}): Page<Channel> {
    return this.w.read("listChannels", () => pageOf(this.w.state.channels, query));
  }

  listThreads(query: ThreadListQuery = {}): Page<Thread> {
    return this.w.read("listThreads", () => {
      const statuses = asList(query.status);
      const priorities = asList(query.priority);
      checkEnum("status", statuses, THREAD_STATUSES);
      checkEnum("priority", priorities, PRIORITIES);
      const needsReply = asBool(query.needsReply);
      const hasDraft = asBool(query.hasDraft);
      const items = this.w.state.threads
        .filter((thread) => {
          if (query.channelId && thread.channelId !== query.channelId) return false;
          if (statuses.length && !statuses.includes(thread.status)) return false;
          if (priorities.length && !priorities.includes(thread.priority)) return false;
          if (needsReply !== undefined && thread.needsReply !== needsReply) return false;
          if (hasDraft !== undefined && thread.hasDraft !== hasDraft) return false;
          return matchesQuery(`${thread.subject} ${thread.summary ?? ""} ${thread.participants.map((p) => p.name).join(" ")}`, query.q);
        })
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || compareDesc(a.lastMessageAt, b.lastMessageAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  /** Thread detail including its messages (oldest first). */
  getThread(id: string): Thread {
    return this.w.read("getThread", () => {
      const thread = clone(this.findThread(id));
      thread.messages = clone(this.w.state.messages.filter((message) => message.threadId === id).sort((a, b) => a.sentAt.localeCompare(b.sentAt)));
      return thread;
    });
  }

  /** Drafts, newest change first; optionally only those of one thread or in the given states. */
  listDrafts(query: DraftListQuery = {}): Page<Draft> {
    return this.w.read("listDrafts", () => {
      const statuses = asList(query.status);
      checkEnum("status", statuses, DRAFT_STATUSES);
      const items = this.w.state.drafts
        .filter((draft) => (query.threadId ? draft.threadId === query.threadId : true))
        .filter((draft) => (statuses.length ? statuses.includes(draft.status) : true))
        .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  createDraft(body: DraftCreateRequest, ctx?: OpContext): Draft {
    return this.w.run("createDraft", ctx, body, () => {
      this.w.validate("DraftCreateRequest", body);
      const channel = this.findChannel(body.channelId);
      if (!channel.capabilities.draft) throw this.capabilityMissing(`Der Kanal ${channel.name} unterstützt keine Entwürfe.`, channel);
      const thread = body.threadId ? this.findThread(body.threadId) : null;
      const now = this.w.nowIso();
      const actor = this.w.actorOf(ctx);
      const draft: Draft = {
        id: this.w.id("draft"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("communication"),
        channelId: channel.id,
        threadId: thread?.id ?? null,
        to: body.to,
        ...(body.cc ? { cc: body.cc } : {}),
        subject: body.subject,
        body: body.body,
        status: "draft",
        approvalId: null,
        generatedByAgentId: actor.type === "agent" ? actor.id : null,
        ...(body.replyToMessageId ? { replyToMessageId: body.replyToMessageId } : {}),
      };
      this.w.state.drafts.push(draft);
      if (thread) this.linkDraft(thread, draft.id);
      const correlationId = this.w.correlationId(ctx);
      this.w.emitFor("communication", "friday.communication.draft_updated", draft, `draft/${draft.id}`, correlationId);
      this.w.recordAudit({ category: actor.type === "agent" ? "agent_action" : "user_action", action: "draft.created", correlationId, adapterId: "mock-communication", actor, after: { channel: channel.kind, subject: draft.subject } });
      return clone(draft);
    });
  }

  updateDraft(id: string, body: DraftUpdateRequest, ctx?: OpContext): Draft {
    return this.w.run("updateDraft", ctx, { id, body }, () => {
      this.w.validate("DraftUpdateRequest", body);
      const draft = this.findDraft(id);
      this.w.assertVersion(draft, ctx, "Entwurf");
      if (draft.status !== "draft") throw conflict(`Der Entwurf kann im Status ${draft.status} nicht geändert werden.`, { status: draft.status });
      if (body.to) draft.to = body.to;
      if (body.cc) draft.cc = body.cc;
      if (body.subject !== undefined) draft.subject = body.subject;
      if (body.body !== undefined) draft.body = body.body;
      if (body.status) draft.status = body.status;
      this.w.bump(draft);
      const correlationId = this.w.correlationId(ctx);
      this.w.emitFor("communication", "friday.communication.draft_updated", draft, `draft/${draft.id}`, correlationId);
      if (draft.status === "discarded" && draft.threadId) this.unlinkDraft(this.findThread(draft.threadId), draft.id);
      this.w.recordAudit({ category: "user_action", action: draft.status === "discarded" ? "draft.discarded" : "draft.updated", correlationId, adapterId: "mock-communication", actor: this.w.actorOf(ctx), after: { status: draft.status } });
      return clone(draft);
    });
  }

  /** Creates the send approval. Nothing is sent until the approval is approved (PLAN §33.5). */
  requestSend(id: string, body: DraftSendRequest = {}, ctx?: OpContext): Approval {
    return this.w.run("requestDraftSend", ctx, { id, body }, () => {
      this.w.validate("DraftSendRequest", body);
      const draft = this.findDraft(id);
      this.w.assertVersion(draft, ctx, "Entwurf");
      if (draft.status !== "draft") throw conflict(`Der Entwurf wartet bereits auf Freigabe oder wurde verarbeitet (${draft.status}).`, { status: draft.status });
      const channel = this.findChannel(draft.channelId);
      if (!channel.capabilities.send) throw this.capabilityMissing(`Über ${channel.name} kann nicht gesendet werden (${channel.status}).`, channel);
      const thread = draft.threadId ? this.w.state.threads.find((candidate) => candidate.id === draft.threadId) : undefined;
      const email = channel.kind === "email";
      const recipients = draft.to.map((person) => `${person.name} <${person.address}>`).join(", ");
      const approval = this.w.approvals.raise({
        type: email ? "send_email" : "send_message",
        action: email ? `E-Mail an ${draft.to[0]?.name ?? "Empfänger"} senden` : `Nachricht an ${draft.to[0]?.name ?? "Empfänger"} senden`,
        riskTier: 2,
        agentId: draft.generatedByAgentId,
        taskId: thread?.linkedTaskId ?? null,
        rationale: body.comment ?? `Der Entwurf „${draft.subject}“ liegt vor. Versand erfolgt erst nach Ihrer Freigabe.`,
        impacts: [{ kind: "communication", description: "Externe Person erhält die Nachricht im Namen von Erik Brandt.", severity: "warning" }],
        preview: {
          kind: email ? "email" : "message",
          title: draft.subject,
          body: draft.body,
          fields: [
            { label: "An", value: recipients },
            { label: "Kanal", value: channel.name },
            { label: "Betreff", value: draft.subject },
          ],
        },
        sourceRef: { type: "draft", id: draft.id, label: draft.subject },
        editable: true,
        ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}),
      });
      draft.status = "pending_approval";
      draft.approvalId = approval.id;
      this.w.bump(draft);
      this.w.emitFor("communication", "friday.communication.draft_updated", draft, `draft/${draft.id}`, approval.correlationId);
      return clone(approval);
    });
  }

  // ---- approval hooks ----

  applyEditedPreview(approval: Approval): void {
    if (approval.sourceRef?.type !== "draft") return;
    const draft = this.w.state.drafts.find((candidate) => candidate.id === approval.sourceRef?.id);
    if (!draft) return;
    draft.body = approval.preview.body;
    draft.subject = approval.preview.title;
    this.w.bump(draft);
  }

  executeSend(approval: Approval): string {
    const draft = this.w.state.drafts.find((candidate) => candidate.approvalId === approval.id);
    if (!draft) return EXECUTION_FALLBACK[approval.type === "send_email" ? 0 : 1] as string;
    const now = this.w.nowIso();
    draft.status = "sent";
    this.w.bump(draft);
    this.w.emitFor("communication", "friday.communication.draft_updated", draft, `draft/${draft.id}`, approval.correlationId);
    if (draft.threadId) {
      const thread = this.findThread(draft.threadId);
      const message: Message = {
        id: this.w.id("msg"),
        version: 1,
        createdAt: now,
        updatedAt: now,
        source: this.w.source("communication"),
        threadId: thread.id,
        direction: "outbound",
        from: OWNER_ADDRESS,
        to: draft.to,
        ...(draft.cc ? { cc: draft.cc } : {}),
        sentAt: now,
        bodyText: draft.body,
        aiSummary: null,
        attachments: [],
      };
      this.w.state.messages.push(message);
      thread.messageCount += 1;
      thread.lastMessageAt = now;
      thread.needsReply = false;
      thread.status = "replied";
      thread.suggestedReply = null;
      this.unlinkDraft(thread, draft.id);
    }
    const names = draft.to.map((person) => person.name).join(", ");
    return `Nachricht „${draft.subject}“ wurde an ${names} gesendet.`;
  }

  onApprovalClosed(approval: Approval, outcome: "rejected" | "expired" | "cancelled" | "failed"): void {
    const draft = this.w.state.drafts.find((candidate) => candidate.approvalId === approval.id);
    if (!draft) return;
    if (outcome === "failed") {
      draft.status = "failed";
    } else {
      draft.status = "draft";
      draft.approvalId = null;
    }
    this.w.bump(draft);
    this.w.emitFor("communication", "friday.communication.draft_updated", draft, `draft/${draft.id}`, approval.correlationId);
  }

  /** Simulates an incoming message (scenario hook): creates a thread with one inbound message. */
  receive(input: { channelId: string; subject: string; from: Participant; body: string; priority?: Priority; summary?: string }): Thread {
    const channel = this.findChannel(input.channelId);
    const now = this.w.nowIso();
    const threadId = this.w.id("thr");
    const message: Message = {
      id: this.w.id("msg"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("communication"),
      threadId,
      direction: "inbound",
      from: input.from,
      to: [OWNER_ADDRESS],
      sentAt: now,
      bodyText: input.body,
      aiSummary: input.summary ?? null,
      attachments: [],
    };
    const thread: Thread = {
      id: threadId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("communication"),
      channelId: channel.id,
      channelKind: channel.kind,
      subject: input.subject,
      participants: [OWNER_ADDRESS, input.from],
      priority: input.priority ?? "P2",
      summary: input.summary ?? null,
      needsReply: true,
      deadline: null,
      status: "open",
      linkedTaskId: null,
      lastMessageAt: now,
      messageCount: 1,
      unreadCount: 1,
      hasDraft: false,
      draftIds: [],
      extractedEvents: [],
      extractedTasks: [],
      suggestedReply: null,
    };
    this.w.state.messages.push(message);
    this.w.state.threads.push(thread);
    channel.unreadCount += 1;
    channel.lastSyncAt = now;
    this.w.bump(channel);
    this.w.emitFor("communication", "friday.communication.thread_updated", thread, `thread/${thread.id}`);
    this.w.refresh();
    return thread;
  }

  private linkDraft(thread: Thread, draftId: string): void {
    if (!thread.draftIds.includes(draftId)) thread.draftIds.push(draftId);
    thread.hasDraft = thread.draftIds.length > 0;
    this.w.bump(thread);
    this.w.emitFor("communication", "friday.communication.thread_updated", thread, `thread/${thread.id}`);
  }

  private unlinkDraft(thread: Thread, draftId: string): void {
    thread.draftIds = thread.draftIds.filter((candidate) => candidate !== draftId);
    thread.hasDraft = thread.draftIds.length > 0;
    this.w.bump(thread);
    this.w.emitFor("communication", "friday.communication.thread_updated", thread, `thread/${thread.id}`);
  }

  private capabilityMissing(message: string, channel: Channel): MockApiError {
    return new MockApiError({ code: "CAPABILITY_MISSING", message, details: { channelId: channel.id, channelStatus: channel.status } });
  }
}

const EXECUTION_FALLBACK = ["E-Mail wurde versendet.", "Nachricht wurde versendet."];
