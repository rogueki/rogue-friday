"""Removes secret values from text before it is spoken."""

import re

MASK = "(Geheimwert ausgeblendet)"

# "ist" is deliberately not a separator: "der Token ist abgelaufen" is a normal sentence.
# Markdown emphasis characters may sit between the keyword and the separator ("**Passwort**: x").
_LABELED_SECRET = re.compile(
    r"\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|bot[ _-]?token|token|client[ _-]?secret"
    r"|secret|passwort|password|kennwort|app[ _-]?passwort|pin)\b"
    r"([*_`]*\s*(?:[:=]|lautet|heißt|heisst)\s*[*_`]*\s*)"
    r"(\"[^\"]*\"|'[^']*'|\S+)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE)
_KNOWN_KEY_FORMATS = [
    re.compile(pattern)
    for pattern in (
        r"\bsk-[A-Za-z0-9_-]{16,}",
        r"\bgh[pousr]_[A-Za-z0-9]{20,}",
        r"\bgithub_pat_[A-Za-z0-9_]{20,}",
        r"\bxox[abprs]-[A-Za-z0-9-]{10,}",
        r"\bAKIA[0-9A-Z]{16}\b",
        r"\b\d{6,12}:[A-Za-z0-9_-]{30,}",
        r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}",
    )
]
_LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{32,}(?![A-Za-z0-9+/=_-])")


def _mask_random_string(match: re.Match) -> str:
    word = match.group(0)
    # Long German compounds contain no digits and must stay readable.
    if any(c.isdigit() for c in word) and any(c.isalpha() for c in word):
        return MASK
    return word


def redact_secrets(text: str) -> str:
    if not text:
        return text
    text = _LABELED_SECRET.sub(lambda m: m.group(1) + m.group(2) + MASK, text)
    text = _BEARER.sub("Bearer " + MASK, text)
    for pattern in _KNOWN_KEY_FORMATS:
        text = pattern.sub(MASK, text)
    return _LONG_TOKEN.sub(_mask_random_string, text)
