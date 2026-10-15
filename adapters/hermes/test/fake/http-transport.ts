import { createHttpClient, normalizeError, type HttpClient } from "@friday/adapter-core";
import { parseEventBatch } from "../../src/wire";
import type { KanbanDrainRequest, KanbanDrainResult, KanbanEventTransport } from "../../src/kanban-feed";

/**
 * Test double of the event transport for the testkit's HTTP-only upstream: reads the HTTP twin of the stream
 * (`GET /api/plugins/kanban/events?board=&since=`, same payload as one WebSocket message). Errors go through the same
 * normalisation as every adapter HTTP call.
 */
export class HttpPollKanbanTransport implements KanbanEventTransport {
  private client: HttpClient | undefined;

  async drain(request: KanbanDrainRequest): Promise<KanbanDrainResult> {
    this.client ??= createHttpClient({
      baseUrl: request.baseUrl,
      timeoutMs: 250,
      retry: false,
      circuitBreaker: false,
    });
    try {
      const response = await this.client.request({
        method: "GET",
        path: "/api/plugins/kanban/events",
        query: { board: request.board, since: request.since },
        headers: { "x-hermes-session-token": request.token },
        signal: request.signal,
        operation: "pollEvents",
        retry: false,
      });
      const batch = parseEventBatch(response.body);
      return { events: batch.events, cursor: batch.cursor };
    } catch (error) {
      throw normalizeError(error, { operation: "pollEvents" });
    }
  }
}
