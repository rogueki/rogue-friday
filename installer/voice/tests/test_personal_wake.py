"""Tests fuer Assistentenname, frei waehlbare Wake Phrase, Phrasenabgleich (Stufe 2), Fenstermodell/Kalibrierung (Stufe 1) und die Wake-Logik des
Dienstes (mit Stubs fuer winsound/sounddevice/torch).

Ausfuehren (Linux/Windows, nur numpy noetig; Modelltraining zusaetzlich scikit-learn):
  python3 -m pytest installer/voice/tests          oder          python3 installer/voice/tests/test_personal_wake.py
"""
import collections
import base64
import importlib.util
import json
import os
import queue
import socket
import sys
import tempfile
import threading
import time
import types
import urllib.error
import urllib.request

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.dirname(HERE)
COMMON = os.path.join(os.path.dirname(VOICE), "common")
for path in (VOICE, COMMON):
    if path not in sys.path:
        sys.path.insert(0, path)

import persona  # noqa: E402
import personal_wake as pw  # noqa: E402

HAVE_SKLEARN = importlib.util.find_spec("sklearn") is not None


# ------------------------------------------------------------------------------------------------ Name & Slug

def test_slug_and_validation_match_persona():
    samples = ["Friday", "jarvis", "Jörg", "Zoë", "Ärger", "Weiß", "ÄÖÜ", "Éloïse", "A", "Anna Maria", "Bob2",
               "Maximiliane-Anna", "x" * 21]
    for name in samples:
        assert pw.slugify(name) == persona.slugify(name)
        assert pw.valid_name(name) == persona.valid_name(name)
        assert pw.wake_phrase(name) == persona.wake_phrase(name)
    assert pw.slugify("Jörg") == "joerg" and pw.slugify("Friday") == "friday"
    assert [pw.valid_name(n) for n in ("Friday", "Jo", "J", "Anna Maria", "Bob2", "x" * 20, "x" * 21)] == \
        [True, True, False, False, False, True, False]


def test_engine_selection():
    # Vortrainiert nur, wenn die Phrase exakt "Hey Jarvis" ist (Gross-/Kleinschreibung und Leerraum egal) - nicht der Name.
    for phrase in ("Hey Jarvis", "hey jarvis", "  HEY   Jarvis ", "Hey-Jarvis"):
        assert persona.wake_engine(phrase) == "openwakeword" == pw.wake_engine(phrase), phrase
        assert pw.is_pretrained_phrase(phrase)
    for phrase in ("Jarvis", "Hallo Jarvis", "Hey Jarvis Bitte", "Hey Friday", "Hey James", "Computer"):
        assert persona.wake_engine(phrase) == "personal" == pw.wake_engine(phrase), phrase
        assert not pw.is_pretrained_phrase(phrase)


def test_persona_default_and_jarvis(tmp_path):
    f = tmp_path / "persona.json"
    f.write_text(json.dumps({"owner_name": "Erik"}), encoding="utf-8")
    d = persona.voice_settings(persona.load(str(f)))
    assert d["assistant_name"] == "Friday" and d["wake_phrase"] == "Hey Friday" and d["wake_engine"] == "personal"
    assert "J.A.R.V.I.S." in d["persona"] and "Nachfolger" in d["persona"]
    f.write_text(json.dumps({"owner_name": "Erik", "assistant_name": "jarvis"}), encoding="utf-8")
    d = persona.voice_settings(persona.load(str(f)))
    assert d["assistant_name"] == "Jarvis" and d["wake_engine"] == "openwakeword"
    assert d["persona"].startswith("Du bist Jarvis, der persoenliche KI-Assistent von Erik")
    f.write_text(json.dumps({"owner_name": "Erik", "assistant_name": "x1"}), encoding="utf-8")
    assert persona.load(str(f))["assistant_name"] == "Friday"   # ungueltig -> Standard
    assert "Your name is Friday" in persona.soul_md(persona.load(str(f)))


# ------------------------------------------------------------------------------------------------ Stufe 2

def test_name_matches_friday():
    cfg = dict(aliases=pw.default_aliases("Friday"), reject=pw.default_reject_words("Friday"))
    for text in ["Hey Friday", "hey friday!", "Friday, wie spät ist es", "Hey Fraidei", "Fraidäi", "hey fri day",
                 "Hey Fraiday", "Fridai", "Hey Friday Wetter"]:
        assert pw.name_matches(text, "Friday", **cfg)[0], text
    for text in ["", "Hey du", "Freitag", "Heute ist Freitag", "Hey Frieda", "Feierabend", "Fridolin", "Hey Friedrich",
                 "Sonntag", "Hey Frank", "Das Wetter ist schön", "Untertitel der Amara.org-Community"]:
        assert not pw.name_matches(text, "Friday", **cfg)[0], text


def test_name_matches_other_names_and_umlauts():
    assert pw.name_matches("Hey Jörg", "Jörg")[0] and pw.name_matches("hey joerg", "Jörg")[0] \
        and pw.name_matches("Hey Jorg", "Jörg")[0]
    assert pw.name_matches("Hey James", "James")[0] and pw.name_matches("Hey Jämes", "James")[0]
    assert not pw.name_matches("Hey Jens", "James")[0] and not pw.name_matches("Hey Jonas", "James")[0]
    assert pw.name_matches("Hey Jarvis", "Jarvis")[0] and pw.name_matches("hey charvis", "Jarvis")[0]
    assert not pw.name_matches("Hey Marvin", "Jarvis")[0]
    assert pw.name_matches("Bob", "Bob")[0] and not pw.name_matches("Bub", "Bob")[0]   # kurze Namen exakt
    assert pw.name_matches("Hey Anna", "Anna", max_dist=0)[0] and not pw.name_matches("Hey Anne", "Anna", max_dist=0)[0]


def test_hard_negatives():
    fr = pw.hard_negatives("Friday")
    assert len(fr) == 15 and "Freitag" in fr and "Frieda" in fr and "Feierabend" in fr
    jv = pw.hard_negatives("Jarvis")
    assert jv[:3] == ["Hey Charles", "Harvest", "Hey Davis"]          # Jarvis-Weg: identische Liste wie bisher
    other = pw.hard_negatives("Mona")
    assert len(other) == 15 and not any(pw.fold(w) == "mona" or pw.fold(w) == "heymona" for w in other)
    assert any(n in " ".join(other) for n in ("Nora", "Nina", "Lena", "Mia"))   # klangnahe Vornamen


# ------------------------------------------------------------------------------------------------ Wake Phrase

def test_phrase_validation_matches_persona():
    ok = ["Hey Friday", "Friday", "hey friday", "Computer", "Guten Morgen Friday", "Ok Anna-Lena", "Hallo Jörg", "Äöü",
          "Hey Welt wach auf", "a" * 30, "abc"]
    bad = ["", "  ", "ab", "Hi", "a" * 31, "Hey Friday 2", "Hey, Friday", "Hey Friday!", "eins zwei drei vier fünf",
           "Hey - Friday", "-Friday", "Friday-", "Hey_Friday", "Hey Fr1day", "Hey Friday\n"[:-1] + "?"]
    for phrase in ok:
        assert pw.valid_phrase(phrase) and persona.valid_phrase(phrase), phrase
    for phrase in bad:
        assert not pw.valid_phrase(phrase) and not persona.valid_phrase(phrase), phrase
    assert pw.valid_phrase("  Hey    Friday  ") and pw.normalize_phrase("  Hey    Friday  ") == "Hey Friday"
    for phrase in ok + ["hey   friday"]:
        assert pw.display_phrase(phrase) == persona.display_phrase(phrase)
    assert pw.display_phrase("hey friday") == "Hey Friday" and pw.display_phrase("ok anna-lena") == "Ok Anna-lena"


def test_phrase_slug_short_form_and_blocks():
    assert pw.phrase_slug("Hey Friday") == "hey_friday" and pw.phrase_slug("Hallo Jörg") == "hallo_joerg"
    assert pw.phrase_slug("Guten Morgen Friday") == "guten_morgen_friday"
    assert pw.short_form("Hey Friday") == "Friday" and pw.short_form("hallo jörg") == "Jörg"
    assert pw.short_form("Friday") is None and pw.short_form("Guten Morgen Friday") is None and pw.short_form("Hey") is None
    # Bestehende Installationen: gleiche Ordnernamen wie vor der freien Wake Phrase
    blocks = pw.enrollment_blocks("Hey Friday")
    assert [(b, t) for b, t, _ in blocks] == [("wake_hey_friday", "Hey Friday"), ("wake_friday", "Friday")]
    assert [sum(n for _, n in ph) for _, _, ph in blocks] == [26, 18]
    assert [b for b, _, _ in pw.enrollment_blocks("Hey Jarvis")] == ["wake_hey_jarvis", "wake_jarvis"]
    # Ohne Grusswort bekommt die Phrase alle Aufnahmen (26 + 18)
    single = pw.enrollment_blocks("Computer")
    assert [(b, t) for b, t, _ in single] == [("wake_computer", "Computer")] and sum(n for _, n in single[0][2]) == 44
    assert [b for b, _, _ in pw.enrollment_blocks("guten  morgen friday")] == ["wake_guten_morgen_friday"]


