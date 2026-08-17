# Vinci AI — AI Shorts Generator

> Project: `ai-shorts-generator` (branded **"Vinci AI"**)
> Platform: Termux / Android · Node.js + React
> Public URL: `https://yt.yourdomain.com` (Cloudflare named tunnel → localhost:3000)

---

## 1. What This Project Does

Vinci AI is a self-hosted AI video factory. Give it a **topic** and it will:

1. Write a script (Gemini AI)
2. Generate a voiceover (Edge-TTS / voice clone)
3. Fetch stock footage (TikTok / Pexels / Pixabay)
4. Add subtitles, transitions, effects, BGM, watermark
5. Render a vertical short (ffmpeg)
6. Upload it to YouTube (OAuth official API, cookies fallback) — instantly or scheduled at the best posting time

Plus an **Autopilot Mode** that runs the whole pipeline hands-free on a schedule.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + lucide-react + motion |
| Backend | Express (TypeScript), bundled with esbuild → `dist/server.cjs` |
| AI Script/Titles/Topics | Google Gemini (`@google/genai`) |
| Voice | Edge-TTS (322 voices), optional XTTS voice clone (Colab server) |
| Video render | ffmpeg (Termux build) |
| Footage | TikTok (urlebird search via curl_cffi, tiktok-api-dl), Pexels, Pixabay |
| YouTube upload | Official Data API v3 (OAuth) primary, cookies/InnerTube fallback |
| Auth | Single PIN (SHA-256), 30-day session cookie `vinci_session` |
| Storage | JSON files (`data/db.json`) + filesystem (`storage/`) |
| Tunnel | cloudflared named tunnel `youtube-uploader` |

### npm scripts

```
npm run dev     → tsx server.ts        (dev — avoid: reloads page on every click)
npm run build   → vite build + esbuild server bundle
npm start       → node dist/server.cjs (PRODUCTION — always use this)
npm run lint    → tsc --noEmit
```

---

## 3. Directory Structure

```
backup/                          ← project root
├── server.ts                    ← Express app: ALL API routes (~3600 lines)
├── server/                      ← backend modules
│   ├── aiManager.ts             ← script/SEO generation orchestration
│   ├── autopilot.ts             ← Autopilot engine (config, queue, tick, pipeline)
│   ├── crypto.ts                ← API-key encryption (ENCRYPTION_SECRET)
│   ├── db.ts                    ← JSON DB: projects, settings, auth/sessions
│   ├── ffmpeg.ts                ← render pipeline: concat, subs, BGM, watermark
│   ├── gemini.ts                ← Gemini calls: scripts, topics, titles
│   ├── providers.ts             ← footage providers (Pexels/Pixabay/TikTok)
│   ├── renderQueue.ts           ← render job queue
│   ├── sceneVoice.ts            ← Edge-TTS voice list cache + TTS calls
│   ├── trends.ts                ← best posting time prediction
│   ├── voiceClone.ts            ← XTTS voice-clone client (Colab)
│   ├── yt-accounts.ts           ← multi-channel YouTube account storage
│   └── yt-cookies-upload.ts     ← cookies/InnerTube upload fallback
├── src/                         ← frontend (React)
│   ├── App.tsx                  ← router/view switcher
│   ├── main.tsx, index.css      ← entry + theme (CSS vars, day/night)
│   ├── types.ts                 ← shared types/enums (UserSettings etc.)
│   └── components/
│       ├── LandingPage.tsx      ← PIN login page
│       ├── SaaSLayout.tsx       ← Instagram-style shell + sidebar
│       ├── DashboardView.tsx    ← home dashboard
│       ├── CreateVideoView.tsx  ← manual video creation wizard
│       ├── ProjectDetailsView.tsx ← per-project editor + upload/channel chooser
│       ├── AutopilotView.tsx    ← Autopilot Mode UI (topics, features, queue)
│       ├── BatchView.tsx        ← batch generation
│       ├── TrendsView.tsx       ← trends / best posting times
│       ├── AnalyticsView.tsx    ← analytics
│       ├── VideoHistoryView.tsx ← video history
│       ├── RenderDiagnosticsView.tsx ← render diagnostics
│       └── SettingsView.tsx     ← settings: security, OAuth channels, keys
├── data/                        ← runtime data (NOT in backup zip — secrets!)
│   ├── db.json                  ← projects, settings, PIN hash, sessions
│   ├── autopilot.json           ← Autopilot config
│   ├── autopilot-queue.json     ← Autopilot queue
│   ├── youtube-accounts.json    ← multi-channel OAuth tokens
│   ├── youtube-tokens.json      ← legacy OAuth token
│   └── youtube-cookies.txt      ← YouTube cookies fallback
├── storage/                     ← media (heavy — NOT in backup zip)
│   ├── audio/builtin/bgm|sfx    ← built-in music & sound effects
│   ├── audio/library            ← user-uploaded music (~370 MB)
│   ├── audio/autopilot          ← Autopilot-uploaded BGM
│   ├── audio/voice-clone        ← cloned voices
│   ├── projects/                ← per-project media + renders (~550 MB)
│   ├── fonts/ stickers/ watermarks/ previews/
├── colab/                       ← XTTS voice-clone Colab notebooks
├── urlebird_search.py           ← TikTok hashtag search (py3.13 + curl_cffi)
├── .env                         ← secrets (NEVER share/commit)
├── .env.example                 ← template
└── dist/                        ← build output (server.cjs + client bundle)
```

