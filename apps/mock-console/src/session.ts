import { createFridayClient, type FridayClient } from "@friday/sdk";

export type DevRole = "owner" | "operator" | "viewer";

export interface ConsoleSession {
  client: FridayClient;
  baseUrl: string;
  role: DevRole;
  /** `Cookie` header value for follow-up requests (the WebSocket handshake reuses it). */
  cookieHeader(): string;
  csrfToken(): string | null;
}

export interface SessionOptions {
  baseUrl: string;
  role?: DevRole;
  fetch?: typeof globalThis.fetch;
}

/** Minimal cookie jar: Node's fetch does not keep cookies, the session cookie has to travel by hand. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const entry of response.headers.getSetCookie()) {
      const [pair] = entry.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (value === "" || /max-age=0/i.test(entry)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** Dev login (`dev-<role>` / `dev`, only offered by the Control API in mock mode on loopback) with CSRF handling. */
export async function openSession(options: SessionOptions): Promise<ConsoleSession> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const role = options.role ?? "owner";
  const jar = new CookieJar();
  const inner = options.fetch ?? globalThis.fetch;
  let csrf: string | null = null;

  const client = createFridayClient({
    baseUrl,
    fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const cookie = jar.header();
      if (cookie) request.headers.set("cookie", cookie);
      const response = await inner(request);
      jar.absorb(response);
      return response;
    },
    getCsrfToken: () => csrf,
  });

  const { data } = await client.POST("/api/v1/auth/login", { body: { username: `dev-${role}`, password: "dev" } });
  csrf = data?.data.csrfToken ?? null;
  if (!csrf) throw new Error("Dev-Anmeldung lieferte kein CSRF-Token.");
  return { client, baseUrl, role, cookieHeader: () => jar.header(), csrfToken: () => csrf };
}
