import {
  CONTRACT_VERSION,
  type ActionResult,
  type VoiceDevice,
  type VoiceMetrics,
  type VoiceProfile,
  type VoiceStatus,
  type VoiceTestRequest,
  type VoiceTestResult,
} from "@jarvis/sdk";
import { conflict } from "../../core/errors";
import { clamp, clone, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { pageOf, type Query } from "./shared";

export type VoiceMode = VoiceStatus["mode"];
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
    return this.w.read("listVoiceProfiles", () => pageOf(this.w.state.voice.profiles, query));
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
    this.w.emitFor("voice", "jarvis.voice.state_changed", status, "voice/status");
    if (mode === "speaking" && previous !== "speaking") {
      this.w.emitFor("voice", "jarvis.voice.tts_started", {
        utteranceId: this.utteranceId ?? this.w.id("utt"),
        engine: status.tts.engine,
        voice: this.w.state.settings.voice.ttsVoice,
        ...(options.text ? { text: options.text } : {}),
      }, "voice/tts");
    }
    if (previous === "speaking" && mode !== "speaking") {
      this.w.emitFor("voice", "jarvis.voice.tts_ended", { utteranceId: this.utteranceId ?? "utt_unknown", durationMs: 2400, interrupted: options.interrupted ?? false }, "voice/tts");
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
    if (emit) this.w.emitFor("voice", "jarvis.voice.state_changed", status, "voice/status");
  }

  /** Publishes one audio level sample (0..1). Input while listening, output while speaking. */
  emitAudioLevel(level: number, direction: "input" | "output", peak?: number): void {
    const value = Math.round(clamp(level, 0, 1) * 1000) / 1000;
    this.w.state.audioLevel = value;
    if (direction === "input") this.w.state.voice.status.microphone.inputLevel = value;
    this.w.emitFor("voice", "jarvis.voice.audio_level", { direction, level: value, ...(peak !== undefined ? { peak: Math.round(clamp(peak, 0, 1) * 1000) / 1000 } : {}), at: this.w.nowIso() }, "voice/audio");
  }

  emitTranscript(text: string, final: boolean, confidence?: number): void {
    this.w.emitFor(
      "voice",
      final ? "jarvis.voice.transcript_final" : "jarvis.voice.transcript_partial",
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
