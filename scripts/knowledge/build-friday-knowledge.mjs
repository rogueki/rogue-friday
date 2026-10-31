// Builds the F.R.I.D.A.Y. knowledge base that the voice service answers "how do I ..." questions from.
// Sources: settings schemas, the dashboard settings areas, German labels, server defaults and the curated
// docs/friday-knowledge/*.md. Run with tsx (it imports TypeScript sources); `--check` fails on stale output.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DOCS = join(ROOT, "docs", "friday-knowledge");
const SETTINGS_OUT = join(DOCS, "settings.generated.json");
// Only installer/ is copied to the user's machine, so the voice service gets its own bundle.
const BUNDLE_OUT = join(ROOT, "installer", "voice", "knowledge", "friday-knowledge.json");
const AREAS = new Set(["ablauf", "fehlerbild", "sprache", "datenschutz"]);

const { de } = await import(pathToFileURL(join(ROOT, "apps", "web", "src", "i18n", "de.ts")).href);
const { defaultSettingsAreas } = await import(pathToFileURL(join(ROOT, "apps", "control-api", "src", "services", "settings.ts")).href);

function settingsAreaIds() {
  const source = readFileSync(join(ROOT, "apps", "web", "src", "features", "settings", "settingsLogic.ts"), "utf8");
  const block = /export const SETTINGS_AREAS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error("SETTINGS_AREAS not found in settingsLogic.ts");
  return [...block[1].matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]);
}

function syntheticConfig(variant) {
  return {
    auth: { ownerUsername: `owner-${variant}`, reauthWindowMinutes: 5 + variant, sessionTtlMinutes: 600 + variant },
    dev: { scenarioConsole: variant === 1 },
    logging: { level: variant === 1 ? "info" : "debug" },
    paths: { backupDir: `/backup-${variant}` },
    server: { allowRemote: variant === 1, port: 4000 + variant },
    ui: { contentStudio: variant === 1, layout: `layout-${variant}`, locale: "de-DE", theme: `theme-${variant}`, timezone: `Zone/${variant}` },
  };
}

// Values that come from the installation (owner name, port, paths) differ between two synthetic configs.
function defaultsFor(area) {
  const first = defaultSettingsAreas(syntheticConfig(1))[area];
  const second = defaultSettingsAreas(syntheticConfig(2))[area];
  if (first === undefined) return null;
  return Object.fromEntries(Object.keys(first).sort().map((key) => [
    key, JSON.stringify(first[key]) === JSON.stringify(second[key]) ? first[key] : "installationsabhängig",
  ]));
}

function schemaFields(area) {
  const file = join(ROOT, "packages", "contracts", "schemas", "settings",
    `${area.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-settings.schema.json`);
  if (!existsSync(file)) return null;
  const schema = JSON.parse(readFileSync(file, "utf8"));
  return Object.keys(schema.properties ?? {}).sort().map((name) => {
    const property = schema.properties[name];
    const field = { name, type: property.type ?? (property.$ref ? "object" : "unknown") };
    if (property.enum) field.enum = property.enum;
    if (property.minimum !== undefined) field.minimum = property.minimum;
    if (property.maximum !== undefined) field.maximum = property.maximum;
    if (property.description) field.description = property.description;
    return field;
  });
}

function buildSettings() {
  return {
    note: "Generiert von scripts/knowledge/build-friday-knowledge.mjs – nicht von Hand ändern.",
    areas: settingsAreaIds().map((id) => {
      const label = de[`settings.area.${id}`];
      if (!label) throw new Error(`missing label settings.area.${id}`);
      const fields = schemaFields(id);
      const defaults = defaultsFor(id);
      return {
        id, label, description: de[`settings.area.${id}.desc`] ?? null, route: `/settings?area=${id}`,
        ...(fields ? { fields } : {}), ...(defaults ? { defaults } : {}),
      };
    }),
  };
}

function parseMarkdown(file) {
  const text = readFileSync(join(DOCS, file), "utf8").replace(/\r\n/g, "\n");
  const sections = [];
  for (const chunk of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = chunk.split("\n");
    const lines = rest.map((line) => line.trimEnd());
    const keywordsLine = lines.find((line) => line.startsWith("Stichworte:"));
    const areaLine = lines.find((line) => line.startsWith("Bereich:"));
    const body = lines.filter((line) => line !== keywordsLine && line !== areaLine).join("\n").trim();
    const title = heading.trim();
    const where = `${file} › ${title}`;
    if (!keywordsLine || !areaLine) throw new Error(`${where}: Zeile „Stichworte:“ oder „Bereich:“ fehlt`);
    if (!body) throw new Error(`${where}: kein Text`);
    const area = areaLine.slice("Bereich:".length).trim();
    if (!AREAS.has(area) && !/^(seite|einstellungen):\S+$/.test(area)) throw new Error(`${where}: unbekannter Bereich „${area}“`);
    const keywords = keywordsLine.slice("Stichworte:".length).split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
    sections.push({ id: `${file.replace(/\.md$/, "")}#${slug(title)}`, file: `docs/friday-knowledge/${file}`, title, area, keywords, text: body });
  }
  if (sections.length === 0) throw new Error(`${file}: keine Abschnitte`);
  return sections;
}

function slug(text) {
  return text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function settingsSections(settings) {
  return settings.areas.map((area) => ({
    id: `settings-generated#${area.id}`,
    file: "docs/friday-knowledge/settings.generated.json",
    title: `Einstellungen: ${area.label}`,
    area: `einstellungen:${area.id}`,
    keywords: [...new Set([area.id.toLowerCase(), ...area.label.toLowerCase().split(/[\s&/-]+/).filter((word) => word.length > 2), "einstellung"])],
    text: `${area.description ? `${area.description}. ` : ""}Zu finden unter Einstellungen → ${area.label}.`,
  }));
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const settings = buildSettings();
const markdownFiles = existsSync(DOCS) ? readdirSync(DOCS).filter((file) => file.endsWith(".md")).sort() : [];
const sections = [...markdownFiles.flatMap(parseMarkdown), ...settingsSections(settings)];
const ids = new Set();
for (const section of sections) {
  if (ids.has(section.id)) throw new Error(`doppelter Abschnitt ${section.id}`);
  ids.add(section.id);
}
const outputs = [[SETTINGS_OUT, json(settings)], [BUNDLE_OUT, json({ version: 1, sections })]];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([file, content]) => !existsSync(file) || readFileSync(file, "utf8").replace(/\r\n/g, "\n") !== content);
  if (stale.length > 0) {
    console.error(`Wissensbasis veraltet: ${stale.map(([file]) => file.slice(ROOT.length + 1)).join(", ")}. Bitte \`pnpm knowledge:build\` ausführen.`);
    process.exit(1);
  }
  console.log(`knowledge:check passed (${sections.length} Abschnitte)`);
} else {
  for (const [file, content] of outputs) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  console.log(`knowledge:build wrote ${sections.length} Abschnitte`);
}
