import {
  CONTRACT_VERSION,
  type ActionResult,
  type VoiceDevice,
  type VoiceEnrollRequest,
  type VoiceEnrollment,
  type VoiceMetrics,
  type VoiceProfile,
  type VoiceStatus,
  type VoiceTestRequest,
  type VoiceTestResult,
} from "@friday/sdk";
import { conflict, notFound, validationFailed } from "../../core/errors";
import { clamp, clone, round, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import type { EnrollmentRecord } from "../state";
import { pageOf, type Query } from "./shared";

export type VoiceMode = VoiceStatus["mode"];

/** Simulated enrollment timing on the world clock: the job queues briefly, records one sample at a time, then calibrates. */
const ENROLL_QUEUE_MS = 500;
const ENROLL_SAMPLE_MS = 1_500;
const ENROLL_CALIBRATION_MS = 2_000;
const DEFAULT_ENROLL_SAMPLES = 12;
type Stage = VoiceTestResult["stages"][number];

export class VoiceService {
  private utteranceId: string | null = null;
  private utteranceStartedAt: string | null = null;

  constructor(private readonly w: MockWorld) {}

  getStatus(): VoiceStatus {
    return this.w.read("getVoiceStatus", () => clone(this.w.state.voice.status));
  }

  listDevices(query: Query<"listVoiceDevices"> = {}): Page<VoiceDevice> {
    return this.w.read("listVoiceDevices", () => pageOf(this.w.state.voice.devices, query));
  }

  getMetrics(): VoiceMetrics {
    return this.w.read("getVoiceMetrics", () => clone(this.w.state.voice.metrics));
  }

  listProfiles(query: Query<"listVoiceProfiles"> = {}): Page<VoiceProfile> {
    return this.w.read("listVoiceProfiles", () => {
      this.advanceEnrollments();
      return pageOf(this.w.state.voice.profiles, query);
    });
  }

  /**
   * Starts the enrollment of a voice profile (PLAN §38.3). The job advances with the world clock (queued, capturing one
   * sample per tick, optionally calibrating) and updates the profile when it completes. No audio ever passes the API.
   */
  enroll(profileId: string, body: VoiceEnrollRequest = {}, ctx?: OpContext): VoiceEnrollment {
    return this.w.run("enrollVoiceProfile", ctx, { profileId, body }, () => {
      this.w.validate("VoiceEnrollRequest", body);
      this.advanceEnrollments();
      const profile = this.findProfile(profileId);
      const running = this.w.state.voice.enrollments.find((record) => record.job.profileId === profile.id && !isFinished(record.job));
      if (running) throw conflict("Für dieses Profil läuft bereits eine Einrichtung.", { enrollmentId: running.job.id });
      const now = this.w.nowIso();
      const correlationId = this.w.correlationId(ctx);
      const required = body.sampleTarget ?? DEFAULT_ENROLL_SAMPLES;
      const job: VoiceEnrollment = {
        id: this.w.id("venr"),
        profileId: profile.id,
        status: "queued",
        samplesCaptured: 0,
        samplesRequired: required,
        progress: { mode: "determinate", value: 0 },
        quality: null,
        startedAt: now,
        updatedAt: now,
        finishedAt: null,
        message: "Einrichtung wird vorbereitet.",
        source: this.w.source("voice"),
      };
      this.w.state.voice.enrollments.push({ job, recalibrate: body.recalibrate ?? false, applied: false });
      this.w.recordAudit({
        category: "user_action",
        action: "voice.enrollment_started",
        correlationId,
        adapterId: "mock-voice",
        actor: this.w.actorOf(ctx),
        after: { profileId: profile.id, samples: required, recalibrate: body.recalibrate ?? false },
      });
      return clone(job);
    });
  }

  getEnrollment(id: string): VoiceEnrollment {
    return this.w.read("getVoiceEnrollment", () => {
      this.advanceEnrollments();
      const record = this.w.state.voice.enrollments.find((candidate) => candidate.job.id === id);
      if (!record) throw notFound("Einrichtung", id);
      return clone(record.job);
    });
  }

  /**
   * Deletes stored voice-history entries (PLAN §38.4 "klare Löschfunktion"): all of them, or only those older than
   * `before`. `confirm` must be true so a stray request cannot wipe the history.
   */
  deleteHistory(params: { confirm: boolean | string; before?: string }, ctx?: OpContext): ActionResult {
    return this.w.run("deleteVoiceHistory", ctx, params, () => {
      if (params.confirm !== true && params.confirm !== "true") {
        throw validationFailed("Das Löschen des Sprachverlaufs muss bestätigt werden.", [{ path: "confirm", message: "muss true sein" }]);
      }
      let cutoff: number | undefined;
      if (params.before !== undefined) {
        cutoff = Date.parse(params.before);
        if (Number.isNaN(cutoff)) throw validationFailed("Parameter before ist kein gültiger Zeitstempel.", [{ path: "before", message: "date-time erwartet" }]);
      }
      const history = this.w.state.voice.history;
      const kept = cutoff === undefined ? [] : history.filter((at) => Date.parse(at) >= cutoff);
      const removed = history.length - kept.length;
      this.w.state.voice.history = kept;
      const correlationId = this.w.correlationId(ctx);
      const audit = this.w.recordAudit({
        category: "user_action",
        action: "voice.history_deleted",
        severity: "warning",
        correlationId,
        adapterId: "mock-voice",
        actor: this.w.actorOf(ctx),
        before: { entries: history.length },
        after: { entries: kept.length },
        context: cutoff === undefined ? {} : { before: params.before },
      });
      return {
        contractVersion: CONTRACT_VERSION,
        accepted: true,
        status: "completed",
        correlationId,
        auditEventId: audit.id,
        message: removed === 1 ? "1 Verlaufseintrag wurde gelöscht." : `${removed} Verlaufseinträge wurden gelöscht.`,
      };
    });
  }

  private findProfile(id: string): VoiceProfile {
    const profile = this.w.state.voice.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw notFound("Sprachprofil", id);
    return profile;
  }

  /** Brings every unfinished job up to the current world time and applies completed ones to their profile once. */
  private advanceEnrollments(): void {
    const now = this.w.nowMs();
    for (const record of this.w.state.voice.enrollments) {
      if (isFinished(record.job) && record.applied) continue;
      this.advance(record, now);
    }
  }

  private advance(record: EnrollmentRecord, now: number): void {
    const { job } = record;
    const elapsed = Math.max(0, now - Date.parse(job.startedAt));
    const captureMs = job.samplesRequired * ENROLL_SAMPLE_MS;
    const calibrationMs = record.recalibrate ? ENROLL_CALIBRATION_MS : 0;
    const totalMs = ENROLL_QUEUE_MS + captureMs + calibrationMs;
    const captured = clamp(Math.floor((elapsed - ENROLL_QUEUE_MS) / ENROLL_SAMPLE_MS), 0, job.samplesRequired);
    job.samplesCaptured = captured;
    job.progress = { mode: "determinate", value: round(clamp(elapsed / totalMs, 0, 1), 3) };
    job.updatedAt = new Date(now).toISOString();
    if (elapsed < ENROLL_QUEUE_MS) {
      job.status = "queued";
      job.message = "Einrichtung wird vorbereitet.";
    } else if (captured < job.samplesRequired) {
      job.status = "capturing";
      job.message = `Bitte sprich Satz ${captured + 1} von ${job.samplesRequired} laut und deutlich.`;
    } else if (elapsed < totalMs) {
      job.status = "calibrating";
      job.message = "Die Schwelle wird kalibriert.";
    } else if (!record.applied) {
      this.complete(record, Date.parse(job.startedAt) + totalMs);
    }
  }

  private complete(record: EnrollmentRecord, finishedMs: number): void {
    const { job } = record;
    const finishedAt = new Date(finishedMs).toISOString();
    const profile = this.findProfile(job.profileId);
    profile.sampleCount += job.samplesRequired;
    profile.quality = round(Math.min(0.99, profile.quality + (1 - profile.quality) * 0.35 + 0.02), 2);
    if (record.recalibrate) profile.calibratedAt = finishedAt;
    profile.lastTestResult = "unknown";
    profile.lastTestAt = null;
    this.w.bump(profile);
    record.applied = true;
    job.status = "completed";
    job.samplesCaptured = job.samplesRequired;
    job.progress = { mode: "determinate", value: 1 };
    job.quality = profile.quality;
    job.finishedAt = finishedAt;
    job.message = "Das Sprachprofil wurde aktualisiert.";
    this.w.recordAudit({
      category: "system",
      action: "voice.enrollment_completed",
      correlationId: this.w.correlationId(),
      adapterId: "mock-voice",
      after: { profileId: profile.id, sampleCount: profile.sampleCount, quality: profile.quality },
    });
  }

  test(body: VoiceTestRequest, ctx?: OpContext): VoiceTestResult {
    return this.w.run("runVoiceTest", ctx, body, () => {
      this.w.validate("VoiceTestRequest", body);
      const status = this.w.state.voice.status;
      const startedAt = this.w.nowIso();
      const serviceOnline = (name: string): boolean => this.w.state.system.services.find((service) => service.name === name)?.status !== "offline";
      const stage = (name: string, ok: boolean, latencyMs: number | null, detail: string | null): Stage => ({ name, ok, latencyMs, detail });
      const wake = stage("Wake-Word", status.wakeWord.enabled && status.wakeWord.state !== "error", status.wakeWord.enabled ? 120 : null, status.wakeWord.enabled ? `Phrase „${status.wakeWord.phrase}“ erkannt` : "Wake-Word ist deaktiviert");
      const speaker = stage("Sprecherverifikation", status.speakerVerification.enabled, status.speakerVerification.enabled ? 95 : null, status.speakerVerification.enabled ? `Sprecher ${status.speakerVerification.recognizedSpeaker ?? "unbekannt"} bestätigt` : "Verifikation ist deaktiviert");
      const sttOk = serviceOnline("Voice STT") && status.stt.state !== "offline" && status.stt.state !== "error";
      const stt = stage("Spracherkennung", sttOk, sttOk ? (status.stt.latencyMs ?? 420) : null, sttOk ? `${status.stt.engine}: „Wie ist das Wetter morgen in Hannover?“` : "STT-Dienst nicht erreichbar");
      const router = stage("Router", true, 35, "Anfrage an lokales Modell weitergeleitet");
      const first = stage("Erstes Token", true, status.localModel.latencyMs ?? 650, `${status.localModel.name ?? "Modell"} antwortet`);
      const ttsOk = serviceOnline("Voice TTS") && status.tts.state !== "offline" && status.tts.state !== "error";
      const tts = stage("Sprachausgabe", ttsOk, ttsOk ? (status.tts.latencyMs ?? 180) : null, ttsOk ? `${status.tts.engine}: erste Audioausgabe` : "TTS-Dienst nicht erreichbar");
      const stages: Stage[] =
        body.kind === "wake_word" ? [wake] : body.kind === "speaker" ? [speaker] : body.kind === "stt" ? [stt] : body.kind === "tts" ? [tts] : [wake, speaker, stt, router, first, tts];
      const success = stages.every((entry) => entry.ok);
      const durationMs = stages.reduce((sum, entry) => sum + (entry.latencyMs ?? 0), 0) + (body.durationMs ? 0 : 40);
      const correlationId = this.w.correlationId(ctx);
      this.w.recordAudit({
        category: "user_action",
        action: `voice.test.${body.kind}`,
        severity: success ? "info" : "warning",
        result: success ? "success" : "failure",
        correlationId,
        adapterId: "mock-voice",
        actor: this.w.actorOf(ctx),
        durationMs,
        context: { kind: body.kind },
      });
      return {
        kind: body.kind,
        success,
        startedAt,
        durationMs,
        stages,
        message: success ? "Test erfolgreich abgeschlossen." : `Test fehlgeschlagen: ${stages.filter((entry) => !entry.ok).map((entry) => entry.name).join(", ")}.`,
        correlationId,
      };
    });
  }

  /** Stops microphone capture or speech output (barge-in). */
  stop(ctx?: OpContext): ActionResult {
    return this.w.run("stopVoice", ctx, {}, () => {
      const status = this.w.state.voice.status;
      if (status.mode === "idle") throw conflict("Es läuft derzeit keine Spracherfassung oder -ausgabe.", { mode: status.mode });
      const wasSpeaking = status.mode === "speaking";
      const correlationId = this.w.correlationId(ctx);
      this.setMode("idle", { interrupted: wasSpeaking });
      const audit = this.w.recordAudit({ category: "user_action", action: "voice.stopped", correlationId, adapterId: "mock-voice", actor: this.w.actorOf(ctx), after: { interrupted: wasSpeaking } });
      return { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed", correlationId, auditEventId: audit.id, message: wasSpeaking ? "Sprachausgabe wurde unterbrochen." : "Spracherfassung wurde beendet." };
    });
  }

  // ---- simulation hooks ----

  /** Moves the voice pipeline into a mode and publishes `voice.state_changed` (+ tts_started/tts_ended). */
  setMode(mode: VoiceMode, options: { text?: string; interrupted?: boolean } = {}): VoiceStatus {
    const status = this.w.state.voice.status;
    const previous = status.mode;
    status.mode = mode;
    status.updatedAt = this.w.nowIso();
    const listening = mode === "listening";
    status.microphone = {
      ...status.microphone,
      state: listening ? "listening" : status.focusMode ? "muted" : "idle",
      active: listening,
      inputLevel: listening ? status.microphone.inputLevel : 0.02,
    };
    status.wakeWord = { ...status.wakeWord, state: listening ? "triggered" : status.wakeWord.enabled ? "armed" : "disabled" };
    status.stt = { ...status.stt, state: mode === "transcribing" ? "busy" : "ready" };
    status.tts = { ...status.tts, state: mode === "speaking" ? "busy" : "ready" };
    status.localModel = { ...status.localModel, state: mode === "thinking" ? "busy" : "ready" };
    status.speakerVerification = {
      ...status.speakerVerification,
      state: !status.speakerVerification.enabled ? "disabled" : listening || mode === "transcribing" ? "verified" : "idle",
    };
    if (mode === "listening") {
      this.utteranceId = this.w.id("utt");
      this.utteranceStartedAt = this.w.nowIso();
    }
    if (mode === "idle" || mode === "error") this.w.state.audioLevel = 0;
    this.w.emitFor("voice", "friday.voice.state_changed", status, "voice/status");
    if (mode === "speaking" && previous !== "speaking") {
      this.w.emitFor("voice", "friday.voice.tts_started", {
        utteranceId: this.utteranceId ?? this.w.id("utt"),
        engine: status.tts.engine,
        voice: this.w.state.settings.voice.ttsVoice,
        ...(options.text ? { text: options.text } : {}),
      }, "voice/tts");
    }
    if (previous === "speaking" && mode !== "speaking") {
      this.w.emitFor("voice", "friday.voice.tts_ended", { utteranceId: this.utteranceId ?? "utt_unknown", durationMs: 2400, interrupted: options.interrupted ?? false }, "voice/tts");
    }
    this.w.refresh();
    return status;
  }

  resetToIdle(emit = true): void {
    const status = this.w.state.voice.status;
    status.mode = "idle";
    status.microphone = { ...status.microphone, state: "idle", active: false, inputLevel: 0.02 };
    status.wakeWord = { ...status.wakeWord, state: status.wakeWord.enabled ? "armed" : "disabled" };
    status.stt = { ...status.stt, state: "ready" };
    status.tts = { ...status.tts, state: "ready" };
    status.localModel = { ...status.localModel, state: "ready" };
    this.w.state.audioLevel = 0;
    if (emit) this.w.emitFor("voice", "friday.voice.state_changed", status, "voice/status");
  }

  /** Publishes one audio level sample (0..1). Input while listening, output while speaking. */
  emitAudioLevel(level: number, direction: "input" | "output", peak?: number): void {
    const value = Math.round(clamp(level, 0, 1) * 1000) / 1000;
    this.w.state.audioLevel = value;
    if (direction === "input") this.w.state.voice.status.microphone.inputLevel = value;
    this.w.emitFor("voice", "friday.voice.audio_level", { direction, level: value, ...(peak !== undefined ? { peak: Math.round(clamp(peak, 0, 1) * 1000) / 1000 } : {}), at: this.w.nowIso() }, "voice/audio");
  }

  emitTranscript(text: string, final: boolean, confidence?: number): void {
    this.w.emitFor(
      "voice",
      final ? "friday.voice.transcript_final" : "friday.voice.transcript_partial",
      {
        utteranceId: this.utteranceId ?? this.w.id("utt"),
        text,
        final,
        confidence: confidence ?? (final ? 0.96 : 0.74),
        language: "de",
        speaker: this.w.state.voice.status.speakerVerification.recognizedSpeaker,
        startedAt: this.utteranceStartedAt ?? this.w.nowIso(),
      },
      "voice/transcript",
    );
  }
}

const isFinished = (job: VoiceEnrollment): boolean => job.status === "completed" || job.status === "failed" || job.status === "cancelled";
