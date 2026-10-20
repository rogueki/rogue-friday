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
import ctypes
import shutil
import sys

import personal_wake

import numpy as np


FIELDS = ("wakeWordEnabled", "wakeWord", "pushToTalkKey", "speakerVerificationRequired",
          "storeRawRecordings", "voiceHistoryEnabled", "ttsRate")


def key_pressed_from_state(key, pressed):
    """Match the configured key against a virtual-key state reader."""
    parts = key.split("+")
    modifier, name = parts if len(parts) == 2 else (None, parts[0])
    virtual_key = (0x20 if name == "Space" else ord(name) if len(name) == 1 else
                   0x6F + int(name[1:]) if re.fullmatch(r"F(?:[1-9]|1[0-9]|2[0-4])", name) else None)
    if virtual_key is None:
        return False
    modifiers = {"Ctrl": pressed(0x11), "Alt": pressed(0x12), "Shift": pressed(0x10),
                 "Meta": pressed(0x5B) or pressed(0x5C)}
    return pressed(virtual_key) and all(state == (kind == modifier) for kind, state in modifiers.items())


def native_key_pressed(key):
    """Read the configured key and exact modifier set from the interactive Windows desktop."""
    if os.name != "nt":
        return False
    return key_pressed_from_state(key, lambda code: bool(ctypes.windll.user32.GetAsyncKeyState(code) & 0x8000))


class NativePushToTalk:
    def __init__(self, key, pressed, start, release):
        self.key, self.pressed, self.start, self.release = key, pressed, start, release
        self.held = False
        self.last_key = None

    def step(self):
        key = self.key()
        down = self.pressed(key)
        if self.held and (key != self.last_key or not down):
            self.release()
            self.held = False
        if down and not self.held:
            self.start()
            self.held = True
        self.last_key = key


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
    if not isinstance(phrase, str) or not personal_wake.valid_phrase(phrase):
        raise ValueError("Invalid wake phrase")
    key = request["pushToTalkKey"]
    if not isinstance(key, str) or not re.fullmatch(r"(?:(?:Ctrl|Alt|Shift|Meta)\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)", key):
        raise ValueError("Invalid push-to-talk key")
    rate = request["ttsRate"]
    if isinstance(rate, bool) or not isinstance(rate, (float, int)) or not 0.5 <= rate <= 2:
        raise ValueError("Invalid TTS rate")
    return {**cfg, "wake_phrase": phrase,
            "wake_word_enabled": request["wakeWordEnabled"],
            "push_to_talk_key": key, "speaker_verification_required": request["speakerVerificationRequired"],
            "store_raw_recordings": request["storeRawRecordings"],
            "voice_history_enabled": request["voiceHistoryEnabled"], "tts_rate": float(rate)}


def prepare_personal_wake(install_root, state_root, phrase, raw_dir=None, cancel_event=None):
    """Train into a private staging directory; caller activates only after model load and config CAS."""
    base = os.path.join(state_root, "models", "openwakeword")
    stage = os.path.join(base, "runtime-" + uuid.uuid4().hex)
    os.makedirs(stage, mode=0o700)
    builder = os.path.join(os.path.dirname(__file__), "build_personal_wake.py")
    completed = False
    try:
        protect_private(stage, directory=True)
        command = [sys.executable, builder, install_root, "--phrase", phrase, "--output-dir", stage]
        if raw_dir is not None:
            command += ["--raw-dir", raw_dir]
        if cancel_event is None:
            subprocess.run(command, check=True, capture_output=True, timeout=240)
        else:
            flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
            deadline = time.monotonic() + 240
            try:
                while True:
                    if cancel_event.is_set():
                        raise ValueError("Wake training cancelled")
                    if time.monotonic() >= deadline:
                        raise ValueError("Wake training timed out")
                    try:
                        code = process.wait(timeout=0.25)
                        break
                    except subprocess.TimeoutExpired:
                        continue
                if code != 0:
                    raise ValueError("Wake training requires enrolled phrase clips and a working local trainer")
            except Exception:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                raise
        model = os.path.join(stage, "personal_wake.npz")
        meta = os.path.join(stage, "personal_wake.json")
        if not os.path.isfile(model) or not os.path.isfile(meta):
            raise ValueError("Wake training did not produce a model")
        protect_private(model)
        protect_private(meta)
        completed = True
        return model, meta
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Wake training requires enrolled phrase clips and a working local trainer") from exc
    finally:
        if not completed:
            shutil.rmtree(stage)


def discard_prepared_wake(model_path):
    if not model_path:
        return
    stage = os.path.dirname(model_path)
    if os.path.basename(stage).startswith("runtime-") and os.path.basename(model_path) == "personal_wake.npz":
        shutil.rmtree(stage)


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
