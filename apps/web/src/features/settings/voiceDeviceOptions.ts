import type { VoiceDevice } from "@friday/sdk";

// The voice service opens its input at 16 kHz. MME and DirectSound resample transparently,
// while WASAPI shared mode and WDM-KS reject foreign sample rates. When the same physical
// device is reported once per host API, the resampling host APIs are preferred first.
export const HOST_API_PREFERENCE = ["MME", "Windows DirectSound", "Windows WASAPI", "Windows WDM-KS"] as const;

export interface DeviceOption {
  value: string;
  label: string;
}

const apiRank = (device: VoiceDevice): number => {
  const index = (HOST_API_PREFERENCE as readonly string[]).indexOf(device.labels?.[0] ?? "");
  return index === -1 ? HOST_API_PREFERENCE.length : index;
};

export function voiceDeviceOptions(
  devices: readonly VoiceDevice[],
  kind: "input" | "output",
  current: string | null,
  labels: { systemDefault: string; missing: string },
): DeviceOption[] {
  const groups = new Map<string, VoiceDevice[]>();
  const known = new Set<string>();
  for (const device of devices) {
    if (device.kind !== kind) continue;
    known.add(device.id);
    const group = groups.get(device.name);
    if (group) group.push(device);
    else groups.set(device.name, [device]);
  }

  const options: DeviceOption[] = [{ value: "", label: labels.systemDefault }];
  for (const [name, group] of groups) {
    const representative = group.find((device) => device.id === current)
      ?? group.find((device) => device.isDefault)
      ?? group.reduce((best, device) => (apiRank(device) < apiRank(best) ? device : best));
    options.push({
      value: representative.id,
      label: group.some((device) => device.isDefault) ? `${name} (${labels.systemDefault})` : name,
    });
  }

  if (current && !known.has(current)) options.push({ value: current, label: labels.missing });
  return options;
}
