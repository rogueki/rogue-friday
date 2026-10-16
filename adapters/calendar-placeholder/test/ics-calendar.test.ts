import { describe, expect, it } from "vitest";
import { parseEvents } from "../src/ics-calendar";
import { validateFeedUrl } from "../src/fetch-ics";
import { parseCalDavResponse } from "../src/fetch-caldav";

const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:weekly-1\r\nDTSTART:20261016T090000Z\r\nDTEND:20261016T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Planning\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe("read-only ICS calendar", () => {
  it("expands recurring events into canonical calendar records", () => {
    const events = parseEvents(feed, "2026-10-16T08:00:00.000Z", Date.parse("2026-10-16"), Date.parse("2026-10-20"));
    expect(events).toHaveLength(3);
    expect(events.map((item) => item.start)).toEqual([
      "2026-10-16T09:00:00.000Z", "2026-10-17T09:00:00.000Z", "2026-10-18T09:00:00.000Z",
    ]);
    expect(events[0]?.title).toBe("Planning");
    expect(events[0]?.id).toMatch(/^cal_[0-9A-Z]{26}$/);
  });

  it("rejects loopback, local, credentials, redirects by protocol and plain HTTP URLs", () => {
    for (const url of ["http://calendar.example/test.ics", "https://127.0.0.1/a", "https://user:pass@calendar.example/a", "file:///secret", "https://[::1]/a"]) {
      expect(() => validateFeedUrl(url)).toThrow();
    }
    expect(validateFeedUrl("https://calendar.example/private.ics?token=secret").hostname).toBe("calendar.example");
  });
});

describe("read-only CalDAV response", () => {
  it("extracts calendar-data from a multistatus response", () => {
    const xml = `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>${feed.replace(/&/g, "&amp;")}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    const documents = parseCalDavResponse(xml);
    expect(documents).toHaveLength(1);
    expect(parseEvents(documents[0]!, "2026-10-16T08:00:00.000Z", Date.parse("2026-10-16"), Date.parse("2026-10-20"))).toHaveLength(3);
  });

  it("rejects error responses and XML entities", () => {
    expect(() => parseCalDavResponse('<d:multistatus><d:status>HTTP/1.1 403 Forbidden</d:status></d:multistatus>')).toThrow();
    expect(() => parseCalDavResponse('<!DOCTYPE x [<!ENTITY local SYSTEM "file:///secret">]><d:multistatus/>')).toThrow();
  });
});
