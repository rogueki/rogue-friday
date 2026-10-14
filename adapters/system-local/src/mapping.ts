import type { HealthcheckResult, ModelProvider, Service, StorageVolume, SystemMetrics } from "@jarvis/sdk";
import { defineMapper } from "@jarvis/adapter-core";
import { contractId } from "./ids";
import type { FsStats } from "./host";
import { clampPercent, round1, type GpuReading } from "./parsers";
import type { ProbeResult } from "./probes";

export type ServiceKey = "qwen" | "hermes-api" | "hermes-dashboard" | "voice" | "wsl" | "control-api";
export type ProviderKey = "qwen" | "hermes";

export const serviceIdFor = (key: ServiceKey): string => contractId("svc", key);
export const providerIdFor = (key: ProviderKey): string => contractId("mdl", key);
export const volumeIdFor = (mount: string): string => contractId("vol", mount);

export interface ServiceInput {
  key: ServiceKey;
  name: string;
  kind: Service["kind"];
  probe: ProbeResult;
  checkedAt: string;
  createdAt: string;
  lastSuccessAt: string | null;
}

export const serviceMapper = defineMapper<ServiceInput, Service>({
  name: "local probe -> Service",
  schema: "Service",
  toCanonical: (input, context) => ({
    id: serviceIdFor(input.key),
    version: "1",
    createdAt: input.createdAt,
    updatedAt: input.checkedAt,
    source: context.source(input.key),
    name: input.name,
    kind: input.kind,
    status: input.probe.status,
    latencyMs: input.probe.latencyMs,
    lastCheckAt: input.checkedAt,
    lastSuccessAt: input.lastSuccessAt,
    detail: input.probe.detail,
  }),
});

export interface ProviderInput {
  key: ProviderKey;
  name: string;
  providerKind: ModelProvider["providerKind"];
  probe: ProbeResult;
  createdAt: string;
  checkedAt: string;
}

export const modelProviderMapper = defineMapper<ProviderInput, ModelProvider>({
  name: "local probe -> ModelProvider",
  schema: "ModelProvider",
  toCanonical: (input, context) => ({
    id: providerIdFor(input.key),
    version: 1,
    createdAt: input.createdAt,
    updatedAt: input.checkedAt,
    source: context.source(input.key),
    name: input.name,
    providerKind: input.providerKind,
    status: input.probe.status,
    models: input.probe.models ?? [],
    latencyMs: input.probe.latencyMs,
    // No data source: /slots of llama-server is optional and unverified (docs/MAPPING/qwen.md §2.2). 0 means "unknown".
    activeRequests: 0,
  }),
});

export interface VolumeInput {
  mount: string;
  stats: FsStats;
  createdAt: string;
  sampledAt: string;
}

export const storageVolumeMapper = defineMapper<VolumeInput, StorageVolume>({
  name: "statfs -> StorageVolume",
  schema: "StorageVolume",
  toCanonical: ({ mount, stats, createdAt, sampledAt }, context) => {
    const totalBytes = Math.round(stats.blocks * stats.bsize);
    const usedBytes = Math.max(0, Math.round((stats.blocks - stats.bfree) * stats.bsize));
    // `bavail` (space for unprivileged users) is what a user can still write; `df` computes its percentage the same way.
    const freeBytes = Math.max(0, Math.round(stats.bavail * stats.bsize));
    const denominator = usedBytes + freeBytes;
    return {
      id: volumeIdFor(mount),
      version: 1,
      createdAt,
      updatedAt: sampledAt,
      source: context.source(mount),
      mount,
      label: mount,
      totalBytes,
      usedBytes,
      freeBytes,
      usagePercent: denominator > 0 ? round1(clampPercent((usedBytes / denominator) * 100)) : 0,
    };
  },
});

export interface MetricsInput {
  sampledAt: string;
  cpu: { usagePercent: number; cores: number };
  ram: { usedBytes: number; totalBytes: number };
  gpu: GpuReading | null;
  storage: StorageVolume[];
  network: { rxBytesPerSec: number; txBytesPerSec: number };
}

export const systemMetricsMapper = defineMapper<MetricsInput, SystemMetrics>({
  name: "local host -> SystemMetrics",
  schema: "SystemMetrics",
  toCanonical: (input, context) => {
    const { gpu } = input;
    return {
      sampledAt: input.sampledAt,
      source: context.source(),
      // No portable CPU temperature source: null, never a guess.
      cpu: { usagePercent: input.cpu.usagePercent, cores: input.cpu.cores, temperatureC: null },
      ram: {
        usedBytes: input.ram.usedBytes,
        totalBytes: input.ram.totalBytes,
        usagePercent:
          input.ram.totalBytes > 0
            ? round1(clampPercent((input.ram.usedBytes / input.ram.totalBytes) * 100))
            : 0,
      },
      gpu: gpu ? { name: gpu.name, usagePercent: gpu.usagePercent, temperatureC: gpu.temperatureC } : null,
      vram: gpu?.vram ?? null,
      temperatures: gpu?.temperatureC != null ? [{ sensor: "GPU", celsius: gpu.temperatureC }] : [],
      storage: input.storage,
      network: {
        rxBytesPerSec: input.network.rxBytesPerSec,
        txBytesPerSec: input.network.txBytesPerSec,
        latencyMs: null,
      },
    };
  },
});

export interface HealthcheckInput {
  key: ServiceKey;
  probe: ProbeResult;
  checkedAt: string;
  correlationId: string;
}

export const healthcheckMapper = defineMapper<HealthcheckInput, HealthcheckResult>({
  name: "local probe -> HealthcheckResult",
  schema: "HealthcheckResult",
  toCanonical: (input) => ({
    serviceId: serviceIdFor(input.key),
    status: input.probe.status,
    latencyMs: input.probe.latencyMs,
    checkedAt: input.checkedAt,
    message: input.probe.detail,
    correlationId: input.correlationId,
  }),
});
