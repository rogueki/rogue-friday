"""Testhilfe: modelliert die Aufnahme fuer den Interaktionsvertrag (kein Produktivpfad).

Liest die Bibliothek der Aufnahme, stellt eine Anfrage und beendet sich wie enroll_record.py:
Exitcode 2 bei Abbruch, sonst die gewaehlte Aktion als JSON auf stdout.
"""
import json
import sys

sys.path.insert(0, sys.argv[1])
import gui_interaction as gi  # noqa: E402

client = gi.InteractionClient(sys.argv[2], poll_seconds=0.05)
try:
    answer = client.ask("Aufnahme 3: sage 'Hey Friday'", title="Stimmaufnahme",
                        block="wake_hey_friday", index=3, total=44, timeout=20)
except gi.InteractionCancelled:
    sys.exit(2)
except gi.InteractionTimeout:
    sys.exit(3)
print(json.dumps({"action": answer}))