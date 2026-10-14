"""Voice Service (Windows) fuer Kira bzw. Jarvis - Name, Persona, Wake Word per config\voice.json.

Mikrofon -> openWakeWord (+ Owner-Verifier) -> Befehl per Silero-VAD -> ECAPA-Sprecherpruefung
-> faster-whisper (GPU) -> Qwen3-8B-Router -> lokale Antwort oder Hermes/Kimi -> Piper-TTS.

Fail closed: ohne Sprecherprofil/ECAPA startet der Dienst nicht; unbekannte Sprecher werden still ignoriert.
Keine Rohaudios werden gespeichert, nur Metadaten in logs/voice.jsonl.
"""
import argparse
import collections
import datetime
import http.server
import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import winsound

ROOT = os.path.dirname(os.path.abspath(__file__))
JARVIS = os.path.dirname(ROOT)
sys.path.insert(0, ROOT)
os.environ.setdefault("HF_HOME", os.path.join(JARVIS, "cache", "huggingface"))

import cuda_dlls  # noqa: E402

cuda_dlls.register()

import numpy as np  # noqa: E402
import sounddevice as sd  # noqa: E402
import torch  # noqa: E402

SR = 16000
CHUNK = 1280  # 80 ms, Eingabegroesse von openWakeWord
VAD_FRAME = 512
LOG_PATH = os.path.join(JARVIS, "logs", "voice.jsonl")

# Kompaktes Zeilenformat statt JSON: Qwen erzeugt ~40 tok/s, ein JSON-Objekt kostete ~1,2 s, diese Zeile ~0,3 s.
ROUTER_PROMPT = """JETZT IST: {now}. Nutze fuer Uhrzeit/Datum ausschliesslich diesen Wert.
{persona} Wiederhole nie nur die Frage des Nutzers.
Du bist zugleich der lokale Router. Antworte mit GENAU einer Zeile:
ROUTE|BG|CONFIRM|PRIO|ANTWORT
ROUTE:
- L = lokal: Smalltalk, Uhrzeit/Datum, Rechnen, einfache Wissensfragen. ANTWORT = 1-2 kurze gesprochene Saetze, kein Markdown.
- K1 = Kimi Routine: braucht Tools/Daten (Mails, Kalender, Dateien, Status, Erinnerungen, Kanban, Notizen).
- K2 = Kimi komplex: Recherche, Analyse, laengere Texte, Code, Praesentationen.
- K3 = Kimi maximal: kritisch/sehr komplex mit hohem Risiko.
BG = 1 nur wenn die Aufgabe laenger als etwa eine Minute dauert (Recherche, Analyse, Erstellung), sonst 0.
CONFIRM = 1 bei Senden, Loeschen, Kaufen, Termin aendern, Zahlungen, sonst 0.
PRIO = P0 (Notfall) bis P4 (Info).
Bei K1/K2/K3 bleibt ANTWORT leer.
Beispiele:
Wie viel ist 3 mal 4? -> L|0|0|P4|3 mal 4 ist 12.
Hey, alles gut bei dir? -> L|0|0|P4|{smalltalk_example}
Was steht heute im Kalender? -> K1|0|0|P3|
Recherchiere unsere drei Hauptwettbewerber. -> K2|1|0|P3|"""

# Kimi-Routen enden zwingend leer: das 4B-Modell erfand sonst Antworten ("Die Ueberweisung ist bestaetigt").
ROUTER_GRAMMAR = r'''root ::= "L|" bit "|" bit "|" prio "|" text | kroute "|" bit "|" bit "|" prio "|"
kroute ::= "K1" | "K2" | "K3"
bit ::= "0" | "1"
prio ::= "P0" | "P1" | "P2" | "P3" | "P4"
text ::= [^\n|]*'''

ROUTE_NAMES = {"L": "local", "K1": "kimi_low", "K2": "kimi_high", "K3": "kimi_max"}

# Standardwerte = Kira; Jarvis & Co. ueberschreiben sie in config\voice.json.
DEFAULT_PERSONA = "Du bist Kira, eine persoenliche KI-Assistentin: freundlich, locker, du duzt den Nutzer."
DEFAULT_SMALLTALK = "Mir geht's gut, danke! Was kann ich fuer dich tun?"
DEFAULT_ACK_WAIT = "Moment."
DEFAULT_ACK_BACKGROUND = "Verstanden, ich kuemmere mich darum und melde mich, sobald es fertig ist."

