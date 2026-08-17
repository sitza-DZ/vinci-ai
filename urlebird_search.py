#!/usr/bin/env python3.13
"""urlebird_search.py — TikTok hashtag search via urlebird.com using curl_cffi.

urlebird blocks plain curl/Node fetch (Cloudflare TLS fingerprint detection),
but allows curl_cffi with Chrome impersonation. This script shells out from
the Node server and returns JSON on stdout.

Usage: python3.13 urlebird_search.py "<keyword>" [count]
Output: JSON array of {id, title, cover, play, hdplay, duration, author, likes}
"""
import sys, re, json

def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else ""
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    if not keyword:
        print(json.dumps([]))
        return

    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        sys.stderr.write("[urlebird] curl_cffi not installed\n")
        print(json.dumps([]))
        return

    raw_tag = keyword.strip()
    if raw_tag.startswith("#"):
        raw_tag = raw_tag[1:]
    else:
        raw_tag = re.sub(r"\s+", "", raw_tag)

    # urlebird returns ~18 videos per hashtag and ignores ?page= pagination.
    # To reach 25+ results we query several hashtag variations of the keyword
    # and merge unique videos.
    words = re.split(r"\s+", keyword.strip().lower())
    joined = "".join(words)
    tag_variants = [joined]
    # add common video-flavoured suffixes + individual prominent words
    for suf in ["video", "videos", "clip", "shorts", "funny", "cute", "best", "viral", "trending"]:
        v = joined + suf
        if v not in tag_variants:
            tag_variants.append(v)
    for w in words:
        if len(w) > 3 and w not in tag_variants:
            tag_variants.append(w)
    # cap variants so we don't hammer urlebird
    tag_variants = tag_variants[:6]

    UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    def fetch_tag(tag):
        url = f"https://urlebird.com/search/?q=%23{tag}"
        for attempt in range(1, 3):
            try:
                session = cffi_requests.Session(impersonate="chrome")
                r = session.get(url, headers={
                    "User-Agent": UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                }, timeout=30)
                if r.status_code == 200 and r.text:
                    return r.text
                sys.stderr.write(f"[urlebird] #{tag} attempt {attempt}: HTTP {r.status_code}, {len(r.text or '')} bytes\n")
            except Exception as e:
                sys.stderr.write(f"[urlebird] #{tag} attempt {attempt}: {type(e).__name__}: {str(e)[:100]}\n")
            if attempt < 2:
                import time
                time.sleep(1.5)
        return ""

    html = fetch_tag(tag_variants[0])
    if not html:
        print(json.dumps([]))
        return

    def decode(s):
        return (s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                 .replace("&quot;", '"').replace("&#039;", "'").replace("&#39;", "'")
                 .replace("&nbsp;", " "))

    def parse_count(s):
        if not s:
            return 0
        m = re.search(r"([\d.]+)\s*([KM]?)", s)
        if not m:
            return 0
        n = float(m.group(1))
        suffix = m.group(2)
        if suffix == "K":
            return int(n * 1000)
        if suffix == "M":
            return int(n * 1000000)
        return int(n)

    def parse_cards(page_html):
        out = []
        for card in page_html.split('<div class="thumb wc">')[1:]:
            id_match = re.search(r'/video/(?:[a-z0-9-]*-)?(\d{15,})/', card)
            if not id_match:
                continue
            vid = id_match.group(1)

            title_match = re.search(r'<a href="(https://urlebird\.com/video/[^"]*)"><span>([\s\S]*?)</span></a>', card)
            author_match = re.search(r'author-name"><a href="[^"]*">@([^<]+)</a>', card)
            # urlebird lazy-loads: real URL is in data-src for most cards, src holds a
            # 1x1 gif placeholder. Prefer data-src, fall back to src.
            cover_match = re.search(r'<div class="img"><img[^>]*?data-src="([^"]+)"', card)
            if not cover_match:
                cover_match = re.search(r'<div class="img"><img[^>]*?src="([^"]+)"', card)
            likes_match = re.search(r'fa-heart[^<]*</i>\s*([\d.,KM]+)', card)

            # Full urlebird page URL (includes slug — needed for preview; the bare
            # /video/<id>/ URL 404s on urlebird).
            ub_url = title_match.group(1) if title_match else ""
            video_url = f"https://www.tiktok.com/@x/video/{vid}"
            out.append({
                "id": vid,
                "title": decode(title_match.group(2)).strip() if title_match else "No title",
                "cover": cover_match.group(1) if cover_match else "",
                "play": video_url,
                "hdplay": video_url,
                "urlebirdUrl": ub_url,
                "duration": 0,
                "author": author_match.group(1).strip() if author_match else "",
                "likes": parse_count(likes_match.group(1) if likes_match else ""),
            })
        return out

    # Merge unique videos across hashtag variants until we hit `count`.
    results = []
    seen = set()
    for i, tag in enumerate(tag_variants):
        page_html = html if i == 0 else fetch_tag(tag)
        if not page_html:
            continue
        for item in parse_cards(page_html):
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            results.append(item)
            if len(results) >= count:
                break
        if len(results) >= count:
            break

    print(json.dumps(results))

if __name__ == "__main__":
    main()
