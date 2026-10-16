import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.error


spec = importlib.util.spec_from_file_location("configure_skill_keys", Path(__file__).with_name("configure_skill_keys.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class Transport:
    def __init__(self, status=None, error=None):
        self.status = status
        self.error = error
        self.request = None

    def open(self, request, timeout):
        self.request = request
        assert timeout == 6
        if self.error:
            raise self.error
        if self.status != 200:
            raise urllib.error.HTTPError(request.full_url, self.status, "", {}, None)
        return Response()


class ConnectionChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_env = module.ENV
        module.ENV = Path(self.temp.name) / ".env"

    def tearDown(self):
        module.ENV = self.original_env
        self.temp.cleanup()

    def test_missing_does_not_contact_provider(self):
        transport = Transport()
        self.assertEqual(module.check_connection("AIRTABLE_API_KEY", transport), "missing")
        self.assertIsNone(transport.request)

    def test_success_uses_fixed_https_endpoint_and_secret_header(self):
        module.ENV.write_text('NOTION_API_KEY="synthetic-private-token"\n')
        transport = Transport(200)
        self.assertEqual(module.check_connection("NOTION_API_KEY", transport), "verified")
        self.assertEqual(transport.request.full_url, "https://api.notion.com/v1/users/me")
        self.assertEqual(transport.request.get_header("Authorization"), "Bearer synthetic-private-token")
        self.assertEqual(transport.request.get_header("Notion-version"), "2026-03-11")
        self.assertNotIn("synthetic-private-token", transport.request.full_url)

    def test_rejection_permission_and_network_failure(self):
        module.ENV.write_text('AIRTABLE_API_KEY="synthetic-private-token"\n')
        self.assertEqual(module.check_connection("AIRTABLE_API_KEY", Transport(401)), "rejected")
        self.assertEqual(module.check_connection("AIRTABLE_API_KEY", Transport(403)), "permission-limited")
        self.assertEqual(module.check_connection("AIRTABLE_API_KEY", Transport(error=urllib.error.URLError("offline"))), "unavailable")

    def test_redirects_are_never_followed(self):
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))


if __name__ == "__main__":
    unittest.main()
