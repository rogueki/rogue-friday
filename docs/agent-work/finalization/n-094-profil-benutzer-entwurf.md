# N-094: eigene Linux-Benutzer je Domain-Profil (Entwurf)

Entscheidung ByteNinja, 2026-10-29: Jedes Domain-Profil bekommt einen eigenen Linux-Benutzer in `FRIDAY-2`. Zugangsdaten
liegen nur dort, wo das zuständige Profil sie lesen darf.

## Ausgangslage (Hermes v0.22.2, gelesen)

- Der Dispatcher startet Worker als Gateway-Benutzer: `kanban_db_dispatch.py:_worker_argv`
  (`hermes -p <profil> … chat -q "work kanban task <id>"`) und `subprocess.Popen(..., start_new_session=True)` um Zeile 2949.
- Einen Mechanismus „als anderer Benutzer starten“ gibt es nicht, nur `docker_run_as_host_user` für Docker.
- Der Dispatcher beendet Worker über ihre PID: Laufzeitgrenze, `detect_stale_running`, Abbruch per `archive_task`.
- Das Gateway läuft im Multiplex-Modus und liest die `.env` aller Profile (`agent/secret_scope.py`). Es ist und bleibt die
  vertrauenswürdige Instanz. Getrennt werden die Worker untereinander.

## Zielbild

| Objekt | Besitzer:Gruppe | Modus |
|---|---|---|
| `~/.hermes/hermes-agent` (Code) | ubuntu:ubuntu | lesbar für alle |
| `~/.hermes/profiles/<p>` inkl. `.env`, `home/` | ubuntu:friday-<p> | 0750 / Dateien 0640 |
| `~/.hermes/kanban.db`, `kanban/` | ubuntu:friday-agents | 0660 / 0770 |
| Zugangsdaten Mail | Profil-Home `communication` | 0640 ubuntu:friday-communication |
| Zugangsdaten Kalender | Profil-Home `calendar` | 0640 ubuntu:friday-calendar |

- Benutzer `friday-<p>`: Systembenutzer ohne Login. Sie sind Mitglied von `friday-<p>` und `friday-agents`, aber nicht von
  `ubuntu`. Gruppen gibt es also je Profil plus `friday-agents`.
- sudoers (`/etc/sudoers.d/friday-agents`, 0440, mit `visudo -c` geprüft): `ubuntu` darf ohne Passwort genau zwei Dinge:
  den Hermes-Worker-Einstieg als `friday-*` starten und Signale an Prozesse dieser Benutzer senden. Beides läuft über ein
  festes Wrapper-Skript; kein freies `sudo`.

## Umsetzung (Reihenfolge)

1. **`installer/wsl/setup_profile_users.sh`** (idempotent): Benutzer und Gruppen anlegen, Rechte wie in der Tabelle
   setzen, sudoers schreiben und prüfen, vorher eine Sicherung der Rechte (`getfacl -R`).
2. **`installer/wsl/patch_hermes_worker_users.py`** (gepinnt wie `patch_hermes_run_stop.py`, mit Revisionsprüfung):
   - `_worker_argv` setzt den Wrapper `friday-agent-run <profil>` davor.
   - Signale an Worker gehen über `friday-agent-signal <pid> <sig>`.
   - Die Prüfung „gehört die PID uns“ akzeptiert `friday-*`-UIDs.
3. **Zugangsdaten verschieben:** Mail- und Kalenderablage unter das Profil-Home. Die Bridges der Control-API (laufen als
   `ubuntu`) lesen weiter über die Gruppe.
4. **Tests:**
   - Pester/pytest für Setup und Patch, gegen eine Kopie des Hermes-Quellcodes.
   - Live-Abnahme: Ein `research`-Worker versucht `cat` auf die Kalender-Zugangsdaten → `Permission denied`.
   - Der `calendar`-Worker liest sie.
   - Abbruch, Laufzeitgrenze und Hänger-Rückholung beenden Worker weiterhin (Lauf `stale`/`timed_out`).
5. **Rückweg:** Patch zurücknehmen (Revisionssicherung), Rechte aus `getfacl`-Sicherung zurückspielen, sudoers-Datei
   entfernen.

## Risiken

- Hermes-Updates überschreiben den Patch. Abhilfe: Revisionsprüfung im Patch wie bei `patch_hermes_run_stop.py`; der
  Update-Pfad wendet ihn erneut an.
- Worker schreiben Logs und Workspaces. Diese Pfade brauchen Gruppenrechte, sonst scheitert der Start (`spawn_failed`).
  Abfangen per Probelauf mit `--max-retries 1`.
