import {
  CONTRACT_VERSION,
  type ActionResult,
  type CommandControlRequest,
  type CommandHistoryEntry,
  type CommandRequest,
  type CommandResponse,
  type Participant,
  type RiskTier,
} from "@friday/sdk";
import { notFound, validationFailed } from "../../core/errors";
import { compareDesc, normalizeText, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

const SENSITIVE = /passwort|kennwort|zugangscode|\bpin\b|\biban\b|token|geheim|kreditkarte/i;

const ROUTES: [RegExp, string][] = [
  [/aufgabe|task/, "/tasks"],
  [/aktivit/, "/activity"],
  [/gedaecht|gedacht|memory|erinnerung/, "/memory"],
  [/agent/, "/agents"],
  [/freigabe|approval/, "/approvals"],
  [/mail|kommunikation|nachricht/, "/communication"],
  [/kalender|termin/, "/calendar"],
  [/automation/, "/automations"],
  [/recherche/, "/research"],
  [/datei|dokument/, "/files"],
  [/sprache|voice|mikrofon/, "/voice"],
  [/alarm|benachrichtigung|alert/, "/alerts"],
  [/system|dienst/, "/system"],
  [/audit|protokoll/, "/audit"],
  [/einstellung|setting/, "/settings"],
  [/uebersicht|start|home/, "/"],
];

interface Intent {
  kind: "stop" | "pause" | "resume" | "navigate" | "memory_search" | "send_message" | "task" | "money" | "forbidden" | "ask" | "voice_start" | "focus_toggle";
  route?: string;
  recipient?: string;
  title?: string;
  amountHint?: string;
  query?: string;
}

const translit = (value: string): string => value.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

/** Text the web client sends for its built-in voice intents (apps/web `useVoiceUi`), plus a few spoken variants. */
export const VOICE_START_COMMAND = "Sprachaufnahme starten";
export const FOCUS_MODE_COMMAND = "Fokus-Modus umschalten";

const words = (value: string): string => translit(value).replace(/[^a-z0-9]+/g, " ").trim();
const VOICE_START_TEXTS = new Set([words(VOICE_START_COMMAND), "starte sprachaufnahme", "sprachaufnahme beginnen"]);
const FOCUS_TOGGLE_TEXTS = new Set([words(FOCUS_MODE_COMMAND), "fokusmodus umschalten", "schalte den fokus modus um"]);

function classify(text: string): Intent {
  const normalized = translit(text).trim();
  const plain = words(text);
  if (VOICE_START_TEXTS.has(plain)) return { kind: "voice_start" };
  if (FOCUS_TOGGLE_TEXTS.has(plain)) return { kind: "focus_toggle" };
  if (/^(loesch|formatier).*(alles|alle daten|festplatte|laufwerk)/.test(normalized) || /rm -rf|drop database/.test(normalized)) return { kind: "forbidden" };
  if (/^(stopp|stop|halt)\b/.test(normalized)) return { kind: "stop" };
  if (/^(pausier|pause)/.test(normalized)) return { kind: "pause" };
  if (/^(setze .*fort|fortsetzen|weiter\b|setz .*fort)/.test(normalized)) return { kind: "resume" };
  // Searches and reads mention payment words ("Suche ... Zahlungsziel") without triggering one: only commands may be money.
  const readOnly = /^(suche|such|finde|zeige|zeig|lies|lese|was|wie|wann|wer|wo|welche[rsmn]?|wieviel|ist|sind|hat|gibt)\b/.test(normalized);
  if (!readOnly && /(ueberweis|bezahl|zahle |zahlung|bestell|kaufe)/.test(normalized)) {
    const amount = /(\d[\d.,]*)\s*(euro|eur|€)/i.exec(text);
    return { kind: "money", title: text.trim(), ...(amount?.[1] ? { amountHint: amount[1] } : {}) };
  }
  if (/(sende|schick|schreib).*(mail|e-mail|nachricht)/.test(normalized)) {
    const recipient = /\ban\s+((?:herrn?|frau|dr\.?)?\s*[\p{L}][\p{L}. -]*?)(?:\s+(?:eine?|dass|und|wegen|zum|zur)\b|[.,!?]|$)/iu.exec(text);
    return { kind: "send_message", recipient: recipient?.[1]?.trim() ?? "den Empfänger" };
  }
  if (/(suche|finde).*(gedaecht|memory|erinnerung)/.test(normalized) || /^(suche|such|finde)\b/.test(normalized)) {
    const query = /(?:nach|zu)\s+(.+)$/i.exec(text)?.[1]?.trim() ?? text;
    return { kind: "memory_search", query };
  }
  if (/^(neue aufgabe|lege .*aufgabe|erstelle .*aufgabe|aufgabe:)/.test(normalized)) {
    const title = /aufgabe(?:\s+an)?\s*[:-]?\s*(.+)$/i.exec(text)?.[1]?.trim();
    return { kind: "task", title: title && title.length > 2 ? title : text.trim() };
  }
  const navigate = /^(oeffne|zeige|zeig|gehe zu|geh zu|wechsle zu)\s+(?:mir\s+)?(?:die\s+|den\s+|das\s+|meine\s+|meinen\s+)?(.+)$/.exec(normalized);
  if (navigate?.[2]) {
    const route = ROUTES.find(([pattern]) => pattern.test(navigate[2] as string))?.[1];
    if (route) return { kind: "navigate", route };
  }
  return { kind: "ask" };
}

export class CommandService {
  constructor(private readonly w: MockWorld) {}

  history(query: Query<"listCommandHistory"> = {}): Page<CommandHistoryEntry> {
    return this.w.read("listCommandHistory", () => pageOf([...this.w.state.commandHistory].sort((a, b) => compareDesc(a.executedAt, b.executedAt) || compareDesc(a.id, b.id)), query));
  }

  /**
   * Write or critical commands first return a preview (`requires_confirmation`); only a confirmed repeat with the
   * `previewId` executes. Risky actions never execute directly: they create an approval.
   */
  execute(request: CommandRequest, ctx?: OpContext): CommandResponse {
    return this.w.run("executeCommand", ctx, request, () => {
      this.w.validate("CommandRequest", request);
      const text = request.text.trim();
      if (!text) throw validationFailed("Der Befehl darf nicht leer sein.", [{ path: "text", message: "leer" }]);
      const correlationId = this.w.correlationId(ctx);
      const intent = classify(text);
      const base = { contractVersion: CONTRACT_VERSION, correlationId } as const;
      const finish = (commandId: string, response: Omit<CommandResponse, "contractVersion" | "commandId" | "correlationId">): CommandResponse => {
        const full: CommandResponse = { ...base, commandId, ...response };
        this.record(commandId, text, request.source, full, correlationId, ctx);
        return full;
      };

      if (request.confirm) {
        const preview = request.previewId ? this.w.state.commandPreviews[request.previewId] : undefined;
        if (!preview || preview.text !== text) {
          throw validationFailed("Die Bestätigung gehört zu keiner gültigen Vorschau.", [{ path: "previewId", message: "unbekannt oder abweichender Befehlstext" }]);
        }
        delete this.w.state.commandPreviews[request.previewId as string];
        return this.executeConfirmed(text, intent, preview.payload.commandId as string, request, correlationId, finish, ctx);
      }

      switch (intent.kind) {
        case "forbidden":
          return finish(this.w.id("cmd"), { status: "rejected", requiresConfirmation: false, previewText: null, riskTier: null, approvalId: null, result: { message: "Diese Aktion ist aus Sicherheitsgründen nicht erlaubt." } });
        case "navigate": {
          return finish(this.w.id("cmd"), { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Ansicht wird geöffnet.", targetRoute: intent.route as string } });
        }
        case "memory_search": {
          const hits = this.w.state.memory.length ? this.safeSearch(intent.query as string) : 0;
          return finish(this.w.id("cmd"), { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: `${hits} Treffer im Gedächtnis.`, targetRoute: `/memory?q=${encodeURIComponent(intent.query as string)}` } });
        }
        case "stop":
        case "pause":
        case "resume": {
          const outcome = this[intent.kind === "stop" ? "stop" : intent.kind === "pause" ? "pause" : "resume"]({ scope: "all", reason: text }, { ...ctx, correlationId });
          return finish(this.w.id("cmd"), { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: outcome.message ?? "Erledigt." } });
        }
        case "voice_start": {
          if (this.w.state.voice.status.focusMode) {
            return finish(this.w.id("cmd"), { status: "rejected", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Der Fokus-Modus ist aktiv. Bitte zuerst den Fokus-Modus beenden." } });
          }
          this.w.voice.setMode("listening");
          return finish(this.w.id("cmd"), { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Sprachaufnahme gestartet.", targetRoute: "/voice" } });
        }
        case "focus_toggle": {
          const enable = !this.w.state.voice.status.focusMode;
          this.control(enable ? "pause" : "resume", { scope: "voice", reason: enable ? "Fokus-Modus" : "Fokus-Modus beendet" }, { ...ctx, correlationId });
          return finish(this.w.id("cmd"), { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: enable ? "Fokus-Modus aktiviert." : "Fokus-Modus beendet." } });
        }
        case "ask": {
          const task = this.createAskTask(text, correlationId, ctx);
          return finish(this.w.id("cmd"), { status: "accepted", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Ich kümmere mich darum.", taskId: task.id, targetRoute: `/tasks?task=${task.id}` } });
        }
        default: {
          const { previewText, tier } = this.previewFor(intent, text);
          const previewId = this.w.id("prev");
          const commandId = this.w.id("cmd");
          this.w.state.commandPreviews[previewId] = { text, origin: request.source, createdAt: this.w.nowIso(), kind: intent.kind, payload: { commandId, ...intent } };
          return { ...base, commandId, status: "requires_confirmation", requiresConfirmation: true, previewText, previewId, riskTier: tier, approvalId: null, result: null };
        }
      }
    });
  }

  stop(request: CommandControlRequest, ctx?: OpContext): ActionResult {
    return this.w.run("stopCommand", ctx, request, () => this.control("stop", request, ctx));
  }

  pause(request: CommandControlRequest, ctx?: OpContext): ActionResult {
    return this.w.run("pauseCommand", ctx, request, () => this.control("pause", request, ctx));
  }

  resume(request: CommandControlRequest, ctx?: OpContext): ActionResult {
    return this.w.run("resumeCommand", ctx, request, () => this.control("resume", request, ctx));
  }

  // ---------------------------------------------------------------- internals

  private previewFor(intent: Intent, text: string): { previewText: string; tier: RiskTier } {
    if (intent.kind === "send_message") return { previewText: `Du bist dabei, eine E-Mail an ${intent.recipient} zu senden.`, tier: 2 };
    if (intent.kind === "money") return { previewText: `Du bist dabei, eine Zahlung oder Bestellung auszulösen: „${intent.title}“.${intent.amountHint ? ` Betrag: ${intent.amountHint} EUR.` : ""}`, tier: 3 };
    return { previewText: `Du bist dabei, eine neue Aufgabe anzulegen: „${intent.title ?? text}“.`, tier: 1 };
  }

  private executeConfirmed(
    text: string,
    intent: Intent,
    commandId: string,
    request: CommandRequest,
    correlationId: string,
    finish: (commandId: string, response: Omit<CommandResponse, "contractVersion" | "commandId" | "correlationId">) => CommandResponse,
    ctx?: OpContext,
  ): CommandResponse {
    if (intent.kind === "task") {
      const task = this.w.tasks.create({ title: (intent.title ?? text).slice(0, 300), priority: "P3" }, { ...ctx, correlationId, idempotencyKey: undefined });
      return finish(commandId, { status: "executed", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Aufgabe wurde angelegt.", taskId: task.id, targetRoute: `/tasks?task=${task.id}` } });
    }
    if (intent.kind === "send_message") {
      const channel = this.w.state.channels.find((candidate) => candidate.kind === "email");
      if (!channel) throw notFound("Kanal", "email");
      const known = this.w.state.threads.flatMap((thread) => thread.participants).find((participant) => normalizeText(participant.name).includes(normalizeText(intent.recipient ?? "")) && participant.role !== "owner");
      const to: Participant[] = [known ? { name: known.name, address: known.address } : { name: intent.recipient ?? "Empfänger", address: "unbekannt@example.invalid" }];
      const draft = this.w.communication.createDraft({ channelId: channel.id, to, subject: `Nachricht von Erik Brandt`, body: `Guten Tag,\n\n${text}\n\nMit freundlichen Grüßen\nErik Brandt` }, { ...ctx, correlationId, idempotencyKey: undefined });
      const approval = this.w.communication.requestSend(draft.id, { comment: `Aus Befehl: „${text}“` }, { ...ctx, correlationId, idempotencyKey: undefined });
      return finish(commandId, { status: "requires_approval", requiresConfirmation: false, previewText: null, riskTier: 2, approvalId: approval.id, result: { message: "Entwurf erstellt. Der Versand wartet auf Ihre Freigabe.", targetRoute: `/approvals?approval=${approval.id}` } });
    }
    if (intent.kind === "money") {
      const approval = this.w.approvals.raise({
        type: /bestell|kaufe/.test(translit(text)) ? "order" : "payment",
        action: text.length > 90 ? `${text.slice(0, 87)}…` : text,
        riskTier: 3,
        rationale: `Aus dem Befehl „${text}“ abgeleitet. Zahlungen und Bestellungen werden nie direkt ausgeführt.`,
        impacts: [{ kind: "money", description: intent.amountHint ? `Betrag: ${intent.amountHint} EUR` : "Finanzielle Auswirkung", severity: "critical" }],
        preview: { kind: "payment", title: "Befehl", body: text },
        editable: false,
        correlationId,
      });
      return finish(commandId, { status: "requires_approval", requiresConfirmation: false, previewText: null, riskTier: 3, approvalId: approval.id, result: { message: "Freigabe mit erneuter Authentifizierung angefordert.", targetRoute: `/approvals?approval=${approval.id}` } });
    }
    const task = this.createAskTask(text, correlationId, ctx);
    return finish(commandId, { status: "accepted", requiresConfirmation: false, previewText: null, riskTier: 1, approvalId: null, result: { message: "Ich kümmere mich darum.", taskId: task.id, targetRoute: `/tasks?task=${task.id}` } });
  }

  private safeSearch(query: string): number {
    try {
      return this.w.memory.search({ query, limit: 50 }).length;
    } catch {
      return 0;
    }
  }

  /** "F.R.I.D.A.Y. fragen": creates a running task for the task agent and lets the orb think briefly. */
  private createAskTask(text: string, correlationId: string, ctx?: OpContext) {
    const agent = this.w.state.agents.find((candidate) => candidate.role.toLowerCase().includes("planung")) ?? this.w.state.agents[0];
    const task = this.w.tasks.spawn({
      title: `Anfrage: ${text.length > 120 ? `${text.slice(0, 117)}…` : text}`,
      description: text,
      status: agent ? "running" : "todo",
      agentId: agent?.id ?? null,
      priority: "P3",
      steps: ["Anfrage verstehen", "Informationen sammeln", "Antwort vorbereiten"],
      correlationId,
    });
    const request = this.w.logActivity({ kind: "user_request", title: `Befehl: ${text.length > 100 ? `${text.slice(0, 97)}…` : text}`, correlationId, taskId: task.id, adapterId: "mock-commands", actor: this.w.actorOf(ctx) });
    this.w.logActivity({ kind: "task", title: `Aufgabe angelegt: ${task.title}`, correlationId, taskId: task.id, parentId: request.id, adapterId: "mock-tasks" });
    this.w.setTransientOrb("thinking", 1_500, "ANALYSE", "Befehl wird verarbeitet");
    return task;
  }

  private record(commandId: string, text: string, origin: CommandRequest["source"], response: CommandResponse, correlationId: string, ctx?: OpContext): void {
    const redacted = SENSITIVE.test(text);
    const now = this.w.nowIso();
    const entry: CommandHistoryEntry = {
      id: commandId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("commands"),
      text: redacted ? "Sensibler Befehl (nicht gespeichert)" : text,
      redacted,
      origin,
      status: response.status,
      riskTier: response.riskTier,
      executedAt: now,
      correlationId,
      repeatable: !redacted && response.status !== "rejected",
    };
    this.w.state.commandHistory.push(entry);
    this.w.recordAudit({
      category: "user_action",
      action: "command.executed",
      correlationId,
      adapterId: "mock-commands",
      actor: this.w.actorOf(ctx),
      result: response.status === "rejected" || response.status === "failed" ? "denied" : "success",
      context: { status: response.status, riskTier: response.riskTier, redacted },
    });
  }

  private actionResult(correlationId: string, message: string, auditId?: string, resourceId?: string): ActionResult {
    return { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed", correlationId, message, ...(auditId ? { auditEventId: auditId } : {}), ...(resourceId ? { resourceId } : {}) };
  }

  /** stop / pause / resume for all, a task, an agent, the voice pipeline or automations. */
  private control(action: "stop" | "pause" | "resume", request: CommandControlRequest, ctx?: OpContext): ActionResult {
    this.w.validate("CommandControlRequest", request);
    const correlationId = this.w.correlationId(ctx);
    const inner: OpContext = { ...ctx, correlationId, idempotencyKey: undefined };
    const state = this.w.state;
    let message: string;
    let resourceId: string | undefined;
    const need = (): string => {
      if (!request.targetId) throw validationFailed(`Für den Bereich ${request.scope} ist eine targetId erforderlich.`, [{ path: "targetId", message: "erforderlich" }]);
      return request.targetId;
    };

    if (request.scope === "task") {
      const id = need();
      resourceId = id;
      if (action === "stop") this.w.tasks.cancel(id, { reason: request.reason }, inner);
      else if (action === "pause") this.w.tasks.pause(id, { reason: request.reason }, inner);
      else this.w.tasks.resume(id, { reason: request.reason }, inner);
      message = `Aufgabe ${action === "stop" ? "abgebrochen" : action === "pause" ? "pausiert" : "fortgesetzt"}.`;
    } else if (request.scope === "agent") {
      const id = need();
      resourceId = id;
      if (action === "stop") this.w.agents.stop(id, inner);
      else if (action === "pause") this.w.agents.pause(id, inner);
      else this.w.agents.resume(id, inner);
      message = `Agent ${action === "stop" ? "gestoppt" : action === "pause" ? "pausiert" : "fortgesetzt"}.`;
    } else if (request.scope === "voice") {
      const status = state.voice.status;
      if (action === "resume") {
        status.focusMode = false;
        this.w.voice.setMode("idle");
        message = "Sprachsteuerung fortgesetzt.";
      } else if (action === "pause") {
        status.focusMode = true;
        this.w.voice.setMode("idle");
        status.microphone = { ...status.microphone, state: "muted", active: false };
        message = "Mikrofon stummgeschaltet.";
      } else if (status.mode === "idle") {
        message = "Es war keine Sprachaktivität aktiv.";
      } else {
        this.w.voice.setMode("idle", { interrupted: status.mode === "speaking" });
        message = "Sprachaktivität gestoppt.";
      }
    } else if (request.scope === "automations") {
      const changed = this.w.automations.setAllPaused(action !== "resume", inner);
      message = action === "resume" ? `${changed} Automationen fortgesetzt.` : `${changed} Automationen pausiert.`;
    } else {
      if (action === "stop") {
        let stopped = 0;
        for (const task of [...state.tasks]) {
          if (task.status === "running" || task.status === "waiting") {
            this.w.tasks.setStatus(task.id, "cancelled", inner, request.reason ?? "Alles gestoppt");
            stopped++;
          }
        }
        for (const agent of state.agents) if (agent.status === "working" || agent.status === "waiting" || agent.status === "paused") this.w.agents.setStatus(agent.id, "idle");
        if (state.voice.status.mode !== "idle") this.w.voice.setMode("idle", { interrupted: state.voice.status.mode === "speaking" });
        state.globalPaused = false;
        message = `${stopped} Aufgaben gestoppt, alle Agenten sind bereit.`;
      } else if (action === "pause") {
        let paused = 0;
        for (const task of state.tasks) {
          if (task.status === "running") {
            task.status = "waiting";
            task.blockers.push({ id: this.w.id("blk"), kind: "other", description: "Vom Benutzer pausiert", since: this.w.nowIso() });
            this.w.bump(task);
            this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`, correlationId);
            paused++;
          }
        }
        for (const agent of state.agents) if (agent.status === "working" || agent.status === "idle" || agent.status === "waiting") this.w.agents.setStatus(agent.id, "paused", { taskId: agent.currentTaskId });
        this.w.automations.setAllPaused(true, inner);
        state.globalPaused = true;
        message = `${paused} Aufgaben pausiert; Agenten und Automationen angehalten.`;
      } else {
        let resumed = 0;
        for (const task of state.tasks) {
          if (task.status === "waiting" && task.blockers.some((blocker) => blocker.description === "Vom Benutzer pausiert")) {
            task.blockers = task.blockers.filter((blocker) => blocker.description !== "Vom Benutzer pausiert");
            task.status = "running";
            this.w.bump(task);
            this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`, correlationId);
            resumed++;
          }
        }
        for (const agent of state.agents) if (agent.status === "paused") this.w.agents.setStatus(agent.id, agent.currentTaskId ? "working" : "idle");
        this.w.automations.setAllPaused(false, inner);
        state.globalPaused = false;
        message = `${resumed} Aufgaben fortgesetzt.`;
      }
    }
    const audit = this.w.recordAudit({
      category: "user_action",
      action: `command.${action}`,
      severity: "warning",
      correlationId,
      adapterId: "mock-commands",
      actor: this.w.actorOf(ctx),
      context: { scope: request.scope, ...(request.targetId ? { targetId: request.targetId } : {}), ...(request.reason ? { reason: request.reason } : {}) },
    });
    this.w.refresh();
    return this.actionResult(correlationId, message, audit.id, resourceId);
  }
}

