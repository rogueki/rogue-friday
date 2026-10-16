#!/bin/bash
# Read-only prerequisite inventory. Discovery never means provider/account readiness.
set -u
for spec in 'PowerPoint renderer:libreoffice' 'OpenCode CLI:opencode' 'Codex CLI:codex' 'Claude CLI:claude'; do
    label="${spec%%:*}"; executable="${spec#*:}"
    if [ "$executable" = libreoffice ] && ! command -v libreoffice >/dev/null 2>&1 && command -v soffice >/dev/null 2>&1; then
        executable=soffice
    fi
    if command -v "$executable" >/dev/null 2>&1; then
        printf 'FOUND %s: %s (execution not tested)\n' "$label" "$(command -v "$executable")"
    else
        printf 'MISSING %s: %s not executable in WSL\n' "$label" "$executable"
    fi
done
if [ -n "${FRIDAY_COMPUTER_USE_DRIVER:-}" ] && command -v "$FRIDAY_COMPUTER_USE_DRIVER" >/dev/null 2>&1; then
    printf 'FOUND Computer use driver: %s (execution not tested)\n' "$(command -v "$FRIDAY_COMPUTER_USE_DRIVER")"
else
    echo 'UNKNOWN Computer use driver: no verified driver configured in WSL'
fi
if [ -n "${FRIDAY_TELEPHONY_COMMAND:-}" ] && command -v "$FRIDAY_TELEPHONY_COMMAND" >/dev/null 2>&1; then
    printf 'FOUND Optional telephony command: %s (provider/account not tested)\n' "$(command -v "$FRIDAY_TELEPHONY_COMMAND")"
else
    echo 'NOT_CONFIGURED Optional telephony: no verified command configured in WSL'
fi
