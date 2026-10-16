#!/bin/bash
# F.R.I.D.A.Y.-Installer, WSL-Teil 2 (als Linux-Benutzer): Hermes Agent + Kimi K3 + Persoenlichkeit + Kanban +
# API-Server (fuer die Sprachsteuerung) + Dashboard + Gateway als systemd-Dienste.
# stdin: Zeile 1 = Kimi-API-Key. Ports per Umgebung ueberschreibbar (Tests).
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
step() { printf '\n==> %s\n' "$*"; }

step "Hermes Agent installieren"
if ! command -v hermes >/dev/null 2>&1; then
    curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh
    bash /tmp/hermes-install.sh --skip-setup </dev/null
    export PATH="$HOME/.local/bin:$PATH"
fi
hermes --version | head -1

step "Kimi-Zugang"
mkdir -p "$H"
touch "$H/.env" && chmod 600 "$H/.env"
sed -i '/^KIMI_API_KEY=/d' "$H/.env"
printf 'KIMI_API_KEY=%s\n' "$KEY" >> "$H/.env"
unset KEY
if grep -q '^KIMI_API_KEY=sk-kimi-' "$H/.env"; then
    # Kimi-Code-Key (wie fuer die Kimi Code CLI): Provider kimi-coding, Modell k3 (bei uns verifiziert).
    hermes config set model.provider kimi-coding
    hermes config set model.default k3
    # Der Kimi-Coding-Provider verwendet den Anthropic-Client. Die Hermes-Basisinstallation
    # bringt dieses optionale Paket nicht in jedem Release mit; ohne es antwortet die API mit HTTP 500.
    hermes pm install --extra anthropic
else
    echo "WARN Key ist kein Kimi-Code-Key (sk-kimi-...). Bitte danach 'hermes model' ausfuehren und Kimi/Moonshot waehlen."
fi
hermes config set agent.reasoning_effort low
hermes config set stt.language de
hermes config set terminal.cwd "$ROOT/exchange"

step "Kimi K3 testen"
OUT="$(timeout 240 hermes -z "Antworte exakt mit: KIMI_K3_OK" </dev/null 2>&1 | tail -5 || true)"
if printf '%s' "$OUT" | grep -q "KIMI_K3_OK"; then echo "KIMI_OK"; else echo "WARN Kimi-Test fehlgeschlagen: $OUT"; fi

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
Restart=on-failure
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