---

## 4. How It Works (Pipeline)

### 4.1 Manual video creation

```
Topic → Gemini script → scene split → footage fetch (TikTok/Pexels/Pixabay)
      → Edge-TTS voiceover per scene → ffmpeg render (concat + subtitles
      + transitions + effects + BGM + watermark) → MP4
      → Upload now  OR  Schedule at best time
```

### 4.2 YouTube upload order (OAuth-first)

1. **Official Data API v3** with OAuth token (primary, reliable videoId)
2. **Cookies / InnerTube** fallback (only if OAuth fails)
3. Duplicate-upload prevention; success syncs back to scheduler + Autopilot

### 4.3 Autopilot Mode (hands-free factory)

```
Config (category, region, voice, BGM, duration, features, target channel,
        videos/day, approval mode, upload date)
   ↓
Topics: manual list + "Generate Topic Ideas" (Gemini)
   ↓
Background engine tick every 90 s:
   - tops up queue from topics
   - processes next pending item through the full pipeline
   - respects videosPerDay limit (1–6; YouTube quota ≈ 6/day)
   ↓
Approval modes: Full Auto | Approve First | Manual Upload
   ↓
Schedule: user-chosen date (best time that day) OR auto best posting time
   ↓
Scheduler tick every 60 s uploads anything whose scheduledAt ≤ now
```

**Status logic (UI):**
- toggle ON → **Active**
- toggle OFF but queue generating/rendering → **Running (Manual)**
- otherwise → **Paused**

**Run Now** = one-shot process AND turns the engine ON (so it keeps going).

---

## 5. Feature List (current)

### Core
- PIN auth (landing page, SHA-256, 30-day session), logout
- Instagram-style UI, day/night theme (localStorage `vinci-mode`), Theme Studio
- Script generation (Gemini) — tones, languages, Hindi Devanagari support ("IN HINDI" directive)
- Edge-TTS: 322-voice dropdown, rate slider −50%…+50% (Slow/Normal/Fast presets)
- Voice clone (XTTS via Colab) optional
- Footage: TikTok (auto source, watermark blur), Pexels, Pixabay, quality filter
- Subtitles (styles, font size), transitions, color grade, Ken Burns, emoji overlays
- BGM: built-in library + user upload (main project AND Autopilot), music ducking, beat sync
- Watermark/logo upload + position/size; CTA end card
- AI thumbnail, auto emoji, auto hashtags, smart scene distribution
- Render queue + diagnostics
- YouTube upload: OAuth-first, cookies fallback, instant or scheduled
- Best-posting-time prediction (trends)
- Multi-channel: add 2+ YouTube channels, per-upload channel chooser
- Video history, analytics, batch mode

### Autopilot Mode
- Category/Niche + Region (stable typing — local draft + debounced save)
- Videos/Day 1–6 · Duration 15/30/45/60 s buttons
- Generate Topic Ideas (Gemini) · Queue All · manual topic add
- Per-topic AI Title generation (4 options) + select/custom/clear
- **All Video Features panel** — every project feature toggleable (9 sections, 40+ options)
- Default BGM picker + Upload/Delete BGM
- Target channel selection
- Approval mode toggle (Full Auto / Approve First / Manual Upload)
- **Upload Date selection** (date picker + Auto/Aaj/Kal) + per-item reschedule
- Smart status: Active / Running (Manual) / Paused

