import type { CpuTimes, FsStats, HostApi } from "../../src";

export interface RunCall {
  file: string;
  args: readonly string[];
}

export interface FakeHostControl extends HostApi {
  calls: RunCall[];
  /** Advances every core by `busy` busy ticks and `idle` idle ticks. */
  tick(busy: number, idle: number): void;
  setMemory(totalBytes: number, freeBytes: number): void;
  setStat(path: string, stats: FsStats | Error): void;
  setFile(path: string, content: string | Error): void;
  /** Output (or error) of the next/every run of `file`. */
  onRun(
    file: string,
    result: Buffer | string | Error | ((args: readonly string[]) => Buffer | string | Error),
  ): void;
}

const enoent = (name: string): Error => Object.assign(new Error(`spawn ${name} ENOENT`), { code: "ENOENT" });

/** Deterministic machine for tests: two cores, 16 GiB RAM, one 100 GiB drive with 40 GiB used. */
export function createFakeHost(platform: NodeJS.Platform = "linux"): FakeHostControl {
  const cores: CpuTimes[] = [
    { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
    { user: 200, nice: 0, sys: 50, idle: 750, irq: 0 },
  ];
  let total = 16 * 1024 ** 3;
  let free = 6 * 1024 ** 3;
  const stats = new Map<string, FsStats | Error>();
  const files = new Map<string, string | Error>();
  const runs = new Map<string, Parameters<FakeHostControl["onRun"]>[1]>();
  const calls: RunCall[] = [];
  const gib = 1024 ** 3;
  stats.set("/", {
    bsize: 4096,
    blocks: (100 * gib) / 4096,
    bfree: (60 * gib) / 4096,
    bavail: (55 * gib) / 4096,
  });
  stats.set("C:\\", {
    bsize: 4096,
    blocks: (500 * gib) / 4096,
    bfree: (200 * gib) / 4096,
    bavail: (200 * gib) / 4096,
  });

  return {
    platform,
    calls,
    cpuTimes: () => cores.map((core) => ({ ...core })),
    totalMemoryBytes: () => total,
    freeMemoryBytes: () => free,
    processUptimeSeconds: () => 3 * 3600 + 25 * 60,
    async statfs(path) {
      const entry = stats.get(path);
      if (!entry) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      if (entry instanceof Error) throw entry;
      return entry;
    },
    async readTextFile(path) {
      const entry = files.get(path);
      if (entry === undefined) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      if (entry instanceof Error) throw entry;
      return entry;
    },
    async run(file, args) {
      calls.push({ file, args });
      const handler = runs.get(file);
      if (!handler) throw enoent(file);
      const result = typeof handler === "function" ? handler(args) : handler;
      if (result instanceof Error) throw result;
      return typeof result === "string" ? Buffer.from(result, "utf8") : result;
    },
    tick(busy, idle) {
      for (const core of cores) {
        core.user += busy;
        core.idle += idle;
      }
    },
    setMemory(totalBytes, freeBytes) {
      total = totalBytes;
      free = freeBytes;
    },
    setStat: (path, value) => void stats.set(path, value),
    setFile: (path, value) => void files.set(path, value),
    onRun: (file, result) => void runs.set(file, result),
  };
}

/** `wsl.exe -l -v` as Windows writes it to a pipe: UTF-16LE. */
export function wslOutput(
  rows: Array<{ name: string; state: string; isDefault?: boolean }>,
  header = "  NAME      STATE           VERSION",
): Buffer {
  const lines = [
    header,
    ...rows.map((row) => `${row.isDefault ? "*" : " "} ${row.name.padEnd(16)}${row.state.padEnd(16)}2`),
  ];
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "utf16le");
}
