import type { FakeUpstream } from "@jarvis/adapter-testkit";

/**
 * Hermes API server on 43693 as documented in docs/MAPPING/hermes.md §3 (live-tested there):
 * `GET /health` needs no key, `GET /v1/models` needs `Authorization: Bearer <API_SERVER_KEY>` and lists `jarvis`;
 * a wrong or missing key is HTTP 401 with the gateway's error body.
 */
export interface FakeHermes {
  /** Bearer values the server accepted on `/v1/models`. */
  readonly acceptedKeys: string[];
}

export function installHermesApi(
  upstream: FakeUpstream,
  options: { apiKey: string; models?: string[] },
): FakeHermes {
  const models = options.models ?? ["jarvis"];
  const acceptedKeys: string[] = [];
  upstream.route("GET", "/health", { body: { status: "ok", platform: "hermes-agent", version: "unknown" } });
  upstream.route("GET", "/v1/models", (request) => {
    const header = request.headers.authorization ?? "";
    if (header !== `Bearer ${options.apiKey}`) {
      return {
        status: 401,
        body: {
          error: {
            message: "Invalid gateway API key (API_SERVER_KEY)",
            type: "gateway_auth_error",
            code: "gateway_auth_failed",
          },
        },
      };
    }
    acceptedKeys.push(header.slice("Bearer ".length));
    return {
      body: {
        object: "list",
        data: models.map((id) => ({
          id,
          object: "model",
          created: 1_760_000_000,
          owned_by: "hermes",
          permission: [],
          root: id,
          parent: null,
        })),
      },
    };
  });
  return { acceptedKeys };
}

/** Hermes dashboard on 43691. `/api/health` and its (missing) authentication are Annahme (unbelegt). */
export function installHermesDashboard(upstream: FakeUpstream): void {
  upstream.route("GET", "/api/health", { body: { status: "ok" } });
}
