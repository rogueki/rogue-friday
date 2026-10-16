"""Voice Service (Windows) fuer den Assistenten - Name, Persona, Wake Word und Wake-Engine per config/voice.json.

Mikrofon -> Wake Word -> Befehl per Silero-VAD -> ECAPA-Sprecherpruefung
-> faster-whisper (GPU) -> Qwen-Router -> lokale Antwort oder Hermes/Kimi -> gewählte TTS-Stimme.

Wake-Engines (voice.json "wake_engine"):
- "openwakeword": vortrainiertes hey_jarvis + Owner-Verifier (nur die Wake Phrase "Hey Jarvis").
- "personal": persoenliches Wake Word fuer eine frei gewaehlte Phrase (personal_wake.py): Stufe 1 Few-Shot-Fenstermodell
  auf openWakeWord-Features, Stufe 2 Whisper-Abgleich mit der ganzen Phrase nur wenn Stufe 1 ausloest, danach wie immer
  die ECAPA-Sprecherpruefung.

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
INSTALL_ROOT = os.path.dirname(ROOT)
sys.path.insert(0, ROOT)
os.environ.setdefault("HF_HOME", os.path.join(INSTALL_ROOT, "cache", "huggingface"))

import cuda_dlls  # noqa: E402

cuda_dlls.register()

import numpy as np  # noqa: E402
import sounddevice as sd  # noqa: E402
import torch  # noqa: E402

import personal_wake  # noqa: E402
from content_studio_voice import ContentStudioVoice  # noqa: E402
from skills_onboarding_voice import SkillsOnboardingVoice  # noqa: E402
from audio_level import LevelMeter  # noqa: E402

SR = 16000
CHUNK = 1280  # 80 ms, Eingabegroesse von openWakeWord
VAD_FRAME = 512
LOG_PATH = os.path.join(INSTALL_ROOT, "logs", "voice.jsonl")

# Kompaktes Zeilenformat statt JSON: Qwen erzeugt ~40 tok/s, ein JSON-Objekt kostete ~1,2 s, diese Zeile ~0,3 s.
ROUTER_PROMPT = """JETZT IST: {now}. Nutze fuer Uhrzeit/Datum ausschliesslich diesen Wert.
{persona} Wiederhole nie nur die Frage des Nutzers.
Du bist zugleich der lokale Router. Antworte mit GENAU einer Zeile:
ROUTE|BG|CONFIRM|PRIO|ANTWORT
ROUTE:
- L = lokal: Smalltalk, Uhrzeit/Datum, Rechnen, einfache Wissensfragen. ANTWORT = 1-2 kurze gesprochene Saetze, kein Markdown.
- K1 = Cloud Routine: braucht Tools/Daten (Mails, Kalender, Dateien, Status, Erinnerungen, Kanban, Notizen).
- K2 = Cloud komplex: Recherche, Analyse, laengere Texte, Code, Praesentationen.
- K3 = Cloud maximal: kritisch/sehr komplex mit hohem Risiko.
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

ROUTE_NAMES = {"L": "local", "K1": "cloud_low", "K2": "cloud_high", "K3": "cloud_max"}
ROUTE_EFFORT = {"cloud_low": "none", "cloud_high": "high", "cloud_max": "max"}
KIMI_MODELS = {"cloud_low": "kimi-for-coding", "cloud_high": "k3", "cloud_max": "k3"}

