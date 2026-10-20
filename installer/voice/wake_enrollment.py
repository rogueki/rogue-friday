"""Private, phrase-bound browser enrollment for a pending wake model."""

import base64
import binascii
import json
import os
import re
import shutil
import threading
import time
import uuid
import wave

import personal_wake
import runtime_settings


KINDS = ("wake", "short", "negatives", "speech")
REQUIRED = {"wake": 12, "short": 8, "negatives": 8, "speech": 8}
MAX_AGE = 60 * 60


class WakeEnrollment:
    def __init__(self, install_root, state_root):
        self.install_root, self.state_root = install_root, state_root
        self.base = os.path.join(state_root, "models", "openwakeword")
        self.lock = threading.RLock()
        self.job = None
        # An interrupted process never publishes its old prepared model or keeps its raw samples.
        if os.path.isdir(self.base):
            config_valid = False
            try:
                with open(os.path.join(install_root, "config", "voice.json"), encoding="utf-8") as source:
                    config = json.load(source)
                    if not isinstance(config, dict):
                        raise ValueError("Invalid voice configuration")
                    config_valid = True
                    active_model = config.get("personal_wake_model") if config.get("wake_engine") == "personal" else None
            except (OSError, ValueError, AttributeError):
                active_model = None
            for name in os.listdir(self.base):
                if re.fullmatch(r"enrollment-[0-9a-f]{32}", name):
                    shutil.rmtree(os.path.join(self.base, name))
                elif (config_valid and re.fullmatch(r"runtime-[0-9a-f]{32}", name) and
                      (not isinstance(active_model, str) or os.path.normcase(os.path.abspath(active_model)) !=
                       os.path.normcase(os.path.abspath(os.path.join(self.base, name, "personal_wake.npz"))))):
                    shutil.rmtree(os.path.join(self.base, name))
        threading.Thread(target=self._expiry_worker, daemon=True).start()

    def _expiry_worker(self):
        while True:
            time.sleep(60)
            with self.lock:
                try:
                    self._expire()
                except OSError:
                    # Keep the job visible so the next sweep or explicit discard can retry cleanup.
                    pass

    def _clean(self):
        job = self.job
        if not job:
            return
        if job["state"] == "training":
            job["cancelled"] = True
            job["cancel_event"].set()
            return
        if job.get("model"):
            runtime_settings.discard_prepared_wake(job["model"])
        shutil.rmtree(job["stage"], ignore_errors=False)
        self.job = None

    def _expire(self):
        if self.job and time.monotonic() - self.job["created"] > MAX_AGE:
            self._clean()

    def status(self):
        with self.lock:
            self._expire()
            job = self.job
            if not job:
                return {"state": "idle", "jobId": None, "phrase": None, "shortPhrase": None,
                        "required": dict(REQUIRED), "counts": {kind: 0 for kind in KINDS}, "quality": None, "error": None}
            short = personal_wake.short_form(job["phrase"])
            required = {**REQUIRED, "short": REQUIRED["short"] if short else 0}
            return {"state": "cancelled" if job["cancelled"] else job["state"], "jobId": job["id"], "phrase": job["phrase"],
                    "shortPhrase": short or None, "required": required, "counts": dict(job["counts"]),
                    "quality": job.get("quality"), "error": job["error"]}

    def start(self, phrase, revision, expected_revision, service_started_at, expected_service_started_at, active_phrase):
        with self.lock:
            self._expire()
            if revision != expected_revision or service_started_at != expected_service_started_at:
                raise runtime_settings.ConfigConflict("Voice configuration revision changed")
            if not personal_wake.valid_phrase(phrase) or personal_wake.is_pretrained_phrase(phrase):
                raise ValueError("Only a valid personal wake phrase can be enrolled")
            if personal_wake.phrase_key(phrase) == personal_wake.phrase_key(active_phrase):
                raise ValueError("The selected wake phrase is already active")
            if self.job:
                raise ValueError("Finish or discard the existing wake enrollment first")
            job_id = uuid.uuid4().hex
            stage = os.path.join(self.base, "enrollment-" + job_id)
            os.makedirs(stage, mode=0o700)
            try:
                runtime_settings.protect_private(stage, directory=True)
                raw_root = os.path.join(stage, "raw")
                os.makedirs(raw_root, mode=0o700)
                runtime_settings.protect_private(raw_root, directory=True)
            except Exception:
                shutil.rmtree(stage)
                raise
            self.job = {"id": job_id, "phrase": phrase, "revision": revision, "active_phrase": active_phrase,
                        "service_started_at": service_started_at, "created": time.monotonic(),
                        "stage": stage, "state": "capturing", "counts": {kind: 0 for kind in KINDS},
                        "error": None, "model": None, "meta": None, "cancelled": False,
                        "cancel_event": threading.Event()}
            return self.status()

    def add_sample(self, job_id, kind, pcm_base64):
        with self.lock:
            job = self.job
            if not job or job["id"] != job_id or job["state"] not in ("capturing", "failed") or kind not in KINDS:
                raise ValueError("Wake enrollment sample is not accepted")
            if kind == "short" and not personal_wake.short_form(job["phrase"]):
                raise ValueError("Wake phrase has no short form")
            if job["counts"][kind] >= REQUIRED[kind] or not isinstance(pcm_base64, str) or len(pcm_base64) > 256_000:
                raise ValueError("Wake enrollment sample limit reached")
            try:
                pcm = base64.b64decode(pcm_base64, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("Invalid PCM sample") from exc
            if len(pcm) < 16_000 or len(pcm) > 192_000 or len(pcm) % 2 or base64.b64encode(pcm).decode("ascii") != pcm_base64:
                raise ValueError("Sample must be 0.5 to 6 seconds PCM16 at 16 kHz")
            block = "wake_" + personal_wake.phrase_slug(
                personal_wake.short_form(job["phrase"]) if kind == "short" else job["phrase"]) if kind in ("wake", "short") else kind
            folder = os.path.join(job["stage"], "raw", block)
            os.makedirs(folder, mode=0o700, exist_ok=True)
            runtime_settings.protect_private(folder, directory=True)
            index = job["counts"][kind] + 1
            path = os.path.join(folder, f"sample-{index:02d}.wav")
            try:
                with wave.open(path, "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(16000)
                    output.writeframes(pcm)
                runtime_settings.protect_private(path)
            except Exception:
                if os.path.exists(path):
                    os.unlink(path)
                raise
            job["counts"][kind] = index
            job["state"] = "capturing"
            job["error"] = None
            return self.status()

    def train(self, job_id):
        with self.lock:
            job = self.job
            if not job or job["id"] != job_id or job["state"] not in ("capturing", "failed"):
                raise ValueError("Wake enrollment is not ready for training")
            required = self.status()["required"]
            if any(job["counts"][kind] < required[kind] for kind in KINDS):
                raise ValueError("Complete all wake enrollment samples first")
            job["state"], job["error"] = "training", None
            threading.Thread(target=self._train_worker, args=(job,), daemon=True).start()
            return self.status()

    def _train_worker(self, job):
        model = None
        try:
            model, meta = runtime_settings.prepare_personal_wake(
                self.install_root, self.state_root, job["phrase"], os.path.join(job["stage"], "raw"), job["cancel_event"])
            metadata = personal_wake.load_meta(meta)
            if personal_wake.phrase_key(metadata.get("wake_phrase", "")) != personal_wake.phrase_key(job["phrase"]):
                raise ValueError("Trained model belongs to a different wake phrase")
            personal_wake.WindowModel.load(model)
            with self.lock:
                if job["cancelled"] or self.job is not job:
                    runtime_settings.discard_prepared_wake(model)
                    job["state"] = "cancelled"
                    self._clean()
                    return
                job["model"], job["meta"], job["quality"] = model, meta, metadata.get("quality")
                shutil.rmtree(os.path.join(job["stage"], "raw"))
                job["state"] = "ready"
        except Exception as exc:
            with self.lock:
                if model:
                    try:
                        runtime_settings.discard_prepared_wake(model)
                    except OSError:
                        job["cleanup_error"] = True
                    job["model"], job["meta"] = None, None
                if job["cancelled"]:
                    job["state"] = "cancelled"
                    self._clean()
                else:
                    job["state"] = "failed"
                    job["error"] = "Training failed; review the recordings and retry."
                    job["failure_type"] = type(exc).__name__

    def prepared(self, phrase, active_phrase, service_started_at, current_revision, expected_revision):
        with self.lock:
            self._expire()
            if current_revision != expected_revision:
                raise runtime_settings.ConfigConflict("Voice configuration revision changed")
            job = self.job
            if (not job or job["state"] != "ready" or job["phrase"] != phrase or
                    personal_wake.phrase_key(job["active_phrase"]) != personal_wake.phrase_key(active_phrase) or
                    job["service_started_at"] != service_started_at):
                raise ValueError("Train the selected wake phrase before saving settings")
            return job["model"], job["meta"]

    def committed(self):
        with self.lock:
            if self.job:
                self.job["model"] = None  # The active config now owns the prepared model.
                self._clean()

    def discard(self, job_id):
        with self.lock:
            if not self.job or self.job["id"] != job_id:
                raise ValueError("Unknown wake enrollment")
            self._clean()
            return self.status()
