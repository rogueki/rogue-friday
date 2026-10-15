import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import type { RawVoiceStatus } from "../../adapters/voice-http/src/provider-types";
import { createHermesFake, type HermesFake } from "../../adapters/hermes/test/fake/server";
import { createFakeVoiceService, type FakeVoiceService } from "../../adapters/voice-http/test/fake/voice-status-server";
import { seedHermes } from "./seed";
import { TcpFront } from "./tcp-front";

/** Installer-standard ports (docs/INSTALLER_INTEGRATION_REVIEW.md §3.1). */
export const DEFAULT_PORTS = { hermesDashboard: 43691, llama: 43692, hermesApi: 43693, voice: 43694, control: 43699 } as const;

export type ServiceName = "hermes-api" | "hermes-dashboard" | "voice" | "llama";
export const SERVICE_NAMES: readonly ServiceName[] = ["hermes-api", "hermes-dashboard", "voice", "llama"];

export interface FakeUpstreamOptions {
  host?: string;
  /** `0` picks a free port (tests); the installer ports are the default. */
  ports?: Partial<Record<keyof typeof DEFAULT_PORTS, number>>;
  /** Written with the fake `API_SERVER_KEY`, like the installer's `C:\Friday\config\hermes_api.key`. */
  keyFile?: string;
  /** Overrides the generated API key (tests that must know it). */
  apiKey?: string;
  /** Seed the Hermes board and sessions (default true). */
  seed?: boolean;
  /** Log lines (default silent). */
  log?: (line: string) => void;
}

export interface FakeUpstreams {
  readonly host: string;
  readonly ports: { hermesDashboard: number; llama: number; hermesApi: number; voice: number; control: number };
  readonly urls: { hermesDashboard: string; llama: string; hermesApi: string; voice: string; control: string };
  readonly apiKey: string;
  readonly hermes: HermesFake;
  readonly voice: FakeVoiceService;
  isRunning(name: ServiceName): boolean;
  /** Closes the fixed port (ECONNREFUSED for clients) while keeping the fake's state. */
  stop(name: ServiceName | "hermes"): Promise<void>;
  start(name: ServiceName | "hermes"): Promise<void>;
  close(): Promise<void>;
}

/** llama-server as started by installer/scripts/start-qwen-server.ps1 (`--alias qwen3-router`), see docs/MAPPING/qwen.md. */
async function startLlamaFake(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ object: "list", data: [{ id: "qwen3-router", object: "model", created: 1_760_000_000, owned_by: "llamacpp" }] }),
      );
    } else if (request.method === "GET" && path === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
    } else {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "File Not Found", code: 404 } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function startFakeUpstreams(options: FakeUpstreamOptions = {}): Promise<FakeUpstreams> {
  const host = options.host ?? "127.0.0.1";
  const wanted = { ...DEFAULT_PORTS, ...options.ports };
  const log = options.log ?? (() => undefined);

  const hermes = await createHermesFake();
  const apiKey = options.apiKey ?? `fake-${randomBytes(18).toString("hex")}`;
  hermes.state.apiKey = apiKey;
  if (options.seed !== false) seedHermes(hermes.state);
  if (options.keyFile) {
    mkdirSync(dirname(options.keyFile), { recursive: true });
    writeFileSync(options.keyFile, `${apiKey}\n`, { mode: 0o600 });
  }
  const voice = await createFakeVoiceService();
  const llama = await startLlamaFake();

  const backendPort = (url: string) => () => Number(new URL(url).port);
  const fronts: Record<ServiceName, TcpFront> = {
    "hermes-dashboard": new TcpFront("hermes-dashboard", host, wanted.hermesDashboard, backendPort(hermes.dashboardUrl)),
    "hermes-api": new TcpFront("hermes-api", host, wanted.hermesApi, backendPort(hermes.apiUrl)),
    voice: new TcpFront("voice", host, wanted.voice, () => voice.port),
    llama: new TcpFront("llama", host, wanted.llama, () => llama.port),
  };
  await Promise.all(Object.values(fronts).map((front) => front.start()));

  const expand = (name: ServiceName | "hermes"): ServiceName[] => (name === "hermes" ? ["hermes-api", "hermes-dashboard"] : [name]);
  const stop = async (name: ServiceName | "hermes"): Promise<void> => {
    for (const service of expand(name)) {
      await fronts[service].stop();
      log(`${service} gestoppt (Port ${fronts[service].port} geschlossen)`);
    }
  };
  const start = async (name: ServiceName | "hermes"): Promise<void> => {
    for (const service of expand(name)) {
      await fronts[service].start();
      log(`${service} gestartet (Port ${fronts[service].port})`);
    }
  };

  const control = createControlServer({ fronts, stop, start, hermes, voice, apiKeyFile: options.keyFile });
  await new Promise<void>((resolve, reject) => {
    control.once("error", reject);
    control.listen(wanted.control, host, () => resolve());
  });
  const controlPort = (control.address() as AddressInfo).port;

  const ports = {
    hermesDashboard: fronts["hermes-dashboard"].port,
    llama: fronts.llama.port,
    hermesApi: fronts["hermes-api"].port,
    voice: fronts.voice.port,
    control: controlPort,
  };
  const url = (port: number): string => `http://${host}:${port}`;
  return {
    host,
    ports,
    urls: {
      hermesDashboard: url(ports.hermesDashboard),
      llama: url(ports.llama),
      hermesApi: url(ports.hermesApi),
      voice: url(ports.voice),
      control: url(ports.control),
    },
    apiKey,
    hermes,
    voice,
    isRunning: (name) => fronts[name].running,
    stop,
    start,
    async close() {
      await new Promise<void>((resolve) => control.close(() => resolve()));
      control.closeAllConnections();
      await Promise.all(Object.values(fronts).map((front) => front.stop()));
      await Promise.all([hermes.close(), voice.close(), llama.close()]);
    },
  };
}

