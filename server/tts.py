#!/usr/bin/env python3
"""edge-tts wrapper for AI Shorts Generator. Called from Node.js server."""
import sys, asyncio, json
import edge_tts

async def main():
    text = sys.argv[1]
    voice = sys.argv[2]
    output_path = sys.argv[3]
    rate = sys.argv[4] if len(sys.argv) > 4 else "+0%"
    tts = edge_tts.Communicate(text, voice, rate=rate)
    await tts.save(output_path)
    # Return duration info
    import subprocess, json as j
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "json", output_path], capture_output=True, text=True)
        info = j.loads(r.stdout)
        dur = float(info["format"]["duration"])
    except:
        dur = 0
    print(json.dumps({"duration": dur, "path": output_path}))

if __name__ == "__main__":
    asyncio.run(main())