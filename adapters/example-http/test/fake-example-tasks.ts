import type { FakeUpstream, UpstreamRequest } from "@friday/adapter-testkit";
import type { RawEvent, RawEventKind, RawItem, RawItemWrite } from "../src/provider-types";

const AT = "2026-10-13T20:00:00.000Z";
const EVENT_CYCLE: readonly RawEventKind[] = ["item.created", "item.updated", "item.progress", "item.closed"];

export interface ExampleTasksState {
  items: RawItem[];
  events: RawEvent[];
  /** Number of items created through POST /items (idempotent replays do not count). */
  created: number;
  publishEvents(count: number): void;
}

export function makeRawItem(index: number, overrides: Partial<RawItem> = {}): RawItem {
  return {
    item_id: `itm_${index}`,
    title: `Rechnung ${index} prüfen`,
    body: `Beschreibung ${index}`,
    state: index % 2 === 0 ? "in_progress" : "open",
    prio: (index % 5) + 1,
    owner_bot: "hermes-bot-1",
    pct: index % 2 === 0 ? 40 : null,
    rev: 1,
    created_at: AT,
    updated_at: AT,
    started_at: index % 2 === 0 ? AT : null,
    due: null,
    tags: ["finanzen"],
    closed_reason: null,
    ...overrides,
  };
}

/** Installs the fictional ExampleTasks REST API on a fake upstream. */
export function installExampleTasks(
  upstream: FakeUpstream,
  options: { count: number; pageSize: number },
): ExampleTasksState {
  const state: ExampleTasksState = {
    items: Array.from({ length: options.count }, (_, index) => makeRawItem(index + 1)),
    events: [],
    created: 0,
    publishEvents(count) {
      for (let i = 0; i < count; i += 1) {
        const seq = state.events.length + 1;
        const kind = EVENT_CYCLE[(seq - 1) % EVENT_CYCLE.length] as RawEventKind;
        const base = state.items[(seq - 1) % Math.max(1, state.items.length)] ?? makeRawItem(seq);
        const item: RawItem =
          kind === "item.closed"
            ? { ...base, state: "closed", closed_reason: "completed", pct: 100, rev: base.rev + 1 }
            : { ...base };
        state.events.push({
          seq,
          kind,
          item,
          ...(kind === "item.progress" ? { message: "Fortschritt aktualisiert" } : {}),
        });
      }
    },
  };
  const idempotent = new Map<string, RawItem>();
  const authorized = (request: UpstreamRequest) => /^Bearer .{8,}/.test(request.headers.authorization ?? "");
  const unauthorized = { status: 401, body: { error: "unauthorized" } };

  upstream.route("GET", "/items", (request) => {
    if (!authorized(request)) return unauthorized;
    const offset = Number(request.query.page_token ?? 0);
    const limit = Math.min(Number(request.query.limit ?? options.pageSize), Math.max(options.pageSize, 1));
    const states = ([] as string[]).concat(request.query.state ?? []);
    const filtered =
      states.length > 0 ? state.items.filter((item) => states.includes(item.state)) : state.items;
    const slice = filtered.slice(offset, offset + limit);
    const next = offset + limit < filtered.length ? String(offset + limit) : null;
    return { body: { items: slice, next_page_token: next } };
  });

  upstream.route("GET", "/items/:id", (request) => {
    if (!authorized(request)) return unauthorized;
    const item = state.items.find((entry) => entry.item_id === request.params.id);
    return item ? { body: item } : { status: 404, body: { error: "not found" } };
  });

  upstream.route("POST", "/items", (request) => {
    if (!authorized(request)) return unauthorized;
    const key = request.headers["idempotency-key"];
    const replay = key ? idempotent.get(key) : undefined;
    if (replay) return { status: 200, body: replay };
    const write = (request.body ?? {}) as RawItemWrite;
    const item = makeRawItem(state.items.length + 1, {
      title: write.title ?? "Ohne Titel",
      body: write.body ?? null,
      state: "open",
      pct: null,
      started_at: null,
      prio: write.prio ?? 3,
      owner_bot: write.owner_bot ?? null,
      due: write.due ?? null,
      tags: write.tags ?? [],
    });
    state.items.push(item);
    state.created += 1;
    if (key) idempotent.set(key, item);
    return { status: 201, body: item };
  });

  upstream.route("PATCH", "/items/:id", (request) => {
    if (!authorized(request)) return unauthorized;
    const index = state.items.findIndex((entry) => entry.item_id === request.params.id);
    const current = state.items[index];
    if (!current) return { status: 404, body: { error: "not found" } };
    const ifMatch = request.headers["if-match"];
    if (ifMatch !== undefined && Number(ifMatch) !== current.rev)
      return { status: 412, body: { error: "stale revision" } };
    const write = (request.body ?? {}) as RawItemWrite;
    const updated: RawItem = { ...current, ...write, rev: current.rev + 1, updated_at: AT } as RawItem;
    state.items[index] = updated;
    return { body: updated };
  });

  upstream.route("POST", "/items/:id/cancel", (request) => {
    if (!authorized(request)) return unauthorized;
    const index = state.items.findIndex((entry) => entry.item_id === request.params.id);
    const current = state.items[index];
    if (!current) return { status: 404, body: { error: "not found" } };
    const updated: RawItem = {
      ...current,
      state: "closed",
      closed_reason: "cancelled",
      rev: current.rev + 1,
    };
    state.items[index] = updated;
    return { body: updated };
  });

  upstream.route("GET", "/events", (request) => {
    if (!authorized(request)) return unauthorized;
    const after = Number(request.query.after ?? 0);
    const events = state.events.filter((event) => event.seq > after);
    return { body: { events, last_seq: state.events.length > 0 ? state.events.length : after } };
  });

  return state;
}
