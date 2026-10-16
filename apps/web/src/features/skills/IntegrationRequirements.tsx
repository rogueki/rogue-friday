import type { SkillCatalogEntry } from "@friday/sdk";

type Integration = SkillCatalogEntry["integrationDetails"][number];

const costModels = {
  host_resources: "Lokale Ressourcen",
  provider_usage: "Anbieternutzung",
  subscription_license: "Abonnement oder Lizenz",
  none: "Keine zusätzlichen Integrationskosten verzeichnet",
  unknown: "Kosten unbekannt",
} as const;

export function IntegrationRequirements({ item }: { item: Integration }) {
  const permissions = item.permissions;
  const cost = item.cost;
  return <div className="sk-integration-requirements">
    <p><strong>Berechtigungen:</strong> {permissions?.scope_notice || "Benötigte Berechtigungen und Freigaben sind nicht katalogisiert. Vor der Nutzung die aktuelle Anbieter- oder Skill-Anleitung prüfen."}</p>
    {permissions?.required_prerequisites.length ? <ul aria-label="Erforderliche Voraussetzungen">{permissions.required_prerequisites.map((entry, index) => <li key={`${entry.kind}-${index}`}>{entry.notice}</li>)}</ul> : null}
    {permissions?.optional_prerequisites.length ? <p><strong>Optional:</strong> {permissions.optional_prerequisites.map((entry) => entry.notice).join(" ")}</p> : null}
    <p><strong>Kosten:</strong> {cost ? `${costModels[cost.model]} · ${cost.notice}` : "Unbekannt. Mögliche Anbieter-, Lizenz- oder Betriebskosten vor der Nutzung prüfen."}</p>
  </div>;
}
