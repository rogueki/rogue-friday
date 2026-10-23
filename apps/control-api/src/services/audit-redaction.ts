import type { AuditEvent } from "@friday/sdk";

const REDACTED = "[redigiert]";

/** Field names whose values never belong in an export, even when a bug wrote them into the trail. */
const SECRET_KEYS = /^(password|passwort|passwd|secret|clientsecret|client_secret|token|accesstoken|access_token|refreshtoken|refresh_token|apikey|api_key|authorization|cookie|setcookie|set_cookie|privatekey|private_key|sessiontoken|session_token|otp|totp)$/i;

/** Payload kinds that have no business in an audit export at all. */
const DROP_KEYS = /(^qr$|_qr$|^qr_|qrcode|qr_code|audioembedding|audio_embedding|embedding|voiceprint|voice_print|spectrogram)/i;

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1));
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.test(key)) continue;
    if (SECRET_KEYS.test(key)) {
      // Keep the signal that a value existed without handing out the value itself.
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactValue(entry, depth + 1);
  }
  return result;
}

/**
 * Removes credentials and media embeddings from an audit event on its way out. Storage stays untouched: the hash chain
 * covers the original record, and redaction only affects the export the operator downloads.
 */
export function redactAuditEvent(event: AuditEvent): AuditEvent {
  return redactValue(event) as AuditEvent;
}

export function redactAuditEvents(events: AuditEvent[]): AuditEvent[] {
  return events.map((event) => redactAuditEvent(event));
}