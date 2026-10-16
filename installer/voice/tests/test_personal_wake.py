"""Tests fuer Assistentenname, frei waehlbare Wake Phrase, Phrasenabgleich (Stufe 2), Fenstermodell/Kalibrierung (Stufe 1) und die Wake-Logik des
Dienstes (mit Stubs fuer winsound/sounddevice/torch).

Ausfuehren (Linux/Windows, nur numpy noetig; Modelltraining zusaetzlich scikit-learn):
  python3 -m pytest installer/voice/tests          oder          python3 installer/voice/tests/test_personal_wake.py
"""
import collections
import importlib.util
import json
import os
import queue
import socket
import sys
import tempfile
import threading
import types
import urllib.error
import urllib.request

import numpy as np

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
    if importlib.util.find_spec("torch") is None:
        stubs["torch"] = types.ModuleType("torch")
    for name, module in stubs.items():
        sys.modules.setdefault(name, module)
    sys.modules.pop("friday_voice", None)
    return importlib.import_module("friday_voice")


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
    svc.control_cancel, svc.control_paused, svc.control_generation = threading.Event(), False, 0
    svc.whisper, svc.oww, svc.wake_name, svc.wake_threshold = FakeWhisper(texts), FakeDetector(), "personal", 2.0
    svc.tts = types.SimpleNamespace(speaking=threading.Event(), interrupted=0)
    svc.tts.interrupt = lambda: setattr(svc.tts, "interrupted", svc.tts.interrupted + 1)
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
    assert svc.status["state"] == "listening"


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
        assert svc.control_cancel.is_set() and svc.status["state"] == "listening"
        assert svc.tts.interrupted == 2

        # Stopping while paused must leave the service ready for a fresh manual session.
        assert post("pause", "a" * 44) == 202
        paused_generation = svc.control_generation
        assert post("stop", "a" * 44) == 202
        assert not svc.control_paused and svc.status["state"] == "listening"
        assert svc.control_cancel.is_set() and svc.control_generation == paused_generation + 1
        assert post("start", "a" * 44) == 202
        assert svc.manual_start.is_set()
        assert not svc._say_if_current("stale response", paused_generation)


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
    assert svc.status["state"] == "listening"


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
    assert svc.status["state"] == "listening"


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
