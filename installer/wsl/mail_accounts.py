#!/usr/bin/env python3
"""Friday-owned multi-account IMAP/SMTP bridge. JSON on stdin; secrets never on stdout."""
import base64
import email
from email import policy
from email.message import EmailMessage
from email.utils import formataddr
import fcntl
import imaplib
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import sys
import tempfile
import time
import tomllib
import uuid
import urllib.parse
import urllib.request
import urllib.error
from urllib.parse import urlsplit

ROOT = Path.home() / ".config" / "friday" / "mail"
MANIFEST = ROOT / "accounts.json"
HOST = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$")
ADDRESS = re.compile(r"^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+$")
ACCOUNT_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
UID = re.compile(r"^[1-9][0-9]{0,17}$")
GOOGLE_SCOPE = "https://mail.google.com/"
MICROSOFT_SCOPES = {"https://outlook.office.com/IMAP.AccessAsUser.All", "https://outlook.office.com/SMTP.Send"}
TENANT = re.compile(r"^(?:common|organizations|consumers|[a-fA-F0-9-]{36})$")


def normalized_scopes(scopes):
    return {"https://outlook.office.com/" + scope if scope in ("IMAP.AccessAsUser.All", "SMTP.Send") else scope
            for scope in scopes}


def atomic(path, content):
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.is_symlink() or path.parent.is_symlink():
        raise ValueError("unsafe_path")
    fd, temp = tempfile.mkstemp(prefix=".friday-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def load():
    if MANIFEST.is_symlink():
        raise ValueError("unsafe_path")
    if not MANIFEST.exists():
        legacy_config = Path.home() / ".config" / "himalaya" / "config.toml"
        if legacy_config.is_file() and not legacy_config.is_symlink() and legacy_config.read_text(encoding="utf-8").startswith("# Managed by Friday: account friday\n"):
            legacy = tomllib.loads(legacy_config.read_text(encoding="utf-8"))["accounts"]["friday"]
            imap = urlsplit(legacy["imap"]["server"])
            smtp_url = urlsplit(legacy["smtp"]["server"])
            if not imap.hostname or not smtp_url.hostname or not imap.port or not smtp_url.port:
                raise ValueError("legacy_invalid")
            account = {"id": "friday", "displayName": legacy.get("display-name", "Mail Postfach"),
                       "email": legacy["email"], "senderName": legacy.get("display-name", "Friday"), "aliases": [], "signature": "",
                       "imapHost": imap.hostname, "imapPort": imap.port,
                       "imapSecurity": "tls" if imap.scheme == "imaps" else "start-tls", "imapLogin": legacy["imap"]["sasl"]["plain"]["username"],
                       "smtpHost": smtp_url.hostname, "smtpPort": smtp_url.port,
                       "smtpSecurity": "tls" if smtp_url.scheme == "smtps" else "start-tls", "smtpLogin": legacy["smtp"]["sasl"]["plain"]["username"],
                       "sentFolder": legacy.get("mailbox", {}).get("alias", {}).get("sent", "Sent"),
                       "draftsFolder": legacy.get("mailbox", {}).get("alias", {}).get("drafts", "Drafts"),
                       "trashFolder": legacy.get("mailbox", {}).get("alias", {}).get("trash", "Trash"),
                       "archiveFolder": "Archive", "spamFolder": "Spam", "revision": 1,
                       "authMode": "password", "oauthClientId": "", "oauthTenant": ""}
            validate(account)
            for name, old in (("imapPassword", "imap-secret"), ("smtpPassword", "smtp-secret")):
                source = ROOT / old
                if source.is_symlink() or not source.is_file() or source.stat().st_mode & 0o777 != 0o600:
                    raise ValueError("legacy_secret_missing")
                atomic(secret_path("friday", name), source.read_bytes())
            result = {"revision": 1, "defaultAccountId": "friday", "accounts": [account]}
            atomic(MANIFEST, json.dumps(result, ensure_ascii=False).encode())
            return result
        return {"revision": 1, "defaultAccountId": None, "accounts": []}
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("accounts"), list):
        raise ValueError("invalid_manifest")
    for account in data["accounts"]:
        account.setdefault("authMode", "password")
        account.setdefault("oauthClientId", "")
        account.setdefault("oauthTenant", "")
    return data


