import type { ResearchArtifact, ResearchFinding, ResearchProject, ResearchSource } from "@friday/sdk";
import { CONTRACT_VERSION } from "@friday/sdk";

/** Everything a research export contains, assembled from API data only (nothing is invented client-side). */
export interface ResearchBundle {
  project: ResearchProject;
  sources: ResearchSource[];
  findings: ResearchFinding[];
  artifacts: ResearchArtifact[];
  /** Resolved agent names by id; unknown ids stay as ids. */
  agentNames?: Record<string, string>;
  exportedAt: string;
}

const MD_ESCAPE = /([\\`*_{}[\]<>|])/g;
const md = (text: string): string => text.replace(MD_ESCAPE, "\\$1").replace(/\r?\n/g, " ");

const STATUS_DE: Record<ResearchProject["status"], string> = {
  planning: "In Planung",
  running: "Läuft",
  review: "In Prüfung",
  done: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};
const FINDING_STATUS_DE: Record<ResearchFinding["status"], string> = { draft: "Entwurf", verified: "Verifiziert", disputed: "Umstritten", rejected: "Verworfen" };
const SOURCE_STATUS_DE: Record<ResearchSource["status"], string> = { queued: "Wartet", retrieved: "Abgerufen", failed: "Fehlgeschlagen", excluded: "Ausgeschlossen" };

const percent = (value: number): string => `${Math.round(value * 100)} %`;

function progressText(project: ResearchProject): string {
  const { mode, value } = project.progress;
  if (mode === "determinate" && value !== null) return percent(value);
  return mode === "indeterminate" ? "läuft (Fortschritt unbekannt)" : "nicht gemeldet";
}

function runtimeText(ms: number | null): string {
  if (ms === null) return "nicht gemeldet";
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.` : `${minutes} Min.`;
}

/** Markdown report with a numbered source list; every finding names the sources that support it (PLAN §36.3). */
export function buildResearchMarkdown(bundle: ResearchBundle): string {
  const { project, sources, findings, artifacts } = bundle;
  const number = new Map(sources.map((source, index) => [source.id, index + 1]));
  const agents = project.agentIds.map((id) => bundle.agentNames?.[id] ?? id);
  const lines: string[] = [];
  lines.push(`# ${md(project.topic)}`, "");
  lines.push(`> ${md(project.mission)}`, "");
  lines.push(`- **Status:** ${STATUS_DE[project.status]}`);
  lines.push(`- **Fortschritt:** ${progressText(project)}`);
  lines.push(`- **Agenten:** ${agents.length > 0 ? agents.map(md).join(", ") : "keine"}`);
  lines.push(`- **Laufzeit:** ${runtimeText(project.runtimeMs)}`);
  lines.push(`- **Kosten:** ${project.costEur === null || project.costEur === undefined ? "nicht gemeldet" : `${project.costEur.toFixed(2)} EUR`}`);
  lines.push(`- **Exportiert:** ${bundle.exportedAt}`, "");
  if (project.resultSummary) lines.push("## Ergebnis", "", md(project.resultSummary), "");

  lines.push("## Findings und Belege", "");
  if (findings.length === 0) lines.push("_Keine Findings vorhanden._", "");
  findings.forEach((finding, index) => {
    const refs = finding.supportingSourceIds.map((id) => (number.has(id) ? `[${number.get(id)}]` : `[?]`));
    lines.push(`${index + 1}. ${md(finding.statement)} (${FINDING_STATUS_DE[finding.status]}, Konfidenz ${percent(finding.confidence)})`);
    lines.push(`   - Belege: ${refs.length > 0 ? refs.join(" ") : "keine Quelle zugeordnet"}`);
    for (const contradiction of finding.contradictions) lines.push(`   - Widerspruch: ${md(contradiction.description)}`);
  });
  lines.push("");

  lines.push("## Quellen", "");
  if (sources.length === 0) lines.push("_Keine Quellen vorhanden._", "");
  for (const source of sources) {
    const n = number.get(source.id);
    const target = source.url ? ` – ${source.url}` : "";
    lines.push(`${n}. **${md(source.title)}** (${md(source.domain)}) – Relevanz ${percent(source.relevance)}, Verlässlichkeit ${percent(source.reliability)}, ${SOURCE_STATUS_DE[source.status]}${target}`);
    if (source.supportsStatement) lines.push(`   - Stützt: ${md(source.supportsStatement)}`);
    if (source.excerpt) lines.push(`   - Auszug: „${md(source.excerpt)}“`);
  }
  lines.push("");

  if (artifacts.length > 0) {
    lines.push("## Artefakte", "");
    for (const artifact of artifacts) lines.push(`- ${md(artifact.name)} (${artifact.format.toUpperCase()})`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Machine-readable export: the API objects exactly as delivered, wrapped with export metadata. */
export function buildResearchJson(bundle: ResearchBundle): string {
  return JSON.stringify(
    {
      exportedAt: bundle.exportedAt,
      contractVersion: CONTRACT_VERSION,
      project: bundle.project,
      sources: bundle.sources,
      findings: bundle.findings,
      artifacts: bundle.artifacts,
    },
    null,
    2,
  );
}

export interface FindingEvidence {
  finding: ResearchFinding;
  supporting: ResearchSource[];
  /** Ids that a finding names but that are not part of the loaded source list. */
  missingSourceIds: string[];
}

/** Finding -> source mapping (which source supports which statement). */
export function mapFindingEvidence(findings: readonly ResearchFinding[], sources: readonly ResearchSource[]): FindingEvidence[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return findings.map((finding) => {
    const supporting: ResearchSource[] = [];
    const missingSourceIds: string[] = [];
    for (const id of finding.supportingSourceIds) {
      const source = byId.get(id);
      if (source) supporting.push(source);
      else missingSourceIds.push(id);
    }
    return { finding, supporting, missingSourceIds };
  });
}

/** Reverse mapping for the source view: which findings cite this source. */
export function findingsForSource(sourceId: string, findings: readonly ResearchFinding[]): ResearchFinding[] {
  return findings.filter((finding) => finding.supportingSourceIds.includes(sourceId));
}
