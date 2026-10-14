/** `$${` is the escape for a literal `${`; `${NAME}` and `${NAME:-default}` are substitutions. */
const PATTERN = /\$\$\{|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export interface InterpolationMiss {
  path: string;
  variable: string;
}

/**
 * Replaces `${VAR}` / `${VAR:-default}` in every string of a parsed YAML tree. Unset or empty variables
 * without default are reported through `misses` and left untouched. Returns a new tree.
 */
export function interpolateTree<T>(value: T, env: NodeJS.ProcessEnv, misses: InterpolationMiss[], path = ''): T {
  return walk(value, env, misses, path) as T;
}

function walk(value: unknown, env: NodeJS.ProcessEnv, misses: InterpolationMiss[], path: string): unknown {
  if (typeof value === 'string') return interpolateString(value, env, (variable) => misses.push({ path, variable }));
  if (Array.isArray(value)) return value.map((item, index) => walk(item, env, misses, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) out[key] = walk(child, env, misses, path ? `${path}.${key}` : key);
    return out;
  }
  return value;
}

export function interpolateString(input: string, env: NodeJS.ProcessEnv, onMissing: (variable: string) => void): string {
  return input.replace(PATTERN, (match, name: string | undefined, fallback: string | undefined) => {
    if (match === '$${') return '${';
    const current = env[name as string];
    if (current !== undefined && current !== '') return current;
    if (fallback !== undefined) return fallback;
    onMissing(name as string);
    return match;
  });
}
