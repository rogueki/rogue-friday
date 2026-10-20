/**
 * German natural-language intents for the automation action family (enable/disable/pause/resume/test, pause all).
 * Only explicit imperatives that name an automation ("Automation") or all of them ("alle Automationen") are treated as
 * actions; the reference itself is resolved against the live registry at the handler — never guessed here. Creating an
 * automation needs a structured trigger/condition/action definition and is deliberately not parsed here.
 */
export type AutomationActionIntent =
  | { kind: "automation.enable"; ref: string }
  | { kind: "automation.disable"; ref: string }
  | { kind: "automation.pause"; ref: string }
  | { kind: "automation.resume"; ref: string }
  | { kind: "automation.test"; ref: string }
  | { kind: "automation.pauseAll" };

const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ").trim();

/** Strips quotes: "die Automation „Rechnungscheck“" -> "Rechnungscheck". Empty or pronoun refs carry no target. */
function refOf(value: string | undefined): string | null {
  const ref = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!ref || ref.length > 128) return null;
  const base = squash(ref);
  if (!base || /^(?:der|die|das|den|dem|er|sie|es)$/.test(base)) return null;
  return ref;
}

const AUTOMATION = "automation(?:en)?";

const ENABLE = [
  new RegExp(`^(?:bitte\\s+)?aktivier(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+)$`, "iu"),
  // "Schalte die Automation X ein"
  new RegExp(`^(?:bitte\\s+)?schalt(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+ein$`, "iu"),
];

const DISABLE = [
  new RegExp(`^(?:bitte\\s+)?deaktivier(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+)$`, "iu"),
  // "Schalte die Automation X ab"
  new RegExp(`^(?:bitte\\s+)?schalt(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+ab$`, "iu"),
];

const PAUSE = [
  new RegExp(`^(?:bitte\\s+)?pausier(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+)$`, "iu"),
  // "Halte die Automation X an" / "Leg die Automation X still"
  new RegExp(`^(?:bitte\\s+)?halt(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+an$`, "iu"),
  new RegExp(`^(?:bitte\\s+)?leg(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+still$`, "iu"),
];

const RESUME = [
  // "Setz die Automation X fort" / "Lass die Automation X weiterlaufen"
  new RegExp(`^(?:bitte\\s+)?setz(?:e|t)?\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+fort$`, "iu"),
  new RegExp(`^(?:bitte\\s+)?lass\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)\\s+(?:weiterlaufen|weitermachen)$`, "iu"),
];

const TEST = [
  // "Teste die Automation X" / "Probiere die Automation X aus"
  new RegExp(`^(?:bitte\\s+)?(?:teste|testet|test|probiere|probiert|probier)\\s+(?:die\\s+)?${AUTOMATION}\\s+(.+?)(?:\\s+aus)?$`, "iu"),
];

const PAUSE_ALL = [
  /^(?:bitte\s+)?pausier(?:e|t)?\s+alle\s+automationen$/iu,
  /^(?:bitte\s+)?(?:stop(?:pe|t)?|halt(?:e|t)?\s+an|leg(?:e|t)?\s+still)\s+alle\s+automationen$/iu,
  /^(?:bitte\s+)?halt(?:e|et|t)?\s+alle\s+automationen\s+an$/iu,
  /^(?:bitte\s+)?leg(?:e|et|t)?\s+alle\s+automationen\s+still$/iu,
];

/**
 * Parses an explicit automation imperative. Returns null for anything that does not name an automation or all
 * automations; those phrases fall through to the other intent parsers or the base handler.
 */
export function parseAutomationActionIntent(text: string): AutomationActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of PAUSE_ALL) if (pattern.test(trimmed)) return { kind: "automation.pauseAll" };
  for (const pattern of ENABLE) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "automation.enable", ref };
  }
  for (const pattern of DISABLE) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "automation.disable", ref };
  }
  for (const pattern of PAUSE) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "automation.pause", ref };
  }
  for (const pattern of RESUME) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "automation.resume", ref };
  }
  for (const pattern of TEST) {
    const ref = refOf(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "automation.test", ref };
  }
  return null;
}