HERMES_VOICE_SYSTEM = ("Diese Anfrage kommt per Sprache vom Owner (Sprecher verifiziert). Deine Antwort wird "
                       "vorgelesen: kurz, gesprochenes Deutsch, kein Markdown, keine Emojis, keine Signatur, "
                       "keine URLs vorlesen. Aufwandsstufe: {effort}. Tier-2/3-Aktionen (Senden, Loeschen, Kaufen, "
                       "Termin aendern, Finanzen) NICHT ausfuehren, sondern Entwurf erstellen und Bestaetigung "
                       "anfordern.")

STOP_WORDS = re.compile(r"^\s*(stopp?|stop|abbrechen|halt|ruhe|sei still)[\s.!]*$", re.IGNORECASE)


def log_event(**fields) -> None:
    fields["ts"] = datetime.datetime.now().isoformat(timespec="milliseconds")
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(fields, ensure_ascii=False) + "\n")


WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
MONTHS = ["Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
          "November", "Dezember"]
TIME_Q = re.compile(r"\b(wie spaet|wie spät|uhrzeit|wieviel uhr|wie viel uhr)\b", re.IGNORECASE)
DATE_Q = re.compile(r"\b(welcher tag|welches datum|datum heute|der wievielte|welcher wochentag|was fuer ein tag|"
                    r"was für ein tag)\b", re.IGNORECASE)


def clock_answer(text: str) -> str | None:
    """Uhrzeit/Datum direkt aus der Systemuhr: das 4B-Modell kopierte sonst Prompt-Platzhalter."""
    if len(text) > 60:
        return None
    now = datetime.datetime.now()
    if TIME_Q.search(text):
        return f"Es ist {now.hour} Uhr {now.minute}." if now.minute else f"Es ist {now.hour} Uhr."
    if DATE_Q.search(text):
        return f"Heute ist {WEEKDAYS[now.weekday()]}, der {now.day}. {MONTHS[now.month - 1]} {now.year}."
    return None


