import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import { DB } from "./db";
import { decrypt } from "./crypto";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function getAI(): GoogleGenAI {
  let key = "";
  try {
    const dbKeyConfig = DB.getApiKeyById("gemini");
    if (dbKeyConfig && dbKeyConfig.encryptedKey && dbKeyConfig.enabled) {
      key = decrypt(dbKeyConfig.encryptedKey);
      dbKeyConfig.useCount = (dbKeyConfig.useCount || 0) + 1;
      DB.saveApiKey(dbKeyConfig);
    }
  } catch (e) {
    console.error("[trends] Failed to read Gemini key from db", e);
  }
  if (!key) key = process.env.GEMINI_API_KEY || "";
  if (!key || key === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY is not configured. Add it via Settings > API Keys.");
  }
  return new GoogleGenAI({ apiKey: key, httpOptions: { headers: { "User-Agent": "aistudio-build" } } });
}

/** Fetch a URL via curl (urlebird blocks Node fetch TLS fingerprint with 403). */
function curlFetch(url: string): string {
  try {
    return execFileSync("curl", [
      "-sL", "--max-time", "30",
      "-H", `User-Agent: ${UA}`,
      "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "-H", "Accept-Language: en-US,en;q=0.9",
      url,
    ], { encoding: "utf-8", timeout: 35000 });
  } catch (e: any) {
    console.error("[trends] curl error:", e?.message?.slice(0, 120));
    return "";
  }
}

const decode = (s: string) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");

const parseCount = (s?: string): number => {
  if (!s) return 0;
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([KM]?)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suf = (m[2] || "").toUpperCase();
  return Math.round(suf === "K" ? n * 1000 : suf === "M" ? n * 1000000 : n);
};

export interface TrendVideo {
  id: string;
  title: string;
  cover: string;
  author: string;
  views: number;
  likes: number;
  comments: number;
  timeAgo: string;
  hashtags: string[];
  videoUrl: string;
  platform: "tiktok" | "youtube";
  duration?: number;
}

/** Trending feed categories → primary urlebird hashtag used for lookup. */
export const TREND_CATEGORIES: { id: string; label: string; emoji: string; hashtag: string; ytQuery: string }[] = [
  { id: "all", label: "All Trending", emoji: "🔥", hashtag: "", ytQuery: "viral video" },
  { id: "facts", label: "Fascinating Facts", emoji: "🤯", hashtag: "amazingfacts", ytQuery: "amazing facts" },
  { id: "cartoons", label: "Baby Cartoons", emoji: "🍼", hashtag: "babycartoon", ytQuery: "baby cartoon" },
  { id: "horror", label: "Horror Stories", emoji: "👻", hashtag: "horrortok", ytQuery: "horror story" },
  { id: "funny", label: "Funny / Comedy", emoji: "😂", hashtag: "funny", ytQuery: "funny comedy" },
  { id: "animals", label: "Animals & Pets", emoji: "🐾", hashtag: "animals", ytQuery: "funny animals" },
  { id: "food", label: "Food & Cooking", emoji: "🍜", hashtag: "food", ytQuery: "food cooking" },
  { id: "motivation", label: "Motivation", emoji: "💪", hashtag: "motivation", ytQuery: "motivation" },
  { id: "gaming", label: "Gaming", emoji: "🎮", hashtag: "gaming", ytQuery: "gaming" },
  { id: "satisfying", label: "Satisfying", emoji: "✨", hashtag: "satisfying", ytQuery: "satisfying video" },
  { id: "lifehacks", label: "Life Hacks", emoji: "💡", hashtag: "lifehacks", ytQuery: "life hacks" },
  { id: "dance", label: "Dance", emoji: "💃", hashtag: "dance", ytQuery: "dance" },
];

