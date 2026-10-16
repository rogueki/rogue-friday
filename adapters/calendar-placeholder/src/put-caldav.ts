import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { publicIp, validateFeedUrl } from "./fetch-ics";

const MAX_RESPONSE = 8192;
const TIMEOUT_MS = 8000;

function utc(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function folded(name: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
  let line = `${name}:`;
  let bytes = Buffer.byteLength(line);
  for (const character of escaped) {
    const length = Buffer.byteLength(character);
    if (bytes + length > 73) { line += "\r\n "; bytes = 1; }
    line += character;
    bytes += length;
  }
  return line;
}

export function eventDocument(event: { uid: string; title: string; start: string; end: string }): string {
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RogueKI//Friday CalDAV//EN", "BEGIN:VEVENT",
    folded("UID", `${event.uid}@friday.local`), `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(event.start)}`, `DTEND:${utc(event.end)}`, folded("SUMMARY", event.title),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

/** A single conditional PUT; no redirect and no retry even when the connection fails ambiguously. */
export async function putCalDav(raw: string, username: string, password: string, event: { uid: string; title: string; start: string; end: string }, signal?: AbortSignal): Promise<void> {
  const collection = validateFeedUrl(raw);
  if (!collection.pathname.endsWith("/") || collection.search || collection.hash || !/^[a-f0-9]{32}$/.test(event.uid) || !username || !password || /[\r\n]/.test(username) || username.length > 512 || password.length > 4096 ||
      !event.title.trim() || [...event.title].length > 120 || Buffer.byteLength(event.title) > 500 || [...event.title].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) {
    throw new Error("CalDAV-Konfiguration oder Termin-ID ist ungueltig");
  }
  const addresses = await lookup(collection.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !publicIp(entry.address))) throw new Error("CalDAV-Host hat keine zulaessige oeffentliche Adresse");
  const chosen = addresses[0]!;
  const destination = new URL(collection.href);
  destination.pathname += `${event.uid}.ics`;
  const body = eventDocument(event);
  if (Buffer.byteLength(body) > 4096) throw new Error("CalDAV-Termin ist zu gross");
  await new Promise<void>((resolve, reject) => {
    const req = request(destination, {
      method: "PUT", agent: false, timeout: TIMEOUT_MS,
      lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family),
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        "content-type": "text/calendar; charset=utf-8", "content-length": Buffer.byteLength(body),
        "if-none-match": "*", "user-agent": "Friday-Calendar/1",
      },
    }, (res) => {
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_RESPONSE) req.destroy(new Error("CalDAV-Antwort ist zu gross"));
      });
      res.on("end", () => res.statusCode === 201 ? resolve() : reject(new Error("CalDAV-Termin wurde nicht bestaetigt")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("CalDAV-Zeitlimit")));
    req.on("error", () => reject(new Error("CalDAV-Schreibstatus unbekannt")));
    if (signal) {
      if (signal.aborted) req.destroy(new Error("CalDAV abgebrochen"));
      else signal.addEventListener("abort", () => req.destroy(new Error("CalDAV abgebrochen")), { once: true });
    }
    req.end(body);
  });
}
