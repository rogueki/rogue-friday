import type {
  JarvisEvent,
  OrbMode,
  Scenario,
  ScenarioControlRequest,
  ScenarioState,
} from "@jarvis/sdk";
import type { TimerHandle } from "../core/clock";
import { MockApiError, notFound, validationFailed } from "../core/errors";
import { clone } from "../core/util";
import type { MockWorld } from "../world/world";
import { SCENARIO_DEFINITIONS, scenarioDuration } from "./definitions";
import { AUDIO_INTERVAL_MS, audioFixtureSample } from "./fixtures";
import type { ScenarioAction, ScenarioDefinition } from "./types";

export interface PlayOptions {
  /** Playback speed multiplier (2 = twice as fast). Scales step offsets and action durations. */
  speed?: number;
  /** Restore the scenario's baseline first (default true). */
  reset?: boolean;
}

export type ScenarioEngineEvent =
  | { type: "started"; scenarioId: string; speed: number }
  | { type: "step"; scenarioId: string; index: number; label: string; at: number }
  | { type: "completed"; scenarioId: string; orbModes: OrbMode[] }
  | { type: "stopped"; scenarioId: string | null }
  | { type: "reset" };

const engines = new WeakMap<MockWorld, ScenarioEngine>();

/**
 * Plays declarative scenario timelines on the world's MockClock and exposes the dev controls of the scenario
 * console (clock, latency, errors, adapter availability, capabilities, raw events, forced orb state).
 */
export class ScenarioEngine {
  private activeId: string | null = null;
  private running = false;
  private stepIndex = -1;
  private speed = 1;
  private timers: TimerHandle[] = [];
  private refs = new Map<string, string>();
  private capabilityOverrides: ScenarioState["capabilityOverrides"] = [];
  private orbLog: OrbMode[] = [];
  private unsubscribeOrb: (() => void) | null = null;
  private listeners = new Set<(event: ScenarioEngineEvent) => void>();

  /** One engine per world, so HTTP handlers and the console share state. */
  static for(world: MockWorld): ScenarioEngine {
    let engine = engines.get(world);
    if (!engine) {
      engine = new ScenarioEngine(world);
      engines.set(world, engine);
    }
    return engine;
  }

  constructor(
    private readonly world: MockWorld,
    private readonly definitions: ScenarioDefinition[] = SCENARIO_DEFINITIONS,
  ) {}

