import http.server
import json
import os
import shutil
import sys
import socket
import ssl
import subprocess
import tempfile
import threading
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_mcp_oauth_transport import (OAuthTransportFailure, bounded_response,
    endpoint_parts, exchange, public_address)


class Response:
    status = 200

    def __init__(self, body=b"{}", headers=None):
        self.body = body
        self.headers = headers or {}

    def getheader(self, key, default=None):
        return self.headers.get(key, default)

    def getheaders(self):
        return list(self.headers.items())

    def read(self, size):
        return self.body[:size]

    def read1(self, size):
        piece, self.body = self.body[:size], self.body[size:]
        return piece


class Connection:
    def __init__(self, host, address, response):
        self.host, self.address, self.response = host, address, response
        self.sent = None
        self.closed = False

    def request(self, method, path, body, headers):
        self.sent = (method, path, body, headers)

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


class OAuthTransportTest(TestCase):
    def test_real_tls_exchange_pins_ip_and_rejects_redirect(self):
        openssl = shutil.which("openssl")
        if openssl is None and os.name == "nt":
            for candidate in (Path("C:/Program Files/Git/usr/bin/openssl.exe"),
                              Path("C:/Program Files/Git/mingw64/bin/openssl.exe")):
                if candidate.is_file():
                    openssl = str(candidate)
                    break
        with tempfile.TemporaryDirectory() as directory:
            cert, key = Path(directory) / "cert.pem", Path(directory) / "key.pem"
            if openssl:
                subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", str(key), "-out", str(cert), "-days", "1", "-subj", "/CN=auth.example.org",
                    "-addext", "subjectAltName=DNS:auth.example.org"], check=True, capture_output=True)
            else:
                from datetime import datetime, timedelta, timezone
                from cryptography import x509
                from cryptography.hazmat.primitives import hashes, serialization
                from cryptography.hazmat.primitives.asymmetric import rsa
                from cryptography.x509.oid import NameOID
                private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
                subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "auth.example.org")])
                certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                    .public_key(private_key.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(datetime.now(timezone.utc) - timedelta(minutes=1))
                    .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
                    .add_extension(x509.SubjectAlternativeName([x509.DNSName("auth.example.org")]), critical=False)
                    .sign(private_key, hashes.SHA256()))
                cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
                key.write_bytes(private_key.private_bytes(serialization.Encoding.PEM,
                    serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
            seen = []

            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    seen.append((self.path, self.headers.get("Host")))
                    if self.path == "/redirect":
                        self.send_response(302)
                        self.send_header("Location", "http://127.0.0.1/private")
                    else:
                        body = b'{"issuer":"https://auth.example.org"}'
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    if self.path != "/redirect":
                        self.wfile.write(body)

                def log_message(self, *_args):
                    pass

            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            server.daemon_threads = True
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(str(cert), str(key))
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            trusted = ssl.create_default_context(cafile=str(cert))
            original_connect = socket.create_connection

            def connect(_address, timeout=None):
                return original_connect(("127.0.0.1", server.server_port), timeout=timeout)

            try:
                with patch("hermes_mcp_oauth_transport.public_address", return_value="127.0.0.1"), patch(
                        "hermes_mcp_oauth_transport.socket.create_connection", side_effect=connect), patch(
                        "hermes_mcp_oauth_transport.ssl.create_default_context", return_value=trusted):
                    status, _, data = exchange("GET", "https://auth.example.org/metadata", {}, b"")
                    self.assertEqual(status, 200)
                    self.assertEqual(json.loads(data)["issuer"], "https://auth.example.org")
                    self.assert_failure("redirect_rejected", exchange, "GET",
                                        "https://auth.example.org/redirect", {}, b"")
                self.assertEqual(seen, [("/metadata", "auth.example.org"), ("/redirect", "auth.example.org")])
            finally:
                server.shutdown()
                server.server_close()

    def assert_failure(self, failure_class, function, *args):
        with self.assertRaises(OAuthTransportFailure) as raised:
            function(*args)
        self.assertEqual(raised.exception.failure_class, failure_class)

    def test_endpoint_policy(self):
        self.assertEqual(endpoint_parts("https://auth.example.org/token?foo=bar"),
                         ("auth.example.org", "/token?foo=bar"))
        for url in ("http://auth.example.org/token", "https://127.0.0.1/token",
                    "https://localhost/token", "https://auth.local/token",
                    "https://user:pass@auth.example.org/token", "https://auth.example.org:8443/token",
                    "https://auth.example.org/token#secret", "https://☃.example.org/token"):
            with self.subTest(url=url):
                self.assert_failure("invalid_endpoint", endpoint_parts, url)

    def test_rejects_mixed_public_private_dns(self):
        rows = [(None, None, None, None, ("8.8.8.8", 443)),
                (None, None, None, None, ("127.0.0.1", 443))]
        with patch("hermes_mcp_oauth_transport.socket.getaddrinfo", return_value=rows):
            self.assert_failure("private_or_unresolved_address", public_address, "auth.example.org")

    def test_exchange_pins_address_and_does_not_follow_redirect(self):
        response = Response(b"{}", {"Content-Type": "application/json"})
        connection = Connection("auth.example.org", "8.8.8.8", response)
        with patch("hermes_mcp_oauth_transport.public_address", return_value="8.8.8.8"), patch(
                "hermes_mcp_oauth_transport.PinnedHTTPSConnection", return_value=connection):
            self.assertEqual(exchange("POST", "https://auth.example.org/token", {}, b"grant_type=code"),
                             (200, response.headers, b"{}"))
        self.assertEqual(connection.sent[1], "/token")
        self.assertEqual(connection.sent[3]["Accept-Encoding"], "identity")
        self.assertTrue(connection.closed)
        response.status = 302
        with patch("hermes_mcp_oauth_transport.public_address", return_value="8.8.8.8"), patch(
                "hermes_mcp_oauth_transport.PinnedHTTPSConnection", return_value=connection):
            self.assert_failure("redirect_rejected", exchange, "GET", "https://auth.example.org/redirect", {}, b"")

    def test_bounded_body_and_no_compression(self):
        self.assert_failure("response_too_large", bounded_response,
                            Response(b"", {"Content-Length": "262145"}))
        self.assert_failure("encoding_unsupported", bounded_response,
                            Response(b"", {"Content-Encoding": "gzip"}))
        self.assertEqual(bounded_response(Response(b'data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n',
            {"Content-Type": "text/event-stream"})), b'{"jsonrpc":"2.0","id":1,"result":{}}')
        self.assert_failure("stream_unsupported", bounded_response,
                            Response(b"", {"Content-Type": "text/event-stream"}))