interface ControlDeps {
  fronts: Record<ServiceName, TcpFront>;
  stop(name: ServiceName | "hermes"): Promise<void>;
  start(name: ServiceName | "hermes"): Promise<void>;
  hermes: HermesFake;
  voice: FakeVoiceService;
  apiKeyFile: string | undefined;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON object expected");
  return parsed as Record<string, unknown>;
}

const isServiceName = (value: string): value is ServiceName | "hermes" => value === "hermes" || (SERVICE_NAMES as readonly string[]).includes(value);

/**
 * Control endpoint to simulate outages at runtime:
 *   GET  /services                   state of the four services
 *   POST /services/:name/stop        name = hermes-api | hermes-dashboard | hermes (both) | voice | llama
 *   POST /services/:name/start
 *   POST /voice/status               body = partial voice status (state, speaking, trusted, ...)
 *   POST /hermes/tasks               body = { title, assignee?, status?, priority? } adds a Kanban task
 */
function createControlServer(deps: ControlDeps): Server {
  const reply = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const snapshot = () => ({
    services: SERVICE_NAMES.map((name) => ({ name, port: deps.fronts[name].port, running: deps.fronts[name].running })),
    apiKeyFile: deps.apiKeyFile ?? null,
  });
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";
      try {
        if (method === "GET" && url.pathname === "/services") return reply(response, 200, snapshot());
        const serviceMatch = /^\/services\/([a-z-]+)\/(stop|start)$/.exec(url.pathname);
        if (method === "POST" && serviceMatch) {
          const name = serviceMatch[1] as string;
          if (!isServiceName(name)) return reply(response, 404, { error: `unknown service ${name}` });
          if (serviceMatch[2] === "stop") await deps.stop(name);
          else await deps.start(name);
          return reply(response, 200, snapshot());
        }
        if (method === "POST" && url.pathname === "/voice/status") {
          deps.voice.patchStatus((await readJson(request)) as Partial<RawVoiceStatus>);
          return reply(response, 200, { ok: true });
        }
        if (method === "POST" && url.pathname === "/hermes/tasks") {
          const body = await readJson(request);
          if (typeof body.title !== "string" || body.title === "") return reply(response, 400, { error: "title required" });
          const task = deps.hermes.state.addTask("default", {
            title: body.title,
            ...(typeof body.assignee === "string" ? { assignee: body.assignee } : {}),
            ...(typeof body.status === "string" ? { status: body.status } : {}),
            ...(typeof body.priority === "number" ? { priority: body.priority } : {}),
          });
          return reply(response, 201, { id: task.id });
        }
        return reply(response, 404, { error: "not found" });
      } catch (error) {
        return reply(response, 400, { error: error instanceof Error ? error.message : "bad request" });
      }
    })();
  });
}
