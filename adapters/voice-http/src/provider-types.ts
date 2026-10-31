/** `state` values written by installer/voice/friday_voice.py (JV:276, 472, 511, 518, 528, 533, 539). */
export const RAW_VOICE_STATES = [
  "starting",
  // Linux browser transport: the service waits until the owner's browser opens the audio WebSocket.
  "waiting_audio",
  "listening",
  "wake_only",
  "command",
  "speaking",
  "followup",
  "paused",
] as const;
export type RawVoiceState = (typeof RAW_VOICE_STATES)[number];

/** Orb-relevant pipeline phase reported by newer services (`phase` key); `state` keeps its old meaning. */
export const RAW_VOICE_PHASES = ["idle", "listening", "transcribing", "thinking", "speaking"] as const;
export type RawVoicePhase = (typeof RAW_VOICE_PHASES)[number];

/** Smoothed levels 0..1 of one audio direction (`input_audio` / `output_audio`); numbers only, never audio. */
export interface RawAudioLevels {
  level: number;
  peak?: number;
  low?: number;
  mid?: number;
  high?: number;
}

/**
 * Body of the status server: `{**status, "speaking": bool, "trusted": bool}` (JV:581-582).
 * `game_mode` only exists once the gaming mode has been active (JV:556, 571).
 */
export interface RawVoiceStatus {
  state: RawVoiceState;
  /** Local time, ISO-8601 to the second, without time zone (JV:276). */
  started: string;
  /** Time of the last wake event, not of the last command (JV:490). */
  last_event: string | null;
  wake_count: number;
  rejected_speaker: number;
  commands: number;
  speaking: boolean;
  trusted: boolean;
  trusted_remaining_s?: number;
  speaker_decision?: { decision: "verified" | "rejected"; score: number; at: string } | null;
  /** Additive: summary of the active speaker profile (never the embedding); null when no profile file exists. */
  speaker_profile?: RawSpeakerProfile | null;
  /** Additive: wake-word artifact (engine, threshold, personal calibration); never model data. */
  wake_calibration?: RawWakeCalibration | null;
  /** Additive: output voice artifact (slot, clone/preset/cloud, slots with a reference); never paths or audio. */
  output_voice?: RawOutputVoice;
  /** Additive: sliding windows (last 200 commands) of measured latencies; numbers only. */
  latency?: RawLatency;
  game_mode?: string | null;
  /** Additive fields of the personalized installer (assistant name / wake phrase chosen at install time). */
  assistant_name?: string;
  wake_phrase?: string;
  /**
   * Additive audio levels of the service (`installer/voice/audio_level.py`): smoothed normalized RMS 0..1 of the last
   * input / output blocks. A number only, never audio. Absent on services without the meter.
   */
  input_level?: number;
  output_level?: number;
  /**
   * Additive pipeline phase (listening = recording the command, transcribing = speaker check + STT, thinking = routing
   * and waiting for Hermes/the model, speaking = TTS). Absent on older services: the adapter then derives it from `state`.
   */
  phase?: RawVoicePhase;
  /** TTS audio is playing (same truth as `speaking`, kept separate for clarity of the new keys). */
  tts_active?: boolean;
  /** Level, peak and low/mid/high band levels of the microphone / the TTS output. */
  input_audio?: RawAudioLevels;
  output_audio?: RawAudioLevels;
  /** `device` (host microphone/speaker) or `browser` (Linux: audio travels through the dashboard WebSocket). */
  audio_transport?: "device" | "browser";
  host_platform?: "windows" | "linux";
  voice_mode?: "local" | "elevenlabs";
  service_started_at?: string;
  /** Build id of the running service (hash of its source at start): tells which code actually runs after an update. */
  service_version?: string;
  tts_voice_choice?: string | null;
  input_device_id?: string | null;
  output_device_id?: string | null;
  runtime_settings?: {
    wakeWordEnabled: boolean; wakeWord: string; pushToTalkKey: string; speakerVerificationRequired: boolean;
    storeRawRecordings: boolean; voiceHistoryEnabled: boolean; sttLanguage: "de" | "en";
      sttModel: string | null; conversationBackend: "local" | "qwen"; conversationConsent: boolean; conversationSilenceSeconds: number;
      proactiveAnnouncements: boolean; conversationRegion: "ap-southeast-1" | "cn-beijing"; ttsRate: number;
  };
  conversation?: { backend: "local" | "qwen"; key_configured: boolean; consent: boolean;
    last_error: "auth" | "quota" | "rate" | "idle" | "model" | "network" | "protocol" | null };
  ptt_active?: boolean;
  native_ptt_available?: boolean;
}

export interface RawWakeCalibration {
  engine: "openwakeword" | "personal";
  threshold: number | null;
  quality: "good" | "medium" | "weak" | null;
  hit_rate: number | null;
  own_clips: number | null;
  calibrated_at: string | null;
  format?: number | null;
}

export interface RawLatencyStat {
  current_ms: number | null;
  avg_ms: number | null;
  p95_ms: number | null;
  count: number;
}

export const RAW_LATENCY_KEYS = ["speaker", "stt", "router", "model", "answer_start"] as const;
export type RawLatency = Partial<Record<(typeof RAW_LATENCY_KEYS)[number], RawLatencyStat>>;

export interface RawOutputVoice {
  choice: string | null;
  kind: "clone" | "preset" | "cloud";
  available: string[];
  reference_updated_at: string | null;
  needs_voice_update?: boolean;
}

/** Measured values are null when the profile predates the metadata file or the metadata belongs to another embedding. */
export interface RawSpeakerProfile {
  updated_at: string;
  threshold: number;
  sample_count: number | null;
  quality: number | null;
  calibrated_at: string | null;
}
