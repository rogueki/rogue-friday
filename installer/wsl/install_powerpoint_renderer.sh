#!/usr/bin/env bash
# Optional system renderer for Hermes' bundled PowerPoint skill.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Run this helper as WSL root.' >&2
    exit 2
fi
if ! command -v apt-get >/dev/null 2>&1; then
    echo 'This optional renderer currently supports Ubuntu/Debian WSL only.' >&2
    exit 2
fi

export DEBIAN_FRONTEND=noninteractive
packages_ready() {
    [ "$(dpkg-query -W -f='${Status}' libreoffice-impress 2>/dev/null)" = 'install ok installed' ] &&
    [ "$(dpkg-query -W -f='${Status}' poppler-utils 2>/dev/null)" = 'install ok installed' ]
}
if command -v soffice >/dev/null 2>&1 && command -v pdftoppm >/dev/null 2>&1 && packages_ready; then
    echo 'FRIDAY_POWERPOINT_RENDERER_READY already installed'
    exit 0
fi

# Bound waits for apt locks and network failures. Never remove existing packages.
timeout 300 apt-get -o DPkg::Lock::Timeout=120 update
timeout 900 apt-get -o DPkg::Lock::Timeout=120 install -y --no-remove --no-install-recommends libreoffice-impress poppler-utils
command -v soffice >/dev/null 2>&1
command -v pdftoppm >/dev/null 2>&1
packages_ready
echo 'FRIDAY_POWERPOINT_RENDERER_READY soffice and pdftoppm available (deck rendering not yet tested)'
