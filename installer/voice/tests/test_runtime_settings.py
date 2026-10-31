import os
import sys
import time
import wave
import subprocess
import threading
import pytest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import runtime_settings


def requested(**overrides):
    return {"wakeWordEnabled": True, "wakeWord": "Hey Friday", "pushToTalkKey": "Ctrl+Space",
            "speakerVerificationRequired": True, "storeRawRecordings": False,
            "voiceHistoryEnabled": True, "sttLanguage": "de", "sttModel": None,
            "conversationBackend": "local", "ttsRate": 1.0, **overrides}


def test_validation_rejects_invalid_phrase_and_implicit_recording():
    cfg = {"wake_phrase": "Hey Friday"}
    for value in (requested(wakeWord="Hey 123"),
                  requested(pushToTalkKey="Ctrl+Alt+Delete"), {**requested(), "storeRawRecordings": "true"},
                   requested(sttLanguage="zz"), requested(sttModel="../remote/path"), requested(sttModel="base.en")):
        try:
            runtime_settings.validate(value, cfg)
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe voice policy was accepted")
    applied = runtime_settings.validate(requested(wakeWordEnabled=False, voiceHistoryEnabled=False), cfg)
    assert runtime_settings.effective(applied) == requested(wakeWordEnabled=False, voiceHistoryEnabled=False)
    assert applied["store_raw_recordings"] is False
    assert runtime_settings.validate(requested(speakerVerificationRequired=False), cfg)["speaker_verification_required"] is False
    assert runtime_settings.validate(requested(wakeWord="Hey Someone"), cfg)["wake_phrase"] == "Hey Someone"
    updated = runtime_settings.validate(requested(sttLanguage="en", sttModel="base"), cfg)
    assert updated["stt_language"] == "en" and updated["whisper_model"] == "base"


def test_conversation_backend_requires_known_value_and_stored_key(tmp_path):
    cfg = {"wake_phrase": "Hey Friday", "qwen_key_file": str(tmp_path / "alibaba_tokenplan.key.dpapi")}
    with pytest.raises(ValueError):
        runtime_settings.validate(requested(conversationBackend="cloud"), cfg)
    with pytest.raises(ValueError, match="not configured"):
        runtime_settings.validate(requested(conversationBackend="qwen"), cfg)
    (tmp_path / "alibaba_tokenplan.key.dpapi").write_text("x", encoding="utf-8")
    applied = runtime_settings.validate(requested(conversationBackend="qwen"), cfg)
    assert applied["conversation_backend"] == "qwen"
    assert runtime_settings.effective(applied)["conversationBackend"] == "qwen"
    assert runtime_settings.effective({})["conversationBackend"] == "local"


def test_history_off_drops_entries_and_raw_recording_only_writes_accepted_command(tmp_path):
    enabled = True
    history = runtime_settings.PrivacyHistory(lambda: enabled)
    history += [{"content": "first"}]
    enabled = False
    history.clear()
    history += [{"content": "private"}]
    assert history == []
    assert not (tmp_path / "recordings").exists()
    path = runtime_settings.record_command(str(tmp_path), np.ones(1600, dtype=np.float32) * .25)
    with wave.open(path, "rb") as recording:
        assert recording.getnframes() == 1600
    if os.name == "posix":
        assert os.stat(path).st_mode & 0o077 == 0
    else:
        env = {**os.environ, "FRIDAY_TEST_RECORDING_PATH": path}
        sddl = subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                                        "(Get-Acl -LiteralPath $env:FRIDAY_TEST_RECORDING_PATH).Sddl"],
                                       env=env, text=True).strip()
        assert "(A;" in sddl and "WD" not in sddl and "BU" not in sddl and "AU" not in sddl
    os.utime(path, (time.time() - 25 * 3600, time.time() - 25 * 3600))
    runtime_settings.record_command(str(tmp_path), np.zeros(1600, dtype=np.float32))
    assert not os.path.exists(path)


def test_tts_rate_changes_playback_duration():
    samples = np.linspace(-1, 1, 1600, dtype=np.float32)
    assert len(runtime_settings.pace(samples, 2)) == 800
    assert len(runtime_settings.pace(samples, .5)) == 3200
    assert runtime_settings.pace(samples, 1) is samples


