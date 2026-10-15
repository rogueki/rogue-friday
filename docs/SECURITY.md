# Security (F.R.I.D.A.Y. Command Center)

Implements PLAN §32.5, §37.4, §41.4, §42.2, §49, §50.4. Library code: `@jarvis/auth` (identity, sessions, CSRF, approvals),
`@jarvis/config` (loopback guard, secret references), `@jarvis/observability` (redaction, audit hash chain).
The Control API wires these together; the browser never talks to Hermes, voice, mail or any other adapter directly (§49.2).

## 1. Threat model (localhost deployment)

Default: the dashboard listens on `127.0.0.1:3100` only (`server.host`). The `server.allowRemote` flag is the only way to bind
elsewhere (see §8).

| Asset | Threat | Mitigation |
|---|---|---|
| Owner session | Cross-site request forgery from any web page the user visits while the dashboard is open (localhost is reachable from the browser) | `SameSite=Strict` session cookie, CSRF double-submit token bound to the session, `Origin` check on mutating requests, no CORS (same origin) |
| Owner session | XSS stealing the session | `HttpOnly` cookie, strict CSP (`script-src 'self'`), no inline scripts, all untrusted content rendered as text or sandboxed |
| Control API | DNS rebinding (a hostile page resolves its domain to 127.0.0.1) | API validates the `Host` header against `localhost`/`127.0.0.1`/`[::1]` and the configured host; session cookie is host-only |
| Credentials | Password guessing | scrypt (N=2^15, r=8, p=1), `LoginRateLimiter` per username+IP and per IP, generic error messages, dummy hash for unknown users |
| Approvals | Replay or confused-deputy: an approval token reused or applied to another action | Short-lived (120 s) HMAC-signed token binding `approvalId + userId + action + nonce`, single use, final server-side recheck before execution (§32.5) |
| Approvals | Tier-3 action triggered by a voice command | `authorize()` refuses tier 3 on channel `voice`; tier 3 requires owner + fresh password re-auth |
| Secrets | Leak through config, API, logs or SQLite | Secrets only as references (`env:`/`wincred:`); config object contains `{ ref, configured }`; logger redacts by key and value pattern; nothing secret is stored in SQLite |
| Audit trail | Silent edits or deletions | Append-only table + SHA-256 hash chain (`appendToChain`/`verifyChain`) |
| Untrusted files | Script execution from a previewed file | Preview sandboxing (§7) |
| Adapters | Loading arbitrary code | Registry only loads packages listed in the `allowlist` of `adapters.yaml`; built-in mock providers cannot be re-pointed |
| Host machine | Other local users reading `data/` | `auth.key` restricted to the current user (chmod 600 / `icacls`); data dir under the user's control |

Out of scope: a compromised local OS account (it can read the process memory and the key file anyway) and physical access.

## 2. Roles and permission matrix

Roles: `owner`, `operator`, `viewer`. Enforcement is server-side in the Control API via `can(role, action, ctx)` /
`authorize(role, action, ctx)` (`packages/auth/src/permissions.ts`); the UI only hides what the server would refuse.

| Action | viewer | operator | owner |
|---|:-:|:-:|:-:|
| `read:*` (all resources) | yes | yes | yes |
| `tasks.create / update / cancel / retry / pause / resume` | - | yes | yes |
| `agents.pause / resume / stop` | - | yes | yes |
| `approvals.approve` (tier 0-2) | - | yes | yes |
| `approvals.approve` (tier 3) | - | - | yes, with re-auth <= `reauthWindowMinutes`, never via voice |
| `approvals.reject / requestContext` | - | yes | yes |
| `memory.write / delete` | - | yes | yes |
| `communication.draft / requestSend` | - | yes | yes |
| `calendar.propose` | - | yes | yes |
| `automations.create / update / enable / disable / test / pauseAll` | - | yes | yes |
| `files.delete` | - | yes | yes |
| `voice.test / stop` | - | yes | yes |
| `notifications.ack / snooze / resolve` | - | yes | yes |
| `commands.run / stop / pause / resume` | - | yes | yes |
| `system.healthcheck / reconnect / restartAdapter` | - | - | yes |
| `settings.update / import / export` | - | - | yes |
| `adapters.configure` | - | - | yes |
| `audit.export` | - | - | yes |
| `dev.scenarios` | - | - | yes, only when `dev.scenarioConsole` is on |

