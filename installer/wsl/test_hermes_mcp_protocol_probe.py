import importlib.util
import json
import http.server
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
from unittest import TestCase
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location("hermes_mcp_protocol_probe", Path(__file__).with_name("hermes_mcp_protocol_probe.py"))
probe_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe_module)


class Response:
    def __init__(self, status, payload=b"", content_type="application/json", session=None):
        self.status = status
        self.payload = payload
        self.content_type = content_type
        self.session = session

    def getheader(self, name, default=None):
        return {"Content-Type": self.content_type, "Mcp-Session-Id": self.session}.get(name, default)

    def read1(self, count):
        piece, self.payload = self.payload[:count], self.payload[count:]
        return piece

    def read(self, count):
        return self.read1(count)


class Connection:
    def __init__(self, host, address, responses):
        self.host, self.address = host, address
        self.responses = list(responses)
        self.requests = []
        self.closed = False

    def request(self, method, path, body, headers):
        self.requests.append((method, path, json.loads(body), headers))

    def getresponse(self):
        return self.responses.pop(0)

    def close(self):
        self.closed = True


class ProtocolProbeTest(TestCase):
    def test_real_tls_streamable_http_round_trip_to_pinned_socket(self):
        if not shutil.which("openssl"):
            self.skipTest("openssl is required for synthetic TLS fixture")
        with tempfile.TemporaryDirectory() as directory:
            cert, key = Path(directory) / "cert.pem", Path(directory) / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                "-keyout", str(key), "-out", str(cert), "-days", "1", "-subj", "/CN=example.org",
                "-addext", "subjectAltName=DNS:example.org"], check=True, capture_output=True)
            methods = []
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_POST(self):
                    message = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                    methods.append(message["method"])
                    self.assert_host()
                    if message["method"] == "initialize":
                        body, status = {"jsonrpc": "2.0", "id": 1,
                            "result": {"protocolVersion": "2025-03-26"}}, 200
                    elif message["method"] == "notifications/initialized":
                        body, status = None, 202
                    else:
                        body, status = {"jsonrpc": "2.0", "id": 2,
                            "result": {"tools": [{"name": "read_only"}]}}, 200
                    encoded = json.dumps(body).encode() if body is not None else b""
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(encoded)))
                    self.send_header("Mcp-Session-Id", "fixture-session")
                    self.end_headers()
                    self.wfile.write(encoded)

                def assert_host(self):
                    if self.headers["Host"] != "example.org":
                        raise AssertionError("TLS probe changed the Host header")

                def log_message(self, *_args):
                    pass

            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(str(cert), str(key))
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            context = ssl.create_default_context(cafile=str(cert))
            original_dial = socket.create_connection
            dialed = []
            def fixture_dial(address, timeout):
                dialed.append(address)
                return original_dial(("127.0.0.1", server.server_port), timeout=timeout)
            try:
                with patch.object(probe_module, "public_address", return_value="93.184.215.14"), \
                     patch.object(probe_module.ssl, "create_default_context", return_value=context), \
                     patch.object(probe_module.socket, "create_connection", side_effect=fixture_dial):
                    result = probe_module.probe("https://example.org/mcp")
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)
            self.assertEqual(result["toolCount"], 1)
            self.assertEqual(methods, ["initialize", "notifications/initialized", "tools/list"])
            self.assertTrue(dialed)
            self.assertTrue(all(address == ("93.184.215.14", 443) for address in dialed))

    def test_dns_rejects_private_answers_before_any_dial(self):
        with patch.object(probe_module.socket, "getaddrinfo", return_value=[
            (2, 1, 6, "", ("93.184.215.14", 443)), (2, 1, 6, "", ("127.0.0.1", 443))]):
            with self.assertRaises(probe_module.ProbeFailure) as error:
                probe_module.public_address("example.org")
        self.assertEqual(error.exception.failure_class, "private_or_unresolved_address")

    def test_socket_dials_pinned_ip_while_tls_checks_original_host(self):
        plain = object()
        context = type("Context", (), {"wrap_socket": lambda self, sock, server_hostname: (sock, server_hostname)})()
        with patch.object(probe_module.ssl, "create_default_context", return_value=context), \
             patch.object(probe_module.socket, "create_connection", return_value=plain) as dial:
            connection = probe_module.PinnedHTTPSConnection("example.org", "93.184.215.14")
            connection.connect()
        dial.assert_called_once_with(("93.184.215.14", 443), timeout=8)
        self.assertEqual(connection.sock, (plain, "example.org"))

    def test_handshake_and_listing_do_not_call_tools_or_follow_redirects(self):
        first = Response(200, json.dumps({"jsonrpc": "2.0", "id": 1, "result": {
            "protocolVersion": "2025-03-26"}}).encode(), session="session-1")
        listed = Response(200, json.dumps({"jsonrpc": "2.0", "id": 2,
            "result": {"tools": [{"name": "one"}], "nextCursor": "more"}}).encode())
        connection = Connection("example.org", "93.184.215.14", [first, Response(202), listed])
        with patch.object(probe_module, "public_address", return_value="93.184.215.14"), \
             patch.object(probe_module, "PinnedHTTPSConnection", return_value=connection):
            result = probe_module.probe("https://example.org/mcp")
        self.assertEqual(result, {"connected": True, "toolCount": 1,
                                  "toolCountComplete": False, "failureClass": None})
        self.assertEqual([call[2]["method"] for call in connection.requests],
                         ["initialize", "notifications/initialized", "tools/list"])
        self.assertEqual(connection.requests[2][3]["Mcp-Session-Id"], "session-1")
        self.assertTrue(connection.closed)

        redirect = Connection("example.org", "93.184.215.14", [Response(302)])
        with patch.object(probe_module, "public_address", return_value="93.184.215.14"), \
             patch.object(probe_module, "PinnedHTTPSConnection", return_value=redirect):
            with self.assertRaises(probe_module.ProbeFailure) as error:
                probe_module.probe("https://example.org/mcp")
        self.assertEqual(error.exception.failure_class, "redirect_rejected")
        self.assertEqual(len(redirect.requests), 1)

    def test_sse_reply_is_bounded_and_rejects_unmatched_frames(self):
        payload = b": keepalive\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n"
        message = probe_module.response_message(Response(200, payload, "text/event-stream"), 2)
        self.assertEqual(message["result"]["tools"], [])
        with self.assertRaises(probe_module.ProbeFailure):
            probe_module.response_message(Response(200, b"x" * (probe_module.MAX_RESPONSE + 1)), 2)
