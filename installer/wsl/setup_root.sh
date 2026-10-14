#!/bin/bash
# JARVIS-Installer, WSL-Teil 1 (als root): Pakete, Linux-Benutzer, systemd, Standardbenutzer.
# stdin: Zeile 1 = Benutzername, Zeile 2 = Passwort (kommt vom Windows-Installer, landet nirgends auf Platte).
set -euo pipefail
read -r U
read -r PW
# PowerShell 5.1 stellt beim Pipen ein UTF-8-BOM voran (getestet) - entfernen, ebenso CR.
U="${U#$'\xEF\xBB\xBF'}"; U="${U//$'\r'/}"; PW="${PW//$'\r'/}"
[[ "$U" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || { echo "FAIL ungueltiger Benutzername"; exit 1; }

echo "==> Systempakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates libatomic1 python3 python3-venv python3-dev build-essential \
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
su - "$U" -c 'mkdir -p ~/jarvis/{config,logs,scripts,services,integrations,skills,backups,tests}'
echo "ROOT_SETUP_DONE"