def public(account):
    return {**account, "secretState": {name: secret_path(account["id"], name).is_file()
            for name in ("imapPassword", "smtpPassword", "oauthRefreshToken")}}


def secret_path(account_id, name):
    if not ACCOUNT_ID.fullmatch(account_id) or name not in ("imapPassword", "smtpPassword", "oauthRefreshToken", "oauthAccessToken", "oauthScopes"):
        raise ValueError("invalid_secret")
    return ROOT / f"{account_id}-{name}.secret"


def account_for(data, account_id):
    if not isinstance(account_id, str) or not ACCOUNT_ID.fullmatch(account_id):
        raise ValueError("invalid_account")
    item = next((row for row in data["accounts"] if row["id"] == account_id), None)
    if item is None:
        raise KeyError("account_not_found")
    return item


def validate(account):
    allowed = {"id", "displayName", "email", "senderName", "aliases", "signature", "imapHost", "imapPort",
               "imapSecurity", "imapLogin", "smtpHost", "smtpPort", "smtpSecurity", "smtpLogin",
               "sentFolder", "draftsFolder", "trashFolder", "archiveFolder", "spamFolder", "revision",
               "authMode", "oauthClientId", "oauthTenant"}
    if set(account) != allowed or any(not isinstance(account[key], str) or len(account[key]) > 1024 or
                                     any(ord(ch) < 32 for ch in account[key]) for key in allowed - {"aliases", "revision", "imapPort", "smtpPort", "signature"}):
        raise ValueError("invalid_account")
    if not isinstance(account["signature"], str) or len(account["signature"]) > 1024 or any(
            ord(ch) < 32 and ch not in "\n\t" for ch in account["signature"]):
        raise ValueError("invalid_signature")
    if not isinstance(account["aliases"], list) or len(account["aliases"]) > 20 or not all(
            isinstance(value, str) and ADDRESS.fullmatch(value) for value in account["aliases"]):
        raise ValueError("invalid_alias")
    if not ACCOUNT_ID.fullmatch(account["id"]) or not ADDRESS.fullmatch(account["email"]) or not account["displayName"] or not account["senderName"]:
        raise ValueError("invalid_identity")
    if not all(HOST.fullmatch(account[key]) for key in ("imapHost", "smtpHost")):
        raise ValueError("invalid_host")
    if not all(type(account[key]) is int and 1 <= account[key] <= 65535 for key in ("imapPort", "smtpPort", "revision")):
        raise ValueError("invalid_port")
    if account["imapSecurity"] not in ("tls", "start-tls") or account["smtpSecurity"] not in ("tls", "start-tls"):
        raise ValueError("invalid_tls")
    if not account["imapLogin"] or not account["smtpLogin"]:
        raise ValueError("invalid_login")
    if account["authMode"] not in ("password", "google-oauth", "microsoft-oauth"):
        raise ValueError("invalid_auth_mode")
    if account["authMode"] != "password":
        if not re.fullmatch(r"[A-Za-z0-9._~-]{8,256}", account["oauthClientId"]):
            raise ValueError("invalid_oauth_client")
        if account["authMode"] == "microsoft-oauth" and not TENANT.fullmatch(account["oauthTenant"]):
            raise ValueError("invalid_oauth_tenant")
        if account["authMode"] == "google-oauth" and account["oauthTenant"]:
            raise ValueError("invalid_oauth_tenant")
        hosts = (account["imapHost"].lower(), account["smtpHost"].lower())
        required = ("imap.gmail.com", "smtp.gmail.com") if account["authMode"] == "google-oauth" else ("outlook.office365.com", "smtp.office365.com")
        if hosts != required:
            raise ValueError("invalid_oauth_host")


def read_secret(account, name):
    path = secret_path(account["id"], name)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o777 != 0o600:
        raise ValueError(name + "_missing")
    return path.read_text(encoding="utf-8").rstrip("\n")


