#!/bin/bash
# SessionStart hook: prepares a Claude Code cloud session. Local sessions exit immediately.
set -u

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}" || exit 0

# node:sqlite without a flag needs Node >= 22.13; the cloud image ships 20/21/22 under /opt.
node_ok() {
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}
if ! node_ok && [ -x /opt/node22/bin/node ]; then
  export PATH="/opt/node22/bin:$PATH"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo 'export PATH="/opt/node22/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi
node_ok || echo "cloud-setup: WARNING Node $(node -v) < 22.13 — node:sqlite (control-api) needs 22.13+" >&2

# Use the pnpm version pinned in package.json when corepack is available.
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

# Skip the install when the lockfile has not changed since the last successful install.
stamp="node_modules/.cloud-setup-lock-hash"
lock_hash="$(sha256sum pnpm-lock.yaml 2>/dev/null | cut -d' ' -f1)"
if [ -d node_modules ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$lock_hash" ]; then
  echo "cloud-setup: dependencies up to date"
else
  if pnpm install --frozen-lockfile; then
    echo "$lock_hash" > "$stamp"
  else
    echo "cloud-setup: pnpm install failed — run it manually and check the output" >&2
  fi
fi

# Playwright browser for screenshots/E2E; non-fatal because the download host may not be allowlisted.
if [ ! -d "${HOME}/.cache/ms-playwright" ]; then
  pnpm exec playwright install chromium >/dev/null 2>&1 \
    || echo "cloud-setup: Playwright Chromium download failed (network allowlist?) — see CLAUDE.md" >&2
fi

exit 0