/** Parse urlebird video cards (thumb w[abc]) from an HTML page. */
function parseCards(html: string, limit = 30): TrendVideo[] {
  const cards = html.split(/<div class="thumb w[abc]">/).slice(1);
  const results: TrendVideo[] = [];
  for (const card of cards) {
    const idMatch = card.match(/\/video\/(?:[a-z0-9-]*-)?(\d{15,})\//);
    if (!idMatch) continue;
    const id = idMatch[1];
    if (results.some(r => r.id === id)) continue;

    const titleMatch = card.match(/<a href="https:\/\/urlebird\.com\/video\/[^"]*"><span>([\s\S]*?)<\/span><\/a>/);
    const authorMatch = card.match(/author-name"><a href="[^"]*">@([^<]+)<\/a>/)
      || card.match(/urlebird\.com\/user\/([^/"]+)\//);
    const coverMatch = card.match(/<div class="img"><img src="([^"]+)"/);
    const viewsMatch = card.match(/fa-play[^<]*<\/i>\s*([\d.,KM]+)/i);
    const likesMatch = card.match(/fa-heart[^<]*<\/i>\s*([\d.,KM]+)/i);
    const commentsMatch = card.match(/fa-comment[^<]*<\/i>\s*([\d.,KM]+)/i);
    const timeMatch = card.match(/fa-clock[^<]*<\/i>\s*([^<]+)</i);

    const rawTitle = titleMatch ? decode(titleMatch[1]).replace(/\s+/g, " ").trim() : "";
    const hashtags = (rawTitle.match(/#[\w\u0600-\u06FF]+/g) || []).map(h => h.slice(1));

    results.push({
      id,
      title: rawTitle || "No title",
      cover: coverMatch ? coverMatch[1] : "",
      author: authorMatch ? authorMatch[1].trim() : "",
      views: parseCount(viewsMatch?.[1]),
      likes: parseCount(likesMatch?.[1]),
      comments: parseCount(commentsMatch?.[1]),
      timeAgo: timeMatch ? timeMatch[1].trim() : "",
      hashtags,
      videoUrl: `https://www.tiktok.com/@x/video/${id}`,
      platform: "tiktok",
    });
    if (results.length >= limit) break;
  }
  return results;
}

export class TrendsService {
  /** List of available trending feed categories. */
  static getCategories() {
    return TREND_CATEGORIES;
  }

  /** Scrape urlebird trending feed (or a category hashtag) + aggregate top hashtags. */
  static async getTrending(limit = 24, categoryId = "all"): Promise<{ videos: TrendVideo[]; topHashtags: { tag: string; count: number }[]; category: string }> {
    const cat = TREND_CATEGORIES.find(c => c.id === categoryId) || TREND_CATEGORIES[0];
    // "all" → general trending page; otherwise hashtag search for that category
    const url = cat.hashtag
      ? `https://urlebird.com/search/?q=${encodeURIComponent("#" + cat.hashtag)}`
      : "https://urlebird.com/trending/";
    const html = curlFetch(url);
    if (!html) throw new Error("Could not reach trending source (urlebird). Try again in a moment.");
    const videos = parseCards(html, limit);
    if (!videos.length && cat.hashtag) {
      throw new Error(`No trending videos found for "${cat.label}". Try another category.`);
    }

    const tagCount = new Map<string, number>();
    for (const v of videos) {
      for (const t of v.hashtags) {
        const key = t.toLowerCase();
        tagCount.set(key, (tagCount.get(key) || 0) + 1);
      }
    }
    const topHashtags = [...tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return { videos, topHashtags, category: cat.id };
  }

  /** Fetch trending YouTube videos for a category via yt-dlp search (sorted by views). */
  static async getYoutubeTrending(limit = 24, categoryId = "all"): Promise<{ videos: TrendVideo[]; topHashtags: { tag: string; count: number }[]; category: string }> {
    const cat = TREND_CATEGORIES.find(c => c.id === categoryId) || TREND_CATEGORIES[0];
    const query = cat.ytQuery || "viral video";
    // ytsearch returns results; we fetch a few extra then sort by views for a "trending" feel
    const fetchCount = Math.min(limit + 10, 30);
    let raw = "";
    try {
      raw = execFileSync("yt-dlp", [
        "--flat-playlist", "-J",
        `ytsearch${fetchCount}:${query}`,
      ], { encoding: "utf-8", timeout: 90000 });
    } catch (e: any) {
      console.error("[trends] yt-dlp youtube search error:", e?.message?.slice(0, 150));
      throw new Error("Could not fetch YouTube trending right now. Try again in a moment.");
    }

    let entries: any[] = [];
    try {
      const parsed = JSON.parse(raw);
      entries = parsed.entries || [];
    } catch {
      throw new Error("YouTube returned an unexpected response. Try again.");
    }

    const videos: TrendVideo[] = entries
      .filter(e => e && e.id)
      .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
      .slice(0, limit)
      .map(e => {
        const thumbs = e.thumbnails || [];
        const cover = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`;
        const hashtags = (String(e.title || "").match(/#[\w]+/g) || []).map((h: string) => h.slice(1));
        return {
          id: e.id,
          title: e.title || "No title",
          cover,
          author: e.channel || e.uploader || "",
          views: e.view_count || 0,
          likes: 0,
          comments: 0,
          timeAgo: "",
          hashtags,
          videoUrl: `https://www.youtube.com/watch?v=${e.id}`,
          platform: "youtube" as const,
          duration: e.duration || 0,
        };
      });

    if (!videos.length) throw new Error(`No YouTube videos found for "${cat.label}". Try another category.`);

    // Aggregate hashtags from titles (YouTube titles use fewer tags, so this may be small)
    const tagCount = new Map<string, number>();
    for (const v of videos) {
      for (const t of v.hashtags) {
        const key = t.toLowerCase();
        tagCount.set(key, (tagCount.get(key) || 0) + 1);
      }
    }
    const topHashtags = [...tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return { videos, topHashtags, category: cat.id };
  }

  /** Scrape a TikTok creator's page via urlebird and analyze with Gemini. */
  static async analyzeCompetitor(username: string): Promise<{
    profile: { name: string; username: string; bio: string };
    videos: TrendVideo[];
    analysis: {
      summary: string;
      contentPatterns: string[];
      videoIdeas: { title: string; hook: string; why: string }[];
      recommendedHashtags: string[];
    };
  }> {
    const clean = username.trim().replace(/^@/, "").replace(/\/+$/, "");
    const html = curlFetch(`https://urlebird.com/user/${encodeURIComponent(clean)}/`);
    if (!html) throw new Error(`Could not find creator "@${clean}". Check the username and try again.`);

    const nameMatch = html.match(/<h1>([\s\S]*?)<\/h1>/);
    const descMatch = html.match(/name="description" content="([^"]*)"/);
    const videos = parseCards(html, 20);
    if (!videos.length) throw new Error(`Found "@${clean}" but no public videos to analyze.`);

    const profile = {
      name: nameMatch ? decode(nameMatch[1]).replace(/[✔✓]/g, "").trim() : clean,
      username: clean,
      bio: descMatch ? decode(descMatch[1]).trim() : "",
    };

    // Sort by views desc for the AI to focus on top performers
    const top = [...videos].sort((a, b) => b.views - a.views).slice(0, 12);
    const videoSummary = top.map((v, i) =>
      `${i + 1}. "${v.title}" — ${v.views} views, ${v.likes} likes, ${v.comments} comments (${v.timeAgo})`
    ).join("\n");

    let analysis = {
      summary: "",
      contentPatterns: [] as string[],
      videoIdeas: [] as { title: string; hook: string; why: string }[],
      recommendedHashtags: [] as string[],
    };

    try {
      const ai = getAI();
      const prompt = `You are a short-form video growth strategist. Analyze this TikTok creator and their top-performing videos, then generate actionable insights for a creator who wants to compete in the same niche.

Creator: ${profile.name} (@${profile.username})
Bio: ${profile.bio}

Top videos (by views):
${videoSummary}

Provide:
1. A 2-3 sentence summary of what makes this creator successful.
2. 3-5 concrete content patterns you observe (formats, hooks, themes, pacing).
3. 5 original video IDEAS in the same niche that could go viral. For each give a click-worthy title, a 1-3 word hook, and a one-line reason it would work.
4. 8-10 recommended hashtags for this niche.

Return a strict JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              contentPatterns: { type: Type.ARRAY, items: { type: Type.STRING } },
              videoIdeas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    why: { type: Type.STRING },
                  },
                  required: ["title", "hook", "why"],
                },
              },
              recommendedHashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["summary", "contentPatterns", "videoIdeas", "recommendedHashtags"],
          },
        },
      });
      const txt = response.text;
      if (txt) analysis = JSON.parse(txt);
    } catch (e: any) {
      console.error("[trends] competitor AI analysis failed:", e?.message?.slice(0, 150));
      analysis.summary = "AI analysis unavailable right now — showing raw top videos below.";
    }

    return { profile, videos, analysis };
  }

  /** Generate categorized hashtags for a topic via Gemini. */
  static async generateHashtags(topic: string, platform: string): Promise<{
    topic: string;
    viral: string[];
    niche: string[];
    broad: string[];
    all: string[];
  }> {
    const ai = getAI();
    const prompt = `You are a social-media SEO expert. Generate the best hashtags for a ${platform} video about: "${topic}".

Return 3 groups:
- "viral": 5 high-reach trending-style hashtags
- "niche": 6 tightly targeted hashtags for this exact topic
- "broad": 5 general discovery hashtags

All hashtags must start with # and be relevant. Return a strict JSON object with keys viral, niche, broad (each an array of strings).`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            viral: { type: Type.ARRAY, items: { type: Type.STRING } },
            niche: { type: Type.ARRAY, items: { type: Type.STRING } },
            broad: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["viral", "niche", "broad"],
        },
      },
    });
    const txt = response.text;
    if (!txt) throw new Error("No hashtags generated.");
    const parsed = JSON.parse(txt);
    const norm = (arr: string[]) => (arr || []).map((h: string) => h.startsWith("#") ? h : "#" + h);
    const viral = norm(parsed.viral);
    const niche = norm(parsed.niche);
    const broad = norm(parsed.broad);
    return { topic, viral, niche, broad, all: [...new Set([...viral, ...niche, ...broad])] };
  }

  /** Predict best posting times for a niche/platform/region via Gemini. */
  static async predictPostingTime(niche: string, platform: string, region: string): Promise<{
    niche: string;
    platform: string;
    region: string;
    bestTimes: { day: string; time: string; score: number; reason: string }[];
    summary: string;
    tips: string[];
  }> {
    const ai = getAI();
    const prompt = `You are a social-media analytics expert. Predict the BEST posting times to maximize reach for a ${platform} account in the "${niche}" niche, targeting audience in "${region}".

IMPORTANT: Express every time in Indian Standard Time (IST, UTC+5:30). The audience is primarily in India.

Return:
- "bestTimes": an array of the top 6 posting slots. Each has: day (e.g. "Monday"), time (e.g. "7:00 PM" in IST), score (0-100 how good that slot is), reason (one short line why).
- "summary": 2-3 sentence overview of the posting strategy.
- "tips": 3-4 practical posting tips for this niche.

Return a strict JSON object.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bestTimes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  time: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                },
                required: ["day", "time", "score", "reason"],
              },
            },
            summary: { type: Type.STRING },
            tips: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["bestTimes", "summary", "tips"],
        },
      },
    });
    const txt = response.text;
    if (!txt) throw new Error("No posting-time prediction generated.");
    const parsed = JSON.parse(txt);
    return { niche, platform, region, ...parsed };
  }

  /**
   * v15: Competitor Script Reverse-Engineering — fetch a viral video's transcript via
   * yt-dlp, analyze its structure with Gemini, and rewrite it in the user's style.
   */
  static async reverseEngineerVideo(url: string, rewriteStyle: "viral" | "storytelling" | "educational" | "dramatic" = "viral"): Promise<{
    videoTitle: string;
    channel: string;
    duration: number;
    transcript: string;
    analysis: {
      hookType: string;
      structure: string[];
      pacing: string;
      retentionTricks: string[];
      emotionalArc: string;
      whyItWorks: string;
    };
    rewrittenScript: string;
    newHook: string;
  }> {
    // 1. Fetch transcript + metadata via yt-dlp
    const tmpDir = path.join(process.cwd(), "tmp_reverse");
    fs.mkdirSync(tmpDir, { recursive: true });
    const outBase = path.join(tmpDir, `rev_${Date.now()}`);
    try {
      execFileSync("yt-dlp", [
        "--skip-download",
        "--ignore-errors",
        "--write-auto-subs", "--write-subs",
        "--sub-langs", "en",
        "--sub-format", "vtt",
        "-o", outBase,
        url,
      ], { encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      throw new Error(`Could not fetch video: ${e?.message?.slice(0, 150)}`);
    }

    // Metadata
    let videoTitle = "Unknown", channel = "Unknown", duration = 0;
    try {
      const metaRaw = execFileSync("yt-dlp", ["--skip-download", "--print", "%(title)s|%(uploader)s|%(duration)s", url], { encoding: "utf-8", timeout: 45000 });
      const [t, c, d] = metaRaw.trim().split("|");
      videoTitle = t || videoTitle; channel = c || channel; duration = parseInt(d) || 0;
    } catch {}

    // Find + parse the VTT transcript
    let transcript = "";
    try {
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(outBase)) && f.endsWith(".vtt"));
      if (files.length > 0) {
        const vtt = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8");
        // Strip VTT headers/timestamps, dedupe rolling caption lines
        const lines: string[] = [];
        const seen = new Set<string>();
        for (const line of vtt.split("\n")) {
          const t = line.trim();
          if (!t || t.startsWith("WEBVTT") || t.includes("-->") || /^[\d:.]+$/.test(t)) continue;
          const clean = t.replace(/<[^>]+>/g, "").trim();
          if (clean && !seen.has(clean)) { seen.add(clean); lines.push(clean); }
        }
        transcript = lines.join(" ").replace(/\s+/g, " ").trim();
      }
    } catch {}

    if (!transcript || transcript.length < 40) {
      throw new Error("No transcript available for this video (captions may be disabled).");
    }
    transcript = transcript.slice(0, 6000); // cap for the model

    // 2. Gemini: analyze structure + rewrite
    const ai = getAI();
    const styleGuide: Record<string, string> = {
      viral: "punchy, high-energy, curiosity-gap driven, MrBeast-style hooks, short sentences, pattern interrupts",
      storytelling: "narrative arc, emotional build-up, open loops, 'but then...' tension, satisfying payoff",
      educational: "clear value-first structure, 'here's what nobody tells you' framing, numbered insights",
      dramatic: "cinematic tension, slow reveals, stakes escalation, cliffhanger beats, powerful closing line"
    };
    const prompt = `You are an elite short-form video strategist. A competitor's viral video transcript is below.

VIDEO: "${videoTitle}" by ${channel} (${duration}s)
TRANSCRIPT:
"""
${transcript}
"""

TASK 1 — REVERSE-ENGINEER: Analyze exactly why this video works.
TASK 2 — REWRITE: Rewrite this script in a ${rewriteStyle} style (${styleGuide[rewriteStyle]}). Keep the SAME core facts/message, roughly the same length, first line must be a scroll-stopping hook, add 2+ curiosity gaps, write for spoken narration, keep the original language.

Return JSON:
{
  "analysis": {
    "hookType": "one-line label of the hook technique used",
    "structure": ["beat 1: ...", "beat 2: ...", "beat 3: ..."],
    "pacing": "one-line pacing description",
    "retentionTricks": ["trick 1", "trick 2", "trick 3"],
    "emotionalArc": "one-line emotional journey",
    "whyItWorks": "2-3 sentence summary of why this video is viral"
  },
  "rewrittenScript": "full rewritten script, plain text with line breaks between beats",
  "newHook": "just the opening hook line"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: {
              type: Type.OBJECT,
              properties: {
                hookType: { type: Type.STRING },
                structure: { type: Type.ARRAY, items: { type: Type.STRING } },
                pacing: { type: Type.STRING },
                retentionTricks: { type: Type.ARRAY, items: { type: Type.STRING } },
                emotionalArc: { type: Type.STRING },
                whyItWorks: { type: Type.STRING },
              },
              required: ["hookType", "structure", "pacing", "retentionTricks", "emotionalArc", "whyItWorks"],
            },
            rewrittenScript: { type: Type.STRING },
            newHook: { type: Type.STRING },
          },
          required: ["analysis", "rewrittenScript", "newHook"],
        },
      },
    });
    const txt = response.text;
    if (!txt) throw new Error("AI analysis failed — no response.");
    const parsed = JSON.parse(txt);
    return {
      videoTitle, channel, duration, transcript,
      analysis: parsed.analysis,
      rewrittenScript: parsed.rewrittenScript,
      newHook: parsed.newHook,
    };
  }

  /**
   * v15: Niche Finder — discover underserved niches (low competition, high demand)
   * around a broad interest area. Uses yt-dlp search volume signals + Gemini scoring.
   */
  static async findNiches(interest: string): Promise<{
    interest: string;
    niches: {
      niche: string;
      demandScore: number;      // 0-100 estimated audience demand
      competitionScore: number; // 0-100 estimated competition (lower = better)
      opportunityScore: number; // demand - competition weighted
      exampleTopics: string[];
      targetAudience: string;
      verdict: string;
    }[];
    summary: string;
  }> {
    // Gather real search-signal data: how many results + view counts for niche queries
    const seedQueries = [
      `${interest} facts`, `${interest} secrets`, `${interest} mistakes`,
      `${interest} for beginners`, `${interest} satisfying`, `${interest} stories`,
      `weird ${interest}`, `${interest} hacks`, `${interest} explained`, `dark ${interest} history`,
    ];
    const signals: { query: string; resultCount: number; topViews: number; avgViews: number }[] = [];
    for (const q of seedQueries.slice(0, 6)) {
      try {
        const raw = execFileSync("yt-dlp", [
          "--flat-playlist", "-J", `ytsearch12:${q}`,
        ], { encoding: "utf-8", timeout: 45000, stdio: ["ignore", "pipe", "pipe"] });
        const data = JSON.parse(raw);
        const entries = (data.entries || []).filter((e: any) => e && e.view_count);
        const views = entries.map((e: any) => e.view_count as number);
        signals.push({
          query: q,
          resultCount: entries.length,
          topViews: views.length ? Math.max(...views) : 0,
          avgViews: views.length ? Math.round(views.reduce((a: number, b: number) => a + b, 0) / views.length) : 0,
        });
      } catch {
        signals.push({ query: q, resultCount: 0, topViews: 0, avgViews: 0 });
      }
    }

    const ai = getAI();
    const prompt = `You are a short-form video niche strategist. The user's broad interest area is: "${interest}".

REAL SEARCH SIGNALS (from YouTube search, last 12 results per query):
${JSON.stringify(signals, null, 2)}

TASK: Identify 6 SPECIFIC underserved sub-niches within "${interest}". For each, estimate:
- demandScore (0-100): audience appetite — use the view-count signals above as evidence
- competitionScore (0-100): how saturated it is — many high-view established videos = high competition
- opportunityScore: round(demandScore * 1.2 - competitionScore), clamped 0-100
- 3 concrete example video topics (scroll-stopping titles)
- targetAudience: one line
- verdict: one line ("GOLD MINE", "WORTH TESTING", or "SATURATED")

Prioritize niches where demand signals are strong but few dominant creators exist. Be specific — "scary ocean facts" not just "ocean".

Return JSON: { "niches": [...], "summary": "2-3 sentence strategic summary" }`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            niches: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  niche: { type: Type.STRING },
                  demandScore: { type: Type.NUMBER },
                  competitionScore: { type: Type.NUMBER },
                  opportunityScore: { type: Type.NUMBER },
                  exampleTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  targetAudience: { type: Type.STRING },
                  verdict: { type: Type.STRING },
                },
                required: ["niche", "demandScore", "competitionScore", "opportunityScore", "exampleTopics", "targetAudience", "verdict"],
              },
            },
            summary: { type: Type.STRING },
          },
          required: ["niches", "summary"],
        },
      },
    });
    const txt = response.text;
    if (!txt) throw new Error("Niche analysis failed — no response.");
    const parsed = JSON.parse(txt);
    const niches = (parsed.niches || []).sort((a: any, b: any) => b.opportunityScore - a.opportunityScore);
    return { interest, niches, summary: parsed.summary };
  }

  /**
   * v15: Trend Alerts — check all enabled alert rules against live search data
   * (keyword-specific search, not generic feed) and create notifications for
   * high-view videos matching each keyword.
   * Called by the background scheduler and the manual "check now" endpoint.
   */
  static async checkTrendAlerts(): Promise<{ checked: number; newAlerts: number }> {
    const rules = DB.getTrendAlertRules().filter(r => r.enabled);
    let newAlerts = 0;
    for (const rule of rules) {
      try {
        let videos: TrendVideo[] = [];
        if (rule.platform === "youtube") {
          // Keyword-specific YouTube search sorted by views
          let raw = "";
          try {
            raw = execFileSync("yt-dlp", [
              "--flat-playlist", "-J", `ytsearch20:${rule.keyword}`,
            ], { encoding: "utf-8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
          } catch {}
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              videos = (parsed.entries || [])
                .filter((e: any) => e && e.id)
                .map((e: any) => ({
                  id: e.id,
                  title: e.title || "",
                  cover: (e.thumbnails || []).map((t: any) => t.url).find((u: string) => u) || "",
                  author: e.uploader || e.channel || "Unknown",
                  views: e.view_count || 0,
                  likes: 0,
                  comments: 0,
                  timeAgo: "",
                  hashtags: [],
                  videoUrl: `https://www.youtube.com/watch?v=${e.id}`,
                  platform: "youtube" as const,
                  duration: e.duration || undefined,
                }));
            } catch {}
          }
        } else {
          // Keyword-specific TikTok search via urlebird
          const html = curlFetch(`https://urlebird.com/search/?q=${encodeURIComponent(rule.keyword)}`);
          if (html) {
            videos = parseCards(html, 24);
          }
        }
        const minViews = rule.minViews || 0;
        for (const v of videos) {
          if ((v.views || 0) < minViews) continue;
          const before = DB.getTrendAlertNotifications(200).length;
          DB.addTrendAlertNotification({
            id: `ta_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ruleId: rule.id,
            keyword: rule.keyword,
            videoTitle: v.title,
            videoUrl: v.videoUrl || undefined,
            author: v.author,
            views: v.views || 0,
            platform: rule.platform,
            detectedAt: new Date().toISOString(),
            read: false,
          });
          const after = DB.getTrendAlertNotifications(200).length;
          if (after > before) newAlerts++;
        }
        rule.lastCheckedAt = new Date().toISOString();
        DB.saveTrendAlertRule(rule);
      } catch (e: any) {
        console.error(`[TrendAlerts] Rule "${rule.keyword}" failed:`, e?.message?.slice(0, 120));
      }
    }
    return { checked: rules.length, newAlerts };
  }
}
