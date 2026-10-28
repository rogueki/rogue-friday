import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SkillsService } from "../src/services/skills";
import { ApiError } from "../src/util/errors";

const roots: string[] = [];

function fixture(): { service: SkillsService; root: string } {
  const base = mkdtempSync(join(tmpdir(), "friday-skill-md-"));
  roots.push(base);
  const root = join(base, "pkg");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "registry"), { recursive: true });
  mkdirSync(join(root, "skills", "core", "friday-demo"), { recursive: true });
  writeFileSync(join(root, "skills", "core", "friday-demo", "SKILL.md"), "# Demo\n");
  writeFileSync(join(root, "skills", "core", "friday-demo", "README.md"), "# Demo\n");
  mkdirSync(join(root, "skills", "core", "friday-large"), { recursive: true });
  writeFileSync(join(root, "skills", "core", "friday-large", "SKILL.md"), "x".repeat(70000));
  mkdirSync(join(base, "outside"), { recursive: true });
  writeFileSync(join(base, "outside", "SKILL.md"), "# Outside\n");
  try {
    symlinkSync(join(base, "outside"), join(root, "skills", "linked"), "junction");
  } catch { /* no link privilege on this host */ }
  writeFileSync(join(root, "registry", "skills.json"), JSON.stringify({ skills: [
    { name: "friday-demo", path: "skills/core/friday-demo/SKILL.md" },
    { name: "friday-escape", path: "../outside/SKILL.md" },
    { name: "friday-linked", path: "skills/linked/SKILL.md" },
    { name: "friday-nopath" },
    { name: "friday-wrongfile", path: "skills/core/friday-demo/README.md" },
    { name: "friday-large", path: "skills/core/friday-large/SKILL.md" },
  ] }));
  return { service: new SkillsService({ catalogPath: join(root, "registry") }), root };
}

function rejection(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

it("reads the SKILL.md that the register names for a Friday skill", () => {
  expect(fixture().service.fridayMarkdown("friday-demo"))
    .toEqual({ id: "friday-demo", content: "# Demo\n", bytes: 7 });
});

it("answers null for an id the register does not know", () => {
  expect(fixture().service.fridayMarkdown("hermes-only")).toBeNull();
});

it("answers null without a catalog path", () => {
  expect(new SkillsService({}).fridayMarkdown("friday-demo")).toBeNull();
});

it.each(["friday-escape", "friday-nopath", "friday-wrongfile"])(
  "refuses %s with NOT_FOUND", (id) => {
    const error = rejection(() => fixture().service.fridayMarkdown(id));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });

it("refuses a linked SKILL.md outside the package with NOT_FOUND", () => {
  const { service, root } = fixture();
  if (!existsSync(join(root, "skills", "linked", "SKILL.md"))) return;
  const error = rejection(() => service.fridayMarkdown("friday-linked"));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: "NOT_FOUND" });
});

it("refuses a SKILL.md above 64 KiB with VALIDATION_FAILED", () => {
  const error = rejection(() => fixture().service.fridayMarkdown("friday-large"));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: "VALIDATION_FAILED" });
});
