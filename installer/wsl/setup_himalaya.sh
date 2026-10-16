#!/usr/bin/env bash
set -euo pipefail

version=2.2.1
checksum_x86_64=5c5ba2724c162f82d0a0c71b6c03224ed44f8bef7b14ace5da0635d3af2665a0
checksum_aarch64=1dc21c3dd6d948929e22e5cae49b9d0b3b30ff88fafd4493fd4460c6252e9d90

case "${1:-}" in
  status)
    if [[ -x "$HOME/.local/bin/himalaya" ]]; then
      "$HOME/.local/bin/himalaya" --version
    elif command -v himalaya >/dev/null 2>&1; then
      himalaya --version
    else
      echo 'Himalaya CLI fehlt.'
    fi
    ;;
  install)
    case "$(uname -m)" in
      x86_64) arch=x86_64; checksum=$checksum_x86_64 ;;
      aarch64) arch=aarch64; checksum=$checksum_aarch64 ;;
      *) echo 'Nicht unterstuetzte CPU-Architektur.' >&2; exit 2 ;;
    esac
    for tool in curl sha256sum tar mktemp; do command -v "$tool" >/dev/null || { echo "$tool fehlt." >&2; exit 2; }; done
    mkdir -p "$HOME/.local/bin"
    work=$(mktemp -d)
    trap 'rm -rf -- "$work"' EXIT
    archive="$work/himalaya.tgz"
    url="https://github.com/pimalaya/himalaya/releases/download/v${version}/himalaya.${arch}-linux.tgz"
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 10 --max-time 90 "$url" -o "$archive"
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status || { echo 'Himalaya SHA-256 stimmt nicht.' >&2; exit 3; }
    tar -xOzf "$archive" himalaya > "$work/himalaya"
    chmod 0755 "$work/himalaya"
    [[ "$("$work/himalaya" --version)" == *"$version"* ]] || { echo 'Himalaya-Version stimmt nicht.' >&2; exit 3; }
    mv -f -- "$work/himalaya" "$HOME/.local/bin/himalaya"
    "$HOME/.local/bin/himalaya" --version
    ;;
  *) echo 'Verwendung: setup_himalaya.sh status|install' >&2; exit 2 ;;
esac
