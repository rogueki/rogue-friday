#!/usr/bin/env python3
"""Prueft den Kandidaten-Verbindungstest in mail_accounts.py ohne echten Mailserver.

Der Test laedt das WSL-Skript auf Windows, indem er das nur unter Linux vorhandene
fcntl-Modul ersetzt. Netzwerk wird ausschliesslich gegen einen geschlossenen lokalen
Port benutzt; Erfolgs- und Fehlerpfade werden ueber einen ersetzten Verbindungsaufbau
geprueft. Kein Test sendet eine Nachricht oder speichert ein Konto.
"""
import importlib.util
import inspect
import os
import smtplib
import ssl
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "mail_accounts.py")

if "fcntl" not in sys.modules:
    shim = types.ModuleType("fcntl")
    shim.LOCK_EX = 2
    shim.flock = lambda *args, **kwargs: None
    sys.modules["fcntl"] = shim

spec = importlib.util.spec_from_file_location("mail_accounts_under_test", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

original_connection = module.candidate_connection


def draft(**overrides):
    account = {
        "displayName": "Testpostfach",
        "email": "test@beispiel.example",
        "senderName": "Test",
        "imapHost": "imap.beispiel.example",
        "imapPort": 993,
        "imapSecurity": "tls",
        "imapLogin": "test@beispiel.example",
        "smtpHost": "smtp.beispiel.example",
        "smtpPort": 587,
        "smtpSecurity": "start-tls",
        "smtpLogin": "test@beispiel.example",
    }
    account.update(overrides)
    return account


def expect_error(expected, function, *args):
    try:
        function(*args)
    except ValueError as error:
        assert str(error) == expected, f"{error!r} statt {expected!r}"
        return
    raise AssertionError(f"ValueError {expected} blieb aus")


# 1. Erfolg: der Verbindungsaufbau meldet sich sauber zurueck.
calls = []
module.candidate_connection = lambda account, password, protocol: calls.append((account["imapHost"], protocol, password))
result = module.check_candidate({"protocol": "imap", "account": draft(), "secrets": {"password": "geheim"}})
assert result == {"ok": True, "reason": "ok"}, result
assert calls == [("imap.beispiel.example", "imap", "geheim")], calls

# 2. Falsches Passwort, TLS-Fehler und Protokollfehler werden unterscheidbar gemeldet.
def raise_auth(*_args):
    raise smtplib.SMTPAuthenticationError(535, b"auth failed")


def raise_tls(*_args):
    raise ssl.SSLCertVerificationError("certificate verify failed")


def raise_protocol(*_args):
    raise smtplib.SMTPException("unexpected reply")


for raiser, reason in ((raise_auth, "auth"), (raise_tls, "tls"), (raise_protocol, "protocol")):
    module.candidate_connection = raiser
    outcome = module.check_candidate({"protocol": "smtp", "account": draft(), "secrets": {"password": "geheim"}})
    assert outcome == {"ok": False, "reason": reason}, (reason, outcome)

# 3. Netzwerkfehler: geschlossener lokaler Port, kein externer Verkehr.
module.candidate_connection = original_connection
outcome = module.check_candidate({"protocol": "imap", "account": draft(imapHost="127.0.0.1", imapPort=9,
                                                                      smtpHost="127.0.0.1", smtpPort=9),
                                  "secrets": {"password": "geheim"}})
assert outcome == {"ok": False, "reason": "network"}, outcome

# 4. Ungueltige Eingaben werden vor jedem Verbindungsversuch abgelehnt.
module.candidate_connection = lambda *args: (_ for _ in ()).throw(AssertionError("Verbindung trotz ungueltiger Eingabe"))
expect_error("invalid_protocol", module.check_candidate, {"protocol": "pop3", "account": draft(),
                                                          "secrets": {"password": "geheim"}})
expect_error("invalid_host", module.check_candidate, {"protocol": "imap", "account": draft(imapHost="bad host"),
                                                      "secrets": {"password": "geheim"}})
expect_error("invalid_secret", module.check_candidate, {"protocol": "imap", "account": draft(),
                                                        "secrets": {"password": ""}})
expect_error("invalid_secret", module.check_candidate, {"protocol": "imap", "account": draft(),
                                                        "secrets": {"password": "a\nb"}})
expect_error("invalid_port", module.check_candidate, {"protocol": "imap", "account": draft(imapPort=70000),
                                                      "secrets": {"password": "geheim"}})
expect_error("invalid_account", module.check_candidate, {"protocol": "imap", "account": None,
                                                         "secrets": {"password": "geheim"}})

# 5. Der echte Kandidatenaufbau kann keine Nachricht senden: kein sendmail, kein DATA-Schritt.
source = inspect.getsource(original_connection)
assert "sendmail" not in source and "send_message" not in source, source
assert "login(" in source and "ehlo" in source, source
for forbidden in ("sendmail", "send_message", "starttls(context=context)\n        client.login"):
    assert forbidden not in inspect.getsource(module.check_candidate), forbidden

print("mail_accounts check-candidate: 11 Pruefungen bestanden")