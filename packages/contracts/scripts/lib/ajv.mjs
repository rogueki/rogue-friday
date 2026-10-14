import { createRequire } from "node:module";
import { loadSchemas } from "./contract.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default ?? require("ajv/dist/2020");
const addFormats = require("ajv-formats").default ?? require("ajv-formats");

/** Strict AJV 2020 instance with every contract schema registered under its $id. */
export function createContractAjv(schemas = loadSchemas()) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const { schema } of schemas) ajv.addSchema(schema);
  return ajv;
}

export function formatAjvErrors(errors) {
  return (errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message}${e.params ? ` ${JSON.stringify(e.params)}` : ""}`,
  );
}
