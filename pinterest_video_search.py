#!/usr/bin/env python3.13
"""
Pinterest VIDEO search helper.

Pinterest's own search API is geo-blocked from many IPs (returns 200 but empty
results) and its pages are client-rendered, so we can't scrape search HTML.
Strategy that works region-independently:
  1. Gather candidate pin IDs from Bing image search using MANY diverse query
     variants (keyword + video/shorts/reels/gif suffixes) + pagination. The
     video-biased suffixes raise the video-pin hit rate to ~3%.
  2. Probe each pin via Pinterest's PinResource API (works for individual pins
     even when search is blocked) using curl_cffi Chrome impersonation.
  3. Keep only pins whose metadata has a populated videos.video_list -> these
     are VIDEO pins. Return direct v1.pinimg.com mp4 URLs.

Requires python3.13 + curl_cffi (Chrome TLS fingerprint). Shells out from the
Node server, returns a JSON array on stdout.

Usage: python3.13 pinterest_video_search.py "<keyword>" [count]
Output: JSON array of {id, title, cover, video, duration, url}
"""
import sys, re, json
from concurrent.futures import ThreadPoolExecutor

def main():
    keyword = sys.argv[1] if len(sys.argv) > 1 else ""
    target = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    if not keyword:
        print(json.dumps([]))
        return

    try:
        from curl_cffi import requests as cr
    except Exception as e:
        sys.stderr.write(f"[pinvid] curl_cffi import failed: {e}\n")
        print(json.dumps([]))
        return

    s = cr.Session(impersonate="chrome")
    try:
        s.get("https://www.pinterest.com/", timeout=20)
    except Exception:
        pass
    csrf = dict(s.cookies).get("csrftoken", "")
    HDR = {"Accept-Language": "en-US,en;q=0.9"}

    def gather(args):
        query, first = args
        try:
            r = s.get(
                "https://www.bing.com/images/search?q=" + query.replace(" ", "+") +
                "&form=HDRSC2&first=" + str(first),
                headers=HDR, timeout=20)
            ids = []
            for blk in re.findall(r'm="({[^"]+})"', r.text):
                try:
                    d = json.loads(blk.replace("&quot;", '"').replace("&amp;", "&")
                                     .replace("&#39;", "'").replace("&nbsp;", " "))
                    m = re.search(r"/pin/(?:[^/]*-)?(\d+)", d.get("purl", ""))
                    if m:
                        ids.append(m.group(1))
                except Exception:
                    pass
            return ids
        except Exception:
            return []

    def probe(pid):
        try:
            opts = {"options": {"field_set_key": "detailed", "id": pid, "simple": True}, "context": {}}
            r = s.post(
                "https://www.pinterest.com/resource/PinResource/get/",
                headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "X-CSRFToken": csrf,
                    "X-Pinterest-AppState": "active",
                    "Referer": "https://www.pinterest.com/pin/" + pid + "/",
                    "Accept": "application/json",
                },
                data={"source_url": "/pin/" + pid + "/", "data": json.dumps(opts)},
                timeout=12)
            d = r.json().get("resource_response", {}).get("data", {})
            vids = d.get("videos")
            if vids and isinstance(vids, dict):
                vl = vids.get("video_list", {})
                pick = None
                for k in ["V_720P", "V_480P", "V_360P", "V_240P"]:
                    if k in vl and isinstance(vl[k], dict) and vl[k].get("url"):
                        pick = vl[k]; break
                if not pick:
                    for k, vv in vl.items():
                        if isinstance(vv, dict) and vv.get("url"):
                            pick = vv; break
                if pick:
                    img = (d.get("images", {}) or {})
                    cover = (img.get("236x", {}) or {}).get("url") or (img.get("orig", {}) or {}).get("url", "")
                    return {
                        "id": pid,
                        "title": (d.get("title") or d.get("grid_description") or "Pinterest Video")[:80],
                        "cover": cover,
                        "video": pick.get("url", ""),
                        "duration": round((pick.get("duration") or 0) / 1000, 1),
                        "url": "https://www.pinterest.com/pin/" + pid + "/",
                    }
            return None
        except Exception:
            return None

    # ---- Build diverse query variants (video-biased suffixes raise hit rate) ----
    kw = keyword.strip()
    words = kw.split()
    variants = [kw]
    sufs = ["pinterest", "video", "videos", "video pinterest", "shorts", "reels",
            "gif", "animation", "clip", "moments", "cute", "funny", "best", "top",
            "viral", "trending", "aesthetic", "compilation", "new", "hd", "status",
            "whatsapp status", "reel", "shorts pinterest", "reels pinterest"]
    for x in sufs:
        v = (kw + " " + x).strip()
        if v not in variants:
            variants.append(v)
    if len(words) > 1:
        rv = " ".join(reversed(words))
        for v in [rv, rv + " pinterest", rv + " video"]:
            if v not in variants:
                variants.append(v)
    for w in words:
        if len(w) > 3:
            for v in [w + " video pinterest", w + " shorts pinterest"]:
                if v not in variants:
                    variants.append(v)

    tasks = []
    for q in variants:
        for first in [1, 36, 71, 106, 141]:
            tasks.append((q, first))

    cand = []
    with ThreadPoolExecutor(max_workers=12) as ex:
        for ids in ex.map(gather, tasks):
            cand += ids
    cand = list(dict.fromkeys(cand))
    sys.stderr.write(f"[pinvid] variants {len(variants)} | candidates {len(cand)}\n")

    # ---- Probe with high concurrency, early-stop at target ----
    videos = []
    idx = [0]
    stop = [False]

    def worker():
        while not stop[0]:
            i = idx[0]
            if i >= len(cand):
                break
            idx[0] += 1
            v = probe(cand[i])
            if v:
                videos.append(v)
                if len(videos) >= target:
                    stop[0] = True

    with ThreadPoolExecutor(max_workers=32) as ex:
        list(ex.map(lambda _: worker(), range(32)))

    sys.stderr.write(f"[pinvid] probed {idx[0]}/{len(cand)} -> videos {len(videos)}\n")
    print(json.dumps(videos[:target]))

if __name__ == "__main__":
    main()