def clean_for_speech(text: str) -> str:
    """Markdown, URLs und Emojis (z. B. Kiras Signatur) nicht vorlesen."""
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_`#>|~]+", " ", text)
    text = re.sub(r"[\U0001F000-\U0001FAFF☀-➿️]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def post_json(url: str, payload: dict, headers: dict | None = None, timeout: float = 60) -> dict:
    req = urllib.request.Request(url, json.dumps(payload).encode("utf-8"),
                                 {"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class Speaker:
    """Kiras Stimme: Streaming vom Qwen3-TTS-Server (WSL, GPU), Piper als Fallback. Unterbrechbar (Barge-In)."""

    CACHE_MAX_CHARS = 80

    def __init__(self, fallback_voice_path: str, output_device, tts_url: str | None, film_filter: bool = False):
        from piper import PiperVoice
        self.voice = PiperVoice.load(fallback_voice_path)
        self.sr = self.voice.config.sample_rate
        self.film_filter = film_filter  # JARVIS-Filmklang (Chorus + Hall) auf Piper-Ausgabe, laeuft auf der CPU
        self.output_device = output_device
        self.tts_url = tts_url
        self.cache: dict[str, tuple[bytes, int]] = {}
        self.queue: queue.Queue[str] = queue.Queue()
        self.stop_flag = threading.Event()
        self.speaking = threading.Event()
        threading.Thread(target=self._worker, daemon=True).start()

    def prefetch(self, texts: list[str]) -> None:
        """Feste Kurzsaetze vorab synthetisieren, damit z. B. "Moment." ohne Wartezeit kommt."""
        if not self.tts_url:
            return  # Piper ist ohnehin schnell genug, kein Server zum Vorladen
        for text in texts:
            try:
                self._stream_from_server(clean_for_speech(text), play=False)
            except Exception as exc:
                log_event(event="tts_prefetch_failed", error=str(exc))
                return

    def _stream_from_server(self, text: str, play: bool = True) -> None:
        if text in self.cache:
            pcm, sr = self.cache[text]
            if play:
                with sd.RawOutputStream(samplerate=sr, channels=1, dtype="int16", device=self.output_device) as out:
                    for i in range(0, len(pcm), 4096):
                        if self.stop_flag.is_set():
                            return
                        out.write(pcm[i:i + 4096])
            return
        req = urllib.request.Request(self.tts_url, json.dumps({"text": text}).encode("utf-8"),
                                     {"Content-Type": "application/json"})
        collected = bytearray()
        with urllib.request.urlopen(req, timeout=60) as resp:
            sr = int(resp.headers["X-Sample-Rate"])
            out = sd.RawOutputStream(samplerate=sr, channels=1, dtype="int16", device=self.output_device) if play else None
            try:
                if out:
                    out.start()
                pending = b""
                while True:
                    if self.stop_flag.is_set():
                        return  # Verbindung schliesst -> Server bricht die Synthese ab
                    block = resp.read(4096)
                    if not block:
                        break
                    collected += block
                    data, pending = pending + block, b""
                    if len(data) % 2:
                        data, pending = data[:-1], data[-1:]
                    if out:
                        out.write(data)
            finally:
                if out:
                    out.stop()
                    out.close()
        if len(text) <= self.CACHE_MAX_CHARS:
            self.cache[text] = (bytes(collected), sr)

    def _play_piper(self, text: str) -> None:
        from film_filter import FilmFilter
        fx = FilmFilter(self.sr, self.film_filter)
        with sd.OutputStream(samplerate=self.sr, channels=1, dtype="float32", device=self.output_device) as out:
            for chunk in self.voice.synthesize(text):
                if self.stop_flag.is_set():
                    return
                out.write(fx.process(chunk.audio_float_array).reshape(-1, 1))
            tail = fx.flush()
            if len(tail) and not self.stop_flag.is_set():
                out.write(tail.reshape(-1, 1))

    def say(self, text: str) -> None:
        text = clean_for_speech(text)
        if text:
            # Flag schon beim Einreihen setzen: sonst startet die Folgefrage-Aufnahme, bevor der Worker
            # losspricht, und Kira hoert ihre eigene Stimme (live beobachtet, beendete die Trusted Session).
            self.speaking.set()
            self.queue.put(text)

    def interrupt(self) -> None:
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
            except queue.Empty:
                break
        self.stop_flag.set()
        sd.stop()
        self.speaking.clear()

    def _worker(self) -> None:
        while True:
            text = self.queue.get()
            self.stop_flag.clear()
            self.speaking.set()
            try:
                if self.tts_url:
                    try:
                        self._stream_from_server(text)
                    except (urllib.error.URLError, ConnectionError, TimeoutError, KeyError) as exc:
                        log_event(event="tts_server_fallback", error=str(exc))
                        self._play_piper(text)
                else:
                    self._play_piper(text)
            except Exception as exc:  # Wiedergabefehler duerfen den Dienst nicht beenden
                log_event(event="tts_error", error=str(exc))
            finally:
                if self.queue.empty():
                    time.sleep(0.35)  # Nachhall aus den Lautsprechern abklingen lassen
                    if self.queue.empty():
                        self.speaking.clear()


class SpeakerVerifier:
    def __init__(self, profile_path: str, threshold: float):
        from speechbrain.inference.speaker import EncoderClassifier
        from speechbrain.utils.fetching import LocalStrategy
        if not os.path.exists(profile_path):
            raise SystemExit(f"Sprecherprofil fehlt: {profile_path} - fail closed, Dienst startet nicht.")
        self.profile = np.load(profile_path)
        self.threshold = threshold
        # COPY statt Symlink: Windows-Symlinks brauchen Sonderrechte und erzeugen sonst eine Warnung.
        self.enc = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                                  savedir=os.path.join(JARVIS, "models", "ecapa"),
                                                  local_strategy=LocalStrategy.COPY)

    def score(self, audio: np.ndarray) -> float:
        frames = [audio[i:i + 320] for i in range(0, len(audio) - 320, 320)]
        voiced = [f for f in frames if np.sqrt(np.mean(f ** 2)) > 0.02]
        if len(voiced) < 25:  # < 0,5 s Sprache: kein belastbares Embedding
            return -1.0
        with torch.no_grad():
            emb = self.enc.encode_batch(torch.from_numpy(np.concatenate(voiced)).unsqueeze(0)).squeeze().numpy()
        return float(np.dot(emb / np.linalg.norm(emb), self.profile))


class KiraVoice:
    def __init__(self, cfg: dict, test_wake_model: str | None):
        self.cfg = cfg
        self.status = {"state": "starting", "started": datetime.datetime.now().isoformat(timespec="seconds"),
                       "last_event": None, "wake_count": 0, "rejected_speaker": 0, "commands": 0}
        self.audio_q: queue.Queue[np.ndarray] = queue.Queue()
        self.ring = collections.deque(maxlen=int(2.0 * SR / CHUNK))  # 2 s Vorlauf fuer Sprecherpruefung
        self.trusted_until = 0.0
        self.last_wake = 0.0
        self.history: list[dict] = []
        self.hermes_key = open(cfg["hermes_key_file"], encoding="utf-8").read().strip()

        print("Lade Modelle ...", flush=True)
        self.verifier = SpeakerVerifier(cfg["speaker_profile"], cfg["speaker_threshold"])
        self._load_wake(test_wake_model)
        from silero_vad import load_silero_vad
        self.vad = load_silero_vad(onnx=True)
        from faster_whisper import WhisperModel
        self.whisper = WhisperModel(cfg["whisper_model"], device=cfg.get("whisper_device", "cuda"),
                                    compute_type=cfg["whisper_compute_type"],
                                    download_root=os.path.join(JARVIS, "models", "whisper"))
        self.whisper.transcribe(np.zeros(SR, dtype=np.float32), language="de")  # CUDA-Warmup
        self.tts = Speaker(cfg["tts_voice"], cfg["output_device"], cfg.get("tts_url"), cfg.get("tts_film_filter", False))
        self.tts.prefetch([cfg.get("ack_wait", DEFAULT_ACK_WAIT), cfg.get("ack_background", DEFAULT_ACK_BACKGROUND)])
        self._route("Hallo")  # Router-Warmup: erster Aufruf dauerte live 7,2 s statt ~0,4 s

    def _load_wake(self, test_wake_model: str | None) -> None:
        from openwakeword.model import Model
        oww_dir = os.path.join(JARVIS, "models", "openwakeword")
        path = test_wake_model or self.cfg["wake_model"]
        if not os.path.exists(path):
            raise SystemExit(f"Wake-Word-Modell fehlt: {path}")
        kwargs = {}
        if not test_wake_model and os.path.exists(self.cfg["wake_verifier"]):
            name = os.path.splitext(os.path.basename(path))[0]
            kwargs = {"custom_verifier_models": {name: self.cfg["wake_verifier"]},
                      "custom_verifier_threshold": self.cfg["wake_verifier_threshold"]}
        self.oww = Model(wakeword_models=[path], inference_framework="onnx",
                         melspec_model_path=os.path.join(oww_dir, "melspectrogram.onnx"),
                         embedding_model_path=os.path.join(oww_dir, "embedding_model.onnx"), **kwargs)
        self.wake_name = list(self.oww.models.keys())[0]
        print(f"Wake-Modell: {self.wake_name}  Verifier: {'ja' if kwargs else 'nein'}", flush=True)

    # ---------- Audio ----------
    def _on_audio(self, indata, frames, time_info, status) -> None:
        self.audio_q.put(indata[:, 0].copy())

    def _read_chunk(self) -> np.ndarray:
        chunk = self.audio_q.get()
        self.ring.append(chunk)
        return chunk

    def _drain(self) -> None:
        while not self.audio_q.empty():
            self.audio_q.get_nowait()
        self.oww.reset()

    def _record_command(self, start_timeout: float) -> np.ndarray | None:
        """Nimmt bis Sprechende auf. None, wenn innerhalb start_timeout keine Sprache beginnt."""
        cfg = self.cfg
        buf: list[np.ndarray] = []
        pending = np.zeros(0, dtype=np.float32)
        started = False
        silence = 0.0
        t0 = time.monotonic()
        self.vad.reset_states()
        while True:
            chunk = self._read_chunk().astype(np.float32) / 32768.0
            pending = np.concatenate([pending, chunk])
            while len(pending) >= VAD_FRAME:
                frame, pending = pending[:VAD_FRAME], pending[VAD_FRAME:]
                prob = float(self.vad(torch.from_numpy(frame), SR))
                if prob >= cfg["vad_threshold"]:
                    started = True
                    silence = 0.0
                elif started:
                    silence += VAD_FRAME / SR
                if started:
                    buf.append(frame)
            elapsed = time.monotonic() - t0
            if not started and elapsed > start_timeout:
                return None
            if started and (silence >= cfg["command_end_silence_s"] or elapsed > cfg["command_max_s"]):
                return np.concatenate(buf)

    # ---------- Verarbeitung ----------
    def _transcribe(self, audio: np.ndarray) -> str:
        segs, _ = self.whisper.transcribe(audio, language="de", beam_size=1, vad_filter=False,
                                          initial_prompt=f"{self.cfg['assistant_name']}, Sprachassistent.")
        return " ".join(s.text.strip() for s in segs).strip()

    def _route(self, text: str) -> dict:
        direct = clock_answer(text)
        if direct:
            return {"route": "local", "background": False, "needs_confirmation": False, "priority": "P4",
                    "intent": "clock", "answer": direct}
        dt = datetime.datetime.now()
        now = f"{WEEKDAYS[dt.weekday()]}, {dt:%d.%m.%Y}, {dt:%H:%M} Uhr"
        payload = {
            "model": "qwen3-router",
            "messages": [{"role": "system", "content": ROUTER_PROMPT.format(
                now=now, persona=self.cfg.get("persona", DEFAULT_PERSONA),
                smalltalk_example=self.cfg.get("smalltalk_example", DEFAULT_SMALLTALK))}, *self.history[-6:],
                         {"role": "user", "content": text}],
            "temperature": 0.2,
            "max_tokens": 120,
            "chat_template_kwargs": {"enable_thinking": False},
            "grammar": ROUTER_GRAMMAR,
        }
        try:
            content = post_json(self.cfg["qwen_url"], payload, timeout=20)["choices"][0]["message"]["content"]
            route, bg, confirm, prio, answer = content.strip().split("|", 4)
            return {"route": ROUTE_NAMES[route], "background": bg == "1", "needs_confirmation": confirm == "1",
                    "priority": prio, "intent": route, "answer": answer.strip()}
        except Exception as exc:  # Plan: ungueltige Ausgabe / Qwen down -> kimi_low
            log_event(event="router_fallback", error=str(exc))
            return {"route": "kimi_low", "background": False, "priority": "P3", "needs_confirmation": False,
                    "intent": "fallback", "answer": ""}

    def _ask_hermes(self, text: str, decision: dict, task_id: str) -> str:
        effort = {"kimi_low": "low", "kimi_high": "high", "kimi_max": "max"}[decision["route"]]
        payload = {"model": self.cfg.get("hermes_model", "kira"), "messages": [
            {"role": "system", "content": HERMES_VOICE_SYSTEM.format(effort=effort)},
            *self.history[-6:], {"role": "user", "content": text}]}
        t = time.monotonic()
        try:
            resp = post_json(self.cfg["hermes_url"], payload, {"Authorization": f"Bearer {self.hermes_key}"},
                             timeout=900)
            answer = resp["choices"][0]["message"]["content"].strip()
            log_event(event="hermes_done", task_id=task_id, route=decision["route"],
                      duration_s=round(time.monotonic() - t, 2), success=True)
            return answer
        except Exception as exc:
            log_event(event="hermes_error", task_id=task_id, error=str(exc), success=False)
            return "Der Cloud-Agent ist derzeit nicht verfuegbar. Lokale Funktionen bleiben aktiv."

    def _handle_command(self, audio: np.ndarray, wake_audio: np.ndarray | None) -> None:
        t0 = time.monotonic()
        probe = np.concatenate([wake_audio, audio]) if wake_audio is not None else audio
        score = self.verifier.score(probe)
        if score == -1.0:
            # Zu wenig Sprache fuer ein Embedding (Raeuspern, Geraeusch): ignorieren, Session nicht beenden.
            log_event(event="too_short", followup=wake_audio is None)
            return
        if score < self.cfg["speaker_threshold"]:
            self.status["rejected_speaker"] += 1
            self.trusted_until = 0.0  # Plan: unbekannter Sprecher schliesst die Trusted Session sofort
            log_event(event="speaker_rejected", score=round(score, 3), followup=wake_audio is None)
            return
        self.trusted_until = time.monotonic() + self.cfg["trusted_session_s"]
        t_stt = time.monotonic()
        text = self._transcribe(audio)
        stt_ms = (time.monotonic() - t_stt) * 1000
        if not text:
            log_event(event="empty_transcript", speaker_score=round(score, 3))
            return
        print(f"> {text}", flush=True)
        if STOP_WORDS.match(text):
            self.tts.interrupt()
            log_event(event="stop", text=text)
            return
        self.status["commands"] += 1
        t_route = time.monotonic()
        decision = self._route(text)
        route_ms = (time.monotonic() - t_route) * 1000
        task_id = uuid.uuid4().hex[:8]
        log_event(event="command", task_id=task_id, channel="voice", intent=decision.get("intent"),
                  route=decision["route"], background=decision.get("background"),
                  priority=decision.get("priority"), speaker_score=round(score, 3),
                  stt_ms=round(stt_ms), router_ms=round(route_ms), total_ms=round((time.monotonic() - t0) * 1000))
        self.history += [{"role": "user", "content": text}]

        if decision["route"] == "local" and decision.get("answer"):
            print(f"< {decision['answer']}", flush=True)
            self.tts.say(decision["answer"])
            self.history += [{"role": "assistant", "content": decision["answer"]}]
            return

        if decision.get("background"):
            self.tts.say(self.cfg.get("ack_background", DEFAULT_ACK_BACKGROUND))
            threading.Thread(target=self._background, args=(text, decision, task_id), daemon=True).start()
            return
        self.tts.say(self.cfg.get("ack_wait", DEFAULT_ACK_WAIT))
        answer = self._ask_hermes(text, decision, task_id)
        print(f"< {answer}", flush=True)
        self.tts.say(answer)
        self.history += [{"role": "assistant", "content": answer}]

    def _background(self, text: str, decision: dict, task_id: str) -> None:
        answer = self._ask_hermes(text, decision, task_id)
        self.tts.say("Ergebnis zur Aufgabe: " + answer)

    # ---------- Hauptschleife ----------
    def run(self) -> None:
        cfg = self.cfg
        self._start_health()
        threading.Thread(target=self._game_mode_watcher, daemon=True).start()
        with sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
                            device=cfg["input_device"], callback=self._on_audio):
            self.status["state"] = "listening"
            print(f"{cfg['assistant_name']} hoert zu (sag '{cfg.get('wake_phrase', 'Hey Kira')}').", flush=True)
            winsound.Beep(900, 120)
            while True:
                if self._wake_detected(self._read_chunk()):
                    self._session()

    def _wake_detected(self, chunk: np.ndarray) -> bool:
        score = float(self.oww.predict(chunk).get(self.wake_name, 0.0))
        if score < self.cfg["wake_threshold"]:
            return False
        if time.monotonic() - self.last_wake < 1.5:  # Doppelausloesung auf dasselbe "Hey Kira" verhindern
            return False
        self.last_wake = time.monotonic()
        # Modellpuffer leeren: er enthaelt noch das erkannte "Hey Kira" und loeste sonst sofort ein zweites
        # Mal aus - live als Barge-In 23 ms nach dem Befehl beobachtet, das schaltete Kiras Antwort stumm.
        self.oww.reset()
        self.status["wake_count"] += 1
        self.status["last_event"] = datetime.datetime.now().isoformat(timespec="seconds")
        barge_in = self.tts.speaking.is_set()
        if barge_in:
            self.tts.interrupt()
        log_event(event="wake", score=round(score, 3), barge_in=barge_in)
        return True

    def _acknowledge_wake(self) -> np.ndarray:
        wake_audio = np.concatenate(list(self.ring)).astype(np.float32) / 32768.0
        winsound.Beep(1200, 80)
        # Waehrend des Pieptons aufgenommene Bloecke verwerfen: sonst startet der Piepton selbst die
        # Befehlsaufnahme und endet nach 0,7 s "Stille" mit leerem Transkript (live beobachtet).
        while not self.audio_q.empty():
            self.audio_q.get_nowait()
        return wake_audio

    def _session(self) -> None:
        """Ein Wake-Ereignis: Befehl, danach Folgefragen ohne Wake Word, solange die Trusted Session laeuft.
        Waehrend Kira spricht, laeuft die Wake-Word-Erkennung weiter (Barge-In)."""
        cfg = self.cfg
        wake_audio = self._acknowledge_wake()
        self.status["state"] = "command"
        audio = self._record_command(cfg["command_start_timeout_s"])
        if audio is None:
            log_event(event="no_speech_after_wake")
        else:
            self._handle_command(audio, wake_audio)
        while time.monotonic() < self.trusted_until:
            self.status["state"] = "speaking"
            interrupted = False
            self._drain()  # waehrend der Verarbeitung aufgelaufenes Audio nicht als Barge-In auswerten
            while self.tts.speaking.is_set():
                if self._wake_detected(self._read_chunk()):
                    interrupted = True
                    break
            self._drain()
            if interrupted:
                wake_audio = self._acknowledge_wake()
                self.status["state"] = "command"
                audio = self._record_command(cfg["command_start_timeout_s"])
                if audio is not None:
                    self._handle_command(audio, wake_audio)
                continue
            self.status["state"] = "followup"
            audio = self._record_command(cfg["followup_window_s"])
            if audio is None:
                break
            self._handle_command(audio, None)
        self._drain()
        self.status["state"] = "listening"

    def _game_mode_watcher(self) -> None:
        """Gaming-Modus: laeuft ein Spiel aus cfg["game_processes"], wird der GPU-TTS-Server (~3,5 GB VRAM)
        gestoppt und Kira spricht mit Piper (CPU). Nach Spielende wird Stimme 3 wieder hochgefahren."""
        games = [g.lower() for g in self.cfg.get("game_processes", [])]
        tts_url = self.cfg.get("tts_url")
        if not games or not tts_url:
            return
        wsl_tts = ["wsl.exe", "-d", "Ubuntu", "--exec", "bash", "-c"]
        no_window = subprocess.CREATE_NO_WINDOW
        while True:
            try:
                out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                                     creationflags=no_window, timeout=15).stdout.lower()
                running = [g for g in games if f'"{g}"' in out]
                if running and not self.status.get("game_mode"):
                    self.status["game_mode"] = running[0]
                    self.tts.tts_url = None
                    subprocess.run(wsl_tts + ["systemctl --user stop kira-tts"], creationflags=no_window, timeout=60)
                    log_event(event="game_mode_on", game=running[0])
                elif not running and self.status.get("game_mode"):
                    subprocess.run(wsl_tts + ["systemctl --user start kira-tts"], creationflags=no_window, timeout=60)
                    health = tts_url.rsplit("/tts", 1)[0] + "/health"
                    for _ in range(60):  # Modell + CUDA-Graphs laden ~1-2 min
                        try:
                            urllib.request.urlopen(health, timeout=3)
                            break
                        except Exception:
                            time.sleep(3)
                    self.tts.tts_url = tts_url
                    log_event(event="game_mode_off", game=self.status["game_mode"])
                    self.status["game_mode"] = None
            except Exception as exc:
                log_event(event="game_mode_error", error=str(exc))
            time.sleep(self.cfg.get("game_check_s", 10))

    def _start_health(self) -> None:
        service = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({**service.status, "speaking": service.tts.speaking.is_set(),
                                   "trusted": time.monotonic() < service.trusted_until}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        srv = http.server.ThreadingHTTPServer(("127.0.0.1", self.cfg["health_port"]), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(JARVIS, "config", "voice.json"))
    ap.add_argument("--test-wake-model", help="Ersatzmodell zum Testen der Kette (z. B. hey_jarvis), ohne Verifier")
    args = ap.parse_args()
    cfg = json.load(open(args.config, encoding="utf-8-sig"))  # BOM-tolerant (Windows-Editoren)
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    KiraVoice(cfg, args.test_wake_model).run()


if __name__ == "__main__":
    main()
