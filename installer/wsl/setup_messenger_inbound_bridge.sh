#!/bin/bash
set -euo pipefail
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
PORT="${FRIDAY_MEMORY_PORT:?messenger bridge port missing}"
exec python3 "$INST/wsl/configure_messenger_inbound_bridge.py" "$INST" "$PORT"
