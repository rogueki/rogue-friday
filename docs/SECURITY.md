# Security (JARVIS Command Center)

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

- Only server-side; never in the browser, mock data, SQLite or logs (§49.6).
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

Auth and roles
- [ ] Login with the scrypt hash works; wrong password and unknown user take similar time and return the same error.
- [ ] 5 failed logins per username+IP lock out for the window; success clears the counter.
- [ ] Session cookie is `HttpOnly; SameSite=Strict; Path=/` (+`Secure` behind TLS); raw id is not in SQLite.
- [ ] Idle timeout, absolute TTL and "logout all" invalidate sessions; WebSocket connections of revoked sessions are closed.
- [ ] Every mutating route calls `authorize()`; the permission matrix test covers each route; viewer cannot mutate.
- [ ] `dev` auth cannot be enabled with `hybrid`/`live` or a non-loopback host (startup fails).

CSRF, CSP, transport
- [ ] Mutating requests without/with wrong/foreign-session `X-CSRF-Token` return `403 CSRF_INVALID`.
- [ ] `Origin`/`Host` validated; no permissive CORS; DNS-rebinding request with a foreign `Host` is rejected.
- [ ] CSP header present exactly as in §4; browser console shows no violations on all pages; no inline scripts in the
      static export (or hashed); framing the app from another origin fails.
- [ ] Default bind is `127.0.0.1`; `allowRemote` without TLS/VPN documented and warned.

Approvals
- [ ] Tier-3 approval without fresh re-auth, as operator, or via voice is refused with the right error code.
- [ ] Approval token: expires after 120 s, single use (also across restart), bound to approval/user/action.
- [ ] Final recheck of approval state and permissions immediately before execution; idempotency key replays the stored result.
- [ ] Every decision, denial and execution is audited with `correlationId`.

Secrets and data
- [ ] No secret in `config` JSON, API responses, SQLite, logs, error messages, or the browser bundle (grep build output).
- [ ] `auth.key` has owner-only permissions; losing it only invalidates CSRF/approval tokens, not stored data.
- [ ] Adapter settings UI shows masked secret fields and `configured` only; "Test connection" works server-side.
- [ ] `.env`, `data/`, `logs/`, `backups/` and agent metadata files are git-ignored and excluded from deploy artifacts.

Audit and observability
- [ ] `verifyChain()` passes on the live audit table; a manually edited row is detected.
- [ ] Redaction tests pass; spot-check real logs for tokens, e-mail addresses (when policy on) and PINs.
- [ ] `/metrics` (Prometheus text) and the JSON snapshot are reachable only by owner/operator and contain no PII.

Files and adapters
- [ ] Preview of HTML/SVG/script-bearing files never executes code (try an XSS fixture).
- [ ] Only allowlisted adapter packages load; an unknown provider id fails startup with a clear error.
- [ ] `npm audit` / `pnpm audit` reviewed; lockfile committed; no new dependency without justification.
