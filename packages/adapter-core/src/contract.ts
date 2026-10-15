import { createSchemaValidator, type SchemaValidator, type ValidationIssue } from "@friday/sdk";
import { AdapterError } from "./errors";

let shared: SchemaValidator | undefined;

/** One AJV instance per process; compiling the whole schema registry is the expensive part. */
export function getContractValidator(): SchemaValidator {
  shared ??= createSchemaValidator();
  return shared;
}

export const ADDITIONAL_PROPERTIES_MESSAGE = "must NOT have additional properties";

export interface ContractCheck {
  valid: boolean;
  issues: ValidationIssue[];
  /** True when the only problems are keys the schema does not know: provider-specific fields leaked into a canonical object. */
  providerFieldLeak: boolean;
}

export function checkContract(
  schema: string,
  value: unknown,
  validator: SchemaValidator = getContractValidator(),
): ContractCheck {
  const result = validator.validate(schema, value);
  if (result.valid) return { valid: true, issues: [], providerFieldLeak: false };
  return {
    valid: false,
    issues: result.errors,
    providerFieldLeak: result.errors.some((issue) => issue.message === ADDITIONAL_PROPERTIES_MESSAGE),
  };
}

const MAX_REPORTED_ISSUES = 10;

/**
 * Throws VALIDATION_FAILED when `value` violates the contract schema. The error lists paths and rules only, never the
 * offending values (they may originate from a foreign system and contain secrets).
 */
export function assertContract(
  schema: string,
  value: unknown,
  what = schema,
  validator?: SchemaValidator,
): void {
  const check = checkContract(schema, value, validator);
  if (check.valid) return;
  throw new AdapterError({
    code: "VALIDATION_FAILED",
    message: check.providerFieldLeak
      ? `${what}: provider-specific fields im kanonischen Objekt.`
      : `${what}: Daten verletzen den Vertrag ${schema}.`,
    retryable: false,
    severity: "error",
    details: {
      schema,
      providerFieldLeak: check.providerFieldLeak,
      issues: check.issues.slice(0, MAX_REPORTED_ISSUES),
      issueCount: check.issues.length,
    },
  });
}
