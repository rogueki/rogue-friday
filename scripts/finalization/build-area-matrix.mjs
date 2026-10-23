/**
 * Builds the DASH-18.02 mandatory matrix from repository facts: navigation pages, API operations, database tables,
 * scopes and test files. Numbers and names come from the files, not from memory.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const list = (path) => (existsSync(path) ? readdirSync(path) : []);

const navSource = read("apps/web/src/features/shell/navModel.tsx");
const navPages = [...navSource.matchAll(/\{ id: "([^"]+)", route: "([^"]+)"/g)].map(([, id, route]) => ({ id, route }));

const routeTable = read("apps/control-api/src/http/route-table.generated.ts");
const operations = [...routeTable.matchAll(/"operationId": "([^"]+)"/g)].map(([, id]) => id);
const paths = [...routeTable.matchAll(/"path": "(\/api\/v1[^"]*)"/g)].map(([, path]) => path);
const uniquePaths = [...new Set(paths)];

const db = read("apps/control-api/src/db/database.ts");
const tables = [...db.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/g)].map(([, name]) => name);

const portSpec = read("packages/adapter-core/src/port-spec.ts");
const ports = [...portSpec.matchAll(/^\s{2}([a-z]+): \{/gm)].map(([, name]) => name);
const scopes = [...new Set([...portSpec.matchAll(/"([a-z]+\.[a-z]+)"/g)].map(([, scope]) => scope))];

const featureDirs = list("apps/web/src/features");
const webTests = [];
const walk = (dir) => {
  for (const entry of list(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith(".test.tsx") || entry.endsWith(".test.ts")) webTests.push(full.replaceAll("\\", "/"));
  }
};
walk("apps/web/src/features");
const nodeTests = list("apps/control-api/test").filter((entry) => entry.endsWith(".test.ts"));
const adapterTests = list("adapters/hermes/test");

const appRoutes = list("apps/web/src/app/(dashboard)").filter((entry) => existsSync(join("apps/web/src/app/(dashboard)", entry, "page.tsx")));

const areas = [
  { id: "overview", label: "Übersicht/Orb", keywords: ["overview", "orb", "core-view", "dashboard"] },
  { id: "communication", label: "Kommunikation", keywords: ["communication", "mail", "messenger", "himalaya", "imap"] },
  { id: "calendar", label: "Kalender", keywords: ["calendar", "caldav"] },
  { id: "memory", label: "Memory", keywords: ["memory"] },
  { id: "tasks", label: "Aufgaben", keywords: ["task", "kanban"] },
  { id: "agents", label: "Agenten", keywords: ["agent"] },
  { id: "skills", label: "Skills", keywords: ["skill"] },
  { id: "automations", label: "Automationen", keywords: ["automation", "cron"] },
  { id: "research", label: "Recherche", keywords: ["research"] },
  { id: "files", label: "Dateien", keywords: ["file"] },
  { id: "content-studio", label: "Studio", keywords: ["content-studio", "studio"] },
  { id: "voice", label: "Sprache", keywords: ["voice", "speech", "tts", "stt"] },
  { id: "activity", label: "Aktivität", keywords: ["activity"] },
  { id: "alerts", label: "Benachrichtigungen", keywords: ["alert", "notification"] },
  { id: "approvals", label: "Freigaben", keywords: ["approval"] },
  { id: "audit", label: "Audit", keywords: ["audit"] },
  { id: "system", label: "System", keywords: ["system", "health", "backup"] },
  { id: "settings", label: "Einstellungen", keywords: ["settings", "config"] },
  { id: "onboarding", label: "Onboarding", keywords: ["onboarding"] },
  { id: "weather", label: "Standort/Wetter", keywords: ["weather", "location"] },
];

const matches = (value, keywords) => keywords.some((keyword) => value.toLowerCase().includes(keyword));

const rows = areas.map((area) => {
  const routes = uniquePaths.filter((path) => matches(path, area.keywords));
  const ops = operations.filter((op) => matches(op, area.keywords));
  const areaTests = [...webTests, ...nodeTests.map((entry) => `apps/control-api/test/${entry}`),
    ...adapterTests.map((entry) => `adapters/hermes/test/${entry}`)].filter((file) => matches(file, area.keywords));
  const pageDir = featureDirs.find((dir) => dir === area.id) ?? featureDirs.find((dir) => matches(dir, area.keywords));
  const appRoute = appRoutes.find((entry) => matches(entry, area.keywords));
  const surface = pageDir ? `\`features/${pageDir}\``
    : appRoute ? `\`app/(dashboard)/${appRoute}\``
      : (webTests.find((file) => matches(file, area.keywords)) ?? "").replace(/^apps\/web\/src\//, "`").replace(/\/[^/]+$/, "`") || "—";
  return { ...area, pageDir, surface, routes: routes.length, ops: ops.length, tests: areaTests.length, testFiles: areaTests.slice(0, 3) };
});

const table = rows.map((row) =>
  `| ${row.label} | ${row.surface} | ${row.routes} | ${row.ops} | ${row.tests} | ${row.testFiles[0] ? `\`${row.testFiles[0]}\`` : "—"} |`).join("\n");

const document = `# DASH-18.02 — Pflichtmatrix (aus dem Repository erzeugt)

**Datum:** 2026-10-23 · **Quelle:** \`scripts/finalization/build-area-matrix.mjs\` gegen den Arbeitsstand des Branch
\`feat/friday-finalization-20261021\`. Alle Zahlen stammen aus den Dateien, nicht aus Erinnerung.

## 1. Navigation (echte Seiten)

${navPages.length} Seiten: ${navPages.map((page) => `\`${page.route}\``).join(", ")}

## 2. Bereiche mit Fläche, Routen, Operationen und Tests

| Bereich | Oberfläche | API-Pfade | Operationen | Testdateien | Beispiel-Test |
| --- | --- | --- | --- | --- | --- |
${table}

Summen: ${uniquePaths.length} API-Pfade, ${operations.length} Operationen, ${tables.length} Tabellen, ${ports.length} Ports,
${scopes.length} Scopes, ${webTests.length} Web-Tests, ${nodeTests.length} Node-Tests, ${adapterTests.length} Adapter-Tests.

## 3. Datenbanktabellen (Persistenz)

${tables.map((name) => `\`${name}\``).join(", ")}

## 4. Ports (Rollen/Scopes)

${ports.map((name) => `\`${name}\``).join(", ")}

## 5. Wie diese Matrix zu lesen ist

Die Spalten belegen **Fläche** (Seite/Modul), **API** (Pfade und Operationen), **Tests** (Dateien, die den Bereich
abdecken). Sie belegen noch **nicht** je Zeile Quelle/Persistenz/Runtimewirkung/Rolle/Fehler/Sprachaktion — das ist
DASH-18.03 und wird Bereich für Bereich nachgezogen. Zeilen mit 0 Tests bleiben sichtbar und werden nicht als
„vorhanden" gezählt.
`;

const notes = `
## 6. Hinweise zur Erhebung

- **Testzahlen sind Untergrenzen.** Gezählt werden Dateien, deren Pfad einen Bereichsbegriff enthält (Heuristik).
  Ein Bereich kann durch Tests abgedeckt sein, die anders heißen; umgekehrt zählt ein Treffer wie
  \`features/settings/skillAccountPlan.test.ts\` beim Bereich Skills mit.
- **Onboarding** hat keine eigene Navigationsseite, sondern die App-Route \`app/(dashboard)/onboarding\` mit
  \`features/skills/OnboardingPage.tsx\`.
- **Standort/Wetter** liegt in den Einstellungen (\`features/settings/LocationWeatherArea.tsx\`), nicht als eigene Seite.
- **Memory** hat genau einen Web-Test gefunden; die Persistenzprüfung läuft über die Node-Tests und wird in 18.03
  zeilengenau zugeordnet.
- Die Erhebung ist reproduzierbar: \`node scripts/finalization/build-area-matrix.mjs\` schreibt diese Datei neu.

## 7. Was hier bewusst nicht behauptet wird

Keine Zeile behauptet Runtime-Wirkung, Rollenprüfung, Fehlerpfad oder Sprachaktion **pro Funktion**. Genau das ist
DASH-18.03, und DASH-18.05 verlangt für jede Inventarzeile einen echten Beleg. Bereiche ohne Live-Anbindung
(Automationen: kein Adapter) bleiben in der Matrix sichtbar statt als „vorhanden" gezählt zu werden.
`;

writeFileSync("docs/agent-work/finalization/dash-18-02-matrix.md", document + notes);

console.log(`pages ${navPages.length}, paths ${uniquePaths.length}, ops ${operations.length}, tables ${tables.length}, ports ${ports.length}, scopes ${scopes.length}`);
for (const row of rows) console.log(`${row.label.padEnd(18)} page=${(row.pageDir ?? "-").padEnd(18)} routes=${String(row.routes).padStart(3)} ops=${String(row.ops).padStart(3)} tests=${String(row.tests).padStart(3)}`);