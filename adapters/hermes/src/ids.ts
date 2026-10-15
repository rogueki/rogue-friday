import { AdapterError, createId, createIdCodec, type IdCodec } from "@friday/adapter-core";

export const DEFAULT_BOARD = "default";

/** Hermes task ids (`t_<8hex>`) are unique per board only, so every reference carries the board slug. */
export interface TaskRef {
  board: string;
  taskId: string;
}

/**
 * Codec external id: plain `t_xxxxxxxx` for the default board (short enough for a reversible contract id) and
 * `<board>/<id>` otherwise (hashed by the codec, hence the rehydration fallback in the adapters).
 */
export function externalTaskId(ref: TaskRef): string {
  return ref.board === DEFAULT_BOARD ? ref.taskId : `${ref.board}/${ref.taskId}`;
}

export function parseExternalTaskId(external: string): TaskRef {
  const slash = external.indexOf("/");
  return slash < 0
    ? { board: DEFAULT_BOARD, taskId: external }
    : { board: external.slice(0, slash), taskId: external.slice(slash + 1) };
}

export interface TaskIds {
  encode(ref: TaskRef): string;
  /** Contract id -> reference; `undefined` when this codec never produced the id. */
  decode(id: string): TaskRef | undefined;
}

/** Board-aware task id codec on top of the adapter-core codec. */
export function createTaskIds(codec: IdCodec = createIdCodec("task")): TaskIds & { codec: IdCodec } {
  return {
    codec,
    encode: (ref) => codec.encode(externalTaskId(ref)),
    decode(id) {
      const external = codec.decode(id);
      return external === undefined ? undefined : parseExternalTaskId(external);
    },
  };
}

export interface AgentIds {
  encode(name: string): string;
  decode(id: string): string | undefined;
  codec: IdCodec;
}

export function createAgentIds(codec: IdCodec = createIdCodec("agent")): AgentIds {
  return { codec, encode: (name) => codec.encode(name), decode: (id) => codec.decode(id) };
}

export const notFound = (what: string, id: string): AdapterError =>
  new AdapterError({ code: "NOT_FOUND", message: `${what} nicht gefunden: ${id}`, retryable: false });

/** Deterministic correlation id for a group of related Hermes events (task, session). */
export const correlationFor = (seed: string): string => createId("corr", seed);

/**
 * Ids for nested contract objects whose prefix is not part of the adapter-core prefix list (`step_`, `art_`): the 26
 * character body is derived deterministically from the seed.
 */
export const nestedId = (prefix: "step" | "art", seed: string): string =>
  `${prefix}_${createId("src", `${prefix}:${seed}`).slice("src_".length)}`;
