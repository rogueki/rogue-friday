"""Persoenliches Wake Word fuer beliebige Assistentennamen (Engine "personal").

openWakeWord liefert nur fuer "hey_jarvis" ein vortrainiertes Modell. Fuer jedes andere Wake Word (Standard: "Hey
Friday"; frei waehlbares Wort oder Satz mit 1-4 Woertern) arbeitet die Erkennung zweistufig und rein lokal:

  Stufe 1  Few-Shot-Erkennung auf den openWakeWord-Embedding-Features (AudioFeatures, 96 Dimensionen je 80 ms),
           trainiert auf den eigenen Enrollment-Aufnahmen der Phrase ("Hey Friday") und ihrer Kurzform ("Friday",
           nur wenn die Phrase mit einem Grusswort wie "Hey" beginnt) gegen die aufgenommenen
           harten Negativen, Lesetexte und Zwischenraeume. Gleitendes Fenster (3 Zeitstreckungen), je Gruppe ein
           linearer Klassifikator (nur numpy zur Laufzeit); die Schwelle wird per Kreuzvalidierung auf ungesehenen
           Clips kalibriert. Reine Kosinus-Templates waren auf synthetischen Daten deutlich schlechter (siehe
           docs/MAPPING/voice.md).
  Stufe 2  Bestaetigung per faster-whisper auf dem ~2-s-Fenster (nur wenn Stufe 1 ausloest): `phrase_matches` prueft
           die gesamte Phrase (oder ihre Kurzform) unscharf: Wort fuer Wort in Reihenfolge, Umlaute/Gross-Klein,
           kleine Editierdistanz auf einer phonetischen Normalform, getrennt/zusammen geschriebene Woerter, Aliase,
           Sperrliste aehnlicher Woerter.
  Danach folgt wie bisher die ECAPA-Sprecherpruefung des Dienstes.

Das Modul importiert openWakeWord nur lazy und enthaelt keine Windows-Abhaengigkeiten (testbar unter Linux).
"""
from __future__ import annotations

import json
import os
import re
import unicodedata

import numpy as np

SR = 16000
CHUNK = 1280                 # 80 ms, ein Embedding-Frame je Chunk
FRAME_S = CHUNK / SR
DIM = 96
PREROLL_CHUNKS = 10          # Einschwingphase der Melspektrogramm-/Embedding-Puffer
SCALES = (0.8, 1.0, 1.25)    # Zeitstreckung des Live-Fensters gegenueber dem Template
TOPK = 3

# ------------------------------------------------------------------------------------------------ Namen & Text


def fold(text: str) -> str:
    """Kleinbuchstaben, Umlaute/Akzente entfernt (ae->a), nur a-z."""
    text = text.lower().replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if "a" <= c <= "z")


def slugify(name: str) -> str:
    """Ordner-/Dateiname: ASCII, Kleinbuchstaben, Umlaute als ae/oe/ue ("Jörg" -> "joerg")."""
    text = name.strip().lower()
    for src, dst in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(src, dst)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if c.isascii())
    return re.sub(r"[^a-z0-9]+", "_", text).strip("_") or "assistant"


def valid_name(name: str) -> bool:
    """Wie im Installer: 2-20 Buchstaben (inkl. Umlaute), keine Ziffern/Leerzeichen/Sonderzeichen."""
    return re.fullmatch(r"[^\W\d_]{2,20}", name or "") is not None


def display_name(name: str) -> str:
    name = name.strip()
    return name[:1].upper() + name[1:]


def wake_phrase(name: str) -> str:
    return f"Hey {display_name(name)}"


# ---- Wake Phrase (frei waehlbar): 1-4 Woerter, Buchstaben/Umlaute/Bindestrich, 3-30 Zeichen ----------------------------
PHRASE_MIN_CHARS, PHRASE_MAX_CHARS, PHRASE_MAX_WORDS = 3, 30, 4
GREETINGS = ("hey", "hi", "hallo", "ok", "okay", "hej")   # Grusswoerter, die eine Kurzform der Phrase erlauben
PRETRAINED_PHRASE = "hey jarvis"                          # einzige Phrase mit vortrainiertem openWakeWord-Modell
_PHRASE_WORD = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*")


def normalize_phrase(phrase: str) -> str:
    """Whitespace zusammengefasst und getrimmt ("  hey   friday " -> "hey friday")."""
    return re.sub(r"\s+", " ", (phrase or "").strip())


def valid_phrase(phrase: str) -> bool:
    """1-4 Woerter aus Buchstaben (inkl. Umlaute) mit optionalem Bindestrich, getrennt durch Leerzeichen, 3-30 Zeichen."""
    text = normalize_phrase(phrase)
    if not PHRASE_MIN_CHARS <= len(text) <= PHRASE_MAX_CHARS:
        return False
    words = text.split(" ")
    return len(words) <= PHRASE_MAX_WORDS and all(_PHRASE_WORD.fullmatch(w) for w in words)


