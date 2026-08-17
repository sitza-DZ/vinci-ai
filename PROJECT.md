# AI YouTube Shorts Generator

Full-stack AI-powered YouTube Shorts creator with 4 AI providers, stock footage integration, ASS subtitles, hook overlays, TikTok import, Coverr API, YouTube auto-upload, and duplicate clip prevention.

---

## Architecture

```
shorts2/
├── server.ts          # Express backend (all API routes + YouTube OAuth)
├── server/
│   ├── aiManager.ts   # AI provider routing, failover, keyword sanitization
│   ├── crypto.ts      # API key encryption/decryption
│   ├── db.ts          # JSON file-based database with auto-migration
│   ├── ffmpeg.ts      # FFmpeg video processing pipeline
│   ├── gemini.ts      # Google Gemini SDK integration
│   └── providers.ts   # Stock footage providers (Pexels, Pixabay, Coverr, Mixkit)
├── src/
│   ├── types.ts       # All TypeScript interfaces/enums
│   └── components/
│       ├── DashboardView.tsx         # Project grid with thumbnails
│       ├── ProjectDetailsView.tsx    # Scene editor + swap modal + TikTok import
│       ├── CreateVideoView.tsx       # Video creation flow
│       ├── SettingsView.tsx          # All settings tabs
│       ├── RenderDiagnosticsView.tsx # Render progress + diagnostics
│       ├── VideoHistoryView.tsx      # Rendered video history
│       └── SaaSLayout.tsx           # Layout shell
├── index.html
├── package.json
└── PROJECT.md
```

---

## AI Providers

### 1. Google Gemini (Default)
- **SDK**: `@google/genai`
- **File**: `server/gemini.ts`
- **Model**: `gemini-2.0-flash`
- **API Key**: `GEMINI_API_KEY` in `.env`

### 2. Groq
- **Endpoint**: `api.groq.com/openai/v1/chat/completions`
- **Default Model**: `llama-3.3-70b-versatile`
- **Features**: Fast inference, high rate limits

### 3. OpenRouter
- **Endpoint**: `openrouter.ai/api/v1/chat/completions`
- **Default Model**: `meta-llama/llama-3.3-70b-instruct`
- **Features**: Multiple model options, fallback

### 4. NVIDIA NIM
- **Endpoint**: `integrate.api.nvidia.com/v1/chat/completions`
- **Default Model**: `nvidia/llama-3.1-nemotron-70b-instruct`
- **Features**: 120+ free models, grouped by family

### AI Mode Configuration (Settings > AI Config)
- **Active Mode**: Auto (Smart Fallback) | Gemini | Groq | OpenRouter | NVIDIA NIM
- **Smart Routing Strategy**: Auto | Cheapest | Fastest | Quality
- **Keyword Sanitization**: Hindi/Urdu keywords auto-translated to English (100+ word mapping in `aiManager.ts`)

### AI Provider Failover Chain
When a provider fails, the system automatically falls back to the next available provider in order: Gemini → Groq → OpenRouter → NVIDIA NIM

---

## Stock Footage Providers

### 1. Pexels (API Key Required)
- **API**: `api.pexels.com/videos/search`
- **Key Required**: Yes
- **Response**: Vertical (portrait) h264 videos
- **Search**: By keywords with AI relevance scoring

### 2. Pixabay (API Key Required)
- **API**: `pixabay.com/api/videos/`
- **Key Required**: Yes
- **Response**: Multiple video sizes

### 3. Coverr (No API Key Needed)
- **API**: `coverr.co/api/videos?query=X&orientation=portrait`
- **Search**: Real-time from 7977+ vertical videos
- **Download**: CDN URLs (`cdn.coverr.co/videos/{base}/1080p.mp4`) — redirects resolve to actual MP4
- **Preview**: Poster/thumbnail from API response

### 4. Mixkit (Disabled)
- **Reason**: CDN blocks hotlinking (HTTP 403)
- **Status**: Ready for re-enable if Mixkit adds an official API or proxy set up

