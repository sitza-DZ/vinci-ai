#!/usr/bin/env python3
"""Fetch the direct mp4 preview URL for a TikTok video via urlebird.com.

Usage: python3.13 urlebird_preview.py <video_id>
Prints JSON: {"previewUrl": "..."}  (empty string if not found)

urlebird blocks plain curl/Node fetch (Cloudflare TLS fingerprinting), so we
use curl_cffi with a real Chrome impersonation, same as urlebird_search.py.
"""
import sys
import json
import re


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"previewUrl": ""}))
        return
    arg = sys.argv[1].strip()
    # Accept either a full urlebird video URL (with slug — required, the bare
    # /video/<id>/ URL 404s) or a bare video id.
    if arg.startswith("http"):
        url = arg
    else:
        url = f"https://urlebird.com/video/{arg}/"

    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        sys.stderr.write("[urlebird-preview] curl_cffi not installed\n")
        print(json.dumps({"previewUrl": ""}))
        return

    UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

    html = ""
    for attempt in range(1, 3):
        try:
            session = cffi_requests.Session(impersonate="chrome")
            r = session.get(url, headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            }, timeout=30)
            if r.status_code == 200 and r.text:
                html = r.text
                break
            sys.stderr.write(f"[urlebird-preview] attempt {attempt}: HTTP {r.status_code}\n")
        except Exception as e:
            sys.stderr.write(f"[urlebird-preview] attempt {attempt}: {type(e).__name__}: {str(e)[:100]}\n")
        if attempt < 2:
            import time
            time.sleep(1.5)

    if not html:
        print(json.dumps({"previewUrl": ""}))
        return

    m = re.search(r'<video[^>]+src="([^"]+)"', html)
    preview = m.group(1) if m else ""
    print(json.dumps({"previewUrl": preview}))


if __name__ == "__main__":
    main()
