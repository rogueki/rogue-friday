import os
import sys
import time
import wave
import subprocess

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import runtime_settings


def requested(**overrides):
    return {"wakeWordEnabled": True, "wakeWord": "Hey Friday", "pushToTalkKey": "Ctrl+Space",
            "speakerVerificationRequired": True, "storeRawRecordings": False,
            "voiceHistoryEnabled": True, "ttsRate": 1.0, **overrides}


def test_validation_rejects_untrained_phrase_unverified_owner_and_implicit_recording():
    cfg = {"wake_phrase": "Hey Friday"}
    for value in (requested(wakeWord="Hey Someone"), requested(speakerVerificationRequired=False),
                  requested(pushToTalkKey="Ctrl+Alt+Delete"), {**requested(), "storeRawRecordings": "true"}):
        try:
            runtime_settings.validate(value, cfg)
        except ValueError:
            pass
        else:
            raise AssertionError("unsafe voice policy was accepted")
    applied = runtime_settings.validate(requested(wakeWordEnabled=False, voiceHistoryEnabled=False), cfg)
    assert runtime_settings.effective(applied) == requested(wakeWordEnabled=False, voiceHistoryEnabled=False)
    assert applied["store_raw_recordings"] is False


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


if __name__ == "__main__":
    from pathlib import Path
    from tempfile import TemporaryDirectory
    test_validation_rejects_untrained_phrase_unverified_owner_and_implicit_recording()
    with TemporaryDirectory() as directory:
        test_history_off_drops_entries_and_raw_recording_only_writes_accepted_command(Path(directory))
    test_tts_rate_changes_playback_duration()
    print("runtime settings: 3 tests passed")
