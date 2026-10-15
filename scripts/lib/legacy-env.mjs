// Dev-script counterpart of `normalizeLegacyEnv` in @friday/config: honours the pre-rename JARVIS_* variables
// (and NEXT_PUBLIC_JARVIS_*) while the FRIDAY_* variant is unset, and prints one deprecation warning.
const RULES = [
  ["JARVIS_", "FRIDAY_"],
  ["NEXT_PUBLIC_JARVIS_", "NEXT_PUBLIC_FRIDAY_"],
];

export function withLegacyEnv(source = process.env, warn = (message) => console.warn(message)) {
  const env = { ...source };
  const applied = [];
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    for (const [legacyPrefix, prefix] of RULES) {
      if (!name.startsWith(legacyPrefix)) continue;
      const current = prefix + name.slice(legacyPrefix.length);
      if (source[current] !== undefined) continue;
      env[current] = value;
      applied.push(name);
    }
  }
  if (applied.length > 0) {
    warn(`Veraltete Umgebungsvariablen (${applied.sort().join(", ")}) werden noch gelesen; bitte auf FRIDAY_* umstellen.`);
  }
  return env;
}
