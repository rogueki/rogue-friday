"""Controlled HTTPS CalDAV fixture: actual PROPFIND, REPORT, conditional PUT/DELETE."""
import http.server
import hashlib
import json
from pathlib import Path
import ssl
import socket
import subprocess
import tempfile
import threading
import unittest
import xml.etree.ElementTree as ET

import calendar_accounts as calendar

ORIGIN = "https://calendar.example.test"
PREFIX = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'


class Fixture(http.server.BaseHTTPRequestHandler):
    event = None
    etag = '"v1"'
    methods = []
    drop_after_put = False
    suppress_readback = False

    def log_message(self, *_args):
        pass

    def send(self, status, content=b"", content_type="application/xml", etag=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_PROPFIND(self):
        Fixture.methods.append(("PROPFIND", self.path, self.headers.get("Depth")))
        length = int(self.headers["Content-Length"])
        self.rfile.read(length)
        if self.path == "/":
            prop = '<d:current-user-principal><d:href>/principals/alice/</d:href></d:current-user-principal>'
        elif self.path == "/principals/alice/":
            prop = '<c:calendar-home-set><d:href>/homes/alice/</d:href></c:calendar-home-set>'
        elif self.path in ("/homes/alice/", "/homes/alice/writable/", "/homes/alice/readonly/"):
            prop = ""
        else:
            self.send(404); return
        if self.path == "/homes/alice/":
            def collection(path, name, writable):
                rights = "<d:privilege><d:read/></d:privilege>" + ("<d:privilege><d:write/></d:privilege>" if writable else "")
                return (f"<d:response><d:href>{path}</d:href><d:propstat><d:prop><d:resourcetype><c:calendar/></d:resourcetype>"
                        f"<d:displayname>{name}</d:displayname><d:current-user-privilege-set>{rights}</d:current-user-privilege-set>"
                        "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>")
            self.send(207, (PREFIX + collection("/homes/alice/writable/", "Work", True) +
                            collection("/homes/alice/readonly/", "Shared", False) + "</d:multistatus>").encode())
        else:
            self.send(207, (PREFIX + f"<d:response><d:href>{self.path}</d:href><d:propstat><d:prop>{prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>").encode())

    def do_REPORT(self):
        Fixture.methods.append(("REPORT", self.path, self.headers.get("Depth")))
        length = int(self.headers["Content-Length"])
        body = self.rfile.read(length)
        if b"time-range" not in body:
            self.send(400); return
        resource = ""
        if Fixture.event:
            resource = (f"<d:response><d:href>{self.path}demo.ics</d:href><d:propstat><d:prop>"
                        f"<d:getetag>{Fixture.etag}</d:getetag><c:calendar-data>{Fixture.event.decode()}</c:calendar-data>"
                        "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>")
        self.send(207, (PREFIX + resource + "</d:multistatus>").encode())

    def do_GET(self):
        Fixture.methods.append(("GET", self.path, None))
        if Fixture.suppress_readback:
            self.send(200, b"", "text/calendar", Fixture.etag)
        else:
            self.send(200, Fixture.event, "text/calendar", Fixture.etag) if Fixture.event else self.send(404)

    def do_PUT(self):
        Fixture.methods.append(("PUT", self.path, self.headers.get("If-Match") or self.headers.get("If-None-Match")))
        body = self.rfile.read(int(self.headers["Content-Length"]))
        if self.headers.get("If-None-Match") == "*" and Fixture.event:
            self.send(412); return
        if self.headers.get("If-Match") and self.headers.get("If-Match") != Fixture.etag:
            self.send(412); return
        Fixture.event = body
        Fixture.etag = '"v2"' if self.headers.get("If-Match") else '"v1"'
        if Fixture.drop_after_put:
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.send(204 if self.headers.get("If-Match") else 201, etag=Fixture.etag)

    def do_DELETE(self):
        Fixture.methods.append(("DELETE", self.path, self.headers.get("If-Match")))
        if self.headers.get("If-Match") != Fixture.etag:
            self.send(412); return
        Fixture.event = None
        self.send(204)


class CalendarProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        calendar.ROOT = root / "calendar"
        calendar.MANIFEST = calendar.ROOT / "accounts.json"
        calendar.JOURNAL = calendar.ROOT / "actions.sqlite"
        cert, key = root / "cert.pem", root / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-keyout", str(key), "-out", str(cert), "-subj", "/CN=calendar.example.test"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        server = http.server.HTTPServer(("127.0.0.1", 0), Fixture)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        Fixture.event, Fixture.etag, Fixture.methods, Fixture.drop_after_put = None, '"v1"', [], False
        Fixture.suppress_readback = False
        self.http = calendar.CalDavHttp("127.0.0.1", server.server_port, ssl._create_unverified_context())

    def action(self, action, **kwargs):
        if action in ("create", "update", "delete-event"):
            kwargs.setdefault("operationKey", hashlib.sha256(f"{action}:{len(Fixture.methods)}:{kwargs.get('etag')}".encode()).hexdigest())
            kwargs.setdefault("identityId", "fixture-owner")
            kwargs.setdefault("channel", "dashboard")
        return calendar.main({"action": action, **kwargs}, self.http)

    def test_denied_propstat_cannot_grant_write_rights(self):
        response = ET.fromstring('<d:response xmlns:d="DAV:"><d:propstat><d:prop>'
                                 '<d:current-user-privilege-set><d:privilege><d:write/></d:privilege>'
                                 '</d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 403 Forbidden'
                                 '</d:status></d:propstat></d:response>')
        self.assertIsNone(calendar.successful_property(response, calendar.DAV + "current-user-privilege-set"))

    def test_switching_ics_to_caldav_requires_new_credentials(self):
        private = ORIGIN + "/feed.ics?token=private"
        account = self.action("upsert", account={"kind": "ics", "displayName": "Feed", "baseUrl": private,
                                                 "username": "", "syncMinutes": 15}, expectedRevision=None)
        replacement = {"id": account["id"], "kind": "caldav", "displayName": "Work",
                       "baseUrl": ORIGIN + "/", "username": "alice", "syncMinutes": 15}
        with self.assertRaisesRegex(ValueError, "missing_secret"):
            self.action("upsert", account=replacement, expectedRevision=account["revision"])
        switched = self.action("upsert", account=replacement, password="new-password", expectedRevision=account["revision"])
        self.assertEqual(switched["calendars"], [])
        self.assertEqual(calendar.read_secret(account["id"]), "new-password")

    def test_discovery_privileges_read_only_and_etag_round_trip(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Test", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        account = self.action("discover", accountId=account["id"], expectedRevision=1)
        self.assertEqual({item["name"] for item in account["calendars"]}, {"Work", "Shared"})
        write = next(item for item in account["calendars"] if item["canWrite"])
        read_only = next(item for item in account["calendars"] if not item["canWrite"])
        self.assertTrue(read_only["canRead"])
        event = {"title": "Fixture", "start": "2026-10-25T09:00:00Z", "end": "2026-10-25T10:00:00Z", "rrule": "FREQ=WEEKLY;COUNT=3"}
        with self.assertRaisesRegex(ValueError, "read_only"):
            self.action("create", accountId=account["id"], calendarId=read_only["id"], uid="a" * 32, event=event)
        create_key = hashlib.sha256(b"fixture-create").hexdigest()
        made = self.action("create", accountId=account["id"], calendarId=write["id"], uid="a" * 32, event=event,
                           operationKey=create_key)
        self.assertEqual((made["state"], made["etag"]), ("created", '"v1"'))
        before = len([item for item in Fixture.methods if item[0] == "PUT"])
        replay = self.action("create", accountId=account["id"], calendarId=write["id"], uid="a" * 32, event=event,
                             operationKey=create_key)
        self.assertEqual(replay, made)
        self.assertEqual(len([item for item in Fixture.methods if item[0] == "PUT"]), before)
        pending = self.action("pending-memory")["events"]
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["createdAt"], made["createdAt"])
        self.assertTrue(self.action("ack-memory", operationKey=create_key)["acknowledged"])
        self.assertEqual(self.action("pending-memory")["events"], [])
        listed = self.action("events", accountId=account["id"], calendarId=write["id"],
                             **{"from": "2026-10-20T00:00:00Z", "to": "2026-11-20T00:00:00Z"})
        self.assertEqual(listed["items"][0]["etag"], '"v1"')
        self.assertIn("RRULE:FREQ=WEEKLY;COUNT=3", listed["items"][0]["data"])
        with self.assertRaisesRegex(ValueError, "scope_required"):
            self.action("update", accountId=account["id"], calendarId=write["id"], eventId=made["id"], etag='"v1"', event=event)
        Fixture.event = Fixture.event.replace(b"RRULE:FREQ=WEEKLY;COUNT=3", b"EXDATE;TZID=Europe/Berlin:20261101T100000")
        revised = calendar.update_document(Fixture.event.decode(), {**event, "title": "Renamed"}, "series")
        self.assertIn(b"EXDATE;TZID=Europe/Berlin:20261101T100000", revised)
        self.assertIn(b"SUMMARY:Renamed", revised)
        with self.assertRaisesRegex(ValueError, "unsupported_series"):
            calendar.update_document(Fixture.event.decode(), {**event, "start": "2026-10-26T09:00:00Z", "end": "2026-10-26T10:00:00Z"}, "series")
        Fixture.event = calendar.document({key: value for key, value in event.items() if key != "rrule"}, "a" * 32 + "@friday.local")
        with self.assertRaisesRegex(ValueError, "etag_conflict"):
            self.action("update", accountId=account["id"], calendarId=write["id"], eventId=made["id"], etag='"old"', event=event)
        updated = self.action("update", accountId=account["id"], calendarId=write["id"], eventId=made["id"], etag='"v1"',
                              event={key: value for key, value in event.items() if key != "rrule"})
        self.assertEqual(updated["etag"], '"v2"')
        deleted = self.action("delete-event", accountId=account["id"], calendarId=write["id"], eventId=made["id"], etag='"v2"')
        self.assertEqual(deleted["state"], "deleted")
        self.assertEqual([entry[0] for entry in Fixture.methods if entry[0] in ("REPORT", "PUT", "DELETE")], ["PUT", "REPORT", "PUT", "DELETE"])

    def test_ics_secret_not_returned_and_all_day_exclusive(self):
        private = ORIGIN + "/feed.ics?token=fixture-private"
        account = self.action("upsert", account={"kind": "ics", "displayName": "Feed", "baseUrl": private,
                                                 "username": "", "syncMinutes": 15}, expectedRevision=None)
        self.assertNotIn("fixture-private", json.dumps(account))
        self.assertNotIn("fixture-private", calendar.MANIFEST.read_text())
        self.assertEqual(calendar.read_secret(account["id"]), private)
        body = calendar.document({"title": "All day", "start": "2026-10-25", "end": "2026-10-27", "allDay": True}, "fixture")
        self.assertIn(b"DTSTART;VALUE=DATE:20261025", body)
        self.assertIn(b"DTEND;VALUE=DATE:20261027", body)

    def test_transport_loss_replays_uncertain_without_second_put(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Test", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        discovered = self.action("discover", accountId=account["id"], expectedRevision=1)
        cal_id = next(item["id"] for item in discovered["calendars"] if item["canWrite"])
        event = {"title": "Uncertain", "start": "2026-10-25T09:00:00Z", "end": "2026-10-25T10:00:00Z"}
        operation_key = hashlib.sha256(b"lost-response").hexdigest()
        Fixture.drop_after_put = True
        first = self.action("create", accountId=account["id"], calendarId=cal_id, event=event,
                            uid="b" * 32, operationKey=operation_key)
        self.assertEqual(first["state"], "uncertain")
        Fixture.drop_after_put = False
        second = self.action("create", accountId=account["id"], calendarId=cal_id, event=event,
                             uid="b" * 32, operationKey=operation_key)
        self.assertEqual(second, first)
        self.assertEqual(len([item for item in Fixture.methods if item[0] == "PUT"]), 1)
        self.assertEqual(self.action("pending-memory")["events"][0]["state"], "uncertain")

    def test_occurrence_update_and_delete_preserve_tzid_master_and_etag(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Test", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        discovered = self.action("discover", accountId=account["id"], expectedRevision=1)
        cal_id = next(item["id"] for item in discovered["calendars"] if item["canWrite"])
        master = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fixture@example.test\r\n"
                  "DTSTART;TZID=Europe/Berlin:20261018T100000\r\nDTEND;TZID=Europe/Berlin:20261018T110000\r\n"
                  "SUMMARY:Original\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nATTENDEE:mailto:guest@example.test\r\n"
                  "END:VEVENT\r\nEND:VCALENDAR\r\n").encode()
        Fixture.event, Fixture.etag = master, '"v1"'
        event_id = calendar.token(account["id"], cal_id, ORIGIN + "/homes/alice/writable/demo.ics")
        selected = {"title": "Moved", "start": "2026-10-25T11:00:00Z", "end": "2026-10-25T12:00:00Z", "allDay": False}
        moved = self.action("update", accountId=account["id"], calendarId=cal_id, eventId=event_id, etag='"v1"',
                            scope="occurrence", recurrenceId="2026-10-25T09:00:00Z", event=selected)
        self.assertEqual(moved["etag"], '"v2"')
        self.assertIn(b"RECURRENCE-ID;TZID=Europe/Berlin:20261025T100000", Fixture.event)
        self.assertIn(b"DTSTART;TZID=Europe/Berlin:20261025T120000", Fixture.event)
        self.assertIn(b"ATTENDEE:mailto:guest@example.test", Fixture.event)
        self.assertIn(b"RRULE:FREQ=WEEKLY;COUNT=3", Fixture.event)
        removed = self.action("delete-event", accountId=account["id"], calendarId=cal_id, eventId=event_id, etag='"v2"',
                              scope="occurrence", recurrenceId="2026-10-25T09:00:00Z")
        self.assertEqual(removed["state"], "deleted")
        self.assertIn(b"EXDATE;TZID=Europe/Berlin:20261025T100000", Fixture.event)
        self.assertNotIn(b"RECURRENCE-ID", Fixture.event)
        self.assertIn(b"RRULE:FREQ=WEEKLY;COUNT=3", Fixture.event)
        self.assertEqual([entry[0] for entry in Fixture.methods if entry[0] == "PUT"], ["PUT", "PUT"])
        self.assertEqual([entry[2] for entry in Fixture.methods if entry[0] == "PUT"], ['"v1"', '"v2"'])

    def test_all_day_occurrence_uses_value_date(self):
        master = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:all-day@example.test\r\n"
                  "DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026\r\n"
                  "SUMMARY:Holiday\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
        moved = calendar.occurrence_document(master, {"title": "Holiday moved", "start": "2026-11-01", "end": "2026-11-03", "allDay": True},
                                             "2026-11-01T00:00:00Z", False)
        self.assertIn(b"RECURRENCE-ID;VALUE=DATE:20261101", moved)
        self.assertIn(b"DTEND;VALUE=DATE:20261103", moved)
        excluded = calendar.occurrence_document(moved.decode(), None, "2026-11-01T00:00:00Z", True)
        self.assertIn(b"EXDATE;VALUE=DATE:20261101", excluded)
        self.assertNotIn(b"RECURRENCE-ID", excluded)
    def test_write_test_confirms_and_removes_the_probe_event(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Probe", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        account = self.action("discover", accountId=account["id"], expectedRevision=1)
        write = next(item for item in account["calendars"] if item["canWrite"])
        read_only = next(item for item in account["calendars"] if not item["canWrite"])
        Fixture.methods.clear()
        result = self.action("write-test", accountId=account["id"], calendarId=write["id"])
        self.assertTrue(result["ok"])
        self.assertTrue(result["cleaned"])
        self.assertTrue(result["uid"].startswith("friday-selftest-"))
        self.assertEqual([entry[0] for entry in Fixture.methods], ["PUT", "GET", "DELETE"])
        self.assertIsNone(Fixture.event)
        with self.assertRaisesRegex(ValueError, "read_only"):
            self.action("write-test", accountId=account["id"], calendarId=read_only["id"])
        self.assertEqual([entry[0] for entry in Fixture.methods], ["PUT", "GET", "DELETE"])

    def test_write_test_cleans_up_when_the_readback_is_missing(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Probe", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        account = self.action("discover", accountId=account["id"], expectedRevision=1)
        write = next(item for item in account["calendars"] if item["canWrite"])
        Fixture.methods.clear()
        Fixture.suppress_readback = True
        with self.assertRaisesRegex(ValueError, "write_not_confirmed"):
            self.action("write-test", accountId=account["id"], calendarId=write["id"])
        self.assertEqual([entry[0] for entry in Fixture.methods], ["PUT", "GET", "DELETE"])
        self.assertIsNone(Fixture.event)

    def test_removing_an_account_sends_no_delete_for_server_calendars(self):
        account = self.action("upsert", account={"kind": "caldav", "displayName": "Entfernen", "baseUrl": ORIGIN + "/",
                                                 "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        account = self.action("discover", accountId=account["id"], expectedRevision=1)
        Fixture.methods.clear()
        self.assertTrue(self.action("delete", accountId=account["id"], expectedRevision=account["revision"])["deleted"])
        self.assertEqual([entry[0] for entry in Fixture.methods if entry[0] in ("PUT", "DELETE")], [])
        self.assertEqual(calendar.load()["accounts"], [])

    def test_failed_discovery_keeps_the_previous_account_active(self):
        first = self.action("upsert", account={"kind": "caldav", "displayName": "Aktiv", "baseUrl": ORIGIN + "/",
                                               "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        first = self.action("discover", accountId=first["id"], expectedRevision=1)
        self.assertEqual(calendar.load()["defaultAccountId"], first["id"])
        second = self.action("upsert", account={"kind": "caldav", "displayName": "Zweites", "baseUrl": ORIGIN + "/other/",
                                                "username": "alice", "syncMinutes": 15}, password="fixture-secret", expectedRevision=None)
        self.assertEqual(calendar.load()["defaultAccountId"], first["id"])
        with self.assertRaisesRegex(ValueError, "discovery_failed"):
            self.action("discover", accountId=second["id"], expectedRevision=second["revision"])
        data = calendar.load()
        self.assertEqual(data["defaultAccountId"], first["id"])
        kept = next(item for item in data["accounts"] if item["id"] == first["id"])
        self.assertEqual({item["name"] for item in kept["calendars"]}, {"Work", "Shared"})
        self.assertEqual(next(item for item in data["accounts"] if item["id"] == second["id"])["calendars"], [])

if __name__ == "__main__":
    unittest.main()