### Duplicate Clip Prevention
- Global `usedClipIds` Set tracks all selected clips across scenes
- `searchFootage()` filters out already-used clips via `excludeClipIds` parameter
- Clip IDs are tracked per-project — same clip never appears in two scenes
- `/api/search` endpoint also filters against DB scenes for swap modal

---

## Video Rendering Pipeline

### File: `server/ffmpeg.ts`

### Process:
1. **Download** each scene's selected video clip via `fetch`
2. **Scale & Crop** to 1080x1920 (vertical portrait)
3. **Sharpening** via `unsharp` filter
4. **Fade in/out** transitions
5. **Hook overlay** (`drawtext` with `textfile=` approach — text written to temp file to avoid shell quoting issues)
6. **ASS subtitles** burned into video
7. **Audio** — generated audio (silence) mixed in
8. **Concat** all processed scenes into final video
9. **Thumbnail** auto-generated from first frame of final video

### Output:
- **Format**: MP4 (h264 + AAC)
- **Resolution**: 1080×1920 (9:16)
- **CRF**: 18 (high quality)
- **Bitrate**: 10M (max 12M)

---

## YouTube Auto-Upload

### Endpoints:
- `GET /api/youtube/status` — Check auth status
- `GET /api/youtube/auth` — Get OAuth URL
- `GET /api/youtube/callback` — OAuth callback handler
- `POST /api/youtube/upload/:id` — Upload rendered video to YouTube Shorts

