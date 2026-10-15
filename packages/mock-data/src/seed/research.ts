import type {
  ResearchArtifact,
  ResearchFinding,
  ResearchProject,
  ResearchSource,
} from "@friday/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import { fileSpec } from "./files";
import type { AgentKey, FileKey, ResearchKey, Story } from "./story";

interface SourceSpec {
  title: string;
  domain: string;
  path: string;
  relevance: number;
  reliability: number;
  status: ResearchSource["status"];
  supports: string | null;
  excerpt: string | null;
}

interface FindingSpec {
  statement: string;
  confidence: number;
  status: ResearchFinding["status"];
  /** Indices into the project's source list. */
  supportedBy: number[];
  contradicts?: { source?: number; description: string }[];
}

interface ProjectSpec {
  key: ResearchKey;
  topic: string;
  mission: string;
  status: ResearchProject["status"];
  agents: AgentKey[];
  progress: ResearchProject["progress"];
  summary: string | null;
  runtimeMs: number;
  costEur: number;
  createdAgoMs: number;
  sources: SourceSpec[];
  findings: FindingSpec[];
  artifacts: { name: string; format: ResearchArtifact["format"]; file?: FileKey; size: number | null }[];
}

const PROJECTS: ProjectSpec[] = [
  {
    key: "foerderung",
    topic: "Förderprogramme für Photovoltaik und Batteriespeicher in Niedersachsen",
    mission: "Alle für Privatanlagen nutzbaren Bundes-, Landes- und Regionalprogramme finden, Bedingungen und Fristen vergleichen und Widersprüche kennzeichnen.",
    status: "review",
    agents: ["recherche", "browser"],
    progress: { mode: "determinate", value: 1 },
    summary: "Neun Programme gefunden, drei davon aktuell nutzbar. Eine Quelle nennt eine abweichende Förderhöchstgrenze beim KfW-Programm.",
    runtimeMs: 54 * MIN,
    costEur: 1.84,
    createdAgoMs: 3 * DAY + 3 * HOUR,
    sources: [
      { title: "KfW-Programm 270 – Erneuerbare Energien Standard", domain: "kfw-programme.example", path: "/foerderung/270", relevance: 0.96, reliability: 0.95, status: "retrieved", supports: "KfW 270 finanziert PV-Anlagen und Speicher zinsgünstig.", excerpt: "Das Programm richtet sich an Privatpersonen und Unternehmen, die Anlagen zur Stromerzeugung errichten oder erweitern." },
      { title: "Förderdatenbank des Bundes: Photovoltaik", domain: "foerderdatenbank.example", path: "/pv/uebersicht", relevance: 0.9, reliability: 0.93, status: "retrieved", supports: "Die Förderhöchstgrenze beträgt 150 Millionen Euro je Vorhaben.", excerpt: "Je Vorhaben können bis zu 150 Millionen Euro Kredit gewährt werden." },
      { title: "Ratgeber Solarförderung 2026 (Verbraucherportal)", domain: "solar-ratgeber.example", path: "/foerderung-2026", relevance: 0.74, reliability: 0.55, status: "retrieved", supports: "Die Förderhöchstgrenze beträgt 50 Millionen Euro je Vorhaben.", excerpt: "Nach unseren Informationen liegt die Obergrenze bei 50 Millionen Euro." },
      { title: "Region Hannover: Zuschuss Batteriespeicher", domain: "hannover-region.example", path: "/klima/batteriespeicher", relevance: 0.88, reliability: 0.9, status: "retrieved", supports: "Zuschüsse für Batteriespeicher müssen vor dem Kauf beantragt werden.", excerpt: "Der Antrag ist vor Beginn des Vorhabens zu stellen; das Budget ist begrenzt." },
      { title: "Bundesnetzagentur: Einspeisevergütung", domain: "netzagentur-info.example", path: "/eeg/verguetung", relevance: 0.81, reliability: 0.97, status: "retrieved", supports: "Die Einspeisevergütung hängt vom Inbetriebnahmedatum ab.", excerpt: "Die anzulegenden Werte sinken halbjährlich um ein Prozent." },
      { title: "Forum PV-Selbstbau: Erfahrungen", domain: "pv-selbstbau-forum.example", path: "/thread/48211", relevance: 0.42, reliability: 0.25, status: "excluded", supports: null, excerpt: null },
    ],
    findings: [
      { statement: "Das KfW-Programm 270 ist für Privatanlagen inklusive Speicher nutzbar.", confidence: 0.94, status: "verified", supportedBy: [0, 1] },
      { statement: "Die Förderhöchstgrenze des KfW-Programms beträgt 150 Millionen Euro je Vorhaben.", confidence: 0.55, status: "disputed", supportedBy: [1], contradicts: [{ source: 2, description: "Eine Verbraucherseite nennt 50 Millionen Euro; die Förderdatenbank widerspricht." }] },
      { statement: "Der regionale Speicherzuschuss muss vor dem Kauf beantragt werden und ist budgetbegrenzt.", confidence: 0.91, status: "verified", supportedBy: [3] },
      { statement: "Die Einspeisevergütung richtet sich nach dem Inbetriebnahmedatum.", confidence: 0.96, status: "verified", supportedBy: [4] },
    ],
    artifacts: [
      { name: "Förderprogramme Photovoltaik – Übersicht.md", format: "markdown", file: "foerderRecherche", size: 22_870 },
      { name: "Quellen und Findings.json", format: "json", size: 31_204 },
    ],
  },
  {
    key: "lieferanten",
    topic: "Büromöbel-Anbieter in der Region Hannover",
    mission: "Drei geeignete Anbieter für höhenverstellbare Schreibtische und Bürostühle vergleichen: Gesamtkosten, Lieferzeit, Montage, Garantie.",
    status: "running",
    agents: ["recherche"],
    progress: { mode: "determinate", value: 0.62 },
    summary: null,
    runtimeMs: 20 * MIN,
    costEur: 0.62,
    createdAgoMs: 100 * MIN,
    sources: [
      { title: "Büro-Nord Einrichtungen – Preisliste 2026", domain: "buero-nord.example", path: "/preise", relevance: 0.97, reliability: 0.85, status: "retrieved", supports: "Gesamtpreis netto 11.840,00 EUR bei drei Wochen Lieferzeit.", excerpt: "Höhenverstellbare Schreibtische ab 489 EUR, Lieferzeit derzeit drei Wochen." },
      { title: "Möbelhaus Weserstraße – Objekteinrichtung", domain: "moebelhaus-weserstrasse.example", path: "/objekt", relevance: 0.83, reliability: 0.8, status: "retrieved", supports: "Gesamtpreis netto 12.390,00 EUR bei fünf Wochen Lieferzeit.", excerpt: "Objektpreise inklusive Montage, Lieferzeit fünf Wochen." },
      { title: "Arbeitswelt Leine KG – Angebot", domain: "arbeitswelt-leine.example", path: "/angebot", relevance: 0.79, reliability: 0.75, status: "retrieved", supports: "Gesamtpreis netto 10.995,00 EUR, Montage separat.", excerpt: "Montage wird nach Aufwand berechnet." },
      { title: "Testbericht Bürostühle 2026", domain: "buero-test.example", path: "/buerostuehle", relevance: 0.55, reliability: 0.7, status: "queued", supports: null, excerpt: null },
      { title: "Lieferbedingungen Möbelspedition Nord", domain: "spedition-nord.example", path: "/agb", relevance: 0.3, reliability: 0.6, status: "failed", supports: null, excerpt: null },
    ],
    findings: [
      { statement: "Arbeitswelt Leine ist im Listenpreis am günstigsten, die Montage ist jedoch nicht enthalten.", confidence: 0.72, status: "draft", supportedBy: [2], contradicts: [{ source: 0, description: "Büro-Nord weist Montage im Preis aus und liegt inklusive Montage voraussichtlich gleichauf." }] },
      { statement: "Büro-Nord bietet mit drei Wochen die kürzeste Lieferzeit.", confidence: 0.88, status: "verified", supportedBy: [0, 1] },
    ],
    artifacts: [{ name: "Angebotsvergleich Büromöbel.md", format: "markdown", file: "angebotsvergleich", size: 18_432 }],
  },
  {
    key: "ki",
    topic: "Lokale Sprachmodelle für Dokumentenzusammenfassung",
    mission: "Prüfen, ob ein lokal laufendes Modell Mails und Berichte ausreichend gut zusammenfasst (Qualität, Geschwindigkeit, Speicherbedarf).",
    status: "done",
    agents: ["recherche", "coding"],
    progress: { mode: "determinate", value: 1 },
    summary: "Qwen Local erreicht bei Mails ausreichende Qualität bei unter drei Sekunden Antwortzeit; für lange Berichte bleibt Kimi K3 überlegen.",
    runtimeMs: 2 * HOUR + 12 * MIN,
    costEur: 3.12,
    createdAgoMs: 9 * DAY,
    sources: [
      { title: "Benchmark Zusammenfassung Deutsch (Community)", domain: "llm-benchmarks.example", path: "/de/summarization", relevance: 0.9, reliability: 0.7, status: "retrieved", supports: "Mittelgroße lokale Modelle erreichen bei deutschen Mails gute Faktentreue.", excerpt: "Faktentreue bei kurzen Texten über 90 Prozent." },
      { title: "Hardwareanforderungen lokaler Inferenz", domain: "local-inference-docs.example", path: "/hardware", relevance: 0.75, reliability: 0.85, status: "retrieved", supports: "Ein 14B-Modell benötigt ca. 10 GB VRAM bei 4-bit-Quantisierung.", excerpt: "4-bit-Quantisierung reduziert den Speicherbedarf um etwa Faktor vier." },
      { title: "Messprotokoll eigener Test", domain: "intern.example", path: "/tests/qwen-local", relevance: 0.99, reliability: 0.9, status: "retrieved", supports: "Antwortzeit unter drei Sekunden bei Mails bis 800 Wörter.", excerpt: "Median 2,4 s, p95 3,1 s auf der lokalen GPU." },
    ],
    findings: [
      { statement: "Für Mails bis 800 Wörter genügt das lokale Modell bei einer Antwortzeit von unter drei Sekunden.", confidence: 0.9, status: "verified", supportedBy: [0, 2] },
      { statement: "Lange Berichte erfordern weiterhin das größere Cloud-Modell.", confidence: 0.78, status: "verified", supportedBy: [0] },
    ],
    artifacts: [
      { name: "Modellvergleich Zusammenfassung.md", format: "markdown", size: 11_020 },
      { name: "Modellvergleich Zusammenfassung.pdf", format: "pdf", size: 204_118 },
    ],
  },
];

