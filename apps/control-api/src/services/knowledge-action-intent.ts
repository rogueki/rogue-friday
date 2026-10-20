/**
 * German natural-language intents for the file/knowledge action family (memory create/update/confirm/delete, file
 * rename/delete). Only explicit imperatives that name the family ("Gedächtniseintrag"/"Eintrag" or "Datei") are treated
 * as actions; the reference itself is resolved against the live registry at the handler — never guessed here.
 */
export type KnowledgeActionIntent =
  | { kind: "memory.create"; content: string }
  | { kind: "memory.update"; ref: string; content: string }
  | { kind: "memory.confirm"; ref: string }
  | { kind: "memory.delete"; ref: string }
  | { kind: "file.rename"; ref: string; name: string }
  | { kind: "file.delete"; ref: string };

const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ").trim();

/** Strips quotes: "den Eintrag „Stromversorger“" -> "Stromversorger". Empty or pronoun refs carry no target. */
function refOf(value: string | undefined): string | null {
  const ref = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!ref || ref.length > 128) return null;
  const base = squash(ref);
  if (!base || /^(?:der|die|das|den|dem|er|sie|es)$/.test(base)) return null;
  return ref;
}

/** The free text of a create/update: everything after the colon or the "auf/zu" marker, non-empty and bounded. */
function contentOf(value: string | undefined): string | null {
  const content = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!content || content.length > 2000) return null;
  return content;
}

const MEMORY_ENTRY = "(?:gedächtnis(?:[- ])?)?eintrag";

const MEMORY_CREATE = [
  // "Merke dir: <text>" / "Merke dir, <text>" / "Merkt euch: <text>"
  /^(?:bitte\s+)?merk(?:e|t)?\b(?:\s+(?:dir|euch))?\s*,?\s*:?\s*(.+)$/iu,
  // "Speichere im Gedächtnis: <text>"
  /^(?:bitte\s+)?speicher(?:e|t)?\s+im\s+gedächtnis\s*:?\s*(.+)$/iu,
  // "Erstelle einen Gedächtniseintrag: <text>" / "Lege einen Eintrag an: <text>"
  new RegExp(`^(?:bitte\\s+)?(?:erstell(?:e|t)?|lege|leg)\\s+(?:einen\\s+)?${MEMORY_ENTRY}\\s*(?:an)?\\s*:?\\s*(.+)$`, "iu"),
];

const MEMORY_UPDATE = [
  // "Aktualisiere den (Gedächtnis-)Eintrag <ref> auf <text>" / "Ändere den Eintrag <ref> zu <text>"
  new RegExp(`^(?:bitte\\s+)?(?:aktualisier(?:e|t)?|änder(?:e|t)?)\\s+(?:den|die|das)\\s+${MEMORY_ENTRY}\\s+(.+?)\\s+(?:auf|zu)\\s+(.+)$`, "iu"),
  // "Aktualisiere den Eintrag <ref>: <text>"
  new RegExp(`^(?:bitte\\s+)?aktualisier(?:e|t)?\\s+(?:den|die|das)\\s+${MEMORY_ENTRY}\\s+(.+?)\\s*:\\s*(.+)$`, "iu"),
];

const MEMORY_CONFIRM = [
  new RegExp(`^(?:bitte\\s+)?(?:bestätig(?:e|t)?|bestaetig(?:e|t)?)\\s+(?:den|die|das)\\s+${MEMORY_ENTRY}\\s+(.+)$`, "iu"),
];

const MEMORY_DELETE = [
  new RegExp(`^(?:bitte\\s+)?(?:lösch(?:e|t)?|loesch(?:e|t)?|vergiss|vergiß)\\s+(?:den|die|das)\\s+${MEMORY_ENTRY}\\s+(.+)$`, "iu"),
];

const FILE_RENAME = [
  // "Benenne die Datei <alt> um in <neu>"
  /^(?:bitte\s+)?benenn(?:e|t)?\s+(?:die|das|den)\s+datei\s+(.+?)\s+um\s+in\s+(.+)$/iu,
  // "Benenne die Datei <alt> in <neu> um"
  /^(?:bitte\s+)?benenn(?:e|t)?\s+(?:die|das|den)\s+datei\s+(.+?)\s+in\s+(.+?)\s+um$/iu,
];

const FILE_DELETE = [
  /^(?:bitte\s+)?(?:lösch(?:e|t)?|loesch(?:e|t)?)\s+(?:die|das|den)\s+datei\s+(.+)$/iu,
];

/** The create content after the imperative; empty or connective-only phrases are not a create. */
function createContent(value: string | undefined): string | null {
  const content = contentOf(value);
  if (!content) return null;
  const base = squash(content);
  if (/^(?:das|dass|dies|dir)$/.test(base)) return null;
  return content;
}

/**
 * Parses an explicit file/knowledge imperative. Returns null for anything that does not name a memory entry or a
 * file; those phrases fall through to the other intent parsers or the base handler.
 */
export function parseKnowledgeActionIntent(text: string): KnowledgeActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of MEMORY_CREATE) {
    const content = createContent(pattern.exec(trimmed)?.[1]);
    if (content) return { kind: "memory.create", content };
  }
  for (const pattern of MEMORY_UPDATE) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const ref = refOf(match[1]);
    const content = contentOf(match[2]);
    if (ref && content) return { kind: "memory.update", ref, content };
  }
  for (const pattern of MEMORY_CONFIRM) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "memory.confirm", ref };
  }
  for (const pattern of MEMORY_DELETE) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "memory.delete", ref };
  }
  for (const pattern of FILE_RENAME) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const ref = refOf(match[1]);
    const name = refOf(match[2]);
    if (ref && name) return { kind: "file.rename", ref, name };
  }
  for (const pattern of FILE_DELETE) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "file.delete", ref };
  }
  return null;
}
