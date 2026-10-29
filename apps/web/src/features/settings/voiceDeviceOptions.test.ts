import type { VoiceDevice } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { voiceDeviceOptions } from "./voiceDeviceOptions";

const text = { systemDefault: "Systemstandard", missing: "Gewähltes Gerät nicht verbunden" };

function device(
  id: string,
  name: string,
  api: string,
  kind: "input" | "output" = "input",
  isDefault = false,
): VoiceDevice {
  return {
    id,
    version: 1,
    createdAt: "2026-10-14T08:15:00Z",
    updatedAt: "2026-10-14T08:15:00Z",
    labels: [api],
    source: { adapterId: "voice-http", system: "voice", lastSyncedAt: "2026-10-14T08:15:00Z" },
    name,
    kind,
    isDefault,
    status: "online",
  } as VoiceDevice;
}

describe("voiceDeviceOptions", () => {
  it("führt dieselbe physische Quelle nur einmal auf und nennt den Standard", () => {
    const options = voiceDeviceOptions([
      device("vdev_mme", "Soundcore R50i", "MME"),
      device("vdev_dsound", "Soundcore R50i", "Windows DirectSound", "input", true),
      device("vdev_wasapi", "Soundcore R50i", "Windows WASAPI"),
      device("vdev_wdm", "Soundcore R50i", "Windows WDM-KS"),
      device("vdev_array", "Mikrofon-Array", "Windows WASAPI"),
    ], "input", null, text);

    expect(options).toHaveLength(3);
    expect(options[0]).toEqual({ value: "", label: "Systemstandard" });
    expect(options[1]).toEqual({ value: "vdev_dsound", label: "Soundcore R50i (Systemstandard)" });
    expect(options[2]).toEqual({ value: "vdev_array", label: "Mikrofon-Array" });
  });

  it("bevorzugt ohne Standard die MME-Schnittstelle", () => {
    const options = voiceDeviceOptions([
      device("vdev_wdm", "Soundcore R50i", "Windows WDM-KS"),
      device("vdev_mme", "Soundcore R50i", "MME"),
    ], "input", null, text);

    expect(options).toHaveLength(2);
    expect(options[1]).toEqual({ value: "vdev_mme", label: "Soundcore R50i" });
  });

  it("behaelt das gespeicherte Geraet als Vertreter seiner Gruppe", () => {
    const options = voiceDeviceOptions([
      device("vdev_mme", "Soundcore R50i", "MME", "input", true),
      device("vdev_wasapi", "Soundcore R50i", "Windows WASAPI"),
    ], "input", "vdev_wasapi", text);

    expect(options).toHaveLength(2);
    expect(options[1]).toEqual({ value: "vdev_wasapi", label: "Soundcore R50i (Systemstandard)" });
  });

  it("ignoriert Ausgabegeraete bei der Eingabegeraeteliste", () => {
    const options = voiceDeviceOptions([
      device("vdev_out", "Lautsprecher", "MME", "output"),
      device("vdev_in", "Mikrofon", "MME"),
    ], "input", null, text);

    expect(options).toHaveLength(2);
    expect(options[1]).toEqual({ value: "vdev_in", label: "Mikrofon" });
  });

  it("haelt eine nicht verbundene Auswahl ohne rohe ID sichtbar", () => {
    const options = voiceDeviceOptions([
      device("vdev_mme", "Soundcore R50i", "MME"),
    ], "input", "vdev_gone", text);

    expect(options.at(-1)).toEqual({ value: "vdev_gone", label: "Gewähltes Gerät nicht verbunden" });
    expect(options.some((option) => option.label.includes("vdev_"))).toBe(false);
  });
});
