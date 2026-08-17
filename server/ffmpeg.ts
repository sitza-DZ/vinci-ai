import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { DB } from "./db";
import { buildSceneVoiceover } from "./sceneVoice";
import { ProviderManagerService } from "./providers";
import { Project, ProjectStatus, ProcessingJob, RenderDiagnostics, TransitionType } from "../src/types";

const execPromise = promisify(exec);

/** Resolve a user-stored asset URL/path (watermarkUrl, scene.imageUrl) to a local file, or null. */
function resolveLocalAsset(p: string | undefined | null): string | null {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  if (p.startsWith("/api/")) {
    const candidate = path.join(process.cwd(), "storage", p.replace(/^\/api\//, ""));
    if (fs.existsSync(candidate)) return candidate;
  }
  if (p.startsWith("storage/")) {
    const candidate = path.join(process.cwd(), p);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Locate a usable bold font for drawtext (Termux/Android + desktop fallbacks). */
function findSystemFont(): string {
  const fontPaths = [
    "/system/fonts/NotoSans-Bold.ttf",
    "/system/fonts/Roboto-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"
  ];
  for (const fp of fontPaths) {
    try { if (fs.existsSync(fp)) return fp; } catch (e) {}
  }
  return "";
}

/**
 * v16: Detect the dominant non-Latin script in a string and return a matching
 * system font (Android /system/fonts) so ASS subtitles render native glyphs
 * (Devanagari, Bengali, Tamil, etc.) instead of tofu boxes.
 * Returns "" when the text is Latin-only / no special font is needed.
 */
function detectScriptFont(text: string): string {
  if (!text) return "";
  // Unicode range -> candidate font files (first existing wins)
  const scriptFonts: { test: RegExp; fonts: string[] }[] = [
    { test: /[\u0900-\u097F]/, fonts: [ // Devanagari (Hindi, Marathi, Nepali)
      "/system/fonts/NotoSansDevanagariUI-VF.ttf",
      "/system/fonts/NotoSansDevanagari-VF.ttf"
    ]},
    { test: /[\u0980-\u09FF]/, fonts: [ // Bengali
      "/system/fonts/NotoSansBengaliUI-VF.ttf",
      "/system/fonts/NotoSansBengali-VF.ttf"
    ]},
    { test: /[\u0A00-\u0A7F]/, fonts: [ // Gurmukhi (Punjabi)
      "/system/fonts/NotoSansGurmukhiUI-VF.ttf",
      "/system/fonts/NotoSansGurmukhi-VF.ttf"
    ]},
    { test: /[\u0A80-\u0AFF]/, fonts: [ // Gujarati
      "/system/fonts/NotoSansGujaratiUI-Bold.ttf",
      "/system/fonts/NotoSansGujarati-Bold.ttf",
      "/system/fonts/NotoSansGujaratiUI-Regular.ttf"
    ]},
    { test: /[\u0B80-\u0BFF]/, fonts: [ // Tamil
      "/system/fonts/NotoSansTamilUI-VF.ttf",
      "/system/fonts/NotoSansTamil-VF.ttf"
    ]},
    { test: /[\u0C00-\u0C7F]/, fonts: [ // Telugu
      "/system/fonts/NotoSansTeluguUI-VF.ttf",
      "/system/fonts/NotoSansTelugu-VF.ttf"
    ]},
    { test: /[\u0C80-\u0CFF]/, fonts: [ // Kannada
      "/system/fonts/NotoSansKannadaUI-VF.ttf",
      "/system/fonts/NotoSansKannada-VF.ttf"
    ]},
    { test: /[\u0D00-\u0D7F]/, fonts: [ // Malayalam
      "/system/fonts/NotoSansMalayalamUI-VF.ttf",
      "/system/fonts/NotoSansMalayalam-VF.ttf"
    ]},
    { test: /[\u0E00-\u0E7F]/, fonts: [ // Thai
      "/system/fonts/NotoSansThaiUI-VF.ttf",
      "/system/fonts/NotoSansThai-VF.ttf"
    ]},
    { test: /[\u0600-\u06FF\u0750-\u077F]/, fonts: [ // Arabic / Urdu
      "/system/fonts/NotoNaskhArabicUI-Bold.ttf",
      "/system/fonts/NotoNaskhArabic-Bold.ttf",
      "/system/fonts/NotoNaskhArabicUI-Regular.ttf"
    ]},
    { test: /[\u0590-\u05FF]/, fonts: [ // Hebrew
      "/system/fonts/NotoSansHebrew-Bold.ttf",
      "/system/fonts/NotoSansHebrew-Regular.ttf"
    ]},
    { test: /[\u1000-\u109F]/, fonts: [ // Myanmar
      "/system/fonts/NotoSansMyanmarUI-Bold.otf",
      "/system/fonts/NotoSansMyanmar-Bold.otf"
    ]},
    { test: /[\u1780-\u17FF]/, fonts: [ // Khmer
      "/system/fonts/NotoSansKhmerUI-Bold.ttf",
      "/system/fonts/NotoSansKhmer-Bold.ttf"
    ]},
    { test: /[\u0E80-\u0EFF]/, fonts: [ // Lao
      "/system/fonts/NotoSansLaoUI-Bold.ttf",
      "/system/fonts/NotoSansLao-Bold.ttf"
    ]},
    { test: /[\u1200-\u137F]/, fonts: [ // Ethiopic
      "/system/fonts/NotoSansEthiopic-VF.ttf"
    ]},
    { test: /[\u10A0-\u10FF]/, fonts: [ // Georgian
      "/system/fonts/NotoSansGeorgian-VF.ttf"
    ]},
    { test: /[\u0530-\u058F]/, fonts: [ // Armenian
      "/system/fonts/NotoSansArmenian-VF.ttf"
    ]}
  ];
  for (const { test, fonts } of scriptFonts) {
    if (test.test(text)) {
      for (const fp of fonts) {
        try { if (fs.existsSync(fp)) return fp; } catch (e) {}
      }
    }
  }
  return "";
}

// TikWM API endpoints for TikTok search & download
const TIKWM_SEARCH_URL = "https://www.tikwm.com/api/feed/search";
const TIKWM_DOWNLOAD_URL = "https://www.tikwm.com/api/video/download";

// Helper: Auto-search TikTok for scene keywords and download the best match
async function autoSearchAndDownloadTikTok(
  scene: any,
  projectId: string,
  downloadsDir: string,
  addLog: (msg: string) => void
): Promise<string | null> {
  const keywords = scene.keywords?.join(" ") || scene.visualDescription || "";
  if (!keywords.trim()) return null;

  // Use keyword hash as cache key
  const kwHash = crypto.createHash("md5").update(keywords.trim().toLowerCase()).digest("hex").slice(0, 10);
  const cachePath = path.join(downloadsDir, `tiktok_auto_${kwHash}.mp4`);
  if (FFmpegService.isFileValid(cachePath)) {
    addLog(`     [TikTok Auto] Using cached TikTok clip for "${keywords.slice(0, 40)}..."`);
    return cachePath;
  }

  addLog(`     [TikTok Auto] Searching TikTok for "${keywords.slice(0, 40)}..."`);

  try {
    // Step 1: Search TikTok
    const searchRes = await fetch(TIKWM_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ keywords: keywords, count: "3", cursor: "0" })
    });
    if (!searchRes.ok) {
      addLog(`     [TikTok Auto] Search API returned ${searchRes.status}`);
      return null;
    }

    const searchData: any = await searchRes.json();
    const videos = searchData?.data?.videos;
    if (!videos?.length) {
      addLog(`     [TikTok Auto] No results found`);
      return null;
    }

    // Pick best match: prefer HD, longest duration, with likes
    const best = videos.sort((a: any, b: any) => (b.digg_count || 0) - (a.digg_count || 0))[0];
    const videoUrl = best.hdplay || best.play;
    if (!videoUrl) {
      addLog(`     [TikTok Auto] No playable URL in result`);
      return null;
    }

    addLog(`     [TikTok Auto] Downloading: ${best.title?.slice(0, 50) || "TikTok video"} (${best.duration || "?"}s)`);

    // Step 2: Download the video
    const tempPath = cachePath + ".tmp";
    const downloadRes = await fetch(videoUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" }
    });
    if (!downloadRes.ok) {
      addLog(`     [TikTok Auto] Download failed: HTTP ${downloadRes.status}`);
      // Try via TikWM API as fallback
      const fallbackRes = await fetch(TIKWM_DOWNLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url: `https://www.tiktok.com/@x/video/${best.video_id}`, hd: "1" })
      });
      if (!fallbackRes.ok) return null;
      const fallbackData: any = await fallbackRes.json();
      const fallbackUrl = fallbackData?.data?.hdplay || fallbackData?.data?.play;
      if (!fallbackUrl) return null;
      const fbRes = await fetch(fallbackUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!fbRes.ok) return null;
      const fbBuf = Buffer.from(await fbRes.arrayBuffer());
      await fs.promises.writeFile(tempPath, fbBuf);
    } else {
      const buf = Buffer.from(await downloadRes.arrayBuffer());
      await fs.promises.writeFile(tempPath, buf);
    }

    // Verify and rename
    if (fs.existsSync(tempPath) && fs.statSync(tempPath).size > 10240) {
      fs.renameSync(tempPath, cachePath);
      addLog(`     ✅ [TikTok Auto] Downloaded (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(1)} MB)`);
      return cachePath;
    }
    try { fs.unlinkSync(tempPath); } catch {}
    return null;
  } catch (e: any) {
    addLog(`     ⚠️ [TikTok Auto] Error: ${e.message?.slice(0, 100)}`);
    return null;
  }
}

