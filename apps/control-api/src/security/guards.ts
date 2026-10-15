import type { IncomingHttpHeaders } from "node:http";
import { isLoopbackHost } from "@friday/auth";
import type { Runtime } from "../runtime/types";

/** CSP exactly as specified in docs/SECURITY.md §4. Hashes of inline bootstrap scripts are added per HTML file. */
export const CSP_BASE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function contentSecurityPolicy(scriptHashes: readonly string[] = []): string {
  if (scriptHashes.length === 0) return CSP_BASE;
  return CSP_BASE.replace("script-src 'self'", `script-src 'self' ${scriptHashes.map((hash) => `'${hash}'`).join(" ")}`);
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=()",
};

const hostnameOf = (hostHeader: string): string => {
  const trimmed = hostHeader.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  return trimmed.split(":")[0] ?? "";
};

export interface RequestGuards {
  /** DNS-rebinding defence: the Host header must name this machine, never an attacker's domain. */
  hostAllowed(headers: IncomingHttpHeaders): boolean;
  /** Cross-site requests: an Origin, when present, must be this origin or a configured trusted origin. */
  originAllowed(headers: IncomingHttpHeaders): boolean;
}

export function createRequestGuards(runtime: Runtime): RequestGuards {
  const { config } = runtime;
  const trustedHostnames = (): Set<string> => {
    const names = new Set(["localhost", "127.0.0.1", "[::1]"]);
    const configured = config.server.host.toLowerCase();
    if (!["0.0.0.0", "::", "[::]"].includes(configured)) names.add(configured.startsWith("[") || !configured.includes(":") ? configured : `[${configured}]`);
    if (config.server.allowRemote) {
      for (const origin of runtime.settings.area("security").trustedOrigins) {
        try {
          names.add(hostnameOf(new URL(origin).host));
        } catch {
          // an unparsable trusted origin simply does not extend the allowlist
        }
      }
    }
    return names;
  };

  const trustedOrigins = (): Set<string> => {
    const origins = new Set<string>();
    for (const origin of runtime.settings.area("security").trustedOrigins) {
      try {
        origins.add(new URL(origin).origin);
      } catch {
        // ignore malformed entries
      }
    }
    return origins;
  };

  return {
    hostAllowed(headers) {
      const host = headers.host;
      if (!host) return false;
      const name = hostnameOf(host);
      return trustedHostnames().has(name) || isLoopbackHost(name.replace(/^\[|\]$/g, ""));
    },
    originAllowed(headers) {
      const origin = headers.origin;
      if (origin === undefined) return true;
      const value = Array.isArray(origin) ? origin[0] : origin;
      if (!value || value === "null") return false;
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return false;
      }
      if (parsed.host.toLowerCase() === String(headers.host ?? "").toLowerCase()) return true;
      return trustedOrigins().has(parsed.origin);
    },
  };
}
