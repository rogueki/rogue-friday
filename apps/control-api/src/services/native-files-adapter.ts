import {
  closeSync, createReadStream, lstatSync, openSync, readdirSync, readSync, realpathSync, statSync, type Stats,
} from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  AdapterError, createId, toIso,
  type AdapterContext, type AdapterFactory, type AdapterHealthReport, type CallContext, type CapabilitySet,
  type FileDownload, type FilePort, type FridayAdapter, type IdParam, type ListFilesParams, type Page, type Single,
} from "@friday/adapter-core";
import {
  CONTRACT_VERSION, type AdapterManifest, type FileCategory, type FileItem, type FilePreview,
  type FilePreviewKind, type SourceDescriptor,
} from "@friday/sdk";

export const NATIVE_FILES_PROVIDER_ID = "friday-files";
export const NATIVE_FILES_CONFIG_SCHEMA_ID = "urn:friday:adapter:friday-files:config";
export const nativeFilesConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: NATIVE_FILES_CONFIG_SCHEMA_ID,
  title: "Friday-Dateien (lokal)",
  description: "Eingebauter Adapter ohne Einstellungen: zeigt von F.R.I.D.A.Y. erzeugte Dateien (PowerPoint, Content Studio) schreibgeschützt an.",
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;
export const nativeFilesManifest: AdapterManifest = {
  id: NATIVE_FILES_PROVIDER_ID,
  name: "Friday-Dateien (lokal)",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "files",
  // Read-only view; the adapter never deletes or renames files.
  capabilities: ["files.read", "files.preview", "files.download"],
  configSchemaRef: NATIVE_FILES_CONFIG_SCHEMA_ID,
  secretFields: [],
};

export interface NativeFileRoot {
  key: string;
  relativePath: string[];
  label: string;
  category: FileCategory;
  extensions: readonly string[];
}

export const NATIVE_FILE_ROOTS: readonly NativeFileRoot[] = [
  { key: "powerpoint", relativePath: ["private", "powerpoint"], label: "Präsentationen", category: "presentations", extensions: [".pptx"] },
  { key: "content-studio", relativePath: ["content-studio", "jobs"], label: "Content Studio", category: "generated",
    extensions: [".mp4", ".mp3", ".png", ".jpg", ".jpeg", ".webp", ".gif"] },
];

const MAX_SCAN_DEPTH = 4;
const MAX_SCAN_ENTRIES = 5000;
const IMAGE_PREVIEW_MAX_BYTES = 10_000_000;
const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;
const TEXT_PREVIEW_MAX_CHARS = 4_000;
const TITLE_JSON_MAX_BYTES = 4096;
const TITLE_MAX_CHARS = 120;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const CREATED_BY = { type: "system", id: "friday", name: "F.R.I.D.A.Y." } as const;

const freshnessOf = (asOf: string): { state: "fresh"; asOf: string } => ({ state: "fresh", asOf });
const sourceOf = (lastSyncedAt: string): SourceDescriptor =>
  ({ adapterId: NATIVE_FILES_PROVIDER_ID, system: "friday", lastSyncedAt });

const mimeTypeOf = (name: string): string =>
  MIME_BY_EXTENSION[extname(name).toLowerCase()] ?? "application/octet-stream";

const previewKindOf = (mimeType: string, sizeBytes: number): FilePreviewKind => {
  if (mimeType === "text/plain") return "text";
  if (mimeType === "text/markdown") return "markdown";
  if (IMAGE_MIME.has(mimeType)) return sizeBytes <= IMAGE_PREVIEW_MAX_BYTES ? "image" : "none";
  return "none";
};

const encodeCursor = (offset: number): string => Buffer.from(`o:${offset}`).toString("base64url");

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const match = /^o:(\d+)$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!match) throw new AdapterError({ code: "VALIDATION_FAILED", message: "Ungültiger Cursor.", retryable: false });
  return Number(match[1]);
}

// readdirSync throws on unreadable folders; a missing permission must only skip that folder, never fail the scan.
const listDirectory = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