// Helper: Auto-search Pinterest for scene keywords
async function autoSearchAndDownloadPinterest(
  scene: any,
  projectId: string,
  downloadsDir: string,
  addLog: (msg: string) => void
): Promise<string | null> {
  const keywords = scene.keywords?.join(" ") || scene.visualDescription || "";
  if (!keywords.trim()) return null;

  const kwHash = crypto.createHash("md5").update("pin_" + keywords.trim().toLowerCase()).digest("hex").slice(0, 10);
  const cachePath = path.join(downloadsDir, `pinterest_auto_${kwHash}.mp4`);

  if (FFmpegService.isFileValid(cachePath)) {
    addLog(`     [Pinterest Auto] Using cached Pinterest clip for "${keywords.slice(0, 40)}..."`);
    return cachePath;
  }

  addLog(`     [Pinterest Auto] Searching Pinterest for "${keywords.slice(0, 40)}..."`);

  // First try yt-dlp search (some builds support it)
  const safeName = `pinterest_auto_${kwHash}`;
  const tempImportsDir = path.join(downloadsDir, "pinterest_auto_imports");
  fs.mkdirSync(tempImportsDir, { recursive: true });

  try {
    // Use yt-dlp to search for Pinterest content
    const searchOutput = path.join(tempImportsDir, `${safeName}.%(ext)s`);
    const searchCmd = `yt-dlp --impersonate Chrome-133 -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${searchOutput}" "https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keywords.trim())}" 2>&1`;
    addLog(`     [Pinterest Auto] Running yt-dlp...`);
    try {
      await execPromise(searchCmd, { shell: true as any, timeout: 30000 });
    } catch {}
    const files = fs.readdirSync(tempImportsDir).filter(f => f.startsWith(safeName) && f.endsWith(".mp4"));
    if (files.length > 0) {
      const src = path.join(tempImportsDir, files[0]);
      fs.renameSync(src, cachePath);
      addLog(`     ✅ [Pinterest Auto] Downloaded (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(1)} MB)`);
      return cachePath;
    }
  } catch {}

  // Fallback: search via RSS API
  try {
    const searchRes = await fetch(
      `https://www.pinterest.com/search/pins/rss/?q=${encodeURIComponent(keywords.trim())}&rs=typed`,
      { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36" } }
    );
    if (!searchRes.ok) return null;
    const xml = await searchRes.text();
    const itemRegex = /<link[^>]*>([\s\S]*?)<\/link>/gi;
    const links: string[] = [];
    let m;
    while ((m = itemRegex.exec(xml)) !== null) {
      const url = m[1].trim();
      if (url.includes("/pin/")) links.push(url);
    }
    if (links.length === 0) return null;

    // Download the first pin using yt-dlp
    const outputPath = path.join(tempImportsDir, `${safeName}_pin.%(ext)s`);
    const cmd = `yt-dlp --impersonate Chrome-133 -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${outputPath}" --no-playlist --no-warnings "${links[0]}" 2>&1`;
    await execPromise(cmd, { shell: true as any, timeout: 60000 });

    const newFiles = fs.readdirSync(tempImportsDir).filter(f => f.startsWith(`${safeName}_pin`) && f.endsWith(".mp4"));
    if (newFiles.length > 0) {
      const src = path.join(tempImportsDir, newFiles[0]);
      fs.renameSync(src, cachePath);
      addLog(`     ✅ [Pinterest Auto] Downloaded via RSS fallback (${(fs.statSync(cachePath).size / 1024 / 1024).toFixed(1)} MB)`);
      return cachePath;
    }
  } catch (e: any) {
    addLog(`     ⚠️ [Pinterest Auto] RSS fallback failed: ${e.message?.slice(0, 100)}`);
  }

  return null;
}

// Throw if cancel was requested for this project
function throwIfCancelled(projectId: string): void {
  const job = DB.getJobByProjectId(projectId);
  if (job?.cancelRequested) {
    // Reset job to allow re-render
    DB.saveJob({
      ...job,
      step: "cancelled",
      progress: 0,
      cancelRequested: false,
      logOutput: [...(job.logOutput || []), `[CANCEL] Render cancelled by user.`]
    });
    // Reset project status
    const proj = DB.getProjectById(projectId);
    if (proj) {
      proj.status = "draft" as any;
      DB.saveProject(proj);
    }
    throw new Error("Render cancelled by user");
  }
}

export class FFmpegService {
  /**
   * Starts a background render job for a given project, updating logs and status
   */
  static async renderProject(projectId: string): Promise<void> {
    const project = DB.getProjectById(projectId);
    if (!project) throw new Error("Project not found");

    const scenes = DB.getScenes(projectId);
    if (scenes.length === 0) {
      throw new Error("Cannot render a project with zero scenes");
    }

    // Get or create processing job
    let job = DB.getJobByProjectId(projectId);
    if (!job) {
      job = {
        id: `job_${projectId}`,
        projectId,
        step: "idle",
        progress: 0,
        logOutput: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    // Mark project as processing
    project.status = ProjectStatus.PROCESSING;
    DB.saveProject(project);

    // Reset any stale cancel flag from previous render attempts
    job.cancelRequested = false;
    job.step = "script";
    job.progress = 5;
    job.logOutput = ["Initializing FFmpeg composition engine..."];
    DB.saveJob(job);

    // Run async rendering process in the background
    this.runRenderingPipeline(project, scenes, job).catch(err => {
      console.error("FFmpeg background rendering pipeline crashed:", err);
      project.status = ProjectStatus.FAILED;
      DB.saveProject(project);

      if (job) {
        job.step = "failed";
        job.progress = 100;
        job.errorMessage = err.message || "Unknown rendering error";
        job.logOutput.push(`[ERROR] Render failed: ${err.message}`);
        
        // Save failed diagnostics
        job.diagnostics = {
          totalScenes: scenes.length,
          totalDownloadedClips: 0,
          totalProcessedClips: 0,
          subtitleStatus: "error",
          ffmpegStatus: "failed",
          finalVideoDuration: 0,
          sourceResolution: "N/A",
          renderResolution: "1080x1920",
          bitrate: "0 Mbps",
          fps: 30,
          codec: "H.264"
        };
        DB.saveJob(job);
      }
    });
  }

  private static formatAssTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const cs = Math.floor((seconds % 1) * 100);
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
  }

  private static async runRenderingPipeline(
    project: Project,
    scenes: any[],
    job: ProcessingJob
  ): Promise<void> {
    // Reset stale voiceover-sync ratio from any previous render (global leak fix)
    (global as any).__voxSyncRatio = undefined;
    let lastLogSave = 0;
    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      job.logOutput.push(`[${timestamp}] ${msg}`);
      // Throttle DB writes: saving the whole job to disk per log line is wasteful during long renders.
      const now = Date.now();
      if (now - lastLogSave > 500) {
        lastLogSave = now;
        DB.saveJob(job);
      }
    };

    const projectDir = path.join(process.cwd(), "storage", "projects", project.id);
    const downloadsDir = path.join(projectDir, "downloads");
    const processedDir = path.join(projectDir, "processed");
    const subtitlesDir = path.join(projectDir, "subtitles");
    const rendersDir = path.join(projectDir, "renders");
    const thumbnailsDir = path.join(projectDir, "thumbnails");

    // Ensure all directories exist
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(processedDir, { recursive: true });
    fs.mkdirSync(subtitlesDir, { recursive: true });
    fs.mkdirSync(rendersDir, { recursive: true });
    fs.mkdirSync(thumbnailsDir, { recursive: true });

    let totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 5), 0);

    // v13: Export aspect-ratio preset (9:16 | 1:1 | 16:9). All downstream scale/crop
    // targets, transition normalization, and diagnostics derive from these dimensions.
    const aspectRatio = project.settings.aspectRatio || "9:16";
    const OUT_W = aspectRatio === "1:1" ? 1080 : aspectRatio === "16:9" ? 1920 : 1080;
    const OUT_H = aspectRatio === "1:1" ? 1080 : aspectRatio === "16:9" ? 1080 : 1920;

    // Per-scene voiceover: if any scene has its own voice/emotion clip, build the
    // concatenated track now so the audio-mix step uses it as the voiceover source.
    try {
      if (scenes.some((s: any) => s.voiceUrl || s.voice || s.emotion)) {
        addLog(`  -> Detected per-scene voices, building concatenated voiceover track...`);
        const built = buildSceneVoiceover(project);
        if (built) {
          addLog(`  -> Per-scene voiceover ready (${built.duration.toFixed(1)}s)`);
        } else {
          addLog(`  -> No valid per-scene voice clips found; using original audio`);
        }
      }
    } catch (voiceErr: any) {
      addLog(`  -> Per-scene voiceover build failed (${voiceErr.message?.slice(0, 80)}); continuing`);
    }

    // --- STEP 1: LOAD METADATA & PREPARE ---
    job.step = "scenes";
    job.progress = 10;
    throwIfCancelled(project.id);
    addLog(`[STEP 1/8] Loading storyboard scenes for composition...`);
    addLog(`  -> Total scenes generated: ${scenes.length}`);
    addLog(`  -> Scene breakdown: [${scenes.map(s => s.duration || 5).join(", ")}]`);
    addLog(`  -> Expected output duration: ${totalDuration}s (${Math.floor(totalDuration / 60)}m ${Math.round(totalDuration % 60)}s)`);
    addLog(`  -> Resolution standard: ${OUT_W}x${OUT_H} (${aspectRatio} aspect-ratio)`);
    addLog(`  -> Base framerate: 30 FPS`);
    addLog(`  -> Codec: libx264 Baseline, AAC audio stereo, 48kHz sample-rate`);

    // v14: Video Template presets — apply a bundle of style settings in-memory for this render.
    // Only fills in values the user has not explicitly configured, so manual tweaks still win.
    const tpl = project.settings.videoTemplate;
    if (tpl && tpl !== "none") {
      const s: any = project.settings;
      const setIfUnset = (key: string, val: any) => { if (s[key] === undefined || s[key] === null || s[key] === "none" || s[key] === false) s[key] = val; };
      if (tpl === "mrbeast") {
        setIfUnset("colorGrade", "vibrant");
        setIfUnset("emojiOverlays", "hype");
        setIfUnset("subtitleStyle", "youtube");
        setIfUnset("autoSfxEnabled", true);
        setIfUnset("beatSyncEnabled", true);
        addLog(`  -> 🎬 Template: MRBEAST — vibrant grade, hype stickers, bold subs, SFX + beat sync`);
      } else if (tpl === "horror") {
        setIfUnset("colorGrade", "noir");
        setIfUnset("emojiOverlays", "none");
        setIfUnset("subtitleStyle", "cinematic");
        setIfUnset("autoSfxEnabled", true);
        addLog(`  -> 🎬 Template: HORROR — noir grade, cinematic subs, suspense SFX`);
      } else if (tpl === "motivational") {
        setIfUnset("colorGrade", "cinematic");
        setIfUnset("emojiOverlays", "auto");
        setIfUnset("subtitleStyle", "tiktok");
        setIfUnset("duckingEnabled", true);
        addLog(`  -> 🎬 Template: MOTIVATIONAL — cinematic grade, auto stickers, ducked music`);
      } else if (tpl === "documentary") {
        setIfUnset("colorGrade", "cool");
        setIfUnset("emojiOverlays", "none");
        setIfUnset("subtitleStyle", "minimal");
        setIfUnset("kenBurnsEnabled", true);
        addLog(`  -> 🎬 Template: DOCUMENTARY — cool grade, minimal subs, Ken Burns`);
      }
    }

    // v14: Beat-sync — if enabled and a BGM track is set, detect beats and nudge scene
    // durations so cuts land on the beat. Adjustments are clamped so pacing stays sane.
    if (project.settings.beatSyncEnabled === true) {
      const bgmFile = (project.settings as any)?.audioSettings?.bgmTrack?.filePath;
      if (bgmFile && fs.existsSync(bgmFile)) {
        try {
          addLog(`[Beat-Sync] Detecting beats in BGM: ${path.basename(bgmFile)}...`);
          const beats = await this.detectBeats(bgmFile);
          if (beats.length >= 4) {
            const bpmEstimate = beats.length > 1
              ? Math.round(60 / ((beats[beats.length - 1] - beats[0]) / (beats.length - 1)))
              : 0;
            addLog(`[Beat-Sync] Found ${beats.length} beats (~${bpmEstimate} BPM). Snapping scene cuts...`);
            let boundary = 0;
            let adjusted = 0;
            for (let i = 0; i < scenes.length; i++) {
              const origDur = scenes[i].duration || 5;
              const target = boundary + origDur;
              // Find the beat closest to the intended cut point
              let best = beats[0];
              let bestDist = Math.abs(beats[0] - target);
              for (const b of beats) {
                const d = Math.abs(b - target);
                if (d < bestDist) { best = b; bestDist = d; }
              }
              // Only snap when the nearest beat is within 0.75s and keeps the scene >= 2s
              if (bestDist <= 0.75 && best - boundary >= 2) {
                const newDur = Math.round((best - boundary) * 10) / 10;
                if (Math.abs(newDur - origDur) > 0.05) {
                  scenes[i].duration = newDur;
                  adjusted++;
                }
                boundary = best;
              } else {
                boundary = target;
              }
            }
            if (adjusted > 0) {
              DB.saveScenes(project.id, scenes);
              addLog(`[Beat-Sync] ✅ ${adjusted} scene cut(s) snapped to beats`);
            } else {
              addLog(`[Beat-Sync] Cuts already close to beats; no changes needed`);
            }
          } else {
            addLog(`[Beat-Sync] ⚠️ Not enough beats detected (${beats.length}); skipping`);
          }
        } catch (bsErr: any) {
          addLog(`[Beat-Sync] ⚠️ Failed (${bsErr.message?.slice(0, 80)}); continuing without beat sync`);
        }
      } else {
        addLog(`[Beat-Sync] ⚠️ No BGM track set; add music to enable beat-synced cuts`);
      }
    }

    // Recompute after beat-sync may have nudged scene durations
    totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 5), 0);

    // --- STEP 2: DOWNLOAD FOOTAGE FOR EVERY SCENE ---
    job.step = "downloading";
    job.progress = 25;
    throwIfCancelled(project.id);
    addLog(`[STEP 2/8] Downloading vertical stock footage for all scenes...`);
    
    let downloadedCount = 0;
    const sceneClips: string[] = [];
    const wasTikTokClip: boolean[] = new Array(scenes.length).fill(false);
    const isImageScene: boolean[] = new Array(scenes.length).fill(false);
    const autoTikTok = project.settings.autoTikTokSource === true;

    // Fallback URL if download fails completely
    const DEFAULT_VIDEO_URL = "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4";

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      // v13: Image scenes (Ken Burns) — use the local image as the visual source,
      // skipping the footage download entirely.
      const sceneImagePath = resolveLocalAsset(scene.imageUrl);
      if (sceneImagePath) {
        isImageScene[i] = true;
        sceneClips.push(sceneImagePath);
        addLog(`  -> Scene ${i + 1}/${scenes.length}: Image scene (${path.basename(sceneImagePath)})`);
        continue;
      }

      let videoUrl = scene.selectedVideoUrl;

      // Auto TikTok Source: if no custom video and setting enabled, search TikTok
      if (!videoUrl && autoTikTok) {
        addLog(`  -> Scene ${i + 1}/${scenes.length}: No footage set, searching TikTok for "${(scene.keywords || []).slice(0, 3).join(", ")}"...`);
        const tiktokClip = await autoSearchAndDownloadTikTok(scene, project.id, downloadsDir, addLog);
        if (tiktokClip) {
          videoUrl = tiktokClip;
          wasTikTokClip[i] = true;
          addLog(`     ✅ Auto TikTok source obtained for scene ${i + 1}`);
        } else {
          addLog(`     ⚠️ TikTok search failed, trying Pinterest...`);
          const pinterestClip = await autoSearchAndDownloadPinterest(scene, project.id, downloadsDir, addLog);
          if (pinterestClip) {
            videoUrl = pinterestClip;
            addLog(`     ✅ Auto Pinterest source obtained for scene ${i + 1}`);
          } else {
            addLog(`     ⚠️ Pinterest also failed, using default footage`);
            videoUrl = DEFAULT_VIDEO_URL;
          }
        }
      } else if (!videoUrl) {
        videoUrl = DEFAULT_VIDEO_URL;
      }

      const urlHash = crypto.createHash("md5").update(videoUrl).digest("hex").slice(0, 12);
      const cachePath = path.join(downloadsDir, `clip_${urlHash}.mp4`);

      addLog(`  -> Scene ${i + 1}/${scenes.length}: Sourcing footage from ${wasTikTokClip[i] ? "tiktok" : (scene.selectedVideoProvider || "pexels")}...`);
      addLog(`     URL: ${videoUrl}`);

      let clipPath = cachePath;
      let sourcedSuccessfully = false;

      // 1. Try to use existing valid cache
      if (this.isFileValid(cachePath)) {
        addLog(`     Using cached footage clip.`);
        sourcedSuccessfully = true;
      } else {
        // If file exists but is corrupted (less than 10KB), clean it up
        if (fs.existsSync(cachePath)) {
          try { fs.unlinkSync(cachePath); } catch (e) {}
        }

        // 2. Try to download the clip
        try {
          addLog(`     Downloading to local cache...`);

          // Handle local file URLs (TikTok/Pinterest imports stored on disk)
          let localFilePath = "";
          if (videoUrl.startsWith("/api/projects/")) {
            const match = videoUrl.match(/\/api\/projects\/([^/]+)\/(tiktok|pinterest)_imports\/(.+)/);
            if (!match) {
              // Try newer URL pattern: /api/projects/{id}/tiktok/{filename}
              const match2 = videoUrl.match(/\/api\/projects\/([^/]+)\/(tiktok|pinterest)\/(.+)/);
              if (match2) {
                localFilePath = path.join(process.cwd(), "storage", "projects", match2[1], `${match2[2]}_imports`, match2[3]);
              }
            } else {
              localFilePath = path.join(process.cwd(), "storage", "projects", match[1], `${match[2]}_imports`, match[3]);
            }
          }

          if (localFilePath && fs.existsSync(localFilePath)) {
            addLog(`     Reading from local file: ${localFilePath}`);
            const buffer = fs.readFileSync(localFilePath);
            await fs.promises.writeFile(cachePath, buffer);
            addLog(`     Local clip cached successfully.`);
            sourcedSuccessfully = true;
          } else {
            const res = await fetch(videoUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
              }
            });
            if (!res.ok) throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
            const buf = await res.arrayBuffer();
            const buffer = Buffer.from(buf);
            if (buffer.length < 10240) {
              throw new Error(`Downloaded file is too small (${buffer.length} bytes), likely a CDN block/error page.`);
            }
            await fs.promises.writeFile(cachePath, buffer);
            addLog(`     Clip downloaded and cached successfully.`);
            sourcedSuccessfully = true;
          }
        } catch (err: any) {
          addLog(`     [WARN] Sourcing original clip failed: ${err.message || err}`);
        }
      }

      // 3. Fallback to default video clip download if first failed
      if (!sourcedSuccessfully) {
        const fallbackHash = crypto.createHash("md5").update(DEFAULT_VIDEO_URL).digest("hex").slice(0, 12);
        const fallbackCachePath = path.join(downloadsDir, `clip_${fallbackHash}.mp4`);

        if (this.isFileValid(fallbackCachePath)) {
          addLog(`     Using cached default fallback clip.`);
          clipPath = fallbackCachePath;
          sourcedSuccessfully = true;
        } else {
          if (fs.existsSync(fallbackCachePath)) {
            try { fs.unlinkSync(fallbackCachePath); } catch (e) {}
          }

          try {
            addLog(`     Downloading default fallback clip...`);
            const fallbackRes = await fetch(DEFAULT_VIDEO_URL, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*"
              }
            });
            if (!fallbackRes.ok) throw new Error(`HTTP Error: ${fallbackRes.status}`);
            const fallbackBuf = await fallbackRes.arrayBuffer();
            const fallbackBuffer = Buffer.from(fallbackBuf);
            if (fallbackBuffer.length < 10240) {
              throw new Error(`Downloaded default fallback file is too small.`);
            }
            await fs.promises.writeFile(fallbackCachePath, fallbackBuffer);
            addLog(`     Default fallback clip downloaded successfully.`);
            clipPath = fallbackCachePath;
            sourcedSuccessfully = true;
          } catch (e: any) {
            addLog(`     [WARN] Default fallback download failed: ${e.message || e}`);
          }
        }
      }

      // 4. Ultimate Fallback: Generate a beautiful, animated gradient video using FFmpeg on the fly!
      if (!sourcedSuccessfully) {
        const duration = scene.duration || 5;
        const generatedPath = path.join(processedDir, `scene_${i + 1}_generated_bg.mp4`);
        addLog(`     [SYSTEM] Offline Mode Engaged. Generating beautiful abstract visual background using FFmpeg...`);
        
        // Pick an elegant theme color based on the scene's tags or visual description text
        const sceneText = (scene.text || "") + " " + (scene.visualDescription || "");
        let themeColor = "0x0f172a"; // Default Slate
        let themeName = "Mystic Slate";
        
        const lowerText = sceneText.toLowerCase();
        if (lowerText.includes("space") || lowerText.includes("star") || lowerText.includes("cosmos") || lowerText.includes("galaxy") || lowerText.includes("universe")) {
          themeColor = "0x090514"; // Deep Cosmic Purple-Black
          themeName = "Cosmic Purple Nebula";
        } else if (lowerText.includes("tech") || lowerText.includes("code") || lowerText.includes("ai") || lowerText.includes("comput") || lowerText.includes("digital")) {
          themeColor = "0x021e10"; // Dark Hacker Green
          themeName = "Hacker Digital Rain";
        } else if (lowerText.includes("money") || lowerText.includes("wealth") || lowerText.includes("dollar") || lowerText.includes("cash") || lowerText.includes("rich") || lowerText.includes("finance")) {
          themeColor = "0x022c22"; // Deep Mint/Emerald Green
          themeName = "Emerald Fortune";
        } else if (lowerText.includes("nature") || lowerText.includes("ocean") || lowerText.includes("sea") || lowerText.includes("beach") || lowerText.includes("water") || lowerText.includes("forest")) {
          themeColor = "0x0c4a6e"; // Deep Ocean Blue
          themeName = "Abyssal Blue Ocean";
        } else if (lowerText.includes("run") || lowerText.includes("gym") || lowerText.includes("fit") || lowerText.includes("workout") || lowerText.includes("health") || lowerText.includes("motiv")) {
          themeColor = "0x450a0a"; // High-intensity Crimson Red
          themeName = "Crimson Vitality";
        }

        addLog(`     Applying Visual Theme: ${themeName} (${themeColor})`);
        
        // Command to generate beautiful ambient shifting colors at the target resolution
        const genCmd = `ffmpeg -y -f lavfi -i "color=c=${themeColor}:s=${OUT_W}x${OUT_H}:d=${duration}" -f lavfi -i "testsrc2=size=${OUT_W}x${OUT_H}:rate=30:d=${duration}" -filter_complex "[1:v]format=yuv420p,gblur=sigma=35,blend=all_mode='overlay'[v]" -map "[v]" -r 30 -c:v libx264 -preset ultrafast -crf 28 "${generatedPath}"`;
        
        addLog(`     Executing: ${genCmd}`);
        try {
          await execPromise(genCmd);
          clipPath = generatedPath;
          sourcedSuccessfully = true;
          addLog(`     [SUCCESS] Beautiful abstract video background successfully generated!`);
        } catch (genErr: any) {
          addLog(`     [FATAL] Unable to generate fallback background: ${genErr.message || genErr}`);
          throw new Error("Unable to download stock footage and dynamic FFmpeg generation failed.");
        }
      }

      // v14: Footage Quality Filter — probe the sourced clip and if it is below the
      // minimum width (low-res sources like 226x426 degrade the final render), try to
      // swap in a higher-quality clip from the stock providers before processing.
      const qualityFilterOn = project.settings.footageQualityFilter !== false; // default on
      const minWidth = project.settings.minFootageWidth ?? 640;
      if (qualityFilterOn && sourcedSuccessfully && !isImageScene[i]) {
        try {
          const { stdout: probeOut } = await execPromise(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "${clipPath}"`
          );
          const clipWidth = parseInt(probeOut.trim(), 10) || 0;
          if (clipWidth > 0 && clipWidth < minWidth) {
            addLog(`     ⚠️ Low-res footage detected (${clipWidth}px < ${minWidth}px) — searching for HD replacement...`);
            const replacement = await this.findHdReplacement(scene, minWidth, downloadsDir, addLog);
            if (replacement) {
              clipPath = replacement;
              addLog(`     ✅ HD replacement sourced (${path.basename(replacement)})`);
            } else {
              addLog(`     ⚠️ No HD replacement found; keeping ${clipWidth}px clip (will be upscaled)`);
            }
          }
        } catch (probeErr: any) {
          addLog(`     ⚠️ Quality probe failed (${probeErr.message?.slice(0, 60)}); keeping clip`);
        }
      }

      sceneClips.push(clipPath);
      downloadedCount++;
      
      job.progress = 25 + Math.floor((i + 1) / scenes.length * 20);
      DB.saveJob(job);
    }
    addLog(`  -> Total clips sourced/cached: ${downloadedCount}/${scenes.length}`);

    // --- STEP 3: SUBTITLE GENERATION ---
    job.step = "rendering";
    job.progress = 45;
    throwIfCancelled(project.id);
    addLog(`[STEP 3/8] Generating Substation Alpha (.ass) subtitles for scene overlays...`);
    
    const assPaths: string[] = [];
    let subtitleStatus: "idle" | "generating" | "generated" | "error" | "disabled" = "disabled";

    addLog(`  -> Subtitle setting from DB: subtitleEnabled = ${JSON.stringify(project.settings.subtitleEnabled)}`);
    const subEnabled = project.settings.subtitleEnabled === true;
    if (subEnabled) {
      subtitleStatus = "generating";
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const assPath = path.join(subtitlesDir, `subtitle_scene_${i + 1}.ass`);

        // Font detection: use exact basename (without ext) so libass can load it from fontsdir.
        // No path-based name mangling — the file basename is the most reliable reference.
        // v16: first pick a script-aware font if the scene text uses a non-Latin script
        // (Devanagari/Bengali/Tamil/etc.) so native glyphs render instead of tofu boxes.
        let fontName = "Sans";
        const scriptFont = detectScriptFont(scene.text || "");
        if (scriptFont) {
          fontName = path.basename(scriptFont).replace(/\.(ttf|otf|ttc)$/i, "");
        } else {
          const commonFonts = [
            "/system/fonts/NotoNaskhArabicUI-Regular.ttf",
            "/system/fonts/NotoNaskhArabic-Regular.ttf",
            "/system/fonts/DroidSans.ttf",
            "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/data/data/com.termux/files/usr/share/fonts/TTF/NotoSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
          ];
          for (const fp of commonFonts) {
            try {
              if (fs.existsSync(fp)) {
                fontName = path.basename(fp).replace(/\.(ttf|otf|ttc)$/i, "");
                break;
              }
            } catch (e) {}
          }
        }
        let fontSize = 56; // 28 * 2
        let primaryColor = "&H00FFFFFF"; // ABGR format (White)
        let secondaryColor = "&H0000FFFF"; // ASS SecondaryColour (pre-fill color for karaoke/typewriter)
        let outlineColor = "&H00000000"; // Black outline
        let outlineWidth = 4; // 2 * 2
        let bold = -1;
        let italic = 0;
        let alignment = 2; // Bottom center
        let borderStyle = 1; // Outline + shadow

        const styleType = project.settings.subtitleStyle;
        if (styleType === "tiktok") {
          primaryColor = "&H0000FFFF"; // Bright Yellow (ASS format: &HAABBGGRR)
          fontSize = 110;
          outlineWidth = 8;
          alignment = 2;
          borderStyle = 1;
        } else if (styleType === "youtube") {
          primaryColor = "&H0000FFFF"; // Yellow text
          outlineColor = "&H000000FF"; // Red outline
          fontSize = 60; // 30 * 2
          outlineWidth = 6;
          italic = -1;
        } else if (styleType === "minimal") {
          fontSize = 44; // 22 * 2
          borderStyle = 3; // Opaque background box
          outlineColor = "&H00000000";
        } else if (styleType === "cinematic") {
          fontSize = 48; // 24 * 2
          italic = -1;
          outlineWidth = 2; // 1 * 2
        } else if (styleType === "gaming") {
          primaryColor = "&H0000FFCC"; // Bright Neon yellow-green
          fontSize = 68; // 34 * 2
          outlineWidth = 8; // 4 * 2
        } else if (styleType === "arabic_premium") {
          fontSize = 64; // 32 * 2
          outlineWidth = 6; // 3 * 2
          // Try to use system Arabic font if available
          const arabicFontPaths = [
            "/system/fonts/NotoNaskhArabicUI-Regular.ttf",
            "/system/fonts/NotoNaskhArabic-Regular.ttf"
          ];
          for (const afp of arabicFontPaths) {
            try {
              if (fs.existsSync(afp)) {
                fontName = path.basename(afp, path.extname(afp)).replace(/-Regular$/i, "").replace(/-UI$/i, "").replace(/-/g, " ");
                break;
              }
            } catch (e) {}
          }
        } else if (styleType === "karaoke") {
          // Word-by-word yellow fill sweep (ASS \kf karaoke tags)
          primaryColor = "&H0000FFFF"; // Yellow = swept/filled portion
          secondaryColor = "&H00FFFFFF"; // White = not yet reached
          fontSize = 72; // 36 * 2
          outlineWidth = 6;
          alignment = 2;
        } else if (styleType === "word_pop") {
          // MrBeast style: 1-2 words at a time with pop-in animation
          primaryColor = "&H0000FFFF"; // Bright yellow
          fontSize = 88; // 44 * 2
          outlineWidth = 8;
          alignment = 2;
        } else if (styleType === "typewriter") {
          // Letter-by-letter reveal (ASS \k tags, untyped chars invisible)
          primaryColor = "&H00FFFFFF"; // Typed text = white
          secondaryColor = "&HFF000000"; // Untyped = fully transparent
          fontSize = 56; // 28 * 2
          outlineWidth = 4;
          alignment = 2;
        }

        // Support custom Font Scale override from project settings
        if (project.settings.fontSize !== undefined) {
          fontSize = project.settings.fontSize * 2;
        }

        let shadow = 0;
        let verticalMargin = 80;
        if (styleType === "tiktok") { shadow = 3; verticalMargin = 200; }
        else if (styleType === "youtube") { shadow = 2; verticalMargin = 120; }
        else if (styleType === "minimal") { verticalMargin = 100; }
        else if (styleType === "gaming") { shadow = 2; verticalMargin = 100; }
        else if (styleType === "arabic_premium") { shadow = 1; verticalMargin = 150; }
        else if (styleType === "karaoke") { shadow = 3; verticalMargin = 220; }
        else if (styleType === "word_pop") { shadow = 4; verticalMargin = 260; }
        else if (styleType === "typewriter") { shadow = 2; verticalMargin = 180; }

        const letterSpacing = project.settings.letterSpacing !== undefined ? project.settings.letterSpacing : 2;
        const wordSpacing = project.settings.wordSpacing !== undefined ? project.settings.wordSpacing : 2;
        const scaledLetterSpacing = letterSpacing;
        const scaledWordSpacing = wordSpacing;

        // Escape ASS special chars: { } → \{ \} (override tags)
        const escapeAss = (t: string) => t.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
        const sceneDur = scene.duration || 5;
        const endTimeStr = this.formatAssTime(sceneDur);
        const rawText = scene.text || "";

        // Build Dialogue event lines per style (default: single static line)
        const dialogueLines: string[] = [];

        if (styleType === "karaoke") {
          // Word-by-word fill sweep using \kf karaoke tags (durations in centiseconds)
          const words = rawText.replace(/\r\n|\r|\n/g, " ").split(/\s+/).filter(Boolean);
          const totalCs = Math.max(1, Math.round(sceneDur * 100));
          const totalChars = Math.max(1, words.reduce((s, w) => s + w.length, 0));
          let text = "";
          for (const w of words) {
            const dur = Math.max(10, Math.round((w.length / totalChars) * totalCs));
            text += `{\\kf${dur}}${escapeAss(w)} `;
          }
          dialogueLines.push(`Dialogue: 0,0:00:00.00,${endTimeStr},Default,,0,0,0,,${text.trimEnd()}`);
        } else if (styleType === "typewriter") {
          // Letter-by-letter reveal using \k tags; untyped chars invisible (transparent SecondaryColour)
          const flat = rawText.replace(/\r\n|\r|\n/g, " ");
          const chars: string[] = flat.split("");
          const typeCs = Math.max(1, Math.round(sceneDur * 100 * 0.8)); // finish typing at 80% of scene
          const perChar = Math.max(2, Math.floor(typeCs / Math.max(1, chars.length)));
          let text = "";
          for (const ch of chars) {
            text += ch === " " ? " " : `{\\k${perChar}}${escapeAss(ch)}`;
          }
          dialogueLines.push(`Dialogue: 0,0:00:00.00,${endTimeStr},Default,,0,0,0,,${text}`);
        } else if (styleType === "word_pop") {
          // MrBeast style: 1-2 words at a time with pop-in scale animation
          const words = rawText.replace(/\r\n|\r|\n/g, " ").split(/\s+/).filter(Boolean);
          const chunks: string[][] = [];
          for (let wi = 0; wi < words.length; wi += 2) {
            chunks.push(words.slice(wi, wi + 2));
          }
          const chunkDur = sceneDur / Math.max(1, chunks.length);
          for (let ci = 0; ci < chunks.length; ci++) {
            const startStr = this.formatAssTime(ci * chunkDur);
            const endStr = this.formatAssTime(Math.min(sceneDur, (ci + 1) * chunkDur));
            const pop = `{\\fscx60\\fscy60\\t(0,120,\\fscx108\\fscy108)\\t(120,220,\\fscx100\\fscy100)}`;
            dialogueLines.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${pop}${escapeAss(chunks[ci].join(" "))}`);
          }
        } else {
          // Static styles: newlines → \N (line break)
          const dialogueText = escapeAss(rawText.replace(/\r\n|\r|\n/g, "\\N"));
          dialogueLines.push(`Dialogue: 0,0:00:00.00,${endTimeStr},Default,,0,0,0,,${dialogueText}`);
        }

        const assContent = `[Script Info]
Title: Scene Subtitle
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${secondaryColor},${outlineColor},&H00000000,${bold},${italic},0,0,100,100,${scaledLetterSpacing},0,${borderStyle},${outlineWidth},${shadow},${alignment},20,20,${verticalMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines.join("\n")}
`;
        await fs.promises.writeFile(assPath, assContent, "utf-8");
        assPaths.push(assPath);
      }
      subtitleStatus = "generated";
      addLog(`  -> Subtitles successfully generated and mapped.`);
    } else {
      addLog(`  -> Subtitles are disabled in project settings.`);
    }

    // --- STEP 4: CREATE INDIVIDUAL PROCESSED CLIPS (SCENE TRIMMING & TRANSTIONS & SUBTITLES) ---
    job.progress = 55;
    throwIfCancelled(project.id);
    addLog(`[STEP 4/8] Building intermediate high-definition clips (scaling, trimming, and rendering)...`);
    
    const processedClips: string[] = [];
    let lastCommand = "";

    const quality = project.settings.qualitySelection || "high";
    let preset = "medium";
    let crf = 18;
    let bitrate = "10M";
    let maxrate = "12M";
    let bufsize = "20M";
    let bitrateLabel = "10.0 Mbps";

    if (quality === "ultra") {
      crf = 14;
      bitrate = "12M";
      maxrate = "15M";
      bufsize = "24M";
      bitrateLabel = "12.0 Mbps";
    }

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sourceVideo = sceneClips[i];
      const duration = scene.duration || 5;
      const outputClipPath = path.join(processedDir, `scene_${i + 1}_processed.mp4`);

      addLog(`  -> Processing Scene ${i + 1}/${scenes.length}: duration = ${duration}s...`);

      // Video filters: Scale to target resolution (Lanczos + sharpen), trim, apply fades, and burn ASS subtitles
      let filterString = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${OUT_H},unsharp=5:5:1.0:5:5:0.0,setsar=1,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`;
      let inputFlags = `-fflags +genpts -noautorotate -ss 0 -t ${duration + 1}`;

      // v13: Image scenes — Ken Burns zoompan (default) or static loop when disabled.
      if (isImageScene[i]) {
        const kenBurns = project.settings.kenBurnsEnabled !== false; // default on
        if (kenBurns) {
          const frames = Math.max(30, Math.round(duration * 30));
          filterString = `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUT_W}:${OUT_H},setsar=1,zoompan=z='min(zoom+0.0015,1.5)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUT_W}x${OUT_H}:fps=30,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`;
          inputFlags = `-noautorotate`; // single image frame; the output -t trims to scene duration
        } else {
          inputFlags = `-loop 1 -noautorotate -ss 0 -t ${duration + 1}`;
        }
        addLog(`     [Image] Ken Burns ${kenBurns ? "zoom" : "static"} (${duration}s)`);
      }

      // v14: Color Grading preset — applied after scale/sharpen, before fades complete
      const grade = project.settings.colorGrade;
      const gradeFilters: Record<string, string> = {
        cinematic: "eq=contrast=1.12:saturation=0.9,curves=preset=increase_contrast,colorbalance=bs=0.08:gs=0.02:rs=-0.05",
        warm: "eq=saturation=1.15:brightness=0.02,colorbalance=rs=0.12:gs=0.04:bs=-0.1",
        cool: "eq=saturation=1.05,colorbalance=bs=0.12:gs=0.03:rs=-0.08",
        vintage: "eq=contrast=0.95:saturation=0.75:brightness=0.03,curves=preset=vintage",
        vibrant: "eq=saturation=1.4:contrast=1.1:brightness=0.02",
        noir: "eq=saturation=0:contrast=1.3:brightness=-0.05",
      };
      if (grade && grade !== "none" && gradeFilters[grade]) {
        filterString += `,${gradeFilters[grade]}`;
        addLog(`     [Grade] ${grade}`);
      }

      // v14: Speed Ramping — per-scene slow-mo (<1) or fast-forward (>1). Video scenes only;
      // read enough source material so the output still fills the scene duration.
      const sceneSpeed = scene.speed && scene.speed > 0 ? scene.speed : 1;
      if (!isImageScene[i] && Math.abs(sceneSpeed - 1) > 0.01) {
        filterString += `,setpts=PTS/${sceneSpeed}`;
        inputFlags = `-fflags +genpts -noautorotate -ss 0 -t ${(duration * sceneSpeed + 1).toFixed(2)}`;
        addLog(`     [Speed] ${sceneSpeed}x ${sceneSpeed < 1 ? "slow-mo" : "fast-forward"}`);
      }

      // Hook overlay: For first scene, add big bold attention-grabbing hook text in center for first 2s
      if (i === 0 && scene.hook && scene.hook.trim()) {
        const hookEnable = `between(t,0.3,${Math.min(2.5, duration)})`;
        // Use textfile to avoid all shell quoting issues (spaces, colons, quotes in hook text)
        const textFilePath = path.join(projectDir, "processed", `hook_text_scene_${i}.txt`);
        try {
          fs.writeFileSync(textFilePath, scene.hook, "utf-8");
        } catch (e) {}

        const fontFile = detectScriptFont(scene.hook) || findSystemFont();
        if (fontFile) {
          filterString += `,drawtext=textfile=${textFilePath}:fontfile=${fontFile}:fontsize=56:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=(h-text_h)/2-40:enable='${hookEnable}'`;
        } else {
          // No font file found - still try drawtext without explicit font
          filterString += `,drawtext=textfile=${textFilePath}:fontsize=52:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=(h-text_h)/2-40:enable='${hookEnable}'`;
        }
      }

      const subEnabledPerScene = project.settings.subtitleEnabled === true;
      if (subEnabledPerScene) {
        addLog(`     [Subtitle] Burning ASS subtitles for scene ${i + 1}`);
        // Use 'ass' filter for reliable ASS style rendering with fontsdir for Android/Termux compatibility
        const escapedAssPath = assPaths[i].replace(/\\/g, "/");
        const fontsDirs = [
          "/system/fonts",
          "/data/data/com.termux/files/usr/share/fonts/TTF",
          "/data/data/com.termux/files/usr/share/fonts",
          "/usr/share/fonts/truetype"
        ];
        let fontsDir = "";
        for (const fd of fontsDirs) {
          try {
            if (fs.existsSync(fd) && fs.readdirSync(fd).length > 0) {
              fontsDir = fd;
              break;
            }
          } catch (e) {}
        }
        if (fontsDir) {
          filterString += `,ass='${escapedAssPath}':fontsdir='${fontsDir}'`;
        } else {
          filterString += `,ass='${escapedAssPath}'`;
        }
      }

      // Watermark blur: blur user-specified region on ANY clip when enabled
      const blurActive = project.settings.blurTikTokWatermark === true;
      const blurX = project.settings.blurX ?? 400;
      const blurY = project.settings.blurY ?? 1500;
      const blurW = project.settings.blurW ?? 280;
      const blurH = project.settings.blurH ?? 80;

      // v13: Custom image watermark overlay (enabled + asset exists) in a corner
      const wmPath = project.settings.watermarkEnabled === true ? resolveLocalAsset(project.settings.watermarkUrl) : null;
      let wmInputs = "";
      let audioIdx = 1; // [0]=source video, [1]=anullsrc, [2]=watermark image (when present)
      const wmPos = project.settings.watermarkPosition || "br";
      const wmPct = Math.max(4, Math.min(30, project.settings.watermarkSize ?? 15));
      const wmW = Math.max(40, Math.round(OUT_W * wmPct / 100));

      // v13: CTA end-card text on the LAST scene when enabled
      const isLast = i === scenes.length - 1;
      const ctaEnabled = project.settings.ctaEnabled === true && isLast && (project.settings.ctaText || "").trim();

      // Write filter_complex to a file to avoid shell quoting issues with ass/drawtext
      const filterFilePath = path.join(processedDir, `filter_scene_${i}.txt`);
      const NL = "\n";
      const filterParts: string[] = [];
      let mainLabel = "main";
      filterParts.push(`[0:v]${filterString}[${mainLabel}]`);

      if (blurActive && blurW > 0 && blurH > 0) {
        filterParts.push(`[${mainLabel}]split[a][b]`);
        filterParts.push(`[a]crop=${blurW}:${blurH}:${blurX}:${blurY},boxblur=20:5[b1]`);
        filterParts.push(`[b][b1]overlay=${blurX}:${blurY}[bmain]`);
        mainLabel = "bmain";
        addLog(`     [Watermark Blur] Active: region ${blurX},${blurY} ${blurW}×${blurH}px`);
      }

      if (wmPath) {
        const wmXY = wmPos === "tl" ? "24:24"
          : wmPos === "tr" ? `main_w-overlay_w-24:24`
          : wmPos === "bl" ? `24:main_h-overlay_h-24`
          : `main_w-overlay_w-24:main_h-overlay_h-24`;
        filterParts.push(`[1:v]scale='min(${wmW},iw)':-2[wm]`);
        filterParts.push(`[${mainLabel}][wm]overlay=${wmXY}:enable='between(t,0,${duration})'[wmain]`);
        mainLabel = "wmain";
        wmInputs = `-loop 1 -i "${wmPath}" `;
        audioIdx = 2;
        addLog(`     [Watermark] Overlay ${path.basename(wmPath)} @ ${wmPos} (${wmPct}% of width)`);
      }

      // v14: Emoji/Sticker overlays — retention stickers (twemoji PNGs in storage/stickers).
      // "auto" = keyword-matched sticker on matching scenes; "hype" = 1-2 stickers every scene.
      const stickerMode = project.settings.emojiOverlays;
      let stickerInputs = "";
      let stickerCount = 0;
      const STICKER_DIR = path.join(process.cwd(), "storage", "stickers");
      if ((stickerMode === "auto" || stickerMode === "hype") && fs.existsSync(STICKER_DIR)) {
        const stickerKeywordMap: Record<string, string[]> = {
          fire: ["fire", "lit", "hot", "flame", "burning"],
          mindblown: ["shocking", "crazy", "unbelievable", "insane", "mind", "wow", "surprising"],
          scream: ["scary", "horror", "terrifying", "fear", "creepy"],
          eyes: ["watch", "look", "see", "secret", "reveal", "notice"],
          moneyface: ["money", "rich", "price", "cost", "expensive", "dollar", "million"],
          joy: ["funny", "laugh", "hilarious", "joke", "comedy"],
          skull: ["dead", "death", "dangerous", "killed"],
          rocket: ["growth", "launch", "fast", "speed", "skyrocket"],
          heart: ["love", "cute", "adorable", "beautiful", "romantic"],
          hundred: ["best", "perfect", "top", "number one"],
          chartup: ["increase", "stats", "data", "percent", "rise"],
          muscle: ["strong", "power", "gym", "workout", "powerful"],
          brain: ["smart", "genius", "fact", "learn", "psychology", "science"],
          trophy: ["win", "winner", "champion", "award", "victory"],
          sparkles: ["amazing", "magic", "transform", "glow"],
          warning: ["warning", "danger", "careful", "never", "avoid"],
          zap: ["energy", "instant", "quick", "electric"],
          cry: ["sad", "cry", "emotional", "heartbreaking", "tears"],
          question: ["why", "how", "mystery"],
          check: ["true", "proven", "confirmed"],
        };
        const hypeSet = ["fire", "hundred", "mindblown", "scream", "zap", "eyes", "rocket", "skull"];
        const sceneTextLower = ((scene.text || "") + " " + (scene.hook || "")).toLowerCase();
        const chosen: string[] = [];
        if (stickerMode === "auto") {
          for (const [name, kws] of Object.entries(stickerKeywordMap)) {
            if (kws.some(kw => sceneTextLower.includes(kw))) { chosen.push(name); break; }
          }
        } else {
          chosen.push(hypeSet[(i * 3) % hypeSet.length]);
          if (duration > 4) chosen.push(hypeSet[(i * 3 + 4) % hypeSet.length]);
        }
        // Positions avoid the subtitle zone (bottom) and hook text (center)
        const positions = ["60:220", "main_w-overlay_w-60:260", "70:620", "main_w-overlay_w-70:680"];
        const sizeBase = Math.round((stickerMode === "hype" ? 0.17 : 0.13) * OUT_W);
        const stkBaseIdx = audioIdx;
        chosen.forEach((name, k) => {
          const file = path.join(STICKER_DIR, `${name}.png`);
          if (!fs.existsSync(file)) return;
          const st = Math.min(Math.max(0.4, duration - 2.6), 0.4 + k * 1.4);
          const en = Math.min(duration - 0.15, st + 2.2);
          if (en <= st + 0.5) return;
          const pos = positions[(i + k) % positions.length];
          const stkIdx = stkBaseIdx + stickerCount;
          // Pop-in: scale grows from 8px to full size over 0.25s starting at st
          filterParts.push(`[${stkIdx}:v]scale=w='if(lt(t,${st.toFixed(2)}),8,min(${sizeBase},${sizeBase}*(t-${st.toFixed(2)})/0.25))':h=-2:eval=frame[stk${k}]`);
          filterParts.push(`[${mainLabel}][stk${k}]overlay=${pos}:enable='between(t,${st.toFixed(2)},${en.toFixed(2)})'[stkmain${k}]`);
          mainLabel = `stkmain${k}`;
          stickerInputs += `-loop 1 -i "${file}" `;
          stickerCount++;
        });
        if (stickerCount > 0) {
          audioIdx = stkBaseIdx + stickerCount;
          addLog(`     [Stickers] ${stickerCount} overlay(s) (${stickerMode})`);
        }
      }

      if (ctaEnabled) {
        // Strip emoji (surrogate pairs) so drawtext renders the box cleanly; cap length
        const ctaText = (project.settings.ctaText || "").replace(/[\uD800-\uDFFF]/g, "").slice(0, 60);
        const ctaStart = Math.round(Math.max(0, duration - 3.2) * 10) / 10;
        const ctaEnable = `between(t,${ctaStart},${duration})`;
        const ctaFile = path.join(processedDir, `cta_text_scene_${i}.txt`);
        try { fs.writeFileSync(ctaFile, ctaText, "utf-8"); } catch (e) {}
        const fontFile = findSystemFont();
        if (fontFile) {
          filterParts.push(`[${mainLabel}]drawtext=textfile=${ctaFile}:fontfile=${fontFile}:fontsize=64:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=22:x=(w-text_w)/2:y=h-260:enable='${ctaEnable}'[c]`);
        } else {
          filterParts.push(`[${mainLabel}]drawtext=textfile=${ctaFile}:fontsize=60:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=22:x=(w-text_w)/2:y=h-260:enable='${ctaEnable}'[c]`);
        }
        mainLabel = "c";
        addLog(`     [CTA] End-card on last scene (${ctaText.length} chars)`);
      }

      filterParts.push(`[${mainLabel}]null[v]`);
      // FFmpeg's filtergraph parser treats newlines as whitespace — chains MUST be
      // separated by ';' or the whole graph parses as one chain and fails with
      // "Invalid argument" at the first secondary input label (e.g. [1:v]).
      const filterContent = filterParts.join(";\n");
      await fs.promises.writeFile(filterFilePath, filterContent, "utf-8");

      // Execute intermediate clip generation with requested high/ultra profile settings
      const cmd = `ffmpeg -y ${inputFlags} -i "${sourceVideo}" ${wmInputs}${stickerInputs}-f lavfi -t ${duration + 2} -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex_script "${filterFilePath}" -map "[v]" -map "${audioIdx}:a" -r 30 -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac -strict unofficial -t ${duration} "${outputClipPath}"`;

      lastCommand = cmd;

      addLog(`     Executing: ${cmd}`);
      try {
        await execPromise(cmd);
      } catch (procErr: any) {
        // Persist the FULL ffmpeg stderr to a file so parse-level failures can be isolated offline
        try {
          fs.writeFileSync(path.join(processedDir, `scene_${i + 1}_error.log`), (procErr?.stderr || procErr?.message || "").toString());
        } catch (e) {}
        const sceneErrDetail = procErr?.stderr?.slice(-1200) || procErr.message?.slice(0, 500);
        addLog(`     ⚠️ Scene ${i + 1} processing failed: ${sceneErrDetail}`);
        // Fallback: re-encode without filter chain but ensure yuv420p
        addLog(`     Trying fallback: re-encode without filters...`);
        const fallbackInput = isImageScene[i]
          ? `-loop 1 -t ${duration} -i "${sourceVideo}"`
          : `-fflags +genpts -noautorotate -ss 0 -t ${duration} -i "${sourceVideo}"`;
        const fallbackCmd = `ffmpeg -y ${fallbackInput} -c:v libx264 -preset ${preset} -crf ${crf} -pix_fmt yuv420p -r 30 -c:a aac -t ${duration} "${outputClipPath}"`;
        try {
          await execPromise(fallbackCmd);
          addLog(`     ✅ Fallback succeeded`);
        } catch (fallbackErr: any) {
          addLog(`     ❌ Fallback also failed. Using default clip.`);
          // Copy default video as last resort
          const defaultClip = path.join(processedDir, "..", "downloads", "clip_default.mp4");
          if (!fs.existsSync(defaultClip)) {
            const defaultRes = await fetch(DEFAULT_VIDEO_URL);
            const defaultBuf = Buffer.from(await defaultRes.arrayBuffer());
            await fs.promises.writeFile(defaultClip, defaultBuf);
          }
          await fs.promises.copyFile(defaultClip, outputClipPath);
        }
      }
      processedClips.push(outputClipPath);
      
      job.progress = 55 + Math.floor((i + 1) / scenes.length * 20);
      DB.saveJob(job);
    }
    addLog(`  -> Total intermediate scene files rendered: ${processedClips.length}`);

    // --- STEP 5: BUILD FFMPEG CONCAT CONFIG FILE ---
    job.step = "rendering";
    job.progress = 80;
    throwIfCancelled(project.id);
    addLog(`[STEP 5/8] Generating FFmpeg concat configuration text file...`);
    
    const concatPath = path.join(processedDir, "concat.txt");
    const concatContent = processedClips.map(clipPath => `file '${path.resolve(clipPath)}'`).join("\n");
    await fs.promises.writeFile(concatPath, concatContent, "utf-8");

    addLog(`----- BEGIN FFMPEG CONCAT FILE CONTENTS -----`);
    addLog(concatContent);
    addLog(`----- END FFMPEG CONCAT FILE CONTENTS -----`);



    // Voiceover sync: detect voiceover duration and scale video to match
    const voxAudioSettings = (project.settings as any)?.audioSettings;
    const voxTrack = voxAudioSettings?.voiceoverTrack;
    if (voxTrack?.filePath && fs.existsSync(voxTrack.filePath)) {
      try {
        const { stdout } = await execPromise(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voxTrack.filePath}"`
        );
        const voxDur = parseFloat(stdout.trim());
        let totalSceneDur = 0;
        for (const clip of processedClips) {
          try {
            const { stdout: dur } = await execPromise(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${clip}"`
            );
            totalSceneDur += parseFloat(dur.trim()) || 5;
          } catch (e) { totalSceneDur += 5; }
        }
        if (voxDur && totalSceneDur > 0 && Math.abs(voxDur - totalSceneDur) > 0.5) {
          // setpts=PTS*ratio scales the video duration by `ratio` — to make video match the
          // voiceover, ratio must be targetDur(vox) / currentDur(clips). (Previously inverted.)
          const speedRatio = voxDur / totalSceneDur;
          addLog("     Voiceover Sync: " + voxDur.toFixed(1) + "s, Clips: " + totalSceneDur.toFixed(1) + "s, Ratio: " + speedRatio.toFixed(3) + "x");
          addLog("     Video will be " + (speedRatio > 1 ? "sped up" : "slowed down") + " to match audio");
          (global as any).__voxSyncRatio = speedRatio;
        }
      } catch (e: any) {
        addLog("     Voiceover Sync: could not probe - " + (e.message?.slice(0, 60) || "error"));
      }
    }


    // --- STEP 6: MERGE ALL SCENE CLIPS IN ORDER (WITH TRANSITIONS) ---
    job.progress = 85;
    throwIfCancelled(project.id);
    addLog(`[STEP 6/8] Merging all processed clips...`);
    const finalRawPath = path.join(rendersDir, `${project.id}_final.mp4`);
    const transitionType = project.settings.transitionType || TransitionType.NONE;
    let mergeCmd: string;

    if (transitionType === TransitionType.NONE || processedClips.length <= 1) {
      // Simple concat via filter_complex (more reliable than concat demuxer)
      addLog(`     Mode: filter_complex concat (no transition)`);
      // Validate all files exist before concat
      const missingFiles = processedClips.filter(p => !fs.existsSync(p));
      if (missingFiles.length > 0) {
        addLog(`     ⚠️ ${missingFiles.length} processed clip(s) missing, using concat-ready fallback to default clips`);
        for (let mi = 0; mi < missingFiles.length; mi++) {
          addLog(`     Missing: ${path.basename(missingFiles[mi])}`);
        }
      }
      const concatInputs = processedClips.map(c => `-i "${c}"`).join(" ");
      const n = processedClips.length;
      // Normalize every input to the target resolution + pixel format before concat.
      // Source clips vary widely (226x426 .. 720x1280) and ffmpeg concat fails on
      // mismatched dimensions, so scale+pad each one to OUT_W x OUT_H first.
      const concatNormParts = processedClips.map((_, idx) =>
        `[${idx}:v]format=yuv420p,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS[vn${idx}]`
      );
      const concatStreams = processedClips.map((_, idx) => `[vn${idx}]`).join("");
      const concatFilter = concatNormParts.join(";") + `;${concatStreams}concat=n=${n}:v=1:a=0[outv]`;
      const concatFilterFile = path.join(rendersDir, "concat_filter.txt");
      await fs.promises.writeFile(concatFilterFile, concatFilter, "utf-8");
      mergeCmd = `ffmpeg -y ${concatInputs} -f lavfi -t ${totalDuration + 2} -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex_script "${concatFilterFile}" -map "[outv]" -map "${n}:a" -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac -r 30 "${finalRawPath}"`;
      addLog(`     Executing: ${mergeCmd}`);
      await execPromise(mergeCmd);
      try { fs.unlinkSync(concatFilterFile); } catch {}
    } else {
      // Try xfade transitions between scenes, fallback to concat if failed
      addLog(`     Mode: xfade transitions (${String(transitionType) === "random" ? "random per clip" : transitionType})`);
      // TransitionType enum values now map 1:1 to ffmpeg xfade names
      const xfadeType = transitionType as string;
      const transDuration = project.settings.transitionDuration ?? 0.3;

      // Map TransitionType enum → valid FFmpeg xfade transition names
      const xfadeNameMap: Record<string, string> = {
        "fade": "fade", "dissolve": "dissolve",
        "slideleft": "slideleft", "slideright": "slideright",
        "slideup": "slideup", "slidedown": "slidedown",
        "zoomin": "zoomin", "radial": "radial",
        "pixelize": "pixelize",
        "circleopen": "circleopen", "circleclose": "circleclose",
        "wipelr": "wipeleft", "wiperl": "wiperight",
        "wipetb": "wipeup", "wipebt": "wipedown",
        // v15 Transition Library — all verified working on this ffmpeg build
        "glitch": "hlslice", "glitchv": "vuslice",
        "whippan": "smoothleft", "zoomthrough": "fadewhite",
        "flashblack": "fadeblack", "blurmorph": "hblur",
        "windwipe": "hlwind", "coverleft": "coverleft",
        "revealright": "revealright", "squeeze": "squeezeh",
        "diagonal": "diagtl", "circlecrop": "circlecrop",
        "rectcrop": "rectcrop", "distance": "distance",
        "grayscale": "fadegrays", "vertopen": "vertopen",
        "horzopen": "horzopen",
      };

      // All valid xfade transitions for random mode
      const allTransitions = Object.values(xfadeNameMap);
      // Deduplicate (in case multiple enum values map to same xfade name — unlikely but safe)
      const uniqueTransitions = [...new Set(allTransitions)];

      try {
        // Get durations for offset calculation
        const durations: number[] = [];
        for (const clip of processedClips) {
          try {
            const { stdout } = await execPromise(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${clip}"`
            );
            durations.push(parseFloat(stdout.trim()) || 5);
          } catch (e) { durations.push(5); }
        }

        // Build xfade filter chain with pixel format normalization
        const filterParts: string[] = [];
        let cumulativeDuration = durations[0];

        // Normalize all inputs to uniform target resolution + yuv420p to prevent xfade dimension mismatch
        for (let i = 0; i < processedClips.length; i++) {
          filterParts.push(`[${i}:v]format=yuv420p,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS[v_norm_${i}]`);
        }

        for (let i = 1; i < processedClips.length; i++) {
          const offset = Math.max(0, cumulativeDuration - transDuration);
          const prevLabel = i === 1 ? `v_norm_0` : `v${String(i - 1).padStart(2, '0')}`;
          const currLabel = `v${String(i).padStart(2, '0')}`;
          const trans = String(transitionType) === "random"
            ? uniqueTransitions[Math.floor(Math.random() * uniqueTransitions.length)]
            : xfadeNameMap[xfadeType] || xfadeType;
          filterParts.push(`[${prevLabel}][v_norm_${i}]xfade=transition=${trans}:duration=${transDuration}:offset=${offset}[${currLabel}]`);
          cumulativeDuration += durations[i] - transDuration;
        }

        const syncRatio = (global as any).__voxSyncRatio;
        const lastLabel = `v${String(processedClips.length - 1).padStart(2, '0')}`;
        let finalFilter = filterParts.join(";");
        let finalMap = `[${lastLabel}]`;
        const inputFiles = processedClips.map(p => `-i "${p}"`).join(" ");

        // xfade only handles video - use anullsrc for audio since we re-encode anyway
        // Write filter_complex to a file to avoid command-line length / quoting issues
        const filterFile = path.join(rendersDir, "xfade_filter.txt");
        await fs.promises.writeFile(filterFile, finalFilter, "utf-8");
        addLog(`     Filter script: ${path.basename(filterFile)} (${finalFilter.slice(0, 120)}...)`);

        mergeCmd = `ffmpeg -y ${inputFiles} -f lavfi -t ${cumulativeDuration + 1} -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex_script "${filterFile}" -map "${finalMap}" -map "${processedClips.length}:a" -r 30 -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac "${finalRawPath}"`;

        addLog(`     Executing xfade merge...`);
        await execPromise(mergeCmd);
        try { fs.unlinkSync(filterFile); } catch {}
        addLog(`     ✅ xfade merge succeeded`);
      } catch (xfadeErr: any) {
        // Fallback: concat without transitions
        addLog(`     ⚠️ xfade failed — last 500 chars: ${(xfadeErr.stderr || xfadeErr.message || "error").slice(-500)}. Falling back to re-encode concat...`);
        // Validate all files exist before concat
        const missing = processedClips.filter(p => !fs.existsSync(p));
        if (missing.length > 0) {
          addLog(`     ⚠️ ${missing.length} clip(s) missing before fallback concat`);
          missing.forEach(m => addLog(`       Missing: ${path.basename(m)}`));
        }
        addLog(`     Concat file: ${concatPath} (exists: ${fs.existsSync(concatPath)})`);
        // Use filter_complex concat (more reliable than concat demuxer)
        const fcInputs = processedClips.map(c => `-i "${c}"`).join(" ");
        const fcN = processedClips.length;
        // Same normalization as the primary concat path — inputs have mixed resolutions
        const fcNormParts = processedClips.map((_, idx) =>
          `[${idx}:v]format=yuv420p,scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease,pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS[vn${idx}]`
        );
        const fcStreams = processedClips.map((_, idx) => `[vn${idx}]`).join("");
        const fcFilter = fcNormParts.join(";") + `;${fcStreams}concat=n=${fcN}:v=1:a=0[outv]`;
        const fcFilterFile = path.join(rendersDir, "concat_filter_fallback.txt");
        await fs.promises.writeFile(fcFilterFile, fcFilter, "utf-8");
        mergeCmd = `ffmpeg -y ${fcInputs} -f lavfi -t ${totalDuration + 2} -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex_script "${fcFilterFile}" -map "[outv]" -map "${fcN}:a" -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac -r 30 "${finalRawPath}"`;
        addLog(`     Executing fallback concat: ${mergeCmd}`);
        try {
          await execPromise(mergeCmd);
          try { fs.unlinkSync(fcFilterFile); } catch {}
        } catch (concatErr: any) {
          addLog(`     ❌ Fallback concat ALSO failed: ${concatErr.stderr?.slice(0, 500) || concatErr.message?.slice(0, 200)}`);
          addLog(`     Trying last resort: single-input concat...`);
          // Last resort: use ffmpeg concat protocol with single input
          const allPaths = processedClips.map(c => path.resolve(c)).join("|");
          const retryCmd = `ffmpeg -y -i "concat:${allPaths}" -c:v libx264 -preset ${preset} -crf ${crf} -pix_fmt yuv420p -c:a aac -r 30 -y "${finalRawPath}" 2>&1`;
          addLog(`     Final attempt: ${retryCmd.slice(0, 200)}...`);
          await execPromise(retryCmd);
        }
      }
    }

    // Verify output file exists and has size
    let outputFileGood = false;
    try {
      if (fs.existsSync(finalRawPath)) {
        const fSize = fs.statSync(finalRawPath).size;
        addLog(`  -> Merge output: ${path.basename(finalRawPath)} (${(fSize / 1024 / 1024).toFixed(2)} MB)`);
        outputFileGood = fSize > 1024; // at least 1KB
      } else {
        addLog(`  -> ❌ Merge output file NOT FOUND at ${finalRawPath}`);
      }
    } catch (statErr: any) {
      addLog(`  -> ⚠️ Cannot stat output: ${statErr.message?.slice(0, 100)}`);
    }

    // Check final output duration after merge (only if file exists)
    const expectedTotal = scenes.reduce((sum, s) => sum + (s.duration || 5), 0);
    try {
      const { stdout: outDur } = await execPromise(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalRawPath}"`
      );
      const actualDuration = parseFloat(outDur.trim()) || 0;
      addLog(`  -> Expected duration: ${expectedTotal.toFixed(1)}s | Actual output: ${actualDuration.toFixed(1)}s (${Math.floor(actualDuration / 60)}m ${Math.round(actualDuration % 60)}s)`);
      if (actualDuration < expectedTotal * 0.8) {
        addLog(`  -> ⚠️ Output is significantly shorter than expected! Some scenes may have been dropped.`);
        addLog(`  -> Expected scenes: ${scenes.length}, processed clips: ${processedClips.length}`);
      }
    } catch (durErr: any) {
      addLog(`  -> ⚠️ Could not probe output duration: ${durErr.stderr?.slice(0, 200) || durErr.message?.slice(0, 100)}`);
    }

    // Voiceover sync: adjust video speed to match audio duration
    const voxRatio = (global as any).__voxSyncRatio;
    if (voxRatio && Math.abs(voxRatio - 1) > 0.01 && fs.existsSync(finalRawPath)) {
      addLog(`[Voiceover Sync] Adjusting video speed by ${voxRatio.toFixed(3)}x to match audio...`);
      try {
        const syncedPath = path.join(rendersDir, `${project.id}_synced.mp4`);
        await execPromise(`ffmpeg -y -i "${finalRawPath}" -vf "setpts=${voxRatio}*PTS" -r 30 -c:v libx264 -preset ${preset} -crf ${crf} -pix_fmt yuv420p -c:a aac "${syncedPath}"`);
        fs.renameSync(syncedPath, finalRawPath);
        addLog(`     ✅ Voiceover sync applied`);
      } catch (syncErr: any) {
        addLog(`     ⚠️ Voiceover sync failed: ${syncErr.stderr?.slice(0, 200) || syncErr.message?.slice(0, 100)}. Continuing with original speed.`);
      }
    }

    // Dynamic Source Resolution Probing
    let sourceResStr = "1920x1080 (Landscape)";
    if (sceneClips.length > 0) {
      try {
        const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${sceneClips[0]}"`;
        const { stdout } = await execPromise(ffprobeCmd);
        if (stdout && stdout.trim()) {
          const res = stdout.trim();
          const parts = res.split('x');
          if (parts.length === 2) {
            const w = parseInt(parts[0]);
            const h = parseInt(parts[1]);
            sourceResStr = `${w}x${h} (${w > h ? "Landscape" : "Portrait"})`;
          }
        }
      } catch (probeErr) {
        console.error("ffprobe error", probeErr);
      }
    }

    // --- AUTO SFX: Scene-based sound effects ---
    const autoSfxEnabled = (project.settings as any)?.autoSfxEnabled;
    const sfxPaths: { file: string; startTime: number }[] = [];
    if (autoSfxEnabled) {
      addLog(`[SFX] Auto SFX enabled - analyzing scenes for sound effects...`);
      const SFX_DIR = path.join(process.cwd(), "storage", "audio", "builtin", "sfx");
      if (fs.existsSync(SFX_DIR)) {
        // Keyword → SFX category mapping
        const sfxKeywordMap: Record<string, string[]> = {
          funny: ["laugh", "haha", "lol", "hilarious", "funny", "joke", "comedy", "humor", "rofl", "😂"],
          applause: ["happy", "joy", "celebrate", "success", "win", "awesome", "amazing", "congratulations", "cheer", "victory",
                     "proud", "achievement", "🎉", "👏"],
          impact: ["boom", "explosion", "punch", "fight", "action", "dramatic", "crash", "hit", "powerful", "intense",
                   "battle", "kick", "smash", "💥", "🔥"],
          whoosh: ["whoosh", "movement", "transition", "swift", "speed", "fast", "quick", "rush", "zoom", "fly", "dash"],
          transition: ["suspense", "mystery", "secret", "reveal", "surprise", "suddenly", "dramatic", "shock",
                       "unexpected", "🎭", "👀"]
        };

        // Index SFX files by category
        const sfxByCat: Record<string, string[]> = {};
        for (const f of fs.readdirSync(SFX_DIR).filter(f => f.endsWith(".mp3"))) {
          const cat = f.split("_")[0];
          if (!sfxByCat[cat]) sfxByCat[cat] = [];
          sfxByCat[cat].push(f);
        }

        // Analyze each scene for keyword matches
        let cumulativeTime = 0;
        for (let i = 0; i < scenes.length; i++) {
          const sceneText = (scenes[i].text || "").toLowerCase();
          const sceneDuration = scenes[i].duration || 5;

          let matchedCat: string | null = null;
          for (const [cat, keywords] of Object.entries(sfxKeywordMap)) {
            if (keywords.some(kw => sceneText.includes(kw))) {
              matchedCat = cat;
              break;
            }
          }
          // Even without keyword match, place a random whoosh/transition for scene changes
          if (!matchedCat && i > 0) {
            const fallbackCats = ["whoosh", "transition"];
            matchedCat = fallbackCats[Math.floor(Math.random() * fallbackCats.length)];
          }

          if (matchedCat && sfxByCat[matchedCat] && sfxByCat[matchedCat].length > 0) {
            const sfxFile = sfxByCat[matchedCat][Math.floor(Math.random() * sfxByCat[matchedCat].length)];
            sfxPaths.push({ file: path.join(SFX_DIR, sfxFile), startTime: cumulativeTime });
            addLog(`   Scene ${i+1} → ${matchedCat} (${sfxFile}): "${sceneText.slice(0, 40)}"`);
          }
          cumulativeTime += sceneDuration;
        }
        addLog(`   Total SFX placed: ${sfxPaths.length}`);
      } else {
        addLog(`   ⚠️ SFX directory not found at ${SFX_DIR}`);
      }
    }

    // Pre-mix SFX into a single track for audio mixing
    let sfxMixPath: string | null = null;
    if (sfxPaths.length > 0) {
      addLog(`[SFX] Pre-mixing ${sfxPaths.length} SFX into audio track...`);
      try {
        sfxMixPath = path.join(rendersDir, `${project.id}_sfx_mix.aac`);
        // Build filter: for each SFX, adelays it to correct position, then amix
        const sfxInputs = sfxPaths.map((_, i) => `-i "${sfxPaths[i].file}"`).join(" ");
        const sfxFilters = sfxPaths.map((sfx, i) =>
          `[${i}:a]adelay=${Math.round(sfx.startTime * 1000)}|${Math.round(sfx.startTime * 1000)},volume=0.4[s${i}]`
        ).join(";");
        const sfxMixInputStr = sfxPaths.map((_, i) => `[s${i}]`).join("");
        const sfxFilterComplex = `${sfxFilters};${sfxMixInputStr}amix=inputs=${sfxPaths.length}:duration=first:dropout_transition=0[sfx_out]`;
        const sfxFilterFile = path.join(rendersDir, `${project.id}_sfx_filter.txt`);
        await fs.promises.writeFile(sfxFilterFile, sfxFilterComplex, "utf-8");
        const sfxCmd = `ffmpeg -y ${sfxInputs} -filter_complex_script "${sfxFilterFile}" -map "[sfx_out]" -c:a aac -b:a 128k "${sfxMixPath}"`;
        await execPromise(sfxCmd);
        addLog(`   ✅ SFX mix created: ${sfxMixPath}`);
      } catch (sfxErr: any) {
        addLog(`   ⚠️ SFX pre-mix failed (${sfxErr.message?.slice(0, 60)}), skipping...`);
        sfxMixPath = null;
      }
    }

    // --- STEP 7: AUDIO MIXING (Voiceover + BGM + SFX) ---
    job.progress = 90;
    const audioSettings = (project.settings as any)?.audioSettings;
    let voiceoverTrack = audioSettings?.voiceoverTrack;
    const bgmTrack = audioSettings?.bgmTrack;

    // v16 FIX: Voiceover recovery — if edgeTts is enabled but the track reference
    // was lost (e.g. wiped by a stale settings save), auto-recover from disk.
    if (!voiceoverTrack && project.settings.edgeTtsEnabled) {
      try {
        const audioDir = path.join(process.cwd(), "storage", "projects", project.id, "audio");
        if (fs.existsSync(audioDir)) {
          const voFiles = fs.readdirSync(audioDir)
            .filter(f => f.startsWith("voiceover") && f.endsWith(".mp3"))
            .map(f => ({ f, mtime: fs.statSync(path.join(audioDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (voFiles.length > 0) {
            const voPath = path.join(audioDir, voFiles[0].f);
            let voDur = 0;
            try {
              const { stdout } = await execPromise(
                `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voPath}"`
              );
              voDur = parseFloat(stdout.trim()) || 0;
            } catch {}
            voiceoverTrack = {
              url: `/api/projects/${project.id}/audio/voiceover`,
              filePath: voPath,
              fileName: voFiles[0].f,
              fileSize: fs.statSync(voPath).size,
              duration: voDur,
              format: "mp3"
            };
            // Persist the recovered reference so future renders don't need recovery
            if (!(project.settings as any).audioSettings) (project.settings as any).audioSettings = {};
            (project.settings as any).audioSettings.voiceoverTrack = voiceoverTrack;
            DB.saveProject(project);
            addLog(`   🔊 Voiceover track recovered from disk: ${voFiles[0].f} (${voDur.toFixed(1)}s)`);
          }
        }
      } catch (recErr: any) {
        addLog(`   ⚠️ Voiceover recovery failed (${recErr.message?.slice(0, 60)})`);
      }
    }

    if (voiceoverTrack || bgmTrack) {
      throwIfCancelled(project.id);
      addLog(`[STEP 7/9] Mixing audio tracks...`);
      let voicePath = voiceoverTrack?.filePath;
      const bgmPath = bgmTrack?.filePath;
      const voiceVol = (audioSettings?.voiceVolume ?? 100) / 100;
      const musicVol = (audioSettings?.musicVolume ?? 15) / 100;
      const bgmMode = audioSettings?.bgmMode || "none";

      // v14: Voiceover preprocessing — silence removal + voice changer effects.
      // Runs before mixing so every downstream step uses the processed track.
      if (voicePath && fs.existsSync(voicePath)) {
        const voiceEffect = project.settings.voiceEffect;
        const silenceRemoval = project.settings.silenceRemoval === true;
        if (silenceRemoval || (voiceEffect && voiceEffect !== "none")) {
          try {
            const processedVoicePath = path.join(rendersDir, `${project.id}_voice_fx.m4a`);
            const afChain: string[] = [];
            if (silenceRemoval) {
              // silenceremove: strip leading/trailing silence and gaps >0.35s below -35dB
              afChain.push("silenceremove=start_periods=1:start_threshold=-35dB:stop_periods=-1:stop_duration=0.35:stop_threshold=-35dB");
              addLog(`   [Voice FX] Auto silence removal (gaps >0.35s cut)`);
            }
            if (voiceEffect && voiceEffect !== "none") {
              const fx: Record<string, string> = {
                deep: "asetrate=44100*0.82,aresample=44100,atempo=1.22",
                chipmunk: "asetrate=44100*1.35,aresample=44100,atempo=0.74",
                robot: "aformat=sample_fmts=fltp,acrusher=bits=8:mode=log,vibrato=f=30:d=0.4",
                echo: "aecho=0.8:0.75:120:0.35",
                radio: "highpass=f=300,lowpass=f=3200,atempo=1.02",
              };
              if (fx[voiceEffect]) {
                afChain.push(fx[voiceEffect]);
                addLog(`   [Voice FX] Voice changer: ${voiceEffect}`);
              }
            }
            if (afChain.length) {
              const afArg = afChain.join(",");
              await execPromise(`ffmpeg -y -i "${voicePath}" -af "${afArg}" -c:a aac -b:a 192k "${processedVoicePath}"`);
              if (fs.existsSync(processedVoicePath) && fs.statSync(processedVoicePath).size > 1024) {
                voicePath = processedVoicePath;
                addLog(`   ✅ Voice FX applied`);
              }
            }
          } catch (fxErr: any) {
            addLog(`   ⚠️ Voice FX failed (${fxErr.message?.slice(0, 80)}); using original voiceover`);
          }
        }
      }

      try {
        let audioInputs = "";
        let filterParts: string[] = [];
        let inputIdx = 1;
        let mapLabels: string[] = [];

        // Extract audio from video
        audioInputs += `-i "${finalRawPath}" `;
        filterParts.push(`[0:a]volume=1.0[vid_audio]`);
        mapLabels.push("vid_audio");

        // Add voiceover if present
        if (voicePath && fs.existsSync(voicePath)) {
          audioInputs += `-i "${voicePath}" `;
          filterParts.push(`[${inputIdx}:a]volume=${voiceVol}[vo_audio]`);
          mapLabels.push("vo_audio");
          inputIdx++;
          addLog(`   Voiceover: ${voiceoverTrack.fileName} (${voiceoverTrack.duration}s, vol: ${audioSettings?.voiceVolume ?? 100}%)`);
        }

        // Add BGM if present
        if (bgmPath && fs.existsSync(bgmPath)) {
          let bgmFilter = `volume=${musicVol}`;
          if (bgmMode === "loop") {
            audioInputs += `-stream_loop -1 -i "${bgmPath}" `;
          } else {
            audioInputs += `-i "${bgmPath}" `;
            if (bgmMode === "fade_in" || bgmMode === "fade_both") bgmFilter += ",afade=t=in:st=0:d=2";
            if (bgmMode === "fade_out" || bgmMode === "fade_both") {
              const totalDur = voiceoverTrack?.duration || 30;
              bgmFilter += `,afade=t=out:st=${Math.max(0, totalDur - 2)}:d=2`;
            }
          }
          filterParts.push(`[${inputIdx}:a]${bgmFilter}[bgm_audio]`);
          mapLabels.push("bgm_audio");
          inputIdx++;
          addLog(`   BGM: ${bgmTrack.fileName} (${bgmTrack.duration}s, vol: ${audioSettings?.musicVolume ?? 15}%, mode: ${bgmMode})`);
        }

        // Add pre-mixed SFX track if present
        if (sfxMixPath && fs.existsSync(sfxMixPath)) {
          audioInputs += `-i "${sfxMixPath}" `;
          filterParts.push(`[${inputIdx}:a]volume=0.5[sfx_audio]`);
          mapLabels.push("sfx_audio");
          inputIdx++;
          addLog(`   SFX: ${sfxPaths.length} sound effects`);
        }

        if (mapLabels.length >= 2) {
          // v13: Ducking — auto-lower BGM while the voiceover is speaking (needs both tracks)
          const duckingActive = project.settings.duckingEnabled === true
            && !!voicePath && fs.existsSync(voicePath)
            && !!bgmPath && fs.existsSync(bgmPath);
          const mixLabels: string[] = [...mapLabels];
          if (duckingActive) {
            const voLabel = mapLabels.find((l) => l.startsWith("vo_"));
            const bgmLabel = mapLabels.find((l) => l.startsWith("bgm_"));
            if (voLabel && bgmLabel) {
              filterParts.push(`[${voLabel}]asplit=2[vo_keep][vo_sc]`);
              filterParts.push(`[${bgmLabel}][vo_sc]sidechaincompress=threshold=0.03:ratio=8:attack=50:release=300[bgm_duck]`);
              mixLabels[mixLabels.indexOf(voLabel)] = "vo_keep";
              mixLabels[mixLabels.indexOf(bgmLabel)] = "bgm_duck";
              addLog(`   Ducking: BGM ducks while voiceover speaks (sidechaincompress)`);
            }
          }

          // Mix multiple audio streams
          const mixInputs = mixLabels.map((l, i) => `[${l}]`).join("");
          const mixDuration = Math.min(
            ...(voiceoverTrack ? [voiceoverTrack.duration] : []),
            ...(bgmTrack && bgmMode !== "loop" ? [bgmTrack.duration] : []),
            Infinity
          );
          filterParts.push(`${mixInputs}amix=inputs=${mixLabels.length}:duration=${mixDuration === Infinity ? "longest" : "first"}:dropout_transition=2[final_audio]`);

          const mixedAudioPath = path.join(rendersDir, `${project.id}_mixed_audio.aac`);
          const filterComplex = filterParts.join(";");
          const mixFilterFile = path.join(rendersDir, `${project.id}_mix_filter.txt`);
          await fs.promises.writeFile(mixFilterFile, filterComplex, "utf-8");
          const mixCmd = `ffmpeg -y ${audioInputs}-filter_complex_script "${mixFilterFile}" -map "[final_audio]" -c:a aac -b:a 192k "${mixedAudioPath}"`;
          addLog(`   Mixing audio...`);
          await execPromise(mixCmd);

          // Replace video audio with mixed audio
          const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
          // -shortest truncated the video when audio was shorter; apad + explicit -t pads the audio to the full video length instead.
          const replaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${mixedAudioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -af apad -t ${totalDuration} "${mixedVideoPath}"`;
          addLog(`   Replacing video audio...`);
          await execPromise(replaceCmd);

          // Replace original with mixed version
          fs.renameSync(mixedVideoPath, finalRawPath);
          try { fs.unlinkSync(mixedAudioPath); } catch (e) {}
          addLog(`   ✅ Audio mix complete (voiceover${bgmPath ? " + bgm" : ""})`);
        } else if (mapLabels.length === 1 && voicePath && fs.existsSync(voicePath)) {
          // Just voiceover, no BGM - replace video audio directly
          const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
          const replaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${voicePath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -af "volume=${voiceVol},apad" -t ${totalDuration} "${mixedVideoPath}"`;
          addLog(`   Replacing video audio with voiceover...`);
          await execPromise(replaceCmd);
          fs.renameSync(mixedVideoPath, finalRawPath);
          addLog(`   ✅ Voiceover applied`);
        }
      } catch (mixErr: any) {
        addLog(`   ⚠️ Audio mixing skipped: ${mixErr.stderr?.slice(0, 200) || mixErr.message?.slice(0, 80)}`);
      }
    } else if (sfxMixPath && fs.existsSync(sfxMixPath)) {
      addLog(`[STEP 7/9] Mixing SFX with original clip audio...`);
      try {
        const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
        const sfxReplaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${sfxMixPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -af "volume=0.5,apad" -t ${totalDuration} "${mixedVideoPath}"`;
        await execPromise(sfxReplaceCmd);
        fs.renameSync(mixedVideoPath, finalRawPath);
        addLog(`   ✅ SFX mixed into video audio`);
      } catch (sfxMixErr: any) {
        addLog(`   ⚠️ SFX mixing failed: ${sfxMixErr.message?.slice(0, 60)}`);
      }
    } else {
      addLog(`[STEP 7/9] Audio: using original clip audio (no voiceover/BGM/SFX)`);
    }

    // --- STEP 8: COMPLETED STATUS & RECORD DIAGNOSTICS ---
    job.step = "completed";
    job.progress = 100;
    addLog(`[STEP 8/9] Short Video Compiled Successfully!`);
    addLog(`  -> Final merged duration: ${totalDuration}s`);
    addLog(`  -> Output video file path: storage/projects/${project.id}/renders/${project.id}_final.mp4`);

    project.status = ProjectStatus.COMPLETED;
    project.renderedVideoUrl = `/api/projects/${project.id}/final.mp4`;

    // Auto-generate project thumbnail from rendered video (v13: aspect-aware + optional title overlay)
    try {
      const thumbnailsDir = path.join(process.cwd(), "storage", "projects", project.id, "thumbnails");
      fs.mkdirSync(thumbnailsDir, { recursive: true });
      const thumbnailPath = path.join(thumbnailsDir, `${project.id}_thumbnail.jpg`);
      // Match thumbnail shape to the output aspect ratio (keep ~640px on the long edge)
      const tW = OUT_W >= OUT_H ? 640 : Math.round(640 * OUT_W / OUT_H);
      const tH = OUT_W >= OUT_H ? Math.round(640 * OUT_H / OUT_W) : 640;
      // Build the ENTIRE filter graph in one string so drawtext's x=(w-text_w)/2 stays
      // inside the -vf "..." quotes (unquoted parens break /bin/sh parsing).
      let thumbVf = `scale=${tW}:${tH}`;
      if (project.settings.aiThumbnail === true && (project.title || "").trim()) {
        // Strip emoji so the text box renders cleanly; cap length
        const thumbText = (project.title || "").replace(/[\uD800-\uDFFF]/g, "").slice(0, 60);
        const thumbTextFile = path.join(thumbnailsDir, `${project.id}_thumb_title.txt`);
        try { fs.writeFileSync(thumbTextFile, thumbText, "utf-8"); } catch (e) {}
        const fontFile = findSystemFont();
        if (fontFile) {
          thumbVf += `,drawtext=textfile=${thumbTextFile}:fontfile=${fontFile}:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-130`;
        } else {
          thumbVf += `,drawtext=textfile=${thumbTextFile}:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=14:x=(w-text_w)/2:y=h-130`;
        }
        addLog(`   🖼️ Thumbnail title overlay: "${thumbText.slice(0, 30)}..."`);
      }
      const thumbCmd = `ffmpeg -y -ss 00:00:01 -i "${finalRawPath}" -vframes 1 -q:v 3 -vf "${thumbVf}" "${thumbnailPath}"`;
      await execPromise(thumbCmd);
      if (fs.existsSync(thumbnailPath)) {
        project.thumbnailUrl = `/api/projects/${project.id}/thumbnail.jpg`;
        addLog(`   ✅ Thumbnail generated: ${thumbnailPath}`);
      }
    } catch (thumbErr: any) {
      addLog(`   ⚠️ Thumbnail generation skipped: ${thumbErr.stderr?.slice(0, 200) || thumbErr.message?.slice(0, 60)}`);
    }
    project.duration = totalDuration;
    project.fileSize = `${(totalDuration * 0.12).toFixed(1)} MB`; // Real size calculated on output
    
    try {
      if (fs.existsSync(finalRawPath)) {
        const stats = fs.statSync(finalRawPath);
        project.fileSize = `${(stats.size / (1024 * 1024)).toFixed(2)} MB`;
      }
    } catch (e) {
      // ignore
    }

    // Set detailed render diagnostics
    const diagnostics: RenderDiagnostics = {
      totalScenes: scenes.length,
      totalDownloadedClips: downloadedCount,
      totalProcessedClips: processedClips.length,
      subtitleStatus: subtitleStatus,
      ffmpegStatus: "completed",
      ffmpegCommand: mergeCmd,
      concatFileContents: concatContent,
      finalVideoDuration: totalDuration,
      sourceResolution: sourceResStr,
      renderResolution: `${OUT_W}x${OUT_H}`,
      bitrate: bitrateLabel,
      fps: 30,
      codec: "H.264 (libx264)",
      downloadDiagnostics: {
        renderedFilePath: finalRawPath,
        fileExists: fs.existsSync(finalRawPath),
        fileSize: project.fileSize || "0.00 MB",
        contentType: "video/mp4",
        downloadUrl: `/api/projects/${project.id}/final.mp4`
      }
    };

    job.diagnostics = diagnostics;

    DB.saveProject(project);

    addLog(`[SUCCESS] FFmpeg render pipeline successfully completed!`);
    addLog(`Exported File Name: ${project.id}_final.mp4`);
    addLog(`Video Quality: ${quality.toUpperCase()} ${OUT_W}x${OUT_H} @ 30 FPS`);
    addLog(`Total File Size: ${project.fileSize}`);

    DB.saveJob(job);

    // Automatic cleanup of temporary files (processed and subtitles) after successful rendering
    addLog(`[SYSTEM] Starting automatic post-render cleanup of temporary processed clips and subtitles...`);
    FFmpegService.cleanupAfterRender(project.id);
    addLog(`[SYSTEM] Automatic cleanup completed. Pristine workspace maintained.`);
  }

  static clearProjectCache(projectId: string): void {
    const projectDir = path.join(process.cwd(), "storage", "projects", projectId);
    const subfolders = ["downloads", "processed", "subtitles", "renders", "thumbnails"];
    
    for (const folder of subfolders) {
      const folderPath = path.join(projectDir, folder);
      if (fs.existsSync(folderPath)) {
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
        } catch (e) {
          console.error(`Error deleting folder ${folderPath}:`, e);
        }
      }
      try {
        fs.mkdirSync(folderPath, { recursive: true });
      } catch (e) {
        console.error(`Error creating folder ${folderPath}:`, e);
      }
    }

    // Reset project and scenes in DB
    const project = DB.getProjectById(projectId);
    if (project) {
      project.status = "draft" as any;
      project.renderedVideoUrl = undefined;
      project.duration = 0;
      project.fileSize = undefined;
      DB.saveProject(project);
    }
    
    // Clear scene cache
    DB.saveScenes(projectId, []);

    // Reset or update Job
    const job = DB.getJobByProjectId(projectId);
    if (job) {
      job.step = "idle";
      job.progress = 0;
      job.logOutput = ["Cache cleared successfully. Workspace reset."];
      job.errorMessage = undefined;
      job.diagnostics = {
        totalScenes: 0,
        totalDownloadedClips: 0,
        totalProcessedClips: 0,
        subtitleStatus: "idle",
        ffmpegStatus: "idle",
        ffmpegCommand: "",
        concatFileContents: "",
        finalVideoDuration: 0,
        sourceResolution: "N/A",
        renderResolution: "1080x1920",
        bitrate: "0 Mbps",
        fps: 30,
        codec: "H.264",
        currentProjectId: projectId,
        cacheStatus: "Clean",
        downloadCount: 0,
        processedClipCount: 0,
        cacheClearedStatus: "Yes (Clean)"
      };
      DB.saveJob(job);
    }
  }

  static cleanupAfterRender(projectId: string): void {
    const projectDir = path.join(process.cwd(), "storage", "projects", projectId);
    const subfoldersToClean = ["processed", "subtitles"];
    
    for (const folder of subfoldersToClean) {
      const folderPath = path.join(projectDir, folder);
      if (fs.existsSync(folderPath)) {
        try {
          const files = fs.readdirSync(folderPath);
          for (const file of files) {
            fs.unlinkSync(path.join(folderPath, file));
          }
        } catch (e) {
          console.error(`Error cleaning up folder ${folderPath}:`, e);
        }
      }
    }
  }

  static getProjectDiagnostics(projectId: string): any {
    const projectDir = path.join(process.cwd(), "storage", "projects", projectId);
    const downloadsDir = path.join(projectDir, "downloads");
    const processedDir = path.join(projectDir, "processed");
    const rendersDir = path.join(projectDir, "renders");
    const subtitlesDir = path.join(projectDir, "subtitles");

    let downloadCount = 0;
    let processedClipCount = 0;
    let rendersCount = 0;
    let totalBytes = 0;

    const countFilesAndSize = (dir: string): { count: number; size: number } => {
      let count = 0;
      let size = 0;
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
              count++;
              size += stat.size;
            }
          }
        } catch (e) {
          console.error("Error reading dir", dir, e);
        }
      }
      return { count, size };
    };

    const dlStats = countFilesAndSize(downloadsDir);
    const procStats = countFilesAndSize(processedDir);
    const renderStats = countFilesAndSize(rendersDir);
    const subStats = countFilesAndSize(subtitlesDir);

    downloadCount = dlStats.count;
    processedClipCount = procStats.count;
    totalBytes = dlStats.size + procStats.size + renderStats.size + subStats.size;

    const sizeInMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const cacheStatus = totalBytes === 0 ? "Clean" : `Active Cache (${sizeInMB} MB)`;
    const cacheClearedStatus = totalBytes === 0 ? "Yes (Clean)" : "No (Active Cache)";

    const scenes = DB.getScenes(projectId);
    const project = DB.getProjectById(projectId);
    const job = DB.getJobByProjectId(projectId);

    const finalMp4Path = path.join(rendersDir, `${projectId}_final.mp4`);
    const finalMp4Exists = fs.existsSync(finalMp4Path);
    let finalMp4SizeStr = "0.00 MB";
    if (finalMp4Exists) {
      try {
        const stat = fs.statSync(finalMp4Path);
        finalMp4SizeStr = `${(stat.size / (1024 * 1024)).toFixed(2)} MB`;
      } catch (e) {
        console.error("Error reading size of final mp4", e);
      }
    }

    return {
      totalScenes: scenes.length,
      totalDownloadedClips: downloadCount,
      totalProcessedClips: processedClipCount,
      subtitleStatus: project?.settings.subtitleEnabled ? (project.status === "completed" ? "generated" : "idle") : "disabled",
      ffmpegStatus: project?.status === "completed" ? "completed" : (project?.status === "processing" ? "running" : "idle"),
      ffmpegCommand: job?.diagnostics?.ffmpegCommand || "ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4",
      concatFileContents: job?.diagnostics?.concatFileContents || scenes.map((_, i) => `file 'scene_${i+1}_processed.mp4'`).join("\n"),
      finalVideoDuration: project?.duration || scenes.reduce((sum, s) => sum + (s.duration || 5), 0),
      sourceResolution: job?.diagnostics?.sourceResolution || "N/A",
      renderResolution: "1080x1920",
      bitrate: job?.diagnostics?.bitrate || "10.0 Mbps",
      fps: 30,
      codec: "H.264 (libx264)",
      currentProjectId: projectId,
      cacheStatus,
      downloadCount,
      processedClipCount,
      cacheClearedStatus,
      downloadDiagnostics: {
        renderedFilePath: finalMp4Path,
        fileExists: finalMp4Exists,
        fileSize: finalMp4SizeStr,
        contentType: "video/mp4",
        downloadUrl: `/api/projects/${projectId}/final.mp4`
      }
    };
  }

  /**
   * v14: Footage Quality Filter helper — search stock providers for a higher-resolution
   * replacement clip for a scene whose sourced footage is below the minimum width.
   * Returns the local path of the downloaded replacement, or null if none found.
   */
  static async findHdReplacement(
    scene: any,
    minWidth: number,
    downloadsDir: string,
    addLog: (msg: string) => void
  ): Promise<string | null> {
    try {
      const keywords = (scene.keywords && scene.keywords.length) ? scene.keywords : [scene.visualDescription || scene.text || ""];
      const enabled = ["pexels", "pixabay", "coverr"];
      const clips = await ProviderManagerService.searchFootage(
        scene.visualDescription || "",
        keywords.slice(0, 3),
        enabled,
        8,   // perPage
        6,   // maxResults
        false // skip AI scoring — we only care about resolution here
      );
      // Prefer clips whose reported width meets the threshold
      const good = clips.filter(c => (c.width || 0) >= minWidth);
      const pool = good.length ? good : clips;
      for (const clip of pool.slice(0, 3)) {
        try {
          const urlHash = crypto.createHash("md5").update(clip.url).digest("hex").slice(0, 12);
          const cachePath = path.join(downloadsDir, `clip_hd_${urlHash}.mp4`);
          if (this.isFileValid(cachePath)) return cachePath;
          const res = await fetch(clip.url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
          });
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 10240) continue;
          await fs.promises.writeFile(cachePath, buf);
          // Verify actual width of the downloaded file
          const { stdout: probeOut } = await execPromise(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "${cachePath}"`
          );
          const w = parseInt(probeOut.trim(), 10) || 0;
          if (w >= minWidth) return cachePath;
          addLog(`     Replacement candidate only ${w}px, trying next...`);
        } catch (dlErr: any) {
          addLog(`     Replacement download failed (${dlErr.message?.slice(0, 50)}), trying next...`);
        }
      }
      return null;
    } catch (e: any) {
      addLog(`     HD replacement search failed: ${e.message?.slice(0, 80)}`);
      return null;
    }
  }

  static isFileValid(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const stats = fs.statSync(filePath);
      return stats.size > 10240; // larger than 10KB
    } catch {
      return false;
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * v14: Beat-sync helper — detect approximate beat timestamps from an audio track.
   * Isolates low-frequency energy (kick drum) via a 150Hz low-pass, downsamples to 8kHz
   * mono, then finds onset peaks in the energy flux (positive first-order difference)
   * with an adaptive threshold and a minimum beat interval.
   * Returns beat times in seconds (may be empty if detection fails).
   */
  static async detectBeats(audioPath: string, maxBeats = 400): Promise<number[]> {
    try {
      // Dump low-passed mono 8kHz 16-bit PCM to stdout
      const { stdout } = await execPromise(
        `ffmpeg -v error -i "${audioPath}" -af "lowpass=f=150,aresample=8000" -ac 1 -f s16le -`,
        { encoding: "buffer" as any, maxBuffer: 64 * 1024 * 1024 }
      );
      const buf: Buffer = stdout as unknown as Buffer;
      if (!buf || buf.length < 1600) return [];
      const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      const rate = 8000;
      const win = Math.floor(rate * 0.02); // 20ms energy window
      const energies: number[] = [];
      for (let i = 0; i + win < samples.length; i += win) {
        let sum = 0;
        for (let j = 0; j < win; j++) {
          const v = samples[i + j] / 32768;
          sum += v * v;
        }
        energies.push(sum / win);
      }
      if (energies.length < 10) return [];
      // Onset flux: positive first-order difference of energy catches attack transients
      // even when sustained energy plateaus (more robust than raw energy peaks).
      const flux = energies.map((e, i) => (i === 0 ? 0 : Math.max(0, e - energies[i - 1])));
      const avg = flux.reduce((a, b) => a + b, 0) / flux.length;
      const threshold = avg * 1.6;
      const minIntervalWin = Math.floor(0.30 / 0.02); // max ~200 BPM
      const beats: number[] = [];
      let lastBeatWin = -minIntervalWin;
      for (let i = 1; i < flux.length - 1; i++) {
        const f = flux[i];
        if (
          f > threshold &&
          f >= flux[i - 1] && f >= flux[i + 1] &&
          i - lastBeatWin >= minIntervalWin
        ) {
          beats.push(i * 0.02);
          lastBeatWin = i;
          if (beats.length >= maxBeats) break;
        }
      }
      return beats;
    } catch (e: any) {
      console.error("[beat-sync] detection failed:", e?.message?.slice(0, 100));
      return [];
    }
  }
}
