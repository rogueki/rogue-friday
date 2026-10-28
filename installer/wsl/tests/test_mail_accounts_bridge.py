#!/usr/bin/env python3
"""Prueft die Mehrkonten-Bruecke mail_accounts.py ohne echten Mailserver.

Alle IMAP-/SMTP-Aufrufe laufen gegen kleine Fakes; der Test belegt das Verhalten,
das DASH-05.04 verlangt: Lesen ohne \\Seen-Markierung, UIDVALIDITY-Abgleich,
UTF-8 und Anhaenge, Entwuerfe und Sent-Kopie, Alias als Absender, einmaliger
Versand und "unbekannt" statt Wiederholung.
"""
import base64
import email
from email import policy
import importlib.util
import io
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "mail_accounts.py")

if "fcntl" not in sys.modules:
    shim = types.ModuleType("fcntl")
    shim.LOCK_EX = 2
    shim.flock = lambda *args, **kwargs: None
    sys.modules["fcntl"] = shim

spec = importlib.util.spec_from_file_location("mail_accounts_bridge", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

ACCOUNT = {
    "id": "work", "displayName": "Geschaeft", "email": "erik@beispiel.example", "senderName": "Erik Brandt",
    "aliases": ["info@beispiel.example"], "signature": "Viele Gruesse", "revision": 2,
    "imapHost": "imap.beispiel.example", "imapPort": 993, "imapSecurity": "tls", "imapLogin": "erik@beispiel.example",
    "smtpHost": "smtp.beispiel.example", "smtpPort": 587, "smtpSecurity": "start-tls",
    "smtpLogin": "erik@beispiel.example", "sentFolder": "Sent", "draftsFolder": "Drafts",
    "trashFolder": "Trash", "archiveFolder": "Archive", "spamFolder": "Spam",
    "authMode": "password", "oauthClientId": "", "oauthTenant": "",
}
module.load = lambda: {"revision": 2, "defaultAccountId": "work", "accounts": [ACCOUNT]}

HEADER = (b"Subject: =?utf-8?q?Gr=C3=BC=C3=9Fe?=\r\nFrom: Erik <erik@beispiel.example>\r\n"
          b"Date: Thu, 22 Oct 2026 10:00:00 +0000\r\nMessage-ID: <abc@beispiel.example>\r\n\r\n")


class FakeImap:
    def __init__(self, uidvalidity="42", existing=(), move_supported=True, append_ok=True):
        self.uidvalidity = uidvalidity
        self.existing = existing
        self.move_supported = move_supported
        self.append_ok = append_ok
        self.selects = []
        self.fetches = []
        self.appended = []
        self.commands = []
        self.capabilities = ("MOVE",) if move_supported else ("IMAP4rev1",)

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def list(self):
        return ("OK", [b'(\\HasNoChildren \\Sent) "/" "Sent"', b'(\\HasNoChildren \\Drafts) "/" "Drafts"',
                       b'(\\HasNoChildren) "/" "INBOX"', b'(\\HasNoChildren \\Trash) "/" "Trash"',
                       b'(\\HasNoChildren \\Archive) "/" "Archive"'])

    def select(self, mailbox, readonly=True):
        self.selects.append((mailbox, readonly))
        return ("OK", [b"1"])

    def response(self, key):
        assert key == "UIDVALIDITY"
        return ("UIDVALIDITY", [self.uidvalidity.encode()])

    def uid(self, command, *args):
        self.commands.append((command, args))
        if command == "search":
            return ("OK", [b" ".join(self.existing)])
        if command == "fetch":
            self.fetches.append(args)
            return ("OK", [(b"1 (FLAGS (\\Seen))", HEADER)])
        return ("OK", [b""])

    def append(self, folder, flags, date, payload):
        if not self.append_ok:
            return ("NO", [b"append failed"])
        self.appended.append((folder, flags, payload))
        return ("OK", [b""])


class FakeSmtp:
    def __init__(self, refused=None):
        self.refused = refused or {}
        self.sent = []

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def sendmail(self, sender, recipients, payload):
        self.sent.append((sender, list(recipients), payload))
        return dict(self.refused)


def use_imap(**options):
    fake = FakeImap(**options)
    module.imap = lambda _account: fake
    return fake


def use_smtp(**options):
    fake = FakeSmtp(**options)
    module.smtp = lambda _account: fake
    return fake


def new_message(**overrides):
    message = {"to": ["empfaenger@beispiel.example"], "from": "erik@beispiel.example", "subject": "Grüße aus München 🚀",
               "body": "Hallo Welt\nZeile zwei mit Ümlauten und ß.",
               "messageId": "<friday-" + "a" * 64 + "@friday.local>",
               "attachments": [{"filename": "Prüfbericht März.txt",
                               "data": base64.b64encode("Prüfinhalt März".encode()).decode()}]}
    message.update(overrides)
    return message


def expect_error(expected, function, *args):
    try:
        function(*args)
    except (ValueError, RuntimeError, KeyError) as error:
        assert str(error).strip("'\"") == expected, f"{error!r} statt {expected!r}"
        return
    raise AssertionError(f"Fehler {expected} blieb aus")


# 1. Lesen markiert nichts als gelesen: select readonly und BODY.PEEK.
imap = use_imap()
listed = module.run({"action": "envelopes", "accountId": "work", "mailbox": "INBOX", "page": 1, "uidValidity": "42"})
assert listed["uidValidity"] == "42" and listed["page"] == 1, listed
assert imap.selects == [('"INBOX"', True)], imap.selects
assert all(any("BODY.PEEK" in part for part in args if isinstance(part, str)) for args in imap.fetches), imap.fetches
assert b"BODY[]" not in b"".join(str(args).encode() for args in imap.fetches)

imap = use_imap()
detail = module.run({"action": "message", "accountId": "work", "mailbox": "INBOX", "uid": "17", "uidValidity": "42"})
assert detail["subject"] == "Grüße", detail["subject"]
assert imap.selects == [('"INBOX"', True)], imap.selects
assert any("(BODY.PEEK[])" in args for args in imap.fetches), imap.fetches

# 2. UIDVALIDITY: ein veralteter Wert wird abgelehnt, statt eine falsche Nachricht zu liefern.
expect_error("uidvalidity_conflict", module.run, {"action": "message", "accountId": "work", "mailbox": "INBOX",
                                                  "uid": "17", "uidValidity": "41"})
expect_error("invalid_mailbox", module.run, {"action": "envelopes", "accountId": "work", "mailbox": "Gibt es nicht", "page": 1})

# 3. Aendern ist die einzige Aktion, die schreibend selektiert; Verschieben verlangt MOVE und ein Ziel.
imap = use_imap()
assert module.run({"action": "change", "accountId": "work", "mailbox": "INBOX", "uid": "17", "uidValidity": "42",
                   "kind": "move", "destination": "Archive"}) == {"changed": True}
assert imap.selects == [('"INBOX"', False)], imap.selects
assert imap.commands[-1] == ("MOVE", ("17", "Archive")), imap.commands[-1]
imap = use_imap(move_supported=False)
expect_error("imap_move_unsupported", module.run, {"action": "change", "accountId": "work", "mailbox": "INBOX", "uid": "17",
                                                    "uidValidity": "42", "kind": "move", "destination": "Archive"})
expect_error("invalid_destination", module.run, {"action": "change", "accountId": "work", "mailbox": "INBOX", "uid": "17",
                                                  "uidValidity": "42", "kind": "move", "destination": "Nirgendwo"})

# 4. Entwurf: UTF-8, Anhang, Alias als Absender, keine zweite Kopie bei gleicher Message-ID.
imap = use_imap()
first = module.run({"action": "draft", "accountId": "work",
                   "message": new_message(**{"from": "info@beispiel.example"})})
assert first == {"state": "drafted", "messageId": new_message()["messageId"], "alreadyPresent": False}, first
folder, flags, payload = imap.appended[0]
assert (folder, flags) == ("Drafts", "\\Draft"), (folder, flags)
built = email.message_from_bytes(payload, policy=policy.default)
assert built["subject"] == "Grüße aus München 🚀", built["subject"]
assert "Viele Gruesse" in built.get_body(preferencelist=("plain",)).get_content()
attachments = list(built.iter_attachments())
assert [item.get_filename() for item in attachments] == ["Prüfbericht März.txt"], attachments
assert attachments[0].get_payload(decode=True).decode("utf-8") == "Prüfinhalt März", attachments[0].get_payload()
assert built["from"] == "Erik Brandt <info@beispiel.example>", built["from"]

imap = use_imap(existing=(new_message()["messageId"].encode(),))
second = module.run({"action": "draft", "accountId": "work", "message": new_message()})
assert second["alreadyPresent"] is True and imap.appended == [], (second, imap.appended)

expect_error("invalid_sender", module.run, {"action": "draft", "accountId": "work",
                                             "message": new_message(**{"from": "fremd@beispiel.example"})})
expect_error("invalid_recipients", module.run, {"action": "send", "accountId": "work", "message": new_message(to=[])})
expect_error("invalid_message_id", module.run, {"action": "send", "accountId": "work",
                                                 "message": new_message(messageId="<frei@beispiel.example>")})

# 5. Versand: genau ein sendmail, Sent-Kopie mit \Seen, keine Wiederholung; Teilablehnung ist "unbekannt".
smtp = use_smtp()
imap = use_imap()
sent = module.run({"action": "send", "accountId": "work", "message": new_message()})
assert sent == {"state": "sent", "archivePending": False}, sent
assert len(smtp.sent) == 1 and smtp.sent[0][1] == ["empfaenger@beispiel.example"], smtp.sent
assert imap.appended and imap.appended[0][0] == "Sent" and imap.appended[0][1] == "\\Seen", imap.appended

smtp = use_smtp(refused={"empfaenger@beispiel.example": (550, b"mailbox full")})
imap = use_imap()
uncertain = module.run({"action": "send", "accountId": "work", "message": new_message()})
assert uncertain == {"state": "uncertain", "archivePending": True}, uncertain
assert len(smtp.sent) == 1, smtp.sent
assert imap.appended == [], imap.appended

smtp = use_smtp()
imap = use_imap(append_ok=False)
pending = module.run({"action": "send", "accountId": "work", "message": new_message()})
assert pending == {"state": "sent", "archivePending": True}, pending
assert len(smtp.sent) == 1, smtp.sent

# 6. Sent-Kopie wird nur einmal ergaenzt; ein vorhandenes Original bleibt unangetastet.
imap = use_imap(existing=(new_message()["messageId"].encode(),))
assert module.run({"action": "archive", "accountId": "work", "message": new_message()}) == {
    "state": "archived", "alreadyPresent": True}
assert imap.appended == [], imap.appended
imap = use_imap()
assert module.run({"action": "archive", "accountId": "work", "message": new_message()}) == {
    "state": "archived", "alreadyPresent": False}
assert imap.appended[0][:2] == ("Sent", "\\Seen"), imap.appended

# 7. Anhang lesen: Indexgrenzen und Groesse.
imap = use_imap()
expect_error("invalid_attachment", module.run, {"action": "attachment", "accountId": "work", "mailbox": "INBOX",
                                                "uid": "17", "uidValidity": "42", "index": 5})

# 8. Mehrere Konten bleiben getrennt: ein unbekanntes Konto wird nicht bedient.
expect_error("account_not_found", module.run, {"action": "check-imap", "accountId": "privat"})
expect_error("invalid_account", module.run, {"action": "check-imap", "accountId": "Gross Geschrieben"})

# 9. Kein Loeschpfad fuer Nachrichten oder Entwuerfe: die Bruecke kennt weder EXPUNGE noch \\Deleted,
#    markiert nur \\Flagged und legt Entwuerfe ausschliesslich per append ab.
source = io.open(SCRIPT, encoding="utf-8").read()
assert "EXPUNGE" not in source.upper(), "expunge gefunden"
assert "\\\\Deleted" not in source, "Deleted-Flag gefunden"
assert source.count('client.uid("store"') == 1, source.count('client.uid("store"')
assert '"+FLAGS.SILENT"' in source and "(\\\\Flagged)" in source
expect_error("invalid_action", module.run, {"action": "delete-message", "accountId": "work", "mailbox": "INBOX", "uid": "17"})

print("mail_accounts bridge: 25 Pruefungen bestanden")