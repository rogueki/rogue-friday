#!/usr/bin/env bash
# Local research provider. Called only as root by the owner-gated Control API.
set -euo pipefail

MODE="${1:-status}"
PORT=43696
IMAGE='ghcr.io/searxng/searxng@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271'
CONFIG_DIR=/var/lib/friday/searxng
UNIT=/etc/systemd/system/friday-searxng.service

[[ "$(id -u)" -eq 0 ]] || { echo 'root_required' >&2; exit 2; }
[[ "$MODE" == status || "$MODE" == install ]] || { echo 'invalid_mode' >&2; exit 2; }

report() {
    local service='absent' http='unavailable' image_verified=false
    if systemctl list-unit-files friday-searxng.service --no-legend 2>/dev/null | grep -q '^friday-searxng.service'; then
        service="$(systemctl is-active friday-searxng.service 2>/dev/null || true)"
    fi
    if command -v podman >/dev/null 2>&1 && podman container exists friday-searxng 2>/dev/null; then
        local running_image pinned_image
        running_image="$(podman container inspect --format '{{.Image}}' friday-searxng 2>/dev/null || true)"
        pinned_image="$(podman image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
        if [[ -n "$running_image" && "$running_image" == "$pinned_image" ]]; then image_verified=true; fi
    fi
    if [[ "$image_verified" == true ]] && probe_json; then http='ready'; fi
    printf '{"service":"%s","http":"%s","endpoint":"http://127.0.0.1:%s/","image":"%s","imageVerified":%s}\n' \
        "$service" "$http" "$PORT" "$IMAGE" "$image_verified"
}

# A queryless JSON request exits before engine dispatch. The pinned SearXNG
# version returns 400 {"error":"No query"}; 403 means JSON is disabled.
probe_json() {
    local body code
    body="$(mktemp)"
    code="$(curl --silent --show-error --max-time 3 --max-filesize 4096 --output "$body" \
        --write-out '%{http_code}' "http://127.0.0.1:$PORT/search?format=json" 2>/dev/null || true)"
    if [[ "$code" == 400 ]] && python3 - "$body" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as response:
        assert json.load(response) == {"error": "No query"}
except (OSError, ValueError, AssertionError):
    sys.exit(1)
PY
    then
        rm -f "$body"
        return 0
    fi
    rm -f "$body"
    return 1
}

if [[ "$MODE" == status ]]; then report; exit 0; fi

exec 9>/run/lock/friday-searxng-install.lock
flock -n 9 || { echo 'install_in_progress' >&2; exit 3; }
if systemctl is-active --quiet friday-searxng.service &&
    [[ "$(report)" == *'"http":"ready"'* ]]; then
    report
    exit 0
fi
export DEBIAN_FRONTEND=noninteractive
if ! command -v podman >/dev/null 2>&1; then
    apt-get update -qq >&2
    apt-get install -y -qq podman >&2
fi
command -v podman >/dev/null 2>&1 || { echo 'podman_unavailable' >&2; exit 4; }
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
    apt-get update -qq >&2
    apt-get install -y -qq python3-yaml >&2
fi
python3 -c 'import yaml' >/dev/null 2>&1 || { echo 'python_yaml_unavailable' >&2; exit 4; }

install -d -m 0755 "$CONFIG_DIR" "$CONFIG_DIR/config" "$CONFIG_DIR/cache"
python3 "$(dirname "$0")/research_searxng_settings.py" "$CONFIG_DIR/config/settings.yml" >&2

podman image exists "$IMAGE" || podman pull "$IMAGE" >&2
cat > "$UNIT" <<UNITFILE
[Unit]
Description=Friday local SearXNG research provider
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStartPre=-/usr/bin/podman rm -f friday-searxng
ExecStart=/usr/bin/podman run --rm --name friday-searxng --publish 127.0.0.1:$PORT:8080 --env FORCE_OWNERSHIP=false --volume $CONFIG_DIR/config:/etc/searxng:ro --volume $CONFIG_DIR/cache:/var/cache/searxng:U $IMAGE
ExecStop=/usr/bin/podman stop --time 10 friday-searxng
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITFILE
systemctl daemon-reload
systemctl enable friday-searxng.service >&2
systemctl restart friday-searxng.service >&2
for _ in $(seq 1 60); do
    if [[ "$(report)" == *'"http":"ready"'* ]]; then
        report
        exit 0
    fi
    sleep 2
done
report
echo 'searxng_healthcheck_failed' >&2
exit 5
