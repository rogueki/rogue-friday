#!/bin/bash
# Read-only prerequisite inventory. Discovery never means provider/account readiness.
set -u
if python3 -c 'import pptx' >/dev/null 2>&1; then
    echo 'FOUND PowerPoint library: python-pptx imports in WSL (document export not tested)'
else
    echo 'MISSING PowerPoint library: python-pptx does not import in WSL'
fi
for spec in 'PowerPoint renderer:libreoffice' 'PDF preview:pdftoppm' 'OpenCode CLI:opencode' 'Codex CLI:codex' 'Claude CLI:claude'; do
    label="${spec%%:*}"; executable="${spec#*:}"
    if [ "$executable" = libreoffice ] && ! command -v libreoffice >/dev/null 2>&1 && command -v soffice >/dev/null 2>&1; then
        executable=soffice
    fi
    if command -v "$executable" >/dev/null 2>&1; then
        resolved="$(command -v "$executable")"
        if [[ "$executable" == opencode || "$executable" == codex || "$executable" == claude ]]; then
            if timeout 8 "$resolved" --version >/dev/null 2>&1; then
                printf 'RUNNABLE %s: %s (account and coding task not tested)\n' "$label" "$resolved"
            else
                printf 'UNVERIFIED %s: %s found but --version failed in WSL\n' "$label" "$resolved"
            fi
        else
            printf 'FOUND %s: %s (rendering not tested)\n' "$label" "$resolved"
        fi
    else
        printf 'MISSING %s: %s not executable in WSL\n' "$label" "$executable"
    fi
done
if [ -n "${OBSIDIAN_VAULT_PATH:-}" ] && [ -d "$OBSIDIAN_VAULT_PATH" ] && [ -r "$OBSIDIAN_VAULT_PATH" ]; then
    printf 'FOUND Obsidian vault: configured path is readable in WSL (file workflow not tested)\n'
else
    echo 'NOT_CONFIGURED Obsidian vault: OBSIDIAN_VAULT_PATH is absent or unreadable in WSL'
fi
if [ -n "${FRIDAY_COMPUTER_USE_DRIVER:-}" ] && command -v "$FRIDAY_COMPUTER_USE_DRIVER" >/dev/null 2>&1; then
    printf 'FOUND Computer use driver: %s (execution not tested)\n' "$(command -v "$FRIDAY_COMPUTER_USE_DRIVER")"
else
    echo 'UNKNOWN Computer use driver: no verified driver configured in WSL'
fi
echo 'UNSUPPORTED Optional telephony: no bundled verified Friday dial adapter; a command or provider alone is insufficient'
