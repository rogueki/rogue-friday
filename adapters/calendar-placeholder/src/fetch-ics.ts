import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

export function publicIp(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;
    return !(
      a === 0 || a === 10 || a === 127 || a! >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Avoid mapped addresses and special IPv6 ranges until every transition mechanism is classified.
  return false;
}

export function validateFeedUrl(raw: string): URL {
  if (raw.length > 2048 || /[\r\n]/.test(raw)) throw new Error("Ungueltige Kalender-URL");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Ungueltige Kalender-URL"); }
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.port && url.port !== "443" || isIP(host)) {
    throw new Error("Nur oeffentliche HTTPS-Feed-URLs ohne eingebettete Zugangsdaten sind erlaubt");
  }
  return url;
}

export async function fetchIcs(raw: string, signal?: AbortSignal): Promise<string> {
  const url = validateFeedUrl(raw);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !publicIp(entry.address))) {
    throw new Error("Kalender-Host hat keine zulaessige oeffentliche Adresse");
  }
  const chosen = addresses[0]!;
  return new Promise<string>((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      agent: false,
      headers: { accept: "text/calendar", "user-agent": "Friday-Calendar/1" },
      timeout: TIMEOUT_MS,
      lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Kalender-Feed antwortet mit HTTP ${res.statusCode ?? 0}`)); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(new Error("Kalender-Feed ist zu gross")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Kalender-Feed hat nicht rechtzeitig geantwortet")));
    req.on("error", () => reject(new Error("Kalender-Feed ist nicht erreichbar")));
    if (signal) {
      if (signal.aborted) req.destroy(new Error("Kalender-Abfrage abgebrochen"));
      else signal.addEventListener("abort", () => req.destroy(new Error("Kalender-Abfrage abgebrochen")), { once: true });
    }
    req.end();
  });
}
