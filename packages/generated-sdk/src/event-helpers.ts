import { JARVIS_EVENT_TYPES, type JarvisEvent, type JarvisEventType } from "./generated/events";
import type { ControlFrame } from "./generated/models";

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(JARVIS_EVENT_TYPES);

export const isJarvisEventType = (value: unknown): value is JarvisEventType =>
  typeof value === "string" && EVENT_TYPE_SET.has(value);

/**
 * Structural check for a Jarvis event envelope (CloudEvents-inspired). Does not validate `data`;
 * use `createSchemaValidator().validate(JARVIS_EVENT_DATA_SCHEMA_IDS[type], event.data)` for that.
 */
export function isJarvisEvent(value: unknown): value is JarvisEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.specversion === "1.0" &&
    typeof event.id === "string" &&
    isJarvisEventType(event.type) &&
    typeof event.source === "string" &&
    typeof event.time === "string" &&
    typeof event.sequence === "number" &&
    Number.isInteger(event.sequence) &&
    typeof event.contractVersion === "string" &&
    typeof event.data === "object" &&
    event.data !== null
  );
}

/** Narrows an event to a specific type. */
export const isEventOfType = <K extends JarvisEventType>(
  event: JarvisEvent,
  type: K,
): event is Extract<JarvisEvent, { type: K }> => event.type === type;

export function isControlFrame(value: unknown): value is ControlFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (frame.kind === "ping" || frame.kind === "pong") && typeof frame.ts === "number";
}
