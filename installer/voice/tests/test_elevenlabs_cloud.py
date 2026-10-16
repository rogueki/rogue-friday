import io
import json
import pathlib
import sys
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import elevenlabs_cloud


class Response:
    def __init__(self, data):
        self.data = io.BytesIO(data)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.data.close()

    def read1(self, size):
        return self.data.read(size)

    def read(self):
        return self.data.read()


class ElevenLabsCloudTest(unittest.TestCase):
    def test_stt_posts_raw_pcm_without_writing_recording(self):
        with patch.object(elevenlabs_cloud.urllib.request, "urlopen", return_value=Response(
                json.dumps({"text": "Hallo Friday"}).encode())) as opener:
            text = elevenlabs_cloud.transcribe(np.zeros(16000, dtype=np.float32), "secret")
        request = opener.call_args.args[0]
        self.assertEqual(text, "Hallo Friday")
        self.assertEqual(request.get_header("Xi-api-key"), "secret")
        self.assertIn(b"pcm_s16le_16", request.data)
        self.assertIn(b"scribe_v2", request.data)

    def test_tts_streams_pcm_and_uses_flash(self):
        active = []
        with patch.object(elevenlabs_cloud.urllib.request, "urlopen", return_value=Response(b"\x01\x00\x02\x00")) as opener:
            chunks = list(elevenlabs_cloud.stream_speech("Guten Tag", "secret", "21m00Tcm4TlvDq8ikWAM",
                                                           on_response=active.append))
        request = opener.call_args.args[0]
        self.assertEqual(b"".join(chunks), b"\x01\x00\x02\x00")
        self.assertEqual(len(active), 2)
        self.assertIsNone(active[-1])
        self.assertIn("output_format=pcm_16000", request.full_url)
        self.assertEqual(json.loads(request.data)["model_id"], "eleven_flash_v2_5")


if __name__ == "__main__":
    unittest.main()
