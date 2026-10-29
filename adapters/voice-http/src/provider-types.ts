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
  service_started_at?: string;
  tts_voice_choice?: string | null;
  input_device_id?: string | null;
  output_device_id?: string | null;
  runtime_settings?: {
    wakeWordEnabled: boolean; wakeWord: string; pushToTalkKey: string; speakerVerificationRequired: boolean;
    storeRawRecordings: boolean; voiceHistoryEnabled: boolean; sttLanguage: "de" | "en";
      sttModel: string | null; ttsRate: number;
  };
  ptt_active?: boolean;
  native_ptt_available?: boolean;
}
