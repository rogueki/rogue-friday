#!/usr/bin/env bash
set -euo pipefail

usable() { [[ -f "$1" && -x "$1" ]]; }

# --candidates keeps fixtures independent of the host's installed applications.
if [[ "${1:-}" == --candidates ]]; then
  shift
  for candidate in "$@"; do
    if usable "$candidate"; then printf 'binary:%s\n' "$candidate"; exit 0; fi
  done
  exit 1
fi

if [[ -n "${FRIDAY_OBSIDIAN_APP:-}" ]] && usable "$FRIDAY_OBSIDIAN_APP"; then
  printf 'binary:%s\n' "$FRIDAY_OBSIDIAN_APP"
  exit 0
fi
for candidate in "${HOME:-}/.local/bin/obsidian" "${HOME:-}/Applications/Obsidian.AppImage" \
    "${HOME:-}/.local/share/applications/Obsidian.AppImage" /opt/Obsidian/obsidian \
    /usr/local/bin/obsidian /usr/bin/obsidian /snap/bin/obsidian; do
  if usable "$candidate"; then printf 'binary:%s\n' "$candidate"; exit 0; fi
done
for candidate in "${HOME:-}/Applications/"Obsidian*.AppImage; do
  if usable "$candidate"; then printf 'binary:%s\n' "$candidate"; exit 0; fi
done
if command -v obsidian >/dev/null 2>&1; then
  candidate=$(command -v obsidian)
  if usable "$candidate"; then printf 'binary:%s\n' "$candidate"; exit 0; fi
fi
if command -v flatpak >/dev/null 2>&1 && flatpak info --show-ref md.obsidian.Obsidian >/dev/null 2>&1; then
  printf 'flatpak:md.obsidian.Obsidian\n'
  exit 0
fi
exit 1
