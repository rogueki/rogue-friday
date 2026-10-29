import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function recordAll(): void {
  const pcm = Buffer.alloc(32_000).toString("base64");
  for (const [kind, n] of [["wake", 12], ["short", 8], ["negatives", 8], ["speech", 8]] as const)
    for (let i = 0; i < n; i++) addEnrollmentSample(kind, pcm);
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

  it("a failed retrain restores the previous working profile", async () => {
    const root = setup();
    mkdirSync(join(root, "voice/profiles/owner/embeddings"), { recursive: true });
    mkdirSync(join(root, "models/openwakeword"), { recursive: true });
    mkdirSync(join(root, "voice/enrollment"), { recursive: true });
    writeFileSync(join(root, "voice/profiles/owner/embeddings/owner_ecapa.npy"), "old-profile");
    writeFileSync(join(root, "models/openwakeword/personal_wake.npz"), "old-model");
    writeFileSync(join(root, "models/openwakeword/personal_wake.json"), JSON.stringify({ wake_phrase: "Hey Jarvis" }));
    writeFileSync(join(root, "voice/enrollment/active"), "ready\n");
    recordAll();
    startEnrollmentTraining();
    await vi.waitFor(() => expect(enrollmentStatus().state).toBe("failed"), { timeout: 5000 });
    const files = ["voice/profiles/owner/embeddings/owner_ecapa.npy", "models/openwakeword/personal_wake.npz", "models/openwakeword/personal_wake.json", "voice/enrollment/active"];
    expect(readFileSync(join(root, files[0]!), "utf8")).toBe("old-profile");
    expect(readFileSync(join(root, files[1]!), "utf8")).toBe("old-model");
    expect(readFileSync(join(root, files[2]!), "utf8")).toBe(JSON.stringify({ wake_phrase: "Hey Jarvis" }));
    expect(readFileSync(join(root, files[3]!), "utf8")).toBe("ready\n");
    for (const file of files) expect(existsSync(join(root, `${file}.prev`))).toBe(false);
    expect(enrollmentStatus().error).toContain("bisherige Profil bleibt aktiv");
  });

  it("a failed first training leaves no partial artifacts", async () => {
    const root = setup();
    recordAll();
    startEnrollmentTraining();
    await vi.waitFor(() => expect(enrollmentStatus().state).toBe("failed"), { timeout: 5000 });
    expect(existsSync(join(root, "voice/profiles/owner/embeddings/owner_ecapa.npy"))).toBe(false);
    expect(existsSync(join(root, "models/openwakeword/personal_wake.npz"))).toBe(false);
    expect(existsSync(join(root, "models/openwakeword/personal_wake.json"))).toBe(false);
    const status = enrollmentStatus();
    expect(status.error).toContain("Bitte Proben erneut aufnehmen");
    expect(status.error).not.toContain("bisherige");
  });
});