def display_phrase(phrase: str) -> str:
    """Anzeigeform: jedes Wort mit grossem Anfangsbuchstaben ("hey friday" -> "Hey Friday")."""
    return " ".join(w[:1].upper() + w[1:] for w in normalize_phrase(phrase).split(" "))


def phrase_key(phrase: str) -> str:
    """Vergleichsform: Kleinbuchstaben, Leerzeichen und Bindestriche als einzelnes Leerzeichen."""
    return re.sub(r"[\s-]+", " ", (phrase or "").strip().lower())


def is_pretrained_phrase(phrase: str) -> bool:
    """Nur exakt "Hey Jarvis" (Gross-/Kleinschreibung und Leerraum egal) nutzt das vortrainierte openWakeWord-Modell."""
    return phrase_key(phrase) == PRETRAINED_PHRASE


def wake_engine(phrase: str) -> str:
    return "openwakeword" if is_pretrained_phrase(phrase) else "personal"


def phrase_slug(phrase: str) -> str:
    """Ordnername der Aufnahmen: wake_<slug> ("Hey Friday" -> "hey_friday")."""
    return slugify(phrase)


def short_form(phrase: str) -> str | None:
    """Kurzform ohne fuehrendes Grusswort ("Hey Friday" -> "Friday"); None, wenn die Phrase nicht so beginnt."""
    words = normalize_phrase(phrase).split(" ")
    if len(words) >= 2 and fold(words[0]) in GREETINGS:
        return display_phrase(" ".join(words[1:]))
    return None


_PHON_RULES = [("sch", "S"), ("ch", "X"), ("ph", "f"), ("ck", "k"), ("qu", "kv"), ("tz", "ts"), ("dt", "t"),
               ("th", "t"), ("ie", "i"), ("ei", "ai"), ("ey", "ai"), ("ay", "ai"), ("eu", "oi"), ("v", "f"),
               ("w", "v"), ("z", "ts"), ("c", "k"), ("y", "i"), ("x", "ks")]


def phonetic_key(text: str) -> str:
    """Grobe deutsche Lautnormalform: Friday/Fraidei -> fridai/fraidai (Distanz 1), Freitag -> fraitag."""
    s = fold(text)
    for src, dst in _PHON_RULES:
        s = s.replace(src, dst)
    s = re.sub(r"(?<=[aeiou])h", "", s)
    return re.sub(r"(.)\1+", r"\1", s)


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def allowed_distance(key_len: int) -> int:
    """Kurze Namen exakt (Jim/Bob), mittlere 1 Edit, lange 2 Edits."""
    return 0 if key_len <= 3 else 1 if key_len <= 8 else 2


# Phonetische Varianten, die Whisper bei deutscher Erkennung fuer den englischen Namen liefert - ausdruecklich
# NICHT "Freitag" (echtes deutsches Wort, steht in der Sperrliste).
DEFAULT_ALIASES = {"friday": ["Fraidei", "Fraidäi", "Freidei"]}

HARD_NEGATIVES = {
    "jarvis": ["Hey Charles", "Harvest", "Hey Davis", "Service", "Hey Travis", "Jahres", "Hey Chris", "Marvin",
               "Hey Janis", "Paris", "Carlos", "Garnix", "Hey Jakob", "Hier ja", "Hey, wie geht's"],
    "friday": ["Freitag", "Frieda", "Feierabend", "Hey Frida", "Fridolin", "Hey Freddy", "Fritten", "Hey Friedrich",
               "Sonntag", "Hey Frank", "Pfeiffer", "Hey, wie geht's", "Hier ist es frei", "Heute ist Freitag",
               "Hey du"],
}
GENERIC_NEGATIVES = ["Hey du", "Hallo zusammen", "Hey, wie geht's", "Okay, danke", "Bis gleich"]
COMMON_NAMES = ["Peter", "Martin", "Julia", "Sandra", "Thomas", "Nina", "Daniel", "Anna", "Felix", "Lena", "Markus",
                "Tobias", "Sabine", "Jonas", "Clara", "Moritz", "Paula", "Stefan", "Lukas", "Marie", "Jakob", "Frieda",
                "Erik", "Nora", "Tim", "Karl", "Hanna", "Ben", "Alex", "Emil", "Mia", "Oskar", "Greta", "Ralf",
                "Dennis", "Katja", "Ole", "Vera", "Simon", "Elena", "Jens", "Maja", "Kevin", "Linda", "Rolf"]
REJECT_WORDS = {"friday": ["Freitag", "Frieda", "Frida", "Feierabend", "Fridolin", "Friedrich", "Freddy"]}


def _nearest_names(word: str, n: int) -> list[str]:
    """Die n klangnaechsten Vornamen zu einem Wort (phonetische Editierdistanz)."""
    key = phonetic_key(word)
    ranked = sorted((c for c in COMMON_NAMES if phonetic_key(c) != key and fold(c) != fold(word)),
                    key=lambda c: (levenshtein(phonetic_key(c), key), c))
    return ranked[:n]


