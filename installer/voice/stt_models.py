"""Explicit local Whisper inventory and owner-requested cache download jobs."""

import os
import subprocess
import sys
import threading
import uuid


class SttModels:
    def __init__(self, cache_dir, local_mode=True, current_model=None):
        self.cache_dir = cache_dir
        self.local_mode = local_mode
        self.current_model = current_model
        self.lock = threading.Lock()
        self.job = None
        self.process = None
        self.busy = False

    def status(self):
        inventory = []
        if self.local_mode:
            from faster_whisper.utils import available_models, download_model
            supported = tuple(model for model in available_models() if len(model) <= 64)
            configured = self.current_model() if self.current_model else None
            choices = (*supported, *((configured,) if configured and configured not in supported else ()))
            for model in choices:
                try:
                    path = download_model(model, local_files_only=True, cache_dir=self.cache_dir)
                    available = os.path.isfile(os.path.join(path, "model.bin"))
                except Exception:
                    available = False
                inventory.append({"id": model, "cached": available, "downloadable": model in supported})
        with self.lock:
            job = dict(self.job) if self.job else None
        return {"localMode": self.local_mode, "models": inventory, "job": job}

    def start(self, model):
        if not self.local_mode or not isinstance(model, str):
            raise ValueError("Model download is available only for local Whisper")
        from faster_whisper.utils import available_models
        if model not in available_models():
            raise ValueError("Model download is available only for local Whisper")
        with self.lock:
            if self.busy:
                raise RuntimeError("A model download is already running")
            job_id = uuid.uuid4().hex
            self.job = {"id": job_id, "model": model, "state": "downloading", "error": None}
            self.busy = True
            try:
                threading.Thread(target=self._download, args=(job_id, model), daemon=True).start()
            except Exception:
                self.job = None
                self.busy = False
                raise
        return self.status()

    @staticmethod
    def _stop_process(process):
        if process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def _download(self, job_id, model):
        command = [sys.executable, "-c",
                   "from faster_whisper.utils import download_model; import sys; download_model(sys.argv[1], cache_dir=sys.argv[2])",
                   model, self.cache_dir]
        try:
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            with self.lock:
                if not self.job or self.job["id"] != job_id or self.job["state"] != "downloading":
                    cancelled = True
                else:
                    cancelled = False
                    self.process = process
            if cancelled:
                self._stop_process(process)
                return
            try:
                code = process.wait(timeout=900)
            except subprocess.TimeoutExpired:
                self._stop_process(process)
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
                reaped = "process" not in locals() or process.poll() is not None
                if "process" in locals() and self.process is process and reaped:
                    self.process = None
                if self.job and self.job["id"] == job_id:
                    if self.job["state"] == "cancelling" and reaped:
                        self.job["state"] = "cancelled"
                    if reaped:
                        self.busy = False

    def cancel(self, job_id):
        with self.lock:
            if not self.job or self.job["id"] != job_id or self.job["state"] != "downloading":
                raise ValueError("No matching active download")
            self.job.update(state="cancelling", error=None)
            process = self.process
        if process is not None:
            try:
                self._stop_process(process)
            except subprocess.TimeoutExpired:
                pass
        return self.status()

    def close(self):
        with self.lock:
            process = self.process
        if process is not None and process.poll() is None:
            self._stop_process(process)
