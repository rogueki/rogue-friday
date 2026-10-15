import { createServer, type Server, type Socket } from "node:net";
import type { RawVoiceStatus } from "../../src/provider-types";

/**
 * Wire-level replica of the status server in installer/voice/friday_voice.py (`_start_health`, JV:576-592):
 * - exactly one handler: every GET path returns the same JSON, other methods get Python's `501 Unsupported method`;
 * - HTTP/1.0, `Content-Type: application/json`, no `Content-Length`, connection closed after the body;
 * - key order of the JSON as written by `json.dumps({**status, "speaking": ..., "trusted": ..., "input_level": ..., "output_level": ...})`
 *   (the two level keys are optional in the fake: older services do not send them);
 * - the port is closed while the service loads its models (`setOffline(true)`).
 */

/** What a freshly started service reports once its input stream runs (JV:276, 472). */
export function makeVoiceStatus(patch: Partial<RawVoiceStatus> = {}): RawVoiceStatus {
  return {
    state: "listening",
    started: "2026-10-14T09:12:03",
    last_event: null,
    wake_count: 0,
    rejected_speaker: 0,
    commands: 0,
    speaking: false,
    trusted: false,
    ...patch,
  };
}

export type VoiceFault =
  /** Valid HTTP, body is not JSON. */
  | "invalid-json"
  /** Valid JSON with a shape the adapter cannot map (state unknown). */
  | "invalid-shape"
  /** HTTP 500 from the service. */
  | "http-500"
  /** Accepts the connection and never answers. */
  | "silent"
  /** Resets the connection without an answer. */
  | "drop";

export interface FakeVoiceService {
  readonly url: string;
  readonly port: number;
  /** Request lines received so far, e.g. `GET /status HTTP/1.1`. */
  readonly requestLines: string[];
  setStatus(status: RawVoiceStatus): void;
  patchStatus(patch: Partial<RawVoiceStatus>): void;
  /** Applies to every following request until cleared (`null`). */
  setFault(fault: VoiceFault | null): void;
  /** Applies to the next requests only, one entry per request, then the service behaves normally again. */
  failNext(faults: VoiceFault[]): void;
  /** Closes the listening port (ECONNREFUSED), like the service while it loads its models; `false` reopens it. */
  setOffline(offline: boolean): Promise<void>;
  close(): Promise<void>;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  500: "Internal Server Error",
  501: "Unsupported method",
};

function response(status: number, body?: string, reason?: string): string {
  const head = [
    `HTTP/1.0 ${status} ${reason ?? STATUS_TEXT[status] ?? "Status"}`,
    "Server: BaseHTTP/0.6 Python/3.12.7",
    "Date: Wed, 14 Oct 2026 09:12:03 GMT",
  ];
  if (body !== undefined) head.push("Content-Type: application/json");
  return `${head.join("\r\n")}\r\n\r\n${body ?? ""}`;
}

export async function createFakeVoiceService(): Promise<FakeVoiceService> {
  let status = makeVoiceStatus();
  let fault: VoiceFault | null = null;
  const queue: VoiceFault[] = [];
  const requestLines: string[] = [];
  const sockets = new Set<Socket>();
  let server: Server;
  let port = 0;

  const serve = (socket: Socket): void => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      const end = buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const requestLine = buffer.slice(0, buffer.indexOf("\r\n"));
      requestLines.push(requestLine);
      socket.removeAllListeners("data");
      const active = queue.shift() ?? fault;
      const method = requestLine.split(" ")[0] ?? "";
      if (active === "silent") return;
      if (active === "drop") {
        socket.destroy();
        return;
      }
      if (method !== "GET") {
        socket.end(response(501, undefined, `Unsupported method ('${method}')`));
        return;
      }
      if (active === "http-500") socket.end(response(500, '{"error":"boom"}'));
      else if (active === "invalid-json") socket.end(response(200, "{state: listening"));
      else if (active === "invalid-shape")
        socket.end(response(200, JSON.stringify({ ...status, state: "booting-up" })));
      else socket.end(response(200, JSON.stringify(status)));
    });
  };

  const listen = async (wantedPort: number): Promise<void> => {
    server = createServer(serve);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(wantedPort, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    port = (server.address() as { port: number }).port;
  };
  const stopListening = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  await listen(0);
  let offline = false;
  return {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    get port() {
      return port;
    },
    requestLines,
    setStatus(next) {
      status = next;
    },
    patchStatus(patch) {
      status = { ...status, ...patch };
    },
    setFault(next) {
      fault = next;
    },
    failNext(faults) {
      queue.push(...faults);
    },
    async setOffline(next) {
      if (next === offline) return;
      offline = next;
      if (next) await stopListening();
      else await listen(port);
    },
    async close() {
      if (!offline) await stopListening();
      offline = true;
    },
  };
}
