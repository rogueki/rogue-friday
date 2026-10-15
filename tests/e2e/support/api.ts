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