Notes: `requestSend` only creates an approval; the actual send is gated by `approvals.approve`. `reject` and `requestContext`
never execute anything, so they are not tier-gated. Viewer is strictly read-only (including notifications).

### Approval tiers (PLAN §32)

| Tier | Meaning (examples) | Who may approve | Extra requirement |
|---|---|---|---|
| 0-1 | Low impact, reversible (draft, calendar proposal) | operator, owner | - |
| 2 | External side effects (send mail/message, change event, delete file) | operator, owner | approval token, final recheck |
| 3 | Money, contracts, orders, system changes | owner only | password re-auth within `reauthWindowMinutes`, UI channel only (never voice-only) |

Every decision flows: UI click -> `POST /approvals/{id}/decision` with `Idempotency-Key` + CSRF -> `authorize()` -> approval
token `consume()` (single use) -> state recheck -> execute -> audit event with correlation id.

## 3. Sessions, CSRF, cookies

- **Login**: `verifyPassword` (scrypt, timing-safe) against `JARVIS_OWNER_PASSWORD_HASH` (create with
  `pnpm --filter @jarvis/auth hash-password`; `.env` value must be single-quoted because it contains `$`). Failures feed
  `LoginRateLimiter`; locked keys never reach the password check.
- **Session id**: 32 random bytes (base64url) in the cookie; the server stores only its SHA-256 (`SqliteSessionStore`,
  table `auth_sessions`). Absolute TTL (`sessionTtlMinutes`), idle timeout (`idleTimeoutMinutes`, sliding),
  `reauthAt` for sensitive actions, `revokeAll(userId)` for "logout all" (§49.4).
- **Cookies**: `jarvis_session` = `HttpOnly; SameSite=Strict; Path=/; Max-Age` (+`Secure` when `auth.secureCookies`).
  `jarvis_csrf` = readable (no `HttpOnly`), same flags otherwise.
- **CSRF**: token = `HMAC-SHA256(csrfKey, sessionId)`. The SPA copies the `jarvis_csrf` cookie into `X-CSRF-Token` on every
  mutating request (POST/PUT/PATCH/DELETE). The server checks header == cookie (double submit) **and** header == HMAC of the
  caller's own session id, so a token from another session or a planted cookie fails. `csrfKey` is derived (HKDF) from the
  server key `data/auth.key`, created on first start with owner-only permissions; approval tokens use a different derived key.
- **Dev auth** (`auth.mode: dev`): fixed identities `dev-owner|operator|viewer`; refused unless `dataMode == mock` **and** the
  host is loopback. Enforced in `@jarvis/config` (startup error) and again in `@jarvis/auth` (`DevAuthNotAllowedError`).

## 3a. Offline cache in the browser (PLAN Phase 11, §12.5)

The web app keeps the last read data in `localStorage` (`friday.offlineCache.v1`, `apps/web/src/lib/offlineCache/`) so that a reload while the Control API is
unreachable still shows something, marked `offline-cache` with its age. It is the only data the app persists besides the last event sequence. Rules:

- **Allowlist, not denylist** (`policy.ts`): operational read queries only (overview, status, health, orb, tasks, activity, agents, approvals list/detail, notifications, calendar, automations,
  research, system, voice status/metrics, settings, meta, capabilities). Never persisted: the session (`auth`), approval tokens (`approvals/token`), audit, memory, files, mail threads/drafts,
  command history, adapter settings/logs, enrollment jobs, dev tools. A query whose payload contains a credential-looking property (`*token*`, `csrf*`, `password*`, `*secret*`, `authorization`, `cookie`, `apiKey`, ...) is skipped,
  and the same check runs again when the snapshot is read.
