import { CONTRACT_VERSION, type ActionResult, type Approval, type FileItem, type FilePreview } from "@jarvis/sdk";
import { notFound } from "../../core/errors";
import { asList, clone, compareDesc, matchesQuery, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { DeleteOutcome, OpContext } from "../types";
import { checkEnum, FILE_CATEGORIES, pageOf, type Query } from "./shared";

export type FileListQuery = Query<"listFiles">;

const PREVIEW_LIMIT = 4_000;

export interface FileDownload {
  fileName: string;
  contentType: string;
  /** Text content of the requested version; binary files get a short text stand-in. */
  body: string;
  version: number;
}

export class FileService {
  constructor(private readonly w: MockWorld) {}

  find(id: string): FileItem {
    const file = this.w.state.files.find((candidate) => candidate.id === id);
    if (!file) throw notFound("Datei", id);
    return file;
  }

  list(query: FileListQuery = {}): Page<FileItem> {
    return this.w.read("listFiles", () => {
      const categories = asList(query.category);
      checkEnum("category", categories, FILE_CATEGORIES);
      const items = this.w.state.files
        .filter((file) => {
          if (categories.length && !categories.includes(file.category)) return false;
          if (query.taskId && file.taskId !== query.taskId) return false;
          if (query.tag && !file.tags.includes(query.tag)) return false;
          return matchesQuery(`${file.name} ${file.tags.join(" ")} ${file.location}`, query.q);
        })
        .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id));
      return pageOf(items, query);
    });
  }

  get(id: string): FileItem {
    return this.w.read("getFile", () => clone(this.find(id)));
  }

  /** Untrusted content is only ever returned as sandboxed text/markup preview, never executed. */
  preview(id: string): FilePreview {
    return this.w.read("getFilePreview", () => {
      const file = this.find(id);
      const content = this.w.state.fileContents[id]?.text;
      const textual = file.previewKind === "text" || file.previewKind === "markdown" || file.previewKind === "html";
      const base = { fileId: file.id, kind: file.previewKind, contentType: file.mimeType, sandboxed: true } as const;
      if (textual && content !== undefined) {
        return { ...base, text: content.slice(0, PREVIEW_LIMIT), truncated: content.length > PREVIEW_LIMIT };
      }
      if (file.previewKind === "image" || file.previewKind === "pdf") {
        return { ...base, url: `/api/v1/files/${file.id}/download?version=${file.currentVersion}`, truncated: false };
      }
      return { ...base, kind: "none", truncated: false };
    });
  }

  download(id: string, version?: number): FileDownload {
    return this.w.read("downloadFile", () => {
      const file = this.find(id);
      const wanted = version ?? file.currentVersion;
      if (!file.versions.some((candidate) => candidate.version === wanted)) throw notFound("Dateiversion", `${id}@${wanted}`);
      const text = this.w.state.fileContents[id]?.text ?? `Mock-Inhalt von ${file.name} (Version ${wanted}, ${file.sizeBytes} Bytes)`;
      return { fileName: file.name, contentType: file.mimeType, body: text, version: wanted };
    });
  }

  /**
   * Temporary files are removed immediately; everything else needs an approval first (202). The approval
   * executes the deletion once approved.
   */
  delete(id: string, ctx?: OpContext): DeleteOutcome<Approval, ActionResult> {
    return this.w.run("deleteFile", ctx, { id }, () => {
      const file = this.find(id);
      this.w.assertVersion(file, ctx, "Datei");
      const correlationId = this.w.correlationId(ctx);
      if (file.category === "temporary" && file.sizeBytes < 10_000_000) {
        const audit = this.remove(file, correlationId, ctx);
        return {
          kind: "deleted" as const,
          result: { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed" as const, correlationId, resourceId: id, auditEventId: audit, message: "Temporäre Datei wurde gelöscht." },
        };
      }
      const existing = this.w.state.approvals.find((approval) => approval.type === "delete_file" && approval.status === "pending" && approval.sourceRef?.id === id);
      const approval =
        existing ??
        this.w.approvals.raise({
          type: "delete_file",
          action: `Datei ${file.name} löschen`,
          riskTier: 2,
          rationale: "Das Löschen einer Datei ist nicht umkehrbar und erfordert eine Freigabe.",
          impacts: [{ kind: "data", description: "Die Datei und alle Versionen werden dauerhaft entfernt.", severity: "warning" }],
          preview: { kind: "file", title: file.name, body: `Pfad: ${file.location}\\${file.name}\nGröße: ${file.sizeBytes} Bytes\nVersionen: ${file.versions.length}`, fields: [{ label: "Speicherort", value: file.location }] },
          sourceRef: { type: "file", id: file.id, label: file.name },
          editable: false,
          correlationId,
        });
      return { kind: "approval" as const, approval: clone(approval) };
    });
  }

  /** Called by the approval service after an approved `delete_file`. */
  executeDelete(approval: Approval): string {
    const file = approval.sourceRef ? this.w.state.files.find((candidate) => candidate.id === approval.sourceRef?.id) : undefined;
    if (!file) return "Datei war bereits entfernt.";
    this.remove(file, approval.correlationId);
    return `Datei „${file.name}“ wurde gelöscht.`;
  }

  /** Simulation hook: a task produced a new file. */
  createGenerated(input: { name: string; mimeType: string; sizeBytes: number; category: FileItem["category"]; taskId?: string | null; agentId?: string; location?: string; content?: string }): FileItem {
    const now = this.w.nowIso();
    const agent = input.agentId ? this.w.state.agents.find((candidate) => candidate.id === input.agentId) : undefined;
    const createdBy = agent ? ({ type: "agent", id: agent.id, name: agent.name } as const) : this.w.defaultActor();
    const file: FileItem = {
      id: this.w.id("file"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("files"),
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      category: input.category,
      currentVersion: 1,
      versions: [{ version: 1, createdAt: now, sizeBytes: input.sizeBytes, createdBy }],
      createdBy,
      taskId: input.taskId ?? null,
      location: input.location ?? "D:\\Jarvis\\Dateien\\Berichte",
      tags: [],
      previewKind: input.content !== undefined ? "text" : "none",
      lineage: input.taskId ? [{ relation: "output_of", taskId: input.taskId, description: "Ergebnis einer Aufgabe" }] : [],
      checksum: null,
    };
    this.w.state.files.push(file);
    if (input.content !== undefined) this.w.state.fileContents[file.id] = { text: input.content };
    this.w.emitFor("files", "jarvis.file.created", file, `file/${file.id}`);
    return file;
  }

  /** Simulation hook: a task regenerated the file; adds a version and publishes `jarvis.file.updated`. */
  addVersion(id: string, sizeBytes: number, content?: string): FileItem {
    const file = this.find(id);
    const now = this.w.nowIso();
    const version = file.currentVersion + 1;
    file.versions.push({ version, createdAt: now, sizeBytes, createdBy: file.createdBy });
    file.currentVersion = version;
    file.sizeBytes = sizeBytes;
    if (content !== undefined) this.w.state.fileContents[id] = { text: content };
    this.w.bump(file);
    this.w.emitFor("files", "jarvis.file.updated", file, `file/${file.id}`);
    return file;
  }

  private remove(file: FileItem, correlationId: string, ctx?: OpContext): string {
    this.w.state.files = this.w.state.files.filter((candidate) => candidate.id !== file.id);
    delete this.w.state.fileContents[file.id];
    const deletedAt = this.w.nowIso();
    this.w.emitFor("files", "jarvis.file.deleted", { id: file.id, deletedAt, deletedBy: this.w.actorOf(ctx) }, `file/${file.id}`, correlationId);
    const audit = this.w.recordAudit({
      category: "user_action",
      action: "file.deleted",
      severity: "warning",
      correlationId,
      adapterId: "mock-files",
      actor: this.w.actorOf(ctx),
      before: { name: file.name, category: file.category, sizeBytes: file.sizeBytes },
      after: null,
    });
    return audit.id;
  }
}
