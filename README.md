<p align="center">
  <img src="assets/banner/banner.jpg" alt="AI Shorts Generator" width="100%">
</p>

# AI Shorts Generator

An end-to-end pipeline that turns a topic or script into a fully-produced YouTube Short / Instagram Reel. It generates the script using AI, sources vertical stock footage, adds subtitles and voiceovers, applies transitions and sound effects, then renders everything into a single video via FFmpeg.

Built for creators who want automation without giving up control. Each stage — scripting, footage selection, audio, transitions — is configurable through the UI or directly from the settings.

---

## Features

- **Multi-provider AI scripting** — Gemini, Groq, OpenRouter (200+ models), and NVIDIA NIM (120+ free models). Pick your provider or let the system route automatically.
- **Auto stock footage** — Pulls vertical clips from Pexels, Pixabay, Coverr, MixKit, TikTok, and Pinterest. Deduplicates and caches downloads.
- **Subtitle engine** — Multiple built-in presets (TikTok-style, neon, minimal, etc.) rendered as ASS subtitles directly into the video.
- **AI voiceover** — Edge-TTS integration supporting 100+ voices across Hindi, Urdu, Arabic, and English. Adjustable speech rate.
- **Background music** — Built-in library organized by mood (emotional, horror, upbeat, cinematic, etc.). Fade-in/out controls.
- **Clip transitions** — 15 xfade transition types (fade, dissolve, slide, zoom, radial, pixelize, wipe, etc.) plus a random-per-clip mode.
- **Auto SFX** — Scans scene text for emotional cues and places matching sound effects (laugh, impact, whoosh, applause) automatically.
- **Canvas positioning** — Control whether footage aligns to center, top, or bottom within the 9:16 frame.
- **YouTube upload** — Cookies-based upload (no OAuth setup). Just export browser cookies and paste. Supports scheduled publishing.
- **Smart scene pacing** — First few scenes at 3s for hook retention, rest at standard duration.
- **Render diagnostics** — Step-by-step logs for every FFmpeg operation. Useful for debugging pipeline issues.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS 4, Motion |
| Backend | Express, esbuild (Node.js) |
| AI | Gemini, Groq, OpenRouter, NVIDIA NIM |
| Video processing | FFmpeg (xfade, ASS subtitles, amix, filter_complex) |
| Voice synthesis | Edge-TTS (Microsoft Azure Cognitive Services) |
| Data | Local JSON store (file-based, no database server required) |

---

## Getting Started

### Prerequisites

- Node.js v18 or later
- FFmpeg v6+ compiled with libx264 and AAC support
- Python 3 (required by Edge-TTS)
- pip (Python package manager)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/ai-shorts-generator.git
cd ai-shorts-generator

# Install Node dependencies
npm install

# Install Edge-TTS for voiceover generation
pip install edge-tts

# Set up environment
cp .env.example .env
# Add your API keys (see Configuration section below)

# Create required storage directories
mkdir -p storage/projects storage/audio/builtin/bgm storage/audio/builtin/sfx

# Build the project (compiles frontend + bundles backend)
npm run build

# Start the server
npm start
# Open http://localhost:3000
```

---

## Configuration

Copy `.env.example` to `.env` and fill in your keys:

```env
# Required — at least one AI provider
GEMINI_API_KEY="your_gemini_key_here"

# Optional AI providers
# GROQ_API_KEY=""
# OPENROUTER_API_KEY=""
# NVIDIA_API_KEY=""

# Encryption secret for stored API keys (must be 32 characters)
ENCRYPTION_SECRET="replace-with-a-32-character-random-string"
```

---

## Usage

1. **Create a project** — Enter a topic (auto-generates script) or paste your own script.
2. **Configure settings** — Choose subtitle style, voiceover voice, transition type, sound effects, video quality, and footage sources.
3. **Render** — The pipeline downloads clips, processes them, applies subtitles/audio/transitions, and merges everything via FFmpeg.
4. **Preview & iterate** — Watch the result. Tweak settings and re-render if needed.
5. **Upload to YouTube** — Export cookies from your browser after logging into YouTube, then paste them in **Settings > YouTube Upload**. Supports scheduled publishing.

### Create Page Reference

| Section | Options |
|---------|---------|
| Script mode | Topic-based generation or manual script input |
| Subtitle style | TikTok, Neon, Minimal, Cinematic, Bold, Retro, etc. |
| Video tone | Viral, Educational, Inspirational, Humorous, Serious, Motivational |
| Transitions | 15 types + Random mode |
| Sound effects | Auto SFX (on/off) |
| Quality | High (1080p) / Ultra (higher bitrate) |
| Footage sources | Pexels, Pixabay, Coverr, MixKit |

---

## Project Structure

```
├── src/                    # React frontend
│   ├── components/         # UI views and panels
│   ├── types.ts            # TypeScript type definitions
│   ├── App.tsx             # Root component
│   ├── main.tsx            # Entry point
│   └── index.css           # Tailwind styles
├── server/
│   ├── ffmpeg.ts           # FFmpeg rendering pipeline
│   └── tts.py              # Edge-TTS voice synthesis
├── server.ts               # Express API server
├── storage/                # (gitignored) project data, renders, downloads
└── public/                 # Static assets
```

---

## Development

```bash
npm run dev
```

Runs the Vite dev server with hot reload alongside the Express backend via tsx. Frontend changes reflect instantly.

---

## Notes

- Rendered videos accumulate in `storage/projects/`. Periodically clean them up to free disk space.
- AI provider APIs have rate limits depending on your plan. The system falls back gracefully if a provider is unavailable.
- Voiceover requires an active internet connection (Edge-TTS calls Microsoft's servers).
- The project runs on Termux (Android) as long as Node.js and FFmpeg are installed.

---

## License

MIT