"""Explicit local Whisper inventory and owner-requested cache download jobs."""

import os
import subprocess
import sys
import threading
import uuid


MODELS = ("base", "small", "medium")


class SttModels:
    def __init__(self, cache_dir, local_mode=True, current_model=None):
        self.cache_dir = cache_dir
        self.local_mode = local_mode
        self.current_model = current_model
        self.lock = threading.Lock()
        self.job = None
        self.process = None

    def status(self):
        inventory = []
        if self.local_mode:
            from faster_whisper.utils import download_model
            configured = self.current_model() if self.current_model else None
            choices = (*MODELS, *((configured,) if configured and configured not in MODELS else ()))
            for model in choices:
                try:
                    path = download_model(model, local_files_only=True, cache_dir=self.cache_dir)
                    available = os.path.isfile(os.path.join(path, "model.bin"))
                except Exception:
                    available = False
                inventory.append({"id": model, "cached": available})
        with self.lock:
            job = dict(self.job) if self.job else None
        return {"localMode": self.local_mode, "models": inventory, "job": job}

    def start(self, model):
        if not self.local_mode or model not in MODELS:
            raise ValueError("Model download is available only for local Whisper")
        with self.lock:
            if self.job and self.job["state"] == "downloading":
                raise RuntimeError("A model download is already running")
            job_id = uuid.uuid4().hex
            self.job = {"id": job_id, "model": model, "state": "downloading", "error": None}
            try:
                threading.Thread(target=self._download, args=(job_id, model), daemon=True).start()
            except Exception:
                self.job = None
                raise
        return self.status()

    def _download(self, job_id, model):
        command = [sys.executable, "-c",
                   "from faster_whisper.utils import download_model; import sys; download_model(sys.argv[1], cache_dir=sys.argv[2])",
                   model, self.cache_dir]
        try:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with self.lock:
                if not self.job or self.job["id"] != job_id or self.job["state"] != "downloading":
                    process.terminate()
                    return
                self.process = process
            try:
                code = process.wait(timeout=900)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
                code = -1
            with self.lock:
                if self.job and self.job["id"] == job_id and self.job["state"] == "downloading":
                    self.job.update(state="ready" if code == 0 else "failed",
                                    error=None if code == 0 else "Download fehlgeschlagen oder abgelaufen")
        except (OSError, subprocess.TimeoutExpired):
            with self.lock:
                if self.job and self.job["id"] == job_id and self.job["state"] == "downloading":
                    self.job.update(state="failed", error="Download konnte nicht gestartet werden")
        finally:
            with self.lock:
                self.process = None

    def cancel(self, job_id):
        with self.lock:
            if not self.job or self.job["id"] != job_id or self.job["state"] != "downloading":
                raise ValueError("No matching active download")
            self.job.update(state="cancelled", error=None)
            process = self.process
        if process is not None:
            process.terminate()
        return self.status()

    def close(self):
        with self.lock:
            process = self.process
        if process is not None and process.poll() is None:
            process.terminate()
