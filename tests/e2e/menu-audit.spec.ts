// DASH-18.05 - every visible menu control is labelled, selectable and has an effect or a stated reason when disabled.
import { test, expect } from "./support/fixtures";
import { auditPage, routeSlug, writeReport } from "./support/menuAudit";
import { launchOptions, NO_GL_ARGS } from "./support/browser";

// Menus are independent of the WebGL orb; SwiftShader renders it on the CPU and stalled the renderer for ~30 s after a
// reload, which surfaced as click timeouts. The 2D fallback keeps the shell identical and the audit fast.
test.use({ launchOptions: launchOptions(NO_GL_ARGS) });

const PAGES = [
  ["Übersicht", "/"],
  ["Aufgaben", "/tasks"],
  ["Live-Aktivität", "/activity"],
  ["Gedächtnis", "/memory"],
  ["Agenten", "/agents"],
  ["Skills", "/skills"],
  ["Freigaben", "/approvals"],
  ["Mail & Kommunikation", "/communication"],
  ["Kalender", "/calendar"],
  ["Automationen", "/automations"],
  ["Recherche", "/research"],
  ["Dateien & Dokumente", "/files"],
  ["Sprache", "/voice"],
  ["Meldungen & Alarme", "/alerts"],
  ["System", "/system"],
  ["Audit & Verlauf", "/audit"],
  ["Einstellungen", "/settings"],
  ["Content-Studio", "/content-studio"],
] as const;

// Reviewed 2026-10-28: the e2e skill catalog holds exactly two Friday-package skills in "Produktivitaet", neither
// enabled, so these filter values match every row and leave the list unchanged by design ("Hermes"/"Aktiviert" do filter).
const REVIEWED_SAME_RESULT = new Set([
  "Skills|Quelle|Friday",
  "Skills|Herkunft|Friday-Paket",
  "Skills|Kategorie|Produktivitaet",
  "Skills|Status|Unbekannt",
]);

for (const [label, route] of PAGES) {
  test(`menus on ${label}`, async ({ page }) => {
    test.setTimeout(420_000);
    const result = await auditPage(page, label, route);
    writeReport(routeSlug(route), result);
    if (process.env.MENU_AUDIT_REPORT !== "1") {
      const findings = result.findings.filter(
        (finding) =>
          finding.rule !== "option-no-effect" ||
          !REVIEWED_SAME_RESULT.has(`${finding.page}|${finding.control}|${finding.detail}`),
      );
      expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    }
  });
}

