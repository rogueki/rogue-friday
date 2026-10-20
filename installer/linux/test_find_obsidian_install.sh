#!/usr/bin/env bash
set -euo pipefail
script=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/find_obsidian_install.sh
fixture=$(mktemp -d -t friday-obsidian-detect-XXXXXXXX)
cleanup() {
  if [[ "$fixture" == /tmp/friday-obsidian-detect-* && -d "$fixture" ]]; then rm -rf -- "$fixture"; fi
}
trap cleanup EXIT
mkdir -p "$fixture/user/.local/bin" "$fixture/portable" "$fixture/system/bin"
printf '#!/bin/sh\nexit 0\n' > "$fixture/user/.local/bin/obsidian"
printf '#!/bin/sh\nexit 0\n' > "$fixture/portable/Obsidian.AppImage"
printf '#!/bin/sh\nexit 0\n' > "$fixture/system/bin/obsidian"
chmod +x "$fixture/user/.local/bin/obsidian" "$fixture/portable/Obsidian.AppImage" "$fixture/system/bin/obsidian"
[[ "$(bash "$script" --candidates "$fixture/system/bin/obsidian")" == "binary:$fixture/system/bin/obsidian" ]]
[[ "$(bash "$script" --candidates "$fixture/missing" "$fixture/portable/Obsidian.AppImage")" == "binary:$fixture/portable/Obsidian.AppImage" ]]
if bash "$script" --candidates "$fixture/missing" "$fixture/portable/empty.AppImage" >/dev/null; then
  echo 'missing or non-executable binary accepted' >&2; exit 1
fi
[[ "$(HOME="$fixture/user" FRIDAY_OBSIDIAN_APP="$fixture/missing" bash "$script")" == "binary:$fixture/user/.local/bin/obsidian" ]]
[[ "$(HOME="$fixture/none" FRIDAY_OBSIDIAN_APP="$fixture/portable/Obsidian.AppImage" bash "$script")" == "binary:$fixture/portable/Obsidian.AppImage" ]]
echo 'PASS Linux Obsidian system/user/portable/missing detection fixtures'
