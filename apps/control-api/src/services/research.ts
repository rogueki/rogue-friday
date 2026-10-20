import { createId } from "@friday/observability";
import type { ResearchProject, ResearchSource } from "@friday/sdk";
import { kvGet, kvSet, type Db } from "../db/database";
import { ApiError, notFound, validationFailed } from "../util/errors";

const MAX_SOURCES = 10;
const MAX_RESPONSE_BYTES = 512_000;
const SEARCH_TIMEOUT_MS = 12_000;
export const WIKIPEDIA_SEARCH_URL = "https://en.wikipedia.org/w/rest.php/v1/search/page";

type ProjectRow = {
  id: string;
  owner_id: string;
  request_key: string;
  topic: string;
  mission: string;
  status: "running" | "review" | "failed";
  error_code: string | null;
  provider: "searxng" | "wikipedia";
  created_at: string;
  updated_at: string;
};
type SourceRow = {
  id: string;
  project_id: string;
  title: string;
  url: string;
  domain: string;
  excerpt: string | null;
  created_at: string;
};

function providerUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.href === WIKIPEDIA_SEARCH_URL) return url;
  // The operator selects the service; a research query must never select a network destination.
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;
  // URL resolution must preserve an operator-configured reverse-proxy prefix.
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function cleanWikipediaResult(value: unknown): ReturnType<typeof cleanResult> {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.key !== "string" || typeof item.title !== "string" || item.key.length > 500) return null;
  const key = item.key.trim();
  if (!key || key.includes("/") || key.includes("#")) return null;
  return cleanResult({
    title: item.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}`,
    content: typeof item.excerpt === "string" ? item.excerpt.replace(/<[^>]*>/g, "") : "",
  });
}

function cleanResult(
  value: unknown,
): { title: string; url: string; domain: string; excerpt: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.url !== "string" || typeof item.title !== "string") return null;
  let url: URL;
  try {
    url = new URL(item.url);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 2048)
    return null;
  const title = item.title.trim().slice(0, 300);
  if (!title) return null;
  return {
    title,
    url: url.href,
    domain: url.hostname,
    excerpt: typeof item.content === "string" ? item.content.trim().slice(0, 1000) || null : null,
  };
}

/** A bounded source discovery. Results are search-index snippets, never presented as fetched or verified pages. */
export class ResearchService {
  constructor(
    private readonly db: Db,
    endpoint: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.defaultEndpoint = providerUrl(endpoint);
    // A process that died during the provider request must never silently submit that request again.
    this.db
      .prepare(
        "UPDATE research_projects SET status = 'failed', error_code = 'INTERRUPTED', updated_at = ? WHERE status = 'running'",
      )
      .run(this.now().toISOString());
  }

  private readonly defaultEndpoint: URL | null;

  private endpoint(): URL | null {
    const stored = kvGet(this.db, "research.searxng.endpoint");
    return stored === undefined ? this.defaultEndpoint : providerUrl(stored);
  }

  configuration(): {
    provider: "searxng" | "wikipedia";
    endpoint: string | null;
    configured: boolean;
    version: number;
    maxSources: number;
    timeoutMs: number;
    sourceVerification: "unverified";
  } {
    const endpoint = this.endpoint();
    return {
      provider: endpoint?.href === WIKIPEDIA_SEARCH_URL ? "wikipedia" : "searxng",
      endpoint: endpoint?.href ?? null,
      configured: endpoint !== null,
      version: Number(kvGet(this.db, "research.searxng.version") ?? 1),
      maxSources: MAX_SOURCES,
      timeoutMs: SEARCH_TIMEOUT_MS,
      sourceVerification: "unverified",
    };
  }

  configure(endpoint: string, expectedVersion: number): ReturnType<ResearchService["configuration"]> {
    if (endpoint && !providerUrl(endpoint))
      throw validationFailed(
        "Nur der feste Wikipedia-Suchendpunkt oder ein lokaler SearXNG-HTTP-Endpunkt ist erlaubt.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const version = Number(kvGet(this.db, "research.searxng.version") ?? 1);
      if (expectedVersion !== version)
        throw new ApiError({ code: "CONFLICT", message: "Suchprovider wurde zwischenzeitlich geaendert." });
      kvSet(this.db, "research.searxng.endpoint", endpoint);
      kvSet(this.db, "research.searxng.version", String(version + 1));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.configuration();
  }

  configured(): boolean {
    return this.endpoint() !== null;
  }

  assertConfigured(): void {
    if (!this.endpoint())
      throw new ApiError({
        code: "ADAPTER_UNAVAILABLE",
        message: "Suchprovider ist nicht eingerichtet. Wikipedia oder lokalen SearXNG-Dienst waehlen.",
      });
  }

  private project(row: ProjectRow): ResearchProject {
    const count = (
      this.db.prepare("SELECT COUNT(*) AS n FROM research_sources WHERE project_id = ?").get(row.id) as {
        n: number;
      }
    ).n;
    const source = {
      adapterId: row.provider === "wikipedia" ? "wikipedia-rest" : "local-searxng",
      system: row.provider,
      lastSyncedAt: row.updated_at,
    };
    return {
      id: row.id,
      version: row.status === "running" ? 1 : 2,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source,
      topic: row.topic,
      mission: row.mission,
      status: row.status,
      agentIds: [],
      progress: { mode: row.status === "running" ? "indeterminate" : "none", value: null },
      sourceCount: count,
      findingCount: 0,
      contradictionCount: 0,
      artifactCount: 0,
      resultSummary:
        row.status === "review"
          ? `${count} Suchtreffer als unverifizierte Quellen gespeichert. Seiteninhalt und Aussagen wurden nicht geprueft.`
          : row.status === "failed"
            ? row.error_code === "INTERRUPTED"
              ? "Suche bei einem Neustart unterbrochen; Ergebnis unklar. Keine automatische Wiederholung."
              : row.error_code === "RATE_LIMIT"
                ? "Suchprovider hat das Rate-Limit erreicht. Keine automatische Wiederholung."
                : row.error_code === "JSON_DISABLED"
                  ? "Suchprovider erlaubt keinen JSON-Zugriff. JSON-Format in SearXNG aktivieren."
                  : row.error_code === "TIMEOUT"
                    ? "Suchprovider hat nach zwoelf Sekunden nicht geantwortet. Keine automatische Wiederholung."
                    : "Suchprovider hat keine verwertbare Antwort geliefert. Keine automatische Wiederholung."
            : null,
      runtimeMs: null,
      costEur: null,
    };
  }

  private source(row: SourceRow): ResearchSource {
    const provider = this.db
      .prepare("SELECT provider FROM research_projects WHERE id = ?")
      .get(row.project_id) as { provider: ProjectRow["provider"] };
    return {
      id: row.id,
      version: 1,
      createdAt: row.created_at,
      updatedAt: row.created_at,
      source: {
        adapterId: provider.provider === "wikipedia" ? "wikipedia-rest" : "local-searxng",
        system: provider.provider,
        lastSyncedAt: row.created_at,
      },
      projectId: row.project_id,
      title: row.title,
      url: row.url,
      domain: row.domain,
      retrievedAt: null,
      relevance: 0,
      reliability: 0,
      supportsStatement: null,
      excerpt: row.excerpt,
      status: "queued",
    };
  }

  get(ownerId: string, id: string): ResearchProject {
    const row = this.db
      .prepare("SELECT * FROM research_projects WHERE owner_id = ? AND id = ?")
      .get(ownerId, id) as ProjectRow | undefined;
    if (!row) throw notFound("Rechercheprojekt", id);
    return this.project(row);
  }

  count(ownerId: string, q?: string): number {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS n FROM research_projects WHERE owner_id = ? AND (? = '' OR topic LIKE ? ESCAPE '\\')",
        )
        .get(ownerId, q ?? "", `%${(q ?? "").replace(/[\\%_]/g, "\\$&")}%`) as { n: number }
    ).n;
  }

  list(ownerId: string, q?: string, limit = 50, offset = 0): ResearchProject[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM research_projects WHERE owner_id = ? AND (? = '' OR topic LIKE ? ESCAPE '\\') ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      )
      .all(
        ownerId,
        q ?? "",
        `%${(q ?? "").replace(/[\\%_]/g, "\\$&")}%`,
        Math.min(Math.max(limit, 1), 200),
        offset,
      ) as ProjectRow[];
    return rows.map((row) => this.project(row));
  }

  sources(ownerId: string, id: string, limit = 200): ResearchSource[] {
    this.get(ownerId, id);
    return (
      this.db
        .prepare("SELECT * FROM research_sources WHERE project_id = ? ORDER BY created_at, id LIMIT ?")
        .all(id, Math.min(Math.max(limit, 1), 200)) as SourceRow[]
    ).map((row) => this.source(row));
  }

  async create(
    ownerId: string,
    topic: string,
    requestKey: string,
    providerVersion: number,
  ): Promise<ResearchProject> {
    const normalized = topic.trim();
    if (normalized.length < 3 || normalized.length > 500)
      throw validationFailed("Recherchethema muss 3 bis 500 Zeichen lang sein.");
    const existing = this.db
      .prepare("SELECT * FROM research_projects WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, requestKey) as ProjectRow | undefined;
    if (existing) {
      if (existing.topic !== normalized)
        throw new ApiError({
          code: "CONFLICT",
          message: "Der Wiederholungsschluessel gehoert zu einem anderen Recherchethema.",
        });
      return this.project(existing);
    }
    const config = this.configuration();
    if (!config.configured) this.assertConfigured();
    if (config.version !== providerVersion)
      throw new ApiError({ code: "CONFLICT", message: "Suchprovider wurde seit der Vorschau geaendert." });
    const id = createId("rsp");
    const timestamp = this.now().toISOString();
    try {
      this.db
        .prepare(
          "INSERT INTO research_projects (id, owner_id, request_key, topic, mission, status, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)",
        )
        .run(id, ownerId, requestKey, normalized, normalized, config.provider, timestamp, timestamp);
    } catch {
      const raced = this.db
        .prepare("SELECT * FROM research_projects WHERE owner_id = ? AND request_key = ?")
        .get(ownerId, requestKey) as ProjectRow | undefined;
      if (raced) return this.project(raced);
      throw new ApiError({ code: "INTERNAL", message: "Rechercheauftrag konnte nicht gespeichert werden." });
    }
    const endpoint =
      config.provider === "wikipedia" ? new URL(WIKIPEDIA_SEARCH_URL) : new URL("search", config.endpoint!);
    endpoint.searchParams.set("q", normalized);
    if (config.provider === "wikipedia") endpoint.searchParams.set("limit", String(MAX_SOURCES));
    else endpoint.searchParams.set("format", "json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    let sources: Array<NonNullable<ReturnType<typeof cleanResult>>>;
    try {
      const response = await this.fetcher(endpoint, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "FridayResearch/1.0 (https://github.com/rogueki/rogue-friday)",
        },
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "JSON_DISABLED"
            : response.status === 429
              ? "RATE_LIMIT"
              : "PROVIDER_ERROR",
        );
      if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES)
        throw new Error("RESPONSE_TOO_LARGE");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("PROVIDER_ERROR");
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("RESPONSE_TOO_LARGE");
        }
        chunks.push(Buffer.from(value));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = JSON.parse(body) as { results?: unknown; pages?: unknown };
      const items = config.provider === "wikipedia" ? parsed.pages : parsed.results;
      if (!Array.isArray(items)) throw new Error("provider_shape");
      const unique = new Set<string>();
      sources = items
        .map(config.provider === "wikipedia" ? cleanWikipediaResult : cleanResult)
        .filter((source) => {
          if (!source || unique.has(source.url) || unique.size >= MAX_SOURCES) return false;
          unique.add(source.url);
          return true;
        }) as Array<NonNullable<ReturnType<typeof cleanResult>>>;
    } catch (error) {
      const code =
        error instanceof Error && error.name === "AbortError"
          ? "TIMEOUT"
          : error instanceof Error &&
              ["JSON_DISABLED", "RATE_LIMIT", "RESPONSE_TOO_LARGE", "PROVIDER_ERROR"].includes(error.message)
            ? error.message
            : "PROVIDER_ERROR";
      this.db
        .prepare(
          "UPDATE research_projects SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?",
        )
        .run(code, this.now().toISOString(), id);
      return this.get(ownerId, id);
    } finally {
      clearTimeout(timer);
    }
    this.db.exec("BEGIN");
    try {
      for (const source of sources) {
        this.db
          .prepare(
            "INSERT INTO research_sources (id, project_id, title, url, domain, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            createId("src"),
            id,
            source.title,
            source.url,
            source.domain,
            source.excerpt,
            this.now().toISOString(),
          );
      }
      this.db
        .prepare("UPDATE research_projects SET status = 'review', updated_at = ? WHERE id = ?")
        .run(this.now().toISOString(), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(ownerId, id);
  }
}