# Standardwerte (Friday); der Installer schreibt Name, Persona und Sprachbausteine in config\voice.json.
DEFAULT_NAME = "Friday"
DEFAULT_PERSONA = "Du bist {name}, ein persoenlicher KI-Assistent: freundlich, locker, du duzt den Nutzer."
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
    """Markdown, URLs und Emojis (z. B. Signaturen) nicht vorlesen."""
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
    """Gewählte Stimme mit unterbrechbarer Wiedergabe und Piper als Ausfallreserve."""

    CACHE_MAX_CHARS = 80

    def __init__(self, fallback_voice_path: str, output_device, tts_url: str | None, film_filter: bool = False,
                 speaker_id: int | None = None, tts_config: dict | None = None):
        from piper import PiperVoice
        self.voice = PiperVoice.load(fallback_voice_path)
        self.speaker_id = speaker_id
        self.sr = self.voice.config.sample_rate
        self.film_filter = film_filter  # Filmklang (Chorus + Hall) auf Piper-Ausgabe, laeuft auf der CPU
        self.output_device = output_device
        self.tts_url = tts_url
        self.tts_config = tts_config or {}
        self.cache: dict[str, tuple[bytes, int]] = {}
        self.qwen_cache: collections.OrderedDict[str, tuple[np.ndarray, int]] = collections.OrderedDict()
        self.queue: queue.Queue[str] = queue.Queue()
        self.stop_flag = threading.Event()
        self.speaking = threading.Event()
        self.level = LevelMeter()  # nur ein Pegelwert 0..1 fuer das Status-JSON, kein Audio
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
        from audio_output import OUTPUT_TAIL_SECONDS
        import av
        import itertools

        def play_pcm(chunks, source_rate):
            target_rate = round(sd.query_devices(self.output_device, "output")["default_samplerate"])
            if target_rate <= 0:
                raise ValueError("Ausgabegeraet meldet keine gueltige Abtastrate")
            resampler = (av.AudioResampler(format="flt", layout="mono", rate=target_rate)
                         if source_rate != target_rate else None)
            underflows = 0
            with sd.OutputStream(samplerate=target_rate, channels=1, dtype="float32",
                                 device=self.output_device) as out:
                for block in chunks:
                    if self.stop_flag.is_set():
                        return underflows
                    pcm = np.frombuffer(block, dtype="<i2")
                    if resampler:
                        frame = av.AudioFrame.from_ndarray(pcm.reshape(1, -1).copy(), format="s16", layout="mono")
                        frame.sample_rate = source_rate
                        frames = resampler.resample(frame)
                        samples = (output.to_ndarray().reshape(-1) for output in frames)
                    else:
                        samples = (pcm.astype(np.float32) / 32768.0,)
                    for audio in samples:
                        self.level.update(audio)
                        underflows += bool(out.write(audio.reshape(-1, 1)))
                if not self.stop_flag.is_set():
                    if resampler:
                        for output in resampler.resample(None):
                            audio = output.to_ndarray().reshape(-1)
                            self.level.update(audio)
                            underflows += bool(out.write(audio.reshape(-1, 1)))
                    out.write(np.zeros((round(target_rate * OUTPUT_TAIL_SECONDS), 1), dtype=np.float32))
            return underflows

        if text in self.cache:
            pcm, sr = self.cache[text]
            if play:
                underflows = play_pcm((pcm[i:i + 4096] for i in range(0, len(pcm), 4096)), sr)
                log_event(event="tts_stream", cached=True, underflows=underflows, audio_s=round(len(pcm) / 2 / sr, 2))
            return
        req = urllib.request.Request(self.tts_url, json.dumps({"text": text}).encode("utf-8"),
                                     {"Content-Type": "application/json"})
        collected = bytearray()
        with urllib.request.urlopen(req, timeout=60) as resp:
            sr = int(resp.headers["X-Sample-Rate"])
            def received():
                pending = b""
                while True:
                    if self.stop_flag.is_set():
                        return
                    block = resp.read1(4096)
                    if not block:
                        break
                    collected.extend(block)
                    data, pending = pending + block, b""
                    if len(data) % 2:
                        data, pending = data[:-1], data[-1:]
                    if data:
                        yield data
            if play:
                chunks = received()
                buffered = []
                buffered_bytes = 0
                # Laengere Saetze brauchen Vorlauf: die GPU kann zwischen zwei generierten
                # Audiobloecken kurz pausieren. Kurze Antworten bleiben direkt hoerbar.
                target_bytes = int(sr * 2 * (0.55 if len(text) <= 35 else 1.6))
                while buffered_bytes < target_bytes:
                    try:
                        block = next(chunks)
                    except StopIteration:
                        break
                    buffered.append(block)
                    buffered_bytes += len(block)
                underflows = play_pcm(itertools.chain(buffered, chunks), sr)
                log_event(event="tts_stream", cached=False, underflows=underflows,
                          buffer_s=round(buffered_bytes / 2 / sr, 2),
                          audio_s=round(len(collected) / 2 / sr, 2))
            else:
                for _ in received():
                    pass
        if len(text) <= self.CACHE_MAX_CHARS:
            self.cache[text] = (bytes(collected), sr)

    def _play_piper(self, text: str) -> None:
        from film_filter import FilmFilter
        fx = FilmFilter(self.sr, self.film_filter)
        with sd.OutputStream(samplerate=self.sr, channels=1, dtype="float32", device=self.output_device) as out:
            from piper import SynthesisConfig
            for chunk in self.voice.synthesize(text, syn_config=SynthesisConfig(speaker_id=self.speaker_id)):
                if self.stop_flag.is_set():
                    return
                shaped = fx.process(chunk.audio_float_array)
                self.level.update(shaped)
                out.write(shaped.reshape(-1, 1))
            tail = fx.flush()
            if len(tail) and not self.stop_flag.is_set():
                out.write(tail.reshape(-1, 1))

    def _play_qwen(self, text: str) -> None:
        import qwen_tts
        from audio_output import for_output_device
        cached = text in self.qwen_cache
        started = time.monotonic()
        if cached:
            audio, rate = self.qwen_cache[text]
            self.qwen_cache.move_to_end(text)
        else:
            result = qwen_tts.synthesize(text, self.tts_config, self.stop_flag)
            if result is None:
                return
            audio, rate = result
            if len(text) <= self.CACHE_MAX_CHARS:
                self.qwen_cache[text] = (audio, rate)
                if len(self.qwen_cache) > 32:
                    self.qwen_cache.popitem(last=False)
        log_event(event="tts_synthesis", backend="qwen3", cached=cached,
                  duration_s=round(time.monotonic() - started, 2), audio_s=round(len(audio) / rate, 2))
        if self.film_filter:
            from film_filter import FilmFilter
            effect = FilmFilter(rate, True)
            audio = np.concatenate((effect.process(audio), effect.flush()))
        audio, rate = for_output_device(audio, rate, self.output_device)
        with sd.OutputStream(samplerate=rate, channels=1, dtype="float32", device=self.output_device) as out:
            for offset in range(0, len(audio), 4096):
                if self.stop_flag.is_set():
                    return
                block = audio[offset:offset + 4096]
                self.level.update(block)
                out.write(block.reshape(-1, 1))

    def say(self, text: str) -> None:
        text = clean_for_speech(text)
        if text:
            # Flag schon beim Einreihen setzen: sonst startet die Folgefrage-Aufnahme, bevor der Worker
            # losspricht, und der Assistent hoert seine eigene Stimme (live beobachtet, beendete die Trusted Session).
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
        self.level.reset()

    def _worker(self) -> None:
        while True:
            text = self.queue.get()
            self.stop_flag.clear()
            self.speaking.set()
            try:
                if self.tts_config.get("tts_backend") == "qwen3":
                    try:
                        self._play_qwen(text)
                    except (OSError, RuntimeError, TimeoutError) as exc:
                        log_event(event="tts_qwen_fallback", error=str(exc))
                        if not self.stop_flag.is_set():
                            self._play_piper(text)
                elif self.tts_url:
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
                                                  savedir=os.path.join(INSTALL_ROOT, "models", "ecapa"),
                                                  local_strategy=LocalStrategy.COPY)

    def score(self, audio: np.ndarray) -> float:
        frames = [audio[i:i + 320] for i in range(0, len(audio) - 320, 320)]
        voiced = [f for f in frames if np.sqrt(np.mean(f ** 2)) > 0.02]
        if len(voiced) < 25:  # < 0,5 s Sprache: kein belastbares Embedding
            return -1.0
        with torch.no_grad():
            emb = self.enc.encode_batch(torch.from_numpy(np.concatenate(voiced)).unsqueeze(0)).squeeze().numpy()
        return float(np.dot(emb / np.linalg.norm(emb), self.profile))


