import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";

export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface FsStats {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

/**
 * Everything the adapter needs from the machine it runs on. The default implementation (`nodeHost`) uses `node:os`,
 * `node:fs` and `execFile` with fixed argument lists; tests inject a deterministic host so that Windows-only paths
 * (`wsl.exe`, `netstat`) are verified on Linux as well.
 */
export interface HostApi {
  readonly platform: NodeJS.Platform;
  cpuTimes(): CpuTimes[];
  totalMemoryBytes(): number;
  freeMemoryBytes(): number;
  /** Seconds since the Control API process started (`process.uptime()`). */
  processUptimeSeconds(): number;
  statfs(path: string): Promise<FsStats>;
  readTextFile(path: string): Promise<string>;
  /** Runs an executable with a fixed argument list and no shell; rejects on non-zero exit, timeout or missing binary. */
  run(
    file: string,
    args: readonly string[],
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<Buffer>;
}

export const nodeHost: HostApi = {
  platform: process.platform,
  cpuTimes: () => {
    const list = cpus();
    // Some virtualised environments report an empty list; one logical core is the minimum the contract allows.
    return list.length > 0 ? list.map((cpu) => cpu.times) : [{ user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }];
  },
  totalMemoryBytes: () => totalmem(),
  freeMemoryBytes: () => freemem(),
  processUptimeSeconds: () => process.uptime(),
  statfs: async (path) => {
    const stats = await statfs(path);
    return {
      bsize: Number(stats.bsize),
      blocks: Number(stats.blocks),
      bfree: Number(stats.bfree),
      bavail: Number(stats.bavail),
    };
  },
  readTextFile: async (path) => (await readFile(path, "utf8")).replace(/^\uFEFF/, ""),
  run: (file, args, options) =>
    new Promise<Buffer>((resolve, reject) => {
      execFile(
        file,
        [...args],
        {
          timeout: options.timeoutMs,
          windowsHide: true,
          encoding: "buffer",
          maxBuffer: 1024 * 1024,
          ...(options.signal ? { signal: options.signal } : {}),
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      );
    }),
};
