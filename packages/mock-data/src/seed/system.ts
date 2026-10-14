import type { ModelProvider, Service, StorageVolume, SystemMetrics } from "@jarvis/sdk";
import { DAY, MIN, type SeedContext } from "./context";

const GB = 1024 ** 3;

export interface SystemSeed {
  metrics: SystemMetrics;
  services: Service[];
  storage: StorageVolume[];
  models: ModelProvider[];
}

export function volume(ctx: SeedContext, mount: string, label: string, fileSystem: string, totalGb: number, usedGb: number): StorageVolume {
  const totalBytes = Math.round(totalGb * GB);
  const usedBytes = Math.round(usedGb * GB);
  return {
    id: ctx.id("vol"),
    version: 1,
    createdAt: ctx.at(-200 * DAY),
    updatedAt: ctx.at(-5 * MIN),
    source: ctx.src("system"),
    mount,
    label,
    fileSystem,
    totalBytes,
    usedBytes,
    freeBytes: totalBytes - usedBytes,
    usagePercent: Math.round((usedBytes / totalBytes) * 1000) / 10,
  };
}

interface ServiceSpec {
  name: string;
  kind: Service["kind"];
  version: string;
  status: Service["status"];
  latencyMs: number | null;
  detail: string;
}

const SERVICES: ServiceSpec[] = [
  { name: "Hermes", kind: "hermes", version: "0.9.4", status: "online", latencyMs: 34, detail: "Gateway antwortet, 3 aktive Sitzungen" },
  { name: "Kimi API", kind: "llm", version: "k3-2026-09", status: "online", latencyMs: 820, detail: "Cloud-Modell erreichbar, Kontingent 71 % frei" },
  { name: "Local Qwen", kind: "llm", version: "qwen3-14b-q4", status: "online", latencyMs: 310, detail: "Modell geladen (10,2 GB VRAM)" },
  { name: "Voice STT", kind: "voice", version: "faster-whisper 1.1", status: "online", latencyMs: 420, detail: "Spracherkennung bereit" },
  { name: "Voice TTS", kind: "voice", version: "piper 1.2", status: "online", latencyMs: 180, detail: "Sprachausgabe bereit" },
  { name: "WSL", kind: "wsl", version: "Ubuntu-24.04 (WSL2)", status: "online", latencyMs: 12, detail: "Distribution läuft, 6 Prozesse" },
  { name: "Control API", kind: "api", version: "1.0.0", status: "online", latencyMs: 8, detail: "Port 3100, nur localhost" },
  { name: "Event Stream", kind: "stream", version: "ws/1", status: "online", latencyMs: 28, detail: "1 Client verbunden" },
  { name: "Windows Worker", kind: "worker", version: "2026.10.1", status: "degraded", latencyMs: 2100, detail: "Antworten verzögert; letzter Update-Lauf abgebrochen" },
  { name: "Adapter-Registry", kind: "adapter", version: "1.0.0", status: "online", latencyMs: 5, detail: "15 Adapter geladen" },
];

export function buildSystem(ctx: SeedContext): SystemSeed {
  const services: Service[] = SERVICES.map((spec) => ({
    id: ctx.id("svc"),
    version: spec.version,
    createdAt: ctx.at(-90 * DAY),
    updatedAt: ctx.at(-ctx.rng.int(1, 30) * MIN),
    source: ctx.src("system"),
    name: spec.name,
    kind: spec.kind,
    status: spec.status,
    latencyMs: spec.latencyMs,
    lastCheckAt: ctx.at(-ctx.rng.int(5, 60) * 1000),
    lastSuccessAt: spec.status === "online" ? ctx.at(-ctx.rng.int(5, 60) * 1000) : ctx.at(-3 * 60 * MIN),
    detail: spec.detail,
  }));
  const storage = [
    volume(ctx, "D:\\", "F.R.I.D.A.Y.-Daten", "NTFS", 1862, 1043),
    volume(ctx, "C:\\", "System", "NTFS", 931, 612),
  ];
  const models: ModelProvider[] = [
    {
      id: ctx.id("mdl"),
      version: 1,
      createdAt: ctx.at(-90 * DAY),
      updatedAt: ctx.at(-2 * MIN),
      source: ctx.src("system"),
      name: "Kimi API",
      providerKind: "cloud",
      status: "online",
      models: ["Kimi K3", "Kimi K3 Thinking"],
      latencyMs: 820,
      activeRequests: 2,
      contextWindow: 262_144,
    },
    {
      id: ctx.id("mdl"),
      version: 1,
      createdAt: ctx.at(-90 * DAY),
      updatedAt: ctx.at(-2 * MIN),
      source: ctx.src("system"),
      name: "Qwen Lokal",
      providerKind: "local",
      status: "online",
      models: ["Qwen Local"],
      latencyMs: 310,
      activeRequests: 1,
      contextWindow: 32_768,
    },
    {
      id: ctx.id("mdl"),
      version: 1,
      createdAt: ctx.at(-30 * DAY),
      updatedAt: ctx.at(-3 * 60 * MIN),
      source: ctx.src("system"),
      name: "Reserve-Cloud-Modell",
      providerKind: "cloud",
      status: "offline",
      models: ["Reserve-L"],
      latencyMs: null,
      activeRequests: 0,
    },
  ];
  return { metrics: sampleMetrics(ctx.now, ctx.src("system"), storage), services, storage, models };
}

/** Deterministic metrics for a given instant: smooth waves plus hash noise, so identical times give identical samples. */
export function sampleMetrics(timeMs: number, source: SystemMetrics["source"], storage: StorageVolume[], load = 0): SystemMetrics {
  const t = timeMs / 1000;
  const wave = (period: number, phase: number): number => (Math.sin((t / period) * Math.PI * 2 + phase) + 1) / 2;
  const clamp100 = (value: number): number => Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  const cpu = clamp100(14 + wave(97, 0.3) * 22 + load * 40);
  const ramUsed = Math.round((19.5 + wave(311, 1.1) * 4 + load * 8) * GB);
  const ramTotal = 64 * GB;
  const gpu = clamp100(8 + wave(53, 2.2) * 18 + load * 50);
  const vramUsed = Math.round((4.1 + wave(401, 0.4) * 6 + load * 3) * GB);
  const vramTotal = 16 * GB;
  return {
    sampledAt: new Date(timeMs).toISOString(),
    source,
    cpu: { usagePercent: cpu, cores: 16, temperatureC: Math.round(44 + cpu * 0.25) },
    ram: { usedBytes: ramUsed, totalBytes: ramTotal, usagePercent: clamp100((ramUsed / ramTotal) * 100) },
    gpu: { name: "NVIDIA GeForce RTX 4080", usagePercent: gpu, temperatureC: Math.round(40 + gpu * 0.3) },
    vram: { usedBytes: vramUsed, totalBytes: vramTotal, usagePercent: clamp100((vramUsed / vramTotal) * 100) },
    temperatures: [
      { sensor: "CPU Package", celsius: Math.round(44 + cpu * 0.25) },
      { sensor: "GPU Hotspot", celsius: Math.round(48 + gpu * 0.3) },
      { sensor: "NVMe D:", celsius: Math.round(38 + wave(900, 0) * 6) },
    ],
    storage,
    network: {
      rxBytesPerSec: Math.round(120_000 + wave(41, 0.7) * 900_000),
      txBytesPerSec: Math.round(40_000 + wave(37, 1.9) * 300_000),
      latencyMs: Math.round(11 + wave(23, 0.2) * 9),
    },
  };
}
