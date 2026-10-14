import { describe, expect, it } from "vitest";
import {
  cpuUsagePercent,
  decodeCommandOutput,
  parseModelIds,
  parseNetstatEthernet,
  parseNvidiaSmi,
  parseProcNetDev,
  parseWslList,
  sampleCpu,
} from "../src";
import { wslOutput } from "./support/fake-host";

describe("cpu sampling", () => {
  it("computes load from the tick deltas of all cores", () => {
    const before = sampleCpu([
      { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
      { user: 200, nice: 0, sys: 50, idle: 750, irq: 0 },
    ]);
    const after = sampleCpu([
      { user: 175, nice: 0, sys: 75, idle: 900, irq: 0 },
      { user: 275, nice: 0, sys: 75, idle: 800, irq: 0 },
    ]);
    // per core: busy +100 (user 75, sys 25), idle +50 -> total 300, busy 200 -> 66.7 %
    expect(cpuUsagePercent(before, after)).toBe(66.7);
  });

  it("returns null when the counters did not advance and clamps to 0..100", () => {
    const sample = sampleCpu([{ user: 1, nice: 0, sys: 1, idle: 1, irq: 0 }]);
    expect(cpuUsagePercent(sample, sample)).toBeNull();
    expect(cpuUsagePercent({ idle: 10, total: 10 }, { idle: 5, total: 20 })).toBe(100);
    expect(cpuUsagePercent({ idle: 0, total: 0 }, { idle: 50, total: 20 })).toBe(0);
  });
});

describe("parseNvidiaSmi", () => {
  it("parses name, utilization, temperature and memory (MiB -> bytes)", () => {
    expect(parseNvidiaSmi("NVIDIA GeForce RTX 4070, 12, 45, 1024, 12282\n")).toEqual({
      name: "NVIDIA GeForce RTX 4070",
      usagePercent: 12,
      temperatureC: 45,
      vram: { usedBytes: 1024 * 1024 * 1024, totalBytes: 12282 * 1024 * 1024, usagePercent: 8.3 },
    });
  });

  it("uses the first GPU of several", () => {
    expect(parseNvidiaSmi("GPU A, 5, 40, 100, 1000\nGPU B, 90, 80, 900, 1000\n")?.name).toBe("GPU A");
  });

  it("keeps a missing sensor as null instead of inventing it", () => {
    const reading = parseNvidiaSmi("Tesla T4, 3, [N/A], [N/A], [N/A]");
    expect(reading).toMatchObject({ name: "Tesla T4", usagePercent: 3, temperatureC: null, vram: null });
  });

  it("drops the whole reading when utilization is unavailable", () => {
    expect(parseNvidiaSmi("Tesla T4, [Not Supported], 40, 1, 2")).toBeNull();
  });

  it("copes with a comma in the model name", () => {
    expect(parseNvidiaSmi("NVIDIA RTX A1000, Laptop GPU, 7, 50, 200, 4096")?.name).toBe(
      "NVIDIA RTX A1000, Laptop GPU",
    );
  });

  it.each(["", "\n", "No devices were found", "a, b, c", "x, 1, 2, 3"])("returns null for %j", (output) => {
    expect(parseNvidiaSmi(output)).toBeNull();
  });
});

describe("network counters", () => {
  const procNetDev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000  50    0    0    0     0          0         0     5000  50    0    0    0     0       0          0
  eth0: 1000  10    0    0    0     0          0         0     2000  20    0    0    0     0       0          0
 wlan0: 300   3     0    0    0     0          0         0      400   4    0    0    0     0       0          0
`;

  it("sums all non-loopback interfaces of /proc/net/dev", () => {
    expect(parseProcNetDev(procNetDev)).toEqual({ rxBytes: 1300, txBytes: 2400 });
  });

  it("returns null without any interface", () => {
    expect(parseProcNetDev("Inter-|\n face |\n    lo: 1 1 0 0 0 0 0 0 1 1 0 0 0 0 0 0\n")).toBeNull();
  });

  it("reads the Bytes row of netstat -e (English and German)", () => {
    const english = `Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    123456789      987654321\r\nUnicast packets             100              200\r\n`;
    const german = `Schnittstellenstatistik\n\n                           Empfangen        Gesendet\n\nBytes                      4294967296       8589934592\n`;
    expect(parseNetstatEthernet(english)).toEqual({ rxBytes: 123456789, txBytes: 987654321 });
    expect(parseNetstatEthernet(german)).toEqual({ rxBytes: 4294967296, txBytes: 8589934592 });
  });

  it("returns null when the label is translated", () => {
    expect(parseNetstatEthernet("Octets   1   2\n")).toBeNull();
  });
});

describe("WSL list", () => {
  it("decodes the UTF-16LE output of wsl.exe and parses the rows", () => {
    const text = decodeCommandOutput(
      wslOutput([
        { name: "Ubuntu", state: "Running", isDefault: true },
        { name: "docker-desktop", state: "Stopped" },
      ]),
    );
    expect(text).not.toContain("\0");
    expect(parseWslList(text)).toEqual([
      { name: "Ubuntu", state: "running", rawState: "Running", isDefault: true },
      { name: "docker-desktop", state: "stopped", rawState: "Stopped", isDefault: false },
    ]);
  });

  it("understands German state names", () => {
    const text = decodeCommandOutput(
      wslOutput(
        [
          { name: "Ubuntu", state: "Wird ausgeführt", isDefault: true },
          { name: "Debian", state: "Beendet" },
        ],
        "  NAME      STATUS          VERSION",
      ),
    );
    const rows = parseWslList(text);
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ["Ubuntu", "running"],
      ["Debian", "stopped"],
    ]);
  });

  it("reports unknown state words as other", () => {
    const rows = parseWslList(decodeCommandOutput(wslOutput([{ name: "Ubuntu", state: "Installing" }])));
    expect(rows[0]).toMatchObject({ name: "Ubuntu", state: "other", rawState: "Installing" });
  });

  it("decodes UTF-8 output unchanged and strips a BOM", () => {
    expect(decodeCommandOutput(Buffer.from("\uFEFFhallo\r\nwelt", "utf8"))).toBe("hallo\nwelt");
  });
});

describe("parseModelIds", () => {
  it("reads OpenAI-style lists and ignores anything else", () => {
    expect(
      parseModelIds({ object: "list", data: [{ id: "qwen3-router" }, { id: "" }, { nope: 1 }, null] }),
    ).toEqual(["qwen3-router"]);
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ data: "x" })).toEqual([]);
    expect(parseModelIds("<html>")).toEqual([]);
  });
});
