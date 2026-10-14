// Compiles every JSON Schema in strict mode and validates every example against its declared schema.
import path from "node:path";
import { createContractAjv, formatAjvErrors } from "./lib/ajv.mjs";
import { exampleFiles, loadSchemas, paths, readJson, toPosix } from "./lib/contract.mjs";

export function validateAll() {
  const failures = [];
  const schemas = loadSchemas();
  const ajv = createContractAjv(schemas);

  const ids = new Set();
  for (const { rel, schema } of schemas) {
    if (!schema.$id) failures.push(`${rel}: missing $id`);
    else if (ids.has(schema.$id)) failures.push(`${rel}: duplicate $id ${schema.$id}`);
    ids.add(schema.$id);
    const expected = `https://jarvis.local/schemas/${rel}`;
    if (schema.$id !== expected) failures.push(`${rel}: $id must be ${expected}`);
    if (!schema.title) failures.push(`${rel}: missing title`);
    try {
      ajv.getSchema(schema.$id);
    } catch (error) {
      failures.push(`${rel}: ${error.message}`);
    }
  }

  const examples = exampleFiles();
  for (const file of examples) {
    const rel = toPosix(path.relative(paths.examples, file));
    const { $schema: schemaId, ...payload } = readJson(file);
    if (!schemaId) {
      failures.push(`examples/${rel}: missing "$schema"`);
      continue;
    }
    const validate = ajv.getSchema(schemaId);
    if (!validate) {
      failures.push(`examples/${rel}: unknown schema ${schemaId}`);
      continue;
    }
    if (!validate(payload))
      failures.push(
        `examples/${rel}: invalid against ${schemaId}\n    ${formatAjvErrors(validate.errors).join("\n    ")}`,
      );
  }
  return { failures, schemaCount: schemas.length, exampleCount: examples.length };
}

if (process.argv[1]?.endsWith("validate.mjs")) {
  const { failures, schemaCount, exampleCount } = validateAll();
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    console.error(`\nvalidate: FAILED (${failures.length} problem(s))`);
    process.exit(1);
  }
  console.log(`validate: ${schemaCount} schemas compile (strict), ${exampleCount} examples valid`);
}
