import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("mail_accounts", Path(__file__).with_name("mail_accounts.py"))
mail = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mail)
MESSAGE_ID = "<friday-" + "a" * 64 + "@friday.local>"


def profile(name):
    return {"id": "", "displayName": name, "email": f"{name.lower()}@example.test", "senderName": name,
            "aliases": [], "signature": "", "imapHost": "imap.example.test", "imapPort": 993,
            "imapSecurity": "tls", "imapLogin": name, "smtpHost": "smtp.example.test", "smtpPort": 465,
            "smtpSecurity": "tls", "smtpLogin": name, "sentFolder": "Sent", "draftsFolder": "Drafts",
            "trashFolder": "Trash", "archiveFolder": "Archive", "spamFolder": "Spam"}


class MailAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name) / "mail"
        self.patch_root = patch.object(mail, "ROOT", root)
        self.patch_manifest = patch.object(mail, "MANIFEST", root / "accounts.json")
        self.patch_root.start()
        self.patch_manifest.start()
        self.addCleanup(self.patch_root.stop)
        self.addCleanup(self.patch_manifest.stop)

    def test_two_accounts_keep_secrets_and_revisions_separate(self):
        first = mail.run({"action": "upsert", "account": profile("Work"),
                          "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        second = mail.run({"action": "upsert", "account": profile("Home"),
                           "secrets": {"imapPassword": "two", "smtpPassword": "send-two"}, "expectedRevision": None})
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(len(mail.run({"action": "list"})["accounts"]), 2)
        self.assertEqual(mail.secret_path(first["id"], "imapPassword").read_text(), "one\n")
        self.assertEqual(mail.secret_path(second["id"], "imapPassword").read_text(), "two\n")
        self.assertEqual(mail.secret_path(first["id"], "smtpPassword").stat().st_mode & 0o777, 0o600)
        self.assertNotIn("send-one", mail.MANIFEST.read_text())
        update = {**profile("Work"), "id": first["id"]}
        mail.run({"action": "upsert", "account": update, "secrets": {}, "expectedRevision": 1})
        self.assertEqual(mail.secret_path(first["id"], "imapPassword").read_text(), "one\n")
        with self.assertRaisesRegex(RuntimeError, "revision_conflict"):
            mail.run({"action": "upsert", "account": update, "secrets": {}, "expectedRevision": 1})

    def test_sent_archive_failure_is_not_retried_as_smtp_failure(self):
        account = mail.run({"action": "upsert", "account": profile("Work"),
                            "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        class FakeSmtp:
            calls = 0
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def sendmail(self, *_): self.calls += 1
        sender = FakeSmtp()
        with patch.object(mail, "smtp", return_value=sender), patch.object(mail, "imap", side_effect=OSError("offline")):
            result = mail.run({"action": "send", "accountId": account["id"],
                               "message": {"to": ["recipient@example.test"], "subject": "Test", "body": "Fixture", "messageId": MESSAGE_ID}})
        self.assertEqual(result, {"state": "sent", "archivePending": True})
        self.assertEqual(sender.calls, 1)

    def test_partial_smtp_acceptance_is_uncertain_without_archive_or_retry(self):
        account = mail.run({"action": "upsert", "account": profile("Work"),
                            "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        class PartialSmtp:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def sendmail(self, *_): return {"second@example.test": (550, b"rejected")}
        with patch.object(mail, "smtp", return_value=PartialSmtp()), patch.object(mail, "imap") as reader:
            result = mail.run({"action": "send", "accountId": account["id"],
                               "message": {"to": ["first@example.test", "second@example.test"],
                                           "subject": "Test", "body": "Fixture", "messageId": MESSAGE_ID}})
        self.assertEqual(result, {"state": "uncertain", "archivePending": True})
        reader.assert_not_called()

    def test_archive_only_dedupes_sent_message_id_without_smtp(self):
        account = mail.run({"action": "upsert", "account": profile("Work"),
                            "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        class FakeImap:
            def __init__(self): self.present = False; self.appends = 0
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def list(self): return "OK", [b'(\\Sent) "/" "Sent"']
            def select(self, *_, **__): return "OK", [b"0"]
            def response(self, _): return "UIDVALIDITY", [b"1"]
            def uid(self, *args): return "OK", [b"10" if self.present else b""]
            def append(self, *_): self.appends += 1; self.present = True; return "OK", [b"done"]
        reader = FakeImap()
        payload = {"action": "archive", "accountId": account["id"],
                   "message": {"to": ["recipient@example.test"], "subject": "Test",
                               "body": "Fixture", "messageId": MESSAGE_ID}}
        with patch.object(mail, "imap", return_value=reader), patch.object(mail, "smtp") as sender:
            self.assertEqual(mail.run(payload), {"state": "archived", "alreadyPresent": False})
            self.assertEqual(mail.run(payload), {"state": "archived", "alreadyPresent": True})
        self.assertEqual(reader.appends, 1)
        sender.assert_not_called()

    def test_change_requires_writable_selection_and_safe_move(self):
        account = mail.run({"action": "upsert", "account": profile("Work"),
                            "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        class FakeImap:
            capabilities = ("IMAP4REV1", "MOVE")
            def __init__(self): self.selected = [] ; self.commands = []
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def list(self): return "OK", [b'(\\HasNoChildren) "/" "Inbox"', b'(\\HasNoChildren) "/" "Archive"']
            def select(self, mailbox, readonly=True): self.selected.append(readonly); return "OK", [b"1"]
            def response(self, _): return "UIDVALIDITY", [b"9"]
            def uid(self, *args): self.commands.append(args); return "OK", [b"done"]
        client = FakeImap()
        with patch.object(mail, "imap", return_value=client):
            result = mail.run({"action": "change", "accountId": account["id"], "mailbox": "Inbox",
                               "uid": "42", "uidValidity": "9", "kind": "move", "destination": "Archive"})
        self.assertTrue(result["changed"])
        self.assertEqual(client.selected, [False])
        self.assertEqual(client.commands, [("MOVE", "42", "Archive")])
        client.capabilities = ("IMAP4REV1",)
        with patch.object(mail, "imap", return_value=client), self.assertRaisesRegex(RuntimeError, "imap_move_unsupported"):
            mail.run({"action": "change", "accountId": account["id"], "mailbox": "Inbox",
                      "uid": "42", "uidValidity": "9", "kind": "move", "destination": "Archive"})

    def test_oauth_refresh_xoauth2_and_local_revoke(self):
        setup = {**profile("Work"), "imapHost": "imap.gmail.com", "smtpHost": "smtp.gmail.com",
                 "authMode": "google-oauth", "oauthClientId": "client-id-example", "oauthTenant": ""}
        account = mail.run({"action": "upsert", "account": setup, "secrets": {}, "expectedRevision": None})
        self.assertFalse(account["secretState"]["oauthRefreshToken"])
        mail.run({"action": "oauth-complete", "accountId": account["id"], "expectedRevision": 1,
                  "refreshToken": "synthetic-refresh-token", "scopes": [mail.GOOGLE_SCOPE]})
        self.assertNotIn("synthetic-refresh-token", mail.MANIFEST.read_text())
        self.assertEqual(mail.secret_path(account["id"], "oauthRefreshToken").stat().st_mode & 0o777, 0o600)
        class FakeImap:
            def __init__(self): self.auth = None
            def authenticate(self, mechanism, callback): self.auth = mechanism, callback(b"")
        class FakeSmtp:
            def __init__(self): self.auth_data = None
            def ehlo(self): pass
            def auth(self, mechanism, callback, initial_response_ok): self.auth_data = mechanism, callback(), initial_response_ok
        reader, sender = FakeImap(), FakeSmtp()
        token = {"access_token": "synthetic-access-token", "refresh_token": "rotated-refresh-token",
                 "scope": mail.GOOGLE_SCOPE, "expires_in": 3600}
        fake_opener = type("FakeOpener", (), {"open": lambda self, *_args, **_kwargs: io.BytesIO(json.dumps(token).encode())})()
        with (patch.object(mail.urllib.request, "build_opener", return_value=fake_opener) as post,
              patch.object(mail.imaplib, "IMAP4_SSL", return_value=reader),
              patch.object(mail.smtplib, "SMTP_SSL", return_value=sender)):
            mail.imap(account)
            mail.smtp(account)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(reader.auth, ("XOAUTH2", mail.xoauth2("Work", "synthetic-access-token")))
        self.assertEqual(sender.auth_data, ("XOAUTH2", mail.xoauth2("Work", "synthetic-access-token").decode(), True))
        self.assertEqual(mail.secret_path(account["id"], "oauthRefreshToken").read_text(), "rotated-refresh-token\n")
        mail.run({"action": "oauth-revoke", "accountId": account["id"], "expectedRevision": 1})
        self.assertFalse(mail.secret_path(account["id"], "oauthRefreshToken").exists())
        self.assertFalse(mail.secret_path(account["id"], "oauthAccessToken").exists())
        self.assertFalse(mail.secret_path(account["id"], "oauthScopes").exists())

    def test_oauth_host_cannot_exfiltrate_bearer_token(self):
        setup = {**profile("Work"), "authMode": "google-oauth", "oauthClientId": "client-id-example", "oauthTenant": ""}
        with self.assertRaisesRegex(ValueError, "invalid_oauth_host"):
            mail.run({"action": "upsert", "account": setup, "secrets": {}, "expectedRevision": None})

    def test_incomplete_draft_appends_once_without_smtp(self):
        account = mail.run({"action": "upsert", "account": profile("Work"),
                            "secrets": {"imapPassword": "one", "smtpPassword": "send-one"}, "expectedRevision": None})
        class FakeImap:
            def __init__(self): self.present = False; self.appends = 0
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def list(self): return "OK", [b'(\\Drafts) "/" "Drafts"']
            def select(self, *_, **__): return "OK", [b"0"]
            def response(self, _): return "UIDVALIDITY", [b"1"]
            def uid(self, *args): return "OK", [b"10" if self.present else b""]
            def append(self, *_): self.appends += 1; self.present = True; return "OK", [b"done"]
        reader = FakeImap()
        request = {"action": "draft", "accountId": account["id"], "message": {"to": [], "subject": "", "body": "",
                   "messageId": MESSAGE_ID}}
        with patch.object(mail, "imap", return_value=reader), patch.object(mail, "smtp") as sender:
            self.assertEqual(mail.run(request), {"state": "drafted", "messageId": MESSAGE_ID, "alreadyPresent": False})
            self.assertEqual(mail.run(request), {"state": "drafted", "messageId": MESSAGE_ID, "alreadyPresent": True})
        self.assertEqual(reader.appends, 1)
        sender.assert_not_called()


if __name__ == "__main__":
    unittest.main()
