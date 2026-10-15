/**
 * What may be written to the browser's persistent storage (PLAN §12.5, docs/SECURITY.md §5). The offline cache is an
 * allowlist: only read queries of operational data. Everything else (session, CSRF token, approval tokens, audit,
 * mail, memory, files, command history, adapter settings and logs, dev tools) never leaves memory.
 */

/** Query-key roots that may be persisted. */
const ALLOWED_ROOTS: ReadonlySet<string> = new Set([
  "meta",
  "health",
  "capabilities",
  "overview",
  "status",
  "orb",
  "tasks",
  "activity",
  "agents",
  "approvals",
  "notifications",
  "calendar-events",
  "calendar-conflicts",
  "calendar-briefings",
  "automations",
  "research",
  "system",
  "voice",
  "settings",
]);

/** Second key segments that are excluded although the root is allowed. */
const DENIED_SECOND_SEGMENTS: Readonly<Record<string, ReadonlySet<string>>> = {
  // `["approvals","token",id]` holds the single-use X-Approval-Token.
  approvals: new Set(["token"]),
  // Adapter settings (configured flags, endpoints) stay on the server side of the trust boundary.
  settings: new Set(["adapters"]),
  // Enrollment jobs carry biometric progress, not worth keeping.
  voice: new Set(["enrollments"]),
};

/** Property names that mark a payload as unsafe to store; a query containing one is skipped entirely. */
const FORBIDDEN_PROPERTY = /^(csrf.*|.*token|.*secret|password.*|authorization|cookie|sessionid|session_id|apikey|api_key|passphrase|privatekey)$/i;

/** Properties that look like a token by name but are plain data in the contract. */
const HARMLESS_PROPERTY: ReadonlySet<string> = new Set(["nexttoken", "tokencount", "tokensused", "tokens", "maxtokens", "inputtokens", "outputtokens", "totaltokens"]);

export function isPersistableKey(queryKey: readonly unknown[]): boolean {
  const [root, second] = queryKey;
  if (typeof root !== "string" || !ALLOWED_ROOTS.has(root)) return false;
  if (typeof second === "string" && DENIED_SECOND_SEGMENTS[root]?.has(second)) return false;
  return true;
}

const MAX_DEPTH = 24;

/** True when the value (deep) carries a property that looks like a credential. */
export function containsForbiddenProperty(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenProperty(entry, depth + 1));
  for (const [name, entry] of Object.entries(value)) {
    const lowered = name.toLowerCase();
    if (FORBIDDEN_PROPERTY.test(name) && !HARMLESS_PROPERTY.has(lowered)) return true;
    if (containsForbiddenProperty(entry, depth + 1)) return true;
  }
  return false;
}
