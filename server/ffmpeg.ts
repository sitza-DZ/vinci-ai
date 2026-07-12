import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { DB } from "./db";
import { Project, ProjectStatus, ProcessingJob, RenderDiagnostics, TransitionType } from "../src/types";

const execPromise = promisify(exec);

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
    const addLog = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      job.logOutput.push(`[${timestamp}] ${msg}`);
      DB.saveJob(job);
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

    const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 5), 0);

    // --- STEP 1: LOAD METADATA & PREPARE ---
    job.step = "scenes";
    job.progress = 10;
    addLog(`[STEP 1/8] Loading storyboard scenes for composition...`);
    addLog(`  -> Total scenes generated: ${scenes.length}`);
    addLog(`  -> Resolution standard: 1080x1920 (9:16 portrait mobile aspect-ratio)`);
    addLog(`  -> Base framerate: 30 FPS`);
    addLog(`  -> Codec: libx264 Baseline, AAC audio stereo, 48kHz sample-rate`);

    // --- STEP 2: DOWNLOAD FOOTAGE FOR EVERY SCENE ---
    job.step = "downloading";
    job.progress = 25;
    addLog(`[STEP 2/8] Downloading vertical stock footage for all scenes...`);
    
    let downloadedCount = 0;
    const sceneClips: string[] = [];

    // Fallback URL if download fails completely
    const DEFAULT_VIDEO_URL = "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4";

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const videoUrl = scene.selectedVideoUrl || DEFAULT_VIDEO_URL;
      const urlHash = crypto.createHash("md5").update(videoUrl).digest("hex").slice(0, 12);
      const cachePath = path.join(downloadsDir, `clip_${urlHash}.mp4`);

      addLog(`  -> Scene ${i + 1}/${scenes.length}: Sourcing footage from ${scene.selectedVideoProvider || "pexels"}...`);
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
          try { fs.unlinkSync(cachePath); } catch {}
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
            try { fs.unlinkSync(fallbackCachePath); } catch {}
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
        
        // Command to generate beautiful ambient shifting colors in Full HD 1080x1920
        const genCmd = `ffmpeg -y -f lavfi -i "color=c=${themeColor}:s=1080x1920:d=${duration}" -f lavfi -i "testsrc2=size=1080x1920:rate=30:d=${duration}" -filter_complex "[1:v]format=yuv420p,gblur=sigma=35,blend=all_mode='overlay'[v]" -map "[v]" -r 30 -c:v libx264 -preset ultrafast -crf 28 "${generatedPath}"`;
        
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

      sceneClips.push(clipPath);
      downloadedCount++;
      
      job.progress = 25 + Math.floor((i + 1) / scenes.length * 20);
      DB.saveJob(job);
    }
    addLog(`  -> Total clips sourced/cached: ${downloadedCount}/${scenes.length}`);

    // --- STEP 3: SUBTITLE GENERATION ---
    job.step = "rendering";
    job.progress = 45;
    addLog(`[STEP 3/8] Generating Substation Alpha (.ass) subtitles for scene overlays...`);
    
    const assPaths: string[] = [];
    let subtitleStatus: "idle" | "generating" | "generated" | "error" | "disabled" = "disabled";

    if (project.settings.subtitleEnabled) {
      subtitleStatus = "generating";
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const assPath = path.join(subtitlesDir, `subtitle_scene_${i + 1}.ass`);

        // Subtitle Style Variables mapping project settings (Scaled to 1080x1920 Full HD Canvas)
        // Detect system font available on the device for proper ASS rendering
        let fontName = "Sans";
        const commonFonts = [
          "/system/fonts/NotoNaskhArabicUI-Regular.ttf",
          "/system/fonts/NotoNaskhArabic-Regular.ttf",
          "/system/fonts/DroidSans.ttf",
          "/system/fonts/NotoSansArmenian-VF.ttf",
          "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans.ttf",
          "/data/data/com.termux/files/usr/share/fonts/TTF/NotoSans-Regular.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        ];
        for (const fp of commonFonts) {
          try {
            if (fs.existsSync(fp)) {
              fontName = path.basename(fp, path.extname(fp)).replace(/-Regular$/i, "").replace(/-UI$/i, "").replace(/-/g, " ");
              break;
            }
          } catch {}
        }
        let fontSize = 56; // 28 * 2
        let primaryColor = "&H00FFFFFF"; // ABGR format (White)
        let outlineColor = "&H00000000"; // Black outline
        let outlineWidth = 4; // 2 * 2
        let bold = -1;
        let italic = 0;
        let alignment = 2; // Bottom center
        let borderStyle = 1; // Outline + shadow

        const styleType = project.settings.subtitleStyle;
        if (styleType === "tiktok") {
          primaryColor = "&H0000FFFF"; // Yellow text
          fontSize = 64; // 32 * 2
          outlineWidth = 6; // 3 * 2
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
            } catch {}
          }
        }

        // Support custom Font Scale override from project settings
        if (project.settings.fontSize !== undefined) {
          fontSize = project.settings.fontSize * 2;
        }

        const letterSpacing = project.settings.letterSpacing !== undefined ? project.settings.letterSpacing : 2;
        const wordSpacing = project.settings.wordSpacing !== undefined ? project.settings.wordSpacing : 2;
        const scaledLetterSpacing = letterSpacing;
        const scaledWordSpacing = wordSpacing;

        // Spacing applied via Style's Spacing field - use clean text for reliable ASS rendering
        const dialogueText = scene.text;

        const endTimeStr = this.formatAssTime(scene.duration || 5);
        const assContent = `[Script Info]
Title: Scene Subtitle
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},&H0000FFFF,${outlineColor},&H00000000,${bold},${italic},0,0,100,100,${scaledLetterSpacing},0,${borderStyle},${outlineWidth},0,${alignment},20,20,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${endTimeStr},Default,,0,0,0,,${dialogueText}
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

      // Video filters: Scale to portrait 1080x1920 (using Lanczos and sharpening), trim, apply fades, and burn ASS subtitles
      let filterString = `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,unsharp=5:5:1.0:5:5:0.0,setsar=1,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`;

      // Hook overlay: For first scene, add big bold attention-grabbing hook text in center for first 2s
      if (i === 0 && scene.hook && scene.hook.trim()) {
        const hookEnable = `between(t,0.3,${Math.min(2.5, duration)})`;
        // Use textfile to avoid all shell quoting issues (spaces, colons, quotes in hook text)
        const textFilePath = path.join(projectDir, "processed", `hook_text_scene_${i}.txt`);
        try {
          fs.writeFileSync(textFilePath, scene.hook, "utf-8");
        } catch { }

        // Try common system font paths for drawtext
        const fontPaths = [
          "/system/fonts/NotoSans-Bold.ttf",
          "/system/fonts/Roboto-Bold.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"
        ];
        let fontFile = "";
        for (const fp of fontPaths) {
          try {
            if (fs.existsSync(fp)) { fontFile = fp; break; }
          } catch { }
        }
        if (fontFile) {
          filterString += `,drawtext=textfile=${textFilePath}:fontfile=${fontFile}:fontsize=56:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=(h-text_h)/2-40:enable='${hookEnable}'`;
        } else {
          // No font file found - still try drawtext without explicit font
          filterString += `,drawtext=textfile=${textFilePath}:fontsize=52:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=(h-text_h)/2-40:enable='${hookEnable}'`;
        }
      }

      if (project.settings.subtitleEnabled) {
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
          } catch {}
        }
        if (fontsDir) {
          filterString += `,ass='${escapedAssPath}':fontsdir='${fontsDir}'`;
        } else {
          filterString += `,ass='${escapedAssPath}'`;
        }
      }

      // Execute intermediate clip generation with requested high/ultra profile settings
      const cmd = `ffmpeg -y -ss 0 -t ${duration} -i "${sourceVideo}" -f lavfi -t ${duration} -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex "[0:v]${filterString}[v]" -map "[v]" -map "1:a" -r 30 -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac -shortest "${outputClipPath}"`;
      
      lastCommand = cmd;
      
      addLog(`     Executing: ${cmd}`);
      await execPromise(cmd);
      processedClips.push(outputClipPath);
      
      job.progress = 55 + Math.floor((i + 1) / scenes.length * 20);
      DB.saveJob(job);
    }
    addLog(`  -> Total intermediate scene files rendered: ${processedClips.length}`);

    // --- STEP 5: BUILD FFMPEG CONCAT CONFIG FILE ---
    job.step = "rendering";
    job.progress = 80;
    addLog(`[STEP 5/8] Generating FFmpeg concat configuration text file...`);
    
    const concatPath = path.join(processedDir, "concat.txt");
    const concatContent = processedClips.map(clipPath => `file '${path.resolve(clipPath)}'`).join("\n");
    await fs.promises.writeFile(concatPath, concatContent, "utf-8");

    addLog(`----- BEGIN FFMPEG CONCAT FILE CONTENTS -----`);
    addLog(concatContent);
    addLog(`----- END FFMPEG CONCAT FILE CONTENTS -----`);

    // --- STEP 6: MERGE ALL SCENE CLIPS IN ORDER (WITH TRANSITIONS) ---
    job.progress = 85;
    addLog(`[STEP 6/8] Merging all processed clips...`);
    const finalRawPath = path.join(rendersDir, `${project.id}_final.mp4`);
    const transitionType = project.settings.transitionType || TransitionType.NONE;
    let mergeCmd: string;

    if (transitionType === TransitionType.NONE || processedClips.length <= 1) {
      // Simple concat (no transition) - fast copy, no re-encode
      addLog(`     Mode: direct concat (no transition)`);
      mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${finalRawPath}"`;
      addLog(`     Executing: ${mergeCmd}`);
      await execPromise(mergeCmd);
    } else {
      // Try xfade transitions between scenes, fallback to concat if failed
      addLog(`     Mode: xfade transitions (${transitionType === "random" ? "random per clip" : transitionType})`);
      // TransitionType enum values now map 1:1 to ffmpeg xfade names
      const xfadeType = transitionType === "none" ? "fade" : transitionType;
      const transDuration = project.settings.transitionDuration ?? 0.3;

      // All xfade transitions (excluding none/random) for random mode
      const allTransitions = ["fade", "dissolve", "slideleft", "slideright", "slideup", "slidedown", "zoomin", "radial", "pixelize", "circleopen", "circleclose", "wipelr", "wiperl", "wipetb", "wipebt"];

      try {
        // Get durations for offset calculation
        const durations: number[] = [];
        for (const clip of processedClips) {
          try {
            const { stdout } = await execPromise(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${clip}"`
            );
            durations.push(parseFloat(stdout.trim()) || 5);
          } catch { durations.push(5); }
        }

        // Build xfade filter chain: [0:v][1:v]xfade=... [v01];[v01][2:v]xfade=... [v02];...
        const filterParts: string[] = [];
        let cumulativeDuration = durations[0];

        for (let i = 1; i < processedClips.length; i++) {
          const offset = Math.max(0, cumulativeDuration - transDuration);
          const prevLabel = i === 1 ? "0" : `v${String(i - 1).padStart(2, '0')}`;
          const currLabel = `v${String(i).padStart(2, '0')}`;
          const trans = transitionType === "random"
            ? allTransitions[Math.floor(Math.random() * allTransitions.length)]
            : xfadeType;
          filterParts.push(`[${prevLabel}:v][${i}:v]xfade=transition=${trans}:duration=${transDuration}:offset=${offset}[${currLabel}]`);
          cumulativeDuration += durations[i] - transDuration;
        }

        const filterComplex = filterParts.join(";");
        const lastLabel = `v${String(processedClips.length - 1).padStart(2, '0')}`;
        const inputFiles = processedClips.map(p => `-i "${p}"`).join(" ");

        // xfade only handles video - use anullsrc for audio since we re-encode anyway
        mergeCmd = `ffmpeg -y ${inputFiles} -f lavfi -t ${cumulativeDuration} -i anullsrc=r=44100:cl=stereo -filter_complex "${filterComplex}" -map "[${lastLabel}]" -map "${processedClips.length}:a" -r 30 -c:v libx264 -preset ${preset} -crf ${crf} -b:v ${bitrate} -maxrate ${maxrate} -bufsize ${bufsize} -pix_fmt yuv420p -c:a aac -shortest "${finalRawPath}"`;

        addLog(`     Executing xfade merge...`);
        await execPromise(mergeCmd);
        addLog(`     ✅ xfade merge succeeded`);
      } catch (xfadeErr: any) {
        // Fallback: concat without transitions
        addLog(`     ⚠️ xfade failed (${xfadeErr.message?.slice(0, 80) || "error"}). Falling back to concat...`);
        mergeCmd = `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${finalRawPath}"`;
        addLog(`     Executing fallback concat: ${mergeCmd}`);
        await execPromise(mergeCmd);
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
        const sfxCmd = `ffmpeg -y ${sfxInputs} -filter_complex "${sfxFilterComplex}" -map "[sfx_out]" -c:a aac -b:a 128k "${sfxMixPath}"`;
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
    const voiceoverTrack = audioSettings?.voiceoverTrack;
    const bgmTrack = audioSettings?.bgmTrack;

    if (voiceoverTrack || bgmTrack) {
      addLog(`[STEP 7/9] Mixing audio tracks...`);
      const voicePath = voiceoverTrack?.filePath;
      const bgmPath = bgmTrack?.filePath;
      const voiceVol = (audioSettings?.voiceVolume ?? 100) / 100;
      const musicVol = (audioSettings?.musicVolume ?? 15) / 100;
      const bgmMode = audioSettings?.bgmMode || "none";

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
          audioInputs += `-i "${bgmPath}" `;
          let bgmFilter = `volume=${musicVol}`;
          if (bgmMode === "fade_in" || bgmMode === "fade_both") bgmFilter += ",afade=t=in:st=0:d=2";
          if (bgmMode === "fade_out" || bgmMode === "fade_both") {
            const totalDur = voiceoverTrack?.duration || 30;
            bgmFilter += `,afade=t=out:st=${Math.max(0, totalDur - 2)}:d=2`;
          }
          if (bgmMode === "loop") bgmFilter = `-stream_loop -1 -i "${bgmPath}" `;
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
          // Mix multiple audio streams
          const inputs = mapLabels.join("");
          const mixInputs = mapLabels.map((l, i) => `[${l}]`).join("");
          const mixDuration = Math.min(
            ...(voiceoverTrack ? [voiceoverTrack.duration] : []),
            ...(bgmTrack && bgmMode !== "loop" ? [bgmTrack.duration] : []),
            Infinity
          );
          filterParts.push(`${mixInputs}amix=inputs=${mapLabels.length}:duration=${mixDuration === Infinity ? "longest" : "first"}:dropout_transition=2[final_audio]`);

          const mixedAudioPath = path.join(rendersDir, `${project.id}_mixed_audio.aac`);
          const filterComplex = filterParts.join(";");
          const mixCmd = `ffmpeg -y ${audioInputs}-filter_complex "${filterComplex}" -map "[final_audio]" -c:a aac -b:a 192k "${mixedAudioPath}"`;
          addLog(`   Mixing audio...`);
          await execPromise(mixCmd);

          // Replace video audio with mixed audio
          const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
          const replaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${mixedAudioPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest "${mixedVideoPath}"`;
          addLog(`   Replacing video audio...`);
          await execPromise(replaceCmd);

          // Replace original with mixed version
          fs.renameSync(mixedVideoPath, finalRawPath);
          try { fs.unlinkSync(mixedAudioPath); } catch {}
          addLog(`   ✅ Audio mix complete (voiceover${bgmPath ? " + bgm" : ""})`);
        } else if (mapLabels.length === 1 && voicePath && fs.existsSync(voicePath)) {
          // Just voiceover, no BGM - replace video audio directly
          const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
          const replaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${voicePath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -af "volume=${voiceVol}" "${mixedVideoPath}"`;
          addLog(`   Replacing video audio with voiceover...`);
          await execPromise(replaceCmd);
          fs.renameSync(mixedVideoPath, finalRawPath);
          addLog(`   ✅ Voiceover applied`);
        }
      } catch (mixErr: any) {
        addLog(`   ⚠️ Audio mixing skipped: ${mixErr.message?.slice(0, 80)}`);
      }
    } else if (sfxMixPath && fs.existsSync(sfxMixPath)) {
      addLog(`[STEP 7/9] Mixing SFX with original clip audio...`);
      try {
        const mixedVideoPath = path.join(rendersDir, `${project.id}_mixed.mp4`);
        const sfxReplaceCmd = `ffmpeg -y -i "${finalRawPath}" -i "${sfxMixPath}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest -af "volume=0.5" "${mixedVideoPath}"`;
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

    // Auto-generate project thumbnail from rendered video
    try {
      const thumbnailsDir = path.join(process.cwd(), "storage", "projects", project.id, "thumbnails");
      fs.mkdirSync(thumbnailsDir, { recursive: true });
      const thumbnailPath = path.join(thumbnailsDir, `${project.id}_thumbnail.jpg`);
      await execPromise(`ffmpeg -y -ss 00:00:01 -i "${finalRawPath}" -vframes 1 -s 640:360 -q:v 3 "${thumbnailPath}"`);
      if (fs.existsSync(thumbnailPath)) {
        project.thumbnailUrl = `/api/projects/${project.id}/thumbnail.jpg`;
        addLog(`   ✅ Thumbnail generated: ${thumbnailPath}`);
      }
    } catch (thumbErr: any) {
      addLog(`   ⚠️ Thumbnail generation skipped: ${thumbErr.message?.slice(0, 60)}`);
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
      renderResolution: "1080x1920",
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
    addLog(`Video Quality: ${quality.toUpperCase()} Portrait 1080x1920 @ 30 FPS`);
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

  private static isFileValid(filePath: string): boolean {
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
}