- **Identity** stored with it: `userId`, `role`, `displayName` only (no session id, no CSRF token). It is used only when the API is unreachable (network error, 5xx); a `401` or `authenticated: false` wipes the cache and goes to the login.
  The cookie stays the only credential: nothing is ever sent from the cache.
- **Versioned and capped:** format version + contract version (a different one discards the snapshot), max. 900 000 characters in total, 200 000 per entry (larger entries are skipped, not truncated), entries older than 7 days are dropped;
  a failing or full storage means "no cache", never an error.
- **Cleared** on logout, logout-all, a rejected session (401), and when another user signs in (previous user's queries are removed from memory too).
- **Honest labelling:** restored envelopes get `freshness.state = "offline-cache"` with `asOf` = the time the data was fetched; a successful refetch replaces them. While offline a banner (`offline-cache-banner`) says so and the read-only data is shown;
  recovery is automatic (the session query retries every 10 s, then all queries are refetched).
- **Limit:** the page itself is served by the Control API. A reload with the whole process down cannot load the app shell (no service worker); the cache covers an unreachable API behind an already loadable shell
  (browser cache, restart of the API while the page is open, blocked `/api`). Evidence: `apps/web/src/lib/offlineCache/offlineCache.test.ts`, `tests/e2e/offline-cache.spec.ts`.
- On a shared computer the stored data is readable by anybody who can open the browser profile; log out to remove it.

## 4. Content Security Policy

The Control API sends on every HTML response (and API responses, harmlessly):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
connect-src 'self' ws: wss:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`,
`X-Frame-Options: DENY` (legacy), and `Strict-Transport-Security` when TLS is in front.

Why `style-src 'unsafe-inline'`: React sets the `style` attribute for computed values (orb sizing, panel clip-paths, motion
values, CSS custom properties from the theme engine) and Next's static export injects style tags. Inline *styles* cannot run
code; the risk they add (CSS-based data exfiltration / UI redress) is low here because no secrets live in the DOM and framing
is blocked. **Scripts stay strict**: `script-src 'self'` means no inline scripts, no `eval`, no third-party hosts; the Next
export must therefore be built without inline bootstrap scripts (use hashed/external chunks - verify in Phase 12; if Next
emits inline scripts, add per-build `sha256-` hashes to `script-src`, never `'unsafe-inline'`).

Other directives: `connect-src ws: wss:` covers the same-origin event socket (`/api/v1/events`); `worker-src blob:` is for
the Three.js/Orb worker; `img-src data: blob:` for generated textures and file previews; `frame-ancestors 'none'` and
`base-uri 'none'` close clickjacking and base-tag injection; `form-action 'self'` limits form posts.

## 5. Secrets

- Only server-side; never in the browser (the only persistent browser storage is the allowlisted offline cache, §3a), mock data, SQLite or logs (§49.6).
- Configuration refers to secrets as `env:NAME` or `wincred:TARGET`. `loadConfig` turns them into
  `{ ref, configured }`; the value is fetched on demand by `resolveSecret(ref)` which returns a `SecretValue` (prints as
  `[SECRET]`, `.reveal()` is explicit).
- `wincred:` uses the PowerShell `CredentialManager` module (`Get-StoredCredential`). It is not installed by default
  (`Install-Module CredentialManager`); without it the result is `WINCRED_UNAVAILABLE` with an actionable message. The target
  name is passed via an environment variable, never interpolated into the script, and restricted to a safe character set.
- Credential-looking adapter fields (`token`, `password`, `apiKey`, `secret`, `authorization`, ...) must be references;
  literals and `${VAR}` interpolation are rejected at load time. The browser receives adapter settings schemas with
  secret fields masked and only the `configured` flag (§42.2); "Test connection" runs server-side.
- `.env` is git-ignored; `.env.example` holds names only. `MEMORY.md`, `SCOPE.md`, `AGENTS.md`, `CLAUDE.md` etc. are excluded
  from deployments (see `.gitignore` / deploy ignore rules).

## 6. Logging, redaction, audit

- **Logs** (§50.2): JSON lines `{time, level, service, correlationId, message, ...}`; every user action has a `corr_` id that
  is passed to adapters, tasks, tools, audit and events (`runWithCorrelation`, header `X-Correlation-Id`, inbound ids are
  sanitised).
- **Redaction** (§50.4) is applied automatically by the logger: key patterns (`password`, `secret`, `token`, `apiKey`,
  `authorization`, `cookie`, `pin`, `iban`, `credential`, `privateKey`, ...), value patterns (Bearer/Basic, JWT, URL
  credentials, vendor key prefixes, long hex/base64 blobs) and, by policy `logging.redactEmails`, e-mail addresses.
  Hash-like fields (`hash`, `prevHash`, `etag`, ...) are exempt from value patterns so audit hashes stay readable.
- **Audit**: append-only table, each row `hash = SHA256(prevHash + "\n" + canonicalJson(event))` with sorted keys
  (§41.4). `verifyChain()` pinpoints the first modified, reordered or deleted row. Run it on startup and on `audit.export`;
  anchor the head hash periodically (backup, off-box) to detect truncation of the newest rows.

## 7. File preview sandboxing (§37.4)

Files in the Files module are untrusted.

1. Serve previews only through the Control API (`/api/v1/files/{id}/preview`), never from a path the browser can guess.
2. Always send `Content-Disposition: attachment` for downloads; previews use a conservative allowlist of types
   (images, plain text, PDF). Detect the type from content, not the extension; send `X-Content-Type-Options: nosniff`.
3. HTML, SVG, XML and Office formats are **not** rendered inline: show extracted text or a rasterised thumbnail generated
   server-side. If a rendered HTML preview is ever required, use `<iframe sandbox>` **without** `allow-scripts` and
   `allow-same-origin`, and serve it with `Content-Security-Policy: sandbox; default-src 'none'`.
4. PDFs render in a worker/pdf.js with scripting disabled, or as images.
5. Size and page limits, no external fetches during preview, no automatic opening of links inside previews.
6. Deleting a file is `files.delete` and (by default) goes through an approval for non-trivial paths.

## 8. Remote access (§49.7)

Not supported by default. If the dashboard must be reached from outside:

- Set `server.allowRemote: true` explicitly. `loadConfig` then emits the warning that TLS or VPN/zero-trust is mandatory
  and `config.remoteAccess === true`.
- Terminate **TLS** in front (reverse proxy) and set `auth.secureCookies: true`; or reach the host only through a **VPN /
  zero-trust** tunnel (WireGuard, Tailscale, Cloudflare Access). **Never** publish the port directly (no open port forward).
- Keep the login rate limit and lockout on; consider an additional IP allowlist at the proxy.
- `auth.mode: dev` and the scenario console must be off (dev auth is refused automatically for non-loopback).
- Re-check the `Host`/`Origin` allowlist for the public hostname.

## 9. Checklist for Phase 12 (gate: Security Checklist)

Stand 2026-10-15. `[x]` = verified by the named test or command (all run in the Cloud environment, Linux/Chromium). `[ ]` = open, reason
given. Paths are relative to the repo root; the unit/API suites run with `pnpm test`, the browser checks with
`pnpm exec playwright test tests/e2e/security.spec.ts` (and `offline-cache.spec.ts` for the cache rules of §3a).

Auth and roles
- [x] Login with the scrypt hash works; wrong password and unknown user take similar time and return the same error.
      `packages/auth/src/auth.test.ts` ("round-trips with the documented encoding", "burns a full scrypt computation for an unknown user");
      `apps/control-api/test/security.test.ts` ("rejects a wrong password and an unknown user the same way").
- [x] 5 failed logins per username+IP lock out for the window; success clears the counter.
      `auth.test.ts` (describe "login rate limiter": lock/slide, per username+IP, success clears, username spraying, bounded memory);
      `security.test.ts` ("throttles repeated failures with RATE_LIMITED and Retry-After, even for the right password"); `approvals.test.ts` (re-auth guessing is throttled too).
- [x] Session cookie is `HttpOnly; SameSite=Strict; Path=/` (+`Secure` behind TLS); raw id is not in SQLite.
      `security.test.ts` ("sets HttpOnly, SameSite=Strict cookies and a readable CSRF cookie"); `security-gate.test.ts` ("adds Secure and HSTS when auth.secureCookies is on, and omits both on plain localhost");
      `auth.test.ts` ("SqliteSessionStore persistence ... never stores the raw id"); browser: `tests/e2e/security.spec.ts` ("session cookie is HttpOnly + SameSite=Strict + Path=/ and invisible to scripts").
      Behaviour on localhost: over plain `http://127.0.0.1` the cookie is not `Secure` (it would still be accepted by Chromium, but `secureCookies` is meant for TLS in front, §8).
- [x] Idle timeout, absolute TTL and "logout all" invalidate sessions; WebSocket connections of revoked sessions are closed.
      `security.test.ts` ("expires idle sessions and sessions beyond their absolute lifetime", "logout-all revokes every session of the user (and only of that user)");
      `apps/control-api/test/realtime.test.ts` ("closes the socket with 4401 when the session logs out", "closes all sockets of the user on logout-all").
- [x] Every mutating route calls `authorize()`; the permission matrix test covers each route; viewer cannot mutate.
      `security.test.ts` (describe "role matrix": "denies every operation to roles below its required role with FORBIDDEN (all mutating and privileged operations)", "lets operators work but not change settings; viewers are read-only"); `auth.test.ts` (describe "permission matrix").
- [x] `dev` auth cannot be enabled with `hybrid`/`live` or a non-loopback host (startup fails).
      `packages/config/src/config.test.ts` ("only allows dev auth with mock mode on loopback"); `auth.test.ts` ("refuses hybrid/live and non-loopback hosts");
      `security.test.ts` ("refuses dev auth outside mock data mode": the Control API does not start).

CSRF, CSP, transport
- [x] Mutating requests without/with wrong/foreign-session `X-CSRF-Token` return `403 CSRF_INVALID`.
      `security.test.ts` (describe "CSRF": missing/wrong token, token of another session, header != cookie, safe methods exempt).
- [x] `Origin`/`Host` validated; no permissive CORS; DNS-rebinding request with a foreign `Host` is rejected.
      `security.test.ts` ("refuses a foreign Origin on mutations and a foreign Host header"); `static.test.ts` ("rejects a foreign Host header for static files as well");
      `security-gate.test.ts` ("no permissive CORS": no `Access-Control-*` header, also for a preflight); live server: `tests/e2e/security.spec.ts` ("a foreign Host header and a foreign Origin are refused by the live server").
- [x] CSP header present exactly as in §4; browser console shows no violations on all pages; no inline scripts in the static export (or hashed); framing the app from another origin fails.
      `static.test.ts` (CSP with the per-file `sha256-` hashes, no `unsafe-eval`, no `unsafe-inline` in `script-src`); `tests/e2e/security.spec.ts` ("the CSP is delivered exactly as specified and no page triggers a violation": all 17 routes, `securitypolicyviolation` + console),
      ("the static export has no inline script outside the hashed bootstrap"), ("the app cannot be framed by another origin"). The Next export does emit an inline bootstrap script; it is covered by its hash (never `unsafe-inline`).
- [x] Default bind is `127.0.0.1`; `allowRemote` without TLS/VPN documented and warned.
      `config.test.ts` ("works without any file and yields a safe mock configuration", "refuses a non-loopback host unless allowRemote is true", "accepts remote hosts with allowRemote and records the TLS/VPN requirement": warning "auth.secureCookies is false"); §8.

Approvals
- [x] Tier-3 approval without fresh re-auth, as operator, or via voice is refused with the right error code.
      `apps/control-api/test/approvals.test.ts` (describe "tier 3": "is reserved to the owner", "requires a fresh re-authentication (REAUTH_REQUIRED) ...", "is never possible on the voice channel", "lets the re-authentication window run out"); browser: `tests/e2e/approvals.spec.ts` (tier 3 with re-authentication).
- [x] Approval token: expires after 120 s, single use (also across restart), bound to approval/user/action.
      `auth.test.ts` (describe "approval tokens": TTL, bindings, forged tokens, "single use also holds with the SQLite nonce store across service instances"); `approvals.test.ts` ("makes the token single-use", "binds the token to the user that opened the approval", "lets a token expire").
- [x] Final recheck of approval state and permissions immediately before execution; idempotency key replays the stored result.
      `approvals.test.ts` ("refuses a second approve of the same approval with 409", "rejects an approve against a stale version with 409", "refuses to approve an approval that has expired in the world");
      `apps/control-api/test/contract-gaps.test.ts` (`Idempotent-Replayed: true` on a repeated critical POST), `observability.test.ts` (cache hit on the replay).
- [x] Every decision, denial and execution is audited with `correlationId`.
      `apps/control-api/test/audit.test.ts` ("records who did what: actor, action, result and correlation id of the request", "records denied attempts (403) and failed requests"); `approvals.test.ts` ("... audits the decision").

Secrets and data
- [x] No secret in `config` JSON, API responses, SQLite, logs, error messages, or the browser bundle (grep build output).
      `apps/control-api/test/secrets.test.ts` (read endpoints, responses/headers, audit rows, event stream, logs incl. rejected logins, settings database, stack traces); `packages/config/src/config.test.ts` (describe "secrets");
      browser bundle: `security-gate.test.ts` ("contains no secret material, server paths or credentials": scans `apps/web/out`; runs after `pnpm build:app`) and ("only the MSW switch is a public build variable").
- [x] `auth.key` has owner-only permissions; losing it only invalidates CSRF/approval tokens, not stored data.
      Permissions: `auth.test.ts` ("generates the key once, persists it and restricts the file", "tightens the permissions of an existing, too open key file on every load"; POSIX `chmod 600`).
      Key loss: `security-gate.test.ts` (describe "server key loss"). **Gap found and fixed:** the audit head anchors are HMACs under a key derived from `auth.key`, so a regenerated key made the audit trail
      report `anchor_tampered`. `AuditStore.reanchorAfterKeyLoss()` (called from `create-runtime.ts` when the key was freshly created) re-seals the anchors, but only when the chain itself verifies; a really tampered chain stays reported.
      Sessions (stored as SHA-256 of the id) and all data stay valid; only the CSRF token (reissued by `GET /auth/session`) and open approval tokens are invalidated.
- [ ] (Windows only) the `icacls` restriction of `auth.key` and the `wincred:` secret store are implemented but cannot be executed in the Cloud environment; check on a Windows 11 device (`docs/ACCEPTANCE.md` §6).
- [x] Adapter settings UI shows masked secret fields and `configured` only; "Test connection" works server-side.
      `secrets.test.ts` ("masks adapter secrets in the settings API: configured flag and hint, never the value", "never returns the secret in the PATCH response, the single-adapter view or the test result"); `apps/control-api/test/adapter-settings.test.ts`.
- [x] `.env`, `data/`, `logs/`, `backups/` and agent metadata files are git-ignored and excluded from deploy artifacts.
      `security-gate.test.ts` (describe "repository hygiene": `git check-ignore` for `.env`, `.env.local`, `data/`, `logs/`, `backups/`, `MEMORY.md`, `SCOPE.md`, `AGENTS.md`, `PROMPT.md`; only `.env.example` tracked;
      the installer step 15 deploys an allowlist (`apps/ packages/ adapters/ scripts/` + named root files), never `CLAUDE.md`, `.env`, `docs/`, `data/`, `logs/`, `backups/`).
      Note: `CLAUDE.md` is deliberately tracked (cloud sessions) but is not part of the deployed set.

Audit and observability
- [x] `verifyChain()` passes on the live audit table; a manually edited row is detected.
      `audit.test.ts` (describe "chain", "tamper detection", "tail truncation (head anchor)": modified, deleted, reordered, edited hash, truncated tail, forged anchor; `/health` reports the state after a restart); `packages/observability/src/observability.test.ts` ("detects tampering, reordering and deletion").
- [x] Redaction tests pass; spot-check real logs for tokens, e-mail addresses (when policy on) and PINs.
      `observability.test.ts` (describe "redaction", "logger"); `secrets.test.ts` ("keeps secrets out of the logs, including rejected login attempts").
      Spot check of the log written by the real built server during the e2e run (`control-api.log` in the e2e data dir): see the note below the list.
- [x] `/metrics` (Prometheus text) and the JSON snapshot are reachable only by owner/operator and contain no PII.
      `apps/control-api/test/observability.test.ts` ("is owner-only and requires a session"): stricter than required, viewer **and** operator get 403. Labels are route templates, adapter ids and event types, never ids of resources, users or content.

Files and adapters
- [x] Preview of HTML/SVG/script-bearing files never executes code (try an XSS fixture).
      `apps/web/src/features/files/files.test.tsx` (`<script>`, `<img onerror>`, `javascript:` links stay text / unlinked; HTML is shown as source text; PDF only in `<iframe sandbox="">`); the download is always `attachment` + `application/octet-stream` + `nosniff` (`contract.test.ts` "lists, previews, downloads and deletes files").
- [x] Only allowlisted adapter packages load; an unknown provider id fails startup with a clear error.
      `config.test.ts` ("enforces the allowlist and protects built-in mock providers": `"rogue-tasks" is not in the adapter allowlist`, mock providers cannot be re-pointed, path-like package names rejected); `apps/control-api/test/real-adapters.test.ts` (describe "allowlist wiring").
- [x] `npm audit` / `pnpm audit` reviewed; lockfile committed; no new dependency without justification.
      `pnpm audit` (2026-10-15): `--prod` reports no known vulnerabilities; the full tree reports 1 low advisory (GHSA-g7r4-m6w7-qqqr, esbuild dev server on Windows, via `tsup`): build tool only, the esbuild dev server is never started
      and the production process does not contain esbuild; accepted until `tsup` allows esbuild >= 0.28.1. `pnpm-lock.yaml` is committed. This phase adds no new dependency (the offline cache uses `localStorage` directly).

### Other rules verified in this phase

- **Log spot check (2026-10-15):** the structured log (`logs/jarvis.log`, 188 lines) and stdout log of the built server after the offline/security/mobile e2e runs (dev logins, foreign Host/Origin probes, approvals, scenario control) were searched with
  `grep -ciE "bearer |csrf|jarvis_session|\"password\"|@[a-z0-9-]+\.[a-z]{2,}|approvalToken|x-approval"`: 0 hits. PIN patterns do not occur in the mock data; the redaction rules cover them (`observability.test.ts`).

- **Static file traversal:** `static.test.ts` (inject) and `security-gate.test.ts` (real socket, raw request lines with `..`, `%2e%2e`, `%2f`, backslashes, double encoding): nothing outside the web root is served.
  A symlink inside the web root is not specially handled (the export contains none); keep the web root free of untrusted links.
- **Offline cache (§3a):** see the dedicated section.

### Open points

- Windows-only checks (see above: `icacls`, `wincred:`, autostart).
- Dev login accepts any non-empty password in mock mode (by design, loopback + mock only); production uses `auth.mode: local`.
- The audit anchors protect against truncation and rewriting by someone without `auth.key`; an attacker with write access to the whole data directory (key included) is out of scope (§1).