def test_resolve_wake_phrase(tmp_path):
    cfg = str(tmp_path)
    assert pw.resolve_wake_phrase(cfg) == "Hey Friday"                          # nichts konfiguriert
    (tmp_path / "persona.json").write_text(json.dumps({"assistant_name": "James"}), encoding="utf-8")
    assert pw.resolve_wake_phrase(cfg) == "Hey James"                           # alte Installation ohne wake_phrase
    (tmp_path / "persona.json").write_text(json.dumps({"assistant_name": "James", "wake_phrase": "ok computer"}),
                                           encoding="utf-8")
    assert pw.resolve_wake_phrase(cfg) == "Ok Computer" and pw.resolve_assistant_name(cfg) == "James"
    (tmp_path / "voice.json").write_text(json.dumps({"assistant_name": "James", "wake_phrase": "Hey James"}),
                                         encoding="utf-8-sig")
    assert pw.resolve_wake_phrase(cfg) == "Hey James"                           # voice.json hat Vorrang
    (tmp_path / "voice.json").write_text(json.dumps({"wake_phrase": "x1"}), encoding="utf-8")
    assert pw.resolve_wake_phrase(cfg) == "Ok Computer"                         # ungueltig -> naechste Quelle


def test_persona_wake_phrase_free(tmp_path):
    f = tmp_path / "persona.json"
    f.write_text(json.dumps({"owner_name": "Erik", "assistant_name": "Friday", "wake_phrase": "guten morgen friday"}),
                 encoding="utf-8")
    d = persona.voice_settings(persona.load(str(f)))
    assert d["wake_phrase"] == "Guten Morgen Friday" and d["wake_engine"] == "personal" and d["assistant_name"] == "Friday"
    f.write_text(json.dumps({"owner_name": "Erik", "assistant_name": "Friday", "wake_phrase": "hey jarvis"}), encoding="utf-8")
    d = persona.voice_settings(persona.load(str(f)))
    assert d["wake_phrase"] == "Hey Jarvis" and d["wake_engine"] == "openwakeword" and d["assistant_name"] == "Friday"
    f.write_text(json.dumps({"owner_name": "Erik", "assistant_name": "Friday", "wake_phrase": "Hey 5!"}), encoding="utf-8")
    assert persona.voice_settings(persona.load(str(f)))["wake_phrase"] == "Hey Friday"      # ungueltig -> Standard
    assert "/mnt/c/Friday" in persona.soul_md(persona.load(str(f))) and "Jarvis" not in persona.soul_md(persona.load(str(f)))


def test_hard_negatives_from_phrase_words():
    assert pw.hard_negatives("Hey Friday") == pw.hard_negatives("Friday") == pw.HARD_NEGATIVES["friday"]   # Bestand
    assert pw.hard_negatives("Hey Jarvis")[:3] == ["Hey Charles", "Harvest", "Hey Davis"]
    one = pw.hard_negatives("Computer")
    assert len(one) == 15 and not any(pw.fold(w) in ("computer", "heycomputer") for w in one)
    multi = pw.hard_negatives("Guten Morgen Friday")
    assert len(multi) == 15 and len(set(map(pw.fold, multi))) == 15
    assert "Guten" in multi and "Morgen" in multi and "Guten Morgen" in multi and "Morgen Friday" in multi
    assert "Guten Morgen Friday" not in multi
    assert any(m.startswith("Guten Morgen ") and not m.endswith("Friday") for m in multi)   # ein Wort ersetzt
    greeted = pw.hard_negatives("Hallo Mona")                                              # eigenes Grusswort bleibt
    assert any(g.startswith("Hallo ") for g in greeted) and not any(g.startswith("Hey ") for g in greeted[:5])
    assert pw.hard_negatives("Guten Morgen Friday") == multi                              # deterministisch
    for phrase in ("Hey Mona", "Computer", "Hallo Welt", "Guten Morgen Friday", "Ok Anna-Lena"):
        negatives = pw.hard_negatives(phrase)
        assert len(negatives) == 15
        assert pw.fold(phrase) not in map(pw.fold, negatives), phrase


def test_negative_texts_exclude_phrase_words():
    import negative_texts as nt
    assert nt.phrase_words("Hey Friday") == {"friday"} and nt.phrase_words("Guten Morgen") == {"guten", "morgen"}
    plain = nt.sentences_for("Hey Friday")
    assert len(plain) == len(nt.SENTENCES_DE)                                    # kein Satz nennt "Friday"
    short = nt.sentences_for("Hey Morgen")
    assert 0 < len(short) < len(nt.SENTENCES_DE)
    assert not any("morgen" in nt.phrase_words(x) or "morgen" in {nt._fold(w) for w in x.split()} for x in short)
    texts = ["Erst ein Satz. Dann Stopp. Zum Schluss noch einer.", "Stopp."]
    cleaned = nt.without_phrase_words(texts, "Hey Stopp")
    assert cleaned[0] == "Erst ein Satz. Zum Schluss noch einer." and len(cleaned) == 2
    assert "stopp" not in cleaned[1].lower() and cleaned[1]                        # ersetzt durch neutralen Satz
    assert nt.without_phrase_words(texts, "Hey") == texts


def test_phrase_matches_default_phrase():
    cfg = dict(aliases=pw.default_aliases("Hey Friday"), reject=pw.default_reject_words("Hey Friday"))
    assert cfg["aliases"] == pw.default_aliases("Friday") and cfg["reject"] == pw.default_reject_words("Friday")
    for text in ["Hey Friday", "hey friday!", "Hay Friday", "Hey Fraidei", "hey fri day", "Hi Friday", "Friday, wie spät ist es",
                 "Ok Friday wie viel Uhr", "Fraidäi", "Hey Fraiday"]:
        assert pw.phrase_matches(text, "Hey Friday", **cfg)[0], text
    for text in ["", "Hey du", "Hey Freitag", "Heute ist Freitag", "Hey Frieda", "Hey Frida", "Feierabend", "Hey Friedrich",
                 "Hey Frank", "Das Wetter ist schön", "Hey", "Untertitel der Amara.org-Community"]:
        assert not pw.phrase_matches(text, "Hey Friday", **cfg)[0], text


def test_phrase_matches_multi_word_phrases():
    phrase = "Guten Morgen Friday"
    cfg = dict(aliases=pw.default_aliases(phrase), reject=pw.default_reject_words(phrase))
    for text in ["Guten Morgen Friday", "guten morgen, friday!", "Gute Morgen Friday", "Guten Morgen Fraidei",
                 "Morgen Friday", "Guten morgen fri day", "ja guten morgen friday wie geht es"]:
        assert pw.phrase_matches(text, phrase, **cfg)[0], text            # kleine Abweichungen, erstes Wort darf fehlen
    for text in ["Guten Morgen", "Friday", "Guten Abend Friday", "Guten Morgen Freitag", "Morgen", "Hey Friday",
                 "Guten Friday Morgen", "Guten Tag zusammen"]:
        assert not pw.phrase_matches(text, phrase, **cfg)[0], text
    hit, matched, dist = pw.phrase_matches("na dann guten morgen friday", phrase)
    assert hit and matched == "guten morgen friday" and dist == 0


def test_phrase_matches_other_phrases_and_umlauts():
    assert pw.phrase_matches("Computer", "Computer")[0] and pw.phrase_matches("Komputer", "Computer")[0]
    assert pw.phrase_matches("hey computer start", "Computer")[0]
    assert not pw.phrase_matches("Kompost", "Computer")[0] and not pw.phrase_matches("Hey Kompass", "Computer")[0]
    assert pw.phrase_matches("Hallo Jörg", "Hallo Jörg")[0] and pw.phrase_matches("hallo joerg", "Hallo Jörg")[0]
    assert pw.phrase_matches("Jörg", "Hallo Jörg")[0]                          # Kurzform
    assert not pw.phrase_matches("Hallo Jens", "Hallo Jörg")[0]
    assert pw.phrase_matches("hey anna lena", "Hey Anna-Lena")[0] and pw.phrase_matches("Anna-Lena", "Hey Anna-Lena")[0]
    assert not pw.phrase_matches("Hey Anna", "Hey Anna-Lena")[0]
    assert pw.phrase_matches("Hey Jarvis", "Hey Jarvis")[0] and pw.phrase_matches("hey charvis", "Hey Jarvis")[0]
    assert not pw.phrase_matches("Hey Marvin", "Hey Jarvis", reject=pw.default_reject_words("Hey Jarvis"))[0]
    assert pw.phrase_matches("Bob", "Bob")[0] and not pw.phrase_matches("Bub", "Bob")[0]
    assert not pw.phrase_matches("Hey Anne", "Hey Anna", max_dist=0)[0] and pw.phrase_matches("Hey Anna", "Hey Anna", max_dist=0)[0]


def test_default_reject_words_derived_from_phrase():
    assert pw.default_reject_words("Hey Friday") == pw.REJECT_WORDS["friday"]
    derived = pw.default_reject_words("Hey Hanna")                    # "Anna" liegt 1 Edit entfernt und wuerde sonst passen
    assert "Anna" in derived and "Hanna" not in derived
    assert pw.phrase_matches("Hey Anna", "Hey Hanna")[0]
    assert not pw.phrase_matches("Hey Anna", "Hey Hanna", reject=derived)[0]
    assert pw.phrase_matches("Hey Hanna", "Hey Hanna", reject=derived)[0]
    assert pw.default_reject_words("Hey Mona") == []                  # kein bekannter Vorname liegt nah genug
    assert pw.default_aliases("Guten Morgen Friday") == [] and pw.default_aliases("Hey Friday") == pw.DEFAULT_ALIASES["friday"]


