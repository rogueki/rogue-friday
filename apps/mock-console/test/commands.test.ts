import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type ScenarioState } from "@jarvis/sdk";
import { EVENT_MODES, ORB_MODES, parseDuration, run, UsageError } from "../src/commands";
import { eventsUrl } from "../src/watch";

const CSRF = "csrf-test-token";
const state = (patch: Partial<ScenarioState> = {}): ScenarioState => ({
  activeScenarioId: null,
  running: false,
  stepIndex: 0,
  seed: 42,
  simulatedTime: "2026-10-13T08:00:00.000Z",
  clockOffsetMs: 0,
  adapterOverrides: [],
  capabilityOverrides: [],
  forcedOrbMode: null,
  ...patch,
});

interface Recorded {
  method: string;
  path: string;
  search: string;
  csrf: string | null;
  cookie: string | null;
  body: unknown;
}

/** Scripted stand-in for the Control API: dev login plus the scenario endpoints. */
function fakeApi(handlers: Record<string, (request: Recorded) => unknown> = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = request.method === "GET" ? "" : await request.text();
    const recorded: Recorded = {
      method: request.method,
      path: url.pathname,
      search: url.search,
      csrf: request.headers.get("x-csrf-token"),
      cookie: request.headers.get("cookie"),
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(recorded);
    const key = `${request.method} ${url.pathname}`;
    if (key === "POST /api/v1/auth/login") {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "jarvis_session=sess123; Path=/; HttpOnly");
      return new Response(JSON.stringify({ contractVersion: CONTRACT_VERSION, data: { csrfToken: CSRF } }), { status: 200, headers });
    }
    const handler = handlers[key];
    if (!handler) {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Nicht gefunden", severity: "warning", retryable: false, correlationId: "corr_00000000000000000000000000", details: {} } },
        { status: 404 },
      );
    }
    return Response.json(handler(recorded));
  };
  return { calls, fetchImpl: fetchImpl as typeof fetch };
}

function harness(handlers?: Record<string, (request: Recorded) => unknown>) {
  const api = fakeApi(handlers);
  const out: string[] = [];
  const err: string[] = [];
  const exec = (...argv: string[]) =>
    run(argv, { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, fetch: api.fetchImpl, env: {}, sleep: async () => {} });
  return { ...api, out, err, exec };
}

const envelope = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh", asOf: "2026-10-13T08:00:00.000Z" } });
const controlHandler = { "POST /api/v1/dev/scenarios/control": () => envelope(state({ forcedOrbMode: "thinking" })) };
const lastControl = (calls: Recorded[]) => calls.filter((c) => c.path.endsWith("/scenarios/control")).at(-1);

describe("parseDuration", () => {
  it("understands units and plain milliseconds", () => {
    expect(parseDuration("500")).toBe(500);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("1.5s")).toBe(1_500);
  });
  it("rejects garbage and zero", () => {
    expect(() => parseDuration("soon")).toThrow(UsageError);
    expect(() => parseDuration("0")).toThrow(UsageError);
  });
});

describe("eventsUrl", () => {
  it("switches the scheme and carries ?since", () => {
    expect(eventsUrl("http://127.0.0.1:3100", "/api/v1/events", 12)).toBe("ws://127.0.0.1:3100/api/v1/events?since=12");
    expect(eventsUrl("https://host.example", "/api/v1/events")).toBe("wss://host.example/api/v1/events");
  });
});

