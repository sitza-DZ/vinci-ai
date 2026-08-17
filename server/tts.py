#!/usr/bin/env python3
"""edge-tts wrapper for AI Shorts Generator. Called from Node.js server.

Args:
  1. text_file  — file containing the text to speak
  2. voice      — edge-tts voice ShortName (e.g. "hi-IN-SwaraNeural")
  3. output_path— destination mp3 path
  4. rate       — speech rate ("+0%", "-30%", ...) [optional, default "+0%"]
  5. pitch      — speech pitch ("+0Hz", "+8Hz", ...) [optional, default "+0Hz"]
"""
import sys, asyncio, json

async def main():
    text_file = sys.argv[1]  # Read text from file, not argv
    voice = sys.argv[2]
    output_path = sys.argv[3]
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
    pitch = sys.argv[5] if len(sys.argv) > 5 else "+0Hz"

    with open(text_file, "r", encoding="utf-8") as f:
        text = f.read()

    import edge_tts
    tts = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await tts.save(output_path)

    # Return duration info
    import subprocess
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "json", output_path], capture_output=True, text=True)
        info = json.loads(r.stdout)
        dur = float(info["format"]["duration"])
    except:
        dur = 0
    print(json.dumps({"duration": dur, "path": output_path}))

if __name__ == "__main__":
    asyncio.run(main())
