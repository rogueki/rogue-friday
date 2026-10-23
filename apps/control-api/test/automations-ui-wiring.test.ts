import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifestFor } from "@friday/adapter-hermes";

/**
 * Die Automations-Oberflaeche darf nur Aktionen anbieten, die Contract, Route und Adapter wirklich hergeben. Dieser
 * Test liest die UI-Quellen und vergleicht sie mit der Route-Tabelle und dem Hermes-Manifest: eine neue Schaltflaeche
 * ohne Route oder ohne Capability-Gate faellt hier auf, statt erst im Live-Betrieb.
 */
const root = join(__dirname, "..", "..", "..");
const featureFiles = (() => {
  const dir = join(root, "apps", "web", "src", "features", "automations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => join(dir, name))
    .concat([join(root, "apps", "web", "src", "lib", "api", "domains", "automations.ts")]);
})();

const uiSources = featureFiles.map((path) => readFileSync(path, "utf8"));
const uiText = uiSources.join("\n");

const routeTable = readFileSync(join(root, "apps", "control-api", "src", "http", "route-table.generated.ts"), "utf8");
const routePaths = new Set(
  Array.from(routeTable.matchAll(/"path": "([^"]+)"/g), (match) => match[1]).filter(
    (value): value is string => typeof value === "string",
  ),
);

const usedPaths = new Set(
  Array.from(uiText.matchAll(/["`](\/api\/v1\/automations[^"`]*)["`]/g), (match) => match[1])
    .filter((path): path is string => typeof path === "string" && !path.includes("${")),
);

describe("automations UI wiring", () => {
  it("calls only routes that exist in the generated route table", () => {
    expect(usedPaths.size).toBeGreaterThanOrEqual(5);
    for (const path of usedPaths) {
      const normalize = (value: string) => value.replace(/\{[^}]+\}/g, "{id}");
      const exists = Array.from(routePaths).some((route) => normalize(route) === normalize(path));
      expect(exists, `UI ruft ${path}, aber keine Route traegt diesen Pfad`).toBe(true);
    }
  });

  it("gates every automation action on the matching capability", () => {
    for (const capability of ["create", "update", "enable", "disable", "test", "pauseAll", "versions"]) {
      expect(uiText, `Capability-Gate fuer automations.${capability} fehlt`).toContain(
        `useCapability("automations", "${capability}")`,
      );
    }
  });

  it("advertises exactly the capabilities the Hermes adapter implements", () => {
    const manifest = manifestFor("automations");
    const declared = manifest.capabilities.map((capability) => capability.split(".")[1]).sort();
    expect(declared).toEqual(["create", "disable", "enable", "read", "test", "update"]);
    // Hermes hat keine Versionshistorie und keine Sammelpause; die UI blendet beides ueber die fehlende Capability aus.
    expect(declared).not.toContain("versions");
    expect(declared).not.toContain("pauseAll");
  });

  it("keeps the bulk pause and history routes in the contract so the gated UI still has a real route", () => {
    expect(routeTable).toContain('"operationId": "pauseAllAutomations"');
    expect(routeTable).toContain('"operationId": "listAutomationVersions"');
  });
});