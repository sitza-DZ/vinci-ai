import { AIProviderManager } from "./aiManager";
import { StockClip } from "../src/types";
import { DB } from "./db";
import { decrypt } from "./crypto";

// Highly curated dictionary of premium, real-world vertical and landscape video URLs
// representing top viral topics (Space, Oceans, Tech, Money, Nature, Productivity/Gym)
const CURATED_STOCK_LIBRARY: StockClip[] = [
  // --- SPACE & UNIVERSE ---
  {
    id: "space_stars_1",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4",
    previewUrl: "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Mesmerizing Time Lapse of the Milky Way Starry Night Sky",
    duration: 15,
    width: 1080,
    height: 1920,
    tags: ["space", "stars", "milky way", "night sky", "galaxy", "astronomy", "cosmos"],
    relevanceScore: 95,
    scoreExplanation: "Perfect celestial vertical background with rich cosmic lighting.",
    aspectRatio: "9:16"
  },
  {
    id: "space_moon_2",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/1851190/1851190-hd_1080_1920_25fps.mp4",
    previewUrl: "https://images.pexels.com/photos/1851190/pexels-photo-1851190.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Cinematic Close Up of the Moon Glowing in Night Sky",
    duration: 10,
    width: 1080,
    height: 1920,
    tags: ["space", "moon", "night sky", "lunar", "stars", "telescope", "darkness"],
    relevanceScore: 90,
    scoreExplanation: "High contrast vertical Moon clip.",
    aspectRatio: "9:16"
  },
  // --- TECH, CODING, AI, FUTURISTIC ---
  {
    id: "tech_matrix_1",
    provider: "pixabay",
    url: "https://videos.pexels.com/video-files/3129595/3129595-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/3129595/pexels-photo-3129595.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Digital Cyber Green Glitch Code Matrix Rain",
    duration: 14,
    width: 1080,
    height: 1920,
    tags: ["tech", "coding", "matrix", "hacker", "cyberspace", "ai", "artificial intelligence", "programming", "hacker", "futuristic"],
    relevanceScore: 92,
    scoreExplanation: "Ideal dynamic cyberpunk theme with hacker vibe.",
    aspectRatio: "9:16"
  },
  {
    id: "tech_phone_2",
    provider: "coverr",
    url: "https://videos.pexels.com/video-files/4011124/4011124-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/4011124/pexels-photo-4011124.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Hands Scrolling Through Colorful Dynamic Screen of Smartphone",
    duration: 12,
    width: 1080,
    height: 1920,
    tags: ["tech", "smartphone", "social media", "app", "mobile", "scrolling", "screen", "tiktok"],
    relevanceScore: 88,
    scoreExplanation: "Engaging phone usage vertical view.",
    aspectRatio: "9:16"
  },
  // --- WEALTH, MONEY, FINANCE, BUSINESS ---
  {
    id: "money_falling_1",
    provider: "mixkit",
    url: "https://videos.pexels.com/video-files/5443315/5443315-hd_1080_1920_24fps.mp4",
    previewUrl: "https://images.pexels.com/photos/5443315/pexels-photo-5443315.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Slow Motion Dropping of Stacked Hundred Dollar Bills Cash",
    duration: 8,
    width: 1080,
    height: 1920,
    tags: ["money", "wealth", "cash", "finance", "business", "dollar", "rich", "success", "bitcoin", "investment"],
    relevanceScore: 96,
    scoreExplanation: "Perfect viral high-speed dollars cash fall.",
    aspectRatio: "9:16"
  },
  {
    id: "money_chart_2",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/6775249/6775249-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/6775249/pexels-photo-6775249.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Stock Market Trading Charts Scrolling on Screen",
    duration: 10,
    width: 1080,
    height: 1920,
    tags: ["money", "finance", "stock market", "trading", "chart", "crypto", "bitcoin", "investment", "gold"],
    relevanceScore: 89,
    scoreExplanation: "Vertical trading dashboard clip.",
    aspectRatio: "9:16"
  },
  // --- NATURE, OCEANS, LANDSCAPES ---
  {
    id: "nature_ocean_1",
    provider: "coverr",
    url: "https://videos.pexels.com/video-files/1409899/1409899-hd_1080_1920_25fps.mp4",
    previewUrl: "https://images.pexels.com/photos/1409899/pexels-photo-1409899.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Turquoise Waves Crashing on a Golden Sand Beach Aerial Drone View",
    duration: 11,
    width: 1080,
    height: 1920,
    tags: ["nature", "ocean", "beach", "waves", "sea", "drone", "aerial", "relaxing", "water", "summer"],
    relevanceScore: 94,
    scoreExplanation: "Ultra-high quality vertical ocean wave tracking shot.",
    aspectRatio: "9:16"
  },
  {
    id: "nature_forest_2",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/2882118/2882118-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/2882118/pexels-photo-2882118.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Serene Sunlight Rays Piercing Through Deep Pine Forest Trees",
    duration: 13,
    width: 1080,
    height: 1920,
    tags: ["nature", "forest", "sunlight", "trees", "wood", "hiking", "adventure", "greenery", "serene", "jungle"],
    relevanceScore: 90,
    scoreExplanation: "Mystic nature lighting vertical scene.",
    aspectRatio: "9:16"
  },
  // --- TRAVEL, URBAN, CITY ---
  {
    id: "city_tokyo_1",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/2801416/2801416-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/2801416/pexels-photo-2801416.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Bright Neon Lights and Crowds of Shibuya Crossing in Tokyo Japan at Night",
    duration: 12,
    width: 1080,
    height: 1920,
    tags: ["city", "urban", "travel", "tokyo", "japan", "neon", "crowd", "nightlife", "shibuya", "futuristic"],
    relevanceScore: 93,
    scoreExplanation: "Dynamic fast-paced vertical city shot.",
    aspectRatio: "9:16"
  },
  // --- FITNESS, GYM, MOTIVATION ---
  {
    id: "gym_running_1",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/4754013/4754013-hd_1080_1920_30fps.mp4",
    previewUrl: "https://images.pexels.com/photos/4754013/pexels-photo-4754013.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Determined Female Runner Sprinting in City Sunrise",
    duration: 9,
    width: 1080,
    height: 1920,
    tags: ["gym", "running", "fitness", "motivation", "workout", "sunrise", "athlete", "health", "sprint"],
    relevanceScore: 91,
    scoreExplanation: "Aesthetic morning athletic motivational short.",
    aspectRatio: "9:16"
  },
  // --- GENERAL BACKUPS (LANDSCAPE - Auto cropped) ---
  {
    id: "general_abstract_1",
    provider: "pexels",
    url: "https://videos.pexels.com/video-files/2759484/2759484-hd_1280_720_24fps.mp4",
    previewUrl: "https://images.pexels.com/photos/2759484/pexels-photo-2759484.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
    title: "Abstract Liquid Golden Glitter Swirling Beautifully",
    duration: 15,
    width: 1280,
    height: 720,
    tags: ["abstract", "glitter", "gold", "liquid", "swirl", "background", "art", "slow motion"],
    relevanceScore: 80,
    scoreExplanation: "Premium abstract backup (requires auto-crop to 9:16).",
    aspectRatio: "16:9"
  }
];

