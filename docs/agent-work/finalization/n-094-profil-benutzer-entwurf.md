# N-094: eigene Linux-Benutzer je Domain-Profil

Entscheidung ByteNinja, 2026-10-29: Jedes Domain-Profil bekommt einen eigenen Linux-Benutzer in `FRIDAY-2`.
Zugangsdaten liegen nur dort, wo das zuständige Profil sie lesen darf.

## Ausgangslage (Hermes v0.22.2, gelesen)

- Der Dispatcher startet Worker als Gateway-Benutzer `ubuntu` (`kanban_db_dispatch.py:_worker_argv`, `subprocess.Popen`
  über `systemd-run`). Er überwacht und beendet sie per `os.kill`, Fingerprint aus `/proc` und SQLite-Lease.
- Ein Benutzerwechsel am Worker-Prozess selbst würde Kanban-DB, Logs, Sessions und alle Kill-Pfade berühren und
  verlangt einen Hermes-Patch. Diesen Weg habe ich verworfen.
- Hermes bringt das Terminal-Backend `ssh` mit. Terminal- **und** Datei-Tools laufen dann im Zielkonto
  (`tools/file_tools.py` → `ShellFileOperations(terminal_env)`).
- Zugangsdateien überträgt Hermes nur, wenn ein Skill oder die Profilkonfiguration sie ausdrücklich anmeldet
  (`tools/credential_files.py:get_credential_file_mounts`).

## Umsetzung (`installer/wsl/setup_profile_isolation.sh`)

Aufruf als root in der Distribution: `status`, `apply`, `revert`, `render-sshd`.

Ablauf von `apply`:

1. Sichert `config.yaml` und `.env` jedes Profils nach `~/friday/backups/profile-isolation-<zeit>/`.
2. Installiert `openssh-server`, falls er fehlt. Drop-in `/etc/ssh/sshd_config.d/friday-agents.conf`:
   - nur `127.0.0.1:2222`, nur Schlüssel, kein root
   - `AllowUsers` nur für die sieben `friday-*`-Konten
   - keine Weiterleitungen
   - Socket-Aktivierung wird abgeschaltet, damit Port und Adresse gelten.
3. Je Profil `p`:
   - Benutzer `friday-<p>`: gesperrtes Passwort, Home 0750, `workspace/`.
   - Schlüssel in `~/.hermes/profiles/<p>/terminal-ssh/` (0700, Besitzer `ubuntu`).
   - `authorized_keys` mit `from="127.0.0.1,::1"` und ohne Weiterleitungen.
   - Hermes-Konfiguration des Profils: `terminal.backend ssh`, `ssh_host 127.0.0.1`, `ssh_port 2222`, `ssh_user friday-<p>`,
     `ssh_key`, `cwd /home/friday-<p>/workspace`.
4. Trägt den Host-Schlüssel aus `/etc/ssh/ssh_host_ed25519_key.pub` in `~ubuntu/.ssh/known_hosts` ein, ohne Netzabfrage.
5. Setzt die Rechte der Gateway-Seite: `/home/ubuntu` 0750, `~/.hermes` 0700, `~/.config/friday/{mail,calendar}` 0700.
   Die Agentenkonten sind nicht in der Gruppe `ubuntu`.

`revert` setzt alle Profile auf `terminal.backend local` und ihr bisheriges `cwd` zurück, entfernt das Drop-in und
stoppt sshd. Die Konten bleiben, damit nichts verloren geht, was ein Worker erzeugt hat.

## Grenzen

- Kanban-Tools, Modellaufrufe und das Gedächtnis-Plugin laufen weiter im Worker-Prozess als `ubuntu`. Getrennt wird,
  was das Modell frei steuern kann: Shell und Dateien.
- WSL leitet `localhost` je nach Einstellung auch von Windows weiter. Der Zugang bleibt schlüsselgebunden, und die
  Schlüssel liegen nur in `~ubuntu/.hermes` (0700).
- Braucht ein Profil Zugangsdaten (z. B. `communication` für Mail), meldet es sie per Skill oder Profilkonfiguration an.
  Hermes überträgt sie dann nur in das Konto dieses Profils.

## Abnahme (offen, braucht den Live-Lauf als root)

1. `setup_profile_isolation.sh status`: alle sieben Profile `backend: ssh`, Benutzer vorhanden, sshd `active`.
2. `research`-Testaufgabe führt `whoami` und `cat ~ubuntu/.config/friday/calendar/*` aus. Erwartet: `friday-research`
   und `Permission denied`.
3. `calendar`-Aufgabe und eine Statusabfrage laufen weiter. Abbruch, Laufzeitgrenze und Hänger-Rückholung beenden Worker
   wie zuvor, denn der Worker-Prozess ist unverändert.