export interface ResearchSeed {
  projects: ResearchProject[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
  artifacts: ResearchArtifact[];
}

export function buildResearch(ctx: SeedContext, story: Story): ResearchSeed {
  const out: ResearchSeed = { projects: [], sources: [], findings: [], artifacts: [] };
  for (const spec of PROJECTS) {
    const projectId = story.research[spec.key];
    const sources: ResearchSource[] = spec.sources.map((source, index) => {
      const retrieved = source.status === "retrieved" || source.status === "excluded";
      return {
        id: ctx.id("src"),
        version: 1,
        createdAt: ctx.at(-spec.createdAgoMs + index * 4 * MIN),
        updatedAt: ctx.at(-spec.createdAgoMs + index * 4 * MIN),
        source: ctx.src("research"),
        projectId,
        title: source.title,
        domain: source.domain,
        url: `https://${source.domain}${source.path}`,
        retrievedAt: retrieved ? ctx.at(-spec.createdAgoMs + index * 4 * MIN + 90_000) : null,
        relevance: source.relevance,
        reliability: source.reliability,
        supportsStatement: source.supports,
        excerpt: source.excerpt,
        status: source.status,
      };
    });
    const findings: ResearchFinding[] = spec.findings.map((finding, index) => ({
      id: ctx.id("fnd"),
      version: 1,
      createdAt: ctx.at(-spec.createdAgoMs + (index + 3) * 6 * MIN),
      updatedAt: ctx.at(-spec.createdAgoMs + (index + 3) * 6 * MIN),
      source: ctx.src("research"),
      projectId,
      statement: finding.statement,
      confidence: finding.confidence,
      supportingSourceIds: finding.supportedBy.map((i) => (sources[i] as ResearchSource).id),
      contradictions: (finding.contradicts ?? []).map((entry) => ({
        sourceId: entry.source !== undefined ? (sources[entry.source] as ResearchSource).id : null,
        findingId: null,
        description: entry.description,
      })),
      status: finding.status,
    }));
    const artifacts: ResearchArtifact[] = spec.artifacts.map((artifact) => ({
      id: ctx.id("art"),
      version: 1,
      createdAt: ctx.at(-spec.createdAgoMs + 40 * MIN),
      updatedAt: ctx.at(-spec.createdAgoMs + 40 * MIN),
      source: ctx.src("research"),
      projectId,
      name: artifact.name,
      format: artifact.format,
      fileId: artifact.file ? story.files[artifact.file] : null,
      sizeBytes: artifact.file ? fileSpec(artifact.file).sizeBytes : artifact.size,
    }));
    out.projects.push({
      id: projectId,
      version: ctx.rng.int(2, 6),
      createdAt: ctx.at(-spec.createdAgoMs),
      updatedAt: ctx.at(-Math.min(spec.createdAgoMs, 2 * MIN + spec.runtimeMs / 4)),
      source: ctx.src("research"),
      topic: spec.topic,
      mission: spec.mission,
      status: spec.status,
      agentIds: spec.agents.map((key) => story.agents[key]),
      progress: spec.progress,
      sourceCount: sources.length,
      findingCount: findings.length,
      contradictionCount: findings.reduce((sum, finding) => sum + finding.contradictions.length, 0),
      artifactCount: artifacts.length,
      resultSummary: spec.summary,
      runtimeMs: spec.runtimeMs,
      costEur: spec.costEur,
    });
    out.sources.push(...sources);
    out.findings.push(...findings);
    out.artifacts.push(...artifacts);
  }
  return out;
}
