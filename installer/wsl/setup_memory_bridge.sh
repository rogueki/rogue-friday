#!/bin/bash
set -euo pipefail
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
INST="${FRIDAY_INSTALLER:-$ROOT/installer}"
PORT="${FRIDAY_MEMORY_PORT:?memory bridge port missing}"
if [ "$#" -eq 0 ]; then
    exec python3 "$INST/wsl/configure_memory_bridge.py" "$INST" "$PORT"
fi
if [ "$#" -eq 2 ] && [[ "$1" == apply || "$1" == rollback ]] && [[ "$2" =~ ^[0-9a-f]{32}$ ]]; then
    exec python3 "$INST/wsl/configure_memory_bridge.py" "$INST" "$PORT" "$1" "$2"
fi
echo "FRIDAY_MEMORY_BRIDGE_ERROR invalid update arguments" >&2
exit 2
