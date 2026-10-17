"""ElevenLabs speech I/O for the Friday voice client.

Windows uses per-user DPAPI; Linux uses a private service-owned key file.
Audio is held in memory and sent only when the cloud voice mode is selected.
"""

import json
import os
import stat
import subprocess
import urllib.parse
import urllib.request
import uuid

import numpy as np

STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=pcm_16000"
TTS_RATE = 16000
LINUX_SECRET_FILE = "/etc/friday/secrets/elevenlabs.key"


def load_key(secret_file: str) -> str:
    if os.name == "posix":
        # No arbitrary path references: the installer owns this directory and
        # never places the credential under a release or web root.
        if secret_file != LINUX_SECRET_FILE:
            raise RuntimeError("Ungueltiger ElevenLabs-Schluesselpfad")
        config_dir = os.stat(os.path.dirname(os.path.dirname(LINUX_SECRET_FILE)), follow_symlinks=False)
        if (not stat.S_ISDIR(config_dir.st_mode) or config_dir.st_mode & 0o022
                or config_dir.st_uid not in (0, os.geteuid())):
            raise RuntimeError("ElevenLabs-Konfigurationsverzeichnis hat unsichere Rechte")
        parent = os.stat(os.path.dirname(LINUX_SECRET_FILE), follow_symlinks=False)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_mode & 0o077 or parent.st_uid not in (0, os.geteuid()):
            raise RuntimeError("ElevenLabs-Secret-Verzeichnis hat unsichere Rechte")
        descriptor = os.open(secret_file, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
        try:
            info = os.fstat(descriptor)
            if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077
                    or info.st_uid not in (0, os.geteuid()) or info.st_size > 4096):
                raise RuntimeError("ElevenLabs-Schluesseldatei hat unsichere Rechte")
            with os.fdopen(descriptor, "rb", closefd=False) as source:
                key = source.read(4097).decode("ascii").strip()
            if not key or len(key) > 4096 or "\n" in key or "\r" in key:
                raise RuntimeError("ElevenLabs-Schluesseldatei ist ungueltig")
            return key
        finally:
            os.close(descriptor)
    if os.name != "nt" or not os.path.isfile(secret_file):
        raise RuntimeError("ElevenLabs-Schluessel fuer diesen Windows-Benutzer fehlt")
    script = ("$s=ConvertTo-SecureString (Get-Content -LiteralPath $env:FRIDAY_ELEVENLABS_SECRET_FILE -Raw);"
              "$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);"
              "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} "
              "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}")
    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
                            env={**os.environ, "FRIDAY_ELEVENLABS_SECRET_FILE": secret_file},
                            capture_output=True, text=True, timeout=15, check=False)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError("ElevenLabs-Schluessel konnte nicht fuer diesen Windows-Benutzer gelesen werden")
    return result.stdout.strip()


def transcribe(audio: np.ndarray, api_key: str, *, language: str = "de") -> str:
    """Transcribe one completed utterance; microphone capture/VAD remain local."""
    recording = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    boundary = "friday_" + uuid.uuid4().hex
    data = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nscribe_v2\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"language_code\"\r\n\r\n{language}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file_format\"\r\n\r\npcm_s16le_16\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.pcm\"\r\n"
            "Content-Type: application/octet-stream\r\n\r\n").encode() + recording + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(STT_URL, data=data, headers={
        "xi-api-key": api_key, "Content-Type": f"multipart/form-data; boundary={boundary}"}, method="POST")
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response).get("text", "").strip()


def stream_speech(text: str, api_key: str, voice_id: str, *, on_response=None):
    """Yield raw mono PCM16 at 16 kHz as soon as ElevenLabs sends each block."""
    if not voice_id or not voice_id.isalnum():
        raise ValueError("Ungueltige ElevenLabs Voice ID")
    url = TTS_URL.format(voice_id=urllib.parse.quote(voice_id))
    payload = json.dumps({"text": text, "model_id": "eleven_flash_v2_5", "language_code": "de"}).encode()
    request = urllib.request.Request(url, data=payload, headers={
        "xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/pcm"}, method="POST")
    with urllib.request.urlopen(request, timeout=45) as response:
        if on_response is not None:
            on_response(response)
        try:
            while block := response.read1(4096):
                yield block
        finally:
            if on_response is not None:
                on_response(None)