def oauth_token(account):
    cache = secret_path(account["id"], "oauthAccessToken")
    if cache.is_file() and not cache.is_symlink() and cache.stat().st_mode & 0o777 == 0o600:
        try:
            saved = json.loads(cache.read_text(encoding="utf-8"))
            if saved["expiresAt"] > time.time() + 60 and saved["clientId"] == account["oauthClientId"]:
                return saved["accessToken"]
        except (ValueError, KeyError, TypeError):
            pass
    refresh = read_secret(account, "oauthRefreshToken")
    granted = normalized_scopes(json.loads(read_secret(account, "oauthScopes")))
    required = {GOOGLE_SCOPE} if account["authMode"] == "google-oauth" else MICROSOFT_SCOPES
    if not required.issubset(granted):
        raise RuntimeError("oauth_scope_missing")
    if account["authMode"] == "google-oauth":
        endpoint = "https://oauth2.googleapis.com/token"
    else:
        endpoint = "https://login.microsoftonline.com/" + account["oauthTenant"] + "/oauth2/v2.0/token"
    payload = urllib.parse.urlencode({"client_id": account["oauthClientId"], "grant_type": "refresh_token", "refresh_token": refresh}).encode()
    request = urllib.request.Request(endpoint, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=12) as response:
            payload = response.read(32769)
            if len(payload) > 32768:
                raise RuntimeError("oauth_refresh_failed")
            token = json.loads(payload)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("oauth_refresh_failed") from error
    if not isinstance(token, dict) or not isinstance(token.get("access_token"), str) or not token["access_token"]:
        raise RuntimeError("oauth_refresh_failed")
    scopes = normalized_scopes(str(token.get("scope", "")).split())
    if scopes and not required.issubset(scopes):
        raise RuntimeError("oauth_scope_missing")
    if isinstance(token.get("refresh_token"), str) and token["refresh_token"]:
        atomic(secret_path(account["id"], "oauthRefreshToken"), (token["refresh_token"] + "\n").encode())
    atomic(cache, json.dumps({"accessToken": token["access_token"], "clientId": account["oauthClientId"],
                              "expiresAt": time.time() + max(60, min(int(token.get("expires_in", 3600)), 86400))}).encode())
    return token["access_token"]


def xoauth2(login, token):
    return ("user=" + login + "\x01auth=Bearer " + token + "\x01\x01").encode()


def imap(account):
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    if account["imapSecurity"] == "tls":
        client = imaplib.IMAP4_SSL(account["imapHost"], account["imapPort"], ssl_context=context, timeout=12)
    else:
        client = imaplib.IMAP4(account["imapHost"], account["imapPort"], timeout=12)
        client.starttls(ssl_context=context)
    if account["authMode"] == "password":
        client.login(account["imapLogin"], read_secret(account, "imapPassword"))
    else:
        client.authenticate("XOAUTH2", lambda _: xoauth2(account["imapLogin"], oauth_token(account)))
    return client


def smtp(account):
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    if account["smtpSecurity"] == "tls":
        client = smtplib.SMTP_SSL(account["smtpHost"], account["smtpPort"], timeout=12, context=context)
    else:
        client = smtplib.SMTP(account["smtpHost"], account["smtpPort"], timeout=12)
        client.ehlo()
        client.starttls(context=context)
    if account["authMode"] == "password":
        client.login(account["smtpLogin"], read_secret(account, "smtpPassword"))
    else:
        client.ehlo()
        client.auth("XOAUTH2", lambda challenge=None: xoauth2(account["smtpLogin"], oauth_token(account)).decode(), initial_response_ok=True)
    return client


def folders(client):
    status, rows = client.list()
    if status != "OK":
        raise RuntimeError("imap_folders_failed")
    result = []
    for raw in rows[:200]:
        if not isinstance(raw, bytes):
            continue
        text = raw.decode("utf-8", "replace")
        match = re.match(r'^\(([^)]*)\)\s+"[^"]*"\s+(.+)$', text)
        if not match:
            continue
        folder = match.group(2).strip('"')
        if folder and len(folder) <= 200:
            flags = match.group(1).lower()
            role = next((name for name in ("sent", "drafts", "trash", "archive", "junk") if "\\" + name in flags), None)
            result.append({"id": folder, "name": folder, "role": role})
    return result


