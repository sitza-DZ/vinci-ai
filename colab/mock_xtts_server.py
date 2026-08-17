#!/usr/bin/env python3
"""Mock Colab XTTS server — mimics the real notebook's /health and /tts endpoints.
Used to verify the app's voice-clone integration end-to-end without a real Colab.
"""
import json, os, subprocess, sys, uuid
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7860

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok", "model": "xtts_v2", "sample": "my_voice_sample.wav"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/tts":
            length = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(length) or b"{}")
            text = req.get("text", "")
            lang = req.get("language", "en")
            print(f"[mock-xtts] TTS request: lang={lang}, chars={len(text)}", flush=True)
            # Termux: /tmp not writable — use project-local dir
            tmpdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storage", "mock_tts")
            os.makedirs(tmpdir, exist_ok=True)
            out_wav = os.path.join(tmpdir, f"mock_tts_{uuid.uuid4().hex}.wav")
            out_mp3 = os.path.join(tmpdir, f"mock_tts_{uuid.uuid4().hex}.mp3")
            try:
                # Use edge-tts to make a real voice clip (proves audio path works)
                subprocess.run(
                    ["python3", "-m", "edge_tts", "--voice", "hi-IN-SwaraNeural",
                     "--text", text[:200] or "Test", "--write-media", out_mp3],
                    timeout=60, capture_output=True
                )
                if os.path.exists(out_mp3) and os.path.getsize(out_mp3) > 500:
                    with open(out_mp3, "rb") as f:
                        self._send(200, f.read(), "audio/mpeg")
                    os.remove(out_mp3)
                    return
            except Exception as e:
                print(f"[mock-xtts] edge-tts failed: {e}", flush=True)
            # Fallback: generate a 1s sine tone with ffmpeg
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                     "-ar", "24000", "-ac", "1", out_wav],
                    timeout=30, capture_output=True
                )
                with open(out_wav, "rb") as f:
                    self._send(200, f.read(), "audio/wav")
                os.remove(out_wav)
            except Exception as e:
                self._send(500, {"error": str(e)})
        else:
            self._send(404, {"error": "not found"})

if __name__ == "__main__":
    print(f"[mock-xtts] Mock Colab XTTS server on http://localhost:{PORT}", flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