function readHead(absolutePath: string, maxBytes: number): Buffer {
  const fd = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    let offset = 0;
    while (offset < maxBytes) {
      const read = readSync(fd, buffer, offset, maxBytes - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return buffer.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

export function fileIdOf(rootKey: string, relativePosixPath: string): string {
  return createId("file", `friday-files:${rootKey}/${relativePosixPath}`);
}

export function createNativeFilesFactory(
  dataDir: () => string,
  roots: readonly NativeFileRoot[] = NATIVE_FILE_ROOTS,
): AdapterFactory<"files"> {
  return {
    providerId: NATIVE_FILES_PROVIDER_ID,
    category: "files",
    configSchema: nativeFilesConfigSchema,
    modes: ["live", "hybrid"],
    create: () => new NativeFilesAdapter(dataDir, roots),
  };
}

interface NativeFileEntry {
  id: string;
  root: NativeFileRoot;
  absolutePath: string;
  relativePosixPath: string;
  name: string;
  stats: Stats;
}

export class NativeFilesAdapter implements FridayAdapter, FilePort {
  readonly manifest = nativeFilesManifest;
  private context: AdapterContext | undefined;

  constructor(
    private readonly dataDir: () => string,
    private readonly roots: readonly NativeFileRoot[] = NATIVE_FILE_ROOTS,
  ) {}

  async initialize(context: AdapterContext): Promise<void> {
    this.context = context;
  }

  async getCapabilities(): Promise<CapabilitySet> {
    return { capabilities: [...nativeFilesManifest.capabilities] };
  }

  async shutdown(): Promise<void> {
    this.context = undefined;
  }

  async healthCheck(): Promise<AdapterHealthReport> {
    const context = this.context;
    if (!context)
      return { status: "offline", latencyMs: null, message: "Adapter ist nicht aktiv", errorCode: "ADAPTER_UNAVAILABLE" };
    const started = context.clock.now();
    try {
      if (!statSync(realpathSync(resolve(this.dataDir()))).isDirectory()) throw new Error("not a directory");
    } catch {
      return { status: "offline", latencyMs: null, errorCode: "DATA_DIR_UNAVAILABLE",
        message: "Datenordner der Control API ist nicht lesbar." };
    }
    const latencyMs = Math.max(0, Math.round(context.clock.now() - started));
    return { status: "online", latencyMs };
  }

  async listFiles(params: ListFilesParams, _call: CallContext): Promise<Page<FileItem>> {
    const context = this.ready();
    const limit = Math.min(200, Math.max(1, Math.floor(params.limit ?? 50)));
    const offset = decodeCursor(params.cursor);
    const asOf = toIso(context.clock);
    const source = sourceOf(asOf);
    const freshness = freshnessOf(asOf);
    // Every listed file has taskId null, so a task filter can never match.
    if (params.taskId !== undefined && params.taskId !== null)
      return { items: [], pageInfo: { nextCursor: null, hasNextPage: false, totalCount: 0 }, freshness, sources: [source] };
    const categories = params.category !== undefined && params.category.length > 0 ? new Set(params.category) : undefined;
    const tag = params.tag !== undefined && params.tag !== "" ? params.tag : undefined;
    const words = params.q !== undefined && params.q.trim() !== ""
      ? params.q.split(/\s+/).filter((word) => word !== "").map((word) => word.toLocaleLowerCase("de"))
      : [];
    const items = [...this.scan().values()].map((entry) => this.toFileItem(entry)).filter((item) => {
      if (categories !== undefined && !categories.has(item.category)) return false;
      if (tag !== undefined && !item.tags.includes(tag)) return false;
      if (words.length > 0) {
        const haystack = `${item.name} ${item.location} ${item.tags.join(" ")}`.toLocaleLowerCase("de");
        if (!words.every((word) => haystack.includes(word))) return false;
      }
      return true;
    });
    items.sort((a, b) => (a.updatedAt === b.updatedAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.updatedAt < b.updatedAt ? 1 : -1));
    const totalCount = items.length;
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length;
    const pageInfo = next < totalCount
      ? { nextCursor: encodeCursor(next), hasNextPage: true, totalCount }
      : { nextCursor: null, hasNextPage: false, totalCount };
    return { items: page, pageInfo, freshness, sources: [source] };
  }

  async getFile({ id }: IdParam, _call: CallContext): Promise<Single<FileItem>> {
    const context = this.ready();
    const entry = this.resolveEntry(id);
    if (!entry) throw this.notFound(id);
    return { data: this.toFileItem(entry), freshness: freshnessOf(toIso(context.clock)) };
  }

  async getFilePreview({ id }: IdParam, _call: CallContext): Promise<Single<FilePreview>> {
    const context = this.ready();
    const entry = this.resolveEntry(id);
    if (!entry) throw this.notFound(id);
    const absolutePath = this.readablePath(entry);
    const mimeType = mimeTypeOf(entry.name);
    const kind = previewKindOf(mimeType, entry.stats.size);
    const freshness = freshnessOf(toIso(context.clock));
    const base = { fileId: id, kind, contentType: mimeType, sandboxed: true };
    if (kind === "text" || kind === "markdown") {
      const bytes = readHead(absolutePath, TEXT_PREVIEW_MAX_BYTES);
      const raw = bytes.toString("utf8");
      const truncated = entry.stats.size > bytes.length || raw.length > TEXT_PREVIEW_MAX_CHARS;
      return { data: { ...base, text: raw.slice(0, TEXT_PREVIEW_MAX_CHARS), truncated }, freshness };
    }
    if (kind === "image")
      return { data: { ...base, url: `/api/v1/files/${id}/download`, truncated: false }, freshness };
    return { data: { ...base, kind: "none", truncated: false }, freshness };
  }

  async downloadFile({ id, version }: IdParam & { version?: number }, _call: CallContext): Promise<FileDownload> {
    this.ready();
    if (version !== undefined && version !== 1) throw this.notFound(id, { version });
    const entry = this.resolveEntry(id);
    if (!entry) throw this.notFound(id);
    const absolutePath = this.readablePath(entry);
    const name = entry.root.key === "powerpoint" ? this.displayNameOf(entry) : entry.name;
    // Videos are large: stream the file instead of buffering it into memory.
    return {
      fileId: id,
      filename: name,
      contentType: mimeTypeOf(entry.name),
      sizeBytes: entry.stats.size,
      body: Readable.toWeb(createReadStream(absolutePath)) as ReadableStream<Uint8Array>,
    };
  }

  private ready(): AdapterContext {
    if (!this.context)
      throw new AdapterError({ code: "ADAPTER_UNAVAILABLE", message: "Der Adapter ist nicht aktiv.", retryable: false });
    return this.context;
  }

  private notFound(id: string, extra: Record<string, unknown> = {}): AdapterError {
    return new AdapterError({ code: "NOT_FOUND", message: "Datei nicht gefunden.", retryable: false, details: { id, ...extra } });
  }

  private resolveEntry(id: string): NativeFileEntry | undefined {
    // The id is a hash and the only client input: without a valid id shape there is nothing to resolve.
    if (!/^file_[0-9A-Za-z]{26}$/.test(id)) return undefined;
    return this.scan().get(id);
  }

  private scan(): Map<string, NativeFileEntry> {
    const entries = new Map<string, NativeFileEntry>();
    let base: string;
    try {
      base = realpathSync(resolve(this.dataDir()));
    } catch {
      return entries;
    }
    let count = 0;
    const walk = (root: NativeFileRoot, rootReal: string, dir: string, segments: string[]): void => {
      if (count >= MAX_SCAN_ENTRIES || segments.length >= MAX_SCAN_DEPTH) return;
      for (const dirent of listDirectory(dir)) {
        if (count >= MAX_SCAN_ENTRIES) return;
        // Symlinks (files and folders) are never followed: they could point outside the data dir.
        if (dirent.isSymbolicLink()) continue;
        const absolutePath = join(dir, dirent.name);
        if (dirent.isDirectory()) {
          walk(root, rootReal, absolutePath, [...segments, dirent.name]);
          continue;
        }
        if (!dirent.isFile()) continue;
        if (dirent.name.startsWith(".") || dirent.name.endsWith(".partial")) continue;
        if (!root.extensions.includes(extname(dirent.name).toLowerCase())) continue;
        let stats: Stats;
        try {
          stats = lstatSync(absolutePath);
        } catch {
          continue;
        }
        // A hard link has no path of its own that could be checked; it may share its content with a file outside the root.
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) continue;
        let realFile: string;
        try {
          realFile = realpathSync(absolutePath);
        } catch {
          continue;
        }
        if (!realFile.startsWith(rootReal + sep)) continue;
        count += 1;
        const relativePosixPath = [...segments, dirent.name].join("/");
        const id = fileIdOf(root.key, relativePosixPath);
        entries.set(id, { id, root, absolutePath, relativePosixPath, name: dirent.name, stats });
      }
    };
    for (const root of this.roots) {
      if (count >= MAX_SCAN_ENTRIES) break;
      const rootPath = join(base, ...root.relativePath);
      let rootStats: Stats;
      try {
        rootStats = lstatSync(rootPath);
      } catch {
        continue;
      }
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) continue;
      let rootReal: string;
      try {
        rootReal = realpathSync(rootPath);
      } catch {
        continue;
      }
      // A junction/symlink in any intermediate folder would make realpath escape the data dir.
      if (!rootReal.startsWith(base + sep)) continue;
      walk(root, rootReal, rootReal, []);
    }
    return entries;
  }

  // Re-checks path and realpath right before reading, because a file can be swapped between scan and read.
  private readablePath(entry: NativeFileEntry): string {
    try {
      const stats = lstatSync(entry.absolutePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) throw new Error("not a regular file");
      const base = realpathSync(resolve(this.dataDir()));
      const rootReal = realpathSync(join(base, ...entry.root.relativePath));
      if (!rootReal.startsWith(base + sep)) throw new Error("root outside the data dir");
      if (!realpathSync(entry.absolutePath).startsWith(rootReal + sep)) throw new Error("outside the root");
      return entry.absolutePath;
    } catch {
      throw this.notFound(entry.id);
    }
  }

  private displayNameOf(entry: NativeFileEntry): string {
    const fallback = entry.name;
    try {
      const extension = extname(entry.name);
      const directory = entry.absolutePath.slice(0, entry.absolutePath.length - entry.name.length);
      const jsonPath = join(directory, `${basename(entry.name, extension)}.json`);
      const stats = lstatSync(jsonPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > TITLE_JSON_MAX_BYTES) return fallback;
      const parsed: unknown = JSON.parse(readHead(jsonPath, TITLE_JSON_MAX_BYTES).toString("utf8"));
      if (typeof parsed !== "object" || parsed === null) return fallback;
      const title = (parsed as { title?: unknown }).title;
      if (typeof title !== "string") return fallback;
      const trimmed = title.trim();
      if (trimmed.length < 1 || trimmed.length > TITLE_MAX_CHARS) return fallback;
      // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows file names
      return `${trimmed.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()}.pptx`;
    } catch {
      return fallback;
    }
  }

  private toFileItem(entry: NativeFileEntry): FileItem {
    const updatedAt = new Date(entry.stats.mtimeMs).toISOString();
    const birthtimeMs = entry.stats.birthtimeMs;
    const createdAt = birthtimeMs > 0 && birthtimeMs <= entry.stats.mtimeMs
      ? new Date(birthtimeMs).toISOString()
      : updatedAt;
    const dirSegments = entry.relativePosixPath.split("/").slice(0, -1);
    const mimeType = mimeTypeOf(entry.name);
    const name = entry.root.key === "powerpoint" ? this.displayNameOf(entry) : entry.name;
    return {
      id: entry.id,
      version: 1,
      createdAt,
      updatedAt,
      source: { ...sourceOf(updatedAt), externalId: `${entry.root.key}/${entry.relativePosixPath}` },
      name,
      mimeType,
      sizeBytes: entry.stats.size,
      category: entry.root.category,
      currentVersion: 1,
      versions: [{ version: 1, createdAt, sizeBytes: entry.stats.size, createdBy: CREATED_BY }],
      createdBy: CREATED_BY,
      taskId: null,
      location: dirSegments.length ? `${entry.root.label}/${dirSegments.join("/")}` : entry.root.label,
      tags: [entry.root.key],
      previewKind: previewKindOf(mimeType, entry.stats.size),
      lineage: [],
      checksum: null,
    };
  }
}
