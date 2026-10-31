#!/usr/bin/env bash
# Native Ubuntu/Debian installer. Services bind to loopback only.
set -Eeuo pipefail
umask 027

MODE=install
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
SKILLS_SOURCE=
FRIDAY_PORT=3100
HERMES_PORT=43691
HERMES_API_PORT=43693
VOICE_PORT=43694
RELEASES=/opt/friday/releases
CURRENT=/opt/friday/current
STATE=/var/lib/friday
CONFIG=/etc/friday
SERVICE=friday
HERMES_PIN=d923a5eb487a17c0a68801bba9ef0f56c81040a8
HERMES_TREE=$STATE/.hermes/hermes-agent
VOICE_MODE=
CONVERSATION=
QWEN_REGION=
QWEN_CONSENT=0
QWEN_KEY_SOURCE=
QWEN_KEY_FILE=
ELEVENLABS_VOICE_ID=
KEY_SOURCE=
KEY_FILE=

usage() {
  cat <<'EOF'
Usage: sudo bash installer/install-friday-linux.sh --skills-source ABS_PATH [--validate|--dry-run] [--source ABS_PATH] [--dashboard-port PORT] [--hermes-port PORT] [--hermes-api-port PORT] [--voice-port PORT] [--voice-mode local|elevenlabs] [--elevenlabs-voice-id ID] [--key-stdin|--key-file ABS_PATH|--key-prompt] [--conversation local|qwen] [--qwen-region ap-southeast-1|cn-beijing] [--qwen-consent] [--qwen-key-file ABS_PATH|--qwen-key-prompt]
Ubuntu 22.04/24.04 or Debian 12/13 on x86_64/aarch64; local loopback services only.
--dry-run prints the plan and missing prerequisites without changing the system.
--validate exits nonzero if host prerequisites or the existing Friday Hermes binary are missing.
Install requires Node >=22.13, pnpm 10.28.2, rsync, curl, git, python3 with PyYAML, systemd, a local friday-skills checkout and a preinstalled Hermes CLI at /var/lib/friday/.local/bin/hermes.
On a first run the installer creates the locked friday user, then stops with instructions if Hermes is missing. Install Hermes as that user and rerun. A model provider is configured with 'hermes model'; no Kimi key is required by this installer.
ElevenLabs mode prepares a private browser-audio voice service. It starts only after owner speaker/wake enrollment and an authenticated Hermes API are ready; see docs/LINUX_VOICE.md. Local mode requires >=6 GiB NVIDIA VRAM but the native Linux device/TTS service is not installed yet. Never put the key in a command argument.
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
    --hermes-api-port) (($# >= 2)) || fail '--hermes-api-port needs a value'; HERMES_API_PORT=$2; shift 2 ;;
    --voice-port) (($# >= 2)) || fail '--voice-port needs a value'; VOICE_PORT=$2; shift 2 ;;
    --voice-mode) (($# >= 2)) || fail '--voice-mode needs local or elevenlabs'; VOICE_MODE=$2; shift 2 ;;
    --conversation) (($# >= 2)) || fail '--conversation needs local or qwen'; CONVERSATION=$2; shift 2 ;;
    --qwen-region) (($# >= 2)) || fail '--qwen-region needs ap-southeast-1 or cn-beijing'; QWEN_REGION=$2; shift 2 ;;
    --qwen-consent) QWEN_CONSENT=1; shift ;;
    --qwen-key-file) (($# >= 2)) || fail '--qwen-key-file needs a value'; [[ -z "$QWEN_KEY_SOURCE" ]] || fail 'Choose one Qwen key input'; QWEN_KEY_SOURCE=file; QWEN_KEY_FILE=$2; shift 2 ;;
    --qwen-key-prompt) [[ -z "$QWEN_KEY_SOURCE" ]] || fail 'Choose one Qwen key input'; QWEN_KEY_SOURCE=prompt; shift ;;
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
valid_port "$HERMES_API_PORT" || fail 'Hermes API port must be 1024..65535'
valid_port "$VOICE_PORT" || fail 'Voice port must be 1024..65534'
FRIDAY_PORT=$((10#$FRIDAY_PORT)); HERMES_PORT=$((10#$HERMES_PORT))
HERMES_API_PORT=$((10#$HERMES_API_PORT)); VOICE_PORT=$((10#$VOICE_PORT))
(( VOICE_PORT < 65535 )) || fail 'Voice port must be 1024..65534'
ports=("$FRIDAY_PORT" "$HERMES_PORT" "$HERMES_API_PORT" "$VOICE_PORT" "$((VOICE_PORT + 1))")
[[ "$(printf '%s\n' "${ports[@]}" | sort -u | wc -l)" -eq 5 ]] || fail 'Dashboard, Hermes, Hermes API, voice and browser-audio ports must differ'
[[ -z "$VOICE_MODE" || "$VOICE_MODE" == local || "$VOICE_MODE" == elevenlabs ]] || fail '--voice-mode must be local or elevenlabs'
[[ -z "$KEY_FILE" || "$KEY_FILE" = /* ]] || fail '--key-file must be absolute'
[[ -z "$CONVERSATION" || "$CONVERSATION" == local || "$CONVERSATION" == qwen ]] || fail '--conversation must be local or qwen'
[[ -z "$QWEN_REGION" || "$QWEN_REGION" == ap-southeast-1 || "$QWEN_REGION" == cn-beijing ]] || fail '--qwen-region must be ap-southeast-1 or cn-beijing'
if [[ "$CONVERSATION" != qwen && ( -n "$QWEN_REGION" || "$QWEN_CONSENT" == 1 || -n "$QWEN_KEY_SOURCE" ) ]]; then fail 'Qwen options require --conversation qwen'; fi
[[ -z "$QWEN_KEY_FILE" || "$QWEN_KEY_FILE" = /* ]] || fail '--qwen-key-file must be absolute'
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
if [[ "$MODE" == install && "$VOICE_MODE" == elevenlabs && -z "$CONVERSATION" && ! -e "$CONFIG/voice.json" && -r /dev/tty ]]; then
  read -r -p 'Live conversation with Qwen Audio over the Alibaba Token Plan? (local/qwen) [local]: ' CONVERSATION </dev/tty
  CONVERSATION=${CONVERSATION:-local}
fi
[[ -z "$CONVERSATION" || "$CONVERSATION" == local || "$CONVERSATION" == qwen ]] || fail '--conversation must be local or qwen'
# The native Linux voice service only runs with the browser (ElevenLabs) voice, so Qwen needs that mode.
if [[ "$CONVERSATION" == qwen && "$VOICE_MODE" == local ]]; then fail 'Qwen Audio on Linux needs --voice-mode elevenlabs; the native local voice is not available'; fi
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
for cmd in node pnpm rsync curl git python3 systemctl runuser flock install useradd getent sha256sum; do
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
if [[ -f "$SOURCE/installer/linux/find_obsidian_install.sh" ]]; then
  if obsidian_app=$(bash "$SOURCE/installer/linux/find_obsidian_install.sh"); then
    note "Existing Obsidian app: $obsidian_app (reused; no application installation)"
  else
    note 'Obsidian GUI app not found; existing vault data is not changed by this installer.'
  fi
fi
note "Plan: $RELEASES/<revision> -> $CURRENT; config $CONFIG; persistent state $STATE; dashboard 127.0.0.1:$FRIDAY_PORT, Hermes 127.0.0.1:$HERMES_PORT, Hermes API 127.0.0.1:$HERMES_API_PORT, voice 127.0.0.1:$VOICE_PORT"
note "Friday skills source: ${SKILLS_SOURCE:-missing}"
note "Voice selection: ${VOICE_MODE:-choose at install}; ElevenLabs voice starts after private enrollment and Hermes API prerequisites"
note "Conversation: ${CONVERSATION:-keep existing or choose at install}"
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
  [[ -d "$HERMES_TREE/.git" && "$(git -C "$HERMES_TREE" rev-parse HEAD)" == "$HERMES_PIN" ]] || fail "Hermes must be pinned to $HERMES_PIN"
  python3 "$SOURCE/installer/wsl/patch_hermes_run_stop.py" "$HERMES_TREE" --require-patched || fail 'Hermes run-stop patch verification failed.'
  python3 "$SOURCE/installer/wsl/patch_hermes_cron_lock.py" "$HERMES_TREE" --require-patched || fail 'Hermes cron-lock patch verification failed.'
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
[[ -d "$HERMES_TREE/.git" && "$(git -C "$HERMES_TREE" rev-parse HEAD)" == "$HERMES_PIN" ]] || fail "Hermes must be pinned to $HERMES_PIN before installing Friday."
runuser -u "$SERVICE" -- python3 "$SOURCE/installer/wsl/patch_hermes_run_stop.py" "$HERMES_TREE" || fail 'Hermes run-stop patch failed.'
runuser -u "$SERVICE" -- python3 "$SOURCE/installer/wsl/patch_hermes_cron_lock.py" "$HERMES_TREE" || fail 'Hermes cron-lock patch failed.'

install -d -o root -g root -m 0755 /opt/friday "$RELEASES"
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$STATE/data" "$STATE/backups"
install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$STATE/voice" "$STATE/models" "$STATE/cache"
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
if [[ "$CONVERSATION" == qwen ]]; then
  if (( !QWEN_CONSENT )) && [[ -r /dev/tty ]]; then
    note 'Qwen Audio sends speech and conversation content to Alibaba Cloud (Token Plan). Wake word, speaker check and voice stay on this machine.'
    read -r -p 'Agree to this data transfer? (yes/no) [no]: ' qwen_answer </dev/tty
    [[ "$qwen_answer" == yes ]] && QWEN_CONSENT=1
  fi
  if (( !QWEN_CONSENT )); then
    note 'Without consent the conversation stays local.'
    CONVERSATION=local
  fi
fi
if [[ "$CONVERSATION" == qwen && -z "$QWEN_KEY_SOURCE" && ! -f "$CONFIG/secrets/alibaba-tokenplan.key" ]]; then
  [[ -r /dev/tty ]] && QWEN_KEY_SOURCE=prompt
  [[ -n "$QWEN_KEY_SOURCE" ]] || fail 'Qwen Audio requires --qwen-key-file or --qwen-key-prompt'
fi
if [[ ! -e "$CONFIG/dashboard.yaml" ]]; then
  cat > "$CONFIG/dashboard.yaml" <<YAML
dataMode: live
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
YAML
  chown root:"$SERVICE" "$CONFIG/dashboard.yaml"
  chmod 0640 "$CONFIG/dashboard.yaml"
else
  # Reject stale or remotely exposed local configuration before changing services.
  python3 - "$CONFIG/dashboard.yaml" "$FRIDAY_PORT" <<'PY' || fail "Existing $CONFIG/dashboard.yaml is incompatible with loopback-only port $FRIDAY_PORT."
import os, re, shutil, stat, sys, time
path = sys.argv[1]
with open(path, encoding='utf-8', newline='') as source:
    text = source.read()
server = re.search(r'(?ms)^server:\s*\n(.*?)(?=^\S|\Z)', text)
port = re.search(r'(?m)^\s+port:\s*(\d+)\b', server.group(1)) if server else None
host = re.search(r'(?m)^\s+host:\s*([^\s#]+)', server.group(1)) if server else None
remote = re.search(r'(?m)^\s+allowRemote:\s*([^\s#]+)', server.group(1)) if server else None
mode = re.search(r'(?m)^dataMode:\s*([^\s#]+)', text)
auth = re.search(r'(?ms)^auth:\s*\n(.*?)(?=^\S|\Z)', text)
auth_mode = re.search(r'(?m)^\s+mode:\s*([^\s#]+)', auth.group(1)) if auth else None
auth_ref = re.search(r'(?m)^\s+ownerPasswordHash:\s*["\']?([^\s"\']+)', auth.group(1)) if auth else None
if (not port or port.group(1) != sys.argv[2] or not host or host.group(1) != '127.0.0.1'
        or (remote and remote.group(1).lower() != 'false')
        or (mode and mode.group(1) not in ('live', 'mock', 'hybrid'))
        or not auth_mode or auth_mode.group(1) != 'local' or not auth_ref
        or auth_ref.group(1) != 'file:/etc/friday/secrets/owner.hash'):
    print('Expected loopback, matching port and local owner hash file in /etc/friday/secrets.', file=sys.stderr)
    sys.exit(1)
if mode and mode.group(1) != 'live':
    info = os.stat(path)
    backup = f"{path}.bak-dataMode-{time.strftime('%Y%m%d%H%M%S', time.gmtime())}"
    shutil.copy2(path, backup)
    os.chown(backup, info.st_uid, info.st_gid)
    os.chmod(backup, stat.S_IMODE(info.st_mode))
    text = re.sub(r'(?m)^(dataMode:[ \t]*)[^\s#]+', r'\g<1>live', text, count=1)
    with open(path, 'w', encoding='utf-8', newline='') as target:
        target.write(text)
    print(f'Migrated dataMode {mode.group(1)} -> live (backup {backup})', file=sys.stderr)
PY
fi
if [[ ! -e "$CONFIG/adapters.yaml" ]]; then
  install -o root -g "$SERVICE" -m 0640 "$SOURCE/config/adapters.example.yaml" "$CONFIG/adapters.yaml"
fi
voice_args=(--voice-mode "$VOICE_MODE" --voice-port "$VOICE_PORT" --hermes-api-port "$HERMES_API_PORT" --dashboard-port "$FRIDAY_PORT")
if [[ "$VOICE_MODE" == elevenlabs ]]; then
  voice_args+=(--elevenlabs-voice-id "$ELEVENLABS_VOICE_ID")
  case "$KEY_SOURCE" in
    stdin) voice_args+=(--key-stdin) ;;
    file) voice_args+=(--key-file "$KEY_FILE") ;;
    prompt) voice_args+=(--key-prompt) ;;
  esac
fi
if [[ -n "$CONVERSATION" ]]; then
  voice_args+=(--conversation-backend "$CONVERSATION")
fi
if [[ "$CONVERSATION" == qwen ]]; then
  voice_args+=(--qwen-consent)
  [[ -z "$QWEN_REGION" ]] || voice_args+=(--qwen-region "$QWEN_REGION")
  case "$QWEN_KEY_SOURCE" in
    file) voice_args+=(--qwen-key-file "$QWEN_KEY_FILE") ;;
    prompt) voice_args+=(--qwen-key-prompt) ;;
  esac
fi

revision=$(git -C "$SOURCE" rev-parse --short=12 HEAD 2>/dev/null || echo source)
release="$RELEASES/$revision-$(date -u +%Y%m%d%H%M%S)"
[[ ! -e "$CURRENT" || -L "$CURRENT" ]] || fail "$CURRENT exists but is not a release symlink."
[[ ! -e "$release" ]] || fail "Release $release already exists; rerun in one second."
install -d -o "$SERVICE" -g "$SERVICE" -m 0750 "$release"
old=$(readlink -f "$CURRENT" 2>/dev/null || true)
promoted=0
voice_backup=
voice_unit_backup=
voice_was_active=0
voice_was_enabled=0
activate_was_enabled=0
gateway_backup=
gateway_was_active=0
gateway_was_enabled=0
systemctl is-active --quiet friday-voice.service && voice_was_active=1 || true
systemctl is-enabled --quiet friday-voice.service && voice_was_enabled=1 || true
systemctl is-enabled --quiet friday-voice-activate.path && activate_was_enabled=1 || true
systemctl is-active --quiet friday-hermes-gateway.service && gateway_was_active=1 || true
systemctl is-enabled --quiet friday-hermes-gateway.service && gateway_was_enabled=1 || true
cleanup() {
  local status=$?
  set +e
  if (( status != 0 )) && [[ -n "$gateway_backup" ]]; then
    for file in hermes.env hermes-api.key friday-hermes-gateway.service; do
      case "$file" in
        hermes.env) target="$STATE/.hermes/.env" ;;
        hermes-api.key) target="$CONFIG/secrets/hermes-api.key" ;;
        *) target=/etc/systemd/system/friday-hermes-gateway.service ;;
      esac
      if [[ -f "$gateway_backup/$file" ]]; then
        cp -p -- "$gateway_backup/$file" "$target" || note "Could not restore $file" >&2
      elif [[ -f "$gateway_backup/$file.absent" ]]; then
        rm -f -- "$target" || note "Could not remove new $file" >&2
      fi
    done
    systemctl daemon-reload || true
    if (( gateway_was_active )); then systemctl restart friday-hermes-gateway.service || true
    else systemctl stop friday-hermes-gateway.service || true; fi
    if (( !gateway_was_enabled )); then systemctl disable friday-hermes-gateway.service >/dev/null 2>&1 || true; fi
    note "Hermes API rollback snapshot retained at $gateway_backup" >&2
  fi
  if (( status != 0 )) && [[ -n "$voice_unit_backup" ]]; then
    systemctl disable --now friday-voice-activate.path >/dev/null 2>&1 || true
    for unit in friday-voice.service friday-voice-activate.path friday-voice-activate.service; do
      if [[ -f "$voice_unit_backup/$unit" ]]; then cp -p -- "$voice_unit_backup/$unit" "/etc/systemd/system/$unit"
      else rm -f -- "/etc/systemd/system/$unit"; fi
    done
    systemctl daemon-reload || true
    if (( activate_was_enabled )); then systemctl enable --now friday-voice-activate.path >/dev/null 2>&1 || true; fi
    if (( !voice_was_enabled )); then systemctl disable --now friday-voice.service >/dev/null 2>&1 || true; fi
  fi
  if (( status != 0 && promoted == 1 )); then
    note 'Health check failed; restoring previous release symlink.' >&2
    if [[ -n "$voice_backup" ]]; then
      restore_failed=0
      for file in voice.json elevenlabs.key alibaba-tokenplan.key adapters.yaml; do
        if [[ -f "$voice_backup/$file" ]]; then
          case "$file" in
            voice.json|adapters.yaml) cp -p -- "$voice_backup/$file" "$CONFIG/$file" || restore_failed=1 ;;
            elevenlabs.key|alibaba-tokenplan.key) cp -p -- "$voice_backup/$file" "$CONFIG/secrets/$file" || restore_failed=1 ;;
          esac
        elif [[ -f "$voice_backup/$file.absent" ]]; then
          case "$file" in
            voice.json|adapters.yaml) rm -f -- "$CONFIG/$file" || restore_failed=1 ;;
            elevenlabs.key|alibaba-tokenplan.key) rm -f -- "$CONFIG/secrets/$file" || restore_failed=1 ;;
          esac
        fi
      done
      if (( restore_failed )); then
        note "Private rollback snapshot retained at $voice_backup; inspect manually." >&2
      else
        rm -f -- "$voice_backup"/*
        rmdir -- "$voice_backup"
      fi
    fi
    if [[ -n "$old" && -d "$old" ]]; then
      ln -s "$old" "$CURRENT.rollback"
      mv -Tf "$CURRENT.rollback" "$CURRENT"
      systemctl restart friday-dashboard.service || true
      systemctl restart friday-hermes-dashboard.service || true
      if (( voice_was_active )); then systemctl restart friday-voice.service || true; fi
    else
      systemctl stop friday-dashboard.service || true
      systemctl stop friday-hermes-dashboard.service || true
      systemctl disable --now friday-voice.service >/dev/null 2>&1 || true
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
if [[ "$VOICE_MODE" == elevenlabs ]]; then
  voice_venv="$STATE/voice/.venv"
  venv_created=0
  if [[ ! -x "$voice_venv/bin/python" ]]; then
    runuser -u "$SERVICE" -- python3 -m venv "$voice_venv" || fail 'Python venv unavailable; install python3-venv and rerun.'
    venv_created=1
  fi
  requirements="$release/installer/linux/requirements-voice-cloud.txt"
  requirements_hash=$(sha256sum "$requirements" | cut -d' ' -f1)
  if (( venv_created )) || [[ ! -f "$STATE/voice/requirements.sha256" || "$(cat "$STATE/voice/requirements.sha256")" != "$requirements_hash" ]]; then
    runuser -u "$SERVICE" -- env HOME="$STATE" PIP_CACHE_DIR="$STATE/cache/pip" \
      "$voice_venv/bin/python" -m pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    runuser -u "$SERVICE" -- env HOME="$STATE" PIP_CACHE_DIR="$STATE/cache/pip" \
      "$voice_venv/bin/python" -m pip install -q -r "$requirements"
    runuser -u "$SERVICE" -- "$voice_venv/bin/python" -m pip freeze > "$STATE/voice/pip-freeze.txt"
    printf '%s\n' "$requirements_hash" > "$STATE/voice/requirements.sha256"
    chown "$SERVICE:$SERVICE" "$STATE/voice/pip-freeze.txt" "$STATE/voice/requirements.sha256"
  fi
  runuser -u "$SERVICE" -- env HOME="$STATE" HF_HOME="$STATE/cache/huggingface" \
    "$voice_venv/bin/python" "$release/installer/linux/prepare_voice.py" --prepare-assets
fi
chown -R root:root "$release"
chmod -R go-w "$release"

node_bin=$(command -v node)
gateway_backup=$(mktemp -d "$CONFIG/.hermes-rollback.XXXXXX")
chmod 0700 "$gateway_backup"
for file in hermes.env hermes-api.key friday-hermes-gateway.service; do
  case "$file" in
    hermes.env) original="$STATE/.hermes/.env" ;;
    hermes-api.key) original="$CONFIG/secrets/hermes-api.key" ;;
    *) original=/etc/systemd/system/friday-hermes-gateway.service ;;
  esac
  [[ ! -L "$original" ]] || fail "Unsafe symlink at $original"
  if [[ -f "$original" ]]; then cp -p -- "$original" "$gateway_backup/$file"; else touch "$gateway_backup/$file.absent"; fi
done
python3 "$release/installer/linux/configure_hermes_api.py" --port "$HERMES_API_PORT" || fail 'Hermes API configuration failed.'
voice_unit_backup=$(mktemp -d "$CONFIG/.voice-unit-rollback.XXXXXX")
chmod 0700 "$voice_unit_backup"
for unit in friday-voice.service friday-voice-activate.path friday-voice-activate.service; do
  if [[ -f "/etc/systemd/system/$unit" ]]; then cp -p -- "/etc/systemd/system/$unit" "$voice_unit_backup/$unit"; fi
done
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
Environment=FRIDAY_STATE_ROOT=$STATE
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
cat > /etc/systemd/system/friday-hermes-gateway.service <<UNIT
[Unit]
Description=Hermes local API gateway for Friday
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
ExecStart=$STATE/.local/bin/hermes gateway run --external-supervisor
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
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
if [[ "$VOICE_MODE" == elevenlabs ]]; then
cat > /etc/systemd/system/friday-voice.service <<UNIT
[Unit]
Description=Friday private browser audio voice service
After=network-online.target friday-dashboard.service friday-hermes-gateway.service
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=3

[Service]
Type=simple
User=$SERVICE
Group=$SERVICE
WorkingDirectory=$CURRENT
Environment=HOME=$STATE
Environment=HF_HOME=$STATE/cache/huggingface
Environment=FRIDAY_INSTALL_ROOT=$CURRENT
Environment=FRIDAY_STATE_ROOT=$STATE
Environment=FRIDAY_DATA_DIR=$STATE/data
Environment=FRIDAY_CONFIG_DIR=$CONFIG
Environment=FRIDAY_DASHBOARD_PORT=$FRIDAY_PORT
ExecStartPre=$STATE/voice/.venv/bin/python $CURRENT/installer/linux/prepare_voice.py --check-ready
ExecStart=$STATE/voice/.venv/bin/python $CURRENT/installer/voice/friday_voice.py --config $CONFIG/voice.json
Restart=on-failure
RestartSec=15
TimeoutStartSec=180
TimeoutStopSec=30
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
cat > /etc/systemd/system/friday-voice-activate.path <<UNIT
[Unit]
Description=Activate Friday voice after private owner enrollment

[Path]
PathExists=$STATE/voice/enrollment/activate
Unit=friday-voice-activate.service

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/friday-voice-activate.service <<UNIT
[Unit]
Description=Check and activate Friday browser voice
After=friday-dashboard.service friday-hermes-gateway.service

[Service]
Type=oneshot
ExecStart=/bin/bash $CURRENT/installer/linux/activate_voice.sh $CURRENT $STATE $CONFIG $VOICE_PORT $FRIDAY_PORT
TimeoutStartSec=180
UNIT
fi
systemctl daemon-reload
systemctl enable friday-dashboard.service friday-hermes-dashboard.service friday-hermes-gateway.service >/dev/null
ln -s "$release" "$CURRENT.next"
mv -Tf "$CURRENT.next" "$CURRENT"
promoted=1
systemctl restart friday-hermes-dashboard.service
curl -fsS --max-time 3 --retry 10 --retry-connrefused --retry-delay 2 -o /dev/null "http://127.0.0.1:$HERMES_PORT/" || fail 'Hermes dashboard did not become healthy.'
systemctl restart friday-hermes-gateway.service
hermes_api_ok=0
for ((attempt=0; attempt<15; attempt++)); do
  if python3 - "$HERMES_API_PORT" "$CONFIG/secrets/hermes-api.key" <<'PY'
import pathlib, sys, urllib.request
port, key_path = sys.argv[1:]
key = pathlib.Path(key_path).read_text(encoding="utf-8").strip()
request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/models",
                                 headers={"Authorization": f"Bearer {key}"})
try:
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=2) as response:
        if response.status != 200:
            raise SystemExit(1)
except (OSError, ValueError):
    raise SystemExit(1)
PY
  then hermes_api_ok=1; break; fi
  sleep 2
done
(( hermes_api_ok )) || fail 'Authenticated Hermes API did not become healthy.'
systemctl restart friday-dashboard.service
curl -fsS --max-time 3 --retry 15 --retry-connrefused --retry-delay 2 -o /dev/null "http://127.0.0.1:$FRIDAY_PORT/api/v1/health" || fail 'Friday dashboard did not become healthy.'
voice_backup=$(mktemp -d "$CONFIG/.voice-rollback.XXXXXX")
chmod 0700 "$voice_backup"
for file in voice.json elevenlabs.key alibaba-tokenplan.key adapters.yaml; do
  case "$file" in
    elevenlabs.key|alibaba-tokenplan.key) original="$CONFIG/secrets/$file" ;;
    *) original="$CONFIG/$file" ;;
  esac
  if [[ -f "$original" ]]; then cp -p -- "$original" "$voice_backup/$file"; else touch "$voice_backup/$file.absent"; fi
done
if [[ "$KEY_SOURCE" == stdin ]]; then
  printf '%s' "$KEY_STDIN_VALUE" | python3 "$SOURCE/installer/linux/configure_voice.py" "${voice_args[@]}" || fail 'Voice configuration could not be written.'
  unset KEY_STDIN_VALUE
else
  python3 "$SOURCE/installer/linux/configure_voice.py" "${voice_args[@]}" || fail 'Voice configuration could not be written.'
fi
if [[ "$VOICE_MODE" == elevenlabs ]]; then
  voice_python="$STATE/voice/.venv/bin/python"
  [[ -x "$voice_python" ]] || voice_python=python3
  if readiness=$(runuser -u "$SERVICE" -- env HOME="$STATE" HF_HOME="$STATE/cache/huggingface" \
      "$voice_python" "$release/installer/linux/prepare_voice.py" --check-ready 2>&1); then
    systemctl enable friday-voice.service >/dev/null
    systemctl restart friday-voice.service
    voice_ok=0
    for ((attempt=0; attempt<60; attempt++)); do
      if curl -fsS --max-time 3 "http://127.0.0.1:$VOICE_PORT/" 2>/dev/null | \
          python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["state"] in ("listening", "waiting_audio") and s["audio_transport"] == "browser"' 2>/dev/null; then
        voice_ok=1; break
      fi
      sleep 3
    done
    (( voice_ok )) || fail 'Voice service did not reach browser-audio standby state.'
    wake_phrase=$(python3 -c 'import json; print(json.load(open("/etc/friday/voice.json"))["wake_phrase"])')
    python3 "$release/installer/linux/enable_voice_adapter.py" --voice-port "$VOICE_PORT" --wake-phrase "$wake_phrase"
    systemctl restart friday-dashboard.service
    curl -fsS --max-time 3 --retry 15 --retry-connrefused --retry-delay 2 -o /dev/null \
      "http://127.0.0.1:$FRIDAY_PORT/api/v1/health" || fail 'Dashboard did not recover with the live voice adapter.'
    install -d -o "$SERVICE" -g "$SERVICE" -m 0700 "$STATE/voice/enrollment"
    install -o "$SERVICE" -g "$SERVICE" -m 0600 /dev/null "$STATE/voice/enrollment/active"
    note "VOICE_OK browser audio on loopback $VOICE_PORT/$((VOICE_PORT + 1))"
    systemctl disable --now friday-voice-activate.path >/dev/null 2>&1 || true
  else
    if (( voice_was_active )); then fail "Previously active voice no longer ready: $readiness"; fi
    systemctl disable --now friday-voice.service >/dev/null 2>&1 || true
    rm -f -- "$STATE/voice/enrollment/active"
    python3 "$release/installer/linux/enable_voice_adapter.py" --voice-port "$VOICE_PORT" --wake-phrase 'Hey Friday' --disable
    systemctl restart friday-dashboard.service
    curl -fsS --max-time 3 --retry 15 --retry-connrefused --retry-delay 2 -o /dev/null \
      "http://127.0.0.1:$FRIDAY_PORT/api/v1/health" || fail 'Dashboard did not recover with pending voice.'
    note "$readiness"
    systemctl enable --now friday-voice-activate.path >/dev/null
    note 'VOICE_PENDING: complete private owner speaker/wake enrollment on the Voice page; activation follows automatically.'
  fi
else
  systemctl disable --now friday-voice-activate.path >/dev/null 2>&1 || true
  systemctl disable --now friday-voice.service >/dev/null 2>&1 || true
  rm -f -- "$STATE/voice/enrollment/active"
  python3 "$release/installer/linux/enable_voice_adapter.py" --voice-port "$VOICE_PORT" --wake-phrase 'Hey Friday' --disable
  systemctl restart friday-dashboard.service
  curl -fsS --max-time 3 --retry 15 --retry-connrefused --retry-delay 2 -o /dev/null \
    "http://127.0.0.1:$FRIDAY_PORT/api/v1/health" || fail 'Dashboard did not recover after changing voice mode.'
  note 'VOICE_PENDING: native Linux local voice needs a dedicated GPU/TTS and local audio path; cloud browser voice is available with --voice-mode elevenlabs.'
fi
if [[ -n "$voice_backup" ]]; then
  rm -f -- "$voice_backup/voice.json" "$voice_backup/voice.json.absent" "$voice_backup/elevenlabs.key" "$voice_backup/elevenlabs.key.absent" "$voice_backup/alibaba-tokenplan.key" "$voice_backup/alibaba-tokenplan.key.absent" "$voice_backup/adapters.yaml" "$voice_backup/adapters.yaml.absent"
  rmdir -- "$voice_backup"
  voice_backup=
fi
if [[ -n "$voice_unit_backup" ]]; then
  rm -f -- "$voice_unit_backup/friday-voice.service" "$voice_unit_backup/friday-voice-activate.path" "$voice_unit_backup/friday-voice-activate.service"
  rmdir -- "$voice_unit_backup"
  voice_unit_backup=
fi
if [[ -n "$gateway_backup" ]]; then
  rm -f -- "$gateway_backup/hermes.env" "$gateway_backup/hermes.env.absent" "$gateway_backup/hermes-api.key" "$gateway_backup/hermes-api.key.absent" "$gateway_backup/friday-hermes-gateway.service" "$gateway_backup/friday-hermes-gateway.service.absent"
  rmdir -- "$gateway_backup"
  gateway_backup=
fi
promoted=0
note "INSTALL_OK release=$release dashboard=http://127.0.0.1:$FRIDAY_PORT hermes=http://127.0.0.1:$HERMES_PORT"
