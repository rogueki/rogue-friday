#!/bin/bash
# Optional, per-user Linux CLI setup for Hermes coding skills.
set -euo pipefail

NODE_VERSION=24.21.0
NODE_ROOT="$HOME/.local/share/friday/node/v$NODE_VERSION"
NPM_ROOT="$HOME/.local/share/friday/coding-cli/npm"
BIN_ROOT="$HOME/.local/bin"
export PATH="$BIN_ROOT:$NODE_ROOT/bin:$NPM_ROOT/bin:/usr/local/bin:/usr/bin:/bin"

usage() {
    echo 'usage: setup_coding_cli.sh status | install opencode|codex|claude | login codex|claude' >&2
    exit 2
}

native_command() {
    local resolved
    resolved="$(command -v "$1" 2>/dev/null || true)"
    case "$resolved" in
        /*) ;;
        *) return 1 ;;
    esac
    # WSL can inherit Windows npm shims; they cannot serve Hermes' Linux workflow.
    case "$(readlink -f "$resolved" 2>/dev/null || printf '%s' "$resolved")" in /mnt/*) return 1 ;; esac
    printf '%s\n' "$resolved"
}

status() {
    local name resolved version
    for name in opencode codex claude; do
        resolved="$(native_command "$name" || true)"
        if [ -z "$resolved" ]; then
            printf 'MISSING %s: no native Linux executable (account and task unverified)\n' "$name"
        elif version="$(timeout 10 env PATH="$BIN_ROOT:/usr/local/bin:/usr/bin:/bin" "$resolved" --version 2>/dev/null)"; then
            printf 'RUNNABLE %s: %s (account and task unverified)\n' "$name" "${version%%$'\n'*}"
        else
            printf 'UNVERIFIED %s: native executable found but --version failed\n' "$name"
        fi
    done
}

ensure_node() {
    if [ -x "$NODE_ROOT/bin/node" ] && [ -x "$NODE_ROOT/bin/npm" ]; then
        link_node
        return
    fi
    local arch archive url checksum
    case "$(uname -m)" in
        x86_64) arch=x64 ;;
        aarch64) arch=arm64 ;;
        *) echo 'FRIDAY_CLI_ERROR unsupported Linux architecture' >&2; exit 1 ;;
    esac
    archive="node-v$NODE_VERSION-linux-$arch.tar.xz"
    url="https://nodejs.org/dist/v$NODE_VERSION"
    NODE_DOWNLOAD_DIR="$(mktemp -d)"
    trap 'if [ -n "${NODE_DOWNLOAD_DIR:-}" ] && [ -d "$NODE_DOWNLOAD_DIR" ]; then rm -rf -- "$NODE_DOWNLOAD_DIR"; fi' EXIT
    curl --fail --location --silent --show-error --retry 2 "$url/SHASUMS256.txt" -o "$NODE_DOWNLOAD_DIR/SHASUMS256.txt"
    checksum="$(awk -v file="$archive" '$2 == file {print $1}' "$NODE_DOWNLOAD_DIR/SHASUMS256.txt")"
    [ -n "$checksum" ] || { echo 'FRIDAY_CLI_ERROR Node checksum absent' >&2; exit 1; }
    curl --fail --location --silent --show-error --retry 2 "$url/$archive" -o "$NODE_DOWNLOAD_DIR/$archive"
    printf '%s  %s\n' "$checksum" "$NODE_DOWNLOAD_DIR/$archive" | sha256sum --check --status || {
        echo 'FRIDAY_CLI_ERROR Node checksum mismatch' >&2; exit 1;
    }
    mkdir -p "$(dirname "$NODE_ROOT")"
    tar -xJf "$NODE_DOWNLOAD_DIR/$archive" -C "$(dirname "$NODE_ROOT")"
    mv "$(dirname "$NODE_ROOT")/node-v$NODE_VERSION-linux-$arch" "$NODE_ROOT"
    "$NODE_ROOT/bin/node" --version
    link_node
}

link_node() {
    mkdir -p "$BIN_ROOT"
    if [ -e "$BIN_ROOT/node" ] || [ -L "$BIN_ROOT/node" ]; then
        [ "$(readlink "$BIN_ROOT/node" || true)" = "$NODE_ROOT/bin/node" ] || {
            echo "FRIDAY_CLI_ERROR $BIN_ROOT/node already belongs to another installation" >&2; exit 1;
        }
    else
        ln -s "$NODE_ROOT/bin/node" "$BIN_ROOT/node"
    fi
}

mode="${1:-status}"
case "$mode" in
    status) [ "$#" -eq 1 ] || usage; status ;;
    login)
        [ "$#" -eq 2 ] || usage
        case "$2" in codex|claude) ;; *) usage ;; esac
        resolved="$(native_command "$2" || true)"
        [ -n "$resolved" ] || { echo "FRIDAY_CLI_ERROR $2 is not installed natively in Linux" >&2; exit 1; }
        if [ "$2" = codex ]; then
            echo 'ChatGPT-Anmeldung: URL und einmaligen Code nur im eigenen Browser eingeben; Code nicht weitergeben.'
            "$resolved" login --device-auth
            "$resolved" login status
        else
            echo 'Claude-Pro/Max-Anmeldung: Im Browser Claude-Subscription auswaehlen; keine Console-API-Abrechnung.'
            "$resolved" auth login --claudeai
            "$resolved" auth status
        fi
        ;;
    install)
        [ "$#" -eq 2 ] || usage
        case "$2" in
            opencode) package=opencode-ai ;;
            codex) package=@openai/codex ;;
            claude) package=@anthropic-ai/claude-code ;;
            *) usage ;;
        esac
        existing="$(native_command "$2" || true)"
        if [ -n "$existing" ] && timeout 10 env PATH="$BIN_ROOT:/usr/local/bin:/usr/bin:/bin" "$existing" --version >/dev/null 2>&1; then
            printf 'FRIDAY_CLI_READY %s: existing native Linux executable\n' "$2"
            exit 0
        fi
        ensure_node
        mkdir -p "$NPM_ROOT" "$BIN_ROOT"
        # npm's global prefix remains inside this Linux user's profile.
        timeout 300 "$NODE_ROOT/bin/npm" install --global --prefix "$NPM_ROOT" --include=optional --no-audit --no-fund "$package@latest"
        target="$NPM_ROOT/bin/$2"
        [ -x "$target" ] || { echo "FRIDAY_CLI_ERROR $2 package installed without executable" >&2; exit 1; }
        if [ -e "$BIN_ROOT/$2" ] || [ -L "$BIN_ROOT/$2" ]; then
            [ "$(readlink "$BIN_ROOT/$2" || true)" = "$target" ] || {
                echo "FRIDAY_CLI_ERROR $BIN_ROOT/$2 already belongs to another installation" >&2; exit 1;
            }
        else
            ln -s "$target" "$BIN_ROOT/$2"
        fi
        version="$(timeout 10 env PATH="$BIN_ROOT:/usr/local/bin:/usr/bin:/bin" "$BIN_ROOT/$2" --version 2>/dev/null)" || {
            echo "FRIDAY_CLI_ERROR $2 did not pass Linux --version" >&2; exit 1;
        }
        printf 'FRIDAY_CLI_READY %s: %s (account and task unverified)\n' "$2" "${version%%$'\n'*}"
        ;;
    *) usage ;;
esac
