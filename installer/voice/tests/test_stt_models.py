import os
import sys
import threading
import time
import types
import subprocess

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from stt_models import SttModels


def test_inventory_is_local_only_and_cloud_mode_does_not_import_whisper(monkeypatch, tmp_path):
    seen = []
    def local_model(model, *, local_files_only, cache_dir):
        seen.append((model, local_files_only, cache_dir))
        if model != "base":
            raise OSError("missing")
        path = tmp_path / "base"
        path.mkdir(exist_ok=True)
        (path / "model.bin").write_bytes(b"synthetic")
        return str(path)
    monkeypatch.setitem(sys.modules, "faster_whisper", types.ModuleType("faster_whisper"))
    utils = types.ModuleType("faster_whisper.utils")
    utils.download_model = local_model
    monkeypatch.setitem(sys.modules, "faster_whisper.utils", utils)
    status = SttModels(str(tmp_path)).status()
    assert status["models"] == [{"id": "base", "cached": True}, {"id": "small", "cached": False},
                                 {"id": "medium", "cached": False}]
    assert all(local and cache == str(tmp_path) for _, local, cache in seen)
    legacy = SttModels(str(tmp_path), current_model=lambda: "large-v3").status()
    assert legacy["models"][-1] == {"id": "large-v3", "cached": False}
    assert SttModels(str(tmp_path), local_mode=False).status()["models"] == []


def test_explicit_download_cancel_never_marks_model_ready(monkeypatch, tmp_path):
    finished = threading.Event()
    started = threading.Event()
    class FakeProcess:
        def __init__(self, command, **kwargs):
            assert command[-2:] == ["small", str(tmp_path)]
            self.terminated = False
            started.set()
        def wait(self, timeout=None):
            assert finished.wait(2)
            return 0
        def terminate(self):
            self.terminated = True
            finished.set()
        def poll(self):
            return None if not finished.is_set() else 0
    monkeypatch.setattr("stt_models.subprocess.Popen", FakeProcess)
    models = SttModels(str(tmp_path))
    monkeypatch.setattr(models, "status", lambda: {"job": dict(models.job)})
    assert models.start("small")["job"]["state"] == "downloading"
    assert started.wait(2)
    job_id = models.job["id"]
    assert models.cancel(job_id)["job"]["state"] in ("cancelling", "cancelled")
    for _ in range(100):
        if models.process is None:
            break
        time.sleep(.01)
    assert models.job["state"] == "cancelled"
    assert models.process is None
    assert models.job["id"] == job_id


def test_cancel_reaps_sigterm_ignoring_process_before_next_job(monkeypatch, tmp_path):
    first_waiting = threading.Event()
    release_first = threading.Event()
    processes = []
    class FakeProcess:
        def __init__(self, command, **kwargs):
            self.model = command[-2]
            self.killed = False
            self.terminated = False
            processes.append(self)
        def poll(self):
            return -9 if self.killed else None
        def terminate(self):
            self.terminated = True
        def kill(self):
            self.killed = True
        def wait(self, timeout=None):
            if timeout == 900 and self.model == "small":
                first_waiting.set()
                assert release_first.wait(3)
            if timeout == 5 and not self.killed:
                raise subprocess.TimeoutExpired("synthetic", timeout)
            return -9 if self.killed else 0
    monkeypatch.setattr("stt_models.subprocess.Popen", FakeProcess)
    models = SttModels(str(tmp_path))
    monkeypatch.setattr(models, "status", lambda: {"job": dict(models.job)})
    first = models.start("small")["job"]["id"]
    assert first_waiting.wait(2)
    assert models.cancel(first)["job"]["state"] == "cancelling"
    assert processes[0].terminated and processes[0].killed
    with pytest.raises(RuntimeError, match="already running"):
        models.start("base")
    release_first.set()
    for _ in range(100):
        if not models.busy:
            break
        time.sleep(.01)
    assert not models.busy and models.job["state"] == "cancelled"
    assert models.process is None
    second = models.start("base")["job"]["id"]
    assert second != first and models.job["state"] in ("downloading", "ready")
