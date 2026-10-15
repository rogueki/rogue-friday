#!/bin/bash
# F.R.I.D.A.Y.-Installer, WSL-Migration (als Linux-Benutzer): bestehende Hermes-Einrichtung von C:\Jarvis nach C:\Friday
# umstellen, ohne Hermes neu zu installieren und ohne den Kimi-Schluessel erneut zu brauchen.
#   * ~/jarvis (Arbeitsordner des Installers) -> ~/friday
#   * /mnt/c/Jarvis -> /mnt/c/Friday in ~/.hermes/config.yaml, ~/.hermes/.env und den systemd-User-Diensten
#   * API_SERVER_MODEL_NAME=jarvis -> friday (die Sprachsteuerung fragt das Modell "friday" an)
#   * SOUL.md neu aus persona.json erzeugen (enthaelt die Windows-Pfade), alte Datei wird gesichert
#   * Hermes-Dienste neu starten und pruefen
# Idempotent: ein zweiter Lauf aendert nichts mehr. Ports per Umgebung ueberschreibbar (Tests).
set -euo pipefail

# Windows-PATH ist angehaengt; Linux-Programme muessen vorne stehen.
export PATH="$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
XDG_RUNTIME_DIR="/run/user/$(id -u)"
export XDG_RUNTIME_DIR
OLD="/mnt/c/Jarvis"
NEW="/mnt/c/Friday"
INST="${FRIDAY_INSTALLER:-$NEW/installer}"
CFG="${FRIDAY_CONFIG:-$NEW/config}"
DASH_PORT="${FRIDAY_DASH_PORT:-43691}"
API_PORT="${FRIDAY_API_PORT:-43693}"
H="$HOME/.hermes"
step() { printf '\n==> %s\n' "$*"; }

[ -d "$H" ] || { echo "FAIL $H fehlt - Hermes ist in diesem Linux-Benutzer nicht eingerichtet"; exit 1; }
[ -f "$CFG/persona.json" ] || { echo "FAIL $CFG/persona.json fehlt (Dateien wurden noch nicht nach C:\\Friday kopiert)"; exit 1; }

step "Arbeitsordner ~/jarvis -> ~/friday"
if [ -d "$HOME/jarvis" ] && [ ! -e "$HOME/friday" ]; then
    mv "$HOME/jarvis" "$HOME/friday"
    echo "umbenannt"
elif [ -d "$HOME/jarvis" ]; then
    echo "WARN ~/jarvis und ~/friday existieren beide - ~/jarvis bleibt unveraendert liegen (bitte von Hand zusammenfuehren)"
else
    mkdir -p "$HOME/friday"/{config,logs,scripts,services,integrations,skills,backups,tests}
    echo "nichts umzubenennen"
fi
mkdir -p "$HOME/friday/backups"

step "Pfade /mnt/c/Jarvis -> /mnt/c/Friday in Hermes-Konfiguration und systemd-Diensten"
patched=0
for f in "$H/config.yaml" "$H/.env" "$HOME"/.config/systemd/user/*.service; do
    [ -f "$f" ] || continue
    if grep -q "$OLD" "$f"; then
        cp "$f" "$HOME/friday/backups/$(basename "$f").pre-friday-$(date +%Y%m%d-%H%M%S)"
        sed -i "s#$OLD#$NEW#g" "$f"
        echo "angepasst: $f"
        patched=$((patched + 1))
    fi
done
echo "Dateien angepasst: $patched"
if [ -f "$H/config.yaml" ] && grep -q "$OLD" "$H/config.yaml"; then
    echo "FAIL $H/config.yaml enthaelt noch $OLD"; exit 1
fi
others="$(grep -rIl --exclude-dir=sessions --exclude-dir=logs --exclude-dir=cache --exclude-dir=node_modules --exclude-dir=.git \
    "$OLD" "$H" 2>/dev/null | head -20 || true)"
if [ -n "$others" ]; then
    echo "INFO weitere Hermes-Dateien nennen noch $OLD (z. B. eigene Skills/Notizen) und wurden nicht veraendert:"
    printf '%s\n' "$others" | sed 's/^/     /'
fi

step "Modellname fuer die Sprachsteuerung (API_SERVER_MODEL_NAME)"
touch "$H/.env" && chmod 600 "$H/.env"
if grep -q '^API_SERVER_MODEL_NAME=' "$H/.env"; then
    sed -i 's/^API_SERVER_MODEL_NAME=.*/API_SERVER_MODEL_NAME=friday/' "$H/.env"
else
    printf 'API_SERVER_MODEL_NAME=friday\n' >> "$H/.env"
fi
grep '^API_SERVER_MODEL_NAME=' "$H/.env"

step "Beschreibung des Dashboard-Dienstes"
UNIT="$HOME/.config/systemd/user/hermes-dashboard.service"
if [ -f "$UNIT" ]; then
    sed -i 's/^Description=Hermes Dashboard (JARVIS,/Description=Hermes Dashboard (F.R.I.D.A.Y.,/' "$UNIT"
fi

step "Persoenlichkeit (SOUL.md) neu erzeugen"
[ -f "$H/SOUL.md" ] && cp "$H/SOUL.md" "$HOME/friday/backups/SOUL.md.bak-$(date +%Y%m%d-%H%M%S)"
python3 "$INST/common/persona.py" "$CFG/persona.json" "$H/SOUL.md"

step "Hermes-Dienste neu starten"
for _ in $(seq 1 30); do
    [ -S "$XDG_RUNTIME_DIR/bus" ] && break
    sleep 2
done
[ -S "$XDG_RUNTIME_DIR/bus" ] || { echo "FAIL systemd-User-Bus ($XDG_RUNTIME_DIR/bus) nicht verfuegbar"; exit 1; }
systemctl --user daemon-reload
systemctl --user restart hermes-gateway.service
systemctl --user restart hermes-dashboard.service

step "Pruefen"
API_KEY="$(tr -d '\r\n' < "$CFG/hermes_api.key")"
for _ in $(seq 1 60); do
    curl -sf -o /dev/null "http://127.0.0.1:$DASH_PORT/" && break
    sleep 3
done
DASH="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DASH_PORT/" || true)"
for _ in $(seq 1 60); do
    curl -sf -o /dev/null -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$API_PORT/v1/models" && break
    sleep 3
done
API="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $API_KEY" "http://127.0.0.1:$API_PORT/v1/models" || true)"
echo "gateway=$(systemctl --user is-active hermes-gateway) dashboard=$(systemctl --user is-active hermes-dashboard) dashboard_http=$DASH api_http=$API"
if [ "$DASH" = "200" ] && [ "$API" = "200" ]; then
    echo "MIGRATE_WSL_DONE"
else
    echo "FAIL Dienste nicht erreichbar"; exit 1
fi
