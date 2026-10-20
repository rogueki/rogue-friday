"""Exercise CAS mutations against a disposable pinned Hermes source and profile."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import hermes_cron_mutate as mutator
import patch_hermes_cron_lock as patcher


@unittest.skipUnless(os.environ.get("FRIDAY_HERMES_SOURCE_FIXTURE"), "opt-in pinned source checkout")
class NativeCronMutationTest(unittest.TestCase):
    def test_create_pause_resume_and_stale_revision_on_real_native_store(self):
        official = Path(os.environ["FRIDAY_HERMES_SOURCE_FIXTURE"])
        self.assertEqual(subprocess.check_output(["git", "-C", str(official), "rev-parse", "HEAD"], text=True).strip(), mutator.PIN)
        with tempfile.TemporaryDirectory(prefix="friday-native-cron-") as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            for item in official.iterdir():
                if item.name == "cron":
                    cron = source / "cron"
                    cron.mkdir()
                    for child in item.iterdir():
                        if child.name == "jobs.py":
                            shutil.copyfile(child, cron / child.name)
                        else:
                            (cron / child.name).symlink_to(child, target_is_directory=child.is_dir())
                elif item.name == "tools":
                    tools = source / "tools"
                    tools.mkdir()
                    for child in item.iterdir():
                        (tools / child.name).symlink_to(child, target_is_directory=child.is_dir())
                    heredoc = tools / "shell_heredoc.py"
                    if not heredoc.exists():
                        heredoc.write_bytes(subprocess.check_output(
                            ["git", "-C", str(official), "show", "HEAD:tools/shell_heredoc.py"]))
                else:
                    (source / item.name).symlink_to(item, target_is_directory=item.is_dir())
            self.assertEqual(patcher.apply(source), "patched")
            home = root / ".hermes"
            home.mkdir()
            code = '''import hashlib,json,os,subprocess,sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
sys.path.insert(0,os.environ["FRIDAY_MUTATOR_DIR"])
from hermes_cron_mutate import mutate
source=Path(os.environ["FRIDAY_MUTATOR_SOURCE"])
empty=hashlib.sha256(b'{"jobs":[]}').hexdigest()
base={"expectedStoreRevision":empty,"profile":"default","profileTimezone":None}
created=mutate(source,{**base,"action":"create","name":"Fixture","schedule":"30m","prompt":"PRIVATE-PROMPT"})
assert created["state"]=="paused",created
assert created["executionVerified"] is False
assert "PRIVATE" not in str(created)
try:
    mutate(source,{**base,"action":"pause","jobId":created["jobId"]})
except ValueError as exc:
    assert str(exc)=="store_revision_conflict",str(exc)
paused=mutate(source,{**base,"expectedStoreRevision":created["storeRevision"],"action":"pause","jobId":created["jobId"]})
resumed=mutate(source,{**base,"expectedStoreRevision":paused["storeRevision"],"action":"resume","jobId":created["jobId"]})
assert resumed["state"]=="scheduled",resumed
updated=mutate(source,{**base,"expectedStoreRevision":resumed["storeRevision"],"action":"update","jobId":created["jobId"],"name":"Renamed","schedule":"45m","prompt":"PRIVATE-UPDATED"})
queued=mutate(source,{**base,"expectedStoreRevision":updated["storeRevision"],"action":"run","jobId":created["jobId"]})
assert queued["executionVerified"] is False,queued
removed=mutate(source,{**base,"expectedStoreRevision":queued["storeRevision"],"action":"remove","jobId":created["jobId"]})
assert removed["state"]=="removed",removed
worker=''' + repr('''import json,os,sys
from pathlib import Path
sys.path.insert(0,os.environ["FRIDAY_MUTATOR_DIR"])
from hermes_cron_mutate import mutate
try:
 print(json.dumps({"receipt":mutate(Path(os.environ["FRIDAY_MUTATOR_SOURCE"]),json.loads(sys.argv[1]))}))
except ValueError as exc:
 print(json.dumps({"error":str(exc)}))
''') + '''
def concurrent_create(index):
 request={**base,"expectedStoreRevision":removed["storeRevision"],"action":"create","name":f"Concurrent {index}","schedule":"30m","prompt":"PRIVATE-CONCURRENT"}
 return subprocess.run([sys.executable,"-c",worker,json.dumps(request)],capture_output=True,text=True,check=True)
with ThreadPoolExecutor(max_workers=2) as pool:
 outcomes=[json.loads(process.stdout) for process in pool.map(concurrent_create,(1,2))]
assert sum("receipt" in outcome for outcome in outcomes)==1,outcomes
assert sum(outcome.get("error")=="store_revision_conflict" for outcome in outcomes)==1,outcomes
assert "PRIVATE-CONCURRENT" not in str(outcomes)
print(json.dumps({"jobId":created["jobId"],"state":removed["state"]}))
'''
            env = {**os.environ, "HOME": str(root), "HERMES_HOME": str(home), "FRIDAY_MUTATOR_SOURCE": str(source),
                   "FRIDAY_MUTATOR_DIR": str(Path(__file__).parent), "PYTHONPATH": str(source)}
            process = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(process.returncode, 0, process.stderr)
            self.assertIn('"state": "removed"', process.stdout)
            self.assertNotIn("PRIVATE-PROMPT", process.stdout)
            self.assertNotIn("PRIVATE-UPDATED", process.stdout)
            self.assertTrue((home / "cron" / "jobs.json").exists())
            (home / "hermes-agent").symlink_to(source, target_is_directory=True)
            stale = {"action": "pause", "expectedStoreRevision": hashlib.sha256(b'RUNNING-OLD-STORE').hexdigest(),
                     "profile": "default", "profileTimezone": None, "jobId": "012345abcdef"}
            cli = subprocess.run([sys.executable, str(Path(mutator.__file__)), "mutate"],
                                 input=json.dumps(stale), env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(cli.returncode, 0, cli.stderr)
            self.assertEqual(json.loads(cli.stdout), {"error": "store_revision_conflict"})


if __name__ == "__main__":
    unittest.main()
