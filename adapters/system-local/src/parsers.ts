import type { CpuTimes } from "./host";

const MIB = 1024 * 1024;

// ---- CPU -----------------------------------------------------------------------------------------------------------------

export interface CpuSample {
  idle: number;
  total: number;
}

export function sampleCpu(times: readonly CpuTimes[]): CpuSample {
  let idle = 0;
  let total = 0;
  for (const t of times) {
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Usage in percent between two samples; `null` when no time passed (counters did not advance). */
export function cpuUsagePercent(previous: CpuSample, current: CpuSample): number | null {
  const total = current.total - previous.total;
  if (!(total > 0)) return null;
  const idle = Math.min(total, Math.max(0, current.idle - previous.idle));
  return round1(clampPercent(((total - idle) / total) * 100));
}

export const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
export const round1 = (value: number): number => Math.round(value * 10) / 10;

// ---- command output --------------------------------------------------------------------------------------------------------

/** `wsl.exe` writes UTF-16LE to a pipe, most other tools UTF-8. NUL bytes decide. */
export function decodeCommandOutput(output: Buffer): string {
  const text = output.includes(0) ? output.toString("utf16le") : output.toString("utf8");
  return text
    .replace(/^\uFEFF/, "")
    .replaceAll("\0", "")
    .replaceAll("\r", "");
}

// ---- GPU (nvidia-smi) ------------------------------------------------------------------------------------------------------

export const NVIDIA_SMI_ARGS = [
  "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total",
  "--format=csv,noheader,nounits",
] as const;

export interface GpuReading {
  name: string;
  usagePercent: number;
  temperatureC: number | null;
  vram: { usedBytes: number; totalBytes: number; usagePercent: number } | null;
}

/** nvidia-smi prints `[N/A]` or `[Not Supported]` for sensors the board does not have. */
function numberOrNull(field: string | undefined): number | null {
  if (field === undefined) return null;
  const trimmed = field.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Parses the first GPU row of `nvidia-smi --query-gpu=... --format=csv,noheader,nounits`; `null` if unusable. */
export function parseNvidiaSmi(output: string): GpuReading | null {
  const row = output.split("\n").find((line) => line.trim().length > 0);
  if (!row) return null;
  const fields = row.split(",");
  if (fields.length < 5) return null;
  // The model name never contains a comma in practice; if it did the numeric tail still parses from the end.
  const tail = fields.slice(-4);
  const name = fields.slice(0, -4).join(",").trim();
  const usage = numberOrNull(tail[0]);
  if (name.length === 0 || usage === null) return null;
  const used = numberOrNull(tail[2]);
  const total = numberOrNull(tail[3]);
  const vram =
    used !== null && total !== null && total > 0
      ? {
          usedBytes: Math.round(used * MIB),
          totalBytes: Math.round(total * MIB),
          usagePercent: round1(clampPercent((used / total) * 100)),
        }
      : null;
  return { name, usagePercent: round1(clampPercent(usage)), temperatureC: numberOrNull(tail[1]), vram };
}

// ---- network counters ------------------------------------------------------------------------------------------------------

export interface NetCounters {
  rxBytes: number;
  txBytes: number;
}

/** `/proc/net/dev` (Linux): sums all interfaces except loopback. */
export function parseProcNetDev(text: string): NetCounters | null {
  let rx = 0;
  let tx = 0;
  let interfaces = 0;
  for (const line of text.split("\n")) {
    const match = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!match || match[1] === "lo") continue;
    const columns = (match[2] ?? "").trim().split(/\s+/).map(Number);
    if (columns.length < 9 || columns.some((c) => !Number.isFinite(c))) continue;
    rx += columns[0] ?? 0;
    tx += columns[8] ?? 0;
    interfaces += 1;
  }
  return interfaces > 0 ? { rxBytes: rx, txBytes: tx } : null;
}

/**
 * `netstat -e` (Windows): the row labelled `Bytes` carries received and sent bytes. The label is "Bytes" in the
 * English and German Windows UI; other languages that translate it yield `null` (no value is invented).
 */
export function parseNetstatEthernet(text: string): NetCounters | null {
  for (const line of text.split("\n")) {
    const match = /^\s*Bytes\s+(\d+)\s+(\d+)\s*$/i.exec(line);
    if (match) return { rxBytes: Number(match[1]), txBytes: Number(match[2]) };
  }
  return null;
}

// ---- WSL -----------------------------------------------------------------------------------------------------------------

export type WslState = "running" | "stopped" | "other";

export interface WslDistro {
  name: string;
  state: WslState;
  /** State text as printed (localised), for the detail line. */
  rawState: string;
  isDefault: boolean;
}

const WSL_RUNNING = /running|wird ausgef|läuft|en cours|ejecut|in esecuzione/i;
const WSL_STOPPED = /stopped|beendet|arrêt|detenid|fermat/i;

/** Parses `wsl.exe -l -v`. Header and state words are localised; unknown states are reported as `other`. */
export function parseWslList(output: string): WslDistro[] {
  const lines = output.split("\n").filter((line) => line.trim().length > 0);
  const distros: WslDistro[] = [];
  for (const line of lines.slice(1)) {
    const match = /^\s*(\*)?\s*(\S+)\s+(.+?)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const rawState = (match[3] ?? "").trim();
    distros.push({
      name: match[2] ?? "",
      rawState,
      isDefault: match[1] === "*",
      state: WSL_RUNNING.test(rawState) ? "running" : WSL_STOPPED.test(rawState) ? "stopped" : "other",
    });
  }
  return distros;
}

// ---- Lists ---------------------------------------------------------------------------------------------------------------

/** Extracts the model ids of an OpenAI-style `GET /v1/models` answer; anything else is "no models known". */
export function parseModelIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const id = (entry as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 ? [id] : [];
  });
}
