#!/usr/bin/env python3
"""Bounded credential-free MCP HTTP handshake with a pinned public-IP TLS dial."""

import http.client
import ipaddress
import json
import socket
import ssl
from urllib.parse import urlsplit

from hermes_mcp_http_apply import valid_url

MAX_RESPONSE = 65536
PROTOCOL = "2025-03-26"


class ProbeFailure(Exception):
    def __init__(self, failure_class):
        self.failure_class = failure_class


def public_address(host):
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
            raise ProbeFailure("private_or_unresolved_address")
        return addresses[0][4][0]
    except (OSError, ValueError):
        raise ProbeFailure("private_or_unresolved_address") from None


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, address):
        super().__init__(hostname, 443, timeout=8, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        # The socket never resolves the hostname again; TLS still verifies that hostname.
        plain = socket.create_connection((self.address, 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(plain, server_hostname=self.host)
        except BaseException:
            plain.close()
            raise


def response_message(response, request_id):
    if response.status in (401, 403):
        raise ProbeFailure("auth_required")
    if response.status in (301, 302, 303, 307, 308):
        raise ProbeFailure("redirect_rejected")
    if response.status != 200:
        raise ProbeFailure("protocol_failed")
    content_type = response.getheader("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type not in ("application/json", "text/event-stream"):
        raise ProbeFailure("protocol_failed")
    body = bytearray()
    while len(body) <= MAX_RESPONSE:
        chunk = response.read1(min(4096, MAX_RESPONSE + 1 - len(body)))
        if not chunk:
            break
        body.extend(chunk)
        if content_type == "application/json":
            try:
                parsed = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(parsed, dict) and parsed.get("id") == request_id:
                return parsed
        else:
            normalized = bytes(body).replace(b"\r\n", b"\n")
            for event in normalized.split(b"\n\n")[:-1]:
                payload = b"\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith(b"data:"))
                if not payload:
                    continue
                try:
                    parsed = json.loads(payload)
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(parsed, dict) and parsed.get("id") == request_id:
                    return parsed
    raise ProbeFailure("protocol_failed")


def request(connection, path, payload, session=None, protocol=None):
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if session:
        headers["Mcp-Session-Id"] = session
    if protocol:
        headers["MCP-Protocol-Version"] = protocol
    connection.request("POST", path, json.dumps(payload, separators=(",", ":")), headers)
    return connection.getresponse()


def probe(url):
    if not valid_url(url):
        raise ProbeFailure("config_invalid")
    parsed = urlsplit(url)
    connection = PinnedHTTPSConnection(parsed.hostname, public_address(parsed.hostname))
    path = parsed.path or "/"
    try:
        first = request(connection, path, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": PROTOCOL, "capabilities": {},
                       "clientInfo": {"name": "friday-mcp-probe", "version": "1"}}})
        session = first.getheader("Mcp-Session-Id")
        if session is not None and (not 1 <= len(session) <= 256 or any(ord(ch) < 33 or ord(ch) > 126 for ch in session)):
            raise ProbeFailure("protocol_failed")
        initialized = response_message(first, 1)
        result = initialized.get("result")
        if not isinstance(result, dict) or result.get("protocolVersion") != PROTOCOL:
            raise ProbeFailure("protocol_unsupported")
        notice = request(connection, path, {"jsonrpc": "2.0", "method": "notifications/initialized"}, session, PROTOCOL)
        if notice.status not in (200, 202, 204):
            raise ProbeFailure("protocol_failed")
        if len(notice.read(MAX_RESPONSE + 1)) > MAX_RESPONSE:
            raise ProbeFailure("protocol_failed")
        listed = request(connection, path, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}, session, PROTOCOL)
        listing = response_message(listed, 2)
        tools = listing.get("result", {}).get("tools") if isinstance(listing.get("result"), dict) else None
        if not isinstance(tools, list) or len(tools) > 10000:
            raise ProbeFailure("protocol_failed")
        return {"connected": True, "toolCount": len(tools), "toolCountComplete":
                not bool(listing["result"].get("nextCursor")), "failureClass": None}
    except (OSError, ssl.SSLError, http.client.HTTPException):
        raise ProbeFailure("connect_failed") from None
    finally:
        connection.close()
