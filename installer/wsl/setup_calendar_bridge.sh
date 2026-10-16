#!/bin/bash
set -euo pipefail
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
PORT="${FRIDAY_CALENDAR_PORT:?calendar port missing}"
exec python3 "$INST/wsl/configure_calendar_bridge.py" "$ROOT/skills/friday-skills" "$PORT"
