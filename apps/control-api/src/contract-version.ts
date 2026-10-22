import { CONTRACT_VERSION } from "@friday/sdk";

/**
 * Optionaler Anforderungsheader, mit dem ein Client die Vertragsversion nennt, die er spricht. Fehlt er, bleibt alles
 * wie bisher; nennt er eine inkompatible Hauptversion, antwortet die API klar statt still falsch zu interpretieren.
 */
export const CONTRACT_VERSION_HEADER = "x-friday-contract-version";

export interface ParsedContractVersion {
  major: number;
  minor: number;
  patch: number;
}

const pattern = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseContractVersion(value: unknown): ParsedContractVersion | null {
  if (typeof value !== "string") return null;
  const match = pattern.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Eigene Hauptversion, z. B. 2 aus "2.0.0". */
export const CONTRACT_MAJOR = parseContractVersion(CONTRACT_VERSION)?.major ?? 0;

export function supportedContractVersions(): string {
  return `${CONTRACT_MAJOR}.x (dieser Dienst spricht ${CONTRACT_VERSION})`;
}

/**
 * Kompatibel ist, wer dieselbe Hauptversion spricht. Innerhalb einer Hauptversion sind Minor und Patch additiv; eine
 * andere Hauptversion kann Felder anders deuten, deshalb wird sie abgelehnt statt geraten.
 */
export function isContractVersionSupported(value: unknown): boolean {
  const parsed = parseContractVersion(value);
  return parsed !== null && parsed.major === CONTRACT_MAJOR;
}