### Features:
- **Google OAuth 2.0** with auto token refresh
- **Uploads as YouTube Short** (#Shorts tag, vertical orientation)
- **Title + Description** auto-generated from project title + script summary
- **Privacy**: Public by default
- Token stored in `google_tokens.json`

---

## Subtitle System

### File: `server/ffmpeg.ts` (subtitle generation section)

### Features:
- **ASS format** (Advanced SubStation Alpha) — supports styles, colors, positioning
- **Auto-word-wrap** based on max line width
- **Per-word coloring** (highlighted words in accent color)
- **Font system detection** — auto-finds system fonts (NotoSans, Roboto, DejaVuSans)
- **Style options**: TikTok, Minimal, YouTube, Cinematic, Gaming, Arabic Premium

---

## Built-in BGM & SFX Library

### Status: ✅ Active (No API Required)
- **BGM**: 5 categories × 4 tracks = 20 built-in MP3 files
- **SFX**: 6 categories × 4-5 tracks = 28 built-in MP3 files

### BGM Categories
| Category | Mood | Tone |
|----------|------|------|
| Emotional | Soft, gentle pad tones | Warm ambient with low-pass |
| Horror | Dark drone + pink/brown noise | Eerie, low-frequency |
| Energetic | Higher frequency + white noise | Upbeat, intense |
| Calm | Low frequency harmonies | Peaceful, relaxing |
| Suspense | Vibrato/tremolo drones | Building tension, mystery |

### SFX Categories
| Category | Sound Type |
|----------|------------|
| Funny | Ascending quick tone sequences |
| Laugh | Rapid vibrato oscillations |
| Applause | White/pink noise burst |
| Transition | Swoosh (sine + noise blend) |
| Impact | Short percussive low-pass bursts |
| Whoosh | Frequency sweeps |

### How It Works
1. Audio files generated via FFmpeg `lavfi` (pure synthesis, no samples)
2. Files stored in `storage/audio/builtin/{bgm,sfx}/`
3. Server reads directory, groups by filename prefix (e.g., `emotional_1.mp3` → category "emotional")
4. Each file gets duration via `ffprobe` probe
5. UI shows category-tabbed browser with Play/Select buttons

### Future Expansion
- Upload custom MP3 via `POST /api/audio/upload` (POST with base64 audioData)
- Or manually place `.mp3` files in `storage/audio/builtin/{bgm,sfx}/` — named as `{category}_N.mp3`
- Server auto-discovers on next GET request (no restart needed)

### API Endpoints
- `GET /api/audio/builtin/bgm` — Returns `{ categoryName: [{name, label, duration, url, filePath}] }`
- `GET /api/audio/builtin/sfx` — Same structure for SFX
- `GET /api/audio/builtin/:type/:filename` — Serves MP3 file
- `POST /api/projects/:id/audio/apply-builtin` — Apply track to project (body: `{type, fileName, filePath}`)
- `POST /api/audio/upload` — Upload custom MP3 (body: `{audioData: base64}` + query `?type=bgm&fileName=x`)

### Previous: Pixabay Audio API (Removed)
- **Reason**: Pixabay audio API doesn't cover BGM/SFX needs well
- **Replaced with**: Built-in FFmpeg-generated audio library
- **Migration**: All old `storage/audio/{bgm,sfx}/` cached files remain on disk but are no longer served

---

## TikTok Video Import

### Endpoint: `POST /api/tiktok/download`
- Requires: TikTok URL + projectId
- Downloads via **yt-dlp** with `--impersonate` flag
- Dependency: `curl_cffi` Python package for browser impersonation
- Stored in: `storage/projects/{projectId}/tiktok_imports/`
- Served via: `GET /api/projects/:projectId/tiktok/:filename`

### UI
- **Swap modal** → "🎵 TikTok Import" tab
- Paste TikTok URL → Auto-download → Auto-apply to current scene
- Shows download progress and success/error states

---

## Thumbnail System

- **Auto-generated** after render completes via FFmpeg: `ffmpeg -ss 00:00:01 -i video -vframes 1 -s 640:360`
- Stored as `{projectId}_thumbnail.jpg` in project's `thumbnails/` dir
- Displayed on **Dashboard** — completed projects show actual video thumbnail
- Draft/processing projects show gradient placeholder with status icon

---

## Settings & Configuration

### File: `src/components/SettingsView.tsx`

### Tabs:
1. **AI Config** — Active AI provider, smart routing strategy, fallback mode
2. **API Keys** — Per-provider key management (Gemini, Groq, OpenRouter, NVIDIA NIM, Pexels, Pixabay)
3. **Subtitles** — Subtitle style, font, position, opacity, colors
4. **Video Settings** — Resolution, scene duration, transition type, video tone
5. **Default Settings** — Preferred footage sources (Pexels/Pixabay/Coverr/Mixkit toggles)

---

## Database

### File: `server/db.ts`

- **Format**: Single `storage/db.json` file
- **Auto-migration**: Missing API keys or video sources auto-added on read
- **Key stores**: API keys (encrypted), projects, scenes, AI usage stats, user settings, render jobs

---

## Build & Run

```bash
# Development (with hot-reload)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Type check only
npm run lint
```

**Port**: 3000 (configurable via `PORT` env)
**Default URL**: `http://localhost:3000`

---

## Environment Variables (`.env`)

```
GEMINI_API_KEY=your_gemini_key
PORT=3000
NODE_ENV=development
```

API keys for Groq, OpenRouter, NVIDIA, Pexels, Pixabay are managed via the Settings UI (encrypted in `db.json`).

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| `textfile=` for drawtext | Avoids all shell quoting issues with special characters in hook text |
| `excludeClipIds: Set` | Prevents duplicate clips across scenes at search time |
| Keyword sanitization map | Ensures Hindi/Urdu keywords translate to English for Pexels/Coverr search |
| Coverr CDN URL construction | Coverr search API returns empty `urls`, but `base_filename` constructs working CDN URLs |
| yt-dlp with `--impersonate` | TikTok blocks standard requests; `curl_cffi` enables browser fingerprint mimicry |
| ASS subtitles burned in | Ensures consistent appearance across platforms vs. client-side rendering |
| `size={8}` bug fix | Using `size` attr on `<select>` breaks `onChange` in listbox mode |