import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { ConfigProblem } from './errors';
import adaptersSchema from './schemas/adapters.schema.json';
import dashboardSchema from './schemas/dashboard.schema.json';

export { adaptersSchema, dashboardSchema };

// AJV's CJS default export is typed as the module namespace under `Bundler` resolution; the class is on `.default` there.
const AjvClass = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;

let validators: { dashboard: ValidateFunction; adapters: ValidateFunction } | undefined;

function getValidators() {
  if (!validators) {
    // useDefaults fills schema defaults, coerceTypes turns "3100" (from ${PORT}) into 3100, allErrors reports every problem.
    const ajv = new AjvClass({ allErrors: true, useDefaults: true, coerceTypes: true, strict: true, verbose: true });
    validators = {
      dashboard: ajv.compile(dashboardSchema),
      adapters: ajv.compile(adaptersSchema),
    };
  }
  return validators;
}

function pointerToPath(pointer: string): string {
  return pointer
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((acc, segment) => (/^\d+$/.test(segment) ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment), '');
}

function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}...` : value);
  if (typeof value === 'object' && value !== null) return Array.isArray(value) ? 'an array' : 'an object';
  return String(value);
}

function describe(error: ErrorObject): { path: string; message: string } {
  const base = pointerToPath(error.instancePath);
  const join = (child: string) => (base ? `${base}.${child}` : child);
  const got = 'data' in error ? ` (got ${show(error.data)})` : '';
  switch (error.keyword) {
    case 'additionalProperties':
      return { path: join(String(error.params.additionalProperty)), message: 'unknown property' };
    case 'required':
      return { path: join(String(error.params.missingProperty)), message: 'required property is missing' };
    case 'enum':
      return { path: base, message: `must be one of: ${(error.params.allowedValues as unknown[]).join(', ')}${got}` };
    case 'type':
      return { path: base, message: `must be ${String(error.params.type)}${got}` };
    case 'minimum':
    case 'maximum':
      return { path: base, message: `must be ${String(error.params.comparison)} ${String(error.params.limit)}${got}` };
    case 'pattern':
      return { path: base, message: `must match pattern ${String(error.params.pattern)}${got}` };
    case 'propertyNames':
      return { path: base, message: `invalid property name${got}` };
    default:
      return { path: base, message: `${error.message ?? 'is invalid'}${got}` };
  }
}

/**
 * Validates `data` in place (defaults and coercions are applied to it). Callers pass a clone.
 */
export function validateDocument(kind: 'dashboard' | 'adapters', data: unknown, source: string): ConfigProblem[] {
  const validate = getValidators()[kind];
  if (validate(data)) return [];
  const seen = new Set<string>();
  const problems: ConfigProblem[] = [];
  for (const error of validate.errors ?? []) {
    const { path, message } = describe(error);
    const key = `${path}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ source, path, message });
  }
  return problems;
}
