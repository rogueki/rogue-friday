#!/bin/bash
# F.R.I.D.A.Y.-Installer, WSL-Teil 1 (als root): Pakete, Linux-Benutzer, systemd, Standardbenutzer.
# stdin: Zeile 1 = Benutzername, Zeile 2 = Passwort (kommt vom Windows-Installer, landet nirgends auf Platte).
set -euo pipefail
# "|| [[ -n ... ]]": a last line without newline ends read with EOF; under set -e that stopped the script silently.
read -r U || [[ -n "${U:-}" ]]
IFS= read -r PW || [[ -n "${PW:-}" ]]   # IFS leer: Passwort mit fuehrenden/abschliessenden Leerzeichen bleibt unveraendert
# PowerShell 5.1 stellt beim Pipen ein UTF-8-BOM voran (getestet) - entfernen, ebenso CR.
U="${U#$'\xEF\xBB\xBF'}"; U="${U//$'\r'/}"; PW="${PW//$'\r'/}"
[[ "$U" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "FAIL ungueltiger Benutzername"; exit 1; }

echo "==> Systempakete"
export DEBIAN_FRONTEND=noninteractive
# Without name resolution apt only reports cryptic fetch errors; say what is wrong and what helps.
if ! getent hosts archive.ubuntu.com >/dev/null 2>&1; then
    echo "FAIL Ubuntu erreicht das Internet nicht (Namensaufloesung/DNS fuer archive.ubuntu.com fehlgeschlagen)."
    echo "FAIL Hilfe: in %UserProfile%\.wslconfig unter [wsl2] 'dnsTunneling=true' setzen oder den Eintrag 'networkingMode=mirrored' entfernen, dann 'wsl --shutdown' und die Installation erneut starten."
    exit 1
fi
apt-get update -qq || { echo "FAIL apt-get update fehlgeschlagen (Paketquellen nicht erreichbar)."; exit 1; }
apt-get install -y -qq curl git ca-certificates libatomic1 python3 python3-yaml python3-venv python3-dev build-essential \
    ffmpeg libsndfile1 jq >/dev/null

echo "==> Benutzer $U"
id "$U" >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo "$U"
echo "$U:$PW" | chpasswd
unset PW

echo "==> /etc/wsl.conf (systemd, Standardbenutzer)"
cat > /etc/wsl.conf <<CONF
[boot]
systemd=true

[user]
default=$U

[interop]
enabled=true
appendWindowsPath=true

[automount]
options = "metadata,umask=22,fmask=11"
CONF

# Benutzer-systemd ohne offene Sitzung starten (Hermes-Gateway/Dashboard laufen als User-Services).
mkdir -p /var/lib/systemd/linger && touch "/var/lib/systemd/linger/$U"
su - "$U" -c 'mkdir -p ~/friday/{config,logs,scripts,services,integrations,skills,backups,tests}'
echo "ROOT_SETUP_DONE"
