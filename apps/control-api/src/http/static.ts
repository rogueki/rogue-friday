import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { contentSecurityPolicy } from "../security/guards";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".webmanifest": "application/manifest+json",
};

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/** SHA-256 CSP hashes of the executable inline scripts of an HTML document (Next's static export bootstraps inline). */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const attributes = match[1] ?? "";
    const content = match[2] ?? "";
    if (/\bsrc\s*=/.test(attributes) || content.trim() === "") continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase();
    if (type && !["text/javascript", "module", "application/javascript"].includes(type)) continue; // data blocks never execute
    hashes.add(`sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`);
  }
  return [...hashes];
}

interface CachedHtml {
  mtimeMs: number;
  body: Buffer;
  csp: string;
}

/**
 * Serves the static web export (`apps/web/out`) with route resolution: `/tasks` -> `tasks.html` -> `tasks/index.html`; unknown
 * page routes answer 404 with the exported `404.html`. Never reached for `/api/*`, never escapes the web root.
 */
export class StaticWeb {
  private readonly root: string;
  private readonly htmlCache = new Map<string, CachedHtml>();

  constructor(webRoot: string) {
    this.root = resolve(webRoot);
  }

  get available(): boolean {
    return existsSync(join(this.root, "index.html"));
  }

  private resolveFile(urlPath: string): { file: string; status: number } | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    if (decoded.includes("\0")) return null;
    const relative = normalize(decoded).replace(/^[\\/]+/, "");
    const target = resolve(this.root, relative);
    if (target !== this.root && !target.startsWith(this.root + sep)) return null;

    const isFile = (path: string): boolean => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    };
    const candidates = [target, `${target}.html`, join(target, "index.html")];
    const hit = candidates.find(isFile);
    if (hit) return { file: hit, status: 200 };
    // Assets (anything with an extension) must exist; an unknown page route gets the exported 404 page (never the overview).
    if (extname(decoded) !== "") return null;
    const notFound = join(this.root, "404.html");
    if (isFile(notFound)) return { file: notFound, status: 404 };
    const shell = join(this.root, "index.html");
    return isFile(shell) ? { file: shell, status: 404 } : null;
  }

  handle(request: FastifyRequest, reply: FastifyReply): void {
    const path = new URL(request.url, "http://localhost").pathname;
    const resolved = this.resolveFile(path);
    if (!resolved) {
      reply.status(404).header("Content-Type", "text/plain; charset=utf-8");
      reply.send(this.available ? "Nicht gefunden." : "Die Web-Oberfläche ist nicht gebaut (pnpm --filter @jarvis/web build).");
      return;
    }
    const { file, status } = resolved;
    reply.status(status);
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    reply.header("Content-Type", type);
    if (extname(file) === ".html") {
      const cached = this.html(file);
      reply.header("Cache-Control", "no-cache");
      reply.header("Content-Security-Policy", cached.csp);
      reply.send(request.method === "HEAD" ? "" : cached.body);
      return;
    }
    reply.header("Cache-Control", /[\\/]_next[\\/]static[\\/]/.test(file) ? "public, max-age=31536000, immutable" : "public, max-age=300");
    reply.send(createReadStream(file));
  }

  private html(file: string): CachedHtml {
    const mtimeMs = statSync(file).mtimeMs;
    const cached = this.htmlCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    const body = readFileSync(file);
    const entry = { mtimeMs, body, csp: contentSecurityPolicy(inlineScriptHashes(body.toString("utf8"))) };
    this.htmlCache.set(file, entry);
    return entry;
  }
}
