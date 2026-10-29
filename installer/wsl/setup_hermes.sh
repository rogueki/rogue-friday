#!/bin/bash
# F.R.I.D.A.Y.-Installer, WSL-Teil 2 (als Linux-Benutzer): Hermes Agent + KI-Anbieter + Persoenlichkeit + Kanban +
# API-Server (fuer die Sprachsteuerung) + Dashboard + Gateway als systemd-Dienste.
# stdin: Zeile 1 = API-Key des gewaehlten Anbieters. Anbieter/Modell/Basis-URL: siehe unten. Ports per Umgebung ueberschreibbar (Tests).
set -euo pipefail
read -r KEY || true
# PowerShell 5.1 stellt beim Pipen ein UTF-8-BOM voran (getestet) - entfernen, ebenso CR/LF/Leerzeichen.
KEY="${KEY#$'\xEF\xBB\xBF'}"
KEY="$(printf '%s' "$KEY" | tr -d '\r\n ')"
[ -n "$KEY" ] || { echo "FAIL kein Kimi-API-Key uebergeben"; exit 1; }

# Windows-PATH ist angehaengt; Linux-Programme muessen vorne stehen.
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
INST="${FRIDAY_INSTALLER:-/mnt/c/Friday/installer}"
CFG="${FRIDAY_CONFIG:-/mnt/c/Friday/config}"
ROOT="${FRIDAY_ROOT:-/mnt/c/Friday}"
DASH_PORT="${FRIDAY_DASH_PORT:-43691}"
API_PORT="${FRIDAY_API_PORT:-43693}"
QWEN_PORT="${FRIDAY_QWEN_PORT:-43692}"
H="$HOME/.hermes"
HERMES_PIN="d923a5eb487a17c0a68801bba9ef0f56c81040a8"
step() { printf '\n==> %s\n' "$*"; }

step "Hermes Agent installieren"
if ! command -v hermes >/dev/null 2>&1; then
    curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh
    bash /tmp/hermes-install.sh --skip-setup --commit "$HERMES_PIN" </dev/null
    export PATH="$HOME/.local/bin:$PATH"
fi
hermes --version | head -1
HERMES_TREE="$H/hermes-agent"
[ -d "$HERMES_TREE/.git" ] || { echo "FAIL Hermes-Checkout nicht gefunden: $HERMES_TREE"; exit 1; }
[ "$(git -C "$HERMES_TREE" rev-parse HEAD)" = "$HERMES_PIN" ] || {
    echo "FAIL Hermes-Version entspricht nicht dem geprueften Friday-Pin $HERMES_PIN"; exit 1;
}
python3 "$INST/wsl/patch_hermes_run_stop.py" "$HERMES_TREE"
python3 "$INST/wsl/patch_hermes_cron_lock.py" "$HERMES_TREE"

step "Hermes MCP OAuth-Laufzeit"
# The Friday OAuth worker uses the same SDK and HTTP stack as pinned Hermes.
# Keep this after the pinned-source verification gate when installer patches are composed.
hermes pm install --extra mcp

