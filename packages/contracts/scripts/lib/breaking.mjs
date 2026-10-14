// Breaking-change detection between a released baseline and the current contract.
// Works on the contract sources (OpenAPI / AsyncAPI documents and JSON Schema files); $refs stay opaque,
// so a changed $ref target is reported as a type change of the referring property.

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** @typedef {{ kind: string, path: string, message: string }} Change */

export function majorOf(version) {
  const major = Number.parseInt(String(version ?? "0").split(".")[0] ?? "0", 10);
  return Number.isNaN(major) ? 0 : major;
}

/**
 * Structural diff of two JSON Schema nodes.
 * @param {any} before
 * @param {any} after
 * @param {string} where JSON-pointer-like location used in messages
 * @param {Change[]} out
 */
export function diffSchemaNode(before, after, where, out) {
  if (before === undefined) return;
  if (after === undefined) {
    out.push({ kind: "schema-removed", path: where, message: `${where} was removed` });
    return;
  }
  if (!isObject(before) || !isObject(after)) {
    if (!same(before, after))
      out.push({
        kind: "type-changed",
        path: where,
        message: `${where} changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`,
      });
    return;
  }

  if (before.$ref !== undefined || after.$ref !== undefined) {
    if (before.$ref !== after.$ref) {
      out.push({
        kind: "type-changed",
        path: where,
        message: `${where} $ref changed from ${before.$ref ?? "(inline)"} to ${after.$ref ?? "(inline)"}`,
      });
    }
    return;
  }

  if (!same(asArray(before.type).slice().sort(), asArray(after.type).slice().sort())) {
    out.push({
      kind: "type-changed",
      path: where,
      message: `${where} type changed from ${JSON.stringify(before.type)} to ${JSON.stringify(after.type)}`,
    });
  }
  if ("const" in before && !same(before.const, after.const)) {
    out.push({
      kind: "type-changed",
      path: where,
      message: `${where} const changed from ${JSON.stringify(before.const)} to ${JSON.stringify(after.const)}`,
    });
  }
  if (before.format !== undefined && before.format !== after.format) {
    out.push({
      kind: "type-changed",
      path: where,
      message: `${where} format changed from ${before.format} to ${after.format ?? "(none)"}`,
    });
  }

  if (Array.isArray(before.enum)) {
    const next = Array.isArray(after.enum) ? after.enum : undefined;
    for (const value of before.enum) {
      if (next && !next.some((candidate) => same(candidate, value))) {
        out.push({
          kind: "enum-value-removed",
          path: where,
          message: `${where} enum value ${JSON.stringify(value)} was removed`,
        });
      }
    }
  }

  // Tightened constraints reject data that used to be valid.
  for (const key of ["minimum", "minLength", "minItems", "minProperties"]) {
    if (typeof after[key] === "number" && after[key] > (before[key] ?? Number.NEGATIVE_INFINITY)) {
      out.push({
        kind: "constraint-tightened",
        path: where,
        message: `${where} ${key} raised to ${after[key]}`,
      });
    }
  }
  for (const key of ["maximum", "maxLength", "maxItems", "maxProperties"]) {
    if (typeof after[key] === "number" && after[key] < (before[key] ?? Number.POSITIVE_INFINITY)) {
      out.push({
        kind: "constraint-tightened",
        path: where,
        message: `${where} ${key} lowered to ${after[key]}`,
      });
    }
  }
  if (before.pattern !== after.pattern && after.pattern !== undefined) {
    out.push({
      kind: "constraint-tightened",
      path: where,
      message: `${where} pattern changed to ${after.pattern}`,
    });
  }

  const beforeProps = isObject(before.properties) ? before.properties : {};
  const afterProps = isObject(after.properties) ? after.properties : {};
  for (const name of Object.keys(beforeProps)) {
    if (!(name in afterProps)) {
      out.push({
        kind: "property-removed",
        path: `${where}/properties/${name}`,
        message: `${where}: property "${name}" was removed`,
      });
    } else {
      diffSchemaNode(beforeProps[name], afterProps[name], `${where}/properties/${name}`, out);
    }
  }
  const beforeRequired = new Set(asArray(before.required));
  for (const name of asArray(after.required)) {
    if (!beforeRequired.has(name)) {
      const isNew = !(name in beforeProps);
      out.push({
        kind: "property-required",
        path: `${where}/required/${name}`,
        message: `${where}: property "${name}" became required${isNew ? " (newly added)" : ""}`,
      });
    }
  }

  if (isObject(before.additionalProperties))
    diffSchemaNode(
      before.additionalProperties,
      after.additionalProperties,
      `${where}/additionalProperties`,
      out,
    );
  if (before.additionalProperties === true && after.additionalProperties === false) {
    out.push({
      kind: "constraint-tightened",
      path: where,
      message: `${where} no longer allows additional properties`,
    });
  }
  if (isObject(before.patternProperties)) {
    for (const key of Object.keys(before.patternProperties))
      diffSchemaNode(
        before.patternProperties[key],
        after.patternProperties?.[key],
        `${where}/patternProperties/${key}`,
        out,
      );
  }
  if (before.items !== undefined) diffSchemaNode(before.items, after.items, `${where}/items`, out);

  for (const combiner of ["anyOf", "oneOf"]) {
    if (Array.isArray(before[combiner])) {
      const next = Array.isArray(after[combiner]) ? after[combiner] : [];
      before[combiner].forEach((variant, index) => {
        if (!next.some((candidate) => same(candidate, variant))) {
          const counterpart = next[index];
          const before2 = out.length;
          if (counterpart !== undefined)
            diffSchemaNode(variant, counterpart, `${where}/${combiner}/${index}`, out);
          if (counterpart === undefined || out.length === before2) {
            out.push({
              kind: "variant-removed",
              path: `${where}/${combiner}/${index}`,
              message: `${where}: ${combiner} variant ${index} was removed`,
            });
          }
        }
      });
    }
  }
  if (Array.isArray(before.allOf)) {
    before.allOf.forEach((part, index) =>
      diffSchemaNode(part, after.allOf?.[index], `${where}/allOf/${index}`, out),
    );
  }
  if (isObject(before.$defs)) {
    for (const key of Object.keys(before.$defs))
      diffSchemaNode(before.$defs[key], after.$defs?.[key], `${where}/$defs/${key}`, out);
  }
}

