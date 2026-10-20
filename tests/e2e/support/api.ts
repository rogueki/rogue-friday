import { API_BASE, DEV_PASSWORD, devUser, type DevRole } from "./constants";

export interface ApiResult<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped JSON read by the assertions
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Tiny Control API client for test set-up and verification (Node `fetch`, own cookie jar, CSRF double-submit).
 * It talks to the same instance the browser uses but is independent of the UI, so a spec can prove a UI action
 * reached the server without trusting the UI's own rendering.
 */
export class ApiClient {
  private cookies = new Map<string, string>();
  private csrf = "";

  static async login(role: DevRole = "owner"): Promise<ApiClient> {
    const client = new ApiClient();
    const result = await client.request("POST", "/auth/login", { username: devUser(role), password: DEV_PASSWORD });
    if (result.status !== 200) throw new Error(`Login ${role} fehlgeschlagen: ${result.status} ${JSON.stringify(result.body)}`);
    return client;
  }

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...(method !== "GET" && method !== "HEAD" && !headers["Idempotency-Key"] ? { "idempotency-key": `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}` } : {}),
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index);
      const value = pair!.slice(index + 1);
      this.cookies.set(name, value);
      if (name === "friday_csrf") this.csrf = value;
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body (static file) stays text */
    }
    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  get = <T = any>(path: string) => this.request<T>("GET", path); // eslint-disable-line @typescript-eslint/no-explicit-any
  post = <T = any>(path: string, body?: unknown, headers?: Record<string, string>) => this.request<T>("POST", path, body ?? {}, headers); // eslint-disable-line @typescript-eslint/no-explicit-any
  patch = <T = any>(path: string, body: unknown, headers?: Record<string, string>) => this.request<T>("PATCH", path, body, headers); // eslint-disable-line @typescript-eslint/no-explicit-any

  /**
   * Creates a task for test set-up through the real staged direct-API flow (403 preview → confirm with
   * `X-Action-Preview-Id` → tier-2 approval with the one-time approval token), exactly as the web UI drives it.
   * Returns the created task. Fails loudly on any unexpected stage instead of silently seeding nothing.
   */
  async createTask(body: { title: string; priority?: string }): Promise<{ id: string; title: string }> {
    const staged = await this.post("/tasks", body);
    if (staged.status !== 403 || staged.body?.error?.details?.stage !== "preview") {
      throw new Error(`Task-Staging fehlgeschlagen: ${staged.status} ${JSON.stringify(staged.body)}`);
    }
    const previewId = staged.body.error.details.previewId as string;
    const confirmed = await this.post("/tasks", body, { "X-Action-Preview-Id": previewId });
    if (confirmed.status === 201 || confirmed.status === 200) return confirmed.body.data;
    if (confirmed.status !== 403 || confirmed.body?.error?.details?.stage !== "approval") {
      throw new Error(`Task-Bestätigung fehlgeschlagen: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
    }
    const approvalId = confirmed.body.error.details.approvalId as string;
    const opened = await this.get(`/approvals/${approvalId}`);
    const token = opened.headers.get("x-approval-token");
    if (opened.status !== 200 || !token) throw new Error(`Freigabe ${approvalId} nicht lesbar: ${opened.status}`);
    const decision = await this.post(`/approvals/${approvalId}/approve`, {}, { "x-approval-token": token });
    if (decision.status !== 200) throw new Error(`Freigabe ${approvalId} fehlgeschlagen: ${decision.status} ${JSON.stringify(decision.body)}`);
    const receipt = String(decision.body.data?.executionResult ?? "");
    const taskId = /^Aufgabe (task_[0-9A-Za-z]{26}) angelegt\.$/.exec(receipt)?.[1];
    if (!taskId) throw new Error(`Unerwarteter Ausführungsbeleg: ${receipt}`);
    const task = await this.get(`/tasks/${taskId}`);
    if (task.status !== 200) throw new Error(`Angelegte Aufgabe ${taskId} nicht lesbar: ${task.status}`);
    return task.body.data;
  }

  /** Cookies of this session, for seeding a browser context without going through the login form. */
  cookieList(): Array<{ name: string; value: string; url: string }> {
    return [...this.cookies].map(([name, value]) => ({ name, value, url: new URL(API_BASE).origin }));
  }

  // ---- dev scenario console (PLAN §44.6) ----
  control = (body: Record<string, unknown>) => this.post("/dev/scenarios/control", body);
  /** Reset to the seeded world: seed 42, simulated clock 08:15:00, no overrides, no forced orb mode. */
  async reset(): Promise<void> {
    const result = await this.control({ action: "reset" });
    if (result.status !== 200) throw new Error(`Szenario-Reset fehlgeschlagen: ${result.status}`);
  }
  async play(id: string, speed = 1): Promise<void> {
    const result = await this.post(`/dev/scenarios/${id}/play${speed !== 1 ? `?speed=${speed}` : ""}`);
    if (result.status >= 300) throw new Error(`Szenario ${id} fehlgeschlagen: ${result.status} ${JSON.stringify(result.body)}`);
  }
  /** Forces an orb mode (PLAN §44.6); `null` releases it so the orb follows the derived state again. */
  async forceOrb(mode: string | null, extra: Record<string, unknown> = {}): Promise<void> {
    const result = await this.control(mode === null ? { action: "release_orb_state" } : { action: "force_orb_state", mode, ...extra });
    if (result.status !== 200) throw new Error(`force_orb_state ${String(mode)}: ${result.status} ${JSON.stringify(result.body)}`);
  }
}
