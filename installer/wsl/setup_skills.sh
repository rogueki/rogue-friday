#!/bin/bash
# Friday procedures are versioned separately; Hermes built-ins stay in Hermes.
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
CHECKOUT="$ROOT/skills/friday-skills"
MODE="${1:-install}"
case "$MODE" in install|status) ;; *) echo 'usage: setup_skills.sh install|status' >&2; exit 2 ;; esac
if [ -L "$ROOT/skills" ] || [ -L "$CHECKOUT" ]; then
    echo 'FRIDAY_SKILLS_ERROR skill target may not be a symlink' >&2; exit 1
fi
if [ "$MODE" = install ]; then
    mkdir -p "$ROOT/skills"
    if [ ! -d "$CHECKOUT/.git" ]; then
        if [ -e "$CHECKOUT" ]; then echo "FRIDAY_SKILLS_ERROR target exists without git: $CHECKOUT" >&2; exit 1; fi
        git clone --depth 1 --branch main https://github.com/rogueki/friday-skills.git "$CHECKOUT"
    else
        [ "$(git -C "$CHECKOUT" remote get-url origin)" = 'https://github.com/rogueki/friday-skills.git' ] || {
            echo 'FRIDAY_SKILLS_ERROR unexpected origin' >&2; exit 1;
        }
        if [ -n "$(git -C "$CHECKOUT" status --porcelain)" ]; then
            echo 'FRIDAY_SKILLS_ERROR local checkout modified; preserving edits' >&2; exit 1
        fi
        # A depth-1 fetch can hide the common ancestor of two normal releases.
        # Deepen the initial shallow clone once so --ff-only can verify ancestry.
        if [ "$(git -C "$CHECKOUT" rev-parse --is-shallow-repository)" = true ]; then
            git -C "$CHECKOUT" fetch --unshallow origin main
        else
            git -C "$CHECKOUT" fetch origin main
        fi
        git -C "$CHECKOUT" merge --ff-only FETCH_HEAD
    fi
fi
PROFILE_MODE=status
if [ "$MODE" = install ]; then PROFILE_MODE=configure; fi
python3 "$INST/wsl/skills_profile.py" "$PROFILE_MODE" "$CHECKOUT"
if [ "$MODE" = install ] && [ -x "$HOME/.local/bin/himalaya" ] &&
   [ -f "$CHECKOUT/scripts/install_hermes_himalaya_v2.py" ]; then
    if ! python3 "$CHECKOUT/scripts/install_hermes_himalaya_v2.py" --apply; then
        echo 'FRIDAY_HIMALAYA_COMPAT_WARNING reviewed Hermes skill overlay was not installed' >&2
    fi
fi
printf 'FRIDAY_SKILLS_COMMIT %s\n' "$(git -C "$CHECKOUT" rev-parse HEAD)"
