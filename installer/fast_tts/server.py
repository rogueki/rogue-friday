"""Persistent local Qwen3-TTS voice clone with streamed PCM output."""

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--reference-text-file", required=True)
    parser.add_argument("--port", type=int, default=43795)
    parser.add_argument("--model", default="Qwen/Qwen3-TTS-12Hz-0.6B-Base")
    parser.add_argument("--hf-home")
    args = parser.parse_args()
    if args.hf_home:
        os.environ["HF_HOME"] = args.hf_home

    import numpy as np
    import torch
    from faster_qwen3_tts import FasterQwen3TTS

    reference = Path(args.reference).resolve(strict=True)
    reference_text = Path(args.reference_text_file).read_text(encoding="utf-8").strip()
    if not reference_text:
        parser.error("Reference transcript is empty")
    model = FasterQwen3TTS.from_pretrained(args.model)
    clone = {"language": "German", "ref_audio": str(reference), "ref_text": reference_text}
    # CUDA graphs are captured on first use. Do this before announcing readiness.
    for warm in ("Moment.", "Es ist zwoelf Uhr.", "Heute ist Freitag, der sechzehnte Oktober."):
        for _ in model.generate_voice_clone_streaming(text=warm, chunk_size=8, **clone):
            pass
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/health":
                self.send_error(404)
                return
            payload = json.dumps({"ok": True, "model": args.model, "ready": True}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_POST(self):
            if self.path != "/tts/stream":
                self.send_error(404)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 16384:
                    raise ValueError("Invalid request size")
                payload = json.loads(self.rfile.read(size))
                text = payload.get("text", "").strip()
                if not text or len(text) > 2000:
                    raise ValueError("Invalid text")
            except (ValueError, TypeError, AttributeError):
                self.send_error(400)
                return
            with lock:
                started = time.monotonic()
                first = True
                try:
                    for chunk, rate, _ in model.generate_voice_clone_streaming(
                            text=text, chunk_size=8, **clone):
                        if first:
                            self.send_response(200)
                            self.send_header("Content-Type", "application/octet-stream")
                            self.send_header("X-Sample-Rate", str(rate))
                            self.send_header("X-First-Audio-Ms", str(round((time.monotonic() - started) * 1000)))
                            self.send_header("Connection", "close")
                            self.end_headers()
                            first = False
                        audio = chunk.detach().float().cpu().numpy() if torch.is_tensor(chunk) else np.asarray(chunk)
                        pcm = (np.clip(audio.reshape(-1), -1.0, 1.0) * 32767).astype("<i2").tobytes()
                        self.wfile.write(pcm)
                        self.wfile.flush()
                    if first:
                        self.send_error(503, "TTS produced no audio")
                except (BrokenPipeError, ConnectionResetError):
                    pass
                except Exception:
                    if first:
                        self.send_error(503, "TTS generation failed")
                    else:
                        self.close_connection = True
                    raise

        def log_message(self, *args):
            pass

    print(f"Friday TTS ready on 127.0.0.1:{args.port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
