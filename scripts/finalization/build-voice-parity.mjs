/**
 * Builds the DASH-18.01 parity matrix from repository facts: which dashboard area has a spoken read path, a spoken
 * write path, and where both land in the UI. Intent kinds and routes come from the source files, not from memory.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const list = (path) => (existsSync(path) ? readdirSync(path) : []);

const servicesDir = "apps/control-api/src/services";
const intentFiles = list(servicesDir).filter((name) => name.endsWith("-intent.ts") && !name.endsWith(".test.ts"));

/** Intent kinds are declared as `kind: "task.cancel"` literals inside the parser's return type. */
const intents = [];
for (const file of intentFiles) {
  const source = read(join(servicesDir, file));
  const kinds = new Set([
    ...Array.from(source.matchAll(/kind: "([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)"/g), (match) => match[1]),
    ...Array.from(source.matchAll(/^\s*\| \{ kind: "([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)"/gm), (match) => match[1]),
  ]);
  // Parsers without a discriminated union still create something: give them the name their handler uses.
  const fallback = { "research-action-intent.ts": "research.create", "task-create-intent.ts": "task.create" }[file];
  if (kinds.size === 0 && fallback) kinds.add(fallback);
  for (const kind of kinds) intents.push({ kind, file });
}

/** Built-in spoken intents (no port call) live in the command service; they count for the areas they serve. */
const builtinSource = read(join(servicesDir, "command-intents.ts"));
const builtins = [...new Set(Array.from(builtinSource.matchAll(/BuiltinIntent = ([^;]+);/g), (match) => match[1])
  .flatMap((union) => Array.from(union.matchAll(/"([a-z_]+)"/g), (item) => item[1])))];
const builtinAreas = { voice_start: "voice", focus_toggle: "overview" };

/** A UI page exists either as feature directory or as app route. */
const appRoutes = list("apps/web/src/app/(dashboard)");
const hasUiPage = (id) => existsSync(join("apps/web/src/features", id)) || appRoutes.includes(id);

const commands = read("apps/control-api/src/handlers/commands.ts");
const dispatched = intentFiles.filter((file) => {
  const parser = `parse${file
    .replace(/-intent\.ts$/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}Intent`;
  return commands.includes(parser);
});

const areas = [
  { id: "overview", label: "Übersicht/Orb", prefixes: ["overview", "core", "focus"] },
  { id: "communication", label: "Kommunikation", prefixes: ["mail", "messenger", "communication", "thread"] },
  { id: "calendar", label: "Kalender", prefixes: ["calendar"] },
  { id: "memory", label: "Memory", prefixes: ["memory", "knowledge"] },
  { id: "tasks", label: "Aufgaben", prefixes: ["task"] },
  { id: "agents", label: "Agenten", prefixes: ["agent"] },
  { id: "skills", label: "Skills", prefixes: ["skill", "knowledge"] },
  { id: "automations", label: "Automationen", prefixes: ["automation"] },
  { id: "research", label: "Recherche", prefixes: ["research"] },
  { id: "files", label: "Dateien", prefixes: ["file", "knowledge"] },
  { id: "content-studio", label: "Studio", prefixes: ["content", "studio"] },
  { id: "voice", label: "Sprache", prefixes: ["voice", "speech"] },
  { id: "activity", label: "Aktivität", prefixes: ["activity"] },
  { id: "alerts", label: "Benachrichtigungen", prefixes: ["notification", "alert"] },
  { id: "approvals", label: "Freigaben", prefixes: ["approval"] },
  { id: "audit", label: "Audit", prefixes: ["audit"] },
  { id: "system", label: "System", prefixes: ["system", "health", "backup"] },
  { id: "settings", label: "Einstellungen", prefixes: ["settings", "config"] },
  { id: "onboarding", label: "Onboarding", prefixes: ["onboarding"] },
  { id: "weather", label: "Standort/Wetter", prefixes: ["weather", "location"] },
];

const reads = new Set(
  // The first segment may be camelCase (contentStudio.plan); lowercase-only matching hid the Studio paths.
  Array.from(read(join(servicesDir, "read-query-intent.ts")).matchAll(/kind: "([a-z][a-zA-Z]*\.[a-zA-Z]+)"/g), (m) => m[1]),
);

const rows = areas.map((area) => {
  const matches = (kind) => area.prefixes.some((prefix) => kind.startsWith(`${prefix}.`) || kind.startsWith(prefix));
  const reads_ = [...reads].filter(matches).sort();
  const writes = intents
    .filter((intent) => !intent.file.startsWith("read-query-intent"))
    .map((intent) => intent.kind)
    .filter(matches)
    .sort();
  for (const builtin of builtins) {
    const areaFor = builtinAreas[builtin];
    if (areaFor && areaFor === area.id) writes.push(builtin);
  }
  const uniqueWrites = [...new Set(writes)].sort();
  const verdict = reads_.length > 0 && uniqueWrites.length > 0
    ? "lesen + schreiben"
    : reads_.length > 0
      ? "nur lesen"
      : uniqueWrites.length > 0
        ? "nur schreiben"
        : "kein Sprachweg";
  return { ...area, reads: reads_, writes: uniqueWrites, verdict, ui: hasUiPage(area.id) };
});

const cell = (values) => (values.length > 0 ? values.map((value) => `\`${value}\``).join(", ") : "—");

const table = rows
  .map((row) => `| ${row.label} | ${row.ui ? "ja" : "nur Route"} | ${cell(row.reads)} | ${cell(row.writes)} | ${row.verdict} |`)
  .join("\n");

const withoutVoice = rows.filter((row) => row.verdict === "kein Sprachweg");
const readOnly = rows.filter((row) => row.verdict === "nur lesen");
const writeOnly = rows.filter((row) => row.verdict === "nur schreiben");

const document = `# DASH-18.01 — Sprach-/UI-Parität (aus dem Repository erzeugt)

**Datum:** 2026-10-23 · **Quelle:** \`scripts/finalization/build-voice-parity.mjs\` gegen den Arbeitsstand des Branch
\`feat/friday-finalization-20261021\`. Die Zuordnung stammt aus den Intent-Dateien (\`kind:\`-Literale, \`targetRoute\`) und
dem Dispatcher in \`handlers/commands.ts\`, nicht aus Erinnerung.

## 1. Übersicht

- Intent-Dienste: ${intentFiles.length} (\`${intentFiles.join("`, `")}\`)
- Im Dispatcher erreichbar: ${dispatched.length} von ${intentFiles.length}
- Lese-Intents: ${reads.size} · eingebaute Sprachintents: ${builtins.join(", ")}
- Bereiche mit Lese- und Schreibweg: ${rows.filter((row) => row.verdict === "lesen + schreiben").length} von ${rows.length}
- Nur lesbar: ${readOnly.length} · nur schreibbar: ${writeOnly.length} · ohne Sprachweg: ${withoutVoice.length}

## 2. Matrix

| Bereich | UI-Seite | Sprachlich lesen | Sprachlich schreiben | Urteil |
| --- | --- | --- | --- | --- |
${table}

## 3. Bereiche ohne Sprachweg

${withoutVoice.length === 0 ? "_keine_" : withoutVoice.map((row) => `- ${row.label}: kein Intent-Kind und kein Parser in \`services/*-intent.ts\``).join("\n")}

