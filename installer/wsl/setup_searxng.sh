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
    local service='absent' http='unavailable'
    if systemctl list-unit-files friday-searxng.service --no-legend 2>/dev/null | grep -q '^friday-searxng.service'; then
        service="$(systemctl is-active friday-searxng.service 2>/dev/null || true)"
    fi
    if curl --silent --show-error --fail --max-time 3 --output /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
        http='ready'
    fi
    printf '{"service":"%s","http":"%s","endpoint":"http://127.0.0.1:%s/","image":"%s"}\n' "$service" "$http" "$PORT" "$IMAGE"
}

if [[ "$MODE" == status ]]; then report; exit 0; fi

exec 9>/run/lock/friday-searxng-install.lock
flock -n 9 || { echo 'install_in_progress' >&2; exit 3; }
if systemctl is-active --quiet friday-searxng.service &&
    curl --silent --fail --max-time 3 --output /dev/null "http://127.0.0.1:$PORT/"; then
    report
    exit 0
fi
export DEBIAN_FRONTEND=noninteractive
if ! command -v podman >/dev/null 2>&1; then
    apt-get update -qq >&2
    apt-get install -y -qq podman >&2
fi
command -v podman >/dev/null 2>&1 || { echo 'podman_unavailable' >&2; exit 4; }

install -d -m 0755 "$CONFIG_DIR" "$CONFIG_DIR/config" "$CONFIG_DIR/cache"
if [[ ! -f "$CONFIG_DIR/config/settings.yml" ]]; then
    secret="$(od -An -tx1 -N32 /dev/urandom | tr -d ' \n')"
    cat > "$CONFIG_DIR/config/settings.yml" <<SETTINGS
use_default_settings: true
general:
  debug: false
  instance_name: "Friday Research"
search:
  formats:
    - html
    - json
server:
  secret_key: "$secret"
  base_url: "http://127.0.0.1:$PORT/"
  limiter: false
  public_instance: false
  image_proxy: false
SETTINGS
    chmod 0644 "$CONFIG_DIR/config/settings.yml"
fi

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
    if curl --silent --show-error --fail --max-time 2 --output /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
        report
        exit 0
    fi
    sleep 2
done
report
echo 'searxng_healthcheck_failed' >&2
exit 5
