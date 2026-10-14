/** `state` values written by installer/voice/jarvis_voice.py (JV:276, 472, 511, 518, 528, 533, 539). */
export const RAW_VOICE_STATES = ["starting", "listening", "command", "speaking", "followup"] as const;
export type RawVoiceState = (typeof RAW_VOICE_STATES)[number];

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
}
