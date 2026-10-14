import path from "node:path";
import { describe, expect, it } from "vitest";
import { createContractAjv, formatAjvErrors } from "../scripts/lib/ajv.mjs";
import { exampleFiles, loadSchemas, paths, readJson, readYaml, toPosix } from "../scripts/lib/contract.mjs";
import { validateAll } from "../scripts/validate.mjs";

type LoadedSchema = { file: string; rel: string; schema: { $id: string; title: string; enum?: string[] } };

const schemas = loadSchemas() as LoadedSchema[];
const ajv = createContractAjv(schemas);
const files = exampleFiles() as string[];
const schemaByRel = (rel: string) => schemas.find((s) => s.rel === rel)?.schema;

describe("contract schemas", () => {
  it("compile in strict mode with unique ids and titles that match their file location", () => {
    const { failures, schemaCount } = validateAll();
    expect(failures).toEqual([]);
    expect(schemaCount).toBeGreaterThan(200);
    expect(new Set(schemas.map((s) => s.schema.title)).size).toBe(schemas.length);
  });

  it("covers every orb mode of PLAN §17 exactly", () => {
    expect(schemaByRel("orb/orb-mode.schema.json")?.enum).toEqual([
      "booting",
      "idle",
      "listening",
      "transcribing",
      "thinking",
      "syncing",
      "working",
      "speaking",
      "waiting_approval",
      "success",
      "warning",
      "error",
      "offline",
      "paused",
    ]);
  });

  it("defines the error codes required by the conventions", () => {
    const codes = schemaByRel("common/error-code.schema.json")?.enum ?? [];
    for (const code of [
      "ADAPTER_UNAVAILABLE",
      "ADAPTER_TIMEOUT",
      "CAPABILITY_MISSING",
      "VALIDATION_FAILED",
      "NOT_FOUND",
      "CONFLICT",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "CSRF_INVALID",
      "APPROVAL_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
      "RATE_LIMITED",
      "INTERNAL",
    ]) {
      expect(codes).toContain(code);
    }
  });
});

describe("examples", () => {
  it("exist for every domain", () => {
    expect(files.length).toBeGreaterThan(150);
    const domains = new Set(files.map((f) => toPosix(path.relative(paths.examples, f)).split("/")[0]));
    for (const domain of [
      "common",
      "tasks",
      "activity",
      "memory",
      "agents",
      "approvals",
      "communication",
      "calendar",
      "automations",
      "research",
      "files",
      "voice",
      "notifications",
      "system",
      "audit",
      "orb",
      "meta",
      "settings",
      "commands",
      "events",
    ]) {
      expect(domains.has(domain), domain).toBe(true);
    }
  });

  it.each(files.map((f) => [toPosix(path.relative(paths.examples, f)), f] as const))(
    "%s validates against its schema",
    (_name, file) => {
      const { $schema: schemaId, ...payload } = readJson(file) as { $schema: string };
      const validate = ajv.getSchema(schemaId);
      expect(validate, `unknown schema ${schemaId}`).toBeTypeOf("function");
      const valid = validate?.(payload) ?? false;
      expect(valid ? [] : formatAjvErrors(validate?.errors)).toEqual([]);
    },
  );

  it("rejects corrupted payloads (the validator is not a no-op)", () => {
    const { $schema: schemaId, ...payload } = readJson(path.join(paths.examples, "tasks", "task.json")) as {
      $schema: string;
    };
    const validate = ajv.getSchema(schemaId);
    expect(validate?.({ ...payload, status: "unbekannt" })).toBe(false);
    expect(validate?.({ ...payload, title: undefined })).toBe(false);
    expect(validate?.({ ...payload, providerSpecificField: 1 })).toBe(false);
  });

  it("use the documented id prefixes", () => {
    const task = readJson(path.join(paths.examples, "tasks", "task.json")) as { id: string };
    expect(task.id).toMatch(/^task_[0-9A-Za-z]{26}$/);
  });
});

describe("event contract", () => {
  const asyncapi = readYaml(paths.asyncapi) as { components: { messages: Record<string, { name: string }> } };
  const types = Object.values(asyncapi.components.messages)
    .map((m) => m.name)
    .filter((name) => name.startsWith("jarvis."));

  it("covers every event group of PLAN §12.4", () => {
    const groups = new Set(types.map((t) => t.split(".")[1]));
    for (const group of [
      "status",
      "orb",
      "task",
      "activity",
      "memory",
      "agent",
      "approval",
      "communication",
      "calendar",
      "automation",
      "research",
      "file",
      "voice",
      "notification",
      "system",
      "audit",
      "adapter",
    ]) {
      expect(groups.has(group), group).toBe(true);
    }
  });

  it("declares ping and pong control frames as separate messages", () => {
    expect(Object.keys(asyncapi.components.messages)).toEqual(expect.arrayContaining(["ping", "pong"]));
  });
});
