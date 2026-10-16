#!/bin/bash
# Read-only prerequisite inventory. Discovery never means provider/account readiness.
set -u
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if command -v python >/dev/null 2>&1 && python -c 'import pptx' >/dev/null 2>&1; then
    echo 'RUNNABLE PowerPoint library: python imports python-pptx in WSL (deck workflow not tested)'
else
    echo 'MISSING PowerPoint library: python cannot import python-pptx in WSL'
fi
for spec in 'PowerPoint renderer:libreoffice' 'PDF preview:pdftoppm'; do
    label="${spec%%:*}"; executable="${spec#*:}"
    if [ "$executable" = libreoffice ] && ! command -v libreoffice >/dev/null 2>&1 && command -v soffice >/dev/null 2>&1; then
        executable=soffice
    fi
    if command -v "$executable" >/dev/null 2>&1; then
        resolved="$(command -v "$executable")"
        printf 'FOUND %s: %s (rendering not tested)\n' "$label" "$resolved"
    else
        printf 'MISSING %s: %s not executable in WSL\n' "$label" "$executable"
    fi
done
coding_setup="$(dirname "$0")/setup_coding_cli.sh"
if [ -f "$coding_setup" ]; then
    bash "$coding_setup" status
else
    echo 'UNKNOWN Coding CLI readiness: installer setup_coding_cli.sh missing'
fi
if [ -n "${OBSIDIAN_VAULT_PATH:-}" ] && [ -d "$OBSIDIAN_VAULT_PATH" ] && [ -r "$OBSIDIAN_VAULT_PATH" ]; then
    printf 'FOUND Obsidian vault: configured path is readable in WSL (file workflow not tested)\n'
else
    echo 'NOT_CONFIGURED Obsidian vault: OBSIDIAN_VAULT_PATH is absent or unreadable in WSL'
fi
if command -v hermes >/dev/null 2>&1; then
    cua_status="$(timeout 12 hermes computer-use status 2>&1 || true)"
    cua_doctor="$(timeout 15 hermes computer-use doctor 2>&1 || true)"
    if [[ "$cua_status" == *'Runtime contract ready'* && "$cua_doctor" == *'ax_capability: X11 reachable'* && "$cua_doctor" == *'screen_capture_capability: X11 reachable'* ]]; then
        echo 'FOUND Computer use: Hermes Linux driver and current WSLg/X11 session ready (gateway session, Windows desktop, and actual capture not tested)'
    else
        echo 'UNVERIFIED Computer use: Hermes status/doctor did not confirm Linux session and capture prerequisites'
    fi
else
    echo 'UNKNOWN Computer use: Hermes command unavailable for status/doctor'
fi
echo 'UNSUPPORTED Optional telephony: no bundled verified Friday dial adapter; a command or provider alone is insufficient'
