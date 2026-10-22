#!/usr/bin/env python3
"""Friday-owned CalDAV/ICS accounts. JSON on stdin; credentials never on stdout."""
from __future__ import annotations

import base64
import datetime as dt
import fcntl
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import ssl
import sys
import tempfile
from urllib.parse import urljoin, urlsplit
import uuid
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

ROOT = Path.home() / ".config" / "friday" / "calendar"
MANIFEST = ROOT / "accounts.json"
JOURNAL = ROOT / "actions.sqlite"
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
DAV = "{DAV:}"
CAL = "{urn:ietf:params:xml:ns:caldav}"
APPLE = "{http://apple.com/ns/ical/}"
MAX_XML = 2_000_000


def atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if path.parent.is_symlink() or path.is_symlink():
        raise ValueError("unsafe_path")
    fd, temporary = tempfile.mkstemp(prefix=".friday-", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def safe_url(raw: str, origin: str | None = None) -> str:
    if not isinstance(raw, str) or len(raw) > 2048 or any(ord(char) < 32 for char in raw):
        raise ValueError("invalid_url")
    parsed = urlsplit(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError("invalid_url")
    if origin and (parsed.scheme, parsed.hostname.lower(), parsed.port) != (urlsplit(origin).scheme, urlsplit(origin).hostname.lower(), urlsplit(origin).port):
        raise ValueError("cross_origin")
    try:
        ipaddress.ip_address(parsed.hostname)
        raise ValueError("literal_ip")
    except ValueError as error:
        if str(error) == "literal_ip":
            raise
    return raw


def href(base: str, value: str) -> str:
    target = safe_url(urljoin(base, value), base)
    if len(target) > 2048 or urlsplit(target).query:
        raise ValueError("invalid_href")
    return target


def secret_path(account_id: str) -> Path:
    if not ID.fullmatch(account_id):
        raise ValueError("invalid_id")
    return ROOT / (account_id + ".secret")


def read_secret(account_id: str) -> str:
    path = secret_path(account_id)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o777 != 0o600:
        raise ValueError("missing_secret")
    return path.read_text(encoding="utf-8")


def load() -> dict:
    if MANIFEST.is_symlink():
        raise ValueError("unsafe_path")
    if not MANIFEST.exists():
        return {"revision": 1, "defaultAccountId": None, "accounts": []}
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("accounts"), list):
        raise ValueError("invalid_manifest")
    return data


def save(data: dict) -> None:
    atomic(MANIFEST, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def journal_connection() -> sqlite3.Connection:
    if JOURNAL.is_symlink():
        raise ValueError("unsafe_path")
    JOURNAL.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if not JOURNAL.exists():
        fd = os.open(JOURNAL, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        os.close(fd)
    if JOURNAL.stat().st_mode & 0o777 != 0o600:
        raise ValueError("unsafe_path")
    db = sqlite3.connect(JOURNAL)
    db.execute("CREATE TABLE IF NOT EXISTS actions (operation_key TEXT PRIMARY KEY, body_hash TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, meta_json TEXT NOT NULL, memory_state TEXT NOT NULL DEFAULT 'pending')")
    columns = {row[1] for row in db.execute("PRAGMA table_info(actions)")}
    if "meta_json" not in columns:
        db.execute("ALTER TABLE actions ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}'")
    if "memory_state" not in columns:
        db.execute("ALTER TABLE actions ADD COLUMN memory_state TEXT NOT NULL DEFAULT 'pending'")
    db.execute("PRAGMA user_version=1")
    db.commit()
    return db


def journal_reserve(operation_key: str, payload: dict, meta: dict) -> tuple[dict | None, str]:
    if not isinstance(operation_key, str) or not re.fullmatch(r"[a-f0-9]{64}", operation_key):
        raise ValueError("operation_key_required")
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    created_at = dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    with journal_connection() as db:
        row = db.execute("SELECT body_hash,state,result_json,created_at FROM actions WHERE operation_key=?", (operation_key,)).fetchone()
        if row:
            if row[0] != digest:
                raise ValueError("operation_conflict")
            return (json.loads(row[2]) if row[2] else {"state": "uncertain", "id": None, "etag": None, "createdAt": row[3]}), row[3]
        db.execute("INSERT INTO actions(operation_key,body_hash,state,created_at,meta_json) VALUES (?,?,'pending',?,?)",
                   (operation_key, digest, created_at, json.dumps(meta)))
    return None, created_at


def journal_lookup(operation_key: str, payload: dict) -> dict | None:
    if not isinstance(operation_key, str) or not re.fullmatch(r"[a-f0-9]{64}", operation_key):
        raise ValueError("operation_key_required")
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with journal_connection() as db:
        row = db.execute("SELECT body_hash,result_json,created_at FROM actions WHERE operation_key=?", (operation_key,)).fetchone()
    if not row:
        return None
    if row[0] != digest:
        raise ValueError("operation_conflict")
    return json.loads(row[1]) if row[1] else {"state": "uncertain", "id": None, "etag": None, "createdAt": row[2]}


def journal_finish(operation_key: str, result: dict) -> dict:
    with journal_connection() as db:
        db.execute("UPDATE actions SET state=?,result_json=? WHERE operation_key=?", (result["state"], json.dumps(result), operation_key))
    return result


def journal_forget(operation_key: str) -> None:
    with journal_connection() as db:
        db.execute("DELETE FROM actions WHERE operation_key=?", (operation_key,))


def pending_memory() -> list[dict]:
    with journal_connection() as db:
        rows = db.execute("SELECT operation_key,state,result_json,created_at,meta_json FROM actions WHERE memory_state='pending' ORDER BY created_at LIMIT 100").fetchall()
    return [{"operationKey": row[0], "state": row[1], "result": json.loads(row[2]) if row[2] else {"id": None},
             "createdAt": row[3], "meta": json.loads(row[4])} for row in rows]


def ack_memory(operation_key: str) -> dict:
    with journal_connection() as db:
        changed = db.execute("UPDATE actions SET memory_state='captured' WHERE operation_key=?", (operation_key,)).rowcount
    return {"acknowledged": bool(changed)}


def public(account: dict) -> dict:
    return {**account, "baseUrl": "" if account["kind"] == "ics" else account["baseUrl"],
            "secretState": {"password": secret_path(account["id"]).is_file()},
            "calendars": [{key: value for key, value in cal.items() if key != "url"} for cal in account.get("calendars", [])]}


def account_for(data: dict, account_id: str) -> dict:
    if not ID.fullmatch(str(account_id)):
        raise ValueError("invalid_id")
    account = next((item for item in data["accounts"] if item["id"] == account_id), None)
    if account is None:
        raise KeyError("account_not_found")
    return account


def validate_account(account: dict) -> None:
    if not ID.fullmatch(account.get("id", "")) or account.get("kind") not in ("caldav", "ics"):
        raise ValueError("invalid_account")
    if not isinstance(account.get("displayName"), str) or not 1 <= len(account["displayName"].strip()) <= 120:
        raise ValueError("invalid_name")
    safe_url(account.get("baseUrl", ""))
    if account["kind"] == "caldav" and urlsplit(account["baseUrl"]).query:
        raise ValueError("invalid_url")
    if not isinstance(account.get("username"), str) or len(account["username"]) > 512 or "\r" in account["username"] or "\n" in account["username"]:
        raise ValueError("invalid_username")
    if account["kind"] == "caldav" and not account["username"]:
        raise ValueError("missing_username")
    if type(account.get("syncMinutes")) is not int or not 1 <= account["syncMinutes"] <= 1440:
        raise ValueError("invalid_sync")


class CalDavHttp:
    def __init__(self, test_host: str | None = None, test_port: int | None = None, test_ssl: ssl.SSLContext | None = None):
        self.test_host, self.test_port, self.test_ssl = test_host, test_port, test_ssl

    def request(self, url: str, method: str, username: str, password: str, body: bytes = b"", headers: dict | None = None) -> tuple[int, dict, bytes]:
        safe_url(url)
        parts = urlsplit(url)
        if not self.test_host:
            addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(entry[4][0]).is_global for entry in addresses):
                raise ValueError("private_host")
            address, port = addresses[0][4][0], 443
            context = ssl.create_default_context()
        else:
            address, port, context = self.test_host, self.test_port, self.test_ssl
        raw = socket.create_connection((address, port), timeout=12)
        try:
            secured = context.wrap_socket(raw, server_hostname=parts.hostname)
            connection = http.client.HTTPConnection(parts.hostname, 443, timeout=12)
            connection.sock = secured
            path = parts.path or "/"
            if parts.query:
                path += "?" + parts.query
            auth = base64.b64encode((username + ":" + password).encode()).decode()
            send = {"Host": parts.hostname, "Authorization": "Basic " + auth,
                    "User-Agent": "Friday-Calendar/2", "Accept": "application/xml, text/calendar",
                    "Content-Length": str(len(body)), **(headers or {})}
            connection.request(method, path, body=body, headers=send)
            response = connection.getresponse()
            content = response.read(MAX_XML + 1)
            if len(content) > MAX_XML:
                raise ValueError("response_too_large")
            return response.status, {key.lower(): value for key, value in response.getheaders()}, content
        finally:
            raw.close()


def xml(payload: bytes) -> ET.Element:
    if len(payload) > MAX_XML or b"<!DOCTYPE" in payload.upper() or b"<!ENTITY" in payload.upper():
        raise ValueError("invalid_xml")
    return ET.fromstring(payload)


def propfind(http: CalDavHttp, url: str, username: str, password: str, depth: int, properties: str) -> ET.Element:
    body = ('<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" '
            'xmlns:a="http://apple.com/ns/ical/"><d:prop>' + properties + '</d:prop></d:propfind>').encode()
    status, _, data = http.request(url, "PROPFIND", username, password, body,
                                   {"Depth": str(depth), "Content-Type": "application/xml; charset=utf-8"})
    if status != 207:
        raise ValueError("auth_failed" if status in (401, 403) else "discovery_failed")
    return xml(data)


def successful_property(response: ET.Element, path: str) -> ET.Element | None:
    for propstat in response.findall(DAV + "propstat"):
        status = propstat.findtext(DAV + "status") or ""
        if not re.search(r"\s2\d\d(?:\s|$)", status):
            continue
        prop = propstat.find(DAV + "prop")
        found = prop.find(path) if prop is not None else None
        if found is not None:
            return found
    return None


def extract_url(base: str, node: ET.Element | None) -> str | None:
    value = node.findtext(DAV + "href") if node is not None else None
    return href(base, value) if value else None


def discover(http: CalDavHttp, account: dict, password: str) -> list[dict]:
    base, user = account["baseUrl"], account["username"]
    root = propfind(http, base, user, password, 0, "<d:current-user-principal/>")
    principal = next((value for response in root.findall(DAV + "response")
                      if (value := extract_url(base, successful_property(response, DAV + "current-user-principal")))), None)
    if not principal:
        raise ValueError("principal_missing")
    principal_doc = propfind(http, principal, user, password, 0, "<c:calendar-home-set/>")
    home = next((value for response in principal_doc.findall(DAV + "response")
                 if (value := extract_url(principal, successful_property(response, CAL + "calendar-home-set")))), None)
    if not home:
        raise ValueError("home_missing")
    listing = propfind(http, home, user, password, 1,
                       "<d:resourcetype/><d:displayname/><d:current-user-privilege-set/><a:calendar-color/><c:calendar-timezone/>")
    result = []
    for response in listing.findall(DAV + "response"):
        target = extract_url(home, response)
        if not target:
            continue
        calendar = successful_property(response, DAV + "resourcetype/" + CAL + "calendar")
        if calendar is None:
            continue
        privileges = successful_property(response, DAV + "current-user-privilege-set")
        readable = privileges is not None and (privileges.find(".//" + DAV + "read") is not None or
                                                  privileges.find(".//" + DAV + "all") is not None)
        writable = privileges is not None and (privileges.find(".//" + DAV + "all") is not None or
                                                   privileges.find(".//" + DAV + "write") is not None or
                                                   privileges.find(".//" + DAV + "write-content") is not None)
        color = (node.text if (node := successful_property(response, APPLE + "calendar-color")) is not None else None)
        zone = (node.text if (node := successful_property(response, CAL + "calendar-timezone")) is not None else None)
        zone_match = re.search(r"(?m)^TZID:([^\r\n]{1,100})", zone or "")
        cal_id = hashlib.sha256(target.encode()).hexdigest()[:20]
        name = successful_property(response, DAV + "displayname")
        result.append({"id": cal_id, "url": target, "name": name.text if name is not None and name.text else cal_id,
                       "color": color if color and re.fullmatch(r"#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?", color) else None,
                       "timeZone": zone_match[1] if zone_match else None,
                       "canRead": readable, "canWrite": writable, "selected": True})
        if len(result) > 100:
            raise ValueError("too_many_calendars")
    return result


def token(account: str, calendar: str, url: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([account, calendar, url], separators=(",", ":")).encode()).decode().rstrip("=")


def untoken(value: str, account: dict, calendar: dict) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise ValueError("invalid_event_id")
    try:
        data = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
    except (ValueError, UnicodeError):
        raise ValueError("invalid_event_id") from None
    if not isinstance(data, list) or len(data) != 3 or data[:2] != [account["id"], calendar["id"]]:
        raise ValueError("wrong_calendar")
    target = safe_url(data[2], calendar["url"])
    if not target.startswith(calendar["url"]) or not target.endswith(".ics"):
        raise ValueError("wrong_calendar")
    return target


def calendar_for(account: dict, cal_id: str, write: bool = False) -> dict:
    cal = next((item for item in account.get("calendars", []) if item["id"] == cal_id and item.get("selected")), None)
    if not cal:
        raise KeyError("calendar_not_selected")
    if not cal.get("canRead") or write and not cal.get("canWrite"):
        raise ValueError("read_only")
    return cal


def list_events(http: CalDavHttp, account: dict, calendar: dict, password: str, start: str, end: str) -> list[dict]:
    def timestamp(value: str) -> str:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("invalid_range")
        return parsed.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    body = ('<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
            '<d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">'
            '<c:comp-filter name="VEVENT"><c:time-range start="' + timestamp(start) + '" end="' + timestamp(end) +
            '"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>').encode()
    status, _, response = http.request(calendar["url"], "REPORT", account["username"], password, body,
                                       {"Depth": "1", "Content-Type": "application/xml; charset=utf-8"})
    if status != 207:
        raise ValueError("auth_failed" if status in (401, 403) else "read_failed")
    root = xml(response)
    items = []
    for element in root.findall(DAV + "response"):
        target = extract_url(calendar["url"], element)
        body_node = successful_property(element, CAL + "calendar-data")
        etag_node = successful_property(element, DAV + "getetag")
        payload = body_node.text if body_node is not None else None
        etag = etag_node.text if etag_node is not None else None
        if not target or not target.startswith(calendar["url"]) or not payload or not etag or not payload.startswith("BEGIN:VCALENDAR"):
            continue
        items.append({"id": token(account["id"], calendar["id"], target), "etag": etag,
                      "calendarId": calendar["id"], "data": payload})
        if len(items) > 500:
            raise ValueError("too_many_events")
    return items


def ical(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "").replace(";", "\\;").replace(",", "\\,")


def event_properties(document: str) -> tuple[list[str], list[list[str]]]:
    """Unfold RFC5545 content lines and retain VEVENT blocks for safe mutation checks."""
    raw = document.replace("\r\n", "\n").split("\n")
    lines = []
    for line in raw:
        if line.startswith((" ", "\t")) and lines:
            lines[-1] += line[1:]
        elif line:
            lines.append(line)
    blocks, current = [], None
    for line in lines:
        if line.upper() == "BEGIN:VEVENT":
            if current is not None:
                raise ValueError("invalid_event")
            current = []
        elif line.upper() == "END:VEVENT":
            if current is None:
                raise ValueError("invalid_event")
            blocks.append(current)
            current = None
        elif current is not None:
            current.append(line)
    if current is not None:
        raise ValueError("invalid_event")
    return lines, blocks


def property_values(block: list[str], name: str) -> list[str]:
    values, depth = [], 0
    for line in block:
        if line.upper().startswith("BEGIN:"):
            depth += 1
        elif line.upper().startswith("END:"):
            depth -= 1
        elif depth == 0 and ":" in line and line.split(":", 1)[0].split(";", 1)[0].upper() == name:
            values.append(line.split(":", 1)[1])
    return values


def event_ranges(lines: list[str]) -> list[tuple[int, int, list[str]]]:
    result, start, depth = [], None, 0
    for index, line in enumerate(lines):
        if line.upper() == "BEGIN:VEVENT" and start is None:
            start, depth = index, 0
        elif start is not None and line.upper().startswith("BEGIN:"):
            depth += 1
        elif start is not None and line.upper().startswith("END:") and line.upper() != "END:VEVENT":
            depth -= 1
        elif line.upper() == "END:VEVENT" and start is not None and depth == 0:
            result.append((start, index, lines[start + 1:index]))
            start = None
    if start is not None:
        raise ValueError("invalid_event")
    return result


def property_line(block: list[str], name: str) -> str | None:
    depth = 0
    for line in block:
        if line.upper().startswith("BEGIN:"):
            depth += 1
        elif line.upper().startswith("END:"):
            depth -= 1
        elif depth == 0 and ":" in line and line.split(":", 1)[0].split(";", 1)[0].upper() == name:
            return line
    return None


def replace_property(block: list[str], name: str, value: str | None) -> list[str]:
    result, inserted, depth = [], False, 0
    for line in block:
        if line.upper().startswith("BEGIN:"):
            depth += 1
        elif line.upper().startswith("END:"):
            depth -= 1
        if depth == 0 and ":" in line and line.split(":", 1)[0].split(";", 1)[0].upper() == name:
            if value is not None and not inserted:
                result.append(value)
                inserted = True
        else:
            result.append(line)
    if value is not None and not inserted:
        result.insert(0, value)
    return result


def formatted_date(original: str, value: str, all_day: bool) -> str:
    key = original.split(":", 1)[0]
    if all_day:
        if "VALUE=DATE" not in key.upper():
            raise ValueError("invalid_date")
        return key + ":" + dt.date.fromisoformat(value[:10]).strftime("%Y%m%d")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("invalid_date")
    if "TZID=" in key.upper():
        zone_name = next((part.split("=", 1)[1] for part in key.split(";") if part.upper().startswith("TZID=")), "")
        try:
            return key + ":" + parsed.astimezone(ZoneInfo(zone_name)).strftime("%Y%m%dT%H%M%S")
        except ZoneInfoNotFoundError:
            raise ValueError("invalid_date") from None
    if original.endswith("Z"):
        return key + ":" + parsed.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    raise ValueError("unsupported_timezone")


def update_document(prior: str, event: dict, scope: str) -> bytes:
    lines, blocks = event_properties(prior)
    ranges = event_ranges(lines)
    masters = [(start, end, block) for start, end, block in ranges if not property_values(block, "RECURRENCE-ID")]
    if len(masters) != 1:
        raise ValueError("invalid_event")
    start, end, block = masters[0]
    recurring = any(property_values(block, name) for name in ("RRULE", "RDATE", "EXDATE")) or len(ranges) > 1
    if recurring and scope != "series":
        raise ValueError("scope_required")
    original_start, original_end = property_line(block, "DTSTART"), property_line(block, "DTEND")
    if not original_start or not original_end:
        raise ValueError("invalid_event")
    all_day = "VALUE=DATE" in original_start.split(":", 1)[0].upper()
    if bool(event.get("allDay")) != all_day:
        raise ValueError("invalid_date")
    new_start = formatted_date(original_start, event.get("start", ""), all_day)
    new_end = formatted_date(original_end, event.get("end", ""), all_day)
    if new_end.split(":", 1)[1] <= new_start.split(":", 1)[1]:
        raise ValueError("invalid_range")
    if recurring and len(ranges) > 1 and (new_start != original_start or new_end != original_end):
        raise ValueError("unsupported_series")
    if recurring and any(property_values(block, name) for name in ("EXDATE", "RDATE")) and (new_start != original_start or new_end != original_end):
        raise ValueError("unsupported_series")
    title = event.get("title")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
        raise ValueError("invalid_title")
    for name, value in (("DTSTART", new_start), ("DTEND", new_end), ("SUMMARY", "SUMMARY:" + ical(title)),
                        ("DESCRIPTION", "DESCRIPTION:" + ical(str(event["description"])) if "description" in event else None),
                        ("LOCATION", "LOCATION:" + ical(str(event["location"])) if "location" in event else None)):
        if value is not None:
            block = replace_property(block, name, value)
    if property_values(block, "SEQUENCE"):
        try:
            block = replace_property(block, "SEQUENCE", "SEQUENCE:" + str(int(property_values(block, "SEQUENCE")[0]) + 1))
        except ValueError:
            raise ValueError("invalid_event") from None
    block = replace_property(block, "DTSTAMP", "DTSTAMP:" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    lines[start + 1:end] = block
    output = "\r\n".join(lines + [""]).encode()
    if len(output) > MAX_XML:
        raise ValueError("event_too_large")
    return output


def occurrence_document(prior: str, event: dict | None, recurrence_id: str, remove: bool) -> bytes:
    lines, _ = event_properties(prior)
    ranges = event_ranges(lines)
    masters = [(start, end, block) for start, end, block in ranges if not property_values(block, "RECURRENCE-ID")]
    if len(masters) != 1:
        raise ValueError("invalid_event")
    master_start, master_end, master = masters[0]
    if not any(property_values(master, name) for name in ("RRULE", "RDATE")):
        raise ValueError("scope_required")
    template = property_line(master, "DTSTART")
    original_end = property_line(master, "DTEND")
    if not template or not original_end:
        raise ValueError("invalid_event")
    all_day = "VALUE=DATE" in template.split(":", 1)[0].upper()
    try:
        recurrence_line = formatted_date(template, recurrence_id, all_day).replace("DTSTART", "RECURRENCE-ID", 1)
    except (ValueError, TypeError):
        raise ValueError("invalid_recurrence_id") from None
    recurrence_value = recurrence_line.split(":", 1)[1]
    exceptions = [(start, end, block) for start, end, block in ranges if
                  property_line(block, "RECURRENCE-ID") and property_line(block, "RECURRENCE-ID").split(":", 1)[1] == recurrence_value]
    if len(exceptions) > 1:
        raise ValueError("invalid_event")
    excepted = exceptions[0] if exceptions else None
    if remove:
        if excepted:
            lines[excepted[0]:excepted[1] + 1] = []
            master_start, master_end, master = next((s, e, b) for s, e, b in event_ranges(lines) if not property_values(b, "RECURRENCE-ID"))
        excluded = any(recurrence_value in value.split(",") for value in property_values(master, "EXDATE"))
        if excluded:
            raise ValueError("etag_conflict")
        exdate = recurrence_line.replace("RECURRENCE-ID", "EXDATE", 1)
        master = [exdate] + master
        master = replace_property(master, "DTSTAMP", "DTSTAMP:" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        lines[master_start + 1:master_end] = master
    else:
        if not isinstance(event, dict) or bool(event.get("allDay")) != all_day:
            raise ValueError("invalid_date")
        base = list(excepted[2] if excepted else master)
        if not excepted:
            for name in ("RRULE", "RDATE", "EXDATE"):
                base = replace_property(base, name, None)
        start_template = property_line(base, "DTSTART") or template
        end_template = property_line(base, "DTEND") or original_end
        new_start = formatted_date(start_template, event.get("start", ""), all_day)
        new_end = formatted_date(end_template, event.get("end", ""), all_day)
        if new_end.split(":", 1)[1] <= new_start.split(":", 1)[1]:
            raise ValueError("invalid_range")
        title = event.get("title")
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
            raise ValueError("invalid_title")
        for name, value in (("RECURRENCE-ID", recurrence_line), ("DTSTART", new_start), ("DTEND", new_end),
                            ("SUMMARY", "SUMMARY:" + ical(title)),
                            ("DESCRIPTION", "DESCRIPTION:" + ical(str(event["description"])) if "description" in event else None),
                            ("LOCATION", "LOCATION:" + ical(str(event["location"])) if "location" in event else None)):
            if value is not None:
                base = replace_property(base, name, value)
        base = replace_property(base, "DTSTAMP", "DTSTAMP:" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        if excepted:
            lines[excepted[0] + 1:excepted[1]] = base
        else:
            end_calendar = next((index for index in range(len(lines) - 1, -1, -1) if lines[index].upper() == "END:VCALENDAR"), None)
            if end_calendar is None:
                raise ValueError("invalid_event")
            lines[end_calendar:end_calendar] = ["BEGIN:VEVENT", *base, "END:VEVENT"]
    output = "\r\n".join(lines + [""]).encode()
    if len(output) > MAX_XML:
        raise ValueError("event_too_large")
    return output


def document(event: dict, uid: str) -> bytes:
    title = event.get("title")
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120 or any(ord(ch) < 32 for ch in title):
        raise ValueError("invalid_title")
    all_day = event.get("allDay") is True
    def date(value: str) -> str:
        if all_day:
            return dt.date.fromisoformat(value).strftime("%Y%m%d")
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("invalid_date")
        return parsed.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    start, end = date(event.get("start", "")), date(event.get("end", ""))
    if end <= start:
        raise ValueError("invalid_range")
    qualifier = ";VALUE=DATE" if all_day else ""
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RogueKI//Friday Calendar//EN", "BEGIN:VEVENT",
             "UID:" + uid, "DTSTAMP:" + dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
             "DTSTART" + qualifier + ":" + start, "DTEND" + qualifier + ":" + end, "SUMMARY:" + ical(title)]
    if event.get("description"):
        lines.append("DESCRIPTION:" + ical(str(event["description"])[:2000]))
    if event.get("location"):
        lines.append("LOCATION:" + ical(str(event["location"])[:500]))
    if event.get("rrule"):
        if not re.fullmatch(r"FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,-]+){0,8}", event["rrule"]):
            raise ValueError("invalid_rrule")
        lines.append("RRULE:" + event["rrule"])
    lines.extend(["END:VEVENT", "END:VCALENDAR", ""])
    result = "\r\n".join(lines).encode()
    if len(result) > 8192:
        raise ValueError("event_too_large")
    return result


def main(request: dict, http: CalDavHttp | None = None) -> dict:
    http = http or CalDavHttp()
    action = request.get("action")
    if action == "pending-memory":
        return {"events": pending_memory()}
    if action == "ack-memory":
        return ack_memory(request.get("operationKey", ""))
    data = load()
    if action == "list":
        return {"revision": data["revision"], "defaultAccountId": data["defaultAccountId"],
                "accounts": [public(item) for item in data["accounts"]]}
    if action == "upsert":
        value = request.get("account") or {}
        account_id = value.get("id") or "cal-" + uuid.uuid4().hex[:16]
        existing = next((item for item in data["accounts"] if item["id"] == account_id), None)
        expected = request.get("expectedRevision")
        if existing and expected != existing["revision"] or not existing and expected is not None:
            raise ValueError("revision_conflict")
        kind = value.get("kind")
        entered_url = value.get("baseUrl")
        if existing and existing["kind"] != kind and kind == "caldav" and not request.get("password"):
            raise ValueError("missing_secret")
        if kind == "ics":
            if not entered_url and existing and existing["kind"] == "ics":
                entered_url = read_secret(account_id)
            safe_url(entered_url)
            visible_url = "https://" + urlsplit(entered_url).hostname + "/"
        else:
            visible_url = entered_url
        preserve_discovery = (existing is not None and existing["kind"] == kind and
                              existing["baseUrl"] == visible_url and existing["username"] == value.get("username", ""))
        account = {"id": account_id, "kind": kind, "displayName": value.get("displayName"),
                   "baseUrl": visible_url, "username": value.get("username", ""),
                   "syncMinutes": value.get("syncMinutes", 15), "revision": (existing or {}).get("revision", 0) + 1,
                   "calendars": existing.get("calendars", []) if preserve_discovery else [],
                   "defaultCalendarId": existing.get("defaultCalendarId") if preserve_discovery else None}
        validate_account(account)
        secret = request.get("password")
        if kind == "ics":
            atomic(secret_path(account_id), entered_url.encode())
            secret = None
        if secret is not None:
            if not isinstance(secret, str) or len(secret) > 4096:
                raise ValueError("invalid_secret")
            if secret:
                atomic(secret_path(account_id), secret.encode())
            elif secret_path(account_id).exists():
                secret_path(account_id).unlink()
        data["accounts"] = [account if item["id"] == account_id else item for item in data["accounts"]] if existing else data["accounts"] + [account]
        if data["defaultAccountId"] is None:
            data["defaultAccountId"] = account_id
        data["revision"] += 1
        save(data)
        return public(account)
    account = account_for(data, request.get("accountId", ""))
    if action in ("delete", "select", "default", "discover") and request.get("expectedRevision") != account["revision"]:
        raise ValueError("revision_conflict")
    if action == "delete":
        data["accounts"] = [item for item in data["accounts"] if item["id"] != account["id"]]
        if data["defaultAccountId"] == account["id"]:
            data["defaultAccountId"] = data["accounts"][0]["id"] if data["accounts"] else None
        data["revision"] += 1
        save(data)
        path = secret_path(account["id"])
        if path.exists() and not path.is_symlink():
            path.unlink()
        return {"deleted": True}
    if action == "discover":
        if account["kind"] != "caldav":
            return {"calendars": [], "readOnly": True}
        calendars = discover(http, account, read_secret(account["id"]))
        old = {item["id"]: item for item in account["calendars"]}
        for calendar in calendars:
            calendar["selected"] = old.get(calendar["id"], {}).get("selected", True)
        account["calendars"] = calendars
        if not any(item["id"] == account["defaultCalendarId"] and item["canWrite"] for item in calendars):
            account["defaultCalendarId"] = next((item["id"] for item in calendars if item["canWrite"] and item["selected"]), None)
        account["revision"] += 1
        data["revision"] += 1
        save(data)
        return public(account)
    if action == "select":
        selected = request.get("selectedIds")
        default_id = request.get("defaultCalendarId")
        ids = {item["id"] for item in account["calendars"]}
        if not isinstance(selected, list) or not set(selected) <= ids or default_id not in (None, *ids):
            raise ValueError("invalid_selection")
        for item in account["calendars"]:
            item["selected"] = item["id"] in selected
        if default_id and not any(item["id"] == default_id and item["selected"] and item["canWrite"] for item in account["calendars"]):
            raise ValueError("read_only")
        account["defaultCalendarId"] = default_id
        account["revision"] += 1
        data["revision"] += 1
        save(data)
        return public(account)
    if action == "default":
        data["defaultAccountId"] = account["id"]
        data["revision"] += 1
        save(data)
        return {"revision": data["revision"], "defaultAccountId": account["id"]}
    if account["kind"] == "ics":
        if action != "events":
            raise ValueError("read_only")
        # A private ICS feed has no mutation semantics; explicit account source remains read-only.
        feed_url = read_secret(account["id"])
        status, _, payload = http.request(feed_url, "GET", "", "", headers={"Accept": "text/calendar"})
        if status != 200 or not payload.startswith(b"BEGIN:VCALENDAR"):
            raise ValueError("read_failed")
        return {"items": [{"id": "feed:" + account["id"], "calendarId": "ics",
                           "etag": "", "data": payload.decode("utf-8")}], "readOnly": True}
    password = read_secret(account["id"])
    cal_id = request.get("calendarId") or account.get("defaultCalendarId")
    calendar = calendar_for(account, cal_id, write=action in ("create", "update", "delete-event", "write-test"))
    if action == "events":
        return {"items": list_events(http, account, calendar, password, request["from"], request["to"]), "readOnly": not calendar["canWrite"]}
    if action == "check":
        report = propfind(http, calendar["url"], account["username"], password, 0, "<d:resourcetype/><d:current-user-privilege-set/>")
        privileges = next((node for response in report.findall(DAV + "response")
                           if (node := successful_property(response, DAV + "current-user-privilege-set")) is not None), None)
        return {"ok": True, "canRead": privileges is not None and (privileges.find(".//" + DAV + "all") is not None or
                                                         privileges.find(".//" + DAV + "read") is not None),
                "canWrite": privileges is not None and (privileges.find(".//" + DAV + "all") is not None or
                                                         privileges.find(".//" + DAV + "write") is not None or
                                                         privileges.find(".//" + DAV + "write-content") is not None)}
    if action == "write-test":
        # Explicit probe only: one uniquely named event, read back, then removed again.
        if account["kind"] != "caldav" or not calendar["canWrite"]:
            raise ValueError("read_only")
        uid = "friday-selftest-" + os.urandom(8).hex()
        target = href(calendar["url"], uid + ".ics")
        start = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) + dt.timedelta(days=365)
        probe = {"title": "Friday Schreibtest", "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                 "end": (start + dt.timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")}
        status, headers, _ = http.request(target, "PUT", account["username"], password,
                                          document(probe, uid + "@friday.local"),
                                          {"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        read_headers: dict = {}
        try:
            if status not in (201, 204):
                raise ValueError("write_failed")
            read_status, read_headers, read_body = http.request(target, "GET", account["username"], password)
            if read_status != 200 or uid.encode() not in read_body:
                raise ValueError("write_not_confirmed")
        finally:
            etag = read_headers.get("etag") or headers.get("etag")
            cleaned = False
            if etag:
                try:
                    removed, _, _ = http.request(target, "DELETE", account["username"], password, headers={"If-Match": etag})
                    cleaned = removed in (200, 204, 404)
                except (OSError, TimeoutError, ssl.SSLError):
                    cleaned = False
        if not cleaned:
            raise ValueError("cleanup_failed")
        return {"ok": True, "calendarId": calendar["id"], "uid": uid, "cleaned": True}
    if action == "create":
        uid = request.get("uid")
        if not isinstance(uid, str) or not re.fullmatch(r"[a-f0-9]{32}", uid):
            raise ValueError("invalid_uid")
        target = href(calendar["url"], uid + ".ics")
        body = document(request["event"], uid + "@friday.local")
        key = request.get("operationKey")
        payload = {"action": action, "accountId": account["id"], "calendarId": calendar["id"], "uid": uid, "event": request["event"]}
        meta = {"action": "create", "identityId": request.get("identityId"), "channel": request.get("channel", "dashboard")}
        replay, created_at = journal_reserve(key, payload, meta)
        if replay:
            return replay
        try:
            status, headers, _ = http.request(target, "PUT", account["username"], password, body,
                                              {"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        except (OSError, TimeoutError, ssl.SSLError):
            return journal_finish(key, {"state": "uncertain", "id": token(account["id"], calendar["id"], target), "etag": None, "createdAt": created_at})
        if status == 412:
            journal_forget(key)
            raise ValueError("etag_conflict")
        if status not in (201, 204):
            return journal_finish(key, {"state": "uncertain", "id": token(account["id"], calendar["id"], target), "etag": None, "createdAt": created_at})
        return journal_finish(key, {"state": "created", "id": token(account["id"], calendar["id"], target), "etag": headers.get("etag"), "createdAt": created_at})
    target = untoken(request.get("eventId", ""), account, calendar)
    etag = request.get("etag")
    if not isinstance(etag, str) or not 1 <= len(etag) <= 200 or "\r" in etag or "\n" in etag:
        raise ValueError("etag_required")
    key = request.get("operationKey")
    payload = {"action": action, "accountId": account["id"], "calendarId": calendar["id"],
               "eventId": request["eventId"], "etag": etag, "event": request.get("event"), "scope": request.get("scope", "single"),
               "recurrenceId": request.get("recurrenceId")}
    replay = journal_lookup(key, payload)
    if replay:
        return replay
    # Never flatten an existing recurrence with detached instances into one event.
    prior_status, prior_headers, prior_body = http.request(target, "GET", account["username"], password)
    if prior_status != 200:
        raise ValueError("etag_conflict" if prior_status == 404 else "read_failed")
    if prior_headers.get("etag") != etag:
        raise ValueError("etag_conflict")
    prior_text = prior_body.decode("utf-8")
    _, blocks = event_properties(prior_text)
    masters = [block for block in blocks if not property_values(block, "RECURRENCE-ID")]
    if len(masters) != 1:
        raise ValueError("invalid_event")
    recurring = len(blocks) > 1 or any(property_values(masters[0], name) for name in ("RRULE", "RDATE", "EXDATE"))
    scope = request.get("scope", "single")
    if scope not in ("single", "series", "occurrence") or recurring and scope == "single":
        raise ValueError("scope_required")
    if scope == "occurrence" and not recurring:
        raise ValueError("scope_required")
    uids = property_values(masters[0], "UID")
    if len(uids) != 1 or len(uids[0]) > 255:
        raise ValueError("invalid_event")
    if action == "update":
        body = occurrence_document(prior_text, request["event"], request.get("recurrenceId", ""), False) if scope == "occurrence" else update_document(prior_text, request["event"], scope)
        replay, created_at = journal_reserve(key, payload, {"action": "update", "identityId": request.get("identityId"), "channel": request.get("channel", "dashboard")})
        if replay:
            return replay
        try:
            status, headers, _ = http.request(target, "PUT", account["username"], password, body,
                                              {"Content-Type": "text/calendar; charset=utf-8", "If-Match": etag})
        except (OSError, TimeoutError, ssl.SSLError):
            return journal_finish(key, {"state": "uncertain", "id": request["eventId"], "etag": None, "createdAt": created_at})
        if status == 412:
            journal_forget(key)
            raise ValueError("etag_conflict")
        if status not in (200, 204):
            return journal_finish(key, {"state": "uncertain", "id": request["eventId"], "etag": None, "createdAt": created_at})
        return journal_finish(key, {"state": "updated", "id": request["eventId"], "etag": headers.get("etag"), "createdAt": created_at})
    if action == "delete-event":
        occurrence_body = occurrence_document(prior_text, None, request.get("recurrenceId", ""), True) if scope == "occurrence" else None
        replay, created_at = journal_reserve(key, payload, {"action": "delete", "identityId": request.get("identityId"), "channel": request.get("channel", "dashboard")})
        if replay:
            return replay
        try:
            if occurrence_body:
                status, _, _ = http.request(target, "PUT", account["username"], password, occurrence_body,
                                            {"Content-Type": "text/calendar; charset=utf-8", "If-Match": etag})
            else:
                status, _, _ = http.request(target, "DELETE", account["username"], password, headers={"If-Match": etag})
        except (OSError, TimeoutError, ssl.SSLError):
            return journal_finish(key, {"state": "uncertain", "id": request["eventId"], "createdAt": created_at})
        if status == 412:
            journal_forget(key)
            raise ValueError("etag_conflict")
        if status not in ((200, 204) if occurrence_body else (204,)):
            return journal_finish(key, {"state": "uncertain", "id": request["eventId"], "createdAt": created_at})
        return journal_finish(key, {"state": "deleted", "id": request["eventId"], "createdAt": created_at})
    raise ValueError("unknown_action")


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if ROOT.is_symlink():
            raise ValueError("unsafe_path")
        ROOT.mkdir(parents=True, mode=0o700, exist_ok=True)
        lock = ROOT / ".lock"
        with lock.open("a+b") as handle:
            os.fchmod(handle.fileno(), 0o600)
            fcntl.flock(handle, fcntl.LOCK_EX)
            print(json.dumps(main(request), ensure_ascii=False))
    except (ValueError, KeyError, OSError, ET.ParseError, ssl.SSLError) as error:
        print(json.dumps({"error": str(error) if str(error) in {
            "revision_conflict", "account_not_found", "invalid_selection", "read_only", "etag_conflict", "etag_required",
            "auth_failed", "discovery_failed", "principal_missing", "home_missing", "read_failed", "write_failed",
            "calendar_not_selected", "missing_secret", "too_many_events", "too_many_calendars", "unsupported_series",
            "invalid_event", "invalid_range", "invalid_date", "invalid_rrule", "invalid_title", "invalid_url",
            "private_host", "cross_origin", "response_too_large", "scope_required", "unsupported_occurrence",
            "unsupported_timezone", "operation_key_required", "operation_conflict", "invalid_recurrence_id"} else "calendar_unavailable"}))
        sys.exit(3)