def test_window_model_without_short_form(tmp_path):
    if not HAVE_SKLEARN:
        print("skip: scikit-learn fehlt")
        return
    rng = np.random.default_rng(3)
    hey = [make_clip(rng, 0, int(rng.integers(8, 13))) for _ in range(20)]
    words = [make_clip(rng, 1, int(rng.integers(8, 13))) for _ in range(10)]
    speech = [make_clip(rng, None) for _ in range(10)]
    cal = pw.cross_validate(hey, [], words, speech)                       # Phrase ohne Kurzform: keine "bare"-Gruppe
    model = pw.train_window_model(hey, [], words + speech)
    assert list(model.groups) == ["hey"] and cal["quality"] in ("gut", "mittel"), cal
    path = str(tmp_path / "m.npz")
    model.save(path)
    assert list(pw.WindowModel.load(path).groups) == ["hey"]


# ------------------------------------------------------------------------------------------------ Stufe 1

def synthetic_word(rng, kind: int, length: int) -> np.ndarray:
    """Zeitliches Muster im 96-dim Featureraum (kind = Wort), Laenge variabel -> (length, 96)."""
    basis = np.random.default_rng(100 + kind).standard_normal((6, pw.DIM)) * 2.0
    pos = np.linspace(0, 5, length)
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, 5)
    w = (pos - lo)[:, None]
    return basis[lo] * (1 - w) + basis[hi] * w + rng.standard_normal((length, pw.DIM)) * 0.6


def make_clip(rng, kind: int | None, length: int = 10) -> pw.Clip:
    """25 Frames Hintergrund; bei kind != None liegt das Wort bei Frame 10..10+length."""
    rows = rng.standard_normal((25 + pw.PREROLL_CHUNKS, pw.DIM)) * 0.6
    if kind is None:
        return pw.Clip(rows, pw.PREROLL_CHUNKS)
    ks = pw.PREROLL_CHUNKS + 8
    rows[ks:ks + length] = synthetic_word(rng, kind, length)
    # voiced_bounds-aequivalent: Wort beginnt bei (ks - Pre - lead) ... Ende bei ke
    t0 = ((ks - pw.PREROLL_CHUNKS) * pw.FRAME_S) - 0.2 + 0.0
    t1 = (ks - pw.PREROLL_CHUNKS + length) * pw.FRAME_S - 0.1
    return pw.Clip(rows, pw.PREROLL_CHUNKS, (t0, t1))


def test_window_model_separates_synthetic_word(tmp_path):
    if not HAVE_SKLEARN:
        print("skip: scikit-learn fehlt")
        return
    rng = np.random.default_rng(1)
    hey = [make_clip(rng, 0, int(rng.integers(8, 13))) for _ in range(20)]
    bare = [make_clip(rng, 0, int(rng.integers(5, 8))) for _ in range(12)]
    words = [make_clip(rng, 1, int(rng.integers(8, 13))) for _ in range(10)]       # anderes "Wort"
    speech = [make_clip(rng, None) for _ in range(10)]
    model = pw.train_window_model(hey, bare, words + speech)
    pos = [model.peak(make_clip(rng, 0, int(rng.integers(8, 13))).rows, 18) for _ in range(30)]
    neg = [model.peak(make_clip(rng, 1, int(rng.integers(8, 13))).rows, 18) for _ in range(30)]
    neg += [model.peak(make_clip(rng, None).rows, 18) for _ in range(30)]
    assert np.percentile(pos, 10) > max(neg), (np.percentile(pos, 10), max(neg))
    # Speichern/Laden: gleiche Scores
    path = str(tmp_path / "m.npz")
    model.save(path)
    again = pw.WindowModel.load(path)
    rows = make_clip(rng, 0, 10).rows
    assert abs(model.peak(rows, 18) - again.peak(rows, 18)) < 1e-4
    # Kreuzvalidierung liefert eine brauchbare Schwelle
    cal = pw.cross_validate(hey, bare, words, speech)
    assert cal["quality"] in ("gut", "mittel") and cal["frr_cv"] <= 0.2, cal
    thr = cal["threshold"]
    assert np.mean(np.array(pos) >= thr) >= 0.8 and np.mean(np.array(neg) >= thr) <= 0.1


def test_calibration_rules():
    good = pw.calibrate_threshold([5, 6, 7, 8, 9, 10, 6, 7, 8, 9], [-1, 0, 1], [-2, -1, 0, 1, 2])
    assert good["quality"] == "gut" and 2 < good["threshold"] < 5 and good["frr_cv"] == 0
    mid = pw.calibrate_threshold([1, 3, 4, 5, 6, 7, 8, 9, 10, 11], [6, 7], [-1, 0, 0.5, 1, 1.5, 2])
    assert mid["quality"] == "mittel" and mid["far_words_cv"] > 0
    bad = pw.calibrate_threshold([0.1, 0.2, 3, 4], [5, 6], [1, 2, 3, 4, 5])
    assert bad["quality"] == "schwach" and bad["threshold"] >= 0


def test_window_matrix_and_segments():
    rows = np.arange(20, dtype=np.float32)[:, None] * np.ones((1, 3), dtype=np.float32)
    w = pw.window_matrix(rows, 5, 5, np.array([9]))             # n == length -> Identitaet
    assert np.allclose(w[0, :, 0], [5, 6, 7, 8, 9])
    w = pw.window_matrix(rows, 5, 9, np.array([12]))            # gestaucht: 4..12 auf 5 Punkte
    assert np.allclose(w[0, :, 0], [4, 6, 8, 10, 12])
    audio = np.zeros(32000, dtype=np.float32)
    audio[8000:16000] = 0.3 * np.sin(np.arange(8000) * 0.2)
    t0, t1 = pw.voiced_bounds(audio)
    assert 0.45 < t0 < 0.55 and 0.95 < t1 < 1.05
    ks, ke = pw.segment_for_word(25, (t0, t1))
    assert 0 <= ks < ke <= 24 and ke - ks + 1 >= 4
    assert pw.voiced_bounds(np.zeros(16000, dtype=np.float32)) is None


# ------------------------------------------------------------------------------------------------ Dienst-Logik

def load_voice_module():
    """friday_voice.py mit Stubs fuer die Windows-/GPU-Abhaengigkeiten importieren."""
    stubs = {"winsound": types.SimpleNamespace(Beep=lambda *a: None),
             "sounddevice": types.ModuleType("sounddevice")}
    # find_spec raises ValueError for a stub already registered without __spec__ (second call in one process).
    torch_stubbed = "torch" not in sys.modules and importlib.util.find_spec("torch") is None
    if torch_stubbed:
        stubs["torch"] = types.ModuleType("torch")
    for name, module in stubs.items():
        sys.modules.setdefault(name, module)
    sys.modules.pop("friday_voice", None)
    try:
        return importlib.import_module("friday_voice")
    finally:
        if torch_stubbed:
            sys.modules.pop("torch", None)


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeWhisper:
    def __init__(self, texts):
        self.texts, self.calls = texts, []

    def transcribe(self, audio, language=None, **kwargs):
        self.calls.append(language)
        return [FakeSegment(self.texts.get(language, ""))], None


class FakeDetector:
    def __init__(self):
        self.score, self.resets = 0.0, 0

    def predict(self, chunk):
        return self.score

    def reset(self):
        self.resets += 1


def make_service(jv, texts, engine="personal", phrase="Hey Friday"):
    svc = jv.VoiceService.__new__(jv.VoiceService)
    svc.cfg = {"wake_confirm": True, "wake_confirm_languages": ["de", "en"], "wake_aliases": pw.default_aliases(phrase),
               "wake_reject_words": pw.default_reject_words(phrase), "wake_match_max_dist": None,
               "wake_refractory_s": 1.0, "wake_confirm_tail_chunks": 0}
    svc.name, svc.engine, svc.phrase = "Friday", engine, phrase
    svc.status = {"state": "listening", "last_event": None, "wake_count": 0, "rejected_speaker": 0, "commands": 0,
                  "assistant_name": "Friday", "wake_phrase": phrase, "wake_engine": engine, "wake_rejected": 0}
    svc.audio_q, svc.preroll = queue.Queue(), []
    svc.ring = collections.deque([np.full(pw.CHUNK, 100, dtype=np.int16)] * 25, maxlen=25)
    svc.last_wake, svc.stage1_block_until, svc.trusted_until = 0.0, 0.0, 0.0
    svc.background_jobs, svc.background_reply_ready = set(), threading.Event()
    svc.manual_start, svc.manual_start_lock = threading.Event(), threading.Lock()
    svc.wake_model_lock = threading.Lock()
    svc.manual_release = threading.Event()
    svc.user_speaking = threading.Event()
    svc.ptt_active = False
    svc.control_cancel, svc.control_paused, svc.control_generation = threading.Event(), False, 0
    svc.whisper, svc.oww, svc.wake_name, svc.wake_threshold = FakeWhisper(texts), FakeDetector(), "personal", 2.0
    svc.tts = types.SimpleNamespace(speaking=threading.Event(), interrupted=0)
    svc.tts.interrupt = lambda: setattr(svc.tts, "interrupted", svc.tts.interrupted + 1)
    svc.calendar_voice = types.SimpleNamespace(pending=None, arm_confirmation=lambda: None)
    svc.coding_voice = types.SimpleNamespace(pending=None, arm_confirmation=lambda: None)
    return svc


def test_manual_start_uses_command_handler_without_wake_audio(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg["command_start_timeout_s"] = 2
    recorded = []
    svc._record_command = lambda timeout: np.ones(jv.SR, dtype=np.float32)
    svc._handle_command = lambda audio, wake_audio: recorded.append((len(audio), wake_audio))
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)

    svc._session(manual=True)

    assert recorded == [(jv.SR, None)]
    assert svc.status["state"] == "wake_only"


