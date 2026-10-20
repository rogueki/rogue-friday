import asyncio
import http.server
import json
import socket
import ssl
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hermes_mcp_oauth_transport import make_transport


class SDKTransportTest(TestCase):
    def test_real_tls_issuer_completes_sdk_pkce_through_pinned_transport(self):
        import httpx2
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        from mcp.client.auth.oauth2 import OAuthClientProvider
        from mcp.shared.auth import AuthorizationCodeResult, OAuthClientMetadata

        class Storage:
            tokens = None
            client = None

            async def get_tokens(self): return self.tokens
            async def set_tokens(self, value): self.tokens = value
            async def get_client_info(self): return self.client
            async def set_client_info(self, value): self.client = value

        with tempfile.TemporaryDirectory() as directory:
            private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "mcp.example.org")])
            certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                .public_key(private_key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(datetime.now(timezone.utc) - timedelta(minutes=1))
                .not_valid_after(datetime.now(timezone.utc) + timedelta(days=1))
                .add_extension(x509.SubjectAlternativeName([x509.DNSName("mcp.example.org")]), critical=False)
                .sign(private_key, hashes.SHA256()))
            cert = Path(directory) / "cert.pem"
            key = Path(directory) / "key.pem"
            cert.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
            key.write_bytes(private_key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
            seen = []

            class Handler(http.server.BaseHTTPRequestHandler):
                protocol_version = "HTTP/1.1"

                def reply(self, status, body, content_type="application/json", **headers):
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(body)))
                    for name, value in headers.items():
                        self.send_header(name, value)
                    self.end_headers()
                    self.wfile.write(body)

                def do_GET(self):
                    seen.append(("GET", self.path, self.headers.get("Host")))
                    if self.path == "/.well-known/oauth-authorization-server":
                        self.reply(200, json.dumps({
                            "issuer": "https://mcp.example.org",
                            "authorization_endpoint": "https://mcp.example.org/authorize",
                            "token_endpoint": "https://mcp.example.org/token",
                            "registration_endpoint": "https://mcp.example.org/register",
                            "response_types_supported": ["code"],
                            "grant_types_supported": ["authorization_code", "refresh_token"],
                            "code_challenge_methods_supported": ["S256"]}).encode())
                    else:
                        self.reply(404, b"")

                def do_POST(self):
                    body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                    seen.append(("POST", self.path, self.headers.get("Host")))
                    if self.path == "/mcp":
                        if not self.headers.get("Authorization"):
                            self.reply(401, b"", WWW_Authenticate='Bearer realm="mcp"')
                        else:
                            self.reply(200, b'{"jsonrpc":"2.0","id":1,"result":{}}')
                    elif self.path == "/register":
                        self.reply(201, json.dumps({"client_id": "friday-test",
                            "redirect_uris": ["http://127.0.0.1:4137/callback"],
                            "grant_types": ["authorization_code", "refresh_token"],
                            "response_types": ["code"], "token_endpoint_auth_method": "none"}).encode())
                    elif self.path == "/token":
                        self.reply(200, json.dumps({"access_token": "secret-access-token",
                            "token_type": "Bearer", "expires_in": 3600}).encode())
                    else:
                        self.reply(404, b"")

                def log_message(self, *_args):
                    pass

            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            server.daemon_threads = True
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(str(cert), str(key))
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            original_connect = socket.create_connection
            trusted = ssl.create_default_context(cafile=str(cert))
            storage = Storage()
            authorization = {}

            async def redirect_handler(url):
                authorization["url"] = url
                authorization["state"] = parse_qs(urlsplit(url).query)["state"][0]

            async def callback_handler():
                return AuthorizationCodeResult(code="example-code", state=authorization["state"])

            metadata = OAuthClientMetadata.model_validate({"client_name": "Friday test",
                "redirect_uris": ["http://127.0.0.1:4137/callback"],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"], "token_endpoint_auth_method": "none"})
            provider = OAuthClientProvider(server_url="https://mcp.example.org/mcp",
                client_metadata=metadata, storage=storage, redirect_handler=redirect_handler,
                callback_handler=callback_handler)

            def connect(_address, timeout=None):
                return original_connect(("127.0.0.1", server.server_port), timeout=timeout)

            async def request():
                async with httpx2.AsyncClient(transport=make_transport(httpx2), auth=provider,
                                               follow_redirects=False, trust_env=False) as client:
                    return await client.post("https://mcp.example.org/mcp", json={"jsonrpc": "2.0",
                        "id": 1, "method": "initialize", "params": {}})

            try:
                with patch("hermes_mcp_oauth_transport.public_address", return_value="127.0.0.1"), patch(
                        "hermes_mcp_oauth_transport.socket.create_connection", side_effect=connect), patch(
                        "hermes_mcp_oauth_transport.ssl.create_default_context", return_value=trusted):
                    response = asyncio.run(request())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(storage.tokens.access_token, "secret-access-token")
                self.assertIn("code_challenge=", authorization["url"])
                self.assertIn(("POST", "/token", "mcp.example.org"), seen)
                self.assertTrue(all(host == "mcp.example.org" for _, _, host in seen))
            finally:
                server.shutdown()
                server.server_close()

    def test_httpx2_sdk_client_uses_guarded_transport(self):
        import httpx2

        observed = []

        def exchange(method, url, headers, body):
            observed.append((method, url, headers, body))
            return 200, {"Content-Type": "application/json"}, b"{}"

        async def request():
            async with httpx2.AsyncClient(transport=make_transport(httpx2),
                                           follow_redirects=False) as client:
                return await client.post("https://auth.example.org/token", data={"code": "sample"})

        with patch("hermes_mcp_oauth_transport.exchange", side_effect=exchange):
            response = asyncio.run(request())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(observed[0][0:2], ("POST", "https://auth.example.org/token"))
        self.assertIn(b"code=sample", observed[0][3])

    def test_sdk_pkce_flow_uses_guarded_transport_for_all_requests(self):
        import httpx2
        from mcp.client.auth.oauth2 import OAuthClientProvider
        from mcp.shared.auth import AuthorizationCodeResult, OAuthClientMetadata

        class Storage:
            tokens = None
            client = None

            async def get_tokens(self): return self.tokens
            async def set_tokens(self, value): self.tokens = value
            async def get_client_info(self): return self.client
            async def set_client_info(self, value): self.client = value

        storage = Storage()
        observed = []
        callback = {}

        async def redirect_handler(url):
            callback["state"] = parse_qs(urlsplit(url).query)["state"][0]
            callback["url"] = url

        async def callback_handler():
            return AuthorizationCodeResult(code="example-code", state=callback["state"])

        def exchange(method, url, headers, body):
            observed.append((method, url, headers, body))
            path = urlsplit(url).path
            if path == "/mcp":
                if "authorization" not in {key.lower() for key in headers}:
                    return 401, {"WWW-Authenticate": 'Bearer realm="mcp"'}, b""
                return 200, {"Content-Type": "application/json"}, b'{"jsonrpc":"2.0","id":1,"result":{}}'
            if path.endswith("/.well-known/oauth-protected-resource/mcp") or path.endswith("/.well-known/oauth-protected-resource"):
                return 404, {}, b""
            if path == "/.well-known/oauth-authorization-server":
                return 200, {"Content-Type": "application/json"}, json.dumps({
                    "issuer": "https://mcp.example.org", "authorization_endpoint": "https://mcp.example.org/authorize",
                    "token_endpoint": "https://mcp.example.org/token", "registration_endpoint": "https://mcp.example.org/register",
                    "response_types_supported": ["code"], "grant_types_supported": ["authorization_code", "refresh_token"],
                    "code_challenge_methods_supported": ["S256"]}).encode()
            if path == "/register":
                return 201, {"Content-Type": "application/json"}, json.dumps({
                    "client_id": "friday-test", "redirect_uris": ["http://127.0.0.1:4137/callback"],
                    "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
                    "token_endpoint_auth_method": "none"}).encode()
            if path == "/token":
                return 200, {"Content-Type": "application/json"}, json.dumps({
                    "access_token": "secret-access-token", "token_type": "Bearer", "expires_in": 3600}).encode()
            return 404, {}, b""

        metadata = OAuthClientMetadata.model_validate({
            "client_name": "Friday test", "redirect_uris": ["http://127.0.0.1:4137/callback"],
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            "token_endpoint_auth_method": "none"})
        provider = OAuthClientProvider(server_url="https://mcp.example.org/mcp", client_metadata=metadata,
                                       storage=storage, redirect_handler=redirect_handler,
                                       callback_handler=callback_handler)

        async def request():
            async with httpx2.AsyncClient(transport=make_transport(httpx2), auth=provider,
                                           follow_redirects=False) as client:
                return await client.post("https://mcp.example.org/mcp", json={"jsonrpc": "2.0", "id": 1,
                    "method": "initialize", "params": {}})

        with patch("hermes_mcp_oauth_transport.exchange", side_effect=exchange):
            response = asyncio.run(request())
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(storage.tokens)
        self.assertEqual(storage.tokens.access_token, "secret-access-token")
        self.assertIn("code_challenge=", callback["url"])
        self.assertEqual([urlsplit(row[1]).path for row in observed if row[0] == "POST"][-2:],
                         ["/token", "/mcp"])
