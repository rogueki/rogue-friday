import type { ControlFrame } from "@jarvis/sdk";

export interface TransportCloseInfo {
  code?: number;
  reason?: string;
  /** true when the transport was closed by `close()` (no reconnect wanted). */
  clean: boolean;
}

export interface TransportHandlers {
  onOpen: () => void;
  /** Raw payload: a JSON string from a WebSocket or an already parsed object from in-memory transports. */
  onMessage: (data: unknown) => void;
  onClose: (info: TransportCloseInfo) => void;
}

/**
 * Event transport behind the realtime client. The WebSocket is one implementation, the standalone mock mode
 * (`NEXT_PUBLIC_JARVIS_MSW=1`) plugs in an in-memory one; the client does not know the difference.
 */
export interface RealtimeTransport {
  connect(handlers: TransportHandlers): void;
  send(frame: ControlFrame): void;
  close(): void;
}

export interface TransportRequest {
  /** Fully resolved ws(s):// URL including `?since=` when a cursor exists. */
  url: string;
  since: number | null;
}

export type TransportFactory = (request: TransportRequest) => RealtimeTransport;

const OPEN_STATE = 1;
const CONNECTING_STATE = 0;

/** Creates the socket; the standalone mock mode passes the in-memory WebSocket of `@jarvis/mock-data`. */
export type SocketFactory = (url: string) => WebSocket;

export class WebSocketTransport implements RealtimeTransport {
  private socket: WebSocket | null = null;
  private closedByUs = false;

  constructor(
    private readonly url: string,
    private readonly createSocket: SocketFactory = (target) => new WebSocket(target),
  ) {}

  connect(handlers: TransportHandlers): void {
    this.closedByUs = false;
    let socket: WebSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      // An invalid URL or a blocked scheme throws synchronously; report it like a failed connection.
      queueMicrotask(() => handlers.onClose({ clean: false, reason: "WebSocket konnte nicht erstellt werden" }));
      return;
    }
    this.socket = socket;
    socket.onopen = () => handlers.onOpen();
    socket.onmessage = (event: MessageEvent) => handlers.onMessage(event.data);
    socket.onclose = (event: CloseEvent) => handlers.onClose({ code: event.code, reason: event.reason, clean: this.closedByUs });
    // `onerror` carries no information and is always followed by `onclose`, which drives the reconnect.
    socket.onerror = () => undefined;
  }

  send(frame: ControlFrame): void {
    if (this.socket?.readyState === OPEN_STATE) this.socket.send(JSON.stringify(frame));
  }

  close(): void {
    this.closedByUs = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    if (socket.readyState === OPEN_STATE || socket.readyState === CONNECTING_STATE) socket.close(1000, "client closing");
  }
}

export const webSocketTransportFactory: TransportFactory = ({ url }) => new WebSocketTransport(url);
