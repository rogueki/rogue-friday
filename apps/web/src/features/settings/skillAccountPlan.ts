import type { SkillCatalogEntry } from "@friday/sdk";

/** Ein Konto, das ein Skill braucht, samt Zustand aus dem Katalog. */
export interface SkillAccount {
  id: string;
  required: boolean;
  state: "vorhanden" | "fehlt" | "unbekannt";
  setupDe: string;
  settingsTarget: string;
}

export type SkillState = "bereit" | "unvollstaendig" | "unbekannt" | "deaktiviert" | "unbeobachtet";

export interface SkillSummary {
  id: string;
  name: string;
  source: "friday" | "hermes";
  category: string;
  state: SkillState;
  stateLabel: string;
  accounts: SkillAccount[];
}

const stateOrder: Record<SkillState, number> = {
  unvollstaendig: 0,
  unbekannt: 1,
  deaktiviert: 2,
  unbeobachtet: 3,
  bereit: 4,
};

function accountState(configured: boolean | null): SkillAccount["state"] {
  return configured === null ? "unbekannt" : configured ? "vorhanden" : "fehlt";
}

export function skillAccounts(entry: SkillCatalogEntry): SkillAccount[] {
  return entry.integrationDetails
    .filter((detail) => detail.account !== "none")
    .map((detail) => ({
      id: detail.id,
      required: detail.required,
      state: accountState(detail.configured),
      setupDe: detail.setupDe,
      settingsTarget: detail.settingsTarget,
    }));
}

/**
 * Zustand eines Skills aus dem, was der Katalog wirklich weiss: fehlende Pflichtkonten sind ein Befund, unbekannte
 * Zustaende bleiben unbekannt, und ein vom Nutzer deaktivierter Skill ist nicht "bereit", auch wenn alle Konten da sind.
 */
export function skillState(entry: SkillCatalogEntry): SkillState {
  if (entry.enabled === false) return "deaktiviert";
  if (entry.discovered === false) return "unbeobachtet";
  const accounts = skillAccounts(entry);
  if (accounts.some((account) => account.required && account.state === "fehlt")) return "unvollstaendig";
  if (accounts.some((account) => account.required && account.state === "unbekannt")) return "unbekannt";
  return "bereit";
}

export function skillStateLabel(state: SkillState): string {
  switch (state) {
    case "bereit": return "Konten bereit; Verbindung nicht geprüft";
    case "unvollstaendig": return "Pflichtkonto fehlt";
    case "unbekannt": return "Kontostatus unbekannt";
    case "deaktiviert": return "Skill deaktiviert";
    case "unbeobachtet": return "Skill nicht beobachtet";
  }
}

export function skillSummaries(entries: readonly SkillCatalogEntry[]): SkillSummary[] {
  return entries
    .map((entry) => {
      const state = skillState(entry);
      return {
        id: entry.id,
        name: entry.name,
        source: entry.source,
        category: entry.category,
        state,
        stateLabel: skillStateLabel(state),
        accounts: skillAccounts(entry),
      } satisfies SkillSummary;
    })
    .sort((left, right) => stateOrder[left.state] - stateOrder[right.state]
      || left.name.localeCompare(right.name, "de"));
}

export type SkillFilter = "alle" | SkillState;

export interface SkillQuery {
  text?: string;
  state?: SkillFilter;
}

/** Suche ueber Skillname, Quelle ("friday"/"hermes") und Kategorie; der Zustandsfilter ist eine exakte Auswahl. */
export function filterSkills(summaries: readonly SkillSummary[], query: SkillQuery): SkillSummary[] {
  const text = (query.text ?? "").trim().toLowerCase();
  const state = query.state ?? "alle";
  return summaries.filter((summary) => {
    if (state !== "alle" && summary.state !== state) return false;
    if (!text) return true;
    return [summary.name, summary.id, summary.category, summary.source, summary.stateLabel]
      .some((value) => value.toLowerCase().includes(text));
  });
}

/**
 * Ein Konto kann von mehreren Skills gebraucht werden. Der Hinweis nennt die anderen Skills, damit derselbe Schluessel
 * nicht mehrfach eingegeben werden muss.
 */
export function sharedWith(summaries: readonly SkillSummary[], selectedId: string, accountId: string): string[] {
  return summaries
    .filter((summary) => summary.id !== selectedId)
    .filter((summary) => summary.accounts.some((account) => account.id === accountId && account.required))
    .map((summary) => summary.name)
    .sort((left, right) => left.localeCompare(right, "de"));
}

/** Konto-IDs, die ein anderer ausgewaehlter Skill ebenfalls braucht - fuer die Kennzeichnung "geteilt". */
export function sharedAccountIds(summaries: readonly SkillSummary[], selectedId: string): string[] {
  const own = summaries.find((summary) => summary.id === selectedId);
  if (!own) return [];
  return own.accounts
    .map((account) => account.id)
    .filter((id) => sharedWith(summaries, selectedId, id).length > 0);
}