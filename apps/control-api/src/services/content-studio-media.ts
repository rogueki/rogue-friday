import { execFile } from "node:child_process";
import { lookup } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { rename } from "node:fs/promises";
import { ApiError } from "../util/errors";

const exec = promisify(execFile);
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === undefined || b === undefined) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0));
  }
  if (isIP(address) !== 6) return false;
  const lower = address.toLowerCase();
  return /^[23][0-9a-f]/.test(lower) && !lower.startsWith("2001:db8") && !lower.includes("::ffff:");
}

function safeUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Ungültiger Anbieter-Download-Link." }); }
  if (url.protocol !== "https:" || url.port || url.username || url.password || isIP(url.hostname) ||
      !url.hostname.includes(".") || /\.(?:local|localhost|internal|invalid|test)$/i.test(url.hostname)) {
    throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Unsicherer Anbieter-Download-Link." });
  }
  return url;
}

/** DNS is checked at connection time; redirects are revalidated and no provider key is sent to the file host. */
export async function downloadPublicMedia(urlText: string, redirects = 0): Promise<Uint8Array> {
  const url = safeUrl(urlText);
  if (redirects > 2) throw new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Zu viele Medienweiterleitungen." });
  return new Promise<Uint8Array>((resolve, reject) => {
    const client = request(url, {
      method: "GET", timeout: 30_000,
      lookup(hostname, _options, callback) {
        lookup(hostname, (error, address, family) => {
          if (error) return callback(error, address, family);
          if (!publicAddress(address)) return callback(new Error("Private media address blocked"), address, family);
          callback(null, address, family);
        });
      },
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        const next = response.headers.location;
        if (!next) return reject(new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Medienweiterleitung ohne Ziel." }));
        void downloadPublicMedia(new URL(next, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mediendownload fehlgeschlagen." }));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) {
          response.destroy(new Error("Media exceeds size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => size > 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("Empty media")));
      response.on("error", reject);
    });
    client.on("timeout", () => client.destroy(new Error("Media download timeout")));
    client.on("error", reject);
    client.end();
  });
}

export function mediaLooksValid(kind: "image" | "video", bytes: Uint8Array): boolean {
  if (kind === "video") return bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp";
  const head = Buffer.from(bytes.subarray(0, 12));
  return head.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) ||
    head.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    (head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP");
}

export async function renderContentVideo(input: { kind: "image" | "video"; aspectRatio: "1:1" | "16:9" | "9:16"; visualPath: string; voicePath: string; outputPath: string; ffmpegPath?: string }): Promise<void> {
  const temporary = `${input.outputPath}.partial.mp4`;
  const visualArgs = input.kind === "image"
    ? ["-loop", "1", "-framerate", "30", "-i", input.visualPath]
    : ["-stream_loop", "-1", "-i", input.visualPath];
  const [width, height] = input.aspectRatio === "9:16" ? [720, 1280] : input.aspectRatio === "1:1" ? [1080, 1080] : [1280, 720];
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...visualArgs, "-i", input.voicePath,
    "-map", "0:v:0", "-map", "1:a:0", "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart", temporary];
  await exec(input.ffmpegPath || "ffmpeg", args, { timeout: 180_000, windowsHide: true, maxBuffer: 256_000 });
  await rename(temporary, input.outputPath);
}