def _content_words(core: str) -> list[str]:
    return [w for w in core.split(" ") if len(fold(w)) >= 3]


def hard_negatives(phrase: str, count: int = 15) -> list[str]:
    """Aehnlich klingende Gegenbeispiele, abgeleitet aus den Woertern der Phrase (auch ein einzelner Name geht).

    Bekannte Kernwoerter (Friday, Jarvis): feste Tabelle. Einwort-Kern: die klangnaechsten Vornamen. Mehrwort-Phrase:
    jedes Wort einzeln, Teilphrasen und die Phrase mit je einem Wort durch einen klangnahen Vornamen ersetzt - alles,
    was die Phrase fast, aber nicht ganz ist."""
    text = normalize_phrase(phrase)
    short = short_form(text)
    core = short or display_phrase(text)
    table = HARD_NEGATIVES.get(slugify(core))
    if table:
        return table[:count]
    greeting = display_phrase(text).split(" ")[0] if short else "Hey"
    positives = {fold(display_phrase(text)), fold(core)}
    out: list[str] = []
    cwords = core.split(" ")
    if len(cwords) == 1:
        near = _nearest_names(core, count - len(GENERIC_NEGATIVES))
        out = [f"{greeting} {n}" if i % 2 == 0 else n for i, n in enumerate(near)]
    else:
        out += [w for w in cwords if len(fold(w)) >= 3]
        if len(cwords) >= 3:
            out += [" ".join(cwords[:-1]), " ".join(cwords[1:])]
        for i, w in enumerate(cwords):
            if len(fold(w)) < 3:
                continue
            for n in _nearest_names(w, 2):
                replaced = " ".join(cwords[:i] + [n] + cwords[i + 1:])
                out.append(f"{greeting} {replaced}" if short else replaced)
    seen, result = set(), []
    for item in out:
        key = fold(item)
        if key and key not in positives and key not in seen:
            seen.add(key)
            result.append(item)
    return (result[:count - len(GENERIC_NEGATIVES)] + GENERIC_NEGATIVES)[:count]


def default_aliases(phrase: str) -> list[str]:
    text = normalize_phrase(phrase)
    return list(DEFAULT_ALIASES.get(slugify(short_form(text) or text), []))


def default_reject_words(phrase: str) -> list[str]:
    """Aehnliche, aber falsche Woerter, die Stufe 2 nie als Treffer zaehlt: feste Tabelle (Friday) oder die Vornamen, die
    der unscharfe Vergleich sonst fuer ein Wort der Phrase akzeptieren wuerde."""
    text = normalize_phrase(phrase)
    core = short_form(text) or text
    table = REJECT_WORDS.get(slugify(core))
    if table:
        return list(table)
    out: list[str] = []
    for word in _content_words(core):
        key = phonetic_key(word)
        limit = allowed_distance(len(key))
        out += [n for n in COMMON_NAMES if phonetic_key(n) != key and fold(n) != fold(word)
                and levenshtein(phonetic_key(n), key) <= limit]
    return list(dict.fromkeys(out))


def _word_options(tokens: list[str], i: int, target_key: str, limit: int, reject_keys: set[str]) -> list[tuple[int, int]]:
    """(verbrauchte Tokens, Distanz) fuer ein Zielwort ab Token i; 1-3 Tokens werden zusammengezogen ("fri day")."""
    options = []
    for span in (1, 2, 3):
        if i + span > len(tokens):
            break
        key = phonetic_key("".join(tokens[i:i + span]))
        if not key or key in reject_keys:
            continue
        dist = levenshtein(key, target_key)
        if dist <= limit:
            options.append((span, dist))
    return options


def _align(tokens, i, keys, limits, reject_keys, skips, first=True):
    """Kleinste Gesamtdistanz (und Ende), mit der die Zielwoerter `keys` ab Token i lueckenlos hintereinander stehen.
    Das erste Zielwort darf fehlen (Whisper verschluckt oft den Anfang), solange `skips` > 0 ist (Distanz +1); die
    folgenden nie. None, wenn es keine Zuordnung gibt."""
    if not keys:
        return 0, i
    best = None
    for span, dist in _word_options(tokens, i, keys[0], limits[0], reject_keys):
        rest = _align(tokens, i + span, keys[1:], limits[1:], reject_keys, skips, first=False)
        if rest is not None and (best is None or dist + rest[0] < best[0]):
            best = (dist + rest[0], rest[1])
    if first and skips > 0:
        rest = _align(tokens, i, keys[1:], limits[1:], reject_keys, skips - 1)
        if rest is not None and (best is None or rest[0] + 1 < best[0]):
            best = (rest[0] + 1, rest[1])
    return best


