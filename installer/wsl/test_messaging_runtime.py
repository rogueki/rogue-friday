from datetime import datetime, timezone, timedelta
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("messaging_runtime", Path(__file__).with_name("messaging_runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class GatewayRuntimeTest(unittest.TestCase):
    def test_live_writer_identity_required_for_connected(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            pid = os.getpid()
            start = int(Path(f"/proc/{pid}/stat").read_text().rsplit(") ", 1)[1].split()[19])
            record = {"pid": pid, "start_time": start, "hermes_home": str(home),
                      "updated_at": datetime.now(timezone.utc).isoformat(),
                      "platforms": {"telegram": {"state": "connected", "writer_pid": pid, "writer_start_time": start}}}
            path = home / "gateway_state.json"
            path.write_text(json.dumps(record))
            with mock.patch.object(runtime.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=str(pid))):
                self.assertEqual(runtime.platform_state(home, "telegram"), "connected")
                record["platforms"]["telegram"]["writer_start_time"] = start + 1
                path.write_text(json.dumps(record))
                self.assertEqual(runtime.platform_state(home, "telegram"), "unknown")
                record["platforms"]["telegram"]["writer_start_time"] = start
                record["updated_at"] = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
                path.write_text(json.dumps(record))
                self.assertEqual(runtime.platform_state(home, "telegram"), "unknown")


if __name__ == "__main__":
    unittest.main()
