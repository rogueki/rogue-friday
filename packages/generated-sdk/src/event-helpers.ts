import { FRIDAY_EVENT_TYPES, type FridayEvent, type FridayEventType } from "./generated/events";
import type { ControlFrame } from "./generated/models";

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(FRIDAY_EVENT_TYPES);

export const isFridayEventType = (value: unknown): value is FridayEventType =>
  typeof value === "string" && EVENT_TYPE_SET.has(value);

/**
 * Structural check for a Friday event envelope (CloudEvents-inspired). Does not validate `data`;
 * use `createSchemaValidator().validate(FRIDAY_EVENT_DATA_SCHEMA_IDS[type], event.data)` for that.
 */
export function isFridayEvent(value: unknown): value is FridayEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    event.specversion === "1.0" &&
    typeof event.id === "string" &&
    isFridayEventType(event.type) &&
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
export const isEventOfType = <K extends FridayEventType>(
  event: FridayEvent,
  type: K,
): event is Extract<FridayEvent, { type: K }> => event.type === type;

export function isControlFrame(value: unknown): value is ControlFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return (frame.kind === "ping" || frame.kind === "pong") && typeof frame.ts === "number";
}
