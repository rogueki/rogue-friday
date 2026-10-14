/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import WebSocket from "ws";
import type { ApiClient, TestApi } from "../helpers";

export interface Frame {
  raw: string;
  json: any;
}

/** Records every frame of one WebSocket connection and lets tests wait for conditions. */
export class WsProbe {
  readonly frames: Frame[] = [];
  closed: { code: number; reason: string } | null = null;
  private readonly waiters: Array<() => void> = [];
  autoPong = true;

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const raw = data.toString();
      const frame: Frame = { raw, json: JSON.parse(raw) };
      this.frames.push(frame);
      if (this.autoPong && frame.json.kind === "ping") socket.send(JSON.stringify({ kind: "pong", ts: frame.json.ts }));
      this.notify();
    });
    socket.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.notify();
    });
    socket.on("error", () => this.notify());
  }

  private notify(): void {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  /** Resolves with an open connection, or rejects with the HTTP status of a refused upgrade. */
  static connect(api: TestApi, client: ApiClient | null, options: { since?: number | string; origin?: string; path?: string; host?: string } = {}): Promise<WsProbe> {
    const query = options.since === undefined ? "" : `?since=${options.since}`;
    const headers: Record<string, string> = { origin: options.origin ?? api.origin };
    if (client && client.cookies.size > 0) headers.cookie = [...client.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    if (options.host) headers.host = options.host;
    const socket = new WebSocket(`ws://127.0.0.1:${api.port}${options.path ?? "/api/v1/events"}${query}`, { headers });
    return new Promise((resolve, reject) => {
      socket.once("open", () => resolve(new WsProbe(socket)));
      socket.once("unexpected-response", (_request, response) => reject(Object.assign(new Error(`HTTP ${response.statusCode}`), { status: response.statusCode })));
      socket.once("error", (error) => reject(error));
    });
  }

  async waitFor(predicate: (probe: WsProbe) => boolean, timeoutMs = 3_000, what = "Bedingung"): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(this)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timeout (${timeoutMs} ms) beim Warten auf: ${what}; ${this.frames.length} Frame(s), geschlossen: ${JSON.stringify(this.closed)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  events(): any[] {
    return this.frames.map((frame) => frame.json).filter((json) => json.kind === undefined);
  }

  close(): void {
    this.socket.close();
  }
}