def test_unverified_speaker_has_only_public_local_voice_answers(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg["speaker_verification_required"] = False
    svc.cfg["qwen_url"] = "http://127.0.0.1:9000/v1/chat/completions"
    svc.verifier = types.SimpleNamespace(score=lambda audio: (_ for _ in ()).throw(AssertionError("owner verifier called")))
    answers = []
    requests = []
    svc._say_if_current = lambda answer, generation: answers.append(answer)
    svc._transcribe = lambda audio: "Lies meine E-Mails vor"
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)
    monkeypatch.setattr(jv, "post_json", lambda url, payload, **kwargs: (requests.append(payload) or
                        {"choices": [{"message": {"content": "Allgemeine Antwort"}}]}))
    svc._handle_command(np.ones(jv.SR, dtype=np.float32), None)
    assert answers == ["Allgemeine Antwort"]
    assert len(requests) == 1 and len(requests[0]["messages"]) == 2
    assert requests[0]["messages"][1]["content"] == "Lies meine E-Mails vor"
    assert "tools" not in requests[0] and "history" not in requests[0]
    assert svc.status["commands"] == 1 and svc.trusted_until == 0


def test_unverified_session_never_arms_owner_followup(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg.update(speaker_verification_required=False, command_start_timeout_s=2)
    armed = []
    svc.calendar_voice.arm_confirmation = lambda: armed.append("calendar")
    svc.coding_voice.arm_confirmation = lambda: armed.append("coding")
    svc._record_command = lambda timeout: np.ones(jv.SR, dtype=np.float32)
    svc._handle_command = lambda audio, wake_audio: svc.tts.speaking.set()
    svc._read_chunk = lambda: (svc.tts.speaking.clear() or np.zeros(jv.CHUNK, dtype=np.int16))
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)
    svc._session(manual=True)
    assert armed == [] and svc.trusted_until == 0
    assert svc.status["state"] == "wake_only"


def test_manual_start_endpoint_requires_key_and_rejects_duplicate():
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.manual_start = threading.Event()
    svc.manual_start_lock = threading.Lock()
    svc.input_level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.level = types.SimpleNamespace(value=lambda: 0)
    with tempfile.TemporaryDirectory() as root:
        key_dir = os.path.join(root, "dashboard", "data", "voice-bridge")
        os.makedirs(key_dir)
        with open(os.path.join(key_dir, "auth.key"), "w", encoding="ascii") as key_file:
            key_file.write("a" * 44)
        jv.INSTALL_ROOT = root
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        svc.cfg["health_port"] = port
        svc._start_health()
        url = f"http://127.0.0.1:{port}/control/start"

        def post(auth=None):
            headers = {"Authorization": auth} if auth else {}
            request = urllib.request.Request(url, data=b"", headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=2) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code

        assert post() == 401
        assert not svc.manual_start.is_set()
        assert post("Bearer wrong") == 401
        assert post("Bearer " + "a" * 44) == 202
        assert svc.manual_start.is_set()
        assert post("Bearer " + "a" * 44) == 409


def test_voice_control_stop_pause_resume_are_authenticated_and_change_state():
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.level = types.SimpleNamespace(value=lambda: 0)
    with tempfile.TemporaryDirectory() as root:
        key_dir = os.path.join(root, "dashboard", "data", "voice-bridge")
        os.makedirs(key_dir)
        with open(os.path.join(key_dir, "auth.key"), "w", encoding="ascii") as key_file:
            key_file.write("a" * 44)
        jv.INSTALL_ROOT = root
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            svc.cfg["health_port"] = sock.getsockname()[1]
        svc._start_health()
        base = f"http://127.0.0.1:{svc.cfg['health_port']}/control/"

        def post(action, key=None):
            request = urllib.request.Request(base + action, data=b"", method="POST",
                                             headers={"Authorization": "Bearer " + key} if key else {})
            try:
                with urllib.request.urlopen(request, timeout=2) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code

        assert post("pause") == 401
        assert post("pause", "a" * 44) == 202
        assert svc.control_paused and svc.control_cancel.is_set()
        assert svc.status["state"] == "paused"
        assert post("start", "a" * 44) == 409
        assert post("resume", "a" * 44) == 202
        assert not svc.control_paused and not svc.control_cancel.is_set()
        assert post("start", "a" * 44) == 202
        assert post("stop", "a" * 44) == 202
        assert not svc.manual_start.is_set()
        assert svc.control_cancel.is_set() and svc.status["state"] == "wake_only"
        assert svc.tts.interrupted == 2

        # Stopping while paused must leave the service ready for a fresh manual session.
        assert post("pause", "a" * 44) == 202
        paused_generation = svc.control_generation
        assert post("stop", "a" * 44) == 202
        assert not svc.control_paused and svc.status["state"] == "wake_only"
        assert svc.control_cancel.is_set() and svc.control_generation == paused_generation + 1
        assert post("start", "a" * 44) == 202
        assert svc.manual_start.is_set()
        assert not svc._say_if_current("stale response", paused_generation)


def test_voice_settings_http_applies_only_confirmed_private_configuration():
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.level = types.SimpleNamespace(value=lambda: 0)
    svc.cfg["wake_phrase"] = svc.phrase
    svc.processing = None
    svc.audio_transport = "browser"
    svc.service_started_at = "fixture-process"
    purges = []
    svc.memory_outbox = types.SimpleNamespace(purge=lambda: purges.append(True))
    svc.history = jv.runtime_settings.PrivacyHistory(lambda: svc.cfg.get("voice_history_enabled", True))
    svc.tts.tts_config = svc.cfg
    with tempfile.TemporaryDirectory() as root:
        key_dir = os.path.join(root, "dashboard", "data", "voice-bridge")
        os.makedirs(key_dir)
        with open(os.path.join(key_dir, "auth.key"), "w", encoding="ascii") as key_file:
            key_file.write("a" * 44)
        jv.INSTALL_ROOT = root
        svc.config_path = os.path.join(root, "config", "voice.json")
        os.makedirs(os.path.dirname(svc.config_path))
        with open(svc.config_path, "w", encoding="utf-8") as config_file:
            json.dump(svc.cfg, config_file)
        svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            svc.cfg["health_port"] = sock.getsockname()[1]
        svc._start_health()
        url = f"http://127.0.0.1:{svc.cfg['health_port']}/control/settings"
        current = jv.runtime_settings.effective(svc.cfg)

        def post(payload, authenticated=True):
            envelope = {"settings": payload, "expectedConfigRevision": svc.config_disk_hash,
                        "expectedServiceStartedAt": svc.service_started_at}
            request = urllib.request.Request(url, data=json.dumps(envelope).encode(), method="POST",
                                             headers={"Authorization": "Bearer " + "a" * 44} if authenticated else {})
            try:
                with urllib.request.urlopen(request, timeout=2) as response:
                    return response.status, json.load(response)
            except urllib.error.HTTPError as error:
                return error.code, None

        assert post({**current, "voiceHistoryEnabled": False}, False)[0] == 401
        assert post({**current, "speakerVerificationRequired": False})[0] == 200
        assert svc.cfg["speaker_verification_required"] is False
        assert post(current)[0] == 200
        assert svc.cfg.get("voice_history_enabled", True) is True
        with open(svc.config_path, "a", encoding="utf-8") as config_file:
            config_file.write(" ")
        assert post({**current, "voiceHistoryEnabled": False})[0] == 409
        assert not purges
        svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
        status, body = post({**current, "voiceHistoryEnabled": False})
        assert status == 200 and body["applied"] and body["serviceStartedAt"] == "fixture-process"
        assert body["settings"]["voiceHistoryEnabled"] is False
        assert svc.cfg["voice_history_enabled"] is False
        assert len(purges) == 1
        assert svc.tts.tts_config is svc.cfg
        assert json.load(open(svc.config_path, encoding="utf-8"))["voice_history_enabled"] is False
        svc.history += [{"command": "private"}]
        assert not svc.history
        svc.memory_outbox.purge = lambda: (_ for _ in ()).throw(OSError("synthetic purge failure"))
        assert post({**current, "voiceHistoryEnabled": False})[0] == 200
        assert svc.memory_capture_error == "OSError"
        assert svc.cfg["voice_history_enabled"] is False
        model = os.path.join(root, "synthetic-wake.npz")
        meta = os.path.join(root, "synthetic-wake.json")
        open(model, "wb").close()
        with open(meta, "w", encoding="utf-8") as target:
            json.dump({"wake_phrase": "Hey Test", "threshold": 0.5}, target)
        original_prepare = svc._prepare_wake_switch
        assert post({**current, "wakeWord": "Hey Test"})[0] == 422
        assert svc.phrase == "Hey Friday" and svc.cfg["wake_phrase"] == "Hey Friday"
        svc.wake_enrollment = types.SimpleNamespace(prepared=lambda phrase, active_phrase, service_started_at, current_revision, expected_revision: (model, meta), committed=lambda: None)
        svc._prepare_wake_switch = lambda phrase, paths: {"engine": "personal", "detector": FakeDetector(),
            "name": "personal", "threshold": 0.5, "high_confidence": None,
            "model_path": model, "meta_path": meta}
        status, body = post({**current, "wakeWord": "Hey Test"})
        assert status == 200 and body["settings"]["wakeWord"] == "Hey Test"
        assert svc.phrase == "Hey Test" and svc.engine == "personal"
        assert json.load(open(svc.config_path, encoding="utf-8"))["personal_wake_model"] == model
        svc.audio_transport = "device"
        selected = jv.runtime_settings.effective(svc.cfg)
        assert post({**selected, "pushToTalkKey": "F13"})[0] == 422
        svc.native_ptt_available = True
        status, body = post({**selected, "pushToTalkKey": "F13"})
        assert status == 200 and body["settings"]["pushToTalkKey"] == "F13"
        svc._prepare_wake_switch = original_prepare
        assert post({**jv.runtime_settings.effective(svc.cfg), "wakeWord": "Hey Friday"})[0] == 200
        assert svc.phrase == "Hey Friday" and svc.cfg["wake_phrase"] == "Hey Friday"
        assert svc.cfg["personal_wake_model"].endswith("personal_wake.npz")