def phrase_matches(transcript: str, phrase: str, aliases=(), reject=(), max_dist: int | None = None):
    """Stufe 2: steht die Wake Phrase (oder ihre Kurzform bzw. ein Alias) im Transkript?

    Rueckgabe (treffer, text, distanz). Die Woerter der Phrase muessen der Reihe nach unmittelbar hintereinander
    vorkommen; je Wort gilt eine kleine Editierdistanz auf der phonetischen Normalform (`allowed_distance`, oder
    `max_dist`), so dass kleine Transkriptionsfehler ("Hay Fraidei") nichts ausmachen. Bei Phrasen mit mindestens drei
    Woertern darf das erste Wort fehlen, das letzte nie. `reject`: aehnliche, aber falsche Woerter (z. B. "Freitag"), die nie zaehlen.
    Eine Phrase mit Grusswort gilt auch ohne es ("Friday" statt "Hey Friday"): Stufe 1 hat auch die Kurzform gelernt."""
    text = normalize_phrase(phrase)
    targets = [text.split(" ")]
    short = short_form(text)
    if short:
        targets.append(short.split(" "))
    for alias in aliases:
        words = normalize_phrase(alias).split(" ") if fold(alias) else []
        if words:
            targets.append(words)
    all_keys = {phonetic_key(w) for t in targets for w in t}
    reject_keys = {phonetic_key(r) for r in reject if fold(r)} - all_keys
    tokens = [fold(w) for w in re.findall(r"[^\W\d_]+", (transcript or "").lower())]
    tokens = [t for t in tokens if t]
    best = (False, "", 99)
    for words in targets:
        keys = [phonetic_key(w) for w in words]
        if not all(keys):
            continue
        limits = [allowed_distance(len(k)) if max_dist is None else max_dist for k in keys]
        skips = 1 if len(keys) >= 3 else 0
        for i in range(len(tokens)):
            found = _align(tokens, i, keys, limits, reject_keys, skips)
            if found is not None and found[0] < best[2]:
                best = (True, " ".join(tokens[i:found[1]]), found[0])
    return best


def name_matches(transcript: str, name: str, aliases=(), reject=(), max_dist: int | None = None):
    """Wie `phrase_matches`, fuer ein einzelnes Wort bzw. einen Namen als Phrase (Kompatibilitaet)."""
    return phrase_matches(transcript, name, aliases, reject, max_dist)


# ------------------------------------------------------------------------------------------------ Audio-Helfer


def voiced_bounds(audio: np.ndarray, frame: int = 320, rel_db: float = -28.0, floor: float = 0.004):
    """(start_s, end_s) des laengsten zusammenhaengenden Sprachbereichs; None, wenn nichts Hoerbares da ist."""
    n = len(audio) // frame
    if n < 2:
        return None
    rms = np.sqrt(np.mean(audio[:n * frame].reshape(n, frame) ** 2, axis=1))
    thresh = max(floor, float(np.percentile(rms, 98)) * 10 ** (rel_db / 20))
    idx = np.where(rms > thresh)[0]
    if len(idx) == 0:
        return None
    groups, start, prev = [], idx[0], idx[0]
    for i in idx[1:]:
        if (i - prev) * frame / SR > 0.25:  # Luecken < 250 ms (Wortmitte) ueberbruecken
            groups.append((start, prev))
            start = i
        prev = i
    groups.append((start, prev))
    s, e = max(groups, key=lambda g: g[1] - g[0])
    return s * frame / SR, (e + 1) * frame / SR


def segment_for_word(frame_count: int, bounds, lead: float = 0.2, tail: float = 0.1, min_frames: int = 4):
    """Frame-Bereich [ks, ke] der Embeddings, der das Wort abdeckt. Frame k endet bei (k+1)*80 ms."""
    t0, t1 = bounds
    ks = max(0, int(round((t0 + lead) / FRAME_S)) - 1)
    ke = min(frame_count - 1, int(round((t1 + tail) / FRAME_S)) - 1)
    ke = max(ke, min(frame_count - 1, ks + min_frames - 1))
    ks = max(0, min(ks, ke - min_frames + 1))
    return ks, ke


# ------------------------------------------------------------------------------------------------ Fenstermodell


def window_matrix(rows: np.ndarray, length: int, n: int, ends: np.ndarray) -> np.ndarray:
    """Fenster aus je n Frames, die bei `ends` enden, linear auf `length` Frames normiert -> (M, length, D)."""
    pos = (ends[:, None] - n + 1) + np.linspace(0, n - 1, length)[None, :]
    lo = np.floor(pos).astype(int)
    hi = np.minimum(lo + 1, len(rows) - 1)
    w = (pos - lo)[..., None].astype(np.float32)
    return rows[lo] * (1 - w) + rows[hi] * w


def scale_len(length: int, scale: float) -> int:
    return max(3, int(round(length * scale)))


