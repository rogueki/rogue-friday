#!/bin/bash
set -euo pipefail
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
PORT="${FRIDAY_STUDIO_PORT:?studio bridge port missing}"
exec python3 "$INST/wsl/configure_studio_bridge.py" "$INST" "$PORT"
