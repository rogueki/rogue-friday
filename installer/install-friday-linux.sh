#!/usr/bin/env bash
# Native Ubuntu/Debian foundation: local Dashboard and Hermes dashboard only.
# Voice, browser microphone, gateway bridges and remote TLS are separate phases.
set -Eeuo pipefail
umask 027

MODE=install
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
SKILLS_SOURCE=
FRIDAY_PORT=3100
HERMES_PORT=43691
RELEASES=/opt/friday/releases
CURRENT=/opt/friday/current
STATE=/var/lib/friday
CONFIG=/etc/friday
SERVICE=friday
VOICE_MODE=
ELEVENLABS_VOICE_ID=
KEY_SOURCE=
KEY_FILE=

usage() {
  cat <<'EOF'
Usage: sudo bash installer/install-friday-linux.sh --skills-source ABS_PATH [--validate|--dry-run] [--source ABS_PATH] [--dashboard-port PORT] [--hermes-port PORT] [--voice-mode local|elevenlabs] [--elevenlabs-voice-id ID] [--key-stdin|--key-file ABS_PATH|--key-prompt]
Ubuntu 22.04/24.04 or Debian 12/13 on x86_64/aarch64; local loopback services only.
--dry-run prints the plan and missing prerequisites without changing the system.
--validate exits nonzero if host prerequisites or the existing Friday Hermes binary are missing.
Install requires Node >=22.13, pnpm 10.28.2, rsync, curl, git, python3 with PyYAML, systemd, a local friday-skills checkout and a preinstalled Hermes CLI at /var/lib/friday/.local/bin/hermes.
On a first run the installer creates the locked friday user, then stops with instructions if Hermes is missing. Install Hermes as that user and rerun. A model provider is configured with 'hermes model'; no Kimi key is required by this installer.
Voice mode is configured only; headless audio transport and voice service are not installed yet. Local mode requires >=6 GiB NVIDIA VRAM. ElevenLabs mode requires your own Voice ID and private key input. Never put the key in a command argument.
EOF
}
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }
valid_port() { [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1024 && 10#$1 <= 65535 )); }

while (($#)); do
  case "$1" in
    --validate) MODE=validate; shift ;;
    --dry-run) MODE=dry-run; shift ;;
    --source) (($# >= 2)) || fail '--source needs a path'; SOURCE=$2; shift 2 ;;
    --skills-source) (($# >= 2)) || fail '--skills-source needs a path'; SKILLS_SOURCE=$2; shift 2 ;;
    --dashboard-port) (($# >= 2)) || fail '--dashboard-port needs a value'; FRIDAY_PORT=$2; shift 2 ;;
    --hermes-port) (($# >= 2)) || fail '--hermes-port needs a value'; HERMES_PORT=$2; shift 2 ;;
    --voice-mode) (($# >= 2)) || fail '--voice-mode needs local or elevenlabs'; VOICE_MODE=$2; shift 2 ;;
    --elevenlabs-voice-id) (($# >= 2)) || fail '--elevenlabs-voice-id needs a value'; ELEVENLABS_VOICE_ID=$2; shift 2 ;;
    --key-stdin) [[ -z "$KEY_SOURCE" ]] || fail 'Choose one key input'; KEY_SOURCE=stdin; shift ;;
    --key-file) (($# >= 2)) || fail '--key-file needs an absolute path'; [[ -z "$KEY_SOURCE" ]] || fail 'Choose one key input'; KEY_SOURCE=file; KEY_FILE=$2; shift 2 ;;
    --key-prompt) [[ -z "$KEY_SOURCE" ]] || fail 'Choose one key input'; KEY_SOURCE=prompt; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
if [[ "$KEY_SOURCE" == stdin && "$MODE" == install ]]; then
  # Keep the bounded input only in this shell; child build processes must not
  # inherit an open descriptor to the credential stream.
  KEY_STDIN_VALUE=$(head -c 4097)
  exec </dev/null
fi
valid_port "$FRIDAY_PORT" || fail 'Dashboard port must be 1024..65535'
valid_port "$HERMES_PORT" || fail 'Hermes port must be 1024..65535'
[[ "$FRIDAY_PORT" != "$HERMES_PORT" ]] || fail 'Dashboard and Hermes ports must differ'
[[ -z "$VOICE_MODE" || "$VOICE_MODE" == local || "$VOICE_MODE" == elevenlabs ]] || fail '--voice-mode must be local or elevenlabs'
[[ -z "$KEY_FILE" || "$KEY_FILE" = /* ]] || fail '--key-file must be absolute'
if [[ "$MODE" == install && -z "$VOICE_MODE" ]]; then
  if [[ -r "$CONFIG/voice.json" ]]; then
    [[ ! -L "$CONFIG/voice.json" ]] || fail 'Existing voice.json must not be a symlink'
    VOICE_MODE=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])).get("voice_mode"); print("elevenlabs" if m=="elevenlabs" else "local" if m=="streaming_qwen" else "")' "$CONFIG/voice.json")
  fi
  if [[ -z "$VOICE_MODE" ]]; then
    [[ -r /dev/tty ]] || fail 'Specify --voice-mode local|elevenlabs for unattended installation'
    read -r -p 'Voice mode (local/elevenlabs): ' VOICE_MODE </dev/tty
  fi
fi
[[ -z "$VOICE_MODE" || "$VOICE_MODE" == local || "$VOICE_MODE" == elevenlabs ]] || fail '--voice-mode must be local or elevenlabs'
if [[ "$VOICE_MODE" == local && ( -n "$ELEVENLABS_VOICE_ID" || -n "$KEY_SOURCE" ) ]]; then fail 'ElevenLabs options require --voice-mode elevenlabs'; fi
if [[ "$VOICE_MODE" == elevenlabs && -n "$ELEVENLABS_VOICE_ID" && ! "$ELEVENLABS_VOICE_ID" =~ ^[A-Za-z0-9]{10,128}$ ]]; then fail 'Invalid ElevenLabs Voice ID'; fi
[[ "$SOURCE" = /* && -f "$SOURCE/pnpm-lock.yaml" && -f "$SOURCE/apps/control-api/package.json" ]] || fail "--source must be an absolute Friday monorepo path: $SOURCE"
SOURCE=$(cd -- "$SOURCE" && pwd -P)
if [[ -n "$SKILLS_SOURCE" ]]; then
  [[ "$SKILLS_SOURCE" = /* && -f "$SKILLS_SOURCE/registry/integration_setup.json" && -f "$SKILLS_SOURCE/registry/skills.json" ]] || fail "--skills-source must be an absolute friday-skills checkout path: $SKILLS_SOURCE"
  SKILLS_SOURCE=$(cd -- "$SKILLS_SOURCE" && pwd -P)
fi

declare -a problems=()
if [[ ! -r /etc/os-release ]]; then
  problems+=("Cannot read /etc/os-release")
else
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;;
    *) problems+=("Unsupported OS ${ID:-unknown} ${VERSION_ID:-unknown}; use Ubuntu 22.04/24.04 or Debian 12/13") ;;
  esac
fi
case "$(uname -m)" in x86_64|aarch64) ;; *) problems+=("Unsupported architecture $(uname -m)") ;; esac
for cmd in node pnpm rsync curl git python3 systemctl runuser flock install useradd getent; do
  command -v "$cmd" >/dev/null 2>&1 || problems+=("Missing $cmd; install it using your distribution's package manager")
done
if [[ "$MODE" != dry-run ]] && command -v python3 >/dev/null 2>&1; then
  python3 -c 'import yaml' >/dev/null 2>&1 || problems+=("python3-yaml/PyYAML is required to validate skills and update the Hermes profile")
fi
if [[ -z "$SKILLS_SOURCE" ]]; then problems+=("Provide --skills-source /absolute/path/to/friday-skills; this foundation does not clone it"); fi
if command -v node >/dev/null 2>&1; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || a===22 && b>=13 ? 0:1)' || problems+=("Node.js >=22.13 required")
fi
if [[ "$MODE" != dry-run ]] && command -v pnpm >/dev/null 2>&1; then
  [[ "$(COREPACK_ENABLE_NETWORK=0 pnpm --version 2>/dev/null)" == '10.28.2' ]] || problems+=("pnpm 10.28.2 required (packageManager in package.json); Corepack network downloads are disabled during validation")
fi
if command -v systemctl >/dev/null 2>&1; then
  [[ "$(ps -p 1 -o comm= 2>/dev/null | tr -d ' ')" == systemd ]] || problems+=("systemd must be PID 1")
fi
if command -v df >/dev/null 2>&1; then
  available_kb=$(df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}')
  [[ "$available_kb" =~ ^[0-9]+$ ]] && (( available_kb >= 6291456 )) || problems+=("At least 6 GiB free space needed on /opt")
fi
if [[ -L "$CONFIG" || -L /opt/friday || -L "$STATE" ]]; then problems+=("Installation directories must not be symlinks"); fi
if id "$SERVICE" >/dev/null 2>&1; then
  [[ "$(getent passwd "$SERVICE" | cut -d: -f6)" == "$STATE" ]] || problems+=("Existing friday user must have home $STATE")
fi
if [[ "$VOICE_MODE" == local ]]; then
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    problems+=("Local voice requires NVIDIA GPU with >=6 GiB VRAM; nvidia-smi is unavailable. Use --voice-mode elevenlabs on GPU-free hosts")
  else
    gpu_memory=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null || true)
    if ! awk 'BEGIN{ok=0} /^[[:space:]]*[0-9]+[[:space:]]*$/ {if ($1>=6144) ok=1} END {exit !ok}' <<<"$gpu_memory"; then
      problems+=("Local voice requires at least one NVIDIA GPU with >=6 GiB VRAM; use --voice-mode elevenlabs")
    fi
  fi
fi

note "Mode: $MODE | source: $SOURCE"
note "Plan: $RELEASES/<revision> -> $CURRENT; config $CONFIG; persistent state $STATE; 127.0.0.1:$FRIDAY_PORT and 127.0.0.1:$HERMES_PORT"
note "Friday skills source: ${SKILLS_SOURCE:-missing}"
note "Voice selection: ${VOICE_MODE:-choose at install}; no browser audio service is installed by this foundation"
[[ "$MODE" != dry-run ]] || note 'Dry-run does not invoke pnpm/Corepack; its exact version is checked by --validate/install.'
if ((${#problems[@]})); then printf 'Prerequisite: %s\n' "${problems[@]}" >&2; fi
if [[ "$MODE" == dry-run ]]; then
  [[ -x "$STATE/.local/bin/hermes" ]] || note "Prerequisite: Hermes must be installed for friday at $STATE/.local/bin/hermes before installation."
  note 'Dry-run: no user, files, build, provider call or systemd service changed.'
  exit 0
fi
((${#problems[@]} == 0)) || fail 'Resolve host prerequisites, then rerun.'
python3 "$SOURCE/installer/linux/configure_skills.py" --check-only "$SKILLS_SOURCE" || fail 'Friday skills registry/catalog validation failed.'
if [[ "$MODE" == validate ]]; then
  [[ -x "$STATE/.local/bin/hermes" ]] || fail "Hermes CLI missing at $STATE/.local/bin/hermes; install it as friday, then rerun."
  note 'VALIDATION_OK (provider account and runtime health are not checked)'
  exit 0
fi
(( EUID == 0 )) || fail 'Installation requires sudo/root; --dry-run and --validate may run unprivileged.'

lock=/run/lock/friday-install.lock
exec 9>"$lock"
flock -n 9 || fail "Another Friday installation is running ($lock)."

# First run deliberately creates only a locked service identity, never a sudo account.
if ! id "$SERVICE" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$STATE" --create-home --shell /usr/sbin/nologin "$SERVICE"
fi
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$STATE" "$STATE/.hermes" "$STATE/.local"
[[ -x "$STATE/.local/bin/hermes" ]] || fail "Hermes CLI missing. Install Hermes under $STATE/.local/bin as friday (e.g. via its official installer), configure 'hermes model', then rerun. No Kimi key is forced."
runuser -u "$SERVICE" -- "$STATE/.local/bin/hermes" --version >/dev/null || fail 'Hermes CLI cannot run as friday.'

install -d -o root -g root -m 0755 /opt/friday "$RELEASES"
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$STATE/data" "$STATE/backups"
install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$STATE/logs"
install -d -o root -g "$SERVICE" -m 0750 "$CONFIG"
if [[ -e "$CONFIG/secrets" || -L "$CONFIG/secrets" ]]; then
  [[ -d "$CONFIG/secrets" && ! -L "$CONFIG/secrets" ]] || fail 'Existing secret directory must be a real directory'
else
  install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$CONFIG/secrets"
fi
if [[ "$VOICE_MODE" == elevenlabs ]]; then
  reuse_state=$(python3 "$SOURCE/installer/linux/configure_voice.py" --voice-mode elevenlabs --inspect-existing) || fail 'Existing cloud voice configuration is unsafe; correct it before reinstalling.'
  if [[ "$reuse_state" != valid ]]; then
    if [[ -z "$ELEVENLABS_VOICE_ID" && -r /dev/tty ]]; then
      read -r -p 'Your ElevenLabs Voice ID: ' ELEVENLABS_VOICE_ID </dev/tty
    fi
    if [[ -z "$KEY_SOURCE" && -r /dev/tty ]]; then KEY_SOURCE=prompt; fi
    [[ -n "$ELEVENLABS_VOICE_ID" ]] || fail 'ElevenLabs mode requires --elevenlabs-voice-id YOUR_VOICE_ID'
    [[ -n "$KEY_SOURCE" ]] || fail 'ElevenLabs mode requires --key-stdin, --key-file or --key-prompt'
  fi
fi
if [[ ! -e "$CONFIG/dashboard.yaml" ]]; then
  cat > "$CONFIG/dashboard.yaml" <<YAML
dataMode: hybrid
server:
  host: 127.0.0.1
  port: $FRIDAY_PORT
  allowRemote: false
paths:
  dataDir: $STATE/data
  logDir: $STATE/logs
  backupDir: $STATE/backups
  webRoot: $CURRENT/apps/web/out
auth:
  mode: local
  ownerUsername: owner
  ownerPasswordHash: file:$CONFIG/secrets/owner.hash
  secureCookies: false
dev:
  scenarioConsole: false
YAML
  chown root:"$SERVICE" "$CONFIG/dashboard.yaml"
  chmod 0640 "$CONFIG/dashboard.yaml"
else
  # Reject stale or remotely exposed local configuration before changing services.
  python3 - "$CONFIG/dashboard.yaml" "$FRIDAY_PORT" <<'PY' || fail "Existing $CONFIG/dashboard.yaml is incompatible with loopback-only port $FRIDAY_PORT."
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
server = re.search(r'(?ms)^server:\s*\n(.*?)(?=^\S|\Z)', text)
port = re.search(r'(?m)^\s+port:\s*(\d+)\b', server.group(1)) if server else None
host = re.search(r'(?m)^\s+host:\s*([^\s#]+)', server.group(1)) if server else None
remote = re.search(r'(?m)^\s+allowRemote:\s*([^\s#]+)', server.group(1)) if server else None
mode = re.search(r'(?m)^dataMode:\s*([^\s#]+)', text)
auth = re.search(r'(?ms)^auth:\s*\n(.*?)(?=^\S|\Z)', text)
auth_mode = re.search(r'(?m)^\s+mode:\s*([^\s#]+)', auth.group(1)) if auth else None
auth_ref = re.search(r'(?m)^\s+ownerPasswordHash:\s*["\']?([^\s"\']+)', auth.group(1)) if auth else None
if (not port or port.group(1) != sys.argv[2] or not host or host.group(1) != '127.0.0.1'
        or (remote and remote.group(1).lower() != 'false') or not mode or mode.group(1) != 'hybrid'
        or not auth_mode or auth_mode.group(1) != 'local' or not auth_ref
        or auth_ref.group(1) != 'file:/etc/friday/secrets/owner.hash'):
    print('Expected loopback, matching port, dataMode: hybrid and local owner hash file in /etc/friday/secrets.', file=sys.stderr)
    sys.exit(1)
PY
fi
if [[ ! -e "$CONFIG/adapters.yaml" ]]; then
  install -o root -g "$SERVICE" -m 0640 "$SOURCE/config/adapters.example.yaml" "$CONFIG/adapters.yaml"
fi
voice_args=(--voice-mode "$VOICE_MODE")
if [[ "$VOICE_MODE" == elevenlabs ]]; then
  voice_args+=(--elevenlabs-voice-id "$ELEVENLABS_VOICE_ID")
  case "$KEY_SOURCE" in
    stdin) voice_args+=(--key-stdin) ;;
    file) voice_args+=(--key-file "$KEY_FILE") ;;
    prompt) voice_args+=(--key-prompt) ;;
  esac
fi

revision=$(git -C "$SOURCE" rev-parse --short=12 HEAD 2>/dev/null || echo source)
release="$RELEASES/$revision-$(date -u +%Y%m%d%H%M%S)"
[[ ! -e "$CURRENT" || -L "$CURRENT" ]] || fail "$CURRENT exists but is not a release symlink."
[[ ! -e "$release" ]] || fail "Release $release already exists; rerun in one second."
install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$release"
old=$(readlink -f "$CURRENT" 2>/dev/null || true)
promoted=0
cleanup() {
  local status=$?
  if (( status != 0 && promoted == 1 )); then
    note 'Health check failed; restoring previous release symlink.' >&2
    if [[ -n "$old" && -d "$old" ]]; then
      ln -s "$old" "$CURRENT.rollback"
      mv -Tf "$CURRENT.rollback" "$CURRENT"
      systemctl restart friday-dashboard.service || true
      systemctl restart friday-hermes-dashboard.service || true
    else
      systemctl stop friday-dashboard.service || true
      systemctl stop friday-hermes-dashboard.service || true
      rm -f -- "$CURRENT"
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
rsync -a --delete --exclude='.git/' --exclude='.codex/' --exclude='.claude/' --exclude='.kimi/' --exclude='.ssh/' --exclude='node_modules/' --exclude='dist/' --exclude='out/' --exclude='build/' --exclude='.venv/' --exclude='venv/' --exclude='.env' --exclude='.env.*' --exclude='.npmrc' --exclude='*.key' --exclude='*.pem' --exclude='*.pfx' --exclude='*.p12' --exclude='*.sqlite' --exclude='*.db' --exclude='*.hash' --exclude='MEMORY.md' --exclude='SCOPE.md' --exclude='AGENTS.md' --exclude='CLAUDE.md' --exclude='.tmp-*/' --exclude='data/' --exclude='logs/' --exclude='backups/' --exclude='config/dashboard.yaml' --exclude='config/adapters.yaml' "$SOURCE/" "$release/"
chown -R "$SERVICE:$SERVICE" "$release"
runuser -u "$SERVICE" -- sh -c 'cd "$1" && COREPACK_ENABLE_NETWORK=0 pnpm install --frozen-lockfile && COREPACK_ENABLE_NETWORK=0 pnpm build:app' sh "$release"
[[ -f "$release/apps/control-api/dist/main.js" && -f "$release/apps/web/out/index.html" ]] || fail 'Build produced no Control API or web artifact.'
install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$release/skills/friday-skills"
rsync -a --delete --exclude='.git/' --exclude='.env' --exclude='.env.*' --exclude='.venv/' --exclude='*.key' --exclude='*.pem' --exclude='*.sqlite' --exclude='*.db' --exclude='MEMORY.md' --exclude='SCOPE.md' --exclude='AGENTS.md' --exclude='CLAUDE.md' "$SKILLS_SOURCE/" "$release/skills/friday-skills/"
chown -R "$SERVICE:$SERVICE" "$release/skills/friday-skills"
runuser -u "$SERVICE" -- python3 "$release/installer/linux/configure_skills.py" "$release/skills/friday-skills" "$CURRENT/skills/friday-skills/skills"
chown -R root:root "$release"
chmod -R go-w "$release"

node_bin=$(command -v node)
cat > /etc/systemd/system/friday-dashboard.service <<UNIT
[Unit]
Description=Friday local Command Center
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=$SERVICE
Group=$SERVICE
WorkingDirectory=$CURRENT
Environment=HOME=$STATE
Environment=FRIDAY_CONFIG_DIR=$CONFIG
Environment=FRIDAY_INSTALL_ROOT=$CURRENT
Environment=FRIDAY_HERMES_DASHBOARD_URL=http://127.0.0.1:$HERMES_PORT
Environment=FRIDAY_SKILLS_CATALOG_PATH=$CURRENT/skills/friday-skills/registry/integration_setup.json
ExecStart=$node_bin $CURRENT/apps/control-api/dist/main.js
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE $CONFIG/secrets
LimitNOFILE=4096
TasksMax=256

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/friday-hermes-dashboard.service <<UNIT
[Unit]
Description=Hermes local dashboard for Friday
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=$SERVICE
Group=$SERVICE
WorkingDirectory=$STATE
Environment=HOME=$STATE
Environment=PATH=$STATE/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$STATE/.local/bin/hermes dashboard --host 127.0.0.1 --port $HERMES_PORT --no-open --skip-build
Restart=on-failure
RestartSec=10
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE
LimitNOFILE=4096
TasksMax=256

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable friday-dashboard.service friday-hermes-dashboard.service >/dev/null
ln -s "$release" "$CURRENT.next"
mv -Tf "$CURRENT.next" "$CURRENT"
promoted=1
systemctl restart friday-hermes-dashboard.service
curl -fsS --max-time 3 --retry 10 --retry-connrefused --retry-delay 2 -o /dev/null "http://127.0.0.1:$HERMES_PORT/" || fail 'Hermes dashboard did not become healthy.'
systemctl restart friday-dashboard.service
curl -fsS --max-time 3 --retry 15 --retry-connrefused --retry-delay 2 -o /dev/null "http://127.0.0.1:$FRIDAY_PORT/api/v1/health" || fail 'Friday dashboard did not become healthy.'
if [[ "$KEY_SOURCE" == stdin ]]; then
  printf '%s' "$KEY_STDIN_VALUE" | python3 "$SOURCE/installer/linux/configure_voice.py" "${voice_args[@]}" || fail 'Voice configuration could not be written.'
  unset KEY_STDIN_VALUE
else
  python3 "$SOURCE/installer/linux/configure_voice.py" "${voice_args[@]}" || fail 'Voice configuration could not be written.'
fi
promoted=0
note "INSTALL_OK release=$release dashboard=http://127.0.0.1:$FRIDAY_PORT hermes=http://127.0.0.1:$HERMES_PORT"
