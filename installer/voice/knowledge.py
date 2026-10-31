import json
import re
import threading
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().with_name("knowledge") / "friday-knowledge.json"

_STOPWORDS = {
    "ich", "du", "wie", "was", "wo", "wann", "warum", "kann", "man", "mein",
    "meine", "meinen", "der", "die", "das", "den", "dem", "ein", "eine",
    "einen", "und", "oder", "in", "im", "auf", "an", "zu", "mit", "fuer",
    "von", "ist", "sind", "es", "mir", "mich", "dir", "bei", "nicht", "wird",
    "werden", "soll", "sollte", "bitte", "mal", "denn", "da", "hier", "dort",
    "so", "auch", "noch", "nur", "jetzt", "friday", "ueber", "unter", "einer", "einem", "eines", "dein", "deine",
    "meinem", "meiner", "habe", "hat", "haben", "gibt", "geht", "tun", "etwas",
}
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def normalize_tokens(text: str) -> list[str]:
    lowered = text.lower()
    for source, target in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        lowered = lowered.replace(source, target)
    return [
        token
        for token in _TOKEN_RE.findall(lowered)
        if len(token) >= 3 and token not in _STOPWORDS
    ]


def _tokens_match(left: str, right: str) -> bool:
    if left == right:
        return True
    if len(left) < 5 or len(right) < 5:
        return False
    # German inflects at the end ("einstellen"/"einstellungen"): compare the shared stem, not a plain prefix.
    common = 0
    for first, second in zip(left, right):
        if first != second:
            break
        common += 1
    return common >= max(5, min(len(left), len(right)) - 3)


def _valid_section(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    for field in ("id", "file", "title", "area", "text"):
        if not isinstance(raw.get(field), str):
            return None
    keywords = raw.get("keywords")
    if not isinstance(keywords, list) or not all(isinstance(item, str) for item in keywords):
        return None
    return {
        "id": raw["id"],
        "file": raw["file"],
        "title": raw["title"],
        "area": raw["area"],
        "keywords": list(keywords),
        "text": raw["text"],
        "_keyword_tokens": [token for keyword in keywords for token in normalize_tokens(keyword)],
        "_title_tokens": normalize_tokens(raw["title"]),
        "_text_tokens": normalize_tokens(raw["text"]),
    }


class KnowledgeBase:
    def __init__(self, path: str | Path = DEFAULT_PATH):
        self._path = Path(path)
        self._sections: list[dict] | None = None
        self._lock = threading.Lock()

    def _ensure_loaded(self) -> None:
        if self._sections is not None:
            return
        with self._lock:
            if self._sections is not None:
                return
            sections: list[dict] = []
            try:
                with self._path.open("r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, ValueError):
                data = None
            if isinstance(data, dict):
                raw_sections = data.get("sections")
                if isinstance(raw_sections, list):
                    for raw in raw_sections:
                        section = _valid_section(raw)
                        if section is not None:
                            sections.append(section)
            self._sections = sections

    def search(self, question: str, limit: int = 3) -> list[dict]:
        self._ensure_loaded()
        if limit <= 0 or not isinstance(question, str):
            return []
        tokens = normalize_tokens(question)
        if not tokens:
            return []
        scored = []
        for index, section in enumerate(self._sections):
            score = 0
            for token in tokens:
                if any(_tokens_match(token, keyword) for keyword in section["_keyword_tokens"]):
                    score += 3
                if any(_tokens_match(token, title) for title in section["_title_tokens"]):
                    score += 2
                if any(_tokens_match(token, body) for body in section["_text_tokens"]):
                    score += 1
            if score >= 3:
                scored.append((score, index, section))
        if not scored:
            return []
        scored.sort(key=lambda item: (-item[0], item[1]))
        best = scored[0][0]
        results = []
        for score, _index, section in scored:
            if score * 2 < best:
                continue
            results.append(
                {
                    "titel": section["title"],
                    "text": section["text"],
                    "quelle": f"{section['file']} › {section['title']}",
                    "bereich": section["area"],
                }
            )
            if len(results) >= limit:
                break
        return results

    def overview(self) -> str:
        self._ensure_loaded()
        titles = [
            section["title"]
            for section in self._sections
            if section["area"].startswith("seite:")
        ]
        return ", ".join(titles)[:600]