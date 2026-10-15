import type {
  ResearchArtifact,
  ResearchFinding,
  ResearchProject,
  ResearchSource,
} from "@friday/sdk";
import { notFound } from "../../core/errors";
import { clone, compareDesc, matchesQuery, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import { pageOf, type Query } from "./shared";

export type ResearchListQuery = Query<"listResearchProjects">;
export type ResearchChildQuery = Query<"listResearchSources">;

export class ResearchService {
  constructor(private readonly w: MockWorld) {}

  find(id: string): ResearchProject {
    const project = this.w.state.researchProjects.find((candidate) => candidate.id === id);
    if (!project) throw notFound("Recherche-Projekt", id);
    return project;
  }

  listProjects(query: ResearchListQuery = {}): Page<ResearchProject> {
    return this.w.read("listResearchProjects", () => {
      const items = this.w.state.researchProjects
        .filter((project) => matchesQuery(`${project.topic} ${project.mission} ${project.resultSummary ?? ""}`, query.q))
        .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  getProject(id: string): ResearchProject {
    return this.w.read("getResearchProject", () => clone(this.find(id)));
  }

  listSources(projectId: string, query: ResearchChildQuery = {}): Page<ResearchSource> {
    return this.w.read("listResearchSources", () => {
      this.find(projectId);
      const items = this.w.state.researchSources.filter((source) => source.projectId === projectId).sort((a, b) => b.relevance - a.relevance || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  listFindings(projectId: string, query: ResearchChildQuery = {}): Page<ResearchFinding> {
    return this.w.read("listResearchFindings", () => {
      this.find(projectId);
      const items = this.w.state.researchFindings.filter((finding) => finding.projectId === projectId).sort((a, b) => b.confidence - a.confidence || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  listArtifacts(projectId: string, query: ResearchChildQuery = {}): Page<ResearchArtifact> {
    return this.w.read("listResearchArtifacts", () => {
      this.find(projectId);
      const items = this.w.state.researchArtifacts.filter((artifact) => artifact.projectId === projectId).sort((a, b) => compareDesc(a.createdAt, b.createdAt));
      return pageOf(items, query);
    });
  }

  // ---- simulation hooks (scenarios) ----

  addSource(projectId: string, input: { title: string; domain: string; path?: string; relevance?: number; reliability?: number; excerpt?: string; supports?: string }): ResearchSource {
    const project = this.find(projectId);
    const now = this.w.nowIso();
    const source: ResearchSource = {
      id: this.w.id("src"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("research"),
      projectId,
      title: input.title,
      domain: input.domain,
      url: `https://${input.domain}${input.path ?? "/"}`,
      retrievedAt: now,
      relevance: input.relevance ?? 0.7,
      reliability: input.reliability ?? 0.7,
      supportsStatement: input.supports ?? null,
      excerpt: input.excerpt ?? null,
      status: "retrieved",
    };
    this.w.state.researchSources.push(source);
    project.sourceCount += 1;
    this.w.bump(project);
    this.w.emitFor("research", "friday.research.source_added", source, `research/${projectId}`);
    this.w.emitFor("research", "friday.research.updated", project, `research/${projectId}`);
    return source;
  }

  addFinding(projectId: string, input: { statement: string; confidence?: number; sourceIds: string[] }): ResearchFinding {
    const project = this.find(projectId);
    const now = this.w.nowIso();
    const finding: ResearchFinding = {
      id: this.w.id("fnd"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("research"),
      projectId,
      statement: input.statement,
      confidence: input.confidence ?? 0.6,
      supportingSourceIds: input.sourceIds,
      contradictions: [],
      status: "draft",
    };
    this.w.state.researchFindings.push(finding);
    project.findingCount += 1;
    this.w.bump(project);
    this.w.emitFor("research", "friday.research.finding_added", finding, `research/${projectId}`);
    this.w.emitFor("research", "friday.research.updated", project, `research/${projectId}`);
    return finding;
  }
}