describe("scenario CLI", () => {
  it("logs in as dev-owner with the dev password and sends cookie and CSRF on mutations", async () => {
    const h = harness(controlHandler);
    expect(await h.exec("reset")).toBe(0);
    const login = h.calls[0];
    expect(login?.body).toEqual({ username: "dev-owner", password: "dev" });
    const control = lastControl(h.calls);
    expect(control?.csrf).toBe(CSRF);
    expect(control?.cookie).toContain("jarvis_session=sess123");
    expect(control?.body).toEqual({ action: "reset" });
  });

  it("honours --role and tolerates the leading -- that pnpm forwards", async () => {
    const h = harness(controlHandler);
    expect(await h.exec("--", "reset", "--role", "operator")).toBe(0);
    expect(h.calls[0]?.body).toEqual({ username: "dev-operator", password: "dev" });
  });

  it("lists scenarios", async () => {
    const h = harness({
      "GET /api/v1/dev/scenarios": () => ({
        ...envelope(null),
        items: [{ id: "voice-pipeline", name: "Sprach-Pipeline", description: "Hören bis Sprechen", steps: [{ index: 0, label: "a", delayMs: 0 }] }],
      }),
    });
    expect(await h.exec("list")).toBe(0);
    expect(h.out.join("\n")).toContain("voice-pipeline");
    expect(h.out.join("\n")).toContain("Sprach-Pipeline");
  });

  it("plays a scenario with speed", async () => {
    const h = harness({ "POST /api/v1/dev/scenarios/voice-pipeline/play": () => envelope(state({ activeScenarioId: "voice-pipeline", running: true })) });
    expect(await h.exec("play", "voice-pipeline", "--speed", "4")).toBe(0);
    const call = h.calls.find((c) => c.path.endsWith("/play"));
    expect(call?.search).toBe("?speed=4");
    expect(h.out.join("\n")).toContain("voice-pipeline");
  });

  it("select is an alias for play", async () => {
    const h = harness({ "POST /api/v1/dev/scenarios/clean-idle/play": () => envelope(state({ activeScenarioId: "clean-idle" })) });
    expect(await h.exec("select", "clean-idle")).toBe(0);
    expect(h.calls.some((c) => c.path === "/api/v1/dev/scenarios/clean-idle/play")).toBe(true);
  });

  it.each([
    [["advance", "5m"], { action: "clock_advance", ms: 300_000 }],
    [["offline", "mock-mail"], { action: "adapter_offline", adapterId: "mock-mail", offline: true }],
    [["online", "mock-mail"], { action: "adapter_offline", adapterId: "mock-mail", offline: false }],
    [["latency", "250"], { action: "latency", ms: 250 }],
    [["latency", "250", "--adapter", "mock-tasks"], { action: "latency", ms: 250, adapterId: "mock-tasks" }],
    [["error-rate", "0.25"], { action: "error_rate", rate: 0.25 }],
    [["capability", "tasks.create", "off"], { action: "capability_toggle", module: "tasks", capability: "create", enabled: false }],
    [["orb", "thinking", "--text", "ANALYSE", "--level", "0.4", "--progress", "0.5"], { action: "force_orb_state", mode: "thinking", activityText: "ANALYSE", audioLevel: 0.4, progress: 0.5 }],
    [["event", "approval"], { action: "force_orb_state", mode: "waiting_approval" }],
    [["reset"], { action: "reset" }],
    [["release-orb"], { action: "release_orb_state" }],
    [["play-event", "jarvis.orb.status_changed"], { action: "play_event", eventType: "jarvis.orb.status_changed" }],
    [
      ["play-event", "jarvis.voice.transcript_partial", "--subject", "voice/utterance", "--payload", '{"text":"Hallo"}'],
      { action: "play_event", eventType: "jarvis.voice.transcript_partial", subject: "voice/utterance", payload: { text: "Hallo" } },
    ],
  ] as const)("maps %j to the control request", async (argv, expected) => {
    const h = harness(controlHandler);
    expect(await h.exec(...argv)).toBe(0);
    expect(lastControl(h.calls)?.body).toEqual(expected);
  });

  it("walks an event sequence step by step", async () => {
    const h = harness(controlHandler);
    expect(await h.exec("event", "voice-pipeline", "--step-ms", "1")).toBe(0);
    const modes = h.calls.filter((c) => c.path.endsWith("/control")).map((c) => (c.body as { mode: string }).mode);
    expect(modes).toEqual(["listening", "transcribing", "thinking", "speaking"]);
  });

  it("covers every event name of the plan with a valid orb mode", () => {
    for (const mode of Object.values(EVENT_MODES)) expect(ORB_MODES).toContain(mode);
    expect(Object.keys(EVENT_MODES)).toEqual(["listening", "transcribing", "thinking", "working", "speaking", "approval", "error", "recovery"]);
  });

  it("prints the state as JSON on request", async () => {
    const h = harness({ "GET /api/v1/dev/scenarios/state": () => envelope(state({ seed: 7 })) });
    expect(await h.exec("state", "--json")).toBe(0);
    expect(JSON.parse(h.out.join("\n"))).toMatchObject({ seed: 7 });
  });

  it.each([
    [["advance"], "Dauer"],
    [["advance", "bald"], "Ungültige Dauer"],
    [["latency", "abc"], "Latenz"],
    [["error-rate", "2"], "Fehlerquote"],
    [["capability", "tasks", "on"], "capability"],
    [["capability", "tasks.create", "maybe"], "capability"],
    [["orb", "dancing"], "Modus"],
    [["event", "nonsense"], "Unbekanntes Ereignis"],
    [["frobnicate"], "Unbekannter Befehl"],
    [["play"], "Szenario-ID"],
    [["play-event"], "Ereignistyp"],
    [["play-event", "orb-status"], "Ereignistyp"],
    [["play-event", "jarvis.orb.status_changed", "--payload", "{kaputt"], "kein gültiges JSON"],
    [["play-event", "jarvis.orb.status_changed", "--payload", "[1]"], "JSON-Objekt"],
    [["play-event", "jarvis.orb.status_changed", "--payload", "@/gibt/es/nicht.json"], "nicht lesbar"],
  ] as const)("rejects bad input %j with exit code 2", async (argv, message) => {
    const h = harness(controlHandler);
    expect(await h.exec(...argv)).toBe(2);
    expect(h.err.join("\n")).toContain(message);
    expect(lastControl(h.calls)).toBeUndefined();
  });

  it("reads the play-event payload from a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jarvis-console-"));
    const file = join(dir, "payload.json");
    writeFileSync(file, JSON.stringify({ text: "Aus Datei" }));
    try {
      const h = harness(controlHandler);
      expect(await h.exec("play-event", "jarvis.voice.transcript_partial", "--payload", `@${file}`)).toBe(0);
      expect(lastControl(h.calls)?.body).toEqual({ action: "play_event", eventType: "jarvis.voice.transcript_partial", payload: { text: "Aus Datei" } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("documents the new commands in the help", async () => {
    const h = harness();
    await h.exec("--help");
    expect(h.out.join("\n")).toMatch(/release-orb[\s\S]*play-event/);
  });

  it("rejects unknown options and roles with exit code 2", async () => {
    const h = harness();
    expect(await h.exec("reset", "--bogus")).toBe(2);
    expect(await h.exec("reset", "--role", "root")).toBe(2);
  });

  it("shows usage for --help and for no command", async () => {
    const h = harness();
    expect(await h.exec("--help")).toBe(0);
    expect(h.out.join("\n")).toContain("Aufruf: pnpm scenario");
    const empty = harness();
    expect(await empty.exec()).toBe(1);
  });

  it("reports API errors with code and correlation id and exits 1", async () => {
    const h = harness();
    expect(await h.exec("state")).toBe(1);
    expect(h.err.join("\n")).toMatch(/API-Fehler 404 NOT_FOUND.*corr_/);
  });
});