def test_stt_model_preflight_and_language_apply_without_late_or_remote_change(monkeypatch, tmp_path):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.tts_config = svc.cfg
    svc.processing, svc.cloud_voice, svc.audio_transport = None, False, "browser"
    svc.service_started_at = "fixture-stt"
    svc.cfg.update(wake_phrase=svc.phrase, whisper_model="base", whisper_device="cpu",
                   whisper_compute_type="int8", stt_language="de")
    svc.config_path = str(tmp_path / "config" / "voice.json")
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard" / "data" / "voice-bridge").mkdir(parents=True)
    (tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key").write_text("a" * 44, encoding="ascii")
    with open(svc.config_path, "w", encoding="utf-8") as target:
        json.dump(svc.cfg, target)
    svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
    jv.INSTALL_ROOT = str(tmp_path)
    class CachedWhisper:
        def __init__(self, name, **kwargs):
            assert kwargs["local_files_only"] is True
            if name == "medium":
                raise OSError("synthetic missing cache")
            self.name = name
        def transcribe(self, audio, **kwargs):
            return iter([types.SimpleNamespace(text=kwargs["language"])]), None
    fake = types.ModuleType("faster_whisper")
    fake.WhisperModel = CachedWhisper
    monkeypatch.setitem(sys.modules, "faster_whisper", fake)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        svc.cfg["health_port"] = sock.getsockname()[1]
    svc._start_health()
    url = f"http://127.0.0.1:{svc.cfg['health_port']}/control/settings"
    def post(settings):
        body = {"settings": settings, "expectedConfigRevision": svc.config_disk_hash,
                "expectedServiceStartedAt": svc.service_started_at}
        request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": "Bearer " + "a" * 44})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code
    original = svc.whisper
    current = jv.runtime_settings.effective(svc.cfg)
    assert post({**current, "sttLanguage": "en", "sttModel": "medium"}) == 422
    assert svc.whisper is original and svc.cfg["stt_language"] == "de"
    assert post({**current, "sttLanguage": "en", "sttModel": "small"}) == 200
    assert svc.whisper.name == "small" and svc._transcribe(np.zeros(jv.SR)) == "en"
    assert json.load(open(svc.config_path, encoding="utf-8"))["whisper_model"] == "small"
    class ModelJobs:
        def __init__(self):
            self.job = None
        def status(self):
            return {"localMode": True, "models": [{"id": "small", "cached": True}], "job": self.job}
        def start(self, model):
            self.job = {"id": "f" * 32, "model": model, "state": "downloading", "error": None}
            return self.status()
        def cancel(self, job_id):
            assert job_id == "f" * 32
            self.job["state"] = "cancelled"
            return self.status()
    svc.stt_models = ModelJobs()
    base = url.removesuffix("/settings") + "/stt-models"
    with urllib.request.urlopen(urllib.request.Request(base, headers={"Authorization": "Bearer " + "a" * 44})) as response:
        assert json.load(response)["models"][0]["id"] == "small"
    def model_post(path, payload):
        request = urllib.request.Request(base + path, data=json.dumps(payload).encode(), method="POST",
            headers={"Authorization": "Bearer " + "a" * 44})
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, None
    assert model_post("/download", {"model": "medium", "expectedServiceStartedAt": "stale"})[0] == 422
    assert svc.stt_models.job is None
    assert model_post("/download", {"model": "medium", "expectedServiceStartedAt": svc.service_started_at})[1]["job"]["state"] == "downloading"
    assert model_post("/cancel", {"jobId": "f" * 32})[1]["job"]["state"] == "cancelled"
    assert svc.cfg["whisper_model"] == "small"
    svc.cloud_voice = True
    assert post({**jv.runtime_settings.effective(svc.cfg), "sttModel": "medium"}) == 422
    assert svc.cfg["whisper_model"] == "small"
    svc.cloud_voice = False
    loading = threading.Event()
    release = threading.Event()
    class StuckWhisper:
        def __init__(self, name, **kwargs):
            loading.set()
            assert release.wait(2)
            self.name = name
    fake.WhisperModel = StuckWhisper
    monkeypatch.setattr(jv, "STT_PREFLIGHT_TIMEOUT", .02)
    assert post({**jv.runtime_settings.effective(svc.cfg), "sttModel": "medium"}) == 503
    assert loading.is_set() and svc.stt_preflight_busy
    assert post({**jv.runtime_settings.effective(svc.cfg), "sttLanguage": "de"}) == 200
    assert post({**jv.runtime_settings.effective(svc.cfg), "sttModel": "medium"}) == 423
    assert svc.cfg["whisper_model"] == "small" and svc.whisper.name == "small"
    release.set()
    for _ in range(100):
        if not svc.stt_preflight_busy:
            break
        time.sleep(.01)
    assert not svc.stt_preflight_busy
    assert svc.cfg["whisper_model"] == "small" and svc.whisper.name == "small"


def test_wake_enrollment_http_capture_train_save_cas_and_rollback(monkeypatch, tmp_path):
    from wake_enrollment import WakeEnrollment

    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0)
    svc.tts.level = types.SimpleNamespace(value=lambda: 0)
    svc.cfg["wake_phrase"] = svc.phrase
    svc.audio_transport = "browser"
    svc.processing = None
    svc.service_started_at = "fixture-process"
    svc.tts.tts_config = svc.cfg
    svc.config_path = str(tmp_path / "config" / "voice.json")
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard" / "data" / "voice-bridge").mkdir(parents=True)
    (tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key").write_text("a" * 44, encoding="ascii")
    jv.INSTALL_ROOT = str(tmp_path)
    with open(svc.config_path, "w", encoding="utf-8") as target:
        json.dump(svc.cfg, target)
    svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
    monkeypatch.setattr(jv.runtime_settings, "protect_private", lambda *args, **kwargs: None)
    svc.wake_enrollment = WakeEnrollment(str(tmp_path), str(tmp_path / "state"))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        svc.cfg["health_port"] = sock.getsockname()[1]
    svc._start_health()
    base_url = f"http://127.0.0.1:{svc.cfg['health_port']}/control"

    def post(path, payload, revision=None):
        if path == "/settings":
            payload = {"settings": payload, "expectedConfigRevision": revision or svc.config_disk_hash,
                       "expectedServiceStartedAt": svc.service_started_at}
        request = urllib.request.Request(base_url + path, data=json.dumps(payload).encode(), method="POST",
                                         headers={"Authorization": "Bearer " + "a" * 44})
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, None

    def get():
        request = urllib.request.Request(base_url + "/wake-enrollment",
                                         headers={"Authorization": "Bearer " + "a" * 44})
        with urllib.request.urlopen(request, timeout=2) as response:
            return json.load(response)

    current = jv.runtime_settings.effective(svc.cfg)
    assert post("/wake-enrollment/start", {"phrase": "Hey Test", "expectedConfigRevision": "stale",
                "expectedServiceStartedAt": svc.service_started_at})[0] == 409
    status, job = post("/wake-enrollment/start", {"phrase": "Hey Test", "expectedConfigRevision": svc.config_disk_hash,
                "expectedServiceStartedAt": svc.service_started_at})
    assert status == 200 and get()["jobId"] == job["jobId"]
    sample = base64.b64encode(b"\0\0" * 8000).decode("ascii")
    for kind, count in job["required"].items():
        for _ in range(count):
            assert post("/wake-enrollment/sample", {"jobId": job["jobId"], "kind": kind,
                        "pcmBase64": sample})[0] == 200
    model_dir = tmp_path / "state" / "models" / "openwakeword" / ("runtime-" + "b" * 32)
    def train(*args):
        model_dir.mkdir()
        (model_dir / "personal_wake.npz").write_bytes(b"synthetic model")
        (model_dir / "personal_wake.json").write_text(json.dumps({"wake_phrase": "Hey Test"}), encoding="utf-8")
        return str(model_dir / "personal_wake.npz"), str(model_dir / "personal_wake.json")
    monkeypatch.setattr(jv.runtime_settings, "prepare_personal_wake", train)
    monkeypatch.setattr(pw.WindowModel, "load", lambda path: object())
    assert post("/wake-enrollment/train", {"jobId": job["jobId"]})[0] == 200
    for _ in range(100):
        if get()["state"] == "ready":
            break
        time.sleep(0.01)
    assert get()["state"] == "ready" and svc.phrase == "Hey Friday"
    svc._prepare_wake_switch = lambda phrase, paths: {"engine": "personal", "detector": FakeDetector(),
        "name": "personal", "threshold": 0.5, "high_confidence": None,
        "model_path": paths[0], "meta_path": paths[1]}
    original_write = jv.runtime_settings.atomic_write
    def fail_write(*args):
        raise jv.runtime_settings.ConfigConflict("synthetic concurrent write")
    monkeypatch.setattr(jv.runtime_settings, "atomic_write", fail_write)
    assert post("/settings", {**current, "wakeWord": "Hey Test"})[0] == 409
    assert svc.phrase == "Hey Friday" and get()["state"] == "ready" and model_dir.exists()
    monkeypatch.setattr(jv.runtime_settings, "atomic_write", original_write)
    assert post("/settings", {**current, "wakeWord": "Hey Test"})[0] == 200
    assert svc.phrase == "Hey Test" and get()["state"] == "idle"
    assert json.loads((tmp_path / "config" / "voice.json").read_text(encoding="utf-8"))["personal_wake_model"] == str(model_dir / "personal_wake.npz")


def test_pending_hermes_answer_is_suppressed_after_stop():
    jv = load_voice_module()
    svc = make_service(jv, {})
    entered, release = threading.Event(), threading.Event()

    def slow_answer(*args):
        entered.set()
        release.wait(2)
        return "late answer"

    svc._ask_hermes = slow_answer
    result = []
    worker = threading.Thread(target=lambda: result.append(svc._ask_hermes_interruptible("x", {}, "job", 0)))
    worker.start()
    assert entered.wait(1)
    svc.control_generation += 1
    svc.control_cancel.set()
    worker.join(1)
    release.set()
    assert not worker.is_alive()
    assert result == [None]


def test_stop_detector_suppresses_tts_quote_and_cancels_user_stop(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg["speaker_threshold"] = 0.4
    svc.stop_audio_q = queue.Queue(maxsize=64)
    svc.transcribe_lock = threading.Lock()
    svc.processing = "thinking"
    svc.tts.speaking.set()
    svc.tts.current_text = "Sie sagte Stop im Zitat"
    echo = [True]
    svc.tts.is_output_echo = lambda audio: echo[0]
    svc.verifier = types.SimpleNamespace(score=lambda audio: 0.9)
    svc._transcribe = lambda audio: "Stop"
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)
    threading.Thread(target=svc._stop_listener, daemon=True).start()

    def phrase():
        for _ in range(6):
            svc.stop_audio_q.put(np.full(jv.CHUNK, 5000, dtype=np.int16))
        for _ in range(5):
            svc.stop_audio_q.put(np.zeros(jv.CHUNK, dtype=np.int16))

    phrase()
    jv.time.sleep(0.15)
    assert not svc.control_cancel.is_set()
    echo[0] = False  # The user speaks Stop while the TTS quote still contains Stop.
    phrase()
    submitted = jv.time.monotonic()
    deadline = jv.time.monotonic() + 1
    while not svc.control_cancel.is_set() and jv.time.monotonic() < deadline:
        jv.time.sleep(0.01)
    assert svc.control_cancel.is_set()
    assert jv.time.monotonic() - submitted < 0.5  # synthetic queue, not physical capture/playback latency
    assert svc.status["state"] == "wake_only"


def test_playback_reference_matches_echo_but_not_overlaid_user_voice():
    jv = load_voice_module()
    speaker = jv.Speaker.__new__(jv.Speaker)
    speaker.browser_audio = None
    speaker.echo_reference = collections.deque()
    speaker.echo_lock = threading.Lock()
    sample = np.random.default_rng(5).normal(0, 0.06, jv.SR).astype(np.float32)
    speaker._note_output(sample, jv.SR)
    assert speaker.is_output_echo(sample)
    user = np.random.default_rng(6).normal(0, 0.4, jv.SR).astype(np.float32)
    assert not speaker.is_output_echo(sample + user)


def test_browser_pcm_send_updates_echo_reference(monkeypatch):
    jv = load_voice_module()
    sample = (np.random.default_rng(25).standard_normal(jv.elevenlabs_cloud.TTS_RATE) * 4000).astype("<i2")
    sent = []
    speaker = jv.Speaker.__new__(jv.Speaker)
    speaker.browser_audio = types.SimpleNamespace(connected=lambda: True,
        send_pcm=lambda data, stop: sent.append(data) or True)
    speaker.cloud_key = "unused"
    speaker.tts_config = {"elevenlabs_voice_id": "synthetic"}
    speaker.stop_flag = threading.Event()
    speaker.level = types.SimpleNamespace(update=lambda *args: None)
    speaker.echo_reference = collections.deque()
    speaker.echo_lock = threading.Lock()
    monkeypatch.setattr(jv.elevenlabs_cloud, "stream_speech", lambda *args, **kwargs: [sample.tobytes()])
    speaker._play_elevenlabs("quoted Stop")
    assert b"".join(sent) == sample.tobytes()
    browser_microphone_echo = np.concatenate([part for _, part in speaker.echo_reference])
    assert speaker.is_output_echo(browser_microphone_echo)


def test_audio_apply_rolls_back_open_stream_after_config_write_failure(monkeypatch, tmp_path):
    jv = load_voice_module()
    class Stream:
        def __init__(self):
            self.active = False
            self.closed = False
        def __enter__(self):
            return self
        def __exit__(self, *_):
            self.close()
        def start(self):
            self.active = True
        def stop(self):
            self.active = False
        def close(self):
            self.closed = True

    opened = []
    def input_stream(**kwargs):
        stream = Stream()
        opened.append(stream)
        return stream
    fake_sd = types.SimpleNamespace(InputStream=input_stream, OutputStream=lambda **kwargs: Stream(),
                                    PortAudioError=RuntimeError,
                                    query_devices=lambda device=None, direction=None: {"default_samplerate": 48000, "max_output_channels": 2})
    monkeypatch.setattr(jv, "sd", fake_sd)
    svc = make_service(jv, {})
    svc.audio_transport = "device"
    svc.input_stream = Stream()
    svc.tts.output_device = None
    svc.processing = None
    svc.status["state"] = "wake_only"
    svc.audio_input_device_id = svc.audio_output_device_id = None
    svc.audio_applied_revision = 1
    svc.audio_error = None
    svc.audio_q = queue.Queue()
    svc.service_started_at = "2026-10-19T00:00:00Z"
    svc.cfg.update({"input_device": None, "output_device": None})
    (tmp_path / "config").mkdir()
    monkeypatch.setattr(jv, "INSTALL_ROOT", str(tmp_path))
    import audio_devices
    monkeypatch.setattr(audio_devices, "resolve", lambda sd, selected, direction: (None, None))
    monkeypatch.setattr(jv.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("write failed")))
    with pytest.raises(OSError, match="write failed"):
        svc.apply_audio(None, None)
    assert len(opened) == 2  # attempted new stream, then rollback stream
    assert opened[0].closed and opened[1].active
    assert svc.audio_input_device_id is None and svc.audio_output_device_id is None


