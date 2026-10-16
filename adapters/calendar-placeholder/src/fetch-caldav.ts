import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { validateFeedUrl, publicIp } from "./fetch-ics";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

function xmlUnescape(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
    switch (code) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const point = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
        return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
      }
    }
  });
}

/** Extracts only calendar-data from a bounded CalDAV multistatus document. */
export function parseCalDavResponse(xml: string): string[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Ungueltige CalDAV-Antwort");
  if (!/<(?:[A-Za-z_][\w.-]*:)?multistatus\b/i.test(xml) || /<(?:[A-Za-z_][\w.-]*:)?status\b[^>]*>\s*HTTP\/\S+\s+[45]\d\d\b/i.test(xml)) {
    throw new Error("CalDAV-Kalender ist nicht erreichbar");
  }
  const documents: string[] = [];
  const data = /<(?:[A-Za-z_][\w.-]*:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?calendar-data\s*>/gi;
  for (const match of xml.matchAll(data)) {
    const raw = match[1] ?? "";
    const value = (raw.startsWith("<![CDATA[") && raw.endsWith("]]>") ? raw.slice(9, -3) : xmlUnescape(raw)).trim();
    if (value.startsWith("BEGIN:VCALENDAR")) documents.push(value);
    if (documents.length > 500) throw new Error("Zu viele CalDAV-Termine");
  }
  if (!documents.length && /<(?:[A-Za-z_][\w.-]*:)?response\b/i.test(xml)) {
    throw new Error("Keine CalDAV-Kalenderdaten in der Antwort");
  }
  return documents;
}

export async function fetchCalDav(raw: string, username: string, password: string, from: number, to: number, signal?: AbortSignal): Promise<string[]> {
  const url = validateFeedUrl(raw);
  if (!username || !password || /[\r\n]/.test(username) || username.length > 512 || password.length > 4096) throw new Error("CalDAV-Anmeldung fehlt");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !publicIp(entry.address))) throw new Error("CalDAV-Host hat keine zulaessige oeffentliche Adresse");
  const chosen = addresses[0]!;
  const start = new Date(from).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const end = new Date(to).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
  const body = `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  return new Promise<string[]>((resolve, reject) => {
    const req = request(url, {
      method: "REPORT", agent: false, timeout: TIMEOUT_MS,
      lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
      headers: {
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        accept: "application/xml", "content-type": "application/xml; charset=utf-8",
        depth: "1", "user-agent": "Friday-Calendar/1", "content-length": Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode !== 207) { res.resume(); reject(new Error("CalDAV-Abfrage fehlgeschlagen")); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) { req.destroy(new Error("CalDAV-Antwort ist zu gross")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        try { resolve(parseCalDavResponse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new Error("CalDAV-Antwort ist ungueltig")); }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("CalDAV-Abfrage hat nicht rechtzeitig geantwortet")));
    req.on("error", () => reject(new Error("CalDAV-Abfrage fehlgeschlagen")));
    if (signal) {
      if (signal.aborted) req.destroy(new Error("CalDAV-Abfrage abgebrochen"));
      else signal.addEventListener("abort", () => req.destroy(new Error("CalDAV-Abfrage abgebrochen")), { once: true });
    }
    req.end(body);
  });
}
