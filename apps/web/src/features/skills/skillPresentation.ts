import type { SkillCatalogEntry } from "@friday/sdk";

// Hermes names the registry a skill came from ("skills.sh", "clawhub", ...) and the trust its checker assigned
// ("trusted", "community", ...). The vocabulary grows with every registry, so unknown tokens are shown verbatim
// instead of being labelled "Unbekannt" — the operator can act on the real name.
const ORIGIN_LABELS: Record<string, string> = {
  friday: "Friday-Paket", builtin: "Hermes mitgeliefert", local: "Lokal installiert",
  hub: "Hub-Installation", unknown: "Unbekannt",
};

const TRUST_LABELS: Record<string, string> = {
  builtin: "Mitgeliefert", local: "Lokal", project: "Projektfreigabe", trusted: "Vertrauenswürdige Quelle",
  community: "Community", unknown: "Unbekannt",
};

const SOURCE_LABELS: Record<string, string> = {
  registry: "Friday-Register", "hermes-dashboard": "Hermes-Dashboard", "hermes-cli": "Hermes-CLI",
  unavailable: "Nicht erreichbar",
};

/** Origin is where the skill lives; trust is what lets Hermes load it. Both stay separate from activation. */
export const originLabel = (origin: SkillCatalogEntry["origin"]): string => ORIGIN_LABELS[origin] ?? origin;
export const trustLabel = (trust: SkillCatalogEntry["trust"]): string => TRUST_LABELS[trust] ?? trust;

/** Where the observed state came from; unknown tokens stay verbatim like origin and trust. */
export const sourceLabel = (source: string | null | undefined): string => (source ? SOURCE_LABELS[source] ?? source : "Unbekannt");

export function skillState(skill: SkillCatalogEntry): { label: string; tone: "green" | "amber" | "red"; detail: string } {
  if (skill.discovered === false) return { label: "Nicht gefunden", tone: "red", detail: "Im Paket enthalten, aber in der laufenden Hermes-Instanz nicht gefunden." };
  if (skill.discovered === null) return { label: "Laufzeit unbekannt", tone: "amber", detail: "Hermes hat keinen verlässlichen Laufzeitstatus geliefert." };
  if (skill.enabled === false) return { label: "Deaktiviert", tone: "amber", detail: "Von Hermes gefunden, derzeit deaktiviert." };
  if (skill.enabled === true) return { label: "Aktiviert", tone: "green", detail: "In Hermes aktiviert. Ob alle Voraussetzungen erfüllt sind und der Skill ausführbar ist, wurde nicht geprüft." };
  return { label: "Gefunden", tone: "amber", detail: "Von Hermes gefunden. Der Aktivstatus ist unbekannt." };
}

export function internalSetupLink(target: string): string | null {
  if (target.startsWith("/settings?") || target === "/settings") return target;
  if (target === "Hermes-Einstellungen in Friday-Ubuntu") return "/settings?area=skillAccounts";
  if (target === "Friday Dashboard > Einstellungen > Adapter > CalDAV") return "/settings?area=adapters#calendar-setup-title";
  if (target === "Friday Dashboard > Einstellungen > Skill-Konten > E-Mail") return "/settings?area=skillAccounts#himalaya-account-title";
  if (target === "Friday Dashboard > Einstellungen > Skill-Konten > Telegram") return "/settings?area=skillAccounts#telegram-gateway-setup-title";
  if (target === "Friday Dashboard > Einstellungen > Skill-Konten > Discord") return "/settings?area=skillAccounts#discord-gateway-setup-title";
  if (target === "Friday Dashboard > Einstellungen > Skill-Konten > WhatsApp") return "/settings?area=skillAccounts#whatsapp-gateway-setup-title";
  if (target === "Hermes-Laufzeit: Coding-CLI und Provider-Anmeldung") return "/settings?area=skillAccounts#coding-cli-setup-title";
  if (/^adapter:[a-z0-9_-]+$/i.test(target)) return `/settings?area=adapters&adapter=${encodeURIComponent(target.slice(8))}`;
  if (target.includes("Content Studio")) return "/settings?area=contentStudioKeys";
  return null;
}

/** Keep real setup forms direct; otherwise open this integration's honest setup/status card. */
export function integrationSetupLink(item: SkillCatalogEntry["integrationDetails"][number]): string {
  const direct = internalSetupLink(item.settingsTarget);
  if (direct && direct !== "/settings?area=skillAccounts") return direct;
  return `/settings?area=skillAccounts&integration=${encodeURIComponent(item.id)}`;
}

export function officialReference(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function visibleSkills(catalog: readonly SkillCatalogEntry[], search: string, source = "all",
  stateFilter = "all", category = "all", origin = "all"): SkillCatalogEntry[] {
  const needle = search.trim().toLocaleLowerCase();
  return catalog.filter((skill) =>
    (!needle || `${skill.name} ${skill.description} ${skill.category}`.toLocaleLowerCase().includes(needle)) &&
    (source === "all" || skill.source === source) &&
    (origin === "all" || skill.origin === origin) &&
    (category === "all" || skill.category === category) &&
    (stateFilter === "all" || (stateFilter === "enabled" ? skill.enabled === true : stateFilter === "missing" ? skill.discovered === false : skill.discovered === null)),
  );
}

export function selectedVisibleSkill(filtered: readonly SkillCatalogEntry[], selectedId: string | null): SkillCatalogEntry | null {
  return filtered.find((skill) => skill.id === selectedId) ?? filtered[0] ?? null;
}
