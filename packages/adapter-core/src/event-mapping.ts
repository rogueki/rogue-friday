import { JARVIS_EVENT_DATA_SCHEMA_IDS, isJarvisEventType, type JarvisEventType } from "@jarvis/sdk";
import { assertContract } from "./contract";
import { AdapterError, normalizeError } from "./errors";
import type { MapContext } from "./mapping";
import type { AdapterEventInput } from "./types";

export interface EventMapperDefinition<RawEvent> {
  name: string;
  /**
   * Translates one provider event into zero, one or several canonical events. Return `null` for events that have no
   * canonical meaning (they are dropped on purpose, not by accident).
   */
  toCanonical(raw: RawEvent, context: MapContext): AdapterEventInput | AdapterEventInput[] | null;
}

export interface EventMapper<RawEvent> {
  readonly name: string;
  map(raw: RawEvent, context: MapContext): AdapterEventInput[];
  mapMany(raws: readonly RawEvent[], context: MapContext): AdapterEventInput[];
}

/** Validates the event type, subject and payload (`data`) against `JARVIS_EVENT_DATA_SCHEMA_IDS`. */
export function assertCanonicalEvent(event: AdapterEventInput, what = "event"): void {
  if (!isJarvisEventType(event.type)) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: `${what}: unbekannter Event-Typ.`,
      retryable: false,
    });
  }
  if (typeof event.subject !== "string" || event.subject.length === 0) {
    throw new AdapterError({
      code: "VALIDATION_FAILED",
      message: `${what}: subject fehlt (${event.type}).`,
      retryable: false,
    });
  }
  const schemaId = JARVIS_EVENT_DATA_SCHEMA_IDS[event.type as JarvisEventType];
  assertContract(schemaId, event.data, `${what} ${event.type}`);
}

export function defineEventMapper<RawEvent>(
  definition: EventMapperDefinition<RawEvent>,
): EventMapper<RawEvent> {
  const map = (raw: RawEvent, context: MapContext): AdapterEventInput[] => {
    let produced: AdapterEventInput | AdapterEventInput[] | null;
    try {
      produced = definition.toCanonical(raw, context);
    } catch (error) {
      throw normalizeError(error, { operation: definition.name });
    }
    const events = produced === null ? [] : Array.isArray(produced) ? produced : [produced];
    for (const event of events) assertCanonicalEvent(event, definition.name);
    return events;
  };
  return { name: definition.name, map, mapMany: (raws, context) => raws.flatMap((raw) => map(raw, context)) };
}