class VoiceService:
    def __init__(self, cfg: dict, test_wake_model: str | None):
        self.cfg = cfg
        self.name = cfg.get("assistant_name") or DEFAULT_NAME
        self.engine = "openwakeword" if test_wake_model else cfg.get("wake_engine", "openwakeword")
        if self.engine not in ("openwakeword", "personal"):
            raise SystemExit(f"Unbekannte wake_engine '{self.engine}' in voice.json (openwakeword|personal).")
        self.phrase = cfg.get("wake_phrase") or personal_wake.wake_phrase(self.name)
        # Additive Felder (assistant_name, wake_phrase, wake_engine, wake_rejected): bisherige Schluessel bleiben gleich.
        self.status = {"state": "starting", "started": datetime.datetime.now().isoformat(timespec="seconds"),
                       "last_event": None, "wake_count": 0, "rejected_speaker": 0, "commands": 0,
                       "assistant_name": self.name, "wake_phrase": self.phrase, "wake_engine": self.engine,
                       "wake_rejected": 0}
        self.preroll: list[np.ndarray] = []   # waehrend Stufe 2 aufgelaufenes Audio (Befehlsanfang)
        self.stage1_block_until = 0.0
        self.audio_q: queue.Queue[np.ndarray] = queue.Queue()
        self.input_level = LevelMeter()  # geglaetteter Mikrofonpegel 0..1 (nur die Zahl, das Audio wird nicht gehalten)
        self.ring = collections.deque(maxlen=int(2.0 * SR / CHUNK))  # 2 s Vorlauf fuer Sprecherpruefung
        self.trusted_until = 0.0
        self.background_jobs: set[str] = set()
        self.background_reply_ready = threading.Event()
        self.last_wake = 0.0
        self.history: list[dict] = []
        self.hermes_key = open(cfg["hermes_key_file"], encoding="utf-8").read().strip()
        self.content_studio_voice = ContentStudioVoice(INSTALL_ROOT)
        self.skills_onboarding_voice = SkillsOnboardingVoice(
            INSTALL_ROOT, pending_seconds=cfg.get("followup_window_s", 15))

        print("Lade Modelle ...", flush=True)
        self.verifier = SpeakerVerifier(cfg["speaker_profile"], cfg["speaker_threshold"])
        self._load_wake(test_wake_model)
        from silero_vad import load_silero_vad
        self.vad = load_silero_vad(onnx=True)
        from faster_whisper import WhisperModel
        self.whisper = WhisperModel(cfg["whisper_model"], device=cfg.get("whisper_device", "cuda"),
                                    compute_type=cfg["whisper_compute_type"],
                                    download_root=os.path.join(INSTALL_ROOT, "models", "whisper"))
        self.whisper.transcribe(np.zeros(SR, dtype=np.float32), language="de")  # CUDA-Warmup
        self.tts = Speaker(cfg["tts_voice"], cfg["output_device"], cfg.get("tts_url"),
                           cfg.get("tts_film_filter", False), cfg.get("tts_speaker_id"), cfg)
        self.tts.prefetch([cfg.get("ack_wait", DEFAULT_ACK_WAIT), cfg.get("ack_background", DEFAULT_ACK_BACKGROUND)])
        self._route("Hallo")  # Router-Warmup: erster Aufruf dauerte live 7,2 s statt ~0,4 s

    def _load_wake(self, test_wake_model: str | None) -> None:
        oww_dir = os.path.join(INSTALL_ROOT, "models", "openwakeword")
        if self.engine == "personal":
            self._load_personal_wake(oww_dir)
            return
        from openwakeword.model import Model
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
        self.wake_threshold = self.cfg["wake_threshold"]
        print(f"Wake-Modell: {self.wake_name}  Verifier: {'ja' if kwargs else 'nein'}", flush=True)

    def _load_personal_wake(self, oww_dir: str) -> None:
        """Persoenliches Wake Word: Fenstermodell + kalibrierte Schwelle (Fail closed ohne Modell)."""
        model_path = self.cfg.get("personal_wake_model") or os.path.join(oww_dir, "personal_wake.npz")
        meta_path = self.cfg.get("personal_wake_meta") or os.path.join(oww_dir, "personal_wake.json")
        for path in (model_path, meta_path):
            if not os.path.exists(path):
                raise SystemExit(f"Persoenliches Wake-Word-Modell fehlt: {path} - Stimmaufnahme/Training erneut "
                                 "ausfuehren (install-friday.bat). Fail closed, Dienst startet nicht.")
        meta = personal_wake.load_meta(meta_path)
        if meta.get("wake_phrase") and personal_wake.phrase_key(meta["wake_phrase"]) != personal_wake.phrase_key(self.phrase):
            raise SystemExit(f"Wake-Word-Modell gehoert zu '{meta['wake_phrase']}', nicht zu '{self.phrase}'.")
        self.wake_threshold = self.cfg.get("personal_wake_threshold") or meta["threshold"]
        calibration = meta.get("calibration") or {}
        false_maxima = (calibration.get("speech_max"), calibration.get("words_max"))
        # Whisper misses many real short wake clips; bypass it only above the model's measured false-trigger maxima.
        self.wake_high_confidence = (max(self.wake_threshold, *(value + 1.0 for value in false_maxima))
                                     if all(isinstance(value, (int, float)) for value in false_maxima) else None)
        self.oww = personal_wake.PersonalWakeDetector(
            personal_wake.WindowModel.load(model_path), os.path.join(oww_dir, "melspectrogram.onnx"),
            os.path.join(oww_dir, "embedding_model.onnx"))
        self.wake_name = "personal"
        print(f"Wake Word: {self.phrase} (persoenlich, Schwelle {self.wake_threshold}, Qualitaet "
              f"{meta.get('quality', '?')}, Phrasencheck {'an' if self.cfg.get('wake_confirm', True) else 'aus'})",
              flush=True)

    # ---------- Audio ----------
    def _on_audio(self, indata, frames, time_info, status) -> None:
        self.input_level.update(indata[:, 0])
        self.audio_q.put(indata[:, 0].copy())

    def _read_chunk(self) -> np.ndarray:
        chunk = self.preroll.pop(0) if self.preroll else self.audio_q.get()
        self.ring.append(chunk)
        return chunk

    def _drain(self) -> None:
        self.preroll.clear()
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
            if self.tts.speaking.is_set():
                return None  # Hintergrundantwort darf nicht als neue Nutzerfrage aufgenommen werden.
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
                                          initial_prompt=f"{self.name}, Sprachassistent.")
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
                now=now, persona=self.cfg.get("persona", DEFAULT_PERSONA.format(name=self.name)),
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
        except Exception as exc:  # Ungueltige Ausgabe / Qwen down -> schneller Cloud-Pfad
            log_event(event="router_fallback", error=str(exc))
            return {"route": "cloud_low", "background": False, "priority": "P3", "needs_confirmation": False,
                    "intent": "fallback", "answer": ""}

    def _ask_hermes(self, text: str, decision: dict, task_id: str) -> str:
        route = decision["route"]
        provider = self.cfg.get("cloud_provider", "kimi-coding")
        models = self.cfg.get("cloud_models") or (KIMI_MODELS if provider == "kimi-coding" else {})
        model = models.get(route) or self.cfg.get("hermes_model", "friday")
        effort = ROUTE_EFFORT[route]
        payload = {"model": model, "model_options": {"reasoning_effort": effort}, "messages": [
            {"role": "system", "content": HERMES_VOICE_SYSTEM.format(effort=effort)},
            *self.history[-6:], {"role": "user", "content": text}]}
        if model != self.cfg.get("hermes_model", "friday"):
            payload["provider"] = provider
        t = time.monotonic()
        try:
            resp = post_json(self.cfg["hermes_url"], payload, {"Authorization": f"Bearer {self.hermes_key}"},
                             timeout=900)
            answer = resp["choices"][0]["message"]["content"].strip()
            log_event(event="hermes_done", task_id=task_id, route=route, model=model, provider=provider,
                      duration_s=round(time.monotonic() - t, 2), success=True)
            return answer
        except Exception as exc:
            log_event(event="hermes_error", task_id=task_id, error=str(exc), success=False)
            return "Der Cloud-Agent ist derzeit nicht verfuegbar. Lokale Funktionen bleiben aktiv."

    def _handle_command(self, audio: np.ndarray, wake_audio: np.ndarray | None) -> None:
        t0 = time.monotonic()
        probe = np.concatenate([wake_audio, audio]) if wake_audio is not None else audio
        combined_score = self.verifier.score(probe)
        command_score = self.verifier.score(audio) if wake_audio is not None and len(audio) >= SR else -1.0
        # A verified question is sufficient when the longer wake window contains stale/noisy audio.
        score = max(combined_score, command_score)
        probe_details = {"wake_s": round(len(wake_audio) / SR, 2) if wake_audio is not None else 0,
                         "command_s": round(len(audio) / SR, 2),
                         "command_score": round(command_score, 3) if command_score >= 0 else None}
        if score == -1.0:
            # Zu wenig Sprache fuer ein Embedding (Raeuspern, Geraeusch): ignorieren, Session nicht beenden.
            log_event(event="too_short", followup=wake_audio is None, **probe_details)
            return
        if score < self.cfg["speaker_threshold"]:
            self.status["rejected_speaker"] += 1
            self.trusted_until = 0.0  # Plan: unbekannter Sprecher schliesst die Trusted Session sofort
            log_event(event="speaker_rejected", score=round(score, 3), followup=wake_audio is None,
                      **probe_details)
            return
        self.trusted_until = time.monotonic() + self.cfg["trusted_session_s"]
        t_stt = time.monotonic()
        text = self._transcribe(audio)
        stt_ms = (time.monotonic() - t_stt) * 1000
        if not text:
            log_event(event="empty_transcript", speaker_score=round(score, 3))
            return
        print(f"> {text}", flush=True)
        studio_answer = self.content_studio_voice.handle(text)
        if studio_answer is not None:
            self.status["commands"] += 1
            log_event(event="content_studio_command", speaker_score=round(score, 3), success=True)
            self.tts.say(studio_answer)
            self.history += [{"role": "user", "content": text}, {"role": "assistant", "content": studio_answer}]
            return
        skills_answer = self.skills_onboarding_voice.handle(text)
        if skills_answer is not None:
            self.status["commands"] += 1
            log_event(event="skills_onboarding_command", speaker_score=round(score, 3), success=True)
            self.tts.say(skills_answer)
            self.history += [{"role": "user", "content": text}, {"role": "assistant", "content": skills_answer}]
            return
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
            self.background_jobs.add(task_id)
            threading.Thread(target=self._background, args=(text, decision, task_id), daemon=True).start()
            return
        if decision["route"] != "cloud_low":
            self.tts.say(self.cfg.get("ack_wait", DEFAULT_ACK_WAIT))
        answer = self._ask_hermes(text, decision, task_id)
        print(f"< {answer}", flush=True)
        self.tts.say(answer)
        self.history += [{"role": "assistant", "content": answer}]

    def _background(self, text: str, decision: dict, task_id: str) -> None:
        try:
            answer = self._ask_hermes(text, decision, task_id)
            print(f"< {answer}", flush=True)
            self.tts.say("Ergebnis zur Aufgabe: " + answer)
            self.history += [{"role": "assistant", "content": answer}]
            while self.tts.speaking.is_set():
                time.sleep(0.05)
        finally:
            self.background_jobs.discard(task_id)
            self.background_reply_ready.set()

    # ---------- Hauptschleife ----------
    def run(self) -> None:
        cfg = self.cfg
        self._start_health()
        threading.Thread(target=self._game_mode_watcher, daemon=True).start()
        with sd.InputStream(samplerate=SR, channels=1, dtype="int16", blocksize=CHUNK,
                            device=cfg["input_device"], callback=self._on_audio):
            self.status["state"] = "listening"
            print(f"{self.name} hoert zu (sag '{self.phrase}').", flush=True)
            winsound.Beep(900, 120)
            while True:
                if self._wake_detected(self._read_chunk()):
                    self._session()

    def _wake_score(self, chunk: np.ndarray) -> float:
        if self.engine == "personal":
            return self.oww.predict(chunk)
        return float(self.oww.predict(chunk).get(self.wake_name, 0.0))

    def _confirm_name(self) -> tuple[bool, int]:
        """Stufe 2 (persoenliches Wake Word): Whisper auf dem ~2-s-Fenster, unscharfer Abgleich mit der ganzen Wake Phrase
        (bzw. ihrer Kurzform). Die Phrase steht am Ende des Fensters; Rueckgabe (bestaetigt, Dauer in ms)."""
        cfg = self.cfg
        t0 = time.monotonic()
        # Stage 1 can fire before the final syllable of the wake phrase has reached the ring.
        for _ in range(cfg.get("wake_confirm_tail_chunks", 5)):
            self._read_chunk()
        audio = np.concatenate(list(self.ring)).astype(np.float32) / 32768.0
        for language in cfg.get("wake_confirm_languages", ["de", "en"]):
            segs, _ = self.whisper.transcribe(audio, language=language, beam_size=1, vad_filter=False,
                                              condition_on_previous_text=False, temperature=0.0)
            text = " ".join(seg.text.strip() for seg in segs)
            hit, _, _ = personal_wake.phrase_matches(text, self.phrase, cfg.get("wake_aliases", ()),
                                                     cfg.get("wake_reject_words", ()), cfg.get("wake_match_max_dist"))
            if hit:
                return True, round((time.monotonic() - t0) * 1000)
        return False, round((time.monotonic() - t0) * 1000)

    def _wake_detected(self, chunk: np.ndarray) -> bool:
        score = self._wake_score(chunk)
        if score < self.wake_threshold:
            return False
        now = time.monotonic()
        if now - self.last_wake < 1.5 or now < self.stage1_block_until:  # Doppelausloesung auf dasselbe Wake Word
            return False
        stage2_ms = None
        confirmation = "model"
        if self.engine == "personal" and self.cfg.get("wake_confirm", True):
            high_confidence = getattr(self, "wake_high_confidence", None)
            confirmed = high_confidence is not None and score >= high_confidence
            if not confirmed:
                confirmation = "whisper"
                confirmed, stage2_ms = self._confirm_name()
            if not confirmed:
                # Stufe 1 hat sich geirrt (aehnliches Wort, Fernseher, Geraeusch): kurz sperren, Puffer leeren.
                self.status["wake_rejected"] += 1
                self.stage1_block_until = time.monotonic() + self.cfg.get("wake_refractory_s", 1.0)
                self.oww.reset()
                self.preroll = []
                log_event(event="wake_rejected", engine=self.engine, stage=2, score=round(score, 3),
                          stage2_ms=stage2_ms)
                return False
        self.last_wake = time.monotonic()
        # Modellpuffer leeren: er enthaelt noch das erkannte Wake Word und loeste sonst sofort ein zweites
        # Mal aus - live als Barge-In 23 ms nach dem Befehl beobachtet, das schaltete die Antwort stumm.
        self.oww.reset()
        self.status["wake_count"] += 1
        self.status["last_event"] = datetime.datetime.now().isoformat(timespec="seconds")
        barge_in = self.tts.speaking.is_set()
        if barge_in:
            self.tts.interrupt()
        log_event(event="wake", score=round(score, 3), barge_in=barge_in, engine=self.engine,
                  confirmation=confirmation, stage2_ms=stage2_ms)
        return True

    def _acknowledge_wake(self) -> np.ndarray:
        wake_audio = np.concatenate(list(self.ring)).astype(np.float32) / 32768.0
        # Stufe 2 dauert (Whisper): wer das Wake Word und den Befehl in einem Atemzug spricht, hat den Befehlsanfang
        # schon im Eingabepuffer. Diesen Rueckstand VOR dem Piepton sichern und der Befehlsaufnahme voranstellen.
        backlog = []
        if self.engine == "personal":
            while not self.audio_q.empty():
                backlog.append(self.audio_q.get_nowait())
            # A quick phrase check leaves only the tail of the wake word here. Feeding that
            # tail to VAD starts a false command and closes it before the user asks a question.
            if len(backlog) * CHUNK < SR // 2:
                backlog.clear()
            else:
                backlog = backlog[min(len(backlog), 4):]
        winsound.Beep(1200, 80)
        # Waehrend des Pieptons aufgenommene Bloecke verwerfen: sonst startet der Piepton selbst die
        # Befehlsaufnahme und endet nach 0,7 s "Stille" mit leerem Transkript (live beobachtet).
        while not self.audio_q.empty():
            self.audio_q.get_nowait()
        self.preroll = backlog
        return wake_audio

    def _session(self) -> None:
        """Ein Wake-Ereignis: Befehl, danach Folgefragen ohne Wake Word, solange die Trusted Session laeuft.
        Waehrend der Assistent spricht, laeuft die Wake-Word-Erkennung weiter (Barge-In)."""
        cfg = self.cfg
        wake_audio = self._acknowledge_wake()
        self.status["state"] = "command"
        audio = self._record_command(cfg["command_start_timeout_s"])
        if audio is None:
            log_event(event="no_speech_after_wake")
        else:
            self._handle_command(audio, wake_audio)
        while (self.tts.speaking.is_set() or time.monotonic() < self.trusted_until or
               self.background_jobs or self.background_reply_ready.is_set()):
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
            # Berechnung und TTS duerfen die Folgefragezeit nicht aufbrauchen.
            self.trusted_until = time.monotonic() + cfg["followup_window_s"]
            self.status["state"] = "followup"
            audio = self._record_command(cfg["followup_window_s"])
            if audio is None:
                if self.background_jobs or self.tts.speaking.is_set() or self.background_reply_ready.is_set():
                    self.background_reply_ready.clear()
                    continue
                break
            self._handle_command(audio, None)
        self._drain()
        self.status["state"] = "listening"

    def _game_mode_watcher(self) -> None:
        """Gaming-Modus: laeuft ein Spiel aus cfg["game_processes"], wird der GPU-TTS-Server (~3,5 GB VRAM)
        gestoppt und der Assistent spricht mit Piper (CPU). Nach Spielende wird Stimme 3 wieder hochgefahren."""
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
                # input_level/output_level: additiv, nur Pegelzahlen 0..1 (kein Audio, nichts gespeichert)
                body = json.dumps({**service.status, "speaking": service.tts.speaking.is_set(),
                                   "trusted": time.monotonic() < service.trusted_until,
                                   "input_level": service.input_level.value(),
                                   "output_level": service.tts.level.value()}).encode()
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
    ap.add_argument("--config", default=os.path.join(INSTALL_ROOT, "config", "voice.json"))
    ap.add_argument("--test-wake-model", help="Ersatzmodell zum Testen der Kette (z. B. hey_jarvis), ohne Verifier; "
                    "erzwingt die Engine openwakeword")
    args = ap.parse_args()
    cfg = json.load(open(args.config, encoding="utf-8-sig"))  # BOM-tolerant (Windows-Editoren)
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    VoiceService(cfg, args.test_wake_model).run()


if __name__ == "__main__":
    main()