---

## 6. Key API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/login` / `logout` | PIN session |
| `GET/POST /api/projects` | CRUD projects |
| `POST /api/generate-script` | Gemini script |
| `GET /api/voices` | Edge-TTS voice list (322) |
| `POST /api/render` | start render |
| `POST /api/youtube/upload` | upload (OAuth-first) |
| `GET /api/youtube/auth` / `/callback` | OAuth flow (protocol-aware) |
| `POST /api/autopilot/config` | save Autopilot config |
| `POST /api/autopilot/run` | one-shot run + engine ON |
| `POST /api/autopilot/generate-topics` | Gemini topic ideas |
| `POST /api/autopilot/queue/:id/titles` | AI title options |
| `POST /api/autopilot/queue/:id/select-title` | pick title |
| `POST /api/autopilot/queue/:id/reschedule` | change upload date |
| `GET/POST/DELETE /api/autopilot/bgm*` | Autopilot BGM upload/list/delete |
| `GET /api/trends/best-times` | posting-time prediction |

All `/api/*` routes are protected by the `vinci_session` cookie.

---

## 7. Roadmap

### ✅ Done
- [x] Core pipeline: script → voice → footage → render → upload
- [x] PIN auth + session security
- [x] OAuth-first YouTube upload (stable, reliable videoId)
- [x] Permanent domain via Cloudflare named tunnel (`yt.yourdomain.com`)
- [x] Scheduler with best-posting-time prediction
- [x] Multi-channel support (upload-time channel chooser)
- [x] Autopilot Mode: topics, AI titles, all-features panel, BGM upload,
      videos/day, duration, approval modes, smart status
- [x] Upload date selection + per-video reschedule
- [x] Run Now auto-enables the engine
- [x] Edge-TTS voice dropdown + rate slider
- [x] Hindi Devanagari script output

### 🔜 Pending / Next
- [ ] **Autopilot end-to-end verification** — first scheduled upload lands on channel
- [ ] **Multi-channel end-to-end test** — reconnect legacy token (needs `youtube.readonly`
      scope for channel name), add second channel, verify per-upload chooser
- [ ] **OAuth token expiry** — Google consent screen is in **Testing** mode →
      refresh tokens expire after **7 days**. Options: re-auth weekly OR move to
      Production mode (needs verification unless account is added as test user)
- [ ] Voice clone (XTTS Colab) integration polish
- [ ] Analytics depth (views/retention pull from YouTube API)
- [ ] Auto topic refill when queue drains (category-based, daily)
- [ ] Thumbnail A/B options

### ⚠️ Known Constraints
- YouTube API quota ≈ **6 uploads/day** (Videos/Day capped at 6)
- Testing-mode OAuth tokens expire in 7 days
- Termux ffmpeg can break after `pkg upgrade` (missing `.so`) — fix:
  `pkg upgrade <libname>`; if dpkg hangs: `dpkg --configure -a --force-confold`
- TikTok search needs python3.13 + curl_cffi (broken on 3.14); downloads use plain yt-dlp

---

## 8. Setup From Backup Zip

The backup zip contains **source code only** (no secrets, no node_modules, no media).

```bash
unzip ai-shorts-generator-backup.zip -d vinci && cd vinci
npm install                      # restore node_modules
cp .env.example .env             # then fill in real values:
#   GEMINI_API_KEY, ENCRYPTION_SECRET (32 chars),
#   YOUTUBE_FRONTEND_API_KEY, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET
npm run build
npm start                        # → http://localhost:3000
```

Then:
1. Set PIN in Settings → Security
2. Connect YouTube channel (OAuth) — add redirect URIs in Google Cloud Console:
   - `http://localhost:3000/api/youtube/callback`
   - `https://yt.yourdomain.com/api/youtube/callback`
3. Re-upload BGM / media as needed (`storage/audio/library`, `storage/projects` are not in the zip)

For the tunnel: `cloudflared tunnel run youtube-uploader`
(config: `~/.cloudflared/config.yml` → `yt.yourdomain.com` → `http://localhost:3000`)

---

*Doc generated 2026-08-17 · matches build with Autopilot date-selection + Run-Now-auto-ON*
