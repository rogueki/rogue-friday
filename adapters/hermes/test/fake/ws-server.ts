import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Server-to-client text frame (unmasked). */
export function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

export function closeFrame(code: number): Buffer {
  const frame = Buffer.alloc(4);
  frame[0] = 0x88;
  frame[1] = 2;
  frame.writeUInt16BE(code, 2);
  return frame;
}

export interface WebSocketPeer {
  send(text: string): void;
  close(code: number): void;
  readonly closed: boolean;
}

/**
 * Completes the RFC 6455 handshake and returns a peer. Client frames are parsed only to notice `close` and to answer
 * `ping`; everything else is ignored (the Hermes endpoint ignores client messages as well).
 */
export function acceptWebSocket(
  request: IncomingMessage,
  socket: Duplex,
  onClose: () => void,
): WebSocketPeer | undefined {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.destroy();
    return undefined;
  }
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
  let closed = false;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    onClose();
  };
  socket.on("close", finish);
  socket.on("error", finish);
  socket.on("data", (chunk: Buffer) => {
    let offset = 0;
    while (offset + 2 <= chunk.length) {
      const opcode = (chunk[offset] as number) & 0x0f;
      const masked = ((chunk[offset + 1] as number) & 0x80) !== 0;
      let length = (chunk[offset + 1] as number) & 0x7f;
      let cursor = offset + 2;
      if (length === 126) {
        length = chunk.readUInt16BE(cursor);
        cursor += 2;
      } else if (length === 127) {
        length = Number(chunk.readBigUInt64BE(cursor));
        cursor += 8;
      }
      cursor += masked ? 4 : 0;
      if (opcode === 0x8) {
        if (!closed) socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
        finish();
        return;
      }
      if (opcode === 0x9 && !closed) socket.write(Buffer.from([0x8a, 0x00]));
      offset = cursor + length;
    }
  });
  return {
    send: (text) => {
      if (!closed && !socket.destroyed) socket.write(textFrame(text));
    },
    close: (code) => {
      if (closed) return;
      socket.write(closeFrame(code));
      socket.end();
      finish();
    },
    get closed() {
      return closed;
    },
  };
}
