import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { FridayApiError, type OrbMode, type ScenarioControlRequest, type ScenarioState } from "@friday/sdk";
import { openSession, type ConsoleSession, type DevRole } from "./session";
import { watchEvents } from "./watch";

export const ORB_MODES = [
  "booting",
  "idle",
  "listening",
  "transcribing",
  "thinking",
  "syncing",
  "working",
  "speaking",
  "waiting_approval",
  "success",
  "warning",
  "error",
  "offline",
  "paused",
] as const satisfies readonly OrbMode[];

/** Mock events of PLAN §44.5 and the orb mode each one forces. */
export const EVENT_MODES: Readonly<Record<string, OrbMode>> = {
  listening: "listening",
  transcribing: "transcribing",
  thinking: "thinking",
  working: "working",
  speaking: "speaking",
  approval: "waiting_approval",
  error: "error",
  recovery: "success",
};

/** `play event voice-pipeline` walks through these; the pause between steps is `--step-ms`. */
export const EVENT_SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  "voice-pipeline": ["listening", "transcribing", "thinking", "speaking"],
  "error-recovery": ["error", "recovery"],
};

export const USAGE = `Szenario-Konsole für das F.R.I.D.A.Y. Command Center (Control API, Mock-Modus)

Aufruf: pnpm scenario -- <befehl> [argumente] [optionen]

Befehle
  list                           Szenarien auflisten
  state                          aktuellen Szenario-Zustand anzeigen
  select <id> | play <id>        Szenario auswählen und abspielen   [--speed <faktor>]
  advance <dauer>                Uhr vorspulen (z. B. 90s, 5m, 2h, 1d oder Millisekunden)
  offline <adapter>              Adapter offline schalten (z. B. mock-mail)
  online <adapter>               Adapter wieder online schalten
  latency <ms> [--adapter <id>]  Latenz einstellen (ohne --adapter global)
  error-rate <0..1> [--adapter <id>]
                                 Fehlerquote einstellen
  capability <modul.name> <on|off>
                                 Capability ein-/ausschalten (z. B. tasks.create off)
  event <name>                   Mock-Ereignis abspielen: ${Object.keys(EVENT_MODES).join(", ")}
                                 oder Sequenz: ${Object.keys(EVENT_SEQUENCES).join(", ")}   [--step-ms <ms>]
  orb <modus> [--text <t>] [--level <0..1>] [--progress <0..1>]
                                 Orb-Zustand erzwingen (${ORB_MODES.join(", ")})
  release-orb                    erzwungenen Orb-Zustand freigeben (Orb folgt wieder dem abgeleiteten Zustand)
  play-event <typ> [--subject <s>] [--payload <json|@datei>]
                                 beliebiges Ereignis der Ereignisliste abspielen (z. B. friday.orb.status_changed;
                                 Typen ohne abgeleiteten Zustand brauchen --payload)
  reset                          Snapshot zurücksetzen
  status                         Gesamtstatus und Orb-Zustand anzeigen
  watch [--count <n>] [--for <ms>] [--type <prefix>] [--since <sequenz>]
                                 Echtzeit-Ereignisse mitlesen

Optionen
  --url <basis>   Control API (Standard: $FRIDAY_API_URL oder http://127.0.0.1:3100)
  --role <rolle>  Dev-Anmeldung als owner (Standard), operator oder viewer
  --json          Ausgabe als JSON
  -h, --help      diese Hilfe
`;

export interface ConsoleIo {
  out(line: string): void;
  err(line: string): void;
}

export interface RunDeps {
  io: ConsoleIo;
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Reuse an existing session (tests); otherwise a dev login is performed. */
  session?: ConsoleSession;
}

export class UsageError extends Error {}

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;
const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

export function parseDuration(text: string): number {
  const match = DURATION.exec(text.trim());
  if (!match) throw new UsageError(`Ungültige Dauer: "${text}" (Beispiele: 500, 90s, 5m, 2h, 1d)`);
  const unit = (match[2] ?? "ms") as keyof typeof UNIT_MS;
  const ms = Math.round(Number(match[1]) * UNIT_MS[unit]);
  if (!Number.isInteger(ms) || ms < 1) throw new UsageError(`Dauer muss mindestens 1 ms betragen: "${text}"`);
  return ms;
}

