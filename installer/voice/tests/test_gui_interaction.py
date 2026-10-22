"""Tests fuer den Interaktions-Rueckkanal der Stimmaufnahme (nur Standardbibliothek)."""
import builtins
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gui_interaction as gi  # noqa: E402


class InteractionClientTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="friday-interaction-")
        self.request = os.path.join(self.directory, "gui-interaction.json")
        self.response = gi.response_path(self.request)

    def tearDown(self):
        for path in (self.request, self.response, self.request + ".tmp"):
            try:
                os.remove(path)
            except OSError:
                pass
        try:
            os.rmdir(self.directory)
        except OSError:
            pass

    def test_request_is_written_with_schema_and_counter(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)
        answered = {}

        def answer():
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.isfile(self.request):
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                    answered.update(request)
                    gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "ok"})
                    return
                time.sleep(0.02)
            raise AssertionError("Anfrage wurde nicht geschrieben.")

        worker = threading.Thread(target=answer)
        worker.start()
        action = client.ask("Aufnahme 3: sage 'Hey Friday'", title="Stimmaufnahme",
                            block="wake_hey_friday", index=3, total=44, timeout=10)
        worker.join(5)
        self.assertEqual("ok", action)
        self.assertEqual(1, answered["v"])
        self.assertEqual("record", answered["kind"])
        self.assertEqual("wake_hey_friday", answered["block"])
        self.assertEqual(3, answered["index"])
        self.assertEqual(44, answered["total"])
        self.assertEqual(["ok", "replay", "skip", "cancel"], answered["actions"])
        self.assertEqual(12, len(answered["id"]))
        self.assertFalse(os.path.exists(self.response), "Die Antwort muss nach dem Lesen verschwinden.")

    def test_cancel_raises_and_cleans_up(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)

        def answer():
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.isfile(self.request):
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                    gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "cancel"})
                    return
                time.sleep(0.02)

        threading.Thread(target=answer).start()
        with self.assertRaises(gi.InteractionCancelled):
            client.ask("Weiter?", title="Stimmaufnahme", timeout=10)
        self.assertFalse(os.path.exists(self.response))

    def test_replay_is_a_normal_action(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)
        client.ask  # Signatur bleibt bewusst gleich; die Aktion kommt aus der Antwort.

        def answer():
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.isfile(self.request):
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                    gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "replay"})
                    return
                time.sleep(0.02)

        threading.Thread(target=answer).start()
        self.assertEqual("replay", client.ask("Anhoeren?", title="Stimmaufnahme", timeout=10))

    def test_stale_answer_is_ignored(self):
        """Eine Antwort mit fremder Kennung darf die neue Anfrage nicht bestaetigen."""
        client = gi.InteractionClient(self.request, poll_seconds=0.05)
        gi.write_json_atomic(self.response, {"v": 1, "id": "fremdkennung", "action": "ok"})

        def answer():
            deadline = time.monotonic() + 5
            seen_own = False
            while time.monotonic() < deadline:
                try:
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                except (OSError, ValueError):
                    time.sleep(0.02)
                    continue
                if seen_own:
                    time.sleep(0.05)
                seen_own = True
                gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "skip"})
                return
            raise AssertionError("Anfrage wurde nicht geschrieben.")

        threading.Thread(target=answer).start()
        self.assertEqual("skip", client.ask("Weiter?", title="Stimmaufnahme", timeout=15))

    def test_timeout_reports_failure_instead_of_success(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)
        with self.assertRaises(gi.InteractionTimeout):
            client.ask("Niemand antwortet", title="Stimmaufnahme", timeout=1)

    def test_unknown_action_is_rejected(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)

        def answer():
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.isfile(self.request):
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                    gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "springen"})
                    return
                time.sleep(0.02)

        threading.Thread(target=answer).start()
        with self.assertRaises(gi.InteractionError):
            client.ask("Weiter?", title="Stimmaufnahme", timeout=10)

    def test_no_stdin_reading(self):
        """Die Aufnahme darf nie auf eine unsichtbare Eingabe warten."""
        original_input = builtins.input

        def forbidden(*_args, **_kwargs):
            raise AssertionError("Die Aufnahme hat stdin gelesen.")

        client = gi.InteractionClient(self.request, poll_seconds=0.05)

        def answer():
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if os.path.isfile(self.request):
                    with open(self.request, encoding="utf-8") as handle:
                        request = json.load(handle)
                    gi.write_json_atomic(self.response, {"v": 1, "id": request["id"], "action": "ok"})
                    return
                time.sleep(0.02)

        builtins.input = forbidden
        try:
            threading.Thread(target=answer).start()
            self.assertEqual("ok", client.ask("Weiter?", title="Stimmaufnahme", timeout=10))
        finally:
            builtins.input = original_input

    def test_close_removes_both_files(self):
        client = gi.InteractionClient(self.request, poll_seconds=0.05)
        gi.write_json_atomic(self.request, {"v": 1, "id": "x"})
        gi.write_json_atomic(self.response, {"v": 1, "id": "x", "action": "ok"})
        client.close()
        self.assertFalse(os.path.exists(self.request))
        self.assertFalse(os.path.exists(self.response))

    def test_empty_path_is_refused(self):
        with self.assertRaises(gi.InteractionError):
            gi.InteractionClient("")


if __name__ == "__main__":
    unittest.main(verbosity=2)