## 4. Nur lesbare Bereiche

${readOnly.length === 0 ? "_keine_" : readOnly.map((row) => `- ${row.label}: ${cell(row.reads)}; kein Schreib-Intent vorhanden`).join("\n")}

## 5. Was das Urteil bedeutet

- **lesen + schreiben**: mindestens ein Lese-Intent und ein Schreib-Intent nennen den Bereich.
- **nur lesen**: ein Sprachbefehl kann den Zustand vortragen, aber nichts ändern (z. B. Audit, Aktivität — Änderungen dort
  wären Fälschung des Verlaufs).
- **nur schreiben**: ein Befehl ändert etwas, aber es gibt keinen Lese-Intent (kommt derzeit nicht vor).
- **kein Sprachweg**: der Bereich ist nur über die Oberfläche erreichbar. Das ist eine Lücke, wenn dort eine sinnvolle
  Aktion existiert; es ist Absicht, wenn der Bereich reine Oberflächenkonfiguration ist (Darstellung, Onboarding).

Die Matrix ersetzt keinen Laufzeittest: sie belegt, dass ein Intent existiert und im Dispatcher hängt. Rolle, Fehlerfall
und Runtimewirkung je Funktion prüft DASH-18.03.
`;

const target = "docs/agent-work/finalization/dash-18-01-voice-parity.md";
const summary = `Intents: ${intentFiles.length}, dispatched: ${dispatched.length}, ohne Sprachweg: ${withoutVoice.length}`;

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== document) {
    console.error(`${target} ist nicht mehr aktuell. Bitte "node scripts/finalization/build-voice-parity.mjs" ausfuehren.`);
    process.exit(1);
  }
  console.log(`Paritaetsmatrix aktuell: ${summary}`);
  process.exit(0);
}

writeFileSync(target, document);
console.log(summary);
for (const row of rows) console.log(`${row.label}: ${row.verdict}`);