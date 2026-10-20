import base64
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import runtime_settings
import personal_wake
from wake_enrollment import WakeEnrollment


def test_phrase_bound_training_waits_for_explicit_apply_and_discards_private_samples(tmp_path, monkeypatch):
    protected = []
    monkeypatch.setattr(runtime_settings, "protect_private", lambda path, **kwargs: protected.append((path, kwargs)))
    state = tmp_path / "state"
    (state / "models" / "openwakeword").mkdir(parents=True)
    job = WakeEnrollment(str(tmp_path), str(state))
    with pytest.raises(runtime_settings.ConfigConflict):
        job.start("Hey Test", "revision", "stale", "process", "process", "Hey Friday")
    started = job.start("Hey Test", "revision", "revision", "process", "process", "Hey Friday")
    job_id = started["jobId"]
    assert (os.path.join(job.job["stage"], "raw"), {"directory": True}) in protected
    assert started["state"] == "capturing" and started["shortPhrase"] == "Test"
    sample = base64.b64encode(b"\0\0" * 8000).decode("ascii")
    with pytest.raises(ValueError):
        job.add_sample("wrong", "wake", sample)
    for kind, count in started["required"].items():
        for _ in range(count):
            job.add_sample(job_id, kind, sample)
    assert job.status()["counts"] == started["required"]
    attempts = []
    def train(_install, _state, phrase, raw_dir, cancel_event):
        attempts.append(True)
        if len(attempts) == 1:
            raise ValueError("synthetic model training failure")
        assert phrase == "Hey Test" and os.path.isfile(os.path.join(raw_dir, "wake_hey_test", "sample-01.wav"))
        output = state / "models" / "openwakeword" / "runtime-synthetic"
        output.mkdir()
        (output / "personal_wake.npz").write_bytes(b"model")
        (output / "personal_wake.json").write_text('{"wake_phrase":"Hey Test","quality":"gut"}', encoding="utf-8")
        return str(output / "personal_wake.npz"), str(output / "personal_wake.json")
    monkeypatch.setattr(runtime_settings, "prepare_personal_wake", train)
    monkeypatch.setattr(personal_wake.WindowModel, "load", lambda path: object())
    job.train(job_id)
    for _ in range(100):
        if job.status()["state"] != "training":
            break
        time.sleep(0.01)
    assert job.status()["state"] == "failed" and job.status()["error"]
    assert os.path.exists(os.path.join(job.job["stage"], "raw", "wake_hey_test", "sample-01.wav"))
    job.train(job_id)
    for _ in range(100):
        if job.status()["state"] != "training":
            break
        time.sleep(0.01)
    assert job.status()["state"] == "ready"
    assert job.status()["quality"] == "gut"
    assert not os.path.exists(os.path.join(job.job["stage"], "raw"))
    with pytest.raises(ValueError):
        job.prepared("Hey Other", "Hey Friday", "process", "revision", "revision")
    with pytest.raises(runtime_settings.ConfigConflict):
        job.prepared("Hey Test", "Hey Friday", "process", "new revision", "revision")
    model, _ = job.prepared("Hey Test", "Hey Friday", "process", "revision", "revision")
    job.job["created"] -= 61 * 60
    with pytest.raises(ValueError):
        job.prepared("Hey Test", "Hey Friday", "process", "revision", "revision")
    assert not os.path.exists(model)
    assert job.status()["state"] == "idle" and not os.path.exists(model)


def test_cancel_during_training_never_publishes_and_restart_cleans_stage(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime_settings, "protect_private", lambda *args, **kwargs: None)
    state = tmp_path / "state"
    (state / "models" / "openwakeword").mkdir(parents=True)
    job = WakeEnrollment(str(tmp_path), str(state))
    started = job.start("Testwort", "revision", "revision", "process", "process", "Hey Friday")
    job_id = started["jobId"]
    sample = base64.b64encode(b"\0\0" * 8000).decode("ascii")
    for kind, count in started["required"].items():
        for _ in range(count):
            job.add_sample(job_id, kind, sample)
    def train(*args):
        time.sleep(0.05)
        output = state / "models" / "openwakeword" / "runtime-synthetic"
        output.mkdir()
        (output / "personal_wake.npz").write_bytes(b"model")
        (output / "personal_wake.json").write_text('{"wake_phrase":"Testwort"}', encoding="utf-8")
        return str(output / "personal_wake.npz"), str(output / "personal_wake.json")
    monkeypatch.setattr(runtime_settings, "prepare_personal_wake", train)
    monkeypatch.setattr(personal_wake.WindowModel, "load", lambda path: object())
    job.train(job_id)
    job.discard(job_id)
    for _ in range(100):
        if job.status()["state"] == "idle":
            break
        time.sleep(0.01)
    assert job.status()["state"] == "idle"
    assert not (state / "models" / "openwakeword" / "runtime-synthetic").exists()
    orphan = state / "models" / "openwakeword" / ("enrollment-" + "a" * 32)
    orphan.mkdir()
    (orphan / "sample.wav").write_bytes(b"private")
    WakeEnrollment(str(tmp_path), str(state))
    assert not orphan.exists()


@pytest.mark.parametrize("content", [None, "{invalid", "[]"])
def test_startup_keeps_runtime_model_when_config_cannot_prove_it_is_inactive(tmp_path, content):
    base = tmp_path / "state" / "models" / "openwakeword"
    model = base / ("runtime-" + "a" * 32)
    model.mkdir(parents=True)
    (model / "personal_wake.npz").write_bytes(b"active or unknown")
    if content is not None:
        config = tmp_path / "config"
        config.mkdir()
        (config / "voice.json").write_text(content, encoding="utf-8")
    WakeEnrollment(str(tmp_path), str(tmp_path / "state"))
    assert (model / "personal_wake.npz").read_bytes() == b"active or unknown"
