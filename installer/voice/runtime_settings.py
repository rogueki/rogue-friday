"""Validated, explicit voice policy shared by the live control endpoint and tests."""

import os
import re
import tempfile
import json
import time
import wave
import uuid
import base64
import subprocess
import hashlib

import numpy as np


FIELDS = ("wakeWordEnabled", "wakeWord", "pushToTalkKey", "speakerVerificationRequired",
          "storeRawRecordings", "voiceHistoryEnabled", "ttsRate")


class ConfigConflict(Exception):
    pass


def file_hash(path):
    try:
        with open(path, "rb") as source:
            return hashlib.sha256(source.read()).hexdigest()
    except FileNotFoundError:
        return None


def assert_revision(path, expected):
    if file_hash(path) != expected:
        raise ConfigConflict("voice.json changed outside the voice service; reload before saving")


class PrivacyHistory(list):
    def __init__(self, enabled):
        super().__init__()
        self.enabled = enabled

    def __iadd__(self, entries):
        if self.enabled():
            super().__iadd__(entries)
        return self


def protect_private(path, directory=False):
    if os.name != "nt":
        os.chmod(path, 0o700 if directory else 0o600)
        return
    # Match the installer's protected directory ACL. chmod on Windows does not remove inherited readers.
    script = r'''
$path = $env:FRIDAY_PRIVATE_PATH
$ErrorActionPreference = 'Stop'
$acl = if ($env:FRIDAY_PRIVATE_DIRECTORY -eq '1') { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
$acl.SetAccessRuleProtection($true, $false)
foreach ($principal in @([Security.Principal.WindowsIdentity]::GetCurrent().User,
                        (New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'),
                        (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
    if ($env:FRIDAY_PRIVATE_DIRECTORY -eq '1') {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
    } else {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow)
    }
    $acl.AddAccessRule($rule)
}
if ($env:FRIDAY_PRIVATE_DIRECTORY -eq '1') { [IO.Directory]::SetAccessControl($path, $acl) }
else { [IO.File]::SetAccessControl($path, $acl) }
'''
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    env = {**os.environ, "FRIDAY_PRIVATE_PATH": path,
           "FRIDAY_PRIVATE_DIRECTORY": "1" if directory else "0"}
    try:
        subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                       env=env, check=True, capture_output=True, timeout=15)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise OSError("Cannot protect private voice file ACL") from exc


def effective(cfg):
    return {"wakeWordEnabled": cfg.get("wake_word_enabled", True),
            "wakeWord": cfg.get("wake_phrase", ""),
            "pushToTalkKey": cfg.get("push_to_talk_key", "Ctrl+Space"),
            "speakerVerificationRequired": cfg.get("speaker_verification_required", True),
            "storeRawRecordings": cfg.get("store_raw_recordings", False),
            "voiceHistoryEnabled": cfg.get("voice_history_enabled", True),
            "ttsRate": cfg.get("tts_rate", 1.0)}


def validate(request, cfg):
    if not isinstance(request, dict) or set(request) != set(FIELDS):
        raise ValueError("Voice settings require exactly seven fields")
    for key in ("wakeWordEnabled", "speakerVerificationRequired", "storeRawRecordings", "voiceHistoryEnabled"):
        if type(request[key]) is not bool:
            raise ValueError(f"Invalid {key}")
    phrase = request["wakeWord"]
    if not isinstance(phrase, str) or not phrase.strip() or len(phrase) > 80:
        raise ValueError("Invalid wake phrase")
    # A trained wake model recognizes one phrase. Relabeling it would falsely report an applied setting.
    if phrase != cfg.get("wake_phrase"):
        raise ValueError("Wake phrase requires a matching trained model")
    key = request["pushToTalkKey"]
    if not isinstance(key, str) or not re.fullmatch(r"(?:(?:Ctrl|Alt|Shift|Meta)\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)", key):
        raise ValueError("Invalid push-to-talk key")
    rate = request["ttsRate"]
    if isinstance(rate, bool) or not isinstance(rate, (float, int)) or not 0.5 <= rate <= 2:
        raise ValueError("Invalid TTS rate")
    if request["speakerVerificationRequired"] is False:
        # The voice bridge currently represents all utterances as the owner. It cannot assign that identity
        # to an unverified speaker without bypassing command permissions and disclosing private data.
        raise ValueError("Speaker verification is required for owner voice commands")
    return {**cfg, "wake_word_enabled": request["wakeWordEnabled"],
            "push_to_talk_key": key, "speaker_verification_required": request["speakerVerificationRequired"],
            "store_raw_recordings": request["storeRawRecordings"],
            "voice_history_enabled": request["voiceHistoryEnabled"], "tts_rate": float(rate)}


def atomic_write(path, config, expected_hash=None):
    assert_revision(path, expected_hash)
    directory = os.path.dirname(path)
    handle, temporary = tempfile.mkstemp(prefix="voice-settings-", suffix=".json", dir=directory)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as target:
            protect_private(temporary)
            json.dump(config, target, ensure_ascii=False, indent=2)
            target.flush()
            os.fsync(target.fileno())
        assert_revision(path, expected_hash)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def pace(samples, rate):
    """Change playback duration without changing the device sample rate."""
    if rate == 1 or len(samples) < 2:
        return samples
    width = max(1, round(len(samples) / rate))
    return np.interp(np.linspace(0, len(samples) - 1, width),
                     np.arange(len(samples)), samples).astype(np.float32)


def record_command(root, samples, sample_rate=16000):
    """Only a verified, accepted command reaches this function; no wake-only audio is archived."""
    folder = os.path.join(root, "recordings", "voice")
    os.makedirs(folder, mode=0o700, exist_ok=True)
    protect_private(folder, directory=True)
    prune_recordings(root)
    path = os.path.join(folder, f"command-{uuid.uuid4().hex}.wav")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as target:
            protect_private(path)
            with wave.open(target, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                pcm = np.clip(samples, -1, 1)
                output.writeframes((pcm * 32767).astype("<i2").tobytes())
    except Exception:
        os.unlink(path)
        raise
    return path


def prune_recordings(root):
    folder = os.path.join(root, "recordings", "voice")
    if not os.path.isdir(folder):
        return 0
    cutoff = time.time() - 24 * 3600
    removed = 0
    for name in os.listdir(folder):
        if re.fullmatch(r"command-[0-9a-f]{32}\.wav", name):
            path = os.path.join(folder, name)
            if os.path.getmtime(path) < cutoff:
                os.unlink(path)
                removed += 1
    return removed
