"""Resolve installed voice personas without accepting a client-supplied file or voice ID."""

import json
import os
import urllib.request
import urllib.parse
from pathlib import Path


CHOICES = ("friday-female", "classic", "custom")
# Piper-Basisstimme je Platz. Der eigene Platz nutzt dieselbe Basis wie der weibliche, unterscheidet sich
# aber durch seine eigene Referenz (config/voice-references/custom-reference.*).
PIPER_FALLBACK = {"friday-female": "de_DE-kerstin-low", "classic": "de_DE-thorsten-medium", "custom": "de_DE-kerstin-low"}


class PersonaUnavailable(ValueError):
    pass


def _reference(root: Path, choice: str) -> Path:
    folder = root / "config" / "voice-references"
    for extension in ("wav", "mp3"):
        candidate = folder / f"{choice}-reference.{extension}"
        if candidate.is_file():
            return candidate
    raise PersonaUnavailable(f"Die Referenz für {choice} fehlt. Bitte im Installer einrichten.")


def resolve(cfg: dict, root: str, choice: str) -> dict:
    if choice not in CHOICES:
        raise PersonaUnavailable("Unbekannte Stimme")
    updated = dict(cfg)
    mode = cfg.get("voice_mode")
    if mode == "elevenlabs":
        ids = cfg.get("elevenlabs_voice_ids")
        identifier = ids.get(choice) if isinstance(ids, dict) else None
        if not isinstance(identifier, str) or not identifier.strip():
            raise PersonaUnavailable(f"Für {choice} ist keine eigene ElevenLabs Voice ID eingerichtet.")
        key = cfg.get("elevenlabs_key_file")
        if not isinstance(key, str) or not os.path.isfile(key):
            raise PersonaUnavailable("ElevenLabs ist nicht eingerichtet.")
        updated.update(tts_voice_choice=choice, elevenlabs_voice_id=identifier.strip())
        return updated
    if mode not in ("local", None):
        raise PersonaUnavailable("Der Sprachmodus ist nicht unterstützt.")
    base = Path(root)
    reference = _reference(base, choice)
    fallback_name = PIPER_FALLBACK[choice]
    fallback = base / "models" / "tts" / f"{fallback_name}.onnx"
    if not fallback.is_file():
        raise PersonaUnavailable(f"Die lokale Basisstimme für {choice} fehlt. Bitte im Installer einrichten.")
    backend = cfg.get("tts_backend")
    if backend == "streaming_qwen":
        streaming = base / "config" / "voice-references" / f"{choice}-streaming.wav"
        transcript = base / "config" / "voice-references" / f"{choice}-reference.txt"
        if not streaming.is_file() or not transcript.is_file():
            raise PersonaUnavailable("Die lokalen Stimmen brauchen das Referenz-Update aus dem Installer.")
        endpoint = cfg.get("tts_url")
        try:
            parsed = urllib.parse.urlsplit(endpoint)
            local = parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "::1") and \
                parsed.port is not None and parsed.path == "/tts/stream" and not parsed.username and \
                not parsed.password and not parsed.query and not parsed.fragment
        except (TypeError, ValueError):
            local = False
        if not local:
            raise PersonaUnavailable("Der lokale Qwen-Dienst ist nicht korrekt eingerichtet.")
        try:
            with urllib.request.urlopen(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "/health", "", "")), timeout=2) as response:
                status = json.load(response)
        except (OSError, ValueError, TimeoutError) as exc:
            raise PersonaUnavailable("Der lokale Qwen-Dienst ist nicht erreichbar.") from exc
        if choice not in status.get("voices", []):
            raise PersonaUnavailable("Der lokale Qwen-Dienst braucht das Stimmen-Update aus dem Installer.")
        updated["tts_persona_streaming"] = True
        updated["tts_reference_text_file"] = str(transcript)
        reference = streaming
    elif backend == "qwen3":
        if not all(os.path.isfile(cfg.get(field) or "") for field in
                   ("tts_qwen_executable", "tts_qwen_model", "tts_qwen_projector")):
            raise PersonaUnavailable("Das lokale Qwen-Modell fehlt. Bitte im Installer einrichten.")
    else:
        raise PersonaUnavailable("Für diese Stimme ist Qwen noch nicht eingerichtet. Bitte im Installer nachrüsten.")
    updated.update(tts_voice_choice=choice, tts_reference=str(reference), tts_voice=str(fallback),
                   tts_film_filter=(choice == "classic"))
    return updated
