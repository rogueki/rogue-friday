import importlib.util
import asyncio
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("messaging_send", Path(__file__).with_name("messaging_send.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class MessengerSendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name)
        root = home / "hermes-agent"
        (root / "hermes_cli").mkdir(parents=True)
        (root / "hermes_cli" / "send_cmd.py").write_text("# pinned fake\n")
        cli = home / "hermes"
        cli.write_text("# fake\n")
        self.patches = [patch.object(bridge, "ROOT", root), patch.object(bridge, "CLI", cli),
                        patch.object(bridge, "configured_revision", return_value="a" * 64)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)
        self.calls = []

    def runner(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        if argv[0] == "git":
            return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
        return subprocess.CompletedProcess(argv, 0, json.dumps({"success": True, "message_id": "provider-1"}), "")

    def request(self, **changes):
        request = {"action": "send", "platform": "telegram", "recipient": "12345678", "text": "Synthetic hello",
                   "expectedConfigRevision": "a" * 64, **changes}
        if request["action"] == "check":
            request.pop("expectedConfigRevision")
        return request

    def test_check_never_sends_and_send_uses_exact_argv_with_body_only_on_stdin(self):
        self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                         {"state": "configured", "revision": "a" * 64})
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(bridge.send(self.request(), self.runner), {"state": "sent", "externalId": "provider-1"})
        argv, kwargs = self.calls[-1]
        self.assertEqual(argv[1:], ["send", "--to", "telegram:12345678", "--file", "-", "--json"])
        self.assertEqual(kwargs["input"], "Synthetic hello")
        self.assertNotIn("Synthetic hello", " ".join(argv))

    def test_invalid_target_or_media_is_rejected_before_send(self):
        self.assertEqual(bridge.send(self.request(recipient="room/unsafe"), self.runner)["reason"], "invalid_target_or_text")
        self.assertEqual(bridge.send(self.request(text="MEDIA:/private/file"), self.runner)["reason"], "invalid_target_or_text")
        self.assertEqual(self.calls, [])

    def test_matrix_colon_target_and_missing_configuration(self):
        self.assertEqual(bridge.send(self.request(platform="matrix", recipient="@user:example.org"), self.runner)["state"], "sent")
        with patch.object(bridge, "configured_revision", return_value=None):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner)["reason"], "platform_not_configured")

    def test_pinned_native_target_grammars_and_direct_transport(self):
        examples = {"teams": "a:conversation_123", "google_chat": "spaces/AAAA-123",
                    "simplex": "group:123", "weixin": "wxid_abc123",
                    "bluebubbles": "+15551234567", "dingtalk": "webhook",
                    "whatsapp_cloud": "+15551234567", "qqbot": "group:open_id_123"}
        for platform, recipient in examples.items():
            with self.subTest(platform=platform):
                self.assertTrue(bridge.exact_target(platform, recipient))
                self.assertEqual(bridge.send(self.request(action="check", platform=platform,
                                                        recipient=recipient), self.runner)["state"], "configured")
        for platform, recipient in (("teams", "a/conversation"), ("google_chat", "spaces/../bad"),
                                    ("simplex", "@displayname"), ("weixin", "friend"),
                                    ("bluebubbles", "group name"), ("dingtalk", "user123"),
                                    ("whatsapp_cloud", "group:123"), ("qqbot", "123456")):
            self.assertFalse(bridge.exact_target(platform, recipient))

        with patch.dict("sys.modules", {"hermes_cli": type(subprocess)("hermes_cli"),
                                        "hermes_cli._launchers": type(subprocess)("hermes_cli._launchers")}):
            import sys
            sys.modules["hermes_cli"]._launchers = sys.modules["hermes_cli._launchers"]
            sys.modules["hermes_cli._launchers"].runtime_command = lambda _root, _args, code: ["python", "-c", code]
            def direct_runner(argv, **kwargs):
                if argv[0] == "git":
                    return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
                self.assertEqual(argv[:2], ["python", "-c"])
                request = json.loads(kwargs["input"])
                self.assertEqual(request["action"], "direct")
                self.assertEqual(request["recipient"], "spaces/AAAA-123")
                return subprocess.CompletedProcess(argv, 0, '{"state":"sent","externalId":"provider-1"}', "")
            self.assertEqual(bridge.send(self.request(platform="google_chat", recipient="spaces/AAAA-123"),
                                         direct_runner), {"state": "sent", "externalId": "provider-1"})
            def unacknowledged(argv, **kwargs):
                if argv[0] == "git":
                    return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
                return subprocess.CompletedProcess(argv, 0, '{"state":"uncertain"}', "")
            self.assertEqual(bridge.send(self.request(platform="simplex", recipient="123"),
                                         unacknowledged), {"state": "uncertain"})

    def test_direct_sender_uses_hermes_config_and_never_claims_simplex_ack(self):
        calls = []
        def module(name, **attrs):
            value = types.ModuleType(name)
            value.__dict__.update(attrs)
            return value
        async def upstream(_platform, _config, recipient, message):
            calls.append((recipient, message))
            return {"success": True, "message_id": "upstream-42"}
        modules = {
            "hermes_cli": module("hermes_cli"),
            "hermes_cli.send_cmd": module("hermes_cli.send_cmd", _load_hermes_env=lambda: None),
            "tools": module("tools"),
            "tools.send_message_tool": module("tools.send_message_tool",
                prepare_send_message_platforms=lambda: None,
                _resolve_platform_config=lambda platform, _config: (platform, object(), None, None),
                _send_to_platform=upstream),
            "gateway": module("gateway"),
            "gateway.config": module("gateway.config", load_gateway_config=lambda: object()),
            "model_tools": module("model_tools", _run_async=asyncio.run),
        }
        with patch.dict("sys.modules", modules), patch("runpy.run_path", return_value={
            "probe": lambda _platform: {"state": "configured", "revision": "a" * 64}}):
            request = self.request(action="direct", platform="google_chat", recipient="spaces/AAAA-123")
            self.assertEqual(bridge.direct_send(request), {"state": "sent", "externalId": "upstream-42"})
            self.assertEqual(calls, [("spaces/AAAA-123", "Synthetic hello")])
            self.assertEqual(bridge.direct_send({**request, "platform": "simplex", "recipient": "123"}),
                             {"state": "uncertain"})
            self.assertEqual(bridge.direct_send({**request, "expectedConfigRevision": "b" * 64}),
                             {"state": "rejected"})
            self.assertEqual(len(calls), 2)

    def test_qqbot_route_is_qualified_and_long_body_rejected(self):
        self.assertEqual(bridge.send(self.request(platform="qqbot", recipient="guild:1234567890",
                                                  text="x" * 4001), self.runner)["reason"], "invalid_target_or_text")
        self.assertEqual(self.calls, [])
        paths = []
        class Response:
            status_code = 200
            def json(self):
                return {"access_token": "synthetic"}
        class Client:
            def __init__(self, **_kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): pass
            async def post(self, url, **_kwargs):
                self_outer.assertEqual(url, "https://bots.qq.com/app/getAppAccessToken")
                return Response()
        self_outer = self
        async def api_json(_client, _headers, method, path, body, **_kwargs):
            paths.append((method, path, body))
            return {"id": "qq-id"}
        fake_httpx = types.ModuleType("httpx")
        fake_httpx.AsyncClient = Client
        fake_gateway = types.ModuleType("gateway")
        fake_config = types.ModuleType("gateway.config")
        fake_config._getenv = lambda _key, default="": default
        fake_tools = types.ModuleType("tools")
        fake_senders = types.ModuleType("tools.send_message_senders")
        fake_senders._qqbot_api_json = api_json
        config = types.SimpleNamespace(extra={"app_id": "synthetic", "client_secret": "synthetic"}, token=None)
        with patch.dict("sys.modules", {"httpx": fake_httpx, "gateway": fake_gateway,
                                        "gateway.config": fake_config, "tools": fake_tools,
                                        "tools.send_message_senders": fake_senders}):
            for recipient, path in (("c2c:abc_123", "/v2/users/abc_123/messages"),
                                    ("group:abc_123", "/v2/groups/abc_123/messages"),
                                    ("guild:1234567890", "/channels/1234567890/messages")):
                self.assertEqual(asyncio.run(bridge.send_qqbot(config, recipient, "Synthetic hello")),
                                 {"state": "sent", "externalId": "qq-id"})
                self.assertEqual(paths[-1][1], path)

    def test_cloud_sender_uses_pinned_adapter_without_webhook_connect(self):
        calls = []
        class Client:
            def __init__(self, **_kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): pass
        class Adapter:
            def __init__(self, _config):
                self._phone_number_id = "phone-id"
                self._access_token = "synthetic"
                self._http_client = None
            async def connect(self):
                raise AssertionError("webhook listener must not start")
            async def send(self, recipient, message):
                calls.append((recipient, message, isinstance(self._http_client, Client)))
                return types.SimpleNamespace(success=True, message_id="wamid-synthetic")
        modules = {name: types.ModuleType(name) for name in (
            "httpx", "gateway", "gateway.platforms", "gateway.platforms.whatsapp_cloud",
            "gateway.platforms._http_client_limits")}
        modules["httpx"].AsyncClient = Client
        modules["gateway.platforms.whatsapp_cloud"].WhatsAppCloudAdapter = Adapter
        modules["gateway.platforms._http_client_limits"].platform_httpx_limits = lambda: None
        with patch.dict("sys.modules", modules):
            self.assertEqual(asyncio.run(bridge.send_cloud(object(), "+15551234567", "Synthetic hello")),
                             {"state": "sent", "externalId": "wamid-synthetic"})
        self.assertEqual(calls, [("15551234567", "Synthetic hello", True)])

    def test_account_change_between_check_and_send_rejects_before_cli(self):
        self.assertEqual(bridge.send(self.request(expectedConfigRevision="b" * 64), self.runner),
                         {"state": "rejected", "reason": "configuration_changed"})
        self.assertEqual(len(self.calls), 1)  # pinned git check only

    def test_unavailable_config_probe_is_distinct_from_unconfigured(self):
        with patch.object(bridge, "configured_revision", side_effect=RuntimeError("missing Hermes runtime")):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                             {"state": "rejected", "reason": "config_probe_unavailable"})
        with patch.object(bridge, "configured_revision", return_value=None):
            self.assertEqual(bridge.send(self.request(action="check"), self.runner),
                             {"state": "rejected", "reason": "platform_not_configured"})
        def pin_timeout(argv, **_kwargs):
            raise subprocess.TimeoutExpired(argv, 3)
        self.assertEqual(bridge.send(self.request(action="check"), pin_timeout),
                         {"state": "rejected", "reason": "hermes_pin_unavailable"})

    def test_timeout_and_malformed_receipt_are_uncertain(self):
        def timeout(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            raise subprocess.TimeoutExpired(argv, 30)
        self.assertEqual(bridge.send(self.request(), timeout), {"state": "uncertain"})
        def malformed(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            return subprocess.CompletedProcess(argv, 0, "not-json", "")
        self.assertEqual(bridge.send(self.request(), malformed), {"state": "uncertain"})
        def negative(argv, **kwargs):
            if argv[0] == "git":
                return subprocess.CompletedProcess(argv, 0, "d923a5eb\n", "")
            return subprocess.CompletedProcess(argv, 1, '{"error":"provider denied","success":false}', "")
        self.assertEqual(bridge.send(self.request(), negative), {"state": "uncertain"})


if __name__ == "__main__":
    unittest.main()
