import { describe, expect, it } from "vitest";
import { eventDocument } from "../src/put-caldav";

describe("CalDAV VEVENT", () => {
  it("escapes text, folds UTF-8 lines and uses UTC timestamps with CRLF", () => {
    const document = eventDocument({ uid: "0123456789abcdef0123456789abcdef", title: "Prüfung, Team; Vorbereitung\\Plan " + "Ä".repeat(60), start: "2026-10-18T10:00:00.000Z", end: "2026-10-18T11:00:00.000Z" });
    expect(document).toContain("DTSTART:20261018T100000Z\r\nDTEND:20261018T110000Z");
    expect(document).toContain("SUMMARY:Prüfung\\, Team\\; Vorbereitung\\\\Plan");
    expect(document).toContain("UID:0123456789abcdef0123456789abcdef@friday.local");
    expect(document.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(document.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
