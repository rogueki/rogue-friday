import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CONFIG_DIR = resolve(import.meta.dirname, "..", "..", "config");

export interface ExamplePorts {
  hermesDashboard: number;
  llama: number;
  hermesApi: number;
  voice: number;
}

export interface RenderOptions {
  ports?: ExamplePorts;
  /** The shipped breaker reopens after 30 s; tests and the integration run use a shorter window. */
  breaker?: { failureThreshold: number; resetAfterMs: number };
}

/** The shipped `adapters.<mode>.example.yaml`, with ports and circuit breaker adjusted for a test stack. */
export function renderAdaptersExample(mode: "hybrid" | "live", options: RenderOptions = {}): string {
  let text = readFileSync(join(CONFIG_DIR, `adapters.${mode}.example.yaml`), "utf8");
  if (options.breaker) {
    const { failureThreshold, resetAfterMs } = options.breaker;
    text = text
      .replace(/^ {4}circuitBreaker: \{[^\n]*\}\n/gm, "")
      .replace(/^( {2}\w+:\n {4}provider: [\w-]+\n)/gm, `$1    circuitBreaker: { failureThreshold: ${failureThreshold}, resetAfterMs: ${resetAfterMs} }\n`);
  }
  if (options.ports) {
    text = text
      .replaceAll("43691", String(options.ports.hermesDashboard))
      .replaceAll("43692", String(options.ports.llama))
      .replaceAll("43693", String(options.ports.hermesApi))
      .replaceAll("43694", String(options.ports.voice));
  }
  return text;
}

export function readDashboardExample(mode: "hybrid" | "live"): string {
  return readFileSync(join(CONFIG_DIR, `dashboard.${mode}.example.yaml`), "utf8");
}
