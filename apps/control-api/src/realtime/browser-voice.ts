import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import type { Runtime } from "../runtime/types";
import type { HubPrincipal } from "./hub";
import { BrowserVoiceTelemetry } from "./browser-voice-telemetry";

export const BROWSER_AUDIO_PATH = "/api/v1/voice/browser-audio";
const FRAME_BYTES = 2_560;
const FRAME_MS = 80;
const MAX_BUFFERED = FRAME_BYTES * 50;

export class BrowserVoiceGateway {
  private readonly server = new WebSocketServer({ noServer: true, maxPayload: FRAME_BYTES, perMessageDeflate: false });
  private active: { browser: WebSocket; voice: WebSocket; principal: HubPrincipal } | null = null;

  constructor(private readonly runtime: Runtime) {}

  private voiceUrl(): { health: URL; audio: URL } | null {
    if (process.platform !== "linux" || this.runtime.config.adapters.voice.provider !== "friday-voice-http") return null;
    const configured = this.runtime.config.adapters.voice.config.baseUrl;
    if (typeof configured !== "string") return null;
    try {
      const health = new URL(configured);
      if (health.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(health.hostname) || health.username || health.password || !health.port) return null;
      const port = Number(health.port);
      if (!Number.isInteger(port) || port < 1 || port >= 65535) return null;
      health.pathname = "/";
      health.search = "";
      health.hash = "";
      const audio = new URL(health);
      audio.protocol = "ws:";
      audio.port = String(port + 1);
      audio.pathname = "/audio";
      return { health, audio };
    } catch { return null; }
  }

  async available(): Promise<boolean> {
    if (!this.runtime.auth.ownerPasswordConfigured() || !this.voiceUrl() || this.active) return false;
    try {
      const response = await fetch(this.voiceUrl()!.health, { signal: AbortSignal.timeout(1_000), redirect: "error" });
      if (!response.ok) return false;
      const body: unknown = await response.json();
      return typeof body === "object" && body !== null && (body as { audio_transport?: unknown }).audio_transport === "browser";
    } catch { return false; }
  }

  async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, principal: HubPrincipal): Promise<void> {
    const reject = (status: number): void => {
      if (!socket.destroyed) {
        socket.write(`HTTP/1.1 ${status} ${status === 409 ? "Conflict" : "Service Unavailable"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        socket.destroy();
      }
    };
    if (this.active) return reject(409);
    if (!(await this.available())) return reject(503);
    const target = this.voiceUrl();
    if (!target || socket.destroyed) return reject(503);
    const voice = new WebSocket(target.audio, {
      headers: { Authorization: `Bearer ${this.runtime.voiceBridgeKey.toString("base64")}` },
      handshakeTimeout: 2_000,
      perMessageDeflate: false,
    });
    try {
      await new Promise<void>((resolve, rejectConnection) => {
        voice.once("open", resolve);
        voice.once("error", rejectConnection);
        voice.once("unexpected-response", (_request, response) => rejectConnection(new Error(`voice ${response.statusCode}`)));
      });
    } catch {
      voice.terminate();
      return reject(503);
    }
    // The owner may log out while the backend WebSocket handshake is pending.
    const current = this.runtime.auth.authenticate(request.headers.cookie);
    if (!current || current.role !== "owner" || current.session.idHash !== principal.sessionIdHash) {
      voice.close();
      return reject(401);
    }
    if (this.active || socket.destroyed) { voice.close(); return reject(409); }
    this.server.handleUpgrade(request, socket, head, (browser) => this.accept(browser, voice, principal));
  }

  private accept(browser: WebSocket, voice: WebSocket, principal: HubPrincipal): void {
    const pair = { browser, voice, principal };
    this.active = pair;
    let lastFrame = performance.now();
    let tokens = 4;
    // Real frame-level telemetry (audio levels with bands, TTS start/end). Phases come from the voice adapter.
    const configured = this.runtime.config.adapters.voice.config.ttsEngine;
    const telemetry = new BrowserVoiceTelemetry({
      now: Date.now,
      ttsEngine: typeof configured === "string" && configured.length > 0 ? configured : "ElevenLabs",
      publish: (event) => {
        switch (event.type) {
          case "friday.voice.audio_level": this.runtime.hub.publish("control-api://browser-voice", event); break;
          case "friday.voice.tts_started": this.runtime.hub.publish("control-api://browser-voice", event); break;
          case "friday.voice.tts_ended": this.runtime.hub.publish("control-api://browser-voice", event); break;
        }
      },
    });
    const unsubscribe = this.runtime.hub.subscribe((event) => {
      if (event.type === "friday.voice.state_changed") telemetry.setVoiceMode((event.data as { mode: string }).mode);
    });
    let cleaned = false;
    const stop = (): void => {
      // Runs for every close path (also when closeSession/closeUser/close already cleared `active`).
      if (!cleaned) {
        cleaned = true;
        unsubscribe();
        telemetry.close();
      }
      if (this.active !== pair) return;
      this.active = null;
      if (voice.readyState === WebSocket.OPEN) voice.send('{"type":"stop"}');
      browser.close();
      voice.close();
      setTimeout(() => { browser.terminate(); voice.terminate(); }, 500).unref?.();
    };
    browser.on("message", (data, binary) => {
      if (voice.readyState !== WebSocket.OPEN || voice.bufferedAmount > MAX_BUFFERED) return stop();
      if (binary) {
        const frame = Buffer.from(data as Buffer);
        if (frame.length !== FRAME_BYTES) return stop();
        const now = performance.now();
        tokens = Math.min(4, tokens + (now - lastFrame) / FRAME_MS);
        lastFrame = now;
        if (tokens < 1) return stop();
        tokens -= 1;
        telemetry.onInputFrame(frame);
        voice.send(frame, { binary: true });
      } else {
        let command: unknown;
        try { command = JSON.parse(data.toString()); } catch { return stop(); }
        if (!command || typeof command !== "object" || Object.keys(command).length !== 1 || !["stop", "pause", "resume", "start", "release"].includes(String((command as { type?: unknown }).type))) return stop();
        voice.send(JSON.stringify(command));
      }
    });
    voice.on("message", (data, binary) => {
      if (browser.readyState !== WebSocket.OPEN || browser.bufferedAmount > MAX_BUFFERED) return stop();
      if (binary && Buffer.byteLength(data as Buffer) !== FRAME_BYTES) return stop();
      if (binary) telemetry.onOutputFrame(data as Buffer);
      else if (Buffer.byteLength(data as Buffer) <= 512) telemetry.onVoiceControl(data.toString());
      browser.send(data, { binary });
    });
    browser.on("close", stop);
    browser.on("error", stop);
    voice.on("close", stop);
    voice.on("error", stop);
  }

  closeSession(hash: string): number {
    if (!this.active || this.active.principal.sessionIdHash !== hash) return 0;
    this.active.browser.close(4401, "session ended");
    this.active.voice.close();
    this.active = null;
    return 1;
  }

  closeUser(userId: string): number {
    if (!this.active || this.active.principal.userId !== userId) return 0;
    this.active.browser.close(4401, "session ended");
    this.active.voice.close();
    this.active = null;
    return 1;
  }

  async close(): Promise<void> {
    if (this.active) {
      this.active.browser.terminate();
      this.active.voice.terminate();
      this.active = null;
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
