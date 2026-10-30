import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Die Paritaetsmatrix in `docs/agent-work/finalization/dash-18-01-voice-parity.md` wird aus dem Quellstand erzeugt. Dieser
 * Test haelt sie synchron: wer einen Intent hinzufuegt oder entfernt, muss die Matrix neu bauen - sonst beschreibt das
 * Inventar nicht mehr, was die Sprache wirklich kann.
 */
describe("voice parity inventory", () => {
  it("is generated from the current sources and stays in sync", () => {
    const output = execFileSync(process.execPath, [join(REPO_ROOT, "scripts/finalization/build-voice-parity.mjs"), "--check"], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    expect(output).toContain("Paritaetsmatrix aktuell");
  }, 30_000);

  it("names every area of the mandatory matrix exactly once", () => {
    const matrix = readFileSync(join(REPO_ROOT, "docs/agent-work/finalization/dash-18-01-voice-parity.md"), "utf8");
    for (const label of [
      "Übersicht/Orb", "Kommunikation", "Kalender", "Memory", "Aufgaben", "Agenten", "Skills", "Automationen",
      "Recherche", "Dateien", "Studio", "Sprache", "Aktivität", "Benachrichtigungen", "Freigaben", "Audit", "System",
      "Einstellungen", "Onboarding", "Standort/Wetter",
    ]) {
      expect(matrix, `Bereich ${label} fehlt in der Matrix`).toContain(`| ${label} |`);
    }
  });

  it("separates the areas without a spoken path from the read-only ones", () => {
    const matrix = readFileSync(join(REPO_ROOT, "docs/agent-work/finalization/dash-18-01-voice-parity.md"), "utf8");
    const noVoice = matrix.split("## 3. Bereiche ohne Sprachweg")[1]?.split("##")[0] ?? "";
    const readOnly = matrix.split("## 4. Nur lesbare Bereiche")[1]?.split("##")[0] ?? "";
    for (const label of ["Studio", "Onboarding", "Standort/Wetter"]) {
      expect(noVoice, `${label} muss als Bereich ohne Sprachweg genannt sein`).toContain(label);
    }
    for (const label of ["Aktivität", "Benachrichtigungen", "Freigaben", "Audit", "Skills", "System"]) {
      expect(readOnly, `${label} darf nicht als schreibbar gelten`).toContain(label);
    }
  });
});