def test_cancelled_generation_cannot_queue_late_speech():
    jv = load_voice_module()
    svc = make_service(jv, {})
    spoken = []
    svc.tts.say = spoken.append
    assert svc._say_if_current("before stop", 0)
    svc.control_generation = 1
    assert not svc._say_if_current("late answer", 0)
    assert spoken == ["before stop"]


def test_cloud_routes_select_model_and_reasoning(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg.update({"hermes_url": "http://127.0.0.1/test", "hermes_model": "friday"})
    svc.hermes_key, svc.history = "test", []
    requests = []
    monkeypatch.setattr(jv, "post_json", lambda url, payload, headers, timeout: (
        requests.append(payload) or {"choices": [{"message": {"content": "Bereit."}}]}))
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    for route, model, effort in (("cloud_low", "kimi-for-coding", "none"),
                                 ("cloud_high", "k3", "high"), ("cloud_max", "k3", "max")):
        assert svc._ask_hermes("Test", {"route": route}, "test") == "Bereit."
        assert requests[-1]["model"] == model
        assert requests[-1]["provider"] == "kimi-coding"
        assert requests[-1]["model_options"]["reasoning_effort"] == effort
    svc.cfg.update({"cloud_provider": "anthropic", "cloud_models": {"cloud_low": "small-model"}})
    svc._ask_hermes("Test", {"route": "cloud_low"}, "test")
    assert requests[-1]["model"] == "small-model" and requests[-1]["provider"] == "anthropic"


def test_voice_model_policy_never_retries_after_agent_request(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg.update({"hermes_url": "http://127.0.0.1/test", "hermes_model": "friday"})
    svc.hermes_key, svc.history = "test", []
    policy = {"targets": {"cloud_high": ("openai", "primary")}, "local_first": False,
              "reasoning": {"cloud_high": "medium"}, "fallback": {"cloud_high": ("anthropic", "backup")}}
    monkeypatch.setattr(jv, "load_dashboard_voice_policy", lambda *args, **kwargs: policy)
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: None)
    assert svc._route("Analysiere diesen Fehler")["route"] == "cloud_high"
    requests = []
    side_effects = []
    def rejected_after_side_effect(url, payload, headers, timeout):
        requests.append(dict(payload))
        side_effects.append("provider-work-may-have-run")
        raise urllib.error.HTTPError(url, 401, "auth error after work", {}, None)
    monkeypatch.setattr(jv, "post_json", rejected_after_side_effect)
    assert "nicht verfuegbar" in svc._ask_hermes("Test", {"route": "cloud_high"}, "task")
    assert len(requests) == len(side_effects) == 1
    assert requests[0]["model_options"]["reasoning_effort"] == "medium"

    policy["targets"]["cloud_high"] = ("openai", None)
    requests.clear()
    monkeypatch.setattr(jv, "post_json", lambda url, payload, headers, timeout: (
        requests.append(dict(payload)) or {"choices": [{"message": {"content": "Bereit."}}]}))
    assert svc._ask_hermes("Test", {"route": "cloud_high"}, "task") == "Bereit."
    assert [(request["provider"], request["model"]) for request in requests] == [("anthropic", "backup")]

    policy["targets"]["cloud_high"] = ("openai", "primary")
    requests.clear()
    def ambiguous_timeout(url, payload, headers, timeout):
        requests.append(dict(payload))
        raise TimeoutError("uncertain")
    monkeypatch.setattr(jv, "post_json", ambiguous_timeout)
    assert "nicht verfuegbar" in svc._ask_hermes("Test", {"route": "cloud_high"}, "task")
    assert len(requests) == 1


def test_followup_window_starts_after_answer(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg.update({"command_start_timeout_s": 5.0, "followup_window_s": 15.0})
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    svc._acknowledge_wake = lambda: np.zeros(pw.CHUNK, dtype=np.int16)
    svc._drain = lambda: None
    svc._wake_detected = lambda chunk: False
    svc._read_chunk = lambda: (svc.tts.speaking.clear() or np.zeros(pw.CHUNK, dtype=np.int16))
    calls = []
    def record(timeout):
        calls.append(timeout)
        return np.zeros(pw.CHUNK, dtype=np.int16) if len(calls) == 1 else None
    def handle(audio, wake_audio):
        svc.trusted_until = jv.time.monotonic() - 10  # cloud + speech outlast the original deadline
        svc.tts.speaking.set()
    svc._record_command = record
    svc._handle_command = handle
    svc._session()
    assert calls == [5.0, 15.0]
    assert 14 <= svc.trusted_until - jv.time.monotonic() <= 15
    assert svc.status["state"] == "wake_only"


def test_background_reply_reopens_followup_window(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.cfg.update({"command_start_timeout_s": 5.0, "followup_window_s": 15.0})
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    svc._acknowledge_wake = lambda: np.zeros(pw.CHUNK, dtype=np.int16)
    svc._drain = lambda: None
    svc._wake_detected = lambda chunk: False
    calls = []
    def record(timeout):
        calls.append(timeout)
        if len(calls) == 1:
            return np.zeros(pw.CHUNK, dtype=np.int16)
        if len(calls) == 3:
            svc.background_jobs.clear()
            svc.background_reply_ready.set()
        return None
    def handle(audio, wake_audio):
        svc.background_jobs.add("pending-kimi")
        svc.trusted_until = jv.time.monotonic() - 1
    svc._record_command = record
    svc._handle_command = handle
    svc._session()
    assert calls == [5.0, 15.0, 15.0, 15.0]
    assert svc.status["state"] == "wake_only"


def test_service_stage2_accepts_and_rejects(monkeypatch):
    jv = load_voice_module()
    events = []
    monkeypatch.setattr(jv, "log_event", lambda **kw: events.append(kw))
    chunk = np.zeros(pw.CHUNK, dtype=np.int16)

    svc = make_service(jv, {"de": "Hey Friday"})
    assert svc._wake_detected(chunk) is False and not svc.whisper.calls          # Score unter Schwelle: kein Whisper
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is True
    assert svc.whisper.calls == ["de"] and svc.status["wake_count"] == 1 and svc.oww.resets == 1
    assert events[-1]["event"] == "wake" and events[-1]["engine"] == "personal" and events[-1]["stage2_ms"] is not None
    assert svc._wake_detected(chunk) is False and len(svc.whisper.calls) == 1    # 1,5-s-Doppelausloeseschutz

    svc = make_service(jv, {"de": "Heute ist Freitag", "en": "hey freight"})
    svc.wake_high_confidence = 4.0
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is True and svc.whisper.calls == []
    assert events[-1]["confirmation"] == "model"

    svc = make_service(jv, {"de": "Heute ist Freitag", "en": "Hey Friday"})       # de verfehlt, en bestaetigt
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is True and svc.whisper.calls == ["de", "en"]

    svc = make_service(jv, {"de": "Hey Freitag", "en": "hey freight"})
    svc.oww.score = 5.0
    svc.tts.speaking.set()
    assert svc._wake_detected(chunk) is False
    assert svc.status["wake_rejected"] == 1 and svc.status["wake_count"] == 0 and svc.tts.interrupted == 0
    assert events[-1]["event"] == "wake_rejected" and events[-1]["stage"] == 2
    calls = len(svc.whisper.calls)
    assert svc._wake_detected(chunk) is False and len(svc.whisper.calls) == calls   # Refraktaerzeit: kein Whisper


def test_stage2_waits_for_the_end_of_the_wake_phrase(monkeypatch):
    jv = load_voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    svc = make_service(jv, {"de": "Hey Friday"})
    svc.cfg["wake_confirm_tail_chunks"] = 5
    svc.oww.score = 5.0
    for marker in (1, 2, 3, 4, 5):
        svc.audio_q.put(np.full(pw.CHUNK, marker, dtype=np.int16))

    assert svc._wake_detected(np.zeros(pw.CHUNK, dtype=np.int16)) is True
    assert svc.audio_q.empty()
    assert list(svc.ring)[-1][0] == 5
    assert svc.status["wake_count"] == 1


def test_service_stage2_compares_the_full_phrase(monkeypatch):
    jv = load_voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    chunk = np.zeros(pw.CHUNK, dtype=np.int16)
    phrase = "Guten Morgen Friday"
    svc = make_service(jv, {"de": "guten morgen fraidei"}, phrase=phrase)                  # kleine Transkriptionsabweichung
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is True and svc.status["wake_count"] == 1
    svc = make_service(jv, {"de": "Friday wie spät ist es", "en": "friday"}, phrase=phrase)  # nur ein Teil der Phrase
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is False and svc.status["wake_rejected"] == 1
    svc = make_service(jv, {"de": "Computer starte den Task"}, phrase="Computer")          # Phrase ohne Grusswort
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is True
    svc = make_service(jv, {"de": "Hey Friday"}, phrase="Hallo Welt")
    svc.oww.score = 5.0
    assert svc._wake_detected(chunk) is False


def test_service_barge_in_and_openwakeword_path(monkeypatch):
    jv = load_voice_module()
    monkeypatch.setattr(jv, "log_event", lambda **kw: None)
    chunk = np.zeros(pw.CHUNK, dtype=np.int16)
    svc = make_service(jv, {"de": "Hey Friday"})
    svc.oww.score = 5.0
    svc.tts.speaking.set()
    assert svc._wake_detected(chunk) is True and svc.tts.interrupted == 1          # Barge-In erst nach Bestaetigung

    class Oww:                                       # Jarvis-Weg: kein Whisper, Schwelle 0.5, predict -> dict
        def __init__(self):
            self.resets = 0

        def predict(self, c):
            return {"hey_jarvis_v0.1": 0.9}

        def reset(self):
            self.resets += 1

    svc = make_service(jv, {}, engine="openwakeword")
    svc.oww, svc.wake_name, svc.wake_threshold = Oww(), "hey_jarvis_v0.1", 0.5
    assert svc._wake_detected(chunk) is True and svc.whisper.calls == []
    assert svc.status["wake_engine"] == "openwakeword"


def test_status_server_ignores_client_disconnects(capsys):
    # N-144: each dashboard probe that timed out mid-response left a 20-line traceback in the voice log.
    jv = load_voice_module()
    srv = jv.QuietHTTPServer.__new__(jv.QuietHTTPServer)
    for exc in (ConnectionAbortedError(10053, "aborted"), ConnectionResetError(), BrokenPipeError()):
        try:
            raise exc
        except OSError:
            srv.handle_error(None, ("127.0.0.1", 1))
    assert capsys.readouterr().err == ""
    try:
        raise ValueError("handler bug")
    except ValueError:
        srv.handle_error(None, ("127.0.0.1", 1))
    assert "ValueError: handler bug" in capsys.readouterr().err


def test_service_backlog_becomes_preroll(monkeypatch):
    jv = load_voice_module()
    svc = make_service(jv, {})
    backlog = [np.full(pw.CHUNK, i, dtype=np.int16) for i in range(1, 9)]
    for c in backlog:
        svc.audio_q.put(c)
    svc._acknowledge_wake()
    assert len(svc.preroll) == 4 and svc.audio_q.empty()
    first = svc._read_chunk()
    assert first[0] == 5 and svc.ring[-1][0] == 5 and len(svc.preroll) == 3        # Wake-Rest entfernt, Befehlsanfang erhalten
    svc.audio_q.put(np.full(pw.CHUNK, 9, dtype=np.int16))
    assert [svc._read_chunk()[0] for _ in range(4)] == [6, 7, 8, 9]
    svc.preroll = [first]
    svc._drain()
    assert svc.preroll == [] and svc.oww.resets == 1

    svc = make_service(jv, {})
    for c in backlog[:3]:
        svc.audio_q.put(c)
    svc._acknowledge_wake()
    assert svc.preroll == [] and svc.audio_q.empty()                         # kurzer Wake-Rest verworfen
    svc = make_service(jv, {}, engine="openwakeword")                              # Jarvis-Weg: Rueckstand wird verworfen
    svc.audio_q.put(np.zeros(pw.CHUNK, dtype=np.int16))
    svc._acknowledge_wake()
    assert svc.preroll == [] and svc.audio_q.empty()


def test_conversation_backend_switches_at_runtime(monkeypatch, tmp_path):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0, snapshot=lambda: {})
    svc.tts.level = types.SimpleNamespace(value=lambda: 0, snapshot=lambda: {})
    svc.tts.tts_config = svc.cfg
    svc.processing, svc.cloud_voice, svc.audio_transport = None, False, "browser"
    svc.service_started_at = "fixture-conversation"
    svc.cfg.update(wake_phrase=svc.phrase)
    svc.cfg["qwen_key_file"] = str(tmp_path / "config" / "alibaba_tokenplan.key.dpapi")
    svc.config_path = str(tmp_path / "config" / "voice.json")
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard" / "data" / "voice-bridge").mkdir(parents=True)
    (tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key").write_text("a" * 44, encoding="ascii")
    with open(svc.config_path, "w", encoding="utf-8") as target:
        json.dump(svc.cfg, target)
    svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
    jv.INSTALL_ROOT = str(tmp_path)
    svc.conversation = None
    svc.qwen_dialog = None
    svc.domain_tasks = object()
    built = []
    dialog = types.SimpleNamespace(closed=threading.Event())
    dialog.close = dialog.closed.set
    orchestrator = types.SimpleNamespace(drain_announcements=lambda: [])

    def build(cfg):
        built.append(cfg["conversation_backend"])
        return (orchestrator, dialog) if cfg["conversation_backend"] == "qwen" else None

    monkeypatch.setattr(svc, "_build_conversation", build)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        svc.cfg["health_port"] = sock.getsockname()[1]
    svc._start_health()
    url = f"http://127.0.0.1:{svc.cfg['health_port']}/control/settings"

    def post(settings):
        body = {"settings": settings, "expectedConfigRevision": svc.config_disk_hash,
                "expectedServiceStartedAt": svc.service_started_at}
        request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                         headers={"Authorization": "Bearer " + "a" * 44})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    current = jv.runtime_settings.effective(svc.cfg)
    assert post({**current, "conversationBackend": "qwen"}) == 422
    assert built == []
    (tmp_path / "config" / "alibaba_tokenplan.key.dpapi").write_text("x", encoding="utf-8")
    current = jv.runtime_settings.effective(svc.cfg)
    assert post({**current, "conversationBackend": "qwen"}) == 200
    assert svc.qwen_dialog is dialog and svc.conversation is orchestrator
    assert json.load(open(svc.config_path, encoding="utf-8"))["conversation_backend"] == "qwen"
    assert svc.status_payload()["conversation"] == {"backend": "qwen", "key_configured": True, "last_error": None}
    assert post({**jv.runtime_settings.effective(svc.cfg), "conversationBackend": "local"}) == 200
    assert svc.qwen_dialog is None
    assert dialog.closed.wait(2) is True
    assert built == ["qwen", "local"]

    def failing(cfg):
        raise RuntimeError("x")

    monkeypatch.setattr(svc, "_build_conversation", failing)
    assert post({**jv.runtime_settings.effective(svc.cfg), "conversationBackend": "qwen"}) == 422
    assert svc.cfg["conversation_backend"] == "local"


def test_conversation_key_endpoint_verifies_before_storing(monkeypatch, tmp_path):
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.input_level = types.SimpleNamespace(value=lambda: 0, snapshot=lambda: {})
    svc.tts.level = types.SimpleNamespace(value=lambda: 0, snapshot=lambda: {})
    svc.processing, svc.cloud_voice, svc.audio_transport = None, False, "browser"
    svc.service_started_at = "fixture-conversation-key"
    svc.cfg.update(wake_phrase=svc.phrase, conversation_backend="local")
    svc.cfg["qwen_key_file"] = str(tmp_path / "config" / "alibaba_tokenplan.key.dpapi")
    svc.config_path = str(tmp_path / "config" / "voice.json")
    (tmp_path / "config").mkdir()
    (tmp_path / "dashboard" / "data" / "voice-bridge").mkdir(parents=True)
    (tmp_path / "dashboard" / "data" / "voice-bridge" / "auth.key").write_text("a" * 44, encoding="ascii")
    with open(svc.config_path, "w", encoding="utf-8") as target:
        json.dump(svc.cfg, target)
    svc.config_disk_hash = jv.runtime_settings.file_hash(svc.config_path)
    jv.INSTALL_ROOT = str(tmp_path)
    svc.conversation = None
    svc.qwen_dialog = None
    svc.domain_tasks = object()
    stored = []
    monkeypatch.setattr(jv.qwen_realtime, "save_key", lambda path, key: stored.append((path, key)))

    def verify_key(key, **kwargs):
        if key == "bad-key-123":
            raise jv.qwen_realtime.RealtimeError("auth", "x")

    monkeypatch.setattr(jv.qwen_realtime, "verify_key", verify_key)
    events = []
    monkeypatch.setattr(jv, "log_event", lambda **kwargs: events.append(kwargs))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        svc.cfg["health_port"] = sock.getsockname()[1]
    svc._start_health()
    url = f"http://127.0.0.1:{svc.cfg['health_port']}/control/conversation-key"

    def post(payload):
        request = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                         headers={"Authorization": "Bearer " + "a" * 44})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, None

    assert post({"apiKey": "bad-key-123"})[0] == 422
    assert stored == []
    assert post({"apiKey": "kurz"})[0] == 422
    assert post({"apiKey": "good-key-1234", "extra": True})[0] == 422
    assert stored == []
    status, body = post({"apiKey": "good-key-1234"})
    assert status == 200 and body == {"keyConfigured": True}
    assert stored == [(svc.cfg["qwen_key_file"], "good-key-1234")]

    svc.cfg["conversation_backend"] = "qwen"
    builds = []
    dialog = types.SimpleNamespace(close=lambda: None)
    orchestrator = types.SimpleNamespace(drain_announcements=lambda: [])

    def build(cfg):
        builds.append(cfg["conversation_backend"])
        return orchestrator, dialog

    monkeypatch.setattr(svc, "_build_conversation", build)
    status, body = post({"apiKey": "good-key-1234"})
    assert status == 200 and body == {"keyConfigured": True}
    assert builds == ["qwen"] and svc.qwen_dialog is dialog
    assert "good-key-1234" not in repr(events)


class ScriptedVad:
    """Speech probability per 32 ms frame from a script; silence once the script is used up."""

    def __init__(self, probs):
        self.probs = list(probs)

    def reset_states(self):
        pass

    def __call__(self, frame, sr):
        return self.probs.pop(0) if self.probs else 0.0


def recording_service(jv, monkeypatch, probs, announce_after_chunks):
    svc = make_service(jv, {})
    svc.cfg.update({"vad_threshold": 0.5, "command_end_silence_s": 0.3, "command_max_s": 10.0})
    svc.vad = ScriptedVad(probs)
    monkeypatch.setattr(jv, "torch", types.SimpleNamespace(from_numpy=lambda array: array))
    seen = {"chunks": 0, "speaking_seen": False}

    def read_chunk():
        seen["chunks"] += 1
        seen["speaking_seen"] = seen["speaking_seen"] or svc.user_speaking.is_set()
        if seen["chunks"] == announce_after_chunks:
            svc.tts.speaking.set()  # a background result starts to play
        return np.full(jv.CHUNK, 1000, dtype=np.int16)

    svc._read_chunk = read_chunk
    return svc, seen


def test_announcement_does_not_cut_off_the_users_sentence(monkeypatch):
    """U-10: once the user speaks, an announcement starting meanwhile must not throw the sentence away."""
    jv = load_voice_module()
    svc, seen = recording_service(jv, monkeypatch, [0.9] * 6, announce_after_chunks=2)
    audio = svc._record_command(5.0)
    assert audio is not None and len(audio) >= 6 * jv.VAD_FRAME
    assert seen["speaking_seen"] is True
    assert not svc.user_speaking.is_set()


def test_announcement_before_any_speech_still_ends_the_recording(monkeypatch):
    jv = load_voice_module()
    svc, _ = recording_service(jv, monkeypatch, [], announce_after_chunks=1)
    assert svc._record_command(5.0) is None
    assert not svc.user_speaking.is_set()


def test_announcements_wait_for_the_pause_after_the_users_turn():
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.processing = None
    svc.user_speaking.set()
    released = []

    def finish_turn():
        time.sleep(0.15)
        svc.user_speaking.clear()
        svc.processing = "thinking"  # the order is answered next: still no pause
        time.sleep(0.15)
        released.append(time.monotonic())
        svc.processing = None

    threading.Thread(target=finish_turn, daemon=True).start()
    svc._wait_for_pause(limit_s=5.0)
    assert released and time.monotonic() >= released[0]
    assert not svc._user_turn_active()


def test_wait_for_pause_gives_up_after_its_limit():
    jv = load_voice_module()
    svc = make_service(jv, {})
    svc.processing = "thinking"
    started = time.monotonic()
    svc._wait_for_pause(limit_s=0.2)
    assert 0.15 <= time.monotonic() - started < 2.0


if __name__ == "__main__":
    import tempfile

    class MP:                                        # minimaler monkeypatch fuer den Skriptlauf
        def setattr(self, obj, name, value):
            setattr(obj, name, value)

    failures = 0
    for fname, fn in sorted(globals().items()):
        if fname.startswith("test_") and callable(fn):
            args = {"tmp_path": __import__("pathlib").Path(tempfile.mkdtemp()), "monkeypatch": MP()}
            wanted = fn.__code__.co_varnames[:fn.__code__.co_argcount]
            try:
                fn(**{k: args[k] for k in wanted})
                print("ok   ", fname)
            except Exception as exc:                 # noqa: BLE001
                failures += 1
                print("FAIL ", fname, repr(exc))
    sys.exit(1 if failures else 0)