/**
 * @param {Map<string, any>|Record<string, any>} before schemas keyed by $id (or path)
 * @param {Map<string, any>|Record<string, any>} after
 * @returns {Change[]}
 */
export function diffSchemas(before, after) {
  const toMap = (m) => (m instanceof Map ? m : new Map(Object.entries(m)));
  const b = toMap(before);
  const a = toMap(after);
  /** @type {Change[]} */
  const out = [];
  for (const [id, schema] of b) {
    const next = a.get(id);
    if (!next) {
      out.push({ kind: "schema-removed", path: id, message: `schema ${id} was removed` });
      continue;
    }
    diffSchemaNode(schema, next, id.replace("https://jarvis.local/schemas/", "schema:"), out);
  }
  return out;
}

const resolveParam = (doc, param) => {
  if (param?.$ref?.startsWith("#/components/parameters/"))
    return doc.components?.parameters?.[param.$ref.split("/").pop()] ?? param;
  return param;
};
const paramKey = (p) => `${p.in}:${String(p.name).toLowerCase()}`;
const contentRefs = (content) =>
  Object.fromEntries(Object.entries(content ?? {}).map(([mime, v]) => [mime, v?.schema]));

/** @returns {Change[]} */
export function diffOpenapi(before, after) {
  /** @type {Change[]} */
  const out = [];
  for (const [pathKey, item] of Object.entries(before.paths ?? {})) {
    const next = after.paths?.[pathKey];
    if (!next) {
      out.push({ kind: "path-removed", path: pathKey, message: `path ${pathKey} was removed` });
      continue;
    }
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const where = `${method.toUpperCase()} ${pathKey}`;
      const nextOp = next[method];
      if (!nextOp) {
        out.push({ kind: "operation-removed", path: where, message: `operation ${where} was removed` });
        continue;
      }
      if (op.operationId !== nextOp.operationId) {
        out.push({
          kind: "operation-id-changed",
          path: where,
          message: `${where} operationId changed from ${op.operationId} to ${nextOp.operationId}`,
        });
      }
      const oldParams = new Map(
        [...(item.parameters ?? []), ...(op.parameters ?? [])]
          .map((p) => resolveParam(before, p))
          .map((p) => [paramKey(p), p]),
      );
      const newParams = new Map(
        [...(next.parameters ?? []), ...(nextOp.parameters ?? [])]
          .map((p) => resolveParam(after, p))
          .map((p) => [paramKey(p), p]),
      );
      for (const [key, param] of oldParams) {
        const nextParam = newParams.get(key);
        if (!nextParam)
          out.push({
            kind: "parameter-removed",
            path: where,
            message: `${where}: parameter ${key} was removed`,
          });
        else {
          diffSchemaNode(param.schema, nextParam.schema, `${where} parameter ${key}`, out);
          if (nextParam.required && !param.required)
            out.push({
              kind: "parameter-required",
              path: where,
              message: `${where}: parameter ${key} became required`,
            });
        }
      }
      for (const [key, param] of newParams) {
        if (!oldParams.has(key) && param.required)
          out.push({
            kind: "parameter-required",
            path: where,
            message: `${where}: new required parameter ${key}`,
          });
      }
      if (nextOp.requestBody) {
        if (!op.requestBody) {
          if (nextOp.requestBody.required)
            out.push({
              kind: "request-body-required",
              path: where,
              message: `${where}: request body is now required`,
            });
        } else {
          if (nextOp.requestBody.required && !op.requestBody.required)
            out.push({
              kind: "request-body-required",
              path: where,
              message: `${where}: request body became required`,
            });
          diffContent(op.requestBody.content, nextOp.requestBody.content, `${where} request`, out);
        }
      } else if (op.requestBody) {
        out.push({
          kind: "request-body-removed",
          path: where,
          message: `${where}: request body was removed`,
        });
      }
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        const nextResponse = nextOp.responses?.[status];
        if (!nextResponse) {
          out.push({
            kind: "response-removed",
            path: where,
            message: `${where}: response ${status} was removed`,
          });
        } else if (response.content) {
          diffContent(response.content, nextResponse.content, `${where} response ${status}`, out);
        }
      }
    }
  }
  // Alias table: a changed target means every consumer of that name sees another model.
  for (const [name, schema] of Object.entries(before.components?.schemas ?? {})) {
    const next = after.components?.schemas?.[name];
    if (!next)
      out.push({
        kind: "schema-removed",
        path: `components/schemas/${name}`,
        message: `component schema ${name} was removed`,
      });
    else diffSchemaNode(schema, next, `components/schemas/${name}`, out);
  }
  return out;
}