step "KI-Anbieter"
# Anbieter, Modell und Basis-URL legt der Installer in $ROOT/exchange/model-setup.env ab (keine Secrets);
# der API-Key kommt weiterhin ueber stdin und landet nur in ~/.hermes/.env.
PROVIDER="custom"
MODEL=""
BASE_URL=""
MODEL_SETUP="$ROOT/exchange/model-setup.env"
if [ -f "$MODEL_SETUP" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$MODEL_SETUP"
    set +a
    PROVIDER="${FRIDAY_MODEL_PROVIDER:-custom}"
    MODEL="${FRIDAY_MODEL_NAME:-}"
    BASE_URL="${FRIDAY_MODEL_BASE_URL:-}"
fi
mkdir -p "$H"
touch "$H/.env" && chmod 600 "$H/.env"
# Anbieterkatalog, Authart und Variablenname kommen aus dem installierten Hermes. Ein selbst
# geratener Name wird abgelehnt, statt still eine falsche Konfiguration zu schreiben: "openai"
# ist z. B. kein Katalogeintrag, sondern ein Alias, den der Runtime-Resolver auf einen
# Aggregator abbildet. OAuth-Anbieter sind im Installer nicht anmeldbar und werden deshalb
# sichtbar abgelehnt statt halb eingerichtet.
CAPS="$(printf '{"names": ["%s"]}' "$PROVIDER" | python3 "$INST/wsl/hermes_config_bridge.py" provider-auth 2>/dev/null)" || CAPS=""
RESOLVED="$(printf '%s' "$CAPS" | python3 -c 'import json, sys
try:
    entry = json.load(sys.stdin)["providers"][0]
except Exception:
    raise SystemExit(3)
if not entry.get("offered"):
    raise SystemExit(4)
if entry.get("authType") != "api_key" and not (entry["id"] == "custom" and entry.get("offered")):
    raise SystemExit(5)
print(entry["id"])
print(entry.get("baseUrlEnvVar") or "")
print(",".join(entry.get("apiKeyEnvVars") or []))')" || RESOLVED=""
if [ -z "$RESOLVED" ]; then
    echo "FAIL Anbieter $PROVIDER ist in dieser Hermes-Version nicht als API-Key-Anbieter verfuegbar"
    exit 1
fi
PROVIDER="$(printf '%s' "$RESOLVED" | sed -n 1p)"
BASE_ENV="$(printf '%s' "$RESOLVED" | sed -n 2p)"
KEY_VAR="$(printf '%s' "$RESOLVED" | sed -n 3p | cut -d, -f1)"
if [ -z "$KEY_VAR" ]; then
    # Weder kimi-coding noch custom nennen in dieser Version eine Env-Variable; der Key gehoert
    # in den Credential-Pool. Die dokumentierten Variablen bleiben als Fallback, und der
    # Verbindungstest entscheidet, ob der Zugang wirklich traegt.
    case "$PROVIDER" in
        custom) KEY_VAR="OPENAI_API_KEY" ;;
        *) KEY_VAR="KIMI_API_KEY" ;;
    esac
    echo "HINWEIS: $PROVIDER nennt in dieser Version keine Env-Variable; $KEY_VAR dient als Fallback."
fi
case "$PROVIDER" in
    openai-api)
        [ -n "$MODEL" ] || MODEL=gpt-5
        BASE_URL=""
        ;;
    anthropic)
        [ -n "$MODEL" ] || MODEL=claude-sonnet-4-5
        BASE_URL=""
        ;;
    kimi-coding)
        [ -n "$MODEL" ] || MODEL=k3
        BASE_URL=""
        ;;
    custom)
        [ -n "$MODEL" ] || MODEL=deepseek-chat
        if [ -z "$BASE_URL" ]; then echo "FAIL Basis-URL fuer den eigenen Anbieter fehlt"; exit 1; fi
        ;;
    *)
        echo "FAIL Anbieter $PROVIDER ist nicht vorgesehen"
        exit 1
        ;;
esac
sed -i "/^${KEY_VAR}=/d" "$H/.env"
printf '%s=%s\n' "$KEY_VAR" "$KEY" >> "$H/.env"
# Eine alte Basis-URL darf einen anderen Anbieter nicht verfaelschen.
sed -i '/^OPENAI_BASE_URL=/d' "$H/.env"
if [ "$PROVIDER" = "custom" ]; then
    BASE_ENV="${BASE_ENV:-OPENAI_BASE_URL}"
    printf '%s=%s\n' "$BASE_ENV" "$BASE_URL" >> "$H/.env"
fi
unset KEY
hermes config set model.provider "$PROVIDER"
hermes config set model.default "$MODEL"
if [ "$PROVIDER" = "custom" ]; then
    # Hermes waehlt den Endpunkt eines eigenen Anbieters nur ueber model.base_url; die Env-Basis-URL bindet
    # lediglich den API-Key an diesen Host. Beide muessen deshalb auf dieselbe URL zeigen.
    hermes config set model.base_url "$BASE_URL"
