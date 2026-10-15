import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { hashPassword } from "@jarvis/auth";
import { loadConfig, type JarvisConfig } from "@jarvis/config";
import { createLogger } from "@jarvis/observability";
import { createControlApi, type ControlApi } from "../src/app";
import type { ResponseValidationMode } from "../src/runtime/types";

export interface TestApiOptions {
  authMode?: "dev" | "local";
  ownerPassword?: string;
  dataMode?: "mock" | "hybrid";
  yamlExtra?: string;
  secureCookies?: boolean;
  adaptersYaml?: string;
  responseValidation?: ResponseValidationMode;
  heartbeatSeconds?: number;
  ringBufferSize?: number;
  env?: Record<string, string>;
  /** Re-use an existing temp dir (restart tests). */
  dir?: string;
  scenarioConsole?: boolean;
  healthIntervalMs?: number;
  listen?: boolean;
  background?: boolean;
  now?: () => number;
  approvalTokenTtlMs?: number;
  worldProfile?: string;
  /** Receives every log line (JSON) the API writes, to scan for leaks. */
  logs?: string[];
}

export interface TestApi extends ControlApi {
  dir: string;
  config: JarvisConfig;
  port: number;
  origin: string;
  env: NodeJS.ProcessEnv;
  close(): Promise<void>;
  client(): ApiClient;
}

export async function startTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "jarvis-api-"));
  const configDir = join(dir, "config");
  mkdirSync(configDir, { recursive: true });
  const authMode = options.authMode ?? "dev";
  writeFileSync(
    join(configDir, "dashboard.yaml"),
    `dataMode: ${options.dataMode ?? "mock"}
server:
  host: 127.0.0.1
  port: 3100
paths:
  dataDir: ../data
  logDir: ../logs
  backupDir: ../backups
  webRoot: ../web
auth:
  mode: ${authMode}
  ownerUsername: owner
  ownerPasswordHash: env:JARVIS_OWNER_PASSWORD_HASH
  secureCookies: ${options.secureCookies ?? false}
realtime:
  ringBufferSize: ${options.ringBufferSize ?? 5000}
  heartbeatSeconds: ${options.heartbeatSeconds ?? 15}
dev:
  scenarioConsole: ${options.scenarioConsole ?? true}
  responseValidation: true
logging:
  level: error
  file:
    enabled: false
${options.yamlExtra ?? ""}
`,
  );
  if (options.adaptersYaml) writeFileSync(join(configDir, "adapters.yaml"), options.adaptersYaml);
  const env: NodeJS.ProcessEnv = { ...options.env };
  if (options.ownerPassword) env.JARVIS_OWNER_PASSWORD_HASH = await hashPassword(options.ownerPassword);
  const config = loadConfig({ configDir, cwd: dir, env });

  const logger = options.logs
    ? createLogger({ service: "control-api", level: "debug", stdout: false, sinks: [{ write: (line: string) => void options.logs?.push(line) }] })
    : undefined;
  const api = await createControlApi({
    config,
    env,
    ...(logger ? { logger } : {}),
    responseValidation: options.responseValidation ?? "throw",
    realTimeWorld: false,
    background: options.background ?? false,
    healthIntervalMs: options.healthIntervalMs ?? 3_600_000,
    strictEvents: true,
    ...(options.now ? { now: options.now } : {}),
    ...(options.approvalTokenTtlMs !== undefined ? { approvalTokenTtlMs: options.approvalTokenTtlMs } : {}),
    ...(options.worldProfile ? { worldProfile: options.worldProfile } : {}),
  });
  await api.app.init();
  let port = 0;
  if (options.listen) {
    await api.app.listen(0, "127.0.0.1");
    const address = api.app.getHttpServer().address();
    port = typeof address === "object" && address ? address.port : 0;
  } else {
    await api.fastify.ready();
  }
  const testApi: TestApi = {
    ...api,
    dir,
    config,
    port,
    env,
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await api.app.close();
      if (!options.dir) rmSync(dir, { recursive: true, force: true });
    },
    client: () => new ApiClient(api),
  };
  return testApi;
}

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | string[]>;
  csrf?: boolean;
  noCookies?: boolean;
  rawBody?: string;
}

/** Minimal cookie-aware client over `fastify.inject`. */
export class ApiClient {
  cookies = new Map<string, string>();
  csrfToken: string | null = null;

  constructor(private readonly api: ControlApi) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private absorb(response: LightMyRequestResponse): void {
    const raw = response.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const entry of list) {
      const [pair] = entry.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === "" || /Max-Age=0/i.test(entry)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method: string, path: string, options: CallOptions = {}): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { host: "127.0.0.1:3100", ...options.headers };
    if (!options.noCookies && this.cookies.size > 0) headers.cookie = this.cookieHeader();
    if (options.csrf !== false && this.csrfToken && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] ??= this.csrfToken;
    const hasBody = options.body !== undefined || options.rawBody !== undefined;
    if (hasBody) headers["content-type"] ??= "application/json";
    const response = await this.api.fastify.inject({
      method: method as "GET",
      url: path,
      headers,
      ...(hasBody ? { payload: options.rawBody ?? JSON.stringify(options.body) } : {}),
      ...(options.query ? { query: options.query } : {}),
    });
    this.absorb(response);
    return response;
  }

  get(path: string, options?: CallOptions) {
    return this.request("GET", path, options);
  }
  post(path: string, body?: unknown, options: CallOptions = {}) {
    return this.request("POST", path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
  patch(path: string, body?: unknown, options: CallOptions = {}) {
    return this.request("PATCH", path, { ...options, ...(body !== undefined ? { body } : {}) });
  }
  delete(path: string, options?: CallOptions) {
    return this.request("DELETE", path, options);
  }

  /** Dev auth: bootstrap with GET /auth/session (issues the owner session) or log in as another dev role. */
  async loginDev(role: "owner" | "operator" | "viewer" = "owner"): Promise<void> {
    const response = await this.post("/api/v1/auth/login", { username: `dev-${role}`, password: "dev" });
    if (response.statusCode !== 200) throw new Error(`dev login failed: ${response.statusCode} ${response.body}`);
    this.csrfToken = (response.json() as { data: { csrfToken: string } }).data.csrfToken;
  }

  async loginOwner(password: string): Promise<LightMyRequestResponse> {
    const response = await this.post("/api/v1/auth/login", { username: "owner", password });
    if (response.statusCode === 200) this.csrfToken = (response.json() as { data: { csrfToken: string } }).data.csrfToken;
    return response;
  }
}