  subscribe(listener: (event: ScenarioEngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------- catalog

  getDefinition(id: string): ScenarioDefinition {
    const definition = this.definitions.find((candidate) => candidate.id === id);
    if (!definition) throw notFound("Szenario", id);
    return definition;
  }

  listDefinitions(): ScenarioDefinition[] {
    return this.definitions;
  }

  /** Contract `Scenario` objects (steps carry the delay relative to the previous step). */
  list(): Scenario[] {
    return this.definitions.map((definition) => this.toContract(definition));
  }

  get(id: string): Scenario {
    return this.toContract(this.getDefinition(id));
  }

  private toContract(definition: ScenarioDefinition): Scenario {
    let previous = 0;
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      steps: definition.steps.map((step, index) => {
        const delayMs = step.at - previous;
        previous = step.at;
        return {
          index,
          label: step.label,
          delayMs,
          ...(step.orbMode ? { orbMode: step.orbMode } : {}),
          ...(step.description ? { description: step.description } : {}),
        };
      }),
    };
  }

  // ---------------------------------------------------------------- playback

  /**
   * Loads the scenario's profile/baseline and schedules all steps on the mock clock. With a stopped clock the caller
   * drives time via `advanceClock`; in real-time mode the steps run on their own.
   */
  play(id: string, options: PlayOptions = {}): ScenarioState {
    const definition = this.getDefinition(id);
    const speed = options.speed ?? 1;
    if (!(speed > 0)) throw validationFailed("speed muss größer als 0 sein.", [{ path: "speed", message: "> 0" }]);
    this.stop(false);
    if (options.reset !== false) {
      if (this.world.profile !== definition.profile) this.world.loadProfile(definition.profile);
      else this.world.reset();
      this.refs.clear();
      this.capabilityOverrides = [];
      if (definition.baseline === "quiet") this.world.quiesce();
    }
    this.activeId = id;
    this.running = true;
    this.stepIndex = -1;
    this.speed = speed;
    this.world.state.uiHints.forceOrbFallback2D = false;
    this.world.state.uiHints.reducedMotion = false;
    if (definition.uiHints) {
      for (const [key, value] of Object.entries(definition.uiHints)) this.world.state.uiHints[key] = value;
    }
    this.orbLog = [this.world.orbSnapshot().status.mode];
    this.unsubscribeOrb?.();
    this.unsubscribeOrb = this.world.events.subscribe((event: JarvisEvent) => {
      if (event.type !== "jarvis.orb.status_changed") return;
      const mode = event.data.status.mode;
      if (this.orbLog[this.orbLog.length - 1] !== mode) this.orbLog.push(mode);
    });
    this.emit({ type: "started", scenarioId: id, speed });

    const scale = 1 / speed;
    definition.steps.forEach((step, index) => {
      this.timers.push(
        this.world.clock.setTimeout(() => {
          this.stepIndex = index;
          this.emit({ type: "step", scenarioId: id, index, label: step.label, at: step.at });
          for (const action of step.actions) this.execute(action, scale);
        }, step.at * scale),
      );
    });
    this.timers.push(
      this.world.clock.setTimeout(() => {
        this.running = false;
        this.emit({ type: "completed", scenarioId: id, orbModes: [...this.orbLog] });
      }, scenarioDuration(definition) * scale + 1),
    );
    return this.getState();
  }

  /** Cancels scheduled steps; the world state stays as it is. */
  stop(announce = true): ScenarioState {
    for (const timer of this.timers) timer.cancel();
    this.timers = [];
    const wasActive = this.activeId;
    this.running = false;
    if (announce && wasActive) this.emit({ type: "stopped", scenarioId: wasActive });
    return this.getState();
  }

  /** Stops playback and restores the world baseline (snapshot restore); overrides are cleared. */
  reset(): ScenarioState {
    this.stop(false);
    this.world.reset();
    this.refs.clear();
    this.capabilityOverrides = [];
    this.activeId = null;
    this.stepIndex = -1;
    this.orbLog = [];
    this.emit({ type: "reset" });
    return this.getState();
  }

  /** Orb modes seen since the scenario started (consecutive duplicates collapsed). */
  get orbModeLog(): OrbMode[] {
    return [...this.orbLog];
  }

  get isRunning(): boolean {
    return this.running;
  }

  advanceClock(ms: number): ScenarioState {
    if (!Number.isFinite(ms) || ms < 0) throw validationFailed("ms muss >= 0 sein.", [{ path: "ms", message: ">= 0" }]);
    this.world.clock.advance(ms);
    return this.getState();
  }

  /** Runs the clock until the active scenario has finished (tests, CLI `--fast`). */
  runToCompletion(maxMs = 600_000): ScenarioState {
    const step = 250;
    let elapsed = 0;
    while (this.running && elapsed < maxMs) {
      this.world.clock.advance(step);
      elapsed += step;
    }
    return this.getState();
  }

  // ---------------------------------------------------------------- dev controls

  setLatency(ms: number, adapterId?: string): ScenarioState {
    this.world.setLatency(ms, adapterId);
    return this.getState();
  }

  setErrorRate(rate: number, adapterId?: string): ScenarioState {
    this.world.setErrorRate(rate, adapterId);
    return this.getState();
  }

  setAdapterState(target: string, mode: Parameters<MockWorld["setAdapterState"]>[1], reason?: string): ScenarioState {
    this.world.setAdapterState(target, mode, reason ? { reason } : {});
    return this.getState();
  }

  setCapability(module: string, capability: string, enabled: boolean): ScenarioState {
    this.world.setCapability(module, capability, enabled);
    this.capabilityOverrides = this.capabilityOverrides.filter((entry) => !(entry.module === module && entry.capability === capability));
    this.capabilityOverrides.push({ module, capability, enabled });
    return this.getState();
  }

  emitEvent(raw: { type: string; subject?: string; data: unknown }): JarvisEvent {
    return this.world.emitRaw(raw);
  }

  forceOrbState(mode: OrbMode | null, extras: { activityText?: string; audioLevel?: number; progress?: number | null } = {}): ScenarioState {
    this.world.forceOrbState(mode, extras);
    return this.getState();
  }

  /**
   * Plays one event of the AsyncAPI list on the event stream. The payload is validated against the event's schema; without a
   * payload, event types that mirror world state (orb, overall status, system metrics, voice state, resync) use the current
   * state, every other type needs an explicit payload.
   */
  playEvent(eventType: string, payload?: unknown, subject?: string): ScenarioState {
    const data = payload !== undefined ? payload : this.stateSample(eventType);
    if (data === undefined) {
      throw validationFailed(`Für ${eventType} ist ein Payload erforderlich.`, [{ path: "payload", message: "erforderlich" }]);
    }
    this.emitEvent({ type: eventType, data, ...(subject ? { subject } : {}) });
    return this.getState();
  }

  private stateSample(eventType: string): unknown {
    const w = this.world;
    switch (eventType) {
      case "jarvis.orb.status_changed":
        return w.orbSnapshot();
      case "jarvis.status.changed":
        return w.jarvisStatus();
      case "jarvis.system.metrics":
        return w.currentMetrics();
      case "jarvis.voice.state_changed":
        return clone(w.state.voice.status);
      case "jarvis.status.resync_required":
        return { reason: "unknown", requestedSince: null, oldestAvailableSequence: null, latestSequence: Math.max(0, w.peekSequence() - 1) };
      default:
        return undefined;
    }
  }

  /** Applies a contract `ScenarioControlRequest` (POST /dev/scenarios/control). */
  control(request: ScenarioControlRequest): ScenarioState {
    switch (request.action) {
      case "clock_advance":
        return this.advanceClock(request.ms);
      case "adapter_offline":
        return this.setAdapterState(request.adapterId, request.offline ? "offline" : "online");
      case "latency":
        return this.setLatency(request.ms, request.adapterId);
      case "error_rate":
        return this.setErrorRate(request.rate, request.adapterId);
      case "capability_toggle":
        return this.setCapability(request.module, request.capability, request.enabled);
      case "force_orb_state":
        return this.forceOrbState(request.mode, {
          ...(request.activityText !== undefined ? { activityText: request.activityText } : {}),
          ...(request.audioLevel !== undefined ? { audioLevel: request.audioLevel } : {}),
          ...(request.progress !== undefined ? { progress: request.progress } : {}),
        });
      case "release_orb_state":
        return this.forceOrbState(null);
      case "play_event":
        return this.playEvent(request.eventType, request.payload, request.subject);
      case "reset":
        return this.reset();
      default:
        throw new MockApiError({ code: "VALIDATION_FAILED", message: "Unbekannte Steuerungsaktion." });
    }
  }

  getState(): ScenarioState {
    const world = this.world;
    const overrides: ScenarioState["adapterOverrides"] = [];
    for (const adapter of world.state.adapters) {
      const offline = adapter.mode === "offline";
      if (!offline && adapter.latencyOverrideMs === null && adapter.errorRateOverride === null) continue;
      overrides.push({
        adapterId: adapter.manifest.id,
        offline,
        ...(adapter.latencyOverrideMs !== null ? { latencyMs: adapter.latencyOverrideMs } : {}),
        ...(adapter.errorRateOverride !== null ? { errorRate: adapter.errorRateOverride } : {}),
      });
    }
    return {
      activeScenarioId: this.activeId,
      running: this.running,
      stepIndex: Math.max(0, this.stepIndex),
      seed: world.seed,
      simulatedTime: world.nowIso(),
      clockOffsetMs: world.clock.offsetMs,
      adapterOverrides: overrides,
      capabilityOverrides: clone(this.capabilityOverrides),
      forcedOrbMode: world.state.forcedOrb?.mode ?? null,
    };
  }

  // ---------------------------------------------------------------- action execution

  private emit(event: ScenarioEngineEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private ref(name: string): string {
    const id = this.refs.get(name);
    if (!id) throw new MockApiError({ code: "INTERNAL", message: `Szenario-Referenz ${name} ist unbekannt.` });
    return id;
  }

  private agentId(name: string): string {
    const agent = this.world.state.agents.find((candidate) => candidate.name === name);
    if (!agent) throw notFound("Agent", name);
    return agent.id;
  }

  private execute(action: ScenarioAction, scale: number): void {
    const w = this.world;
    switch (action.kind) {
      case "world.quiesce":
        w.quiesce();
        break;
      case "orb.force":
        w.forceOrbState(action.mode, {
          ...(action.activityText !== undefined ? { activityText: action.activityText } : {}),
          ...(action.audioLevel !== undefined ? { audioLevel: action.audioLevel } : {}),
          ...(action.progress !== undefined ? { progress: action.progress } : {}),
        });
        break;
      case "orb.transient":
        w.setTransientOrb(action.mode, action.durationMs * scale, action.text, action.detail);
        break;
      case "voice.mode":
        w.voice.setMode(action.mode, action.text ? { text: action.text } : {});
        break;
      case "voice.audio":
        this.streamAudio(action, scale);
        break;
      case "voice.transcript":
        w.voice.emitTranscript(action.text, action.final);
        break;
      case "agent.status":
        w.agents.setStatus(this.agentId(action.agent), action.status, {
          ...(action.task ? { taskId: this.ref(action.task) } : {}),
          ...(action.error ? { error: action.error } : {}),
        });
        break;
      case "task.spawn": {
        const task = w.tasks.spawn({
          title: action.title,
          status: action.status ?? (action.agent ? "running" : "todo"),
          ...(action.priority ? { priority: action.priority } : {}),
          ...(action.agent ? { agentId: this.agentId(action.agent) } : {}),
          ...(action.progress !== undefined && action.progress !== null ? { progress: { mode: "determinate" as const, value: action.progress } } : {}),
          ...(action.steps ? { steps: action.steps } : {}),
        });
        this.refs.set(action.ref, task.id);
        break;
      }
      case "task.progress":
        w.tasks.setProgress(this.ref(action.ref), action.value, action.message);
        break;
      case "task.complete":
        w.tasks.complete(this.ref(action.ref));
        break;
      case "task.fail":
        w.tasks.fail(this.ref(action.ref), { code: "INTERNAL", message: action.message });
        break;
      case "sync.start":
        this.refs.set(action.ref, w.startSync(action.source, action.label));
        break;
      case "sync.finish":
        w.finishSync(this.ref(action.ref));
        break;
      case "approval.draft": {
        const thread = w.state.threads.find((candidate) => candidate.id === this.threadIdFor(action.threadKey));
        const channel = w.state.channels.find((candidate) => candidate.kind === "email");
        if (!thread || !channel) throw notFound("Thread", action.threadKey);
        const actor = action.agent ? ({ type: "agent", id: this.agentId(action.agent), name: action.agent } as const) : undefined;
        const recipient = thread.participants.find((participant) => participant.role !== "owner") ?? thread.participants[0];
        const draft = w.communication.createDraft(
          {
            channelId: channel.id,
            threadId: thread.id,
            to: recipient ? [{ name: recipient.name, address: recipient.address }] : [],
            subject: `Re: ${thread.subject}`,
            body: `Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihre Nachricht. Gerne bestätige ich den vorgeschlagenen Termin.\n\nMit freundlichen Grüßen\nErik Brandt`,
          },
          actor ? { actor } : {},
        );
        const approval = w.communication.requestSend(draft.id, { comment: "Antwortentwurf vom Kommunikations-Agent" }, actor ? { actor } : {});
        this.refs.set(action.ref, approval.id);
        break;
      }
      case "approval.raise": {
        const approval = w.approvals.raise({
          type: action.type,
          action: action.action,
          riskTier: action.riskTier,
          ...(action.agent ? { agentId: this.agentId(action.agent) } : {}),
          rationale: action.rationale,
          preview: { kind: "text", title: action.previewTitle, body: action.previewBody },
        });
        this.refs.set(action.ref, approval.id);
        break;
      }
      case "notification.raise": {
        const notification = w.notifications.raise({
          priority: action.priority,
          category: action.category,
          title: action.title,
          body: action.body,
          ...(action.chain ? { chain: action.chain } : {}),
          ...(action.stepSeconds ? { stepSeconds: action.stepSeconds.map((seconds) => seconds * scale) } : {}),
        });
        this.refs.set(action.ref, notification.id);
        break;
      }
      case "notification.ack":
        w.notifications.acknowledge(this.ref(action.ref));
        break;
      case "adapter.state":
        w.setAdapterState(action.category, action.mode, action.reason ? { reason: action.reason } : {});
        break;
      case "service.status":
        w.system.setServiceStatus(action.name, action.status, action.detail);
        break;
      case "ui.hint":
        w.setUiHint(action.key, action.value);
        break;
      case "mail.receive": {
        const channel = w.state.channels.find((candidate) => candidate.kind === "email");
        if (!channel) throw notFound("Kanal", "email");
        w.communication.receive({
          channelId: channel.id,
          subject: action.subject,
          from: { name: action.from.name, address: action.from.address, role: "Kontakt" },
          body: action.body,
          ...(action.priority ? { priority: action.priority } : {}),
          ...(action.summary ? { summary: action.summary } : {}),
        });
        break;
      }
      case "activity.log":
        w.logActivity({
          kind: action.activityKind ?? "system",
          title: action.title,
          correlationId: w.correlationId(),
          adapterId: action.adapterId ?? "mock-activity",
          severity: action.severity ?? "info",
          status: "info",
        });
        break;
      case "activity.burst":
        this.burst(action, scale);
        break;
      case "system.metrics":
        w.system.publishMetrics();
        break;
      case "event.emit":
        w.emitRaw({ type: action.type, data: action.data, ...(action.subject ? { subject: action.subject } : {}) });
        break;
    }
  }

  private threadIdFor(key: "becker" | "albrecht"): string {
    const wanted = key === "becker" ? "Terminbestätigung" : "Steuererklärung";
    return this.world.state.threads.find((thread) => thread.subject.includes(wanted))?.id ?? "";
  }

  private streamAudio(action: Extract<ScenarioAction, { kind: "voice.audio" }>, scale: number): void {
    const duration = action.durationMs * scale;
    let elapsed = 0;
    const emit = (): void => {
      const sample = audioFixtureSample(action.fixture, elapsed / scale, action.durationMs);
      this.world.voice.emitAudioLevel(sample.level, action.direction, sample.peak);
    };
    emit();
    const handle = this.world.clock.setInterval(() => {
      elapsed += AUDIO_INTERVAL_MS;
      if (elapsed >= duration) {
        handle.cancel();
        return;
      }
      emit();
    }, AUDIO_INTERVAL_MS);
    this.timers.push(handle);
  }

  private burst(action: Extract<ScenarioAction, { kind: "activity.burst" }>, scale: number): void {
    let count = 0;
    const handle = this.world.clock.setInterval(() => {
      count++;
      this.world.logActivity({
        kind: "system",
        title: `${action.title} ${count}/${action.count}`,
        correlationId: this.world.correlationId(),
        adapterId: "mock-activity",
        status: "info",
      });
      if (count >= action.count) handle.cancel();
    }, Math.max(1, action.intervalMs * scale));
    this.timers.push(handle);
  }
}
