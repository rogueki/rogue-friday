#!/usr/bin/env bash
# Separates Friday domain agents into their own Linux accounts; terminal and file tools of each profile run there over local SSH.
set -euo pipefail

MODE="${1:-status}"            # status | apply | revert | render-sshd
OWNER="${FRIDAY_OWNER:-ubuntu}"
PORT="${FRIDAY_AGENT_SSH_PORT:-2222}"
PROFILES=(tasks communication calendar automations research alerts audit)
SSHD_DROPIN=/etc/ssh/sshd_config.d/friday-agents.conf

case "$MODE" in
    status|apply|revert|render-sshd) ;;
    *) echo 'invalid_mode' >&2; exit 2 ;;
esac
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( 10#$PORT < 1024 || 10#$PORT > 65535 )); then
    echo 'invalid_port' >&2
    exit 2
fi

owner_home=''
if [[ "$MODE" != render-sshd ]]; then
    [[ "$(id -u)" -eq 0 ]] || { echo 'root_required' >&2; exit 2; }
    getent passwd "$OWNER" >/dev/null || { echo 'owner_missing' >&2; exit 2; }
    owner_home="$(getent passwd "$OWNER" | cut -d: -f6)"
fi
hermes_bin="$owner_home/.local/bin/hermes"

as_owner() { runuser -u "$OWNER" -- env HOME="$owner_home" "$@"; }
hermes_set() { as_owner "$hermes_bin" -p "$1" config set "$2" "$3" >/dev/null; }

render_sshd() {
    echo '# Managed by Friday: local key-only SSH for per-profile agent sandboxes.'
    echo "Port $PORT"
    echo 'ListenAddress 127.0.0.1'
    echo 'PasswordAuthentication no'
    echo 'KbdInteractiveAuthentication no'
    echo 'PermitRootLogin no'
    local users='AllowUsers' profile
    for profile in "${PROFILES[@]}"; do users+=" friday-$profile"; done
    echo "$users"
    echo 'AllowTcpForwarding no'
    echo 'AllowAgentForwarding no'
    echo 'AllowStreamLocalForwarding no'
    echo 'X11Forwarding no'
    echo 'PermitTunnel no'
    echo 'GatewayPorts no'
}

profile_backend() {
    local backend='unknown'
    if [[ -x "$hermes_bin" ]]; then
        backend="$(as_owner "$hermes_bin" -p "$1" config get terminal.backend 2>/dev/null || true)"
        backend="${backend//[[:space:]]/}"
        [[ -n "$backend" ]] || backend='unknown'
    fi
    printf '%s' "$backend"
}

status_json() {
    local backup_path="${1:-}" sshd_state user_exists key_present backend
    local -a args=()
    local profile user
    sshd_state='absent'
    if systemctl list-unit-files ssh.service --no-legend 2>/dev/null | grep -q '^ssh\.service'; then
        sshd_state="$(systemctl is-active ssh.service 2>/dev/null || true)"
        [[ -n "$sshd_state" ]] || sshd_state='absent'
    fi
    for profile in "${PROFILES[@]}"; do
        user="friday-$profile"
        user_exists=false
        if id -u "$user" >/dev/null 2>&1; then user_exists=true; fi
        key_present=false
        if [[ -f "$owner_home/.hermes/profiles/$profile/terminal-ssh/id_ed25519" ]]; then key_present=true; fi
        backend="$(profile_backend "$profile")"
        args+=("$profile" "$user_exists" "$backend" "$key_present")
    done
    python3 - "$sshd_state" "$PORT" "$backup_path" "${args[@]}" <<'PY'
import json
import sys

sshd, port, backup, *rest = sys.argv[1:]
profiles = []
for index in range(0, len(rest), 4):
    profile, user_exists, backend, key_present = rest[index:index + 4]
    profiles.append({
        "profile": profile,
        "user": "friday-" + profile,
        "userExists": user_exists == "true",
        "backend": backend,
        "keyPresent": key_present == "true",
    })
print(json.dumps({
    "sshd": sshd,
    "port": int(port),
    "profiles": profiles,
    "backup": backup or None,
}, separators=(",", ":")))
PY
}

if [[ "$MODE" == render-sshd ]]; then
    render_sshd
    exit 0
fi

if [[ "$MODE" == status ]]; then
    status_json ''
    exit 0
fi

if [[ "$MODE" == revert ]]; then
    for profile in "${PROFILES[@]}"; do
        hermes_set "$profile" terminal.backend local
        hermes_set "$profile" terminal.cwd "$owner_home/.hermes/profiles/$profile/workspace"
    done
    rm -f "$SSHD_DROPIN"
    # The sandbox accounts and their data are kept so nothing a worker produced is lost.
    systemctl disable --now ssh.service >/dev/null 2>&1 || true
    status_json ''
    exit 0
fi

backup="$owner_home/friday/backups/profile-isolation-$(date +%Y%m%d-%H%M%S)"
as_owner install -d -m 700 "$backup"
for profile in "${PROFILES[@]}"; do
    as_owner install -d -m 700 "$backup/$profile"
    for name in config.yaml .env; do
        src="$owner_home/.hermes/profiles/$profile/$name"
        if [[ -f "$src" ]]; then
            as_owner cp -p "$src" "$backup/$profile/$name"
        fi
    done
done

if ! command -v sshd >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-server >&2
fi

install -d -m 755 "$(dirname "$SSHD_DROPIN")"
render_sshd > "$SSHD_DROPIN.tmp"
chmod 644 "$SSHD_DROPIN.tmp"
mv "$SSHD_DROPIN.tmp" "$SSHD_DROPIN"
if ! sshd -t; then
    rm -f "$SSHD_DROPIN"
    echo 'sshd_config_invalid' >&2
    exit 1
fi
systemctl disable --now ssh.socket >/dev/null 2>&1 || true
systemctl enable ssh.service >/dev/null
systemctl restart ssh.service

for profile in "${PROFILES[@]}"; do
    user="friday-$profile"
    if ! id -u "$user" >/dev/null 2>&1; then
        useradd --create-home --home-dir "/home/$user" --shell /bin/bash --user-group "$user"
        passwd -l "$user" >/dev/null
    fi
    chmod 750 "/home/$user"
    install -d -o "$user" -g "$user" -m 700 "/home/$user/workspace" "/home/$user/.ssh"

    keydir="$owner_home/.hermes/profiles/$profile/terminal-ssh"
    as_owner install -d -m 700 "$keydir"
    if [[ ! -f "$keydir/id_ed25519" ]]; then
        as_owner ssh-keygen -q -t ed25519 -N '' -C "$user" -f "$keydir/id_ed25519"
    fi
    pub="$(cat "$keydir/id_ed25519.pub")"
    printf 'from="127.0.0.1,::1",no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s\n' \
        "$pub" > "/home/$user/.ssh/authorized_keys"
    chown "$user:$user" "/home/$user/.ssh/authorized_keys"
    chmod 600 "/home/$user/.ssh/authorized_keys"

    hermes_set "$profile" terminal.backend ssh
    hermes_set "$profile" terminal.ssh_host 127.0.0.1
    hermes_set "$profile" terminal.ssh_port "$PORT"
    hermes_set "$profile" terminal.ssh_user "$user"
    hermes_set "$profile" terminal.ssh_key "$keydir/id_ed25519"
    hermes_set "$profile" terminal.cwd "/home/$user/workspace"
done

as_owner install -d -m 700 "$owner_home/.ssh"
known_hosts="$owner_home/.ssh/known_hosts"
as_owner touch "$known_hosts"
as_owner chmod 600 "$known_hosts"
if [[ -r /etc/ssh/ssh_host_ed25519_key.pub ]] &&
    ! as_owner ssh-keygen -F "[127.0.0.1]:$PORT" -f "$known_hosts" >/dev/null 2>&1; then
    read -r host_type host_key _ < /etc/ssh/ssh_host_ed25519_key.pub || true
    printf '[127.0.0.1]:%s %s %s\n' "$PORT" "$host_type" "$host_key" >> "$known_hosts"
fi

chmod 750 "$owner_home"
chmod 700 "$owner_home/.hermes"
for private_dir in "$owner_home/.config/friday/mail" "$owner_home/.config/friday/calendar"; do
    if [[ -d "$private_dir" ]]; then chmod 700 "$private_dir"; fi
done

status_json "$backup"