class WindowModel:
    """Je Gruppe ("hey" = "Hey <Name>", "bare" = "<Name>") ein linearer Klassifikator ueber ein normiertes
    Embedding-Fenster (L x 96). Score = hoechster Logit ueber Gruppen und Zeitstreckungen (SCALES)."""

    def __init__(self, mu: np.ndarray, sd: np.ndarray, groups: dict[str, dict], scales=SCALES):
        self.mu = mu.astype(np.float32)
        self.sd = sd.astype(np.float32)
        self.scales = tuple(float(s) for s in scales)
        self.groups = {k: {"length": int(g["length"]), "w": np.asarray(g["w"], dtype=np.float32),
                           "b": float(g["b"])} for k, g in groups.items()}

    @property
    def max_window(self) -> int:
        return max(scale_len(g["length"], max(self.scales)) for g in self.groups.values())

    def window_scores(self, rows: np.ndarray, ends: np.ndarray) -> np.ndarray:
        """Logit je Endposition (hoechster ueber Gruppen/Streckungen); Fenster ausserhalb der Zeile zaehlen nicht."""
        best = np.full(len(ends), -1e9, dtype=np.float32)
        z = (rows - self.mu) / self.sd
        for g in self.groups.values():
            for s in self.scales:
                n = scale_len(g["length"], s)
                ok = ends >= n - 1
                if not ok.any():
                    continue
                x = window_matrix(z, g["length"], n, ends[ok]).reshape(int(ok.sum()), -1)
                best[ok] = np.maximum(best[ok], x @ g["w"] + g["b"])
        return best

    def score_live(self, rows: np.ndarray) -> float:
        """Score fuer das juengste Fenster (letzte Zeile von rows)."""
        return float(self.window_scores(rows, np.array([len(rows) - 1]))[0])

    def peak(self, rows: np.ndarray, start: int = 0) -> float:
        """Hoechster Score beim Streamen; rows[:start] = Einschwingphase (Positionen < start zaehlen nicht)."""
        ends = np.arange(start, len(rows))
        return float(self.window_scores(rows, ends).max()) if len(ends) else -1e9

    def save(self, path: str) -> None:
        arrays = {"mu": self.mu, "sd": self.sd, "scales": np.array(self.scales, dtype=np.float32),
                  "names": np.array(list(self.groups))}
        for i, g in enumerate(self.groups.values()):
            arrays[f"w_{i}"] = g["w"]
            arrays[f"b_{i}"] = np.array(g["b"])
            arrays[f"length_{i}"] = np.array(g["length"])
        np.savez_compressed(path, **arrays)

    @classmethod
    def load(cls, path: str) -> "WindowModel":
        z = np.load(path, allow_pickle=False)
        groups = {str(n): {"length": int(z[f"length_{i}"]), "w": z[f"w_{i}"], "b": float(z[f"b_{i}"])}
                  for i, n in enumerate(z["names"])}
        return cls(z["mu"], z["sd"], groups, tuple(z["scales"]))


class Clip:
    """Embedding-Zeilen eines Clips; rows[start:] gehoeren zum Clip, davor Einschwing-Rauschen.

    bounds = (start_s, end_s) der Sprache bei Positiven (dann gilt [ks, ke] als Wortbereich); None bei Negativen.
    weight: Gewicht im Training (eigene Aufnahmen 3, mit Piper synthetisierte Zusatzbeispiele 1).
    """

    def __init__(self, rows: np.ndarray, start: int, bounds=None, weight: float = 1.0):
        self.rows, self.start, self.ks, self.ke, self.weight = rows, start, None, None, weight
        if bounds:
            ks, ke = segment_for_word(len(rows) - start, bounds)
            self.ks, self.ke = ks + start, ke + start


NEG_SKIP = 4  # Frames rund um das Wortende, die weder als Positiv noch als Negativ zaehlen


def _train_group(pos: list[Clip], negs: list[Clip], length: int, mu, sd, scales, c: float):
    from sklearn.linear_model import LogisticRegression
    xs, ys, ws = [], [], []
    for clip in pos:
        z = (clip.rows - mu) / sd
        for s in scales:
            n = scale_len(length, s)
            ends = np.array([e for e in (clip.ke - 1, clip.ke, clip.ke + 1) if n - 1 <= e < len(z)])
            if len(ends):
                xs.append(window_matrix(z, length, n, ends).reshape(len(ends), -1))
                ys += [1] * len(ends)
                ws += [clip.weight] * len(ends)
    for clip in pos + negs:
        z = (clip.rows - mu) / sd
        for s in scales:
            n = scale_len(length, s)
            ends = np.arange(max(clip.start + 8, n - 1), len(z))
            if clip.ke is not None:
                ends = ends[np.abs(ends - clip.ke) >= NEG_SKIP]
            if len(ends):
                xs.append(window_matrix(z, length, n, ends).reshape(len(ends), -1))
                ys += [0] * len(ends)
                ws += [clip.weight] * len(ends)
    x, y, w = np.concatenate(xs), np.array(ys), np.array(ws)
    # Klassen nach Gesamtgewicht ausgleichen (Negative sind in der Ueberzahl)
    w = w * np.where(y == 1, 0.5 * w.sum() / w[y == 1].sum(), 0.5 * w.sum() / w[y == 0].sum())
    model = LogisticRegression(C=c, max_iter=3000).fit(x, y, sample_weight=w / w.mean())
    return model.coef_[0].astype(np.float32), float(model.intercept_[0])