def select(client, mailbox, readonly=True):
    if not isinstance(mailbox, str) or not 1 <= len(mailbox) <= 200 or mailbox not in {row["id"] for row in folders(client)}:
        raise ValueError("invalid_mailbox")
    status, _ = client.select('"' + mailbox.replace('"', '\\"') + '"', readonly=readonly)
    if status != "OK":
        raise RuntimeError("imap_select_failed")
    uidvalidity = client.response("UIDVALIDITY")[1]
    return uidvalidity[0].decode() if uidvalidity and uidvalidity[0] else None


def run(request):
    action = request.get("action")
    data = load()
    if action == "list":
        return {"revision": data["revision"], "defaultAccountId": data["defaultAccountId"],
                "accounts": [public(row) for row in data["accounts"]]}
    if action == "upsert":
        incoming = request.get("account")
        if not isinstance(incoming, dict):
            raise ValueError("invalid_account")
        if not incoming.get("id"):
            incoming = {**incoming, "id": "mail-" + uuid.uuid4().hex[:24]}
        old = next((row for row in data["accounts"] if row["id"] == incoming["id"]), None)
        expected = request.get("expectedRevision")
        if old and expected != old["revision"] or not old and expected is not None:
            raise RuntimeError("revision_conflict")
        candidate = {**incoming, "authMode": incoming.get("authMode", "password"),
                     "oauthClientId": incoming.get("oauthClientId", ""), "oauthTenant": incoming.get("oauthTenant", ""),
                     "revision": old["revision"] + 1 if old else 1}
        validate(candidate)
        changes = request.get("secrets", {})
        if not isinstance(changes, dict) or set(changes) - {"imapPassword", "smtpPassword"}:
            raise ValueError("invalid_secrets")
        if not old and candidate["authMode"] == "password" and any(name not in changes or not isinstance(changes[name], str) or not changes[name] for name in ("imapPassword", "smtpPassword")):
            raise ValueError("secrets_required")
        for name, value in changes.items():
            if value is not None and (not isinstance(value, str) or not 1 <= len(value) <= 1024 or any(ord(ch) < 32 for ch in value)):
                raise ValueError("invalid_secret")
        # Manifest is switched only after every secret write succeeds; prior files are restored on failure.
        before = {}
        try:
            for name, value in changes.items():
                path = secret_path(candidate["id"], name)
                before[name] = path.read_bytes() if path.exists() and not path.is_symlink() else None
                if value is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic(path, (value + "\n").encode())
            if old and (old["authMode"], old["oauthClientId"], old["oauthTenant"]) != (candidate["authMode"], candidate["oauthClientId"], candidate["oauthTenant"]):
                # A changed client or tenant must never inherit a previously granted token.
                for name in ("oauthRefreshToken", "oauthAccessToken", "oauthScopes"):
                    path = secret_path(candidate["id"], name)
                    before[name] = path.read_bytes() if path.exists() and not path.is_symlink() else None
                    path.unlink(missing_ok=True)
            data["accounts"] = [row for row in data["accounts"] if row["id"] != candidate["id"]] + [candidate]
            if data["defaultAccountId"] is None:
                data["defaultAccountId"] = candidate["id"]
            data["revision"] += 1
            atomic(MANIFEST, json.dumps(data, ensure_ascii=False).encode())
        except Exception:
            for name, value in before.items():
                path = secret_path(candidate["id"], name)
                if value is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic(path, value)
            raise
        return public(candidate)
    if action == "default":
        account_for(data, request.get("accountId"))
        if request.get("expectedRevision") != data["revision"]:
            raise RuntimeError("revision_conflict")
        data["defaultAccountId"] = request["accountId"]
        data["revision"] += 1
        atomic(MANIFEST, json.dumps(data, ensure_ascii=False).encode())
        return {"revision": data["revision"], "defaultAccountId": data["defaultAccountId"]}
    account = account_for(data, request.get("accountId"))
    if action == "delete":
        if request.get("expectedRevision") != account["revision"]:
            raise RuntimeError("revision_conflict")
        data["accounts"] = [row for row in data["accounts"] if row["id"] != account["id"]]
        if data["defaultAccountId"] == account["id"]:
            data["defaultAccountId"] = data["accounts"][0]["id"] if data["accounts"] else None
        data["revision"] += 1
        atomic(MANIFEST, json.dumps(data, ensure_ascii=False).encode())
        for name in ("imapPassword", "smtpPassword", "oauthRefreshToken", "oauthAccessToken", "oauthScopes"):
            secret_path(account["id"], name).unlink(missing_ok=True)
        return {"deleted": True}
    if action == "oauth-complete":
        if account["authMode"] == "password" or request.get("expectedRevision") != account["revision"]:
            raise RuntimeError("revision_conflict")
        token = request.get("refreshToken")
        scopes = request.get("scopes")
        if not isinstance(token, str) or not 16 <= len(token) <= 8192 or any(ord(ch) < 33 for ch in token):
            raise ValueError("invalid_oauth_token")
        required = {GOOGLE_SCOPE} if account["authMode"] == "google-oauth" else MICROSOFT_SCOPES
        if not isinstance(scopes, list) or not all(isinstance(scope, str) for scope in scopes) or not required.issubset(normalized_scopes(scopes)):
            raise ValueError("invalid_oauth_scope")
        atomic(secret_path(account["id"], "oauthScopes"), json.dumps(sorted(normalized_scopes(scopes))).encode())
        atomic(secret_path(account["id"], "oauthRefreshToken"), (token + "\n").encode())
        secret_path(account["id"], "oauthAccessToken").unlink(missing_ok=True)
        return public(account)
    if action == "oauth-revoke":
        if request.get("expectedRevision") != account["revision"]:
            raise RuntimeError("revision_conflict")
        for name in ("oauthRefreshToken", "oauthAccessToken", "oauthScopes"):
            secret_path(account["id"], name).unlink(missing_ok=True)
        return public(account)
    if action == "check-imap":
        with imap(account) as client:
            return {"ok": True, "folders": folders(client)}
    if action == "check-smtp":
        with smtp(account):
            return {"ok": True}
    if action in ("folders", "envelopes", "search", "message", "attachment", "change"):
        with imap(account) as client:
            if action == "folders":
                return {"folders": folders(client)}
            mailbox = request.get("mailbox")
            uidvalidity = select(client, mailbox, readonly=action != "change")
            if action in ("envelopes", "search"):
                page = request.get("page", 1)
                if type(page) is not int or not 1 <= page <= 20:
                    raise ValueError("invalid_page")
                if action == "search":
                    query = request.get("query")
                    if not isinstance(query, str) or not 1 <= len(query) <= 100 or any(ord(ch) < 32 for ch in query):
                        raise ValueError("invalid_search")
                    quoted = '"' + query.replace("\\", "\\\\").replace('"', '\\"') + '"'
                    if query.isascii():
                        status, result = client.uid("search", None, "TEXT", quoted)
                    else:
                        status, result = client.uid("search", "CHARSET", "UTF-8", "TEXT", quoted.encode("utf-8"))
                else:
                    status, result = client.uid("search", None, "ALL")
                if status != "OK":
                    raise RuntimeError("imap_search_failed")
                ids = result[0].split()[::-1][(page - 1) * 25:page * 25]
                items = []
                for uid in ids:
                    found, body = client.uid("fetch", uid, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)] FLAGS)")
                    if found != "OK" or not body or not isinstance(body[0], tuple):
                        continue
                    header = email.message_from_bytes(body[0][1], policy=policy.default)
                    metadata = body[0][0] if isinstance(body[0][0], bytes) else b""
                    flags_match = re.search(rb"\bFLAGS\s+\(([^)]*)\)", metadata, re.I)
                    flags = [value.lstrip(b"\\").decode("ascii", "ignore").lower()
                             for value in flags_match.group(1).split()] if flags_match else []
                    items.append({"id": uid.decode(), "subject": str(header.get("subject", ""))[:500],
                                  "from": str(header.get("from", ""))[:500], "date": str(header.get("date", ""))[:120],
                                  "flags": flags})
                return {"mailbox": mailbox, "uidValidity": uidvalidity, "page": page, "items": items}
            uid = request.get("uid")
            if not isinstance(uid, str) or not UID.fullmatch(uid) or request.get("uidValidity") != uidvalidity:
                raise RuntimeError("uidvalidity_conflict")
            if action == "change":
                if request.get("kind") == "flag":
                    status, _ = client.uid("store", uid, "+FLAGS.SILENT", "(\\Flagged)")
                    if status != "OK":
                        raise RuntimeError("imap_flag_failed")
                elif request.get("kind") == "move":
                    destination = request.get("destination")
                    if destination not in {row["id"] for row in folders(client)}:
                        raise ValueError("invalid_destination")
                    if not any(capability.upper() in ("MOVE", b"MOVE") for capability in client.capabilities):
                        raise RuntimeError("imap_move_unsupported")
                    status, _ = client.uid("MOVE", uid, destination)
                    if status != "OK":
                        raise RuntimeError("imap_move_failed")
                else:
                    raise ValueError("invalid_change")
                return {"changed": True}
            found, body = client.uid("fetch", uid.encode(), "(BODY.PEEK[])")
            if found != "OK" or not body or not isinstance(body[0], tuple) or len(body[0][1]) > 8 * 1024 * 1024:
                raise RuntimeError("imap_message_failed")
            message = email.message_from_bytes(body[0][1], policy=policy.default)
            if action == "attachment":
                index = request.get("index")
                items = list(message.iter_attachments())
                if type(index) is not int or not 0 <= index < min(len(items), 20):
                    raise ValueError("invalid_attachment")
                item = items[index]
                content = item.get_payload(decode=True) or b""
                if len(content) > 5 * 1024 * 1024:
                    raise RuntimeError("attachment_too_large")
                return {"filename": (item.get_filename() or "attachment")[:200], "contentType": item.get_content_type(),
                        "size": len(content), "data": base64.b64encode(content).decode("ascii")}
            part = message.get_body(preferencelist=("plain",))
            text = part.get_content() if part else ""
            attachments = [{"filename": item.get_filename() or "attachment", "contentType": item.get_content_type(),
                            "size": len(item.get_payload(decode=True) or b"")}
                           for item in message.iter_attachments()][:20]
            return {"mailbox": mailbox, "uid": uid, "uidValidity": uidvalidity,
                    "subject": str(message.get("subject", ""))[:500], "from": str(message.get("from", ""))[:500],
                    "to": str(message.get("to", ""))[:500], "date": str(message.get("date", ""))[:120],
                    "messageId": str(message.get("message-id", ""))[:500], "replyTo": str(message.get("reply-to", ""))[:500],
                    "references": str(message.get("references", ""))[:2000], "bodyText": str(text)[:100000], "attachments": attachments}
    if action == "probe":
        message_id = request.get("messageId")
        if not isinstance(message_id, str) or not re.fullmatch(r"<friday-[a-f0-9]{64}@friday\.local>", message_id):
            raise ValueError("invalid_message_id")
        with imap(account) as client:
            select(client, account["sentFolder"])
            status, matches = client.uid("search", None, "HEADER", "Message-ID", '"' + message_id + '"')
            if status != "OK":
                raise RuntimeError("sent_search_failed")
            return {"present": bool(matches and matches[0].split())}
    if action in ("send", "archive", "draft"):
        message_data = request.get("message", {})
        if not isinstance(message_data, dict):
            raise ValueError("invalid_message")
        recipients = message_data.get("to", [])
        if not isinstance(recipients, list) or not (0 if action == "draft" else 1) <= len(recipients) <= 10 or not all(isinstance(value, str) and ADDRESS.fullmatch(value) for value in recipients):
            raise ValueError("invalid_recipients")
        sender = message_data.get("from", account["email"])
        if sender not in [account["email"], *account["aliases"]]:
            raise ValueError("invalid_sender")
        subject, body = message_data.get("subject", ""), message_data.get("body", "")
        if not isinstance(subject, str) or not (0 if action == "draft" else 1) <= len(subject) <= 200 or "\n" in subject or "\r" in subject or not isinstance(body, str) or len(body.encode()) > 100000:
            raise ValueError("invalid_message")
        mail = EmailMessage(policy=policy.SMTP)
        mail["From"] = formataddr((account["senderName"], sender))
        mail["To"] = ", ".join(recipients)
        mail["Subject"] = subject
        message_id = message_data.get("messageId")
        if not isinstance(message_id, str) or not re.fullmatch(r"<friday-[a-f0-9]{64}@friday\.local>", message_id):
            raise ValueError("invalid_message_id")
        mail["Message-ID"] = message_id
        for name in ("inReplyTo", "references"):
            value = message_data.get(name)
            if value:
                if not isinstance(value, str) or len(value) > 2000 or "\n" in value or "\r" in value:
                    raise ValueError("invalid_header")
                mail["In-Reply-To" if name == "inReplyTo" else "References"] = value
        mail.set_content(body + ("\n\n" + account["signature"] if account["signature"] else ""))
        attachments = message_data.get("attachments", [])
        if not isinstance(attachments, list) or len(attachments) > 5:
            raise ValueError("invalid_attachment")
        for attachment in attachments:
            if (not isinstance(attachment, dict) or not isinstance(attachment.get("data"), str) or
                    not isinstance(attachment.get("filename"), str) or not attachment["filename"] or
                    any(ord(ch) < 32 for ch in attachment["filename"])):
                raise ValueError("invalid_attachment")
            raw = base64.b64decode(attachment["data"], validate=True)
            if len(raw) > 5 * 1024 * 1024 or len(attachment["filename"]) > 200:
                raise ValueError("invalid_attachment")
            mail.add_attachment(raw, maintype="application", subtype="octet-stream", filename=attachment["filename"])
        payload = mail.as_bytes()
        if action == "draft":
            with imap(account) as client:
                drafts = account["draftsFolder"]
                select(client, drafts)
                status, matches = client.uid("search", None, "HEADER", "Message-ID", '"' + message_id + '"')
                if status != "OK":
                    raise RuntimeError("draft_search_failed")
                if matches and matches[0].split():
                    return {"state": "drafted", "messageId": message_id, "alreadyPresent": True}
                status, _ = client.append(drafts, "\\Draft", imaplib.Time2Internaldate(time.time()), payload)
                if status != "OK":
                    raise RuntimeError("draft_append_failed")
                return {"state": "drafted", "messageId": message_id, "alreadyPresent": False}
        if action == "archive":
            with imap(account) as client:
                sent = account["sentFolder"]
                select(client, sent)
                status, matches = client.uid("search", None, "HEADER", "Message-ID", '"' + message_id + '"')
                if status != "OK":
                    raise RuntimeError("sent_search_failed")
                if matches and matches[0].split():
                    return {"state": "archived", "alreadyPresent": True}
                status, _ = client.append(sent, "\\Seen", imaplib.Time2Internaldate(time.time()), payload)
                if status != "OK":
                    raise RuntimeError("sent_append_failed")
                return {"state": "archived", "alreadyPresent": False}
        with smtp(account) as client:
            refused = client.sendmail(sender, recipients, payload)
        if refused:
            # Some recipients may already have been accepted. Never report a retryable failure.
            return {"state": "uncertain", "archivePending": True}
        archive_pending = False
        try:
            with imap(account) as client:
                sent = account["sentFolder"]
                if sent not in {row["id"] for row in folders(client)}:
                    raise RuntimeError("sent_folder_missing")
                status, _ = client.append(sent, "\\Seen", imaplib.Time2Internaldate(time.time()), payload)
                archive_pending = status != "OK"
        except Exception:
            archive_pending = True
        return {"state": "sent", "archivePending": archive_pending}
    raise ValueError("invalid_action")


def main():
    if len(sys.argv) != 1 or ROOT.is_symlink() or ROOT.parent.is_symlink():
        raise ValueError("invalid_environment")
    request = json.load(sys.stdin)
    if not isinstance(request, dict):
        raise ValueError("invalid_request")
    ROOT.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (ROOT / ".accounts.lock").open("a+") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = run(request)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, RuntimeError, imaplib.IMAP4.error, smtplib.SMTPException, ssl.SSLError, OSError) as error:
        code = str(error) if str(error) in {"revision_conflict", "account_not_found", "uidvalidity_conflict", "imap_secret_missing", "smtp_secret_missing", "oauthRefreshToken_missing", "oauth_refresh_failed", "oauth_scope_missing"} else "mail_unavailable"
        print(json.dumps({"error": code}))
        sys.exit(3 if code == "revision_conflict" else 4 if code in {"account_not_found", "uidvalidity_conflict"} else 6)
