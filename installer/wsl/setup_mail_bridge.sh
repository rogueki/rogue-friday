#!/bin/bash
set -euo pipefail
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
PORT="${FRIDAY_MAIL_PORT:?mail bridge port missing}"
exec python3 "$INST/wsl/configure_mail_bridge.py" "$ROOT/skills/friday-skills" "$PORT"
