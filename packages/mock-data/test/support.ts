import { FRIDAY_EVENT_DATA_SCHEMA_IDS, createSchemaValidator, isFridayEvent, type FridayEvent } from "@friday/sdk";
import { MockWorld, type MockWorldOptions } from "../src";

export const validator = createSchemaValidator();

export interface Recorder {
  events: FridayEvent[];
  stop(): void;
}

export function record(world: MockWorld): Recorder {
  const events: FridayEvent[] = [];
  const stop = world.events.subscribe((event) => events.push(event));
  return { events, stop };
}

/** Returns a list of problems for events whose envelope or data violates the contract. */
export function eventProblems(events: readonly FridayEvent[]): string[] {
  const problems: string[] = [];
  let lastSequence = 0;
  for (const event of events) {
    if (!isFridayEvent(event)) problems.push(`not an envelope: ${JSON.stringify(event).slice(0, 120)}`);
    const envelope = validator.validate("EventEnvelope", event);
    if (!envelope.valid) problems.push(`${event.type} envelope: ${JSON.stringify(envelope.errors.slice(0, 2))}`);
    const schemaId = FRIDAY_EVENT_DATA_SCHEMA_IDS[event.type];
    const data = validator.validate(schemaId, event.data);
    if (!data.valid) problems.push(`${event.type} data: ${JSON.stringify(data.errors.slice(0, 3))}`);
    if (event.sequence <= lastSequence && event.type !== "friday.status.resync_required") problems.push(`${event.type} sequence ${event.sequence} <= ${lastSequence}`);
    lastSequence = Math.max(lastSequence, event.sequence);
  }
  return problems;
}

export function createWorld(options: MockWorldOptions = {}): MockWorld {
  return new MockWorld(options);
}

export function expectApiError(fn: () => unknown): { code: string; status: number } {
  try {
    fn();
  } catch (error) {
    const typed = error as { code?: string; status?: number };
    if (typed.code && typed.status) return { code: typed.code, status: typed.status };
    throw error;
  }
  throw new Error("expected an API error but the call succeeded");
}