fi
printf 'ANBIETER=%s MODELL=%s\n' "$PROVIDER" "$MODEL"
case "$PROVIDER" in
    anthropic|kimi-coding)
        # Beide laufen ueber den Anthropic-Client. Die Hermes-Basisinstallation bringt dieses optionale
        # Paket nicht in jedem Release mit; ohne es antwortet die API mit HTTP 500.
        hermes pm install --extra anthropic
        ;;
esac
hermes config set agent.reasoning_effort low
hermes config set stt.language de
hermes config set terminal.cwd "$ROOT/exchange"

if [ "${FRIDAY_PAID_PROVIDER_SMOKE_TEST:-0}" = "1" ]; then
    step "KI-Anbieter testen"
    OUT="$(timeout 240 hermes -z "Antworte exakt mit: MODEL_OK" </dev/null 2>&1 | tail -5 || true)"
    if printf '%s' "$OUT" | grep -q "MODEL_OK"; then echo "MODEL_OK"; else echo "WARN Modell-Test fehlgeschlagen: $OUT"; fi
else
    echo "Modell-Live-Test uebersprungen (keine kostenpflichtige Installationsprobe)."
fi

step "Persoenlichkeit (SOUL.md)"
[ -f "$H/SOUL.md" ] && cp "$H/SOUL.md" "$HOME/friday/backups/SOUL.md.bak-$(date +%Y%m%d-%H%M%S)"
python3 "$INST/common/persona.py" "$CFG/persona.json" "$H/SOUL.md" "$ROOT" "$QWEN_PORT" "$DASH_PORT"

step "API-Server fuer die Sprachsteuerung (nur 127.0.0.1:$API_PORT)"
API_KEY="$(tr -d '\r\n' < "$CFG/hermes_api.key")"
sed -i '/^API_SERVER_\(ENABLED\|HOST\|PORT\|KEY\|MODEL_NAME\)=/d' "$H/.env"
printf 'API_SERVER_ENABLED=true\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=%s\nAPI_SERVER_KEY=%s\nAPI_SERVER_MODEL_NAME=friday\n' \
    "$API_PORT" "$API_KEY" >> "$H/.env"

step "Kanban"
hermes kanban init >/dev/null
for b in business personal home research finance; do
    hermes kanban boards create "$b" --name "${b^}" >/dev/null 2>&1 || true
done
hermes kanban boards list | tail -n +1

step "Gateway als Dienst"
hermes gateway install </dev/null || true
systemctl --user enable hermes-gateway.service >/dev/null 2>&1 || true
systemctl --user restart hermes-gateway.service

step "Dashboard als Dienst (127.0.0.1:$DASH_PORT)"
# Restart=always: on-failure startet nach einem SIGTERM von aussen nicht neu (N-142); systemctl stop bleibt wirksam.
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/hermes-dashboard.service" <<UNIT
[Unit]
Description=Hermes Dashboard (F.R.I.D.A.Y., 127.0.0.1:$DASH_PORT)
After=network-online.target hermes-gateway.service

[Service]
Type=simple
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WorkingDirectory=$HOME
ExecStart=$HOME/.local/bin/hermes dashboard --host 127.0.0.1 --port $DASH_PORT --no-open --skip-build
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now hermes-dashboard.service

step "Pruefen"
for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://127.0.0.1:$DASH_PORT/" && break
    sleep 3
done
# "|| true": curl liefert bei "Verbindung abgelehnt" Exit 7; unter set -e wuerde das Skript sonst ohne FAIL-Meldung enden.
DASH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DASH_PORT/" || true)"
for _ in $(seq 1 60); do
    curl -sf -o /dev/null -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$API_PORT/v1/models" && break
    sleep 3
done
API="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$API_PORT/v1/models" || true)"
echo "gateway=$(systemctl --user is-active hermes-gateway) dashboard=$(systemctl --user is-active hermes-dashboard) dashboard_http=$DASH api_http=$API"
if [ "$DASH" = "200" ] && [ "$API" = "200" ]; then
    echo "HERMES_SETUP_DONE"
else
    echo "FAIL Dienste nicht erreichbar"; exit 1
fi
