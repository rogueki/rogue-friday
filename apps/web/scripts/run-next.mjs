// Starts `next` through Node so the same npm script works on Windows and POSIX shells.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { withLegacyEnv } from "../../../scripts/lib/legacy-env.mjs";

const [command = "dev", ...nextArgs] = process.argv.slice(2);
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

// Older checkouts copied an MSW worker into public/; it must never reach a build.
rmSync(fileURLToPath(new URL("../public/mockServiceWorker.js", import.meta.url)), { force: true });

const child = spawn(process.execPath, [nextBin, command, ...nextArgs], { stdio: "inherit", env: withLegacyEnv() });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
