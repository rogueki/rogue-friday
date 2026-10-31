"""ElevenLabs speech I/O for the Friday voice client.

Windows uses per-user DPAPI; Linux uses a private service-owned key file.
Audio is held in memory and sent only when the cloud voice mode is selected.
"""

import json
import urllib.parse
import urllib.request
import uuid

import numpy as np

import cloud_secret

STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=pcm_16000"
TTS_RATE = 16000
LINUX_SECRET_FILE = "/etc/friday/secrets/elevenlabs.key"


def load_key(secret_file: str) -> str:
    return cloud_secret.load_secret(secret_file, linux_file=LINUX_SECRET_FILE, label="ElevenLabs")


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
