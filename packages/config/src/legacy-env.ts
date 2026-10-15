/**
 * Backward compatibility for the 2026-10-15 rename of the environment variables (`JARVIS_*` -> `FRIDAY_*`).
 * A legacy variable is only honoured when its `FRIDAY_*` counterpart is unset; the caller reports it once.
 */
const LEGACY_PREFIX = 'JARVIS_';
const PREFIX = 'FRIDAY_';

export interface LegacyEnvResult {
  /** The environment with `FRIDAY_X` filled from a legacy `JARVIS_X` where needed (the input is never mutated). */
  env: NodeJS.ProcessEnv;
  /** Legacy variable names that were applied, sorted. */
  legacy: string[];
}

export function normalizeLegacyEnv(source: NodeJS.ProcessEnv): LegacyEnvResult {
  const legacy: string[] = [];
  let env: NodeJS.ProcessEnv | undefined;
  for (const [name, value] of Object.entries(source)) {
    if (!name.startsWith(LEGACY_PREFIX) || value === undefined) continue;
    const current = PREFIX + name.slice(LEGACY_PREFIX.length);
    if (source[current] !== undefined) continue;
    env ??= { ...source };
    env[current] = value;
    legacy.push(name);
  }
  return { env: env ?? source, legacy: legacy.sort() };
}

export function legacyEnvWarning(legacy: readonly string[]): string {
  return `Veraltete Umgebungsvariablen (${legacy.join(', ')}) werden noch gelesen; bitte auf FRIDAY_* umstellen (JARVIS_* entfällt in einer späteren Version).`;
}
