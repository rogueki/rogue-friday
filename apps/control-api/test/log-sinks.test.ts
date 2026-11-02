import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

let api: TestApi | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await api?.close();
  api = undefined;
});

// 2026-11-02: every log line also went to stdout, which the Windows launcher pipes into a file line by line. A burst of
// warnings filled that pipe and the blocked stdout write froze the whole live dashboard. With file logging on, the
// rotating file is the only sink.
it("writes logs only to the rotating file when file logging is enabled", async () => {
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  api = await startTestApi({ fileLogging: true, logLevel: "debug" });
  const logDir = join(api.dir, "logs");
  const fileLines = existsSync(logDir)
    ? readdirSync(logDir).flatMap((name) => readFileSync(join(logDir, name), "utf8").split("\n")).filter(Boolean)
    : [];
  expect(fileLines.length).toBeGreaterThan(0);
  expect(written.filter((chunk) => chunk.includes('"service":"control-api"'))).toEqual([]);
});