def train_window_model(hey: list[Clip], bare: list[Clip], negs: list[Clip], c: float = 0.1,
                       scales=SCALES) -> WindowModel:
    """Trainiert die Gruppen-Klassifikatoren. Positive = Fenster am Wortende (+-1 Frame, 3 Streckungen),
    Negative = alle uebrigen Fenster aller Clips (Gegenbeispiele, Lesetexte, Zwischenraeume der Positiven)."""
    allrows = np.concatenate([cl.rows[cl.start:] for cl in hey + bare + negs])
    mu, sd = allrows.mean(axis=0), allrows.std(axis=0) + 1e-3
    groups = {}
    for name, pos in (("hey", hey), ("bare", bare)):
        if not pos:
            continue
        length = max(4, int(np.median([cl.ke - cl.ks + 1 for cl in pos])))
        others = [cl for cl in hey + bare if cl not in pos]
        w, b = _train_group(pos, negs + others, length, mu, sd, scales, c)
        groups[name] = {"length": length, "w": w, "b": b}
    return WindowModel(mu, sd, groups, scales)


def calibrate_threshold(pos: list[float], words: list[float], speech: list[float]) -> dict:
    """Schwelle (Logit) aus den Spitzenwerten ungesehener Clips (Kreuzvalidierung).

    pos = Positive, words = aehnlich klingende Gegenbeispiele, speech = Lesetext-Segmente (Alltagssprache).
    Ziel: ~90 % der eigenen Aufrufe bei hoechstens ~10 % der 5-s-Lesetext-Segmente (Alltagssprache). Aehnliche
    Woerter duerfen durchrutschen -
    sie fangen Stufe 2 (Whisper-Namenscheck) und die Sprecherpruefung ab; ein verpasstes Wake Word merkt der Nutzer
    dagegen sofort.
    """
    p, w, sp = np.asarray(pos, float), np.asarray(words, float), np.asarray(speech, float)
    p10 = float(np.percentile(p, 10))
    speech_max = float(sp.max()) if len(sp) else -1e9
    speech_p90 = float(np.percentile(sp, 90)) if len(sp) else -1e9
    words_max = float(w.max()) if len(w) else -1e9
    if p10 > max(speech_max, words_max):
        thr, quality = (max(speech_max, words_max) + p10) / 2, "gut"      # saubere Trennung: Mitte der Luecke
    elif p10 >= speech_p90:
        thr, quality = p10, "mittel"                                      # Woerter koennen durchrutschen (Stufe 2)
    else:
        thr, quality = speech_p90, "schwach"                              # Ueberlappung mit Alltagssprache
    thr = max(thr, 0.0)
    return {"threshold": round(float(thr), 3), "quality": quality, "pos_p10": round(p10, 3),
            "pos_median": round(float(np.median(p)), 3), "speech_max": round(speech_max, 3),
            "speech_p90": round(speech_p90, 3),
            "words_max": round(words_max, 3), "frr_cv": round(float(np.mean(p < thr)), 3),
            "far_words_cv": round(float(np.mean(w >= thr)), 3) if len(w) else None,
            "far_speech_cv": round(float(np.mean(sp >= thr)), 3) if len(sp) else None}


def cross_validate(hey: list[Clip], bare: list[Clip], words: list[Clip], speech: list[Clip], folds: int = 4,
                   c: float = 0.1, extra: tuple[list[Clip], list[Clip], list[Clip]] = ([], [], [])) -> dict:
    """Ungesehene Spitzenwerte: je Fold auf den uebrigen Clips trainieren, den ausgelassenen Teil bewerten.
    `extra` (synthetische Positive hey/bare, Negative) wird in jedem Fold zusaetzlich zum Training verwendet."""
    pos_scores, word_scores, speech_scores = [], [], []
    for f in range(folds):
        def tr(items):
            return [x for i, x in enumerate(items) if i % folds != f]

        model = train_window_model(tr(hey) + extra[0], tr(bare) + extra[1], tr(words) + tr(speech) + extra[2], c=c)
        for i, clip in enumerate(hey + bare):
            if (i if i < len(hey) else i - len(hey)) % folds == f:
                pos_scores.append(model.peak(clip.rows, clip.start + 8))
        for i, clip in enumerate(words):
            if i % folds == f:
                word_scores.append(model.peak(clip.rows, clip.start + 8))
        for i, clip in enumerate(speech):
            if i % folds == f:
                speech_scores += segment_peaks(model, clip)
    return calibrate_threshold(pos_scores, word_scores, speech_scores)


