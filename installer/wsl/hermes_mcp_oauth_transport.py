#!/usr/bin/env python3
"""Public-only, DNS-pinned HTTP transport for a Friday-managed Hermes OAuth flow."""

import asyncio
import http.client
import ipaddress
import json
import re
import socket
import ssl
from urllib.parse import urlsplit


MAX_REQUEST = 65536
MAX_RESPONSE = 262144
TIMEOUT_SECONDS = 8


class OAuthTransportFailure(Exception):
    def __init__(self, failure_class):
        self.failure_class = failure_class


def endpoint_parts(url):
    if not isinstance(url, str) or len(url) > 4096 or any(ord(ch) < 33 for ch in url):
        raise OAuthTransportFailure("invalid_endpoint")
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None or
                parsed.password is not None or parsed.fragment or parsed.port not in (None, 443)):
            raise OAuthTransportFailure("invalid_endpoint")
        host = parsed.hostname.rstrip(".").lower()
        if (not re.fullmatch(r"[A-Za-z0-9.-]+", host) or "." not in host or
                host == "localhost" or host.endswith(".localhost") or
                host.endswith(".local") or host.endswith(".internal")):
            raise OAuthTransportFailure("invalid_endpoint")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise OAuthTransportFailure("invalid_endpoint")
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        return host, path
    except ValueError:
        raise OAuthTransportFailure("invalid_endpoint") from None


def public_address(host):
    try:
        rows = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not rows or any(not ipaddress.ip_address(row[4][0]).is_global for row in rows):
            raise OAuthTransportFailure("private_or_unresolved_address")
        return rows[0][4][0]
    except (OSError, ValueError):
        raise OAuthTransportFailure("private_or_unresolved_address") from None


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, address):
        super().__init__(hostname, 443, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        plain = socket.create_connection((self.address, 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(plain, server_hostname=self.host)
        except BaseException:
            plain.close()
            raise


def bounded_response(response):
    # A token or discovery endpoint has a finite response; never wait on a
    # long-lived stream or allow an unbounded metadata document into memory.
    content_type = response.getheader("Content-Type", "").split(";", 1)[0].lower().strip()
    if response.getheader("Content-Encoding", "identity").lower().strip() != "identity":
        raise OAuthTransportFailure("encoding_unsupported")
    if content_type == "text/event-stream":
        # Some Streamable HTTP MCP servers keep initialize's SSE response open.
        # The OAuth worker asks only for initialize(id=1); take that one bounded
        # frame and close the socket, never wait for the stream to finish.
        from hermes_mcp_protocol_probe import ProbeFailure, response_message
        try:
            return json.dumps(response_message(response, 1), separators=(",", ":")).encode()
        except ProbeFailure:
            raise OAuthTransportFailure("stream_unsupported") from None
    size = response.getheader("Content-Length")
    if size is not None:
        try:
            if int(size) > MAX_RESPONSE:
                raise OAuthTransportFailure("response_too_large")
        except ValueError:
            raise OAuthTransportFailure("invalid_response") from None
    data = response.read(MAX_RESPONSE + 1)
    if len(data) > MAX_RESPONSE:
        raise OAuthTransportFailure("response_too_large")
    return data


def exchange(method, url, headers, body):
    host, path = endpoint_parts(url)
    if len(body) > MAX_REQUEST:
        raise OAuthTransportFailure("request_too_large")
    address = public_address(host)
    headers = {**headers, "Accept-Encoding": "identity", "Connection": "close"}
    connection = PinnedHTTPSConnection(host, address)
    try:
        connection.request(method, path, body, headers)
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise OAuthTransportFailure("redirect_rejected")
        data = bounded_response(response)
        response_headers = dict(response.getheaders())
        if response.getheader("Content-Type", "").split(";", 1)[0].strip().lower() == "text/event-stream":
            response_headers["Content-Type"] = "application/json"
            response_headers.pop("Content-Length", None)
        return response.status, response_headers, data
    except (OSError, ssl.SSLError, http.client.HTTPException):
        raise OAuthTransportFailure("connect_failed") from None
    finally:
        connection.close()


def make_transport(httpx2):
    class PublicOnlyTransport(httpx2.AsyncBaseTransport):
        async def handle_async_request(self, request):
            body = bytearray()
            async for chunk in request.stream:
                body.extend(chunk)
                if len(body) > MAX_REQUEST:
                    raise OAuthTransportFailure("request_too_large")
            headers = dict(request.headers)
            status, response_headers, data = await asyncio.to_thread(
                exchange, request.method, str(request.url), headers, bytes(body))
            return httpx2.Response(status, headers=response_headers, content=data, request=request)

    return PublicOnlyTransport()
