import type { SkillCatalogEntry } from "@friday/sdk";

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
  if (target === "Hermes-Laufzeit: Coding-CLI und Provider-Anmeldung") return "/settings?area=skillAccounts#coding-cli-setup-title";
  if (/^adapter:[a-z0-9_-]+$/i.test(target)) return `/settings?area=adapters&adapter=${encodeURIComponent(target.slice(8))}`;
  if (target.includes("Content Studio")) return "/settings?area=contentStudioKeys";
  return null;
}

export function officialReference(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function visibleSkills(catalog: readonly SkillCatalogEntry[], search: string, source = "all", stateFilter = "all"): SkillCatalogEntry[] {
  const needle = search.trim().toLocaleLowerCase();
  return catalog.filter((skill) =>
    (!needle || `${skill.name} ${skill.description} ${skill.category}`.toLocaleLowerCase().includes(needle)) &&
    (source === "all" || skill.source === source) &&
    (stateFilter === "all" || (stateFilter === "enabled" ? skill.enabled === true : stateFilter === "missing" ? skill.discovered === false : skill.discovered === null)),
  );
}

export function selectedVisibleSkill(filtered: readonly SkillCatalogEntry[], selectedId: string | null): SkillCatalogEntry | null {
  return filtered.find((skill) => skill.id === selectedId) ?? filtered[0] ?? null;
}