def segment_peaks(model: WindowModel, clip: Clip, seg: int = 60, lead: int = 20) -> list[float]:
    """Spitzenwerte je ~5-s-Segment eines langen Clips (Annaeherung an Fehlausloesungen pro Zeit)."""
    out = []
    for s in range(clip.start + 8, len(clip.rows), seg):
        lo = max(0, s - lead)
        out.append(model.peak(clip.rows[lo:s + seg], s - lo))
    return out


# ------------------------------------------------------------------------------------------------ Synthetische Zusatzdaten


def augment(audio: np.ndarray, rng: np.random.Generator, place: bool = True, total: float = 2.0) -> np.ndarray:
    """Tempo/Tonhoehe (Resampling), Raumhall, Lautstaerke, Rauschen; optional in einen 2-s-Clip gelegt (wie die
    Enrollment-Aufnahmen). Wird fuer die Piper-Zusatzbeispiele und den synthetischen Benchmark benutzt."""
    from scipy.signal import fftconvolve, resample_poly
    factor = float(rng.uniform(0.93, 1.07))
    audio = resample_poly(audio, 1000, int(round(1000 * factor))).astype(np.float32)
    if rng.random() < 0.4:
        t = np.arange(int(0.25 * SR)) / SR
        ir = rng.standard_normal(len(t)) * np.exp(-t / rng.uniform(0.04, 0.12))
        ir[0] = 1.0
        audio = fftconvolve(audio, ir / np.abs(ir).sum() * 2.5)[:len(audio) + 2000].astype(np.float32)
    audio = audio / (np.max(np.abs(audio)) + 1e-9) * float(rng.choice([0.15, 0.35, 0.6, 0.9]))
    n = int(total * SR) if place else len(audio) + SR
    clip = np.zeros(n, dtype=np.float32)
    off = int(rng.uniform(0.15, 0.7) * SR) if place else int(0.3 * SR)
    seg = audio[:max(0, n - off)]
    clip[off:off + len(seg)] += seg
    snr = float(rng.choice([35, 25, 18, 12]))
    sig_rms = float(np.sqrt(np.mean(audio ** 2))) + 1e-9
    noise = np.convolve(rng.standard_normal(n).astype(np.float32), np.ones(4) / 4, mode="same")
    clip += noise * (sig_rms / 10 ** (snr / 20)) / (np.std(noise) + 1e-9)
    return np.clip(clip, -1, 1).astype(np.float32)


class PiperSynth:
    """Sprecht Texte mit einer lokalen Piper-Stimme (Tempo/Variation zufaellig) -> float32, 16 kHz."""

    def __init__(self, voice_path: str):
        from piper import PiperVoice
        self.voice = PiperVoice.load(voice_path)
        self.stem = os.path.splitext(os.path.basename(voice_path))[0]

    def say(self, text: str, rng: np.random.Generator) -> np.ndarray:
        from piper import SynthesisConfig
        from scipy.signal import resample_poly
        cfg = SynthesisConfig(length_scale=float(rng.uniform(0.85, 1.2)), noise_scale=float(rng.uniform(0.5, 0.8)),
                              noise_w_scale=float(rng.uniform(0.6, 0.9)))
        audio = np.concatenate([c.audio_float_array for c in self.voice.synthesize(text, syn_config=cfg)])
        sr = self.voice.config.sample_rate
        return (resample_poly(audio, SR, sr) if sr != SR else audio).astype(np.float32)


def synthetic_clips(synth: PiperSynth, embedder: "ClipEmbedder", phrase: str, sentences: list[str],
                    rng: np.random.Generator, n_hey: int = 40, n_bare: int = 30) -> tuple[list, list, list]:
    """Zusatzbeispiele aus der Piper-Stimme: Positive (Phrase und, falls vorhanden, Kurzform), Negative (aehnliche
    Woerter + Saetze). Gewicht 1 (eigene Aufnahmen zaehlen dreifach). Rueckgabe (hey, bare, negs) als Clip-Listen.
    Ohne Kurzform (Phrase ohne Grusswort) entstehen alle Positive aus der Phrase."""
    def embed(audio, positive):
        rows, start = embedder.embed(audio, rng)
        bounds = voiced_bounds(audio) if positive else None
        return Clip(rows, start, bounds, weight=1.0) if (bounds or not positive) else None

    full, short = display_phrase(phrase), short_form(phrase)
    if not short:
        n_hey, n_bare = n_hey + n_bare, 0
    hey = [embed(augment(synth.say(full, rng), rng), True) for _ in range(n_hey)]
    bare = [embed(augment(synth.say(short, rng), rng), True) for _ in range(n_bare)]
    negs = [embed(augment(synth.say(w, rng), rng), False) for w in hard_negatives(phrase) * 3]
    negs += [embed(augment(synth.say(t, rng), rng, place=False), False) for t in sentences]
    return [c for c in hey if c], [c for c in bare if c], negs


