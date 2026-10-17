#!/usr/bin/env python3
"""Download CPU voice assets or check whether the private voice service may start."""

import argparse
import json
import os
from pathlib import Path
import stat
import sys
import urllib.parse
import urllib.request


STATE = Path("/var/lib/friday")
CONFIG = Path("/etc/friday/voice.json")
BRIDGE_KEY = STATE / "data/voice-bridge/auth.key"


def private_file(path: Path) -> bool:
    try:
        info = path.lstat()
        return stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and os.access(path, os.R_OK)
    except OSError:
        return False


def missing_prerequisites(config: dict) -> list[str]:
    missing = []
    if config.get("voice_mode") != "elevenlabs" or config.get("audio_transport") != "browser":
        return ["Native Linux browser voice currently requires ElevenLabs mode"]
    if not private_file(Path(config.get("elevenlabs_key_file") or "")):
        missing.append("private ElevenLabs key")
    if not private_file(BRIDGE_KEY):
        missing.append("dashboard voice bridge key; start the dashboard first")
    if not private_file(Path(config.get("hermes_key_file") or "")):
        missing.append("private Hermes API key at /etc/friday/secrets/hermes-api.key")
    try:
        endpoint = urllib.parse.urlsplit(config["hermes_url"])
        if endpoint.hostname != "127.0.0.1" or endpoint.scheme != "http" or not endpoint.port:
            raise ValueError("invalid Hermes API URL")
        key = Path(config["hermes_key_file"]).read_text(encoding="utf-8").strip()
        if not key or "\n" in key or "\r" in key:
            raise ValueError("invalid Hermes API key")
        request = urllib.request.Request(
            f"http://127.0.0.1:{endpoint.port}/v1/models",
            headers={"Authorization": f"Bearer {key}"},
        )
        loopback = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with loopback.open(request, timeout=2) as response:
            if response.status != 200:
                raise ValueError("Hermes API unhealthy")
    except (OSError, ValueError, KeyError):
        missing.append("authenticated loopback Hermes API server")
    if not private_file(Path(config.get("speaker_profile") or "")):
        missing.append("private trained owner speaker profile")
    models = STATE / "models/openwakeword"
    for name in ("melspectrogram.onnx", "embedding_model.onnx"):
        if not (models / name).is_file():
            missing.append(f"openWakeWord {name}")
    if config.get("wake_engine") == "personal":
        model = Path(config.get("personal_wake_model") or "")
        meta = Path(config.get("personal_wake_meta") or "")
        if not private_file(model) or not private_file(meta):
            missing.append("private trained personal wake model and metadata")
        else:
            try:
                if json.loads(meta.read_text(encoding="utf-8")).get("wake_phrase") != config.get("wake_phrase"):
                    missing.append("personal wake model phrase does not match voice.json")
            except (OSError, ValueError):
                missing.append("valid personal wake metadata")
    elif config.get("wake_engine") == "openwakeword":
        if not Path(config.get("wake_model") or "").is_file():
            missing.append("pretrained wake model")
    else:
        missing.append("valid wake engine")
    return missing


def prepare_assets() -> None:
    import openwakeword
    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy
    from silero_vad import load_silero_vad

    models = STATE / "models/openwakeword"
    models.mkdir(parents=True, exist_ok=True, mode=0o700)
    openwakeword.utils.download_models(target_directory=str(models))
    for name in ("melspectrogram.onnx", "embedding_model.onnx"):
        if not (models / name).is_file():
            raise RuntimeError(f"Model asset missing: {name}")
    EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                   savedir=str(STATE / "models/ecapa"),
                                   local_strategy=LocalStrategy.COPY)
    load_silero_vad(onnx=True)
    print("VOICE_ASSETS_READY (owner enrollment still required)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prepare-assets", action="store_true")
    group.add_argument("--check-ready", action="store_true")
    args = parser.parse_args()
    if args.prepare_assets:
        prepare_assets()
        return 0
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    missing = missing_prerequisites(config)
    for item in missing:
        print(f"VOICE_NOT_READY: {item}", file=sys.stderr)
    if missing:
        return 1
    print("VOICE_READY_FOR_START")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(f"Voice preparation failed: {error}")
