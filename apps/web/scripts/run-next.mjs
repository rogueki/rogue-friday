// Starts `next` with the standalone-mock flag so the same npm script works on Windows and POSIX shells.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const [command = "dev", ...rest] = process.argv.slice(2);
const mock = rest.includes("--mock");
const nextArgs = rest.filter((arg) => arg !== "--mock");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, command, ...nextArgs], {
  stdio: "inherit",
  env: { ...process.env, ...(mock ? { NEXT_PUBLIC_JARVIS_MSW: "1" } : {}) },
});
child.on("exit", (code) => process.exit(code ?? 0));
