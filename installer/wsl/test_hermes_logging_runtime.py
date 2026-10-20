"""Check the actual pinned Hermes file handler in a disposable profile."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PIN = "d923a5eb487a17c0a68801bba9ef0f56c81040a8"


@unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
class HermesLoggingRuntimeTest(unittest.TestCase):
    def test_native_handler_consumes_level_size_and_backups(self):
        source = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"])
        revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
        self.assertEqual(revision, PIN)
        with tempfile.TemporaryDirectory(prefix="friday-hermes-logging-") as directory:
            home = Path(directory)
            (home / "config.yaml").write_text(
                "logging:\n  level: DEBUG\n  max_size_mb: 7\n  backup_count: 4\n", encoding="utf-8"
            )
            code = (
                "import json, hermes_logging as h; "
                "h.setup_logging(); "
                "handlers=[x for x in h._queued_file_handlers "
                "if getattr(x,'baseFilename','').endswith('/agent.log')]; "
                "assert len(handlers)==1, len(handlers); "
                "x=handlers[0]; "
                "print(json.dumps({'level':x.level,'maxBytes':x.maxBytes,'backupCount':x.backupCount})); "
                "h._stop_queue_listener()"
            )
            env = {**os.environ, "HERMES_HOME": directory, "PYTHONPATH": str(source)}
            process = subprocess.run([sys.executable, "-c", code], env=env, text=True,
                                     capture_output=True, timeout=20, check=False)
            self.assertEqual(process.returncode, 0, process.stderr)
            observed = json.loads(process.stdout.strip().splitlines()[-1])
            self.assertEqual(observed, {"level": 10, "maxBytes": 7 * 1024 * 1024, "backupCount": 4})


if __name__ == "__main__":
    unittest.main()
