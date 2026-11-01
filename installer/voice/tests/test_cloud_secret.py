import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import cloud_secret  # noqa: E402


class CloudSecretWindowsTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "DPAPI exists only on Windows")
    def test_saved_key_can_be_read_back(self):
        # The installer and save_secret both write with Set-Content, which ends the file with a line break.
        key = "sk-test." + "A1b2C3d4" * 13
        with tempfile.TemporaryDirectory() as folder:
            secret = os.path.join(folder, "alibaba_tokenplan.key.dpapi")
            cloud_secret.save_secret(secret, key, label="Test")
            with open(secret, "rb") as handle:
                self.assertTrue(handle.read().endswith(b"\r\n"))
            self.assertEqual(cloud_secret.load_secret(secret, linux_file="/unused", label="Test"), key)

    def test_windows_reader_trims_the_file_before_decrypting(self):
        source = pathlib.Path(cloud_secret.__file__).read_text(encoding="utf-8")
        self.assertIn("-Raw).Trim()", source)


if __name__ == "__main__":
    unittest.main()
