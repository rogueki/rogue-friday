import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));

import { putCalDav } from "../src/put-caldav";

const event = { uid: "0123456789abcdef0123456789abcdef", title: "Test", start: "2026-10-18T10:00:00.000Z", end: "2026-10-18T11:00:00.000Z" };

describe("CalDAV conditional PUT transport", () => {
  beforeEach(() => { mocks.lookup.mockReset(); mocks.request.mockReset(); });

  it("pins a public DNS address, sends one If-None-Match PUT and requires 201", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.request.mockImplementation((_url, _options, onResponse) => {
      const req = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: (error: Error) => void };
      req.destroy = (error) => req.emit("error", error);
      req.end = () => queueMicrotask(() => { const res = new EventEmitter() as EventEmitter & { statusCode: number }; res.statusCode = 201; onResponse(res); res.emit("end"); });
      return req;
    });
    await putCalDav("https://calendar.example.test/collection/", "user", "app-password", event);
    expect(mocks.request).toHaveBeenCalledOnce();
    const [destination, options] = mocks.request.mock.calls[0]!;
    expect(destination.href).toBe("https://calendar.example.test/collection/0123456789abcdef0123456789abcdef.ics");
    expect(options).toMatchObject({ method: "PUT", agent: false, headers: { "if-none-match": "*", "content-type": "text/calendar; charset=utf-8" } });
    const callback = vi.fn();
    options.lookup("calendar.example.test", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });

  it("rejects private DNS and a non-create response without a retry", async () => {
    await expect(putCalDav("https://calendar.example.test/collection/", "user", "password", { ...event, title: "ok\r\nBEGIN:VALARM" })).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(putCalDav("https://calendar.example.test/collection/", "user", "password", event)).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    mocks.request.mockImplementation((_url, _options, onResponse) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      req.destroy = (error) => req.emit("error", error);
      req.end = () => queueMicrotask(() => { const res = new EventEmitter() as EventEmitter & { statusCode: number }; res.statusCode = 412; onResponse(res); res.emit("end"); });
      return req;
    });
    await expect(putCalDav("https://calendar.example.test/collection/", "user", "password", event)).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledOnce();
  });
});
