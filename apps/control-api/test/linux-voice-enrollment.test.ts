import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addEnrollmentSample, enrollmentStatus, startEnrollmentTraining } from "../src/services/linux-voice-enrollment";

const original = { ...process.env };
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks(); process.env = { ...original };
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function setup() {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  const root = mkdtempSync(join(tmpdir(), "friday-enrollment-test-")); roots.push(root);
  const config = join(root, "config"); mkdirSync(config);
  writeFileSync(join(config, "voice.json"), JSON.stringify({ voice_mode: "elevenlabs", wake_phrase: "Hey Friday" }));
  process.env.FRIDAY_STATE_ROOT = root;
  process.env.FRIDAY_INSTALL_ROOT = root;
  process.env.FRIDAY_CONFIG_DIR = config;
  return root;
}

describe("native Linux owner enrollment storage", () => {
  it("rejects malformed, silent-short, and oversized PCM before writing", () => {
    const root = setup();
    expect(() => addEnrollmentSample("wake", "not pcm!")).toThrow();
    expect(() => addEnrollmentSample("wake", Buffer.alloc(100).toString("base64"))).toThrow();
    expect(() => addEnrollmentSample("wake", Buffer.alloc(192_002).toString("base64"))).toThrow();
    expect(enrollmentStatus().counts.wake).toBe(0);
    expect(() => startEnrollmentTraining()).toThrow("Es fehlen Proben");
    expect(readFileSync(join(root, "config/voice.json"), "utf8")).toContain("Hey Friday");
  });

  it("writes bounded PCM as a private 16 kHz wave sample", () => {
    const root = setup();
    const status = addEnrollmentSample("wake", Buffer.alloc(32_000).toString("base64"));
    expect(status.counts.wake).toBe(1);
    const file = join(root, "voice/profiles/owner/raw/wake_hey_friday/sample-01.wav");
    const wave = readFileSync(file);
    expect(wave.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wave.readUInt32LE(24)).toBe(16_000);
    expect(wave.length).toBe(32_044);
  });
});
