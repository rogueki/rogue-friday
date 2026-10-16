import type { SkillCatalogEntry } from "@friday/sdk";

type CatalogQueryState = {
  isPending: boolean;
  isError: boolean;
  isStale: boolean;
  data?: { freshness?: { state: string } };
};

export function isCurrentCatalog(query: CatalogQueryState): boolean {
  return !query.isPending && !query.isError && !query.isStale && query.data?.freshness?.state === "fresh";
}

export function unverifiedSkill(skill: SkillCatalogEntry): SkillCatalogEntry {
  return {
    ...skill,
    discovered: null,
    enabled: null,
    integrationDetails: skill.integrationDetails.map((item) => ({ ...item, configured: null, connectionChecked: null })),
    observationError: [skill.observationError, "Katalogdaten sind nicht mehr aktuell"].filter(Boolean).join("; "),
  };
}