function parseNumber(text: string | undefined, label: string, min: number, max: number): number {
  const value = Number(text);
  if (text === undefined || text.trim() === "" || !Number.isFinite(value) || value < min || value > max) {
    throw new UsageError(`${label} muss eine Zahl zwischen ${min} und ${max} sein.`);
  }
  return value;
}

const EVENT_TYPE = /^friday\.[a-z_]+(\.[a-z_]+)+$/;

/** `--payload '{"a":1}'` or `--payload @datei.json`; the payload must be a JSON object. */
function parsePayload(text: string): Record<string, unknown> {
  let raw = text;
  if (text.startsWith("@")) {
    try {
      raw = readFileSync(text.slice(1), "utf8");
    } catch (error) {
      throw new UsageError(`--payload: Datei "${text.slice(1)}" nicht lesbar (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError("--payload: kein gültiges JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UsageError("--payload: erwartet ein JSON-Objekt.");
  return parsed as Record<string, unknown>;
}

function isOrbMode(value: string): value is OrbMode {
  return (ORB_MODES as readonly string[]).includes(value);
}

function describeState(state: ScenarioState): string[] {
  const lines = [
    `Szenario:   ${state.activeScenarioId ?? "(keines)"}${state.running ? " (läuft)" : ""}  Schritt ${state.stepIndex}`,
    `Weltzeit:   ${state.simulatedTime}  (Versatz ${state.clockOffsetMs} ms)  Seed ${state.seed}`,
    `Orb:        ${state.forcedOrbMode ?? "(abgeleitet)"}`,
  ];
  for (const override of state.adapterOverrides) {
    const parts = [override.offline ? "offline" : "online"];
    if (override.latencyMs !== undefined) parts.push(`Latenz ${override.latencyMs} ms`);
    if (override.errorRate !== undefined) parts.push(`Fehlerquote ${override.errorRate}`);
    lines.push(`Adapter:    ${override.adapterId}  ${parts.join(", ")}`);
  }
  for (const override of state.capabilityOverrides) {
    lines.push(`Capability: ${override.module}.${override.capability} = ${override.enabled ? "an" : "aus"}`);
  }
  return lines;
}

/** Parses `argv` (without node/script), executes one command against the Control API and returns the exit code. */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const { io } = deps;
  const env = deps.env ?? process.env;
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        url: { type: "string" },
        role: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        speed: { type: "string" },
        adapter: { type: "string" },
        text: { type: "string" },
        level: { type: "string" },
        progress: { type: "string" },
        "step-ms": { type: "string" },
        subject: { type: "string" },
        payload: { type: "string" },
        count: { type: "string" },
        for: { type: "string" },
        type: { type: "string" },
        since: { type: "string" },
      },
    });
    const [command, ...rest] = positionals;
    if (values.help || !command) {
      io.out(USAGE);
      return command || values.help ? 0 : 1;
    }

    const role = (values.role ?? "owner") as DevRole;
    if (!["owner", "operator", "viewer"].includes(role)) throw new UsageError(`Unbekannte Rolle: ${role}`);
    const json = values.json === true;
    const print = (value: unknown, lines: () => string[]): void => {
      if (json) io.out(JSON.stringify(value, null, 2));
      else for (const line of lines()) io.out(line);
    };

    const session =
      deps.session ??
      (await openSession({
        baseUrl: values.url ?? env.FRIDAY_API_URL ?? "http://127.0.0.1:3100",
        role,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      }));
    const { client } = session;
    const control = async (request: ScenarioControlRequest): Promise<ScenarioState> => {
      const { data } = await client.POST("/api/v1/dev/scenarios/control", { body: request });
      if (!data) throw new Error("Leere Antwort der Control API.");
      return data.data;
    };
    const forceOrb = (mode: OrbMode, extra: { text?: string; level?: number; progress?: number } = {}) =>
      control({
        action: "force_orb_state",
        mode,
        ...(extra.text !== undefined ? { activityText: extra.text } : {}),
        ...(extra.level !== undefined ? { audioLevel: extra.level } : {}),
        ...(extra.progress !== undefined ? { progress: extra.progress } : {}),
      });
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

    switch (command) {
      case "list": {
        const { data } = await client.GET("/api/v1/dev/scenarios");
        const items = data?.items ?? [];
        print(items, () => items.map((s) => `${s.id.padEnd(28)} ${s.steps.length} Schritte  ${s.name} - ${s.description}`));
        return 0;
      }
      case "state": {
        const { data } = await client.GET("/api/v1/dev/scenarios/state");
        if (!data) throw new Error("Leere Antwort der Control API.");
        print(data.data, () => describeState(data.data));
        return 0;
      }
      case "select":
      case "play": {
        const id = rest[0];
        if (!id) throw new UsageError(`${command}: Szenario-ID fehlt (siehe "list").`);
        const speed = values.speed === undefined ? undefined : parseNumber(values.speed, "--speed", 0.01, 1000);
        const { data } = await client.POST("/api/v1/dev/scenarios/{id}/play", {
          // `speed` is an extension of playScenario (not in the generated parameter types).
          params: { path: { id }, ...(speed !== undefined ? { query: { speed } } : {}) } as never,
        });
        if (!data) throw new Error("Leere Antwort der Control API.");
        print(data.data, () => [`Szenario "${id}" gestartet.`, ...describeState(data.data)]);
        return 0;
      }
      case "advance": {
        if (!rest[0]) throw new UsageError("advance: Dauer fehlt (z. B. 5m).");
        const state = await control({ action: "clock_advance", ms: parseDuration(rest[0]) });
        print(state, () => [`Uhr vorgespult auf ${state.simulatedTime}.`]);
        return 0;
      }
      case "offline":
      case "online": {
        if (!rest[0]) throw new UsageError(`${command}: Adapter-ID fehlt (z. B. mock-mail).`);
        const state = await control({ action: "adapter_offline", adapterId: rest[0], offline: command === "offline" });
        print(state, () => [`Adapter ${rest[0]} ist jetzt ${command}.`]);
        return 0;
      }
      case "latency": {
        const ms = Math.round(parseNumber(rest[0], "Latenz (ms)", 0, 60_000));
        const state = await control({ action: "latency", ms, ...(values.adapter ? { adapterId: values.adapter } : {}) });
        print(state, () => [`Latenz ${ms} ms (${values.adapter ?? "alle Adapter"}).`]);
        return 0;
      }
      case "error-rate": {
        const rate = parseNumber(rest[0], "Fehlerquote", 0, 1);
        const state = await control({ action: "error_rate", rate, ...(values.adapter ? { adapterId: values.adapter } : {}) });
        print(state, () => [`Fehlerquote ${rate} (${values.adapter ?? "alle Adapter"}).`]);
        return 0;
      }
      case "capability": {
        const [name, toggle] = rest;
        const dot = name?.indexOf(".") ?? -1;
        if (!name || dot < 1 || dot === name.length - 1 || (toggle !== "on" && toggle !== "off")) {
          throw new UsageError("capability: erwartet <modul.name> <on|off>, z. B. tasks.create off");
        }
        const state = await control({
          action: "capability_toggle",
          module: name.slice(0, dot),
          capability: name.slice(dot + 1),
          enabled: toggle === "on",
        });
        print(state, () => [`Capability ${name} ist jetzt ${toggle === "on" ? "an" : "aus"}.`]);
        return 0;
      }
      case "event": {
        const name = rest[0];
        if (!name) throw new UsageError(`event: Name fehlt (${[...Object.keys(EVENT_MODES), ...Object.keys(EVENT_SEQUENCES)].join(", ")}).`);
        const steps = EVENT_SEQUENCES[name] ?? [name];
        const stepMs = values["step-ms"] === undefined ? 1_500 : parseDuration(values["step-ms"]);
        let state: ScenarioState | undefined;
        for (const [index, step] of steps.entries()) {
          const mode = EVENT_MODES[step];
          if (!mode) throw new UsageError(`Unbekanntes Ereignis: ${step}`);
          if (index > 0) await sleep(stepMs);
          state = await forceOrb(mode);
          if (!json) io.out(`Ereignis ${step} -> Orb ${mode}`);
        }
        if (json && state) io.out(JSON.stringify(state, null, 2));
        return 0;
      }
      case "orb": {
        const mode = rest[0];
        if (!mode || !isOrbMode(mode)) throw new UsageError(`orb: Modus fehlt oder ungültig (${ORB_MODES.join(", ")}).`);
        const state = await forceOrb(mode, {
          ...(values.text !== undefined ? { text: values.text } : {}),
          ...(values.level !== undefined ? { level: parseNumber(values.level, "--level", 0, 1) } : {}),
          ...(values.progress !== undefined ? { progress: parseNumber(values.progress, "--progress", 0, 1) } : {}),
        });
        print(state, () => [`Orb-Zustand erzwungen: ${mode}.`]);
        return 0;
      }
      case "release-orb": {
        const state = await control({ action: "release_orb_state" });
        print(state, () => ["Erzwungener Orb-Zustand freigegeben.", ...describeState(state)]);
        return 0;
      }
      case "play-event": {
        const eventType = rest[0];
        if (!eventType || !EVENT_TYPE.test(eventType)) {
          throw new UsageError("play-event: Ereignistyp fehlt oder ist ungültig (z. B. friday.orb.status_changed).");
        }
        const payload = values.payload === undefined ? undefined : parsePayload(values.payload);
        const state = await control({
          action: "play_event",
          eventType,
          ...(values.subject !== undefined ? { subject: values.subject } : {}),
          ...(payload !== undefined ? { payload } : {}),
        });
        print(state, () => [`Ereignis ${eventType} abgespielt.`]);
        return 0;
      }
      case "reset": {
        const state = await control({ action: "reset" });
        print(state, () => ["Snapshot zurückgesetzt.", ...describeState(state)]);
        return 0;
      }
      case "status": {
        const [status, orb] = await Promise.all([client.GET("/api/v1/status"), client.GET("/api/v1/orb/status")]);
        const payload = { status: status.data?.data, orb: orb.data?.data };
        print(payload, () => [
          `Status: ${payload.status?.label ?? "?"} (${payload.status?.status ?? "?"}, Datenmodus ${payload.status?.dataMode ?? "?"})`,
          `Orb:    ${payload.orb?.status.mode ?? "?"} - ${payload.orb?.status.activityText ?? ""}`,
        ]);
        return 0;
      }
      case "watch": {
        const count = values.count === undefined ? undefined : Math.round(parseNumber(values.count, "--count", 1, 1_000_000));
        const forMs = values.for === undefined ? undefined : parseDuration(values.for);
        const since = values.since === undefined ? undefined : Math.round(parseNumber(values.since, "--since", 0, Number.MAX_SAFE_INTEGER));
        const seen = await watchEvents(session, {
          ...(count !== undefined ? { count } : {}),
          ...(forMs !== undefined ? { forMs } : {}),
          ...(since !== undefined ? { since } : {}),
          ...(values.type ? { prefix: values.type } : {}),
          onEvent: (event) =>
            io.out(json ? JSON.stringify(event) : `#${event.sequence} ${event.type} ${event.subject}`),
        });
        if (!json) io.out(`${seen} Ereignis(se) empfangen.`);
        return 0;
      }
      default:
        throw new UsageError(`Unbekannter Befehl: ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`Fehler: ${error.message}`);
      io.err('Hilfe: pnpm scenario -- --help');
      return 2;
    }
    if (error instanceof FridayApiError) {
      io.err(`API-Fehler ${error.status} ${error.code}: ${error.message} (${error.correlationId})`);
      return 1;
    }
    const parseError = error instanceof Error && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS");
    io.err(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
    return parseError ? 2 : 1;
  }
}