// Mixkit curated static library — disabled because Mixkit CDN blocks hotlinking (HTTP 403).
// Re-enable only if Mixkit adds an official API or a proxy is set up.
// To re-enable: add real downloadable URLs and uncomment the mixkit block in searchFootage below.
const MIXKIT_LIBRARY: StockClip[] = [];

export class ProviderManagerService {
  /**
   * Search across all enabled providers and return scored stock clips
   */
  static async searchFootage(
    sceneVisual: string,
    keywords: string[],
    enabledProviders: string[],
    perPage: number = 6,
    maxResults: number = 3,
    useAiScoring: boolean = true,
    excludeClipIds: Set<string> = new Set()
  ): Promise<StockClip[]> {
    console.log(`Starting Provider Search for keywords: [${keywords.join(", ")}]`);

    const candidates: StockClip[] = [];
    const providersToSearch = enabledProviders.map(p => p.toLowerCase());

    // Get Decrypted API Keys from Database
    let pexelsKey = "";
    let pixabayKey = "";

    try {
      const pexelsConfig = DB.getApiKeyById("pexels");
      if (pexelsConfig && pexelsConfig.encryptedKey && pexelsConfig.enabled) {
        pexelsKey = decrypt(pexelsConfig.encryptedKey);
      }
      const pixabayConfig = DB.getApiKeyById("pixabay");
      if (pixabayConfig && pixabayConfig.encryptedKey && pixabayConfig.enabled) {
        pixabayKey = decrypt(pixabayConfig.encryptedKey);
      }
    } catch (e) {
      console.error("Error retrieving provider API keys", e);
    }

    // 1. Live Pexels Video Search (if key is configured and enabled)
    if (providersToSearch.includes("pexels") && pexelsKey) {
      try {
        console.log("Searching Pexels API for real-time video assets...");
        const query = keywords.slice(0, 2).join(" ");
        const response = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=portrait`, {
          headers: { "Authorization": pexelsKey }
        });
        if (response.ok) {
          const data: any = await response.json();
          if (data && Array.isArray(data.videos)) {
            // Track API Usage
            const pexelsConfig = DB.getApiKeyById("pexels");
            if (pexelsConfig) {
              pexelsConfig.useCount = (pexelsConfig.useCount || 0) + 1;
              DB.saveApiKey(pexelsConfig);
            }

            for (const v of data.videos) {
              const files = v.video_files || [];
              const bestFile = files.find((f: any) => f.quality === "hd" || f.quality === "sd") || files[0];
              if (bestFile && bestFile.link) {
                candidates.push({
                  id: `pexels_real_${v.id}`,
                  provider: "pexels",
                  url: bestFile.link,
                  previewUrl: v.image || "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
                  title: `${v.user?.name ? "Video by " + v.user.name + ": " : ""}${query} stock footage`,
                  duration: v.duration || 10,
                  width: v.width || 1080,
                  height: v.height || 1920,
                  tags: [query, "pexels", "stock", "realtime"],
                  relevanceScore: 85,
                  scoreExplanation: "Fetched in real-time from Pexels API.",
                  aspectRatio: (v.width && v.height && v.width < v.height) ? "9:16" : "16:9"
                });
              }
            }
          }
        } else {
          console.error(`Pexels API error status: ${response.status}`);
        }
      } catch (err) {
        console.error("Pexels real-time fetch failed, falling back to local library:", err);
      }
    }

    // 2. Live Pixabay Video Search (if key is configured and enabled)
    if (providersToSearch.includes("pixabay") && pixabayKey) {
      try {
        console.log("Searching Pixabay API for real-time video assets...");
        const query = keywords.slice(0, 2).join(" ");
        const response = await fetch(`https://pixabay.com/api/videos/?key=${pixabayKey}&q=${encodeURIComponent(query)}&per_page=${perPage}`);
        if (response.ok) {
          const data: any = await response.json();
          if (data && Array.isArray(data.hits)) {
            // Track API Usage
            const pixabayConfig = DB.getApiKeyById("pixabay");
            if (pixabayConfig) {
              pixabayConfig.useCount = (pixabayConfig.useCount || 0) + 1;
              DB.saveApiKey(pixabayConfig);
            }

            for (const hit of data.hits) {
              const videosObj = hit.videos || {};
              const bestVideo = videosObj.medium || videosObj.small || videosObj.large || videosObj.tiny;
              if (bestVideo && bestVideo.url) {
                candidates.push({
                  id: `pixabay_real_${hit.id}`,
                  provider: "pixabay",
                  url: bestVideo.url,
                  previewUrl: hit.userImageURL || "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
                  title: `Pixabay stock clip by ${hit.user || "creator"}: ${query}`,
                  duration: hit.duration || 12,
                  width: hit.width || 1280,
                  height: hit.height || 720,
                  tags: (hit.tags || "").split(",").map((t: string) => t.trim()),
                  relevanceScore: 80,
                  scoreExplanation: "Fetched in real-time from Pixabay API.",
                  aspectRatio: (hit.width && hit.height && hit.width < hit.height) ? "9:16" : "16:9"
                });
              }
            }
          }
        } else {
          console.error(`Pixabay API error status: ${response.status}`);
        }
      } catch (err) {
        console.error("Pixabay real-time fetch failed, falling back to local library:", err);
      }
    }

    // 3. Live Coverr Video Search (free public API, no key required)
    if (providersToSearch.includes("coverr")) {
      try {
        console.log("Searching Coverr API for free stock footage...");
        const query = keywords.slice(0, 2).join(" ");
        const coverrUrl = `https://coverr.co/api/videos?query=${encodeURIComponent(query)}&orientation=portrait&page=0&limit=${perPage}`;
        const response = await fetch(coverrUrl);
        if (response.ok) {
          const data: any = await response.json();
          const hits = data?.hits || data?.videos || [];
          if (Array.isArray(hits)) {
            for (const h of hits) {
              // Skip premium videos
              if (h.is_premium) continue;

              // Construct CDN URL from base_filename (pattern: https://cdn.coverr.co/videos/{base}/1080p.mp4)
              // The CDN URL works when following redirects (Node fetch follows by default)
              const baseFile = h.base_filename || (h.slug ? `coverr-${h.slug}` : null);
              const videoUrl = baseFile ? `https://cdn.coverr.co/videos/${baseFile}/1080p.mp4` : null;
              if (!videoUrl) continue;

              const thumb = h.poster || h.thumbnail;
              candidates.push({
                id: `coverr_real_${h.id || h.objectID || h.video_id || baseFile}`,
                provider: "coverr",
                url: videoUrl,
                previewUrl: (thumb && typeof thumb === "string")
                  ? thumb
                  : "https://cdn.coverr.co/images/placeholder.jpg",
                title: h.title || `Coverr ${query} footage`,
                duration: typeof h.duration === "string" ? parseFloat(h.duration) : (h.duration || 10),
                width: h.max_width || 1920,
                height: h.max_height || 1080,
                tags: Array.isArray(h.tags) ? h.tags : (typeof h.tags === "string" ? h.tags.split(",").map((t: string) => t.trim()) : [query, "coverr"]),
                relevanceScore: 82,
                scoreExplanation: "Fetched in real-time from Coverr API (free).",
                aspectRatio: h.is_vertical || (h.max_height > h.max_width) ? "9:16" : "16:9"
              });
            }
          }
        } else {
          console.error(`Coverr API error status: ${response.status}`);
        }
      } catch (err) {
        console.error("Coverr real-time fetch failed:", err);
      }
    }

    // 4. Mixkit curated static library (no official API — use CDN-hosted footage)
    if (providersToSearch.includes("mixkit")) {
      const query = keywords.slice(0, 2).join(" ").toLowerCase();
      for (const clip of MIXKIT_LIBRARY) {
        if (clip.tags.some(t => query.includes(t.toLowerCase()) || t.toLowerCase().includes(query))) {
          candidates.push(clip);
        }
      }
    }

    // If no specific curated footage matched, return a general abstract clip or default beauty clips
    if (candidates.length === 0) {
      // Find abstract clips or any beautiful nature backdrop as safety fallbacks
      const fallbackClips = CURATED_STOCK_LIBRARY.filter(c => providersToSearch.includes(c.provider));
      fallbackClips.forEach(clip => {
        candidates.push({
          ...clip,
          relevanceScore: 65, // decent fallback score
          scoreExplanation: "Default gorgeous aesthetic clip used as standard fallback."
        });
      });
    }

    // Run AI Visual Scoring for the top 3 candidates to select the absolute best matching clip!
    // This connects scene visual description directly with clip title/tags using Gemini API.
    const scoredCandidates: StockClip[] = [];
    
    // Custom comparator to enforce the CRITICAL VIDEO SEARCH RULE:
    // "Prefer width >= 1080 and height >= 1920. If unavailable, choose highest resolution available.
    // Never prioritize low-resolution clips simply because they are vertical."
    const compareClips = (a: StockClip, b: StockClip) => {
      const aIsFullHDVertical = (a.width || 0) >= 1080 && (a.height || 0) >= 1920;
      const bIsFullHDVertical = (b.width || 0) >= 1080 && (b.height || 0) >= 1920;

      if (aIsFullHDVertical && !bIsFullHDVertical) return -1;
      if (!aIsFullHDVertical && bIsFullHDVertical) return 1;

      const aArea = (a.width || 0) * (a.height || 0);
      const bArea = (b.width || 0) * (b.height || 0);

      if (aArea !== bArea) {
        return bArea - aArea; // higher resolution first
      }

      return b.relevanceScore - a.relevanceScore;
    };

    // AI Scoring: skip for full/manual search to return all results quickly
    if (useAiScoring) {
      const topCandidates = candidates.sort(compareClips).slice(0, maxResults);
      for (const clip of topCandidates) {
        try {
          const aiScoreResult = await AIProviderManager.scoreClip(sceneVisual, {
            title: clip.title,
            tags: clip.tags,
            description: `Stock clip by ${clip.provider}. Dimensions: ${clip.width}x${clip.height}.`
          });
          scoredCandidates.push({
            ...clip,
            relevanceScore: aiScoreResult.score,
            scoreExplanation: aiScoreResult.reason
          });
        } catch (scoringErr) {
          console.warn(`AI Scoring slipped for ${clip.title}: ${scoringErr}`);
          scoredCandidates.push(clip);
        }
      }
    } else {
      // Full search mode: return all candidates sorted by quality, no AI scoring
      scoredCandidates.push(...candidates.sort(compareClips).slice(0, maxResults));
    }

    // Fallback to standard sorted candidates if something went wrong
    const finalResults = scoredCandidates.length > 0 ? scoredCandidates : candidates;

    // Filter out clips already used in other scenes (global dedup)
    const deduped = excludeClipIds.size > 0
      ? finalResults.filter(c => !excludeClipIds.has(c.id))
      : finalResults;

    // Sort descending by resolution priority and relevance score
    return deduped.sort(compareClips);
  }

  /**
   * Mock download/normalization check
   */
  static async downloadClip(clipId: string): Promise<{ success: boolean; localPath: string }> {
    console.log(`Downloading stock footage clip: ${clipId}`);
    // Simulated background downloader with delay
    await new Promise(resolve => setTimeout(resolve, 800));
    return {
      success: true,
      localPath: `/storage/clips/downloaded_${clipId}.mp4`
    };
  }
}
