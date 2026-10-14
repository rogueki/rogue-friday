import type { FakeUpstream } from "@jarvis/adapter-testkit";

/**
 * llama-server as started by installer/scripts/start-qwen-server.ps1 (`--alias qwen3-router`, no `--api-key`).
 * Only `GET /v1/models` is evidenced by the installer (IP:348); the answer shape is an OpenAI-style list
 * (Annahme (unbelegt), docs/MAPPING/qwen.md §2.2).
 */
export function installLlamaServer(upstream: FakeUpstream, options: { models?: string[] } = {}): void {
  const models = options.models ?? ["qwen3-router"];
  upstream.route("GET", "/v1/models", () => ({
    body: {
      object: "list",
      data: models.map((id) => ({ id, object: "model", created: 1_760_000_000, owned_by: "llamacpp" })),
    },
  }));
}