def enrollment_blocks(phrase: str) -> list[tuple[str, str, list[tuple[str, int]]]]:
    """Aufnahmeplan der Wake-Word-Samples: (Ordnername, Text, [(Variante, Anzahl)]). Block `wake_<slug der Phrase>`; mit
    Kurzform zusaetzlich `wake_<slug der Kurzform>` (26 + 18 Aufnahmen), ohne Kurzform bekommt die Phrase alle Aufnahmen."""
    text, short = display_phrase(phrase), short_form(phrase)
    full_phases = [("normal, ca. 50 cm vom Laptop", 8), ("leise", 4), ("laut / bestimmt", 4),
                   ("ca. 1-2 m entfernt (aufstehen oder zuruecklehnen)", 6), ("schnell/beilaeufig, wie im Alltag", 4)]
    if not short:
        extra = [("normal, aus dem Alltag heraus", 8), ("leise oder aus 1-2 m", 6),
                 (f"fragend, z. B. '{text}?'", 4)]
        return [(f"wake_{phrase_slug(text)}", text, full_phases + extra)]
    return [
        (f"wake_{phrase_slug(text)}", text, full_phases),
        (f"wake_{phrase_slug(short)}", short, [("normal", 8), ("leise oder aus 1-2 m", 6),
                                                (f"fragend, z. B. '{short}?'", 4)]),
    ]


# ------------------------------------------------------------------------------------------------ Embeddings & Live


class ClipEmbedder:
    """Streaming-Embeddings mit denselben openWakeWord-Modellen wie im Live-Betrieb."""

    def __init__(self, melspec_path: str, embedding_path: str):
        from openwakeword.utils import AudioFeatures
        self.features = AudioFeatures(melspec_model_path=melspec_path, embedding_model_path=embedding_path,
                                      inference_framework="onnx")

    def embed(self, audio: np.ndarray, rng: np.random.Generator | None = None) -> tuple[np.ndarray, int]:
        """audio float32 [-1, 1] -> (rows, start). rows[start:] gehoeren zum Clip, davor Einschwing-Rauschen."""
        rng = rng or np.random.default_rng(0)
        noise_rms = float(np.sqrt(np.mean(audio[:2400] ** 2))) if len(audio) >= 2400 else 0.0
        pre = (rng.standard_normal(PREROLL_CHUNKS * CHUNK) * min(noise_rms, 0.02)).astype(np.float32)
        pad = (-len(audio)) % CHUNK
        sig = np.concatenate([pre, audio.astype(np.float32), np.zeros(pad, dtype=np.float32)])
        pcm = np.clip(sig * 32768.0, -32768, 32767).astype(np.int16)
        self.features.reset()
        rows = []
        for i in range(0, len(pcm), CHUNK):
            self.features(pcm[i:i + CHUNK])
            rows.append(self.features.feature_buffer[-1].copy())
        return np.stack(rows).astype(np.float32), PREROLL_CHUNKS


class PersonalWakeDetector:
    """Live: Chunk (1280 int16) rein, Score (Logit) raus. Schnittstelle wie `Model.predict`, plus `reset()`."""

    def __init__(self, model: WindowModel, melspec_path: str, embedding_path: str):
        self.model = model
        self.features = ClipEmbedder(melspec_path, embedding_path).features
        self.seen = 0

    def reset(self) -> None:
        self.features.reset()
        self.seen = 0

    def predict(self, chunk: np.ndarray) -> float:
        self.features(chunk)
        self.seen += 1
        if self.seen <= PREROLL_CHUNKS:
            return -1e9
        valid = min(self.seen - PREROLL_CHUNKS, self.model.max_window)
        return self.model.score_live(self.features.feature_buffer[-valid:])


def _config_value(config_dir: str, key: str, valid) -> str | None:
    """Erster gueltiger Wert von `key` aus voice.json, dann persona.json (gleiche Quellen wie der Installer)."""
    for fname in ("voice.json", "persona.json"):
        try:
            with open(os.path.join(config_dir, fname), encoding="utf-8-sig") as f:
                value = (json.load(f).get(key) or "").strip()
        except (OSError, ValueError, AttributeError):
            continue
        if valid(value):
            return value
    return None


def resolve_assistant_name(config_dir: str, default: str = "Friday") -> str:
    """assistant_name aus config/voice.json bzw. persona.json (gleiche Quelle wie der Installer), sonst Standard."""
    value = _config_value(config_dir, "assistant_name", valid_name)
    return display_name(value) if value else default


def resolve_wake_phrase(config_dir: str, default_name: str = "Friday") -> str:
    """wake_phrase aus config/voice.json bzw. persona.json; fehlt sie (Installation vor der freien Wake Phrase), gilt
    "Hey <Name>"."""
    value = _config_value(config_dir, "wake_phrase", valid_phrase)
    return display_phrase(value) if value else wake_phrase(resolve_assistant_name(config_dir, default_name))


def load_meta(json_path: str) -> dict:
    with open(json_path, encoding="utf-8-sig") as f:
        return json.load(f)


def save_meta(json_path: str, meta: dict) -> None:
    os.makedirs(os.path.dirname(json_path), exist_ok=True)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
