import { resolve } from "node:path";
import { DEFAULT_PORTS, SERVICE_NAMES, startFakeUpstreams, type ServiceName } from "./lib";

/**
 * Starts fake Hermes (API 43693 + dashboard 43691), voice status (43694) and llama-server (43692) on the installer
 * ports plus a control endpoint (43699). Everything is in-memory, fictional and loopback only.
 *
 *   pnpm fake:upstreams [--host 127.0.0.1] [--hermes-api-port N] [--hermes-dashboard-port N] [--voice-port N]
 *                       [--llama-port N] [--control-port N] [--key-file PATH] [--stopped voice,hermes] [--no-seed]
 *
 * Outage simulation while running:
 *   curl -X POST http://127.0.0.1:43699/services/voice/stop    (also: start | hermes | hermes-api | hermes-dashboard | llama)
 */
function parseArgs(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (key === "no-seed" || next === undefined || next.startsWith("--")) flags.set(key, "true");
    else {
      flags.set(key, next);
      index += 1;
    }
  }
  return flags;
}

function port(flags: Map<string, string>, key: string, fallback: number): number {
  const raw = flags.get(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--${key} must be a port number`);
  return value;
}

const flags = parseArgs(process.argv.slice(2));
const keyFile = flags.get("key-file");
const upstreams = await startFakeUpstreams({
  ...(flags.has("host") ? { host: flags.get("host") as string } : {}),
  ports: {
    hermesApi: port(flags, "hermes-api-port", DEFAULT_PORTS.hermesApi),
    hermesDashboard: port(flags, "hermes-dashboard-port", DEFAULT_PORTS.hermesDashboard),
    voice: port(flags, "voice-port", DEFAULT_PORTS.voice),
    llama: port(flags, "llama-port", DEFAULT_PORTS.llama),
    control: port(flags, "control-port", DEFAULT_PORTS.control),
  },
  ...(keyFile ? { keyFile: resolve(keyFile) } : {}),
  seed: !flags.has("no-seed"),
  log: (line) => console.log(`[fake-upstreams] ${line}`),
});

for (const name of (flags.get("stopped") ?? "").split(",").filter(Boolean)) {
  if (name !== "hermes" && !(SERVICE_NAMES as readonly string[]).includes(name)) throw new Error(`--stopped: unknown service ${name}`);
  await upstreams.stop(name as ServiceName | "hermes");
}

console.log(
  `[fake-upstreams] bereit: hermes-dashboard ${upstreams.urls.hermesDashboard}, llama ${upstreams.urls.llama}, hermes-api ${upstreams.urls.hermesApi}, voice ${upstreams.urls.voice}, control ${upstreams.urls.control}`,
);
if (keyFile) console.log(`[fake-upstreams] API-Schluessel in ${resolve(keyFile)} geschrieben`);

let closing = false;
const shutdown = (): void => {
  if (closing) return;
  closing = true;
  void upstreams.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
