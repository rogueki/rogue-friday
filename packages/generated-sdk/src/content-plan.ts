export type Platform = "LinkedIn" | "Instagram" | "Facebook" | "TikTok" | "YouTube";
type LegacyPlatform = Platform | "Beide";
export type ContentFormat = "Reel" | "Feed-Post" | "Story" | "Karussell" | "LinkedIn-Video" | "LinkedIn-Karussell" | "TikTok-Video" | "YouTube-Video" | "YouTube-Short";
export type IdeaStatus = "idee" | "in-arbeit" | "fertig";
export type PostingStatus = "geplant" | "gepostet" | "verpasst";

export interface ContentIdea {
  id: string;
  titel: string;
  plattform: LegacyPlatform;
  ziele?: Platform[];
  format: ContentFormat;
  beschreibung: string;
  zieldatum: string;
  status: IdeaStatus;
}

export type PublicationOrigin = "manuell" | "bestaetigt";

/** Why a posting counts as published. "manuell" is a note by the operator, not a confirmation by a network. */
export interface Publication {
  art: PublicationOrigin;
  am: string;
  quelle: string;
}

export interface Posting {
  id: string;
  datum: string;
  uhrzeit: string;
  plattform: Platform;
  ziele?: Platform[];
  format: ContentFormat;
  titel: string;
  status: PostingStatus;
  veroeffentlichung?: Publication | null;
}

export interface StudioPlan {
  version: 1;
  exportiert_am: string;
  content: ContentIdea[];
  postings: Posting[];
}

export const platforms: Platform[] = ["LinkedIn", "Instagram", "Facebook", "TikTok", "YouTube"];
const validPlatforms = new Set<LegacyPlatform>([...platforms, "Beide"]);
const formats = new Set<ContentFormat>(["Reel", "Feed-Post", "Story", "Karussell", "LinkedIn-Video", "LinkedIn-Karussell", "TikTok-Video", "YouTube-Video", "YouTube-Short"]);
const ideaStatuses = new Set<IdeaStatus>(["idee", "in-arbeit", "fertig"]);
const postingStatuses = new Set<PostingStatus>(["geplant", "gepostet", "verpasst"]);
const date = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  if (value === "") return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const text = (value: unknown, max = 10000): value is string => typeof value === "string" && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const unique = (items: { id: string }[]): boolean => new Set(items.map((item) => item.id)).size === items.length;
const targets = (value: unknown): value is Platform[] => Array.isArray(value) && value.length > 0 && value.length <= platforms.length && value.every((entry) => validPlatforms.has(entry as Platform) && entry !== "Beide") && new Set(value).size === value.length;
export const ideaTargets = (idea: ContentIdea): Platform[] => idea.ziele ?? (idea.plattform === "Beide" ? ["LinkedIn", "Instagram"] : [idea.plattform]);
export const postingTargets = (posting: Posting): Platform[] => posting.ziele ?? [posting.plattform];

const publicationProblem = (item: Record<string, unknown>): string | null => {
  const value = item.veroeffentlichung;
  if (value === undefined || value === null)
    return item.status === "gepostet" ? "ein Posting mit status=gepostet braucht veroeffentlichung" : null;
  if (!record(value) || (value.art !== "manuell" && value.art !== "bestaetigt"))
    return "veroeffentlichung.art muss manuell oder bestaetigt sein";
  if (typeof value.am !== "string" || Number.isNaN(new Date(value.am).getTime()))
    return "veroeffentlichung.am muss ein Zeitpunkt sein";
  if (typeof value.quelle !== "string" || !value.quelle.trim() || value.quelle.length > 60)
    return "veroeffentlichung.quelle muss eine nichtleere Quelle sein";
  // A confirmed publication needs a real publisher as its source; "manuell" would be the same claim as before.
  if (value.art === "bestaetigt" && value.quelle.trim() === "manuell")
    return "art=bestaetigt braucht eine Publisher-Quelle, nicht quelle=manuell";
  return item.status === "gepostet" ? null : "veroeffentlichung ist nur bei status=gepostet erlaubt";
};

export function parseStudioPlan(value: unknown): StudioPlan {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.content) || !Array.isArray(value.postings) || value.content.length > 1000 || value.postings.length > 1000) {
    throw new Error("Planformat Version 1 mit content und postings erwartet.");
  }
  const content = value.content;
  const postings = value.postings;
  for (const item of content) {
    if (!record(item) || !text(item.id, 100) || !item.id || !text(item.titel, 200) || !item.titel.trim() || !validPlatforms.has(item.plattform as LegacyPlatform) || (item.ziele !== undefined && (!targets(item.ziele) || (item.plattform !== "Beide" && !item.ziele.includes(item.plattform as Platform)))) || !formats.has(item.format as ContentFormat) || !text(item.beschreibung) || !date(item.zieldatum) || !ideaStatuses.has(item.status as IdeaStatus)) {
      throw new Error("Eine Content-Idee ist unvollständig oder ungültig.");
    }
  }
  for (const item of postings) {
    if (!record(item) || !text(item.id, 100) || !item.id || !text(item.titel, 200) || !item.titel.trim() || !date(item.datum) || !item.datum || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.uhrzeit)) || !platforms.includes(item.plattform as Platform) || (item.ziele !== undefined && (!targets(item.ziele) || !item.ziele.includes(item.plattform as Platform))) || !formats.has(item.format as ContentFormat) || !postingStatuses.has(item.status as PostingStatus)) {
      throw new Error("Ein Posting ist unvollständig oder ungültig.");
    }
    const problem = publicationProblem(item);
    if (problem) {
      throw new Error(`Ein Posting ist unvollständig oder ungültig: ${problem}.`);
    }
  }
  if (!unique(content as ContentIdea[]) || !unique(postings as Posting[])) throw new Error("IDs im Plan müssen eindeutig sein.");
  return { version: 1, exportiert_am: new Date().toISOString(), content: content as ContentIdea[], postings: postings as Posting[] };
}