def test_native_push_to_talk_edges_and_live_key_switch():
    current = {"key": "Ctrl+Space", "down": False}
    actions = []
    controller = runtime_settings.NativePushToTalk(
        lambda: current["key"], lambda key: current["down"],
        lambda: actions.append("start"), lambda: actions.append("release"))
    controller.step()
    current["down"] = True
    controller.step()
    controller.step()
    assert actions == ["start"]
    current["key"] = "F13"
    current["down"] = False
    controller.step()
    assert actions == ["start", "release"]
    current["down"] = True
    controller.step()
    assert actions == ["start", "release", "start"]
    current["down"] = False
    controller.step()
    assert actions[-1] == "release"


def test_native_key_mapping_requires_exact_modifiers():
    keys = {0x11, 0x20}
    pressed = lambda code: code in keys
    assert runtime_settings.key_pressed_from_state("Ctrl+Space", pressed)
    assert not runtime_settings.key_pressed_from_state("Alt+Space", pressed)
    keys.add(0x10)
    assert not runtime_settings.key_pressed_from_state("Ctrl+Space", pressed)
    keys.clear()
    keys.add(0x7C)  # F13
    assert runtime_settings.key_pressed_from_state("F13", pressed)


def test_wake_training_uses_private_staging_and_explicit_phrase(tmp_path, monkeypatch):
    base = tmp_path / "state" / "models" / "openwakeword"
    base.mkdir(parents=True)
    calls = []

    def train(command, **kwargs):
        calls.append(command)
        stage = command[command.index("--output-dir") + 1]
        open(os.path.join(stage, "personal_wake.npz"), "wb").close()
        with open(os.path.join(stage, "personal_wake.json"), "w", encoding="utf-8") as target:
            target.write('{"wake_phrase":"Hey Test","threshold":0.5}')

    monkeypatch.setattr(runtime_settings.subprocess, "run", train)
    # The ACL helper invokes PowerShell on Windows; exercise training orchestration independently.
    monkeypatch.setattr(runtime_settings, "protect_private", lambda *args, **kwargs: None)
    model, meta = runtime_settings.prepare_personal_wake(str(tmp_path), str(tmp_path / "state"), "Hey Test")
    assert calls[0][0] == sys.executable and calls[0][calls[0].index("--phrase") + 1] == "Hey Test"
    assert os.path.isfile(model) and os.path.isfile(meta)
    runtime_settings.discard_prepared_wake(model)
    assert not os.path.exists(os.path.dirname(model))


def test_cancelled_wake_training_terminates_worker_and_cleans_stage(tmp_path, monkeypatch):
    base = tmp_path / "state" / "models" / "openwakeword"
    base.mkdir(parents=True)
    monkeypatch.setattr(runtime_settings, "protect_private", lambda *args, **kwargs: None)
    events = []
    class Child:
        def poll(self): return None
        def terminate(self): events.append("terminate")
        def wait(self, timeout): events.append("wait"); return 0
    monkeypatch.setattr(runtime_settings.subprocess, "Popen", lambda *args, **kwargs: Child())
    cancelled = threading.Event(); cancelled.set()
    with pytest.raises(ValueError, match="cancelled"):
        runtime_settings.prepare_personal_wake(str(tmp_path), str(tmp_path / "state"), "Hey Test", str(tmp_path), cancelled)
    assert events == ["terminate", "wait"]
    assert list(base.glob("runtime-*")) == []


@pytest.mark.skipif(os.name != "nt", reason="Windows ACL behavior")
def test_private_acl_failure_is_fatal(tmp_path):
    with pytest.raises(OSError, match="Cannot protect private voice file ACL"):
        runtime_settings.protect_private(str(tmp_path / "missing.wav"))


if __name__ == "__main__":
    from pathlib import Path
    from tempfile import TemporaryDirectory
    test_validation_rejects_invalid_phrase_and_implicit_recording()
    with TemporaryDirectory() as directory:
        test_history_off_drops_entries_and_raw_recording_only_writes_accepted_command(Path(directory))
    test_tts_rate_changes_playback_duration()
    print("runtime settings: 3 tests passed")
