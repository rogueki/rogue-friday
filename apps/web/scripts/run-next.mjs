// Starts `next` with the standalone-mock flag so the same npm script works on Windows and POSIX shells.
//
// The MSW service worker script lives in `mock-worker/` and is copied into `public/` only for mock runs. A normal
// build therefore never ships `mockServiceWorker.js` (it would register a request interceptor in production).
import { spawn } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [command = "dev", ...rest] = process.argv.slice(2);
const mock = rest.includes("--mock");
const nextArgs = rest.filter((arg) => arg !== "--mock");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const workerSource = fileURLToPath(new URL("../mock-worker/mockServiceWorker.js", import.meta.url));
const workerTarget = fileURLToPath(new URL("../public/mockServiceWorker.js", import.meta.url));
if (mock) copyFileSync(workerSource, workerTarget);
else rmSync(workerTarget, { force: true });

const child = spawn(process.execPath, [nextBin, command, ...nextArgs], {
  stdio: "inherit",
  env: { ...process.env, ...(mock ? { NEXT_PUBLIC_JARVIS_MSW: "1" } : {}) },
});
// The worker is not removed on exit: parallel mock dev servers share public/. Every non-mock run (dev or build)
// deletes it before starting, so a production export never contains it.
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