function diffContent(before, after, where, out) {
  const oldRefs = contentRefs(before);
  const newRefs = contentRefs(after);
  for (const [mime, schema] of Object.entries(oldRefs)) {
    if (!(mime in newRefs))
      out.push({
        kind: "media-type-removed",
        path: where,
        message: `${where}: media type ${mime} was removed`,
      });
    else diffSchemaNode(schema, newRefs[mime], `${where} ${mime}`, out);
  }
}

const eventMessages = (doc) =>
  Object.fromEntries(
    Object.values(doc.components?.messages ?? {})
      .filter((m) => m?.name)
      .map((m) => [m.name, m.payload]),
  );

/** @returns {Change[]} */
export function diffAsyncapi(before, after) {
  /** @type {Change[]} */
  const out = [];
  const oldMessages = eventMessages(before);
  const newMessages = eventMessages(after);
  for (const [name, payload] of Object.entries(oldMessages)) {
    if (!(name in newMessages))
      out.push({ kind: "event-removed", path: name, message: `event type ${name} was removed` });
    else diffSchemaNode(payload, newMessages[name], `event ${name}`, out);
  }
  for (const [channel, value] of Object.entries(before.channels ?? {})) {
    const next = after.channels?.[channel];
    if (!next)
      out.push({ kind: "channel-removed", path: channel, message: `channel ${channel} was removed` });
    else if (value.address !== next.address)
      out.push({
        kind: "channel-address-changed",
        path: channel,
        message: `channel ${channel} address changed from ${value.address} to ${next.address}`,
      });
  }
  return out;
}

/**
 * @param {{ openapi: any, asyncapi: any, schemas: Map<string, any>|Record<string, any> }} baseline
 * @param {{ openapi: any, asyncapi: any, schemas: Map<string, any>|Record<string, any> }} current
 */
export function detectBreaking(baseline, current) {
  const changes = [
    ...diffOpenapi(baseline.openapi, current.openapi),
    ...diffAsyncapi(baseline.asyncapi, current.asyncapi),
    ...diffSchemas(baseline.schemas, current.schemas),
  ];
  const baselineMajor = majorOf(baseline.openapi?.info?.version);
  const currentMajor = majorOf(current.openapi?.info?.version);
  const majorBumped = currentMajor > baselineMajor;
  return { changes, baselineMajor, currentMajor, majorBumped, ok: changes.length === 0 || majorBumped };
}
