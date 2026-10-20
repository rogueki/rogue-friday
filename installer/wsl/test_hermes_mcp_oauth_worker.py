import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_config_bridge import lock_config, revision
from hermes_mcp_oauth_worker import current_entry, discard_stage, publish, write_state


class Storage:
    real_home = None
    stage_home = None

    def __init__(self, name, hermes_home=None):
        self.name = name
        self.home = Path(hermes_home) if hermes_home else self.real_home

    def _tokens_path(self): return self.home / "mcp-tokens" / f"{self.name}.json"
    def _client_info_path(self): return self.home / "mcp-tokens" / f"{self.name}.client.json"
    def _meta_path(self): return self.home / "mcp-tokens" / f"{self.name}.meta.json"
    def _state_paths(self): return self._tokens_path(), self._client_info_path(), self._meta_path()
    def has_cached_tokens(self): return self._tokens_path().is_file()


class OAuthWorkerTest(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.config = self.home / "config.yaml"
        self.config.write_text("mcp_servers:\n  sample:\n    url: https://mcp.example.org/mcp\n    enabled: true\n")
        self.expected = revision(self.config)
        self.flow = self.home / ".friday-mcp-oauth" / ("f" * 32)
        self.flow.mkdir(parents=True)
        Storage.real_home = self.home
        stage = self.flow / "stage"
        (stage / "mcp-tokens").mkdir(parents=True)
        (stage / "mcp-tokens" / "sample.json").write_text('{"access_token":"private"}')
        (stage / "mcp-tokens" / "sample.client.json").write_text('{"client_id":"c"}')
        self.storage = Storage("sample", stage)
        self.servers = {"sample": {"url": "https://mcp.example.org/mcp", "enabled": True}}

        def save(name, entry):
            self.servers[name] = entry
            self.config.write_text(yaml.safe_dump({"mcp_servers": self.servers}))
            return True

        module = types.ModuleType("hermes_cli.mcp_config")
        module._get_mcp_servers = lambda: self.servers
        module._save_mcp_server = save
        package = types.ModuleType("hermes_cli")
        package.__path__ = []
        patcher = patch.dict(sys.modules, {"hermes_cli": package, "hermes_cli.mcp_config": module})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_publication_checks_revision_and_writes_native_paths(self):
        new_revision = publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                               self.expected, self.storage)
        self.assertNotEqual(new_revision, self.expected)
        self.assertEqual(self.servers["sample"]["auth"], "oauth")
        self.assertEqual((self.home / "mcp-tokens" / "sample.json").read_text(),
                         '{"access_token":"private"}')
        self.assertFalse((self.home / "mcp-tokens" / "sample.json").stat().st_mode & 0o077)

    def test_foreign_config_change_prevents_publication(self):
        self.config.write_text("mcp_servers: {}\n")
        with self.assertRaisesRegex(ValueError, "revision_conflict"):
            publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                    self.expected, self.storage)
        self.assertFalse((self.home / "mcp-tokens" / "sample.json").exists())

    def test_failure_after_config_write_leaves_no_published_secret(self):
        original = Path.read_bytes
        with patch.object(Path, "read_bytes", autospec=True) as read:

            def fail_token(path):
                if path == self.storage._tokens_path():
                    raise OSError("synthetic storage failure")
                return original(path)

            read.side_effect = fail_token
            with self.assertRaises(OSError):
                publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                        self.expected, self.storage)
        self.assertNotIn("auth", self.servers["sample"])
        self.assertFalse((self.home / "mcp-tokens" / "sample.json").exists())

    def test_cancel_during_config_write_rolls_back_own_change(self):
        from hermes_cli import mcp_config
        original_save = mcp_config._save_mcp_server

        def cancel_after_save(name, entry):
            result = original_save(name, entry)
            if entry.get("auth") == "oauth":
                (self.flow / "cancel").touch()
            return result

        mcp_config._save_mcp_server = cancel_after_save
        with self.assertRaisesRegex(ValueError, "oauth_cancelled"):
            publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                    self.expected, self.storage)
        self.assertNotIn("auth", self.servers["sample"])
        self.assertFalse((self.home / "mcp-tokens" / "sample.json").exists())

    def test_foreign_write_during_config_save_is_preserved(self):
        from hermes_cli import mcp_config
        original_save = mcp_config._save_mcp_server

        def foreign_write_after_save(name, entry):
            result = original_save(name, entry)
            if entry.get("auth") == "oauth":
                self.servers[name] = {"url": "https://foreign.example.org/mcp", "enabled": True}
                self.config.write_text(yaml.safe_dump({"mcp_servers": self.servers}))
            return result

        mcp_config._save_mcp_server = foreign_write_after_save
        with self.assertRaisesRegex(ValueError, "concurrent_config_change"):
            publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                    self.expected, self.storage)
        self.assertEqual(self.servers["sample"]["url"], "https://foreign.example.org/mcp")
        self.assertFalse((self.home / "mcp-tokens" / "sample.json").exists())

    def test_terminal_state_is_written_before_config_lock_releases(self):
        from hermes_mcp_oauth_worker import write_state as real_write_state
        entered = threading.Event()
        release = threading.Event()
        acquired = threading.Event()
        outcomes = []

        def pause_at_terminal(flow_dir, status, **fields):
            if status == "configured":
                entered.set()
                self.assertTrue(release.wait(3))
            return real_write_state(flow_dir, status, **fields)

        def do_publish():
            try:
                outcomes.append(publish(self.flow, self.config, "sample", "https://mcp.example.org/mcp",
                                        self.expected, self.storage))
            except BaseException as error:
                outcomes.append(error)

        def do_cancel_lock():
            lock = lock_config(self.home)
            try:
                acquired.set()
                self.assertEqual(__import__("json").loads((self.flow / "state.json").read_text())["status"],
                                 "configured")
            finally:
                lock.close()

        with patch("hermes_mcp_oauth_worker.write_state", side_effect=pause_at_terminal):
            publisher = threading.Thread(target=do_publish)
            publisher.start()
            self.assertTrue(entered.wait(3))
            canceller = threading.Thread(target=do_cancel_lock)
            canceller.start()
            time.sleep(0.05)
            self.assertFalse(acquired.is_set())
            release.set()
            publisher.join(3)
            canceller.join(3)
        self.assertTrue(acquired.is_set())
        self.assertEqual(len(outcomes), 1)
        self.assertIsInstance(outcomes[0], int)

    def test_hard_deadline_kills_runtime_process_group(self):
        if os.name != "posix":
            return
        timeout = shutil.which("timeout")
        self.assertIsNotNone(timeout)
        marker = self.home / "late-publication"
        grandchild = "import pathlib,time;time.sleep(0.8);pathlib.Path(__import__('sys').argv[1]).touch()"
        parent = ("import subprocess,sys,time;"
                  "subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]);time.sleep(5)")
        result = subprocess.run([timeout, "--signal=KILL", "0.2s", sys.executable, "-c",
                                 parent, grandchild, str(marker)], start_new_session=True,
                                capture_output=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        time.sleep(0.9)
        self.assertFalse(marker.exists())

    def test_state_file_excludes_token_material(self):
        write_state(self.flow, "awaiting_approval", authorizationUrl="https://auth.example.org/authorize")
        state = (self.flow / "state.json").read_text()
        self.assertIn("awaiting_approval", state)
        self.assertNotIn("private", state)
        self.assertFalse((self.flow / "state.json").stat().st_mode & 0o077)

    def test_staged_tokens_are_removed_after_flow(self):
        discard_stage(self.flow)
        self.assertFalse((self.flow / "stage").exists())
        self.assertTrue(self.flow.exists())
