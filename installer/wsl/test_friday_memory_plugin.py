import json
from contextlib import closing
import os
import sqlite3
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import friday_memory_plugin as plugin


class HermesMemoryPluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch.object(plugin, "OUTBOX", self.root / "queue.sqlite"),
                        patch.object(plugin, "HOME", self.root),
                        patch.object(plugin, "CONFIG", self.root / "bridge.json"),
                        patch.object(plugin, "KEY", self.root / "bridge.key")]
        for item in self.patches:
            item.start()
        plugin._private_sessions.clear()
        self.policy = self.root / "api.sqlite"
        with closing(sqlite3.connect(self.policy)) as db:
            db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            db.execute("INSERT INTO metadata VALUES('capture_settings',?)", (json.dumps({
                "enabled": True, "privateMode": False, "channels": {"hermes": True}}),))
            db.commit()
        plugin.CONFIG.write_text(json.dumps({"port": 3100, "ownerCli": True, "settingsDb": str(self.policy)}), encoding="utf-8")
        plugin.KEY.write_text("A" * 43 + "=", encoding="ascii")

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        plugin._private_sessions.clear()
        self.temp.cleanup()

    def test_eligible_cli_is_sanitized_before_durable_enqueue_and_retrieves_data_context(self):
        kwargs = {"platform": "cli", "session_id": "s1", "turn_id": "t1", "user_message": "Mein Passwort ist hunter2"}
        with patch.object(plugin, "_request", return_value={"data": {"items": [{"source": "vault", "text": "decision", "occurredAt": "today"}]}}):
            context = plugin._pre(**kwargs)
        self.assertIn("untrusted data", context["context"])
        with plugin._db() as db:
            rows = db.execute("SELECT data FROM events").fetchall()
        self.assertEqual(len(rows), 1)
        self.assertNotIn("hunter2", rows[0][0])
        self.assertIn("[Zugangsdaten entfernt]", rows[0][0])
        if os.name != "nt":
            self.assertEqual(plugin.OUTBOX.stat().st_mode & 0o777, 0o600)
        plugin._post(**kwargs, assistant_response="Erledigt")
        with plugin._db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 2)

    def test_private_session_and_non_cli_never_queue(self):
        plugin._pre(platform="gateway", session_id="s1", turn_id="t1", user_message="geheim")
        plugin._pre(platform="cli", session_id="s1", turn_id="t2", user_message="Bitte speichere dieses Gespräch nicht")
        plugin._post(platform="cli", session_id="s1", turn_id="t2", assistant_response="Okay")
        plugin._pre(platform="cli", session_id="s1", turn_id="t3", user_message="Privates Detail")
        plugin._pre(platform="cli", session_id="s2", turn_id="t1", user_message="Do not save this conversation")
        plugin._post(platform="cli", session_id="s2", turn_id="t1", assistant_response="Okay")
        plugin._pre(platform="cli", session_id="s2", turn_id="t2", user_message="Following private turn")
        with plugin._db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)

    def test_failed_delivery_survives_and_terminal_tombstone_ack_purges(self):
        event = plugin._event("s2", "t1", "user", "Shopping")
        plugin._enqueue(event)
        with patch.object(plugin, "_request", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                plugin._drain()
        with plugin._db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
        with patch.object(plugin, "_request", return_value={"data": {"eventId": event["eventId"], "accepted": False}}):
            plugin._drain()
        with plugin._db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)

    def test_private_switch_purges_pending_without_delivery(self):
        plugin._enqueue(plugin._event("s3", "t1", "user", "Prior decision"))
        with closing(sqlite3.connect(self.policy)) as db:
            db.execute("UPDATE metadata SET value=? WHERE key='capture_settings'", (json.dumps({
                "enabled": True, "privateMode": True, "channels": {"hermes": True}}),))
            db.commit()
        with patch.object(plugin, "_request") as send:
            plugin._drain()
            send.assert_not_called()
        with plugin._db() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
