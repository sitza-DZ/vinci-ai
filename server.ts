// All scheduling must run on Indian Standard Time regardless of the device's
// local timezone (this Termux box reports CET). Force IST for the whole process
// BEFORE any Date math happens. The npm start script also exports TZ as a
// belt-and-suspenders guarantee.
process.env.TZ = "Asia/Kolkata";

import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { DB } from "./server/db";
import { encrypt, decrypt } from "./server/crypto";
import { GeminiService } from "./server/gemini";
import { TrendsService } from "./server/trends";
import { AIProviderManager } from "./server/aiManager";
import { ProviderManagerService } from "./server/providers";
import { FFmpegService } from "./server/ffmpeg";
import { getEdgeVoices, DEFAULT_PREVIEW_TEXT, generateTtsClip, sceneRatePitch } from "./server/sceneVoice";
import { testVoiceCloneServer, generateClonedVoice, detectXttsLanguage, getVoiceCloneUrl, isVoiceCloneEnabled } from "./server/voiceClone";
import { hasValidCookies, saveCookies, uploadVideo, verifyCookies, loadYoutubeToken, saveYoutubeToken, getYoutubeAuthUrl, getYoutubeCallbackUrl, getYoutubeOAuthClient, refreshYoutubeToken } from "./server/yt-cookies-upload";
import { listAccounts, getAccount, getDefaultAccount, upsertAccountFromTokens, removeAccount, setDefaultAccount, refreshAccountToken, ensureMigrated } from "./server/yt-accounts";
import { renderQueue } from "./server/renderQueue";
import { getPythonBin, getCffiPythonBin } from "./server/python";
import * as Autopilot from "./server/autopilot";
import { Project, ProjectStatus, SubtitleStyleType, UserSettings, ProcessingJob, DeleteLog, AISystemSettings } from "./src/types";
import { execFileSync, execSync } from "child_process";
import TikAPI from "@tobyg74/tiktok-api-dl";
// X-Bogus signer used to sign TikTok web search requests (anti-bot signature).
// Loaded via createRequire because it's an untyped CJS helper inside the package.
// Note: import.meta.url is undefined in the esbuild CJS bundle, so anchor on cwd
// (the server always runs from the project root, same convention as storage paths).
import { createRequire } from "module";
const _ttRequire = createRequire(path.join(process.cwd(), "package.json"));
const tiktokXBogus: (url: string, userAgent: string) => string = _ttRequire("@tobyg74/tiktok-api-dl/helper/xbogus");
import "dotenv/config";

// YouTube OAuth2 setup
import { google } from "googleapis";

const FALLBACK_CLIP = {
  url: "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4",
  id: "space_stars_1",
  provider: "pexels",
  duration: 15,
  previewUrl: "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500"
};

function applySmartSceneDistribution(project: Project, scenesList: any[]) {
  if (!project.settings.smartSceneDistribution || scenesList.length < 6) return;

  const firstFastCount = 4;
  const fastDuration = 3;
  const slowDuration = scenesList.length <= 14 ? 5 : 6;
  for (let i = 0; i < scenesList.length; i++) {
    scenesList[i].duration = i < firstFastCount ? fastDuration : slowDuration;
  }
}

/**
 * v16: Detect the dominant non-Latin script in narration text and return a
 * matching edge-tts voice ShortName. Returns "" for Latin-only text (caller
 * falls back to the saved/default voice). Prevents a Hindi/Devanagari script
 * from being narrated by an English voice.
 */
function detectEdgeVoiceForScript(text: string): string {
  if (!text) return "";
  const map: { test: RegExp; voice: string }[] = [
    { test: /[\u0900-\u097F]/, voice: "hi-IN-SwaraNeural" },   // Devanagari (Hindi)
    { test: /[\u0980-\u09FF]/, voice: "bn-IN-TanishaaNeural" },// Bengali
    { test: /[\u0A00-\u0A7F]/, voice: "pa-IN-OjasNeural" },    // Gurmukhi (Punjabi)
    { test: /[\u0A80-\u0AFF]/, voice: "gu-IN-DhwaniNeural" },  // Gujarati
    { test: /[\u0B80-\u0BFF]/, voice: "ta-IN-PallaviNeural" },  // Tamil
    { test: /[\u0C00-\u0C7F]/, voice: "te-IN-ShrutiNeural" },   // Telugu
    { test: /[\u0C80-\u0CFF]/, voice: "kn-IN-SapnaNeural" },    // Kannada
    { test: /[\u0D00-\u0D7F]/, voice: "ml-IN-SobhanaNeural" },  // Malayalam
    { test: /[\u0600-\u06FF\u0750-\u077F]/, voice: "ur-PK-UzmaNeural" }, // Arabic/Urdu
    { test: /[\u0E00-\u0E7F]/, voice: "th-TH-PremwadeeNeural" },// Thai
    { test: /[\u1000-\u109F]/, voice: "my-MM-NilarNeural" },    // Myanmar
    { test: /[\u1780-\u17FF]/, voice: "km-KH-SreymomNeural" },  // Khmer
  ];
  for (const { test, voice } of map) {
    if (test.test(text)) return voice;
  }
  return "";
}

// --- v13 helper: custom fonts storage ---
const FONTS_DIR = path.join(process.cwd(), "storage", "fonts");

// --- v13 helper: watermark/logo storage ---
const WATERMARK_DIR = path.join(process.cwd(), "storage", "watermarks");

// --- v13 helper: auto-emoji hooks ---
const HOOK_EMOJIS = ["🔥", "💥", "😱", "🤯", "👀", "🚨", "✨", "💯", "😳", "🎯", "⚡", "🥶", "😲", "🤫", "🗿", "🎬"];
function withAutoEmoji(hook: string, enabled?: boolean): string {
  if (!enabled || !hook) return hook;
  // Skip if the hook already ends with an emoji
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(hook.trim())) return hook;
  const emoji = HOOK_EMOJIS[Math.floor(Math.random() * HOOK_EMOJIS.length)];
  return `${hook.trim()} ${emoji}`;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // YouTube OAuth2 client (initialized lazily)
  const getOAuthClient = (req?: any) => getYoutubeOAuthClient(req);

  // Body parsers
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // === v16: PIN Authentication ===
  const SESSION_COOKIE = "vinci_session";
  const SESSION_DAYS = 30;

  function hashPin(pin: string): string {
    return crypto.createHash("sha256").update(pin).digest("hex");
  }

  function parseCookies(req: any): Record<string, string> {
    const header = req.headers.cookie || "";
    const out: Record<string, string> = {};
    header.split(";").forEach((pair: string) => {
      const idx = pair.indexOf("=");
      if (idx > 0) out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
  }

  function getSessionToken(req: any): string | null {
    const cookies = parseCookies(req);
    if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
    return null;
  }

  // Auth endpoints (no protection)
  app.get("/api/auth/status", (req, res) => {
    const auth = DB.getAuth();
    const pinSet = !!(auth && auth.pinHash);
    const token = getSessionToken(req);
    const authenticated = pinSet ? (token ? DB.isValidSession(token) : false) : true;
    res.json({ pinSet, authenticated });
  });

  app.post("/api/auth/login", (req, res) => {
    const { pin } = req.body || {};
    const auth = DB.getAuth();
    if (!auth || !auth.pinHash) {
      return res.status(400).json({ success: false, error: "No PIN configured" });
    }
    if (!pin || hashPin(String(pin)) !== auth.pinHash) {
      return res.status(401).json({ success: false, error: "Incorrect PIN" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    DB.addSession(token, expiresAt);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
    res.json({ success: true });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getSessionToken(req);
    if (token) DB.removeSession(token);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ success: true });
  });

  app.post("/api/auth/change-pin", (req, res) => {
    const token = getSessionToken(req);
    const auth = DB.getAuth();
    const pinSet = !!(auth && auth.pinHash);
    // Must be authenticated (or no PIN set yet = first-time setup)
    if (pinSet && (!token || !DB.isValidSession(token))) {
      return res.status(401).json({ success: false, error: "Not authenticated" });
    }
    const { newPin } = req.body || {};
    if (!newPin || String(newPin).length < 4) {
      return res.status(400).json({ success: false, error: "PIN must be at least 4 characters" });
    }
    DB.setPinHash(hashPin(String(newPin)));
    res.json({ success: true });
  });

  // Protect all /api/* routes except auth endpoints
  app.use("/api", (req, res, next) => {
    // Skip auth endpoints themselves
    if (req.path.startsWith("/auth/")) return next();
    const auth = DB.getAuth();
    if (!auth || !auth.pinHash) return next(); // No PIN set = open access
    const token = getSessionToken(req);
    if (token && DB.isValidSession(token)) return next();
    res.status(401).json({ error: "Authentication required" });
  });

  // --- API ENDPOINTS ---

  // Health check
  app.get("/api/health", (req, res) => {
    let ffmpegVersion = "not found";
    try {
      const line = execSync("ffmpeg -version 2>&1 | head -n1").toString().trim();
      ffmpegVersion = line.split(" ").filter(Boolean)[2] || line;
    } catch (e) {}
    res.json({ status: "healthy", timestamp: new Date().toISOString(), nodeVersion: process.version, ffmpegVersion });
  });

  // Get all projects
  app.get("/api/projects", (req, res) => {
    try {
      const projects = DB.getProjects();
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get project by ID (includes scenes and job)
  app.get("/api/projects/:id", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      const scenes = DB.getScenes(id);
      const job = DB.getJobByProjectId(id);
      res.json({ project, scenes, job });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Stream/Redirect final compiled video for a project
  app.get("/api/projects/:id/final.mp4", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        res.setHeader("Content-Type", "application/json");
        return res.status(404).json({ error: "Project not found" });
      }

      // Check if real compiled video is ready in isolated projects storage
      const renderedPath = path.join(process.cwd(), "storage", "projects", id, "renders", `${id}_final.mp4`);
      if (fs.existsSync(renderedPath)) {
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="viral_short_${id}.mp4"`);
        return res.sendFile(renderedPath);
      }

      // If file is missing, show JSON error instead of returning HTML or redirecting
      res.setHeader("Content-Type", "application/json");
      return res.status(404).json({
        error: "Rendered video file not found on the server. Please complete the compilation first.",
        filePath: renderedPath,
        exists: false
      });
    } catch (e: any) {
      res.setHeader("Content-Type", "application/json");
      res.status(500).json({ error: e.message });
    }
  });

  // Get project render diagnostics
  app.get("/api/projects/:id/diagnostics", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const diag = FFmpegService.getProjectDiagnostics(id);
      res.json(diag);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear project cache (temporary files, render cache, scene cache, search cache, download cache)
  app.post("/api/projects/:id/clear-cache", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      FFmpegService.clearProjectCache(id);
      const diag = FFmpegService.getProjectDiagnostics(id);
      res.json({ success: true, message: "Project workspace cache and storyboard segments fully cleared.", diagnostics: diag });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clear all caches across all projects
  app.post("/api/clear-all-cache", (req, res) => {
    try {
      const projects = DB.getProjects();
      let clearedCount = 0;
      for (const project of projects) {
        FFmpegService.clearProjectCache(project.id);
        clearedCount++;
      }
      res.json({
        success: true,
        message: `Workspace caches for all ${clearedCount} projects have been successfully purged and reset.`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get active user profile
  app.get("/api/user", (req, res) => {
    try {
      let user = DB.getUserById("u1");
      if (!user) {
        user = DB.saveUser({
          id: "u1",
          name: "SaaS Creator",
          email: "creator@example.com",
          createdAt: new Date().toISOString()
        });
      }
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update active user profile
  app.post("/api/user", (req, res) => {
    try {
      const { name, email, avatarUrl, role } = req.body;
      let user = DB.getUserById("u1");
      if (!user) {
        user = {
          id: "u1",
          name: name || "SaaS Creator",
          email: email || "creator@example.com",
          avatarUrl: avatarUrl || "",
          role: role || "Administrator",
          createdAt: new Date().toISOString()
        };
      } else {
        user.name = name !== undefined ? name : user.name;
        user.email = email !== undefined ? email : user.email;
        user.avatarUrl = avatarUrl !== undefined ? avatarUrl : user.avatarUrl;
        user.role = role !== undefined ? role : user.role;
      }
      DB.saveUser(user);
      res.json({ success: true, user });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Create a new draft project
  app.post("/api/projects", (req, res) => {
    try {
      const { title, topic, script, settings } = req.body;
      const defaultSettings = DB.getDefaultSettings();
      
      const projects = DB.getProjects();
      let nextNum = 1;
      for (const p of projects) {
        if (p.id.startsWith("project_")) {
          const numStr = p.id.split("_")[1];
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num >= nextNum) {
            nextNum = num + 1;
          }
        }
      }
      const paddedNum = String(nextNum).padStart(3, "0");
      const projectId = `project_${paddedNum}`;

      const newProject: Project = {
        id: projectId,
        userId: "u1", // Default user
        title: title || topic || `Project ${paddedNum}`,
        topic: topic || "",
        script: script || "",
        status: ProjectStatus.DRAFT,
        settings: { ...defaultSettings, ...settings },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      DB.saveProject(newProject);
      res.status(201).json(newProject);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Clone an existing project (project + scenes) into a fresh DRAFT project
  app.post("/api/projects/:id/clone", (req, res) => {
    try {
      const { id } = req.params;
      const source = DB.getProjectById(id);
      if (!source) return res.status(404).json({ error: "Project not found" });

      const projects = DB.getProjects();
      let nextNum = 1;
      for (const p of projects) {
        if (p.id.startsWith("project_")) {
          const numStr = p.id.split("_")[1];
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num >= nextNum) {
            nextNum = num + 1;
          }
        }
      }
      const paddedNum = String(nextNum).padStart(3, "0");
      const newId = `project_${paddedNum}`;

      const clonedProject: Project = {
        ...source,
        id: newId,
        title: `${source.title} (Copy)`,
        status: ProjectStatus.DRAFT,
        settings: { ...source.settings },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        renderedVideoUrl: undefined,
        thumbnailUrl: undefined,
        duration: undefined,
        fileSize: undefined,
        scheduledAt: undefined,
        uploadScheduleStatus: undefined,
        seoTags: undefined
      };

      const sourceScenes = DB.getScenes(id);
      const clonedScenes: any[] = sourceScenes.map((s, i) => ({
        ...s,
        id: `scene_${newId}_${i}`,
        projectId: newId,
        sceneIndex: i
      }));

      DB.saveProject(clonedProject);
      DB.saveScenes(newId, clonedScenes);

      res.status(201).json({ project: clonedProject, scenes: clonedScenes, message: "Project cloned successfully" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Helper to count files recursively
  const countFilesRecursively = (dirPath: string): number => {
    let count = 0;
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          const fullPath = path.join(dirPath, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            count += countFilesRecursively(fullPath);
          } else if (stat.isFile()) {
            count++;
          }
        }
      } catch (e) {
        console.error(`Error counting files in ${dirPath}:`, e);
      }
    }
    return count;
  };

  // Delete project and all associated data and files
  app.delete("/api/projects/:id", (req, res) => {
    const { id } = req.params;
    try {
      // 1. Check if project exists to get basic information before deleting
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const projectTitle = project.title;
      const userId = project.userId || "u1";

      // 2. Count files in the workspace directory before deleting them
      const projectDir = path.join(process.cwd(), "storage", "projects", id);
      const fileCount = countFilesRecursively(projectDir);

      // 3. Delete database records (Video, Project, Scenes, Subtitles/Jobs/Renders)
      const dbResult = DB.deleteProject(id);

      // 4. Delete physical project files (including downloads, processed, subtitles, renders, thumbnails)
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }

      // 5. Save persistent delete log for diagnostics and logging requirements
      const deleteLog: DeleteLog = {
        id: `del_${Date.now()}_${id}`,
        userId: userId,
        projectId: id,
        projectTitle: projectTitle,
        deletedFilesCount: fileCount,
        deletedDbRecordsCount: dbResult.deletedDbRecordsCount,
        status: "success",
        timestamp: new Date().toISOString()
      };
      DB.saveDeleteLog(deleteLog);

      // 6. Output structured logger information to the backend console
      console.log(`[DELETION LOG] USER ID: ${deleteLog.userId} | PROJECT ID: ${deleteLog.projectId} | DELETED FILES COUNT: ${deleteLog.deletedFilesCount} | DELETED DATABASE RECORDS COUNT: ${deleteLog.deletedDbRecordsCount}`);

      res.json({
        success: true,
        message: "Project and all associated media files, database records, and render caches fully deleted.",
        log: deleteLog
      });
    } catch (e: any) {
      console.error(`[DELETION ERROR] Project: ${id} failed to delete:`, e);
      // Log failure state persistently
      try {
        const failedLog: DeleteLog = {
          id: `del_${Date.now()}_${id}`,
          userId: "u1",
          projectId: id,
          projectTitle: "Unknown Project",
          deletedFilesCount: 0,
          deletedDbRecordsCount: 0,
          status: "failed",
          errorMessage: e.message || "Unknown error during deletion",
          timestamp: new Date().toISOString()
        };
        DB.saveDeleteLog(failedLog);
      } catch (logErr) {
        console.error("Failed to save failed delete log:", logErr);
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Get all deletion logs for diagnostics tracking
  app.get("/api/deletions", (req, res) => {
    try {
      res.json(DB.getDeleteLogs());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Step 1 AI: Generate Script and Scene breakdown from Topic
  app.post("/api/projects/:id/generate-script", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Clear project cache (temporary files, render cache, scene cache, search cache, download cache)
      FFmpegService.clearProjectCache(id);

      const { topic, duration } = req.body;
      if (!topic) {
        return res.status(400).json({ error: "Topic is required to generate script" });
      }

      // Update project topic
      project.topic = topic;
      project.status = ProjectStatus.PROCESSING;
      DB.saveProject(project);

      // Create a pending job
      const job: ProcessingJob = {
        id: `job_${project.id}`,
        projectId: project.id,
        step: "script",
        progress: 10,
        logOutput: [`[${new Date().toLocaleTimeString()}] Received script generation request for topic: "${topic}"`],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      DB.saveJob(job);

      // If smart scene distribution is enabled, use higher duration to generate ~14 scenes
      let genDuration = duration || 30;
      if (project.settings.smartSceneDistribution && genDuration >= 60) {
        genDuration = 70; // ~14 scenes for a 60s video
      }
      // Generate script and scenes using AI Provider Manager with Failover and Routing
      const result = await AIProviderManager.generateScriptAndScenes(topic, genDuration);
      
      // Update project details
      project.title = result.title;
      project.script = result.script;
      project.status = ProjectStatus.DRAFT;
      DB.saveProject(project);

      // Search matching clips for each scene
      const scenesList = [];
      const usedClipIds = new Set<string>();
      job.step = "searching";
      job.progress = 50;
      job.logOutput.push(`[${new Date().toLocaleTimeString()}] Script generated. Starting intelligent footage provider matching...`);
      DB.saveJob(job);

      for (let i = 0; i < result.scenes.length; i++) {
        const sceneData = result.scenes[i];
        job.logOutput.push(`[${new Date().toLocaleTimeString()}] Querying providers for Scene ${i + 1}: ${sceneData.keywords.join(", ")}`);
        DB.saveJob(job);

        const foundClips = await ProviderManagerService.searchFootage(
          sceneData.visualDescription,
          sceneData.keywords,
          project.settings.preferredSources,
          6,
          3,
          true,
          usedClipIds
        );

        let bestClip = foundClips[0]; // Best matched clip

        scenesList.push({
          id: `scene_${project.id}_${i}`,
          projectId: project.id,
          sceneIndex: i,
          text: sceneData.text,
          hook: withAutoEmoji(sceneData.hook || sceneData.text.split(" ").slice(0, 3).join(" ") + "...", project.settings.autoEmoji),
          visualDescription: sceneData.visualDescription,
          keywords: sceneData.keywords,
          selectedVideoUrl: bestClip?.url || FALLBACK_CLIP.url,
          selectedVideoId: bestClip?.id || FALLBACK_CLIP.id,
          selectedVideoProvider: bestClip?.provider || FALLBACK_CLIP.provider,
          selectedVideoDuration: bestClip?.duration || FALLBACK_CLIP.duration,
          selectedVideoPreviewUrl: bestClip?.previewUrl || FALLBACK_CLIP.previewUrl,
          duration: sceneData.duration || 5
        });

        // Track used clip to prevent reuse across scenes
        if (bestClip?.id) usedClipIds.add(bestClip.id);
      }

      applySmartSceneDistribution(project, scenesList);

      DB.saveScenes(project.id, scenesList);

      // Mark job completed
      job.step = "completed";
      job.progress = 100;
      job.logOutput.push(`[${new Date().toLocaleTimeString()}] AI Storyboarding and clip sourcing fully completed!`);
      DB.saveJob(job);

      res.json({ project, scenes: scenesList, job });
    } catch (e: any) {
      console.error(e);
      // Mark project as failed
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (project) {
        project.status = ProjectStatus.FAILED;
        DB.saveProject(project);
      }
      const job = DB.getJobByProjectId(id);
      if (job) {
        job.step = "failed";
        job.progress = 100;
        job.errorMessage = e.message;
        job.logOutput.push(`[ERROR] ${e.message}`);
        DB.saveJob(job);
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Step 2 AI: Break custom script into scenes and search footage
  app.post("/api/projects/:id/breakdown-script", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Clear project cache (temporary files, render cache, scene cache, search cache, download cache)
      FFmpegService.clearProjectCache(id);

      const { script, duration } = req.body;
      if (!script) {
        return res.status(400).json({ error: "Script is required" });
      }

      project.script = script;
      project.status = ProjectStatus.PROCESSING;
      DB.saveProject(project);

      // Create a job
      const job: ProcessingJob = {
        id: `job_${project.id}`,
        projectId: project.id,
        step: "scenes",
        progress: 20,
        logOutput: [`[${new Date().toLocaleTimeString()}] Parsing custom script and breaking into visual scenes...`],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      DB.saveJob(job);

      let breakDuration = duration || 30;
      if (project.settings.smartSceneDistribution && breakDuration >= 60) {
        breakDuration = 70;
      }
      const result = await AIProviderManager.breakScriptIntoScenes(script, breakDuration);

      project.title = result.title;
      project.status = ProjectStatus.DRAFT;
      DB.saveProject(project);

      const scenesList = [];
      const usedClipIds = new Set<string>();
      job.step = "searching";
      job.progress = 60;
      job.logOutput.push(`[${new Date().toLocaleTimeString()}] Breakdown complete. Title generated: "${result.title}". Finding relevant stock video clips...`);
      DB.saveJob(job);

      for (let i = 0; i < result.scenes.length; i++) {
        const sceneData = result.scenes[i];
        job.logOutput.push(`[${new Date().toLocaleTimeString()}] Searching footage for Segment ${i + 1}: ${sceneData.keywords.join(", ")}`);
        DB.saveJob(job);

        const foundClips = await ProviderManagerService.searchFootage(
          sceneData.visualDescription,
          sceneData.keywords,
          project.settings.preferredSources,
          6,
          3,
          true,
          usedClipIds
        );

        let bestClip = foundClips[0];
        
        scenesList.push({
          id: `scene_${project.id}_${i}`,
          projectId: project.id,
          sceneIndex: i,
          text: sceneData.text,
          hook: withAutoEmoji(sceneData.hook || sceneData.text.split(" ").slice(0, 3).join(" ") + "...", project.settings.autoEmoji),
          visualDescription: sceneData.visualDescription,
          keywords: sceneData.keywords,
          selectedVideoUrl: bestClip?.url || FALLBACK_CLIP.url,
          selectedVideoId: bestClip?.id || FALLBACK_CLIP.id,
          selectedVideoProvider: bestClip?.provider || FALLBACK_CLIP.provider,
          selectedVideoDuration: bestClip?.duration || FALLBACK_CLIP.duration,
          selectedVideoPreviewUrl: bestClip?.previewUrl || FALLBACK_CLIP.previewUrl,
          duration: sceneData.duration || 5
        });

        if (bestClip?.id) usedClipIds.add(bestClip.id);
      }

      applySmartSceneDistribution(project, scenesList);

      DB.saveScenes(project.id, scenesList);

      job.step = "completed";
      job.progress = 100;
      job.logOutput.push(`[${new Date().toLocaleTimeString()}] Sourcing and visual breakdown complete!`);
      DB.saveJob(job);

      res.json({ project, scenes: scenesList, job });
    } catch (e: any) {
      console.error(e);
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (project) {
        project.status = ProjectStatus.FAILED;
        DB.saveProject(project);
      }
      const job = DB.getJobByProjectId(id);
      if (job) {
        job.step = "failed";
        job.progress = 100;
        job.errorMessage = e.message;
        job.logOutput.push(`[ERROR] ${e.message}`);
        DB.saveJob(job);
      }
      res.status(500).json({ error: e.message });
    }
  });

  // Endpoint to swap a specific scene clip manually
  app.post("/api/projects/:id/scenes/:sceneId/swap-clip", (req, res) => {
    try {
      const { id, sceneId } = req.params;
      const { clip } = req.body;
      if (!clip) return res.status(400).json({ error: "Clip details required" });

      const scenes = DB.getScenes(id);
      const targetScene = scenes.find(s => s.id === sceneId);
      if (!targetScene) return res.status(404).json({ error: "Scene not found" });

      targetScene.selectedVideoUrl = clip.url;
      targetScene.selectedVideoId = clip.id;
      targetScene.selectedVideoProvider = clip.provider;
      targetScene.selectedVideoPreviewUrl = clip.previewUrl;
      targetScene.selectedVideoDuration = clip.duration;

      // Also persist text/hook edits when the client sends them (scene text edit saves use this endpoint)
      if (req.body.text !== undefined) targetScene.text = String(req.body.text);
      if (req.body.hook !== undefined) targetScene.hook = String(req.body.hook);

      DB.updateScene(targetScene);
      res.json(targetScene);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Patch a single scene's editable fields (duration / trim / voice / emotion)
  app.patch("/api/projects/:id/scenes/:sceneId", (req, res) => {
    try {
      const { id, sceneId } = req.params;
      const scene = DB.getScenes(id).find(s => s.id === sceneId);
      if (!scene) return res.status(404).json({ error: "Scene not found" });

      const allowed = ["duration", "trimStart", "trimEnd", "voice", "emotion", "text", "hook", "speed"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === "duration" || key === "trimStart" || key === "trimEnd") {
            const num = parseFloat(req.body[key]);
            if (isNaN(num) || num < 0) continue;
            (scene as any)[key] = num;
          } else if (key === "speed") {
            const num = parseFloat(req.body[key]);
            if (isNaN(num) || num < 0.25 || num > 4) continue;
            (scene as any)[key] = num;
          } else {
            (scene as any)[key] = req.body[key];
          }
        }
      }
      DB.updateScene(scene);
      res.json(scene);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reorder scenes: body { sceneIds: string[] } in the desired order (front to back).
  // sceneIndex is renumbered 0..n-1 so the render pipeline picks up the new order.
  app.post("/api/projects/:id/scenes/reorder", (req, res) => {
    try {
      const { id } = req.params;
      const { sceneIds } = req.body || {};
      if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
        return res.status(400).json({ error: "sceneIds array required" });
      }
      const scenes = DB.getScenes(id);
      const byId = new Map(scenes.map(s => [s.id, s]));
      const missing = sceneIds.filter(sid => !byId.has(sid));
      if (missing.length > 0) {
        return res.status(400).json({ error: `Unknown scene ids: ${missing.join(", ")}` });
      }
      const updated = sceneIds.map((sid, idx) => {
        const s = byId.get(sid)!;
        s.sceneIndex = idx;
        DB.updateScene(s);
        return s;
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Direct Stock Search Proxy for clip swapping
  app.get("/api/search", async (req, res) => {
    try {
      const { query, visual, projectId, full } = req.query;
      if (!query) return res.status(400).json({ error: "Search query required" });

      const keywords = (query as string).split(",").map(k => k.trim());
      const visualDescription = (visual as string) || (query as string);
      const isFullSearch = full === "true";

      // Full search: skip AI scoring, return more results
      const perPage = isFullSearch ? 20 : 6;
      const maxResults = isFullSearch ? 40 : 3;

      const clips = await ProviderManagerService.searchFootage(
        visualDescription,
        keywords,
        ["pexels", "pixabay", "coverr", "mixkit"],
        perPage,
        maxResults,
        !isFullSearch // only AI-score for non-full searches
      );

      // Duplicate prevention: filter out clips already used in this project
      if (projectId) {
        const scenes = DB.getScenes(projectId as string);
        const usedIds = new Set(scenes.map(s => s.selectedVideoId).filter(Boolean));
        const filtered = clips.filter(c => !usedIds.has(c.id));
        res.json(filtered);
      } else {
        res.json(clips);
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // TikTok Video Search — TikTok only (web API with cookie, tikwm mirror as backup)
  app.post("/api/tiktok/search", async (req, res) => {
    try {
      const { keyword, count = "60" } = req.body;
      if (!keyword || !keyword.trim()) return res.status(400).json({ error: "Search keyword required" });

      const searchCount = Math.min(parseInt(count) || 60, 120);
      const tiktokCookie = process.env.TIKTOK_COOKIE || "";

      // Try TikTok web API (full item search endpoint) with cookie + X-Bogus signature
      if (tiktokCookie) {
        try {
          const msToken = (tiktokCookie.match(/msToken=([^;]+)/) || [])[1] || "";
          const searchParams: Record<string, string | number | boolean> = {
            WebIdLastTime: Date.now(),
            aid: "1988",
            app_language: "en",
            app_name: "tiktok_web",
            browser_language: "en-US",
            browser_name: "Mozilla",
            browser_online: true,
            browser_platform: "Win32",
            browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
            channel: "tiktok_web",
            cookie_enabled: true,
            count: searchCount,
            cursor: 0,
            data_collection_enabled: true,
            device_id: "7487787165935371783",
            device_platform: "web_pc",
            focus_state: true,
            from_page: "search",
            history_len: 4,
            is_fullscreen: false,
            is_page_visible: true,
            keyword: keyword,
            os: "windows",
            priority_region: "",
            referer: "",
            region: "US",
            screen_height: 1080,
            screen_width: 1920,
            search_source: "normal_search",
            tz_name: "Asia/Karachi",
            type: 1,
            user_is_login: true,
            webcast_language: "en",
          };
          if (msToken) searchParams.msToken = msToken;
          const buildQuery = (extra?: Record<string, string>) => {
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(searchParams)) p.set(k, String(v));
            if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
            return p.toString();
          };
          const baseSearchUrl = "https://www.tiktok.com/api/search/item/full/?" + buildQuery();
          let finalSearchUrl = baseSearchUrl;
          try {
            const xb = tiktokXBogus(baseSearchUrl, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0");
            if (xb) finalSearchUrl = baseSearchUrl + "&X-Bogus=" + encodeURIComponent(xb);
          } catch (signErr: any) {
            console.log("[TikTok Search] X-Bogus signing failed, continuing unsigned:", signErr?.message?.slice(0, 80));
          }
          const fetchRes = await fetch(finalSearchUrl, {
            signal: AbortSignal.timeout(8000),
            headers: {
              "Cookie": tiktokCookie,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
              "Referer": `https://www.tiktok.com/search/video?q=${encodeURIComponent(keyword)}`,
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Dest": "empty",
            }
          });
          if (fetchRes.ok) {
            const text = await fetchRes.text();
            try {
              const data: any = JSON.parse(text);
              // Check for TikTok API errors
              if (data?.status_msg && (data.status_msg.includes("url doesn't match") || data.status_msg.includes("not found") || data.status_msg.includes("failed"))) {
                console.log("[TikTok Search] Web API error:", data.status_msg);
              } else if (data?.item_list?.length) {
                const results = data.item_list.slice(0, searchCount).map((item: any) => ({
                  id: item.id || item.aweme_id || "",
                  title: item.desc || "No title",
                  cover: item.video?.cover || item.video?.originCover || item.video?.dynamicCover || "",
                  play: item.video?.playAddr || item.video?.downloadAddr || "",
                  hdplay: item.video?.playAddr || "",
                  duration: item.video?.duration || 0,
                  author: item.author?.uniqueId || item.author?.nickname || "",
                  likes: item.stats?.diggCount || 0,
                })).filter((r: any) => r.play);
                if (results.length) return res.json({ results, source: "tiktok-web" });
                console.log("[TikTok Search] Web API returned no playable items");
              } else {
                console.log("[TikTok Search] Web API returned no items:", data?.status_msg || "empty response");
              }
            } catch (e) {
              console.log("[TikTok Search] Web API returned non-JSON:", text.slice(0, 200));
            }
          }
        } catch (e: any) {
          console.error("[TikTok Search] Web API error:", e.message);
        }
      }

      // Fallback: tikwm.com API (Cloudflare-blocked but worth trying)
      try {
        const apiRes = await fetch("https://www.tikwm.com/api/feed/search", {
          method: "POST",
          signal: AbortSignal.timeout(8000),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "application/json"
          },
          body: new URLSearchParams({ keywords: keyword, count: String(searchCount), cursor: "0" })
        });
        if (apiRes.ok) {
          const data: any = await apiRes.json();
          if (data?.data?.videos?.length) {
            const results = data.data.videos.slice(0, searchCount).map((v: any) => ({
              id: v.video_id,
              title: v.title || "No title",
              cover: v.cover,
              play: v.play,
              hdplay: v.hdplay || v.play,
              duration: v.duration,
              author: v.author?.unique_id || v.author?.nickname || "",
              likes: v.digg_count,
            }));
            return res.json({ results: results, source: "tikwm" });
          }
        }
      } catch (fbErr) {
        console.error("[TikTok Search] tikwm fallback error:", fbErr);
      }

      // Fallback: urlebird.com hashtag search — no signature/cookie needed,
      // returns real TikTok video IDs (downloadable via yt-dlp).
      // NOTE: urlebird now blocks plain curl AND Node fetch (Cloudflare TLS
      // fingerprint detection, returns 0 bytes). It only allows a real Chrome
      // TLS fingerprint, so we shell out to a python3.13 + curl_cffi helper
      // (urlebird_search.py) that impersonates Chrome. Async to avoid blocking
      // the event loop.
      try {
        const { execFile } = await import("child_process");
        const { promisify } = await import("util");
        const execFileAsync = promisify(execFile);
        let ubJson = "";
        // Retry up to 2 times — urlebird's Cloudflare can intermittently block.
        for (let attempt = 1; attempt <= 2 && !ubJson; attempt++) {
          try {
            const { stdout } = await execFileAsync(getCffiPythonBin(), [
              path.join(__dirname, "..", "urlebird_search.py"),
              keyword,
              String(searchCount),
            ], { encoding: "utf-8", timeout: 40000 });
            // Only accept a non-empty JSON array
            const trimmed = (stdout || "").trim();
            if (trimmed && trimmed !== "[]") ubJson = trimmed;
          } catch (pyErr: any) {
            console.error(`[TikTok Search] urlebird python error (attempt ${attempt}):`, pyErr?.message?.slice(0, 120));
          }
          if (!ubJson && attempt < 2) await new Promise(r => setTimeout(r, 1200));
        }
        if (ubJson) {
          try {
            const results = JSON.parse(ubJson);
            if (Array.isArray(results) && results.length) {
              return res.json({ results: results.slice(0, searchCount), source: "urlebird" });
            }
            console.log("[TikTok Search] urlebird returned no results for:", keyword);
          } catch (parseErr) {
            console.error("[TikTok Search] urlebird JSON parse error:", parseErr?.message?.slice(0, 80));
          }
        }
      } catch (ubErr) {
        console.error("[TikTok Search] urlebird fallback error:", ubErr);
      }

      res.json({
        results: [],
        message: "TikTok search unavailable right now (all sources blocked). Try again in a while, or use URL Import — paste any TikTok video link and it will download via yt-dlp.",
        troubleshooting: "If you have a fresh browser cookie, set TIKTOK_COOKIE in .env and restart. Otherwise the hashtag search mirror may recover on its own."
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // TikTok video preview URL — resolves a direct mp4 link for hover-preview
  // via urlebird's video page (same Chrome-impersonation helper as search).
  // Prefers the full urlebird page URL (with slug); bare /video/<id>/ 404s.
  app.post("/api/tiktok/preview", async (req, res) => {
    try {
      const { videoId, urlebirdUrl } = req.body;
      const target = (urlebirdUrl && String(urlebirdUrl).startsWith("http")) ? String(urlebirdUrl) : String(videoId || "");
      if (!target) return res.status(400).json({ error: "videoId or urlebirdUrl required" });
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      let out = "";
      for (let attempt = 1; attempt <= 2 && !out; attempt++) {
        try {
          const { stdout } = await execFileAsync(getCffiPythonBin(), [
            path.join(__dirname, "..", "urlebird_preview.py"),
            target,
          ], { encoding: "utf-8", timeout: 40000 });
          const trimmed = (stdout || "").trim();
          if (trimmed) out = trimmed;
        } catch (pyErr: any) {
          console.error(`[TikTok Preview] python error (attempt ${attempt}):`, pyErr?.message?.slice(0, 120));
        }
        if (!out && attempt < 2) await new Promise(r => setTimeout(r, 1200));
      }
      if (out) {
        try {
          const parsed = JSON.parse(out);
          if (parsed.previewUrl) return res.json({ previewUrl: parsed.previewUrl });
        } catch (parseErr) {
          console.error("[TikTok Preview] JSON parse error:", parseErr?.message?.slice(0, 80));
        }
      }
      res.json({ previewUrl: "" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // TikTok Video Download via fallback chain: yt-dlp -> third-party API -> error
  app.post("/api/tiktok/download", async (req, res) => {
    try {
      const { url, projectId } = req.body;
      if (!url) return res.status(400).json({ error: "TikTok URL required" });
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      // Create tiktok_imports directory
      const importsDir = path.join(process.cwd(), "storage", "projects", projectId, "tiktok_imports");
      fs.mkdirSync(importsDir, { recursive: true });

      const safeName = "tiktok_" + Date.now();
      const safeOutput = path.join(importsDir, `${safeName}.mp4`);

      let actualFile = "";

      // Method 1: yt-dlp (try with impersonation first, then plain — impersonation
      // needs curl_cffi which may be unavailable on this device; plain yt-dlp can
      // still solve TikTok's JS challenge natively)
      const outputPath = path.join(importsDir, `${safeName}.%(ext)s`);
      const findDownloaded = () => {
        const files = fs.readdirSync(importsDir);
        const mp4 = files.find(f => f.startsWith(safeName) && f.endsWith(".mp4"));
        return mp4 ? path.join(importsDir, mp4) : "";
      };
      const ytdlpArgSets: string[][] = [
        ["--impersonate", "Chrome-133", "-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4", "-o", outputPath, "--no-playlist", "--no-warnings", url],
        ["-f", "bestvideo+bestaudio/best", "--merge-output-format", "mp4", "-o", outputPath, "--no-playlist", "--no-warnings", url]
      ];
      for (const args of ytdlpArgSets) {
        try {
          execFileSync("yt-dlp", args, { encoding: "utf-8", timeout: 120000 });
          actualFile = findDownloaded();
          if (actualFile) {
            console.log("TikTok: yt-dlp method succeeded", args[0] === "--impersonate" ? "(with impersonation)" : "(plain)");
            break;
          }
        } catch (e: any) {
          console.log("TikTok: yt-dlp attempt failed:", e.message?.slice(0, 120));
        }
      }

      // Method 2: Third-party API fallback (snapdownloader.com / tikwm.com)
      if (!actualFile || !fs.existsSync(actualFile)) {
        try {
          const extractId = (u: string) => {
            const m = u.match(/video\/(\d+)/);
            return m ? m[1] : "";
          };
          const videoId = extractId(url);
          if (videoId) {
            // Try tikwm.com API (well known TikTok downloader API)
            const apiRes = await fetch("https://www.tikwm.com/api/", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ url, count: "12", cursor: "0", hd: "1" })
            });
            if (apiRes.ok) {
              const apiData: any = await apiRes.json();
              const videoData = apiData?.data;
              if (videoData?.play || videoData?.hdplay) {
                const dlUrl = videoData.hdplay || videoData.play;
                const dlRes = await fetch(dlUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
                if (dlRes.ok) {
                  const buffer = Buffer.from(await dlRes.arrayBuffer());
                  fs.writeFileSync(safeOutput, buffer);
                  actualFile = safeOutput;
                  console.log("TikTok: tikwm.com API fallback succeeded");
                }
              }
            }
          }
        } catch (apiErr) {
          console.log("TikTok: API fallback also failed:", (apiErr as any)?.message?.slice(0, 50));
        }
      }

      if (!actualFile || !fs.existsSync(actualFile)) {
        return res.status(500).json({
          error: "TikTok download blocked by TikTok (IP restricted). Try a different network or use a VPN. Instagram/Reels URLs work via yt-dlp without issues."
        });
      }

      // Get video metadata
      const originalSize = fs.statSync(actualFile).size;
      const relativePath = `/api/projects/${projectId}/tiktok/${path.basename(actualFile)}`;

      // Store in a database that we imported this TikTok video
      const tiktokClipsPath = path.join(importsDir, "..", "..", "tiktok_clips.json");
      let tiktokClips: any[] = [];
      if (fs.existsSync(tiktokClipsPath)) {
        try { tiktokClips = JSON.parse(fs.readFileSync(tiktokClipsPath, "utf-8")); } catch {}
      }
      const clipEntry = {
        id: `tiktok_${Date.now()}`,
        title: `TikTok Import ${new Date().toLocaleDateString()}`,
        url: relativePath,
        filePath: actualFile,
        fileSize: originalSize,
        sourceUrl: url,
        importedAt: new Date().toISOString()
      };
      tiktokClips.push(clipEntry);
      fs.writeFileSync(tiktokClipsPath, JSON.stringify(tiktokClips, null, 2));

      res.json({
        success: true,
        clip: {
          id: clipEntry.id,
          url: relativePath,
          title: clipEntry.title,
          fileSize: originalSize,
          filePath: actualFile
        }
      });
    } catch (e: any) {
      console.error("TikTok download error:", e);
      res.status(500).json({ error: e.message || "TikTok download failed" });
    }
  });

  // Serve imported TikTok videos
  app.get("/api/projects/:projectId/tiktok/:filename", (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(process.cwd(), "storage", "projects", req.params.projectId, "tiktok_imports", filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  // Pinterest search via multiple fallback methods (JSON API → HTML scrape → RSS)
app.post("/api/pinterest/search", async (req, res) => {
  try {
    const { keyword, count = "25" } = req.body;
    if (!keyword || !keyword.trim()) return res.status(400).json({ error: "Search keyword required" });

    const searchCount = Math.min(parseInt(count) || 25, 40);
    let results: any[] = [];

    // PRIMARY (video-only): python3.13 + curl_cffi helper. Pinterest's own
    // search API is geo-blocked from this region (200 but empty results) and
    // its pages are client-rendered, so the helper gathers pin IDs from Bing
    // image search (video-biased query variants) then probes each pin via
    // Pinterest's PinResource API, keeping only pins with a populated
    // videos.video_list -> real VIDEO pins with direct v1.pinimg.com mp4 URLs.
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      for (let attempt = 1; attempt <= 2 && results.length === 0; attempt++) {
        try {
          const { stdout } = await execFileAsync(getCffiPythonBin(), [
            path.join(__dirname, "..", "pinterest_video_search.py"),
            keyword.trim(),
            String(searchCount),
          ], { encoding: "utf-8", timeout: 120000 });
          const trimmed = (stdout || "").trim();
          if (trimmed && trimmed !== "[]") {
            const vids = JSON.parse(trimmed);
            if (Array.isArray(vids) && vids.length > 0) {
              results = vids.slice(0, searchCount).map((v: any) => ({
                id: v.id,
                title: v.title || "Pinterest Video",
                cover: v.cover || "",
                video: v.video || "",
                duration: v.duration || 0,
                url: v.url || `https://www.pinterest.com/pin/${v.id}/`,
                isVideo: true
              }));
            }
          }
        } catch (hErr: any) {
          console.error(`[Pinterest Search] video-helper attempt ${attempt} error:`, hErr?.message?.slice(0, 150));
        }
      }
      if (results.length > 0) console.log(`[Pinterest Search] video-helper returned ${results.length} video pins`);
    } catch (hOuter: any) {
      console.error("[Pinterest Search] video-helper outer error:", hOuter?.message?.slice(0, 120));
    }

    if (results.length > 0) return res.json({ results, source: "video-helper" });

    const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36";

    // Method 0: Bing image search biased to Pinterest (region-independent).
    // Pinterest's own API/HTML/RSS are geo-blocked or client-rendered from many
    // IPs, but Bing indexes real pins and returns direct i.pinimg.com images +
    // pinterest.com/pin/ URLs with a plain fetch. Tried first.
    try {
      const bingRes = await fetch(
        `https://www.bing.com/images/search?q=${encodeURIComponent(keyword.trim() + " pinterest")}&form=HDRSC2&first=1&setlang=en-US`,
        { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html" } }
      );
      if (bingRes.ok) {
        const bingHtml = await bingRes.text();
        const blockRegex = /m="({[^"]+})"/g;
        let bm;
        const seen = new Set<string>();
        while ((bm = blockRegex.exec(bingHtml)) !== null && results.length < searchCount) {
          try {
            const decoded = bm[1]
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, "&")
              .replace(/&#39;/g, "'");
            const d: any = JSON.parse(decoded);
            const murl = d.murl || "";
            const purl = d.purl || "";
            if (!(murl.includes("pinimg") || purl.includes("pinterest"))) continue;
            const idm = purl.match(/\/pin\/(?:[^/]*-)?(\d+)/);
            const pinId = idm ? idm[1] : `pin_${Date.now()}_${results.length}`;
            if (seen.has(pinId)) continue;
            seen.add(pinId);
            results.push({
              id: pinId,
              title: d.t || "Untitled",
              cover: murl,
              url: purl || `https://www.pinterest.com/pin/${pinId}/`,
              description: ""
            });
          } catch {}
        }
        if (results.length > 0) console.log(`[Pinterest Search] Bing method returned ${results.length} pins`);
      }
    } catch (bingErr: any) {
      console.error("[Pinterest Search] Bing method error:", bingErr?.message?.slice(0, 120));
    }

    if (results.length > 0) return res.json({ results, source: "bing" });

    // Method 1: Pinterest JSON API (most reliable)
    try {
      const jsonRes = await fetch("https://www.pinterest.com/resource/BaseSearchResource/get/", {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" },
        body: `data=%7B%22options%22%3A%7B%22query%22%3A%22${encodeURIComponent(keyword.trim())}%22%2C%22scope%22%3A%22pins%22%2C%22page_size%22%3A${searchCount}%7D%7D&module=1&_=1`
      });
      if (jsonRes.ok) {
        const jsonData: any = await jsonRes.json();
        const pins = jsonData?.resource_response?.data?.results;
        if (pins && pins.length > 0) {
          results = pins.slice(0, searchCount).map((pin: any) => ({
            id: pin.id,
            title: pin.title || pin.grid_description || "Untitled",
            cover: pin.images?.orig?.url || pin.images?.["236x"]?.url || "",
            url: `https://www.pinterest.com/pin/${pin.id}/`,
            description: pin.description || ""
          }));
        }
      }
    } catch {}

    if (results.length > 0) return res.json({ results });

    // Method 2: Pinterest GraphQL API
    try {
      const gqlRes = await fetch("https://www.pinterest.com/api/graphql/", {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/json", "X-Pinterest-App-State": "active" },
        body: JSON.stringify({
          operationName: "searchPins",
          query: `query searchPins($query: String!, $count: Int!) { search_pins(query: $query, count: $count) { results { id title description images { orig { url } } } } }`,
          variables: { query: keyword.trim(), count: searchCount }
        })
      });
      if (gqlRes.ok) {
        const gqlData: any = await gqlRes.json();
        const gqlPins = gqlData?.data?.search_pins?.results;
        if (gqlPins && gqlPins.length > 0) {
          results = gqlPins.slice(0, searchCount).map((pin: any) => ({
            id: pin.id,
            title: pin.title || "Untitled",
            cover: pin.images?.orig?.url || "",
            url: `https://www.pinterest.com/pin/${pin.id}/`,
            description: pin.description || ""
          }));
        }
      }
    } catch {}

    if (results.length > 0) return res.json({ results });

    // Method 3: Scrape HTML page for JSON data
    try {
      const htmlRes = await fetch(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(keyword.trim())}`, {
        headers: { "User-Agent": UA, "Accept": "text/html" }
      });
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        // Try extracting JSON from script tags
        const scriptMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
        if (scriptMatch) {
          try {
            const pageData = JSON.parse(scriptMatch[1]);
            // Navigate the Next.js data structure to find pins
            const extractPins = (obj: any): any[] => {
              if (!obj || typeof obj !== "object") return [];
              if (obj.resource_response?.data?.results) return obj.resource_response.data.results;
              if (obj.props?.pageProps?.pins) return obj.props.pageProps.pins;
              for (const val of Object.values(obj)) {
                const found = extractPins(val);
                if (found.length > 0) return found;
              }
              return [];
            };
            const pagePins = extractPins(pageData);
            if (pagePins.length > 0) {
              results = pagePins.slice(0, searchCount).map((pin: any) => ({
                id: pin.id,
                title: pin.title || pin.grid_description || "Untitled",
                cover: pin.images?.orig?.url || pin.images?.["236x"]?.url || "",
                url: `https://www.pinterest.com/pin/${pin.id}/`,
                description: pin.description || ""
              }));
            }
          } catch {}
        }
      }
    } catch {}

    if (results.length > 0) return res.json({ results });

    // Method 4: RSS feed (last resort)
    try {
      const rssRes = await fetch(`https://www.pinterest.com/search/pins/rss/?q=${encodeURIComponent(keyword.trim())}&rs=typed`, {
        headers: { "User-Agent": UA }
      });
      if (rssRes.ok) {
        const xml = await rssRes.text();
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let m;
        while ((m = itemRegex.exec(xml)) !== null && results.length < searchCount) {
          const item = m[1];
          const getTag = (t: string) => { const mm = item.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, "i")); return mm ? mm[1].trim() : ""; };
          const link = getTag("link");
          const pinIdMatch = link.match(/\/pin\/([^/?#]+)/);
          results.push({
            id: pinIdMatch ? pinIdMatch[1] : `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: getTag("title") || "Untitled",
            cover: item.match(/src\s*=\s*"([^"]+)"/)?.[1] || "",
            url: link,
            description: getTag("description").slice(0, 200)
          });
        }
      }
    } catch {}

    if (results.length > 0) return res.json({ results });

    res.json({ results: [], error: "No results found. Try different keywords." });
  } catch (e: any) {
    console.error("Pinterest search error:", e.message);
    res.status(500).json({ error: e.message || "Pinterest search failed" });
  }
});

// Pinterest Video Download (direct mp4 → yt-dlp → og:image fallback)
  app.post("/api/pinterest/download", async (req, res) => {
    try {
      const { url, videoUrl, projectId } = req.body;
      if (!url && !videoUrl) return res.status(400).json({ error: "Pinterest URL required" });
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      const importsDir = path.join(process.cwd(), "storage", "projects", projectId, "pinterest_imports");
      fs.mkdirSync(importsDir, { recursive: true });

      const safeName = "pinterest_" + Date.now();

      let actualFile = "";

      // Method 1 (fastest): direct mp4 URL from the video-search helper.
      if (videoUrl && !actualFile) {
        try {
          const vRes = await fetch(videoUrl, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.pinterest.com/" } });
          if (vRes.ok) {
            const buf = Buffer.from(await vRes.arrayBuffer());
            if (buf.length > 1000) {
              const mp4Path = path.join(importsDir, `${safeName}.mp4`);
              fs.writeFileSync(mp4Path, buf);
              actualFile = mp4Path;
              console.log("Pinterest: direct mp4 download succeeded", buf.length, "bytes");
            }
          }
        } catch (dvErr: any) {
          console.error("Pinterest: direct mp4 failed:", dvErr?.message?.slice(0, 120));
        }
      }

      // Method 2: yt-dlp on the pin page URL
      if (!actualFile && url) {
        try {
          const outputPath = path.join(importsDir, `${safeName}.%(ext)s`);
          // NOTE: no --impersonate flag — curl_cffi is broken on this device's
          // python and crashes yt-dlp; plain yt-dlp handles Pinterest fine.
          const cmd = `yt-dlp -o "${outputPath}" --no-playlist --no-warnings "${url}" 2>&1`;
          execSync(cmd, { encoding: "utf-8", timeout: 120000, shell: true as any });
          const files = fs.readdirSync(importsDir);
          const mp4 = files.find(f => f.startsWith(safeName) && f.endsWith(".mp4"));
          if (mp4) actualFile = path.join(importsDir, mp4);
          console.log("Pinterest: yt-dlp method succeeded");
        } catch (e: any) {
          console.error("Pinterest: yt-dlp failed:", e.message?.slice(0, 200));
        }
      }

      if (!actualFile || !fs.existsSync(actualFile)) {
        // Fallback: find the file in the imports dir
        const files = fs.readdirSync(importsDir);
        const mp4 = files.find(f => f.startsWith(safeName));
        if (mp4) actualFile = path.join(importsDir, mp4);
      }

      // Fallback for IMAGE pins: yt-dlp reports "No video formats found" for
      // static pins. Fetch the pin page, grab og:image, download it directly.
      if ((!actualFile || !fs.existsSync(actualFile)) && url) {
        try {
          const pageRes = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36", "Accept": "text/html" }
          });
          if (pageRes.ok) {
            const pageHtml = await pageRes.text();
            const ogMatch = pageHtml.match(/property="og:image"[^>]*content="([^"]+)"/) || pageHtml.match(/content="([^"]+)"[^>]*property="og:image"/);
            if (ogMatch && ogMatch[1]) {
              // Prefer the original-size image (swap /736x/ or /236x/ for /originals/)
              let imgDirect = ogMatch[1].replace(/\/(736x|236x|564x|474x)\//, "/originals/");
              const imgRes = await fetch(imgDirect, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.pinterest.com/" } });
              if (!imgRes.ok && imgDirect !== ogMatch[1]) {
                imgDirect = ogMatch[1];
              }
              const imgRes2 = imgRes.ok ? imgRes : await fetch(imgDirect, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.pinterest.com/" } });
              if (imgRes2.ok) {
                const buf = Buffer.from(await imgRes2.arrayBuffer());
                const ct = imgRes2.headers.get("content-type") || "";
                const ext = ct.includes("png") ? ".png" : ct.includes("gif") ? ".gif" : ct.includes("webp") ? ".webp" : ".jpg";
                const imgPath = path.join(importsDir, `${safeName}${ext}`);
                fs.writeFileSync(imgPath, buf);
                actualFile = imgPath;
                console.log("Pinterest: og:image fallback succeeded");
              }
            }
          }
        } catch (imgErr: any) {
          console.error("Pinterest: og:image fallback failed:", imgErr?.message?.slice(0, 120));
        }
      }

      if (!actualFile || !fs.existsSync(actualFile)) {
        return res.status(500).json({ error: "Pinterest download failed. Make sure the URL is a valid pin URL." });
      }

      // Detect if it's actually a video or just an image
      const isVideo = actualFile.endsWith(".mp4") || actualFile.endsWith(".webm") || actualFile.endsWith(".mov");
      const originalSize = fs.statSync(actualFile).size;
      const ext = path.extname(actualFile);
      // Rename to mp4 if it's a video
      let finalFile = actualFile;
      if (isVideo && ext !== ".mp4") {
        const renamed = actualFile.replace(ext, ".mp4");
        fs.renameSync(actualFile, renamed);
        finalFile = renamed;
      }
      const finalName = path.basename(finalFile);
      const relativePath = `/api/projects/${projectId}/pinterest/${finalName}`;

      res.json({
        success: true,
        clip: {
          id: `pinterest_${Date.now()}`,
          url: relativePath,
          title: `Pinterest Import`,
          fileSize: originalSize,
          filePath: finalFile,
          isVideo
        }
      });
    } catch (e: any) {
      console.error("Pinterest download error:", e);
      res.status(500).json({ error: e.message || "Pinterest download failed" });
    }
  });

  // Serve imported Pinterest pins
  app.get("/api/projects/:projectId/pinterest/:filename", (req, res) => {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(process.cwd(), "storage", "projects", req.params.projectId, "pinterest_imports", filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  // Step 3: Trigger FFmpeg Renderer
  app.post("/api/projects/:id/render", async (req, res) => {
    try {
      const { id } = req.params;
      const { settings } = req.body;

      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (settings) {
        // Force boolean coercion for subtitleEnabled (fix: string "false" → boolean false)
        if (settings.subtitleEnabled !== undefined) {
          settings.subtitleEnabled = settings.subtitleEnabled === true || settings.subtitleEnabled === "true";
        }
        // Deep-merge audioSettings so a stale/empty audioSettings object can never
        // wipe a previously-saved voiceoverTrack/bgmTrack right before render.
        if (settings.audioSettings !== undefined) {
          const prevAudio = (project.settings as any)?.audioSettings || {};
          const nextAudio = { ...prevAudio, ...settings.audioSettings };
          if (prevAudio.voiceoverTrack && !nextAudio.voiceoverTrack) nextAudio.voiceoverTrack = prevAudio.voiceoverTrack;
          if (prevAudio.bgmTrack && !nextAudio.bgmTrack) nextAudio.bgmTrack = prevAudio.bgmTrack;
          settings.audioSettings = nextAudio;
        }
        project.settings = { ...project.settings, ...settings };
        project.status = ProjectStatus.PROCESSING;
        DB.saveProject(project);
      }

      // Initiate render
      FFmpegService.renderProject(id);

      res.json({ success: true, message: "Rendering pipeline successfully triggered in background." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cancel an ongoing render
  app.post("/api/projects/:id/render/cancel", async (req, res) => {
    try {
      const { id } = req.params;
      const job = DB.getJobByProjectId(id);

      if (!job) {
        return res.status(404).json({ error: "No active render job found for this project." });
      }

      // Set cancel flag — the render loop checks this between steps
      DB.saveJob({ ...job, cancelRequested: true, logOutput: [...(job.logOutput || []), "[CANCEL] Cancel requested..."] });

      // Also reset project status immediately for responsive UI
      const project = DB.getProjectById(id);
      if (project) {
        project.status = "draft" as any;
        DB.saveProject(project);
      }

      res.json({ success: true, message: "Render cancellation requested." });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Cancel failed" });
    }
  });

  // Generate thumbnail from rendered video
  app.post("/api/projects/:id/thumbnail", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const renderedPath = path.join(process.cwd(), "storage", "projects", id, "renders", `${id}_final.mp4`);
      if (!fs.existsSync(renderedPath)) {
        return res.status(400).json({ error: "No rendered video found. Please render the video first." });
      }

      const thumbnailsDir = path.join(process.cwd(), "storage", "projects", id, "thumbnails");
      fs.mkdirSync(thumbnailsDir, { recursive: true });

      const thumbnailPath = path.join(thumbnailsDir, `${id}_thumbnail.jpg`);

      // Use FFmpeg to extract a frame at 1 second
      execSync(`ffmpeg -y -ss 00:00:01 -i "${renderedPath}" -vframes 1 -s 1280:720 -q:v 2 "${thumbnailPath}"`, { stdio: "pipe" });

      if (!fs.existsSync(thumbnailPath)) {
        return res.status(500).json({ error: "Thumbnail generation failed." });
      }

      const stats = fs.statSync(thumbnailPath);
      res.json({
        success: true,
        thumbnailUrl: `/api/projects/${id}/thumbnail.jpg`,
        fileSize: `${(stats.size / 1024).toFixed(1)} KB`,
        path: thumbnailPath
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve thumbnail image
  app.get("/api/projects/:id/thumbnail.jpg", (req, res) => {
    const { id } = req.params;
    const safeId = path.basename(id);
    const thumbPath = path.join(process.cwd(), "storage", "projects", safeId, "thumbnails", `${safeId}_thumbnail.jpg`);
    if (fs.existsSync(thumbPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      return res.sendFile(thumbPath);
    }
    res.status(404).json({ error: "Thumbnail not found" });
  });

  // Serve audio file (voiceover or bgm)
  app.get("/api/projects/:id/audio/:type", (req, res) => {
    const { id, type } = req.params;
    if (type !== "voiceover" && type !== "bgm") {
      return res.status(400).json({ error: "Invalid audio type" });
    }
    const safeId = path.basename(id);
    const audioDir = path.join(process.cwd(), "storage", "projects", safeId, "audio");
    if (!fs.existsSync(audioDir)) return res.status(404).json({ error: "Audio not found" });
    const files = fs.readdirSync(audioDir).filter(f => f.startsWith(type)).sort((a, b) => fs.statSync(path.join(audioDir, b)).mtimeMs - fs.statSync(path.join(audioDir, a)).mtimeMs);
    if (files.length > 0) {
      const audioPath = path.join(audioDir, files[0]);
      const ext = path.extname(audioPath).toLowerCase();
      const mime = ext === ".mp3" ? "audio/mpeg" : "audio/wav";
      return res.setHeader("Content-Type", mime).sendFile(audioPath);
    }
    res.status(404).json({ error: "Audio not found" });
  });

  // Apply built-in BGM or SFX to project
  app.post("/api/projects/:id/audio/apply-builtin", async (req, res) => {
    try {
      const { id } = req.params;
      const { type, fileName, filePath } = req.body;
      if (!type || !fileName || !filePath) {
        return res.status(400).json({ error: "type, fileName, and filePath required" });
      }
      if (type !== "bgm" && type !== "sfx") {
        return res.status(400).json({ error: 'type must be "bgm" or "sfx"' });
      }
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      if (!fs.existsSync(filePath)) {
        return res.status(400).json({ error: "File not found on disk" });
      }

      const stat = fs.statSync(filePath);
      let duration = 0;
      try {
        duration = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
        ).toString().trim()) || 0;
      } catch {}

      if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
      const audioTrack = {
        type,
        url: `/api/audio/builtin/${type}/${fileName}`,
        filePath,
        fileName,
        fileSize: stat.size,
        duration,
        format: "mp3"
      };
      if (type === "sfx") {
        (project.settings.audioSettings as any).sfxTrack = audioTrack;
      } else {
        (project.settings.audioSettings as any).bgmTrack = audioTrack;
      }
      DB.saveProject(project);
      res.json({ success: true, audioTrack });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Upload audio file (voiceover or bgm)
  app.post("/api/projects/:id/audio/:type", async (req, res) => {
    try {
      const { id, type } = req.params;
      // If request reached here with "sync", handle audio sync
      if (type === "sync") {
        const project = DB.getProjectById(id);
        if (!project) return res.status(404).json({ error: "Project not found" });
        const voiceover = (project.settings.audioSettings as any)?.voiceoverTrack;
        if (!voiceover) return res.status(400).json({ error: "No voiceover uploaded" });
        const scenes = DB.getScenes(id);
        const perScene = voiceover.duration / scenes.length;
        scenes.forEach((s: any) => {
          s.duration = Math.round(perScene * 10) / 10;
          DB.updateScene(s);
        });
        return res.json({ success: true, totalDuration: voiceover.duration, sceneCount: scenes.length, perScene: Math.round(perScene * 10) / 10 });
      }
      if (type !== "voiceover" && type !== "bgm") {
        return res.status(400).json({ error: 'Type must be "voiceover" or "bgm"' });
      }
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const safeId = path.basename(id);
      const audioDir = path.join(process.cwd(), "storage", "projects", safeId, "audio");
      fs.mkdirSync(audioDir, { recursive: true });

      // Remove existing file of same type
      const existing = fs.readdirSync(audioDir).filter(f => f.startsWith(type));
      existing.forEach(f => { try { fs.unlinkSync(path.join(audioDir, f)); } catch {} });

      const raw = req.body?.audioData || req.body?.file;
      if (!raw) return res.status(400).json({ error: "No audio data provided" });

      const ext = req.body?.format === "wav" ? ".wav" : ".mp3";
      const fileName = `${type}_${Date.now()}${ext}`;
      const filePath = path.join(audioDir, fileName);

      if (typeof raw === "string" && raw.includes("base64,")) {
        fs.writeFileSync(filePath, Buffer.from(raw.split("base64,")[1], "base64"));
      } else if (typeof raw === "string") {
        fs.writeFileSync(filePath, Buffer.from(raw, "base64"));
      } else {
        return res.status(400).json({ error: "Invalid audio data format" });
      }

      // Validate with ffprobe
      try {
        const probeOut = execSync(
          `ffprobe -v error -show_entries format=duration,size,format_name -of json "${filePath}"`
        ).toString();
        const info = JSON.parse(probeOut);
        const duration = parseFloat(info.format?.duration || "0");
        const fileSize = parseInt(info.format?.size || "0");
        if (duration <= 0) throw new Error("Audio has zero duration (corrupted?)");
        if (fileSize <= 0) throw new Error("Audio file is empty");

        if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
        const audioTrack = { type, url: `/api/projects/${id}/audio/${type}`, filePath, fileName, fileSize, duration, format: ext.replace(".", "") };
        (project.settings.audioSettings as any)[type === "voiceover" ? "voiceoverTrack" : "bgmTrack"] = audioTrack;
        DB.saveProject(project);

        // Auto-sync scene durations if voiceover is uploaded
        if (type === "voiceover" && duration > 0) {
          try {
            const scenes = DB.getScenes(id);
            if (scenes && scenes.length > 0) {
              const perScene = duration / scenes.length;
              scenes.forEach((s: any) => {
                s.duration = Math.round(perScene * 10) / 10;
                DB.updateScene(s);
              });
            }
          } catch {}
        }

        res.json({ success: true, audioTrack });
      } catch (probeErr: any) {
        try { fs.unlinkSync(filePath); } catch {}
        res.status(400).json({ error: `Audio validation failed: ${probeErr.message}` });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // TTS: Generate voiceover from project script using edge-tts
  app.post("/api/projects/:id/tts/generate", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const scenes = DB.getScenes(id);
      if (!scenes.length) return res.status(400).json({ error: "No scenes found. Generate script first." });

      const safeId = path.basename(id);
      // Join scene texts to detect the script language for voice auto-selection
      const sceneTextsForLang = scenes.map((s: any) => (s.text || "").trim()).filter(Boolean);
      const joinedForLang = sceneTextsForLang.join(" ");
      // v16: if the script is in a native (non-Latin) script, auto-pick a matching
      // edge-tts voice unless the user explicitly passed one. Prevents Hindi script
      // being narrated by an English voice.
      const scriptLangVoice = detectEdgeVoiceForScript(joinedForLang);
      // Priority: explicit request voice > script-language match > saved setting > default.
      // Script-language match beats the saved setting so a stale English voice can't
      // narrate a Devanagari/Hindi script.
      const voice = req.body?.voice || scriptLangVoice || project.settings.edgeTtsVoice || "hi-IN-SwaraNeural";
      const rate = req.body?.rate || project.settings.edgeTtsRate || "+0%";
      // Join scene texts smoothly — remove trailing punctuation from mid-scenes
      // to avoid unnatural pauses between scenes in the generated voiceover
      const sceneTexts = scenes.map((s: any) => (s.text || "").trim()).filter(Boolean);
      const fullText = sceneTexts.map((t: string, i: number) => {
        if (i < sceneTexts.length - 1) {
          // Remove trailing sentence-ending punctuation so edge-tts doesn't pause mid-clip
          return t.replace(/[.!?]+$/, "").trim();
        }
        return t;
      }).join(", ");
      if (!fullText.trim()) return res.status(400).json({ error: "No text content in scenes to generate voiceover." });

      const audioDir = path.join(process.cwd(), "storage", "projects", safeId, "audio");
      fs.mkdirSync(audioDir, { recursive: true });

      // Remove old voiceover
      const existing = fs.readdirSync(audioDir).filter(f => f.startsWith("voiceover"));
      existing.forEach(f => { try { fs.unlinkSync(path.join(audioDir, f)); } catch {} });

      const outputPath = path.join(audioDir, `voiceover_${Date.now()}.mp3`);

      // v16: VOICE CLONING — if enabled, try the Colab XTTS server first.
      // Falls back to edge-tts automatically if the server is unreachable/fails.
      let usedClonedVoice = false;
      let result: any = null;
      if (isVoiceCloneEnabled()) {
        const xttsLang = detectXttsLanguage(fullText);
        console.log(`[VoiceClone] Attempting cloned voice generation (lang=${xttsLang}, ${fullText.length} chars)...`);
        const clonedPath = await generateClonedVoice(fullText, xttsLang, outputPath);
        if (clonedPath) {
          try {
            const dur = parseFloat(execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${clonedPath}"`
            ).toString().trim()) || 0;
            result = { duration: dur, path: clonedPath };
            usedClonedVoice = true;
            console.log(`[VoiceClone] ✅ Cloned voice generated (${dur.toFixed(1)}s)`);
          } catch { /* fall through to edge-tts */ }
        } else {
          console.log("[VoiceClone] ⚠️ Cloned voice failed — falling back to edge-tts");
        }
      }

      // edge-tts path (default, or fallback when cloning is off/failed)
      if (!usedClonedVoice) {
        const pythonScript = path.join(process.cwd(), "server", "tts.py");
        const textFile = path.join(audioDir, `tts_text_${Date.now()}.txt`);
        fs.writeFileSync(textFile, fullText, "utf-8");

        const cmd = `${getPythonBin()} "${pythonScript}" "${textFile}" "${voice}" "${outputPath}" "${rate}"`;
        try {
          const stdout = execSync(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }).toString();
          result = JSON.parse(stdout);
        } catch (execErr: any) {
          // Try reading output file even if script had stderr
          if (fs.existsSync(outputPath)) {
            try {
              const dur = parseFloat(execSync(
                `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`
              ).toString().trim()) || 0;
              result = { duration: dur, path: outputPath };
            } catch {}
          }
          if (!result) throw new Error(`TTS failed: ${execErr.stderr?.toString() || execErr.message}`);
        } finally {
          try { fs.unlinkSync(textFile); } catch {}
        }
      }

      const stat = fs.statSync(outputPath);
      const audioTrack = {
        url: `/api/projects/${id}/audio/voiceover`,
        filePath: outputPath,
        fileName: `voiceover_tts.mp3`,
        fileSize: stat.size,
        duration: result.duration || 0,
        format: "mp3"
      };

      if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
      (project.settings.audioSettings as any).voiceoverTrack = audioTrack;
      DB.saveProject(project);

      res.json({
        success: true,
        audioTrack,
        usedClonedVoice,
        message: usedClonedVoice
          ? `Voiceover generated (${result.duration?.toFixed(1)}s) using your CLONED voice 🎙️`
          : `Voiceover generated (${result.duration?.toFixed(1)}s) using ${voice}`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- VOICE FEATURES (v13) ---

  // List available edge-tts voices (cached 30 min; static fallback when offline)
  app.get("/api/voices", (req, res) => {
    try {
      const voices = getEdgeVoices();
      res.json({ voices, count: voices.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Preview a voice: generates a short TTS mp3 and returns its URL
  app.post("/api/voices/preview", (req, res) => {
    try {
      const voice = req.body?.voice || "en-US-AriaNeural";
      const rate = req.body?.rate || "+0%";
      const pitch = req.body?.pitch || "+0Hz";
      // v16: language-aware default preview text — Hindi voices get Hindi text, etc.
      const PREVIEW_TEXT_BY_LOCALE: Record<string, string> = {
        "hi": "नमस्ते! यह आपकी आवाज़ का प्रीव्यू है। यह कैसी सुनाई दे रही है?",
        "ur": "سلام! یہ آپ کی آواز کا پریویو ہے۔ یہ کیسی لگ رہی ہے؟",
        "ar": "مرحباً! هذه معاينة صوتك. كيف يبدو؟",
        "tr": "Merhaba! Bu sesinizin önizlemesi. Nasıl geliyor?",
        "en": "Hey there! This is a quick voice preview. How does it sound?",
      };
      const localePrefix = voice.split("-")[0] || "en";
      const defaultText = PREVIEW_TEXT_BY_LOCALE[localePrefix] || DEFAULT_PREVIEW_TEXT;
      const text = (req.body?.text || defaultText).slice(0, 300);
      const previewsDir = path.join(process.cwd(), "storage", "previews");
      fs.mkdirSync(previewsDir, { recursive: true });
      const outPath = path.join(previewsDir, `voice_${Date.now()}_${voice.replace(/[^a-zA-Z0-9]/g, "_")}.mp3`);
      const { duration } = generateTtsClip(text, voice, rate, pitch, outPath);
      res.json({ success: true, url: `/api/voices/preview/${path.basename(outPath)}`, duration, voice, rate, pitch });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve generated voice preview files
  app.get("/api/voices/preview/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(process.cwd(), "storage", "previews", filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Preview not found" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(filePath);
  });

  // Per-scene voiceover: regenerate one scene's narration with its own voice + emotion
  app.post("/api/projects/:id/scenes/:sceneId/tts", async (req, res) => {
    try {
      const { id, sceneId } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const scene = DB.getScenes(id).find((s: any) => s.id === sceneId);
      if (!scene) return res.status(404).json({ error: "Scene not found" });

      const voice = req.body?.voice || scene.voice || project.settings.edgeTtsVoice || "en-US-AriaNeural";
      const emotion = req.body?.emotion || scene.emotion || "neutral";
      const { rate, pitch } = sceneRatePitch(emotion);
      const text = (scene.text || "").trim();
      if (!text) return res.status(400).json({ error: "Scene has no text" });

      const audioDir = path.join(process.cwd(), "storage", "projects", path.basename(id), "audio");
      fs.mkdirSync(audioDir, { recursive: true });
      const outPath = path.join(audioDir, `scene_voice_${scene.sceneIndex}_${voice.replace(/[^a-zA-Z0-9]/g, "_")}_${emotion}.mp3`);
      const { duration } = generateTtsClip(text, voice, rate, pitch, outPath);

      scene.voice = voice;
      scene.emotion = emotion;
      scene.voiceUrl = outPath;
      DB.updateScene(scene);

      res.json({ success: true, sceneId, voice, emotion, rate, pitch, duration, voiceUrl: outPath });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove audio file
  app.delete("/api/projects/:id/audio/:type", (req, res) => {
    try {
      const { id, type } = req.params;
      if (type !== "voiceover" && type !== "bgm") return res.status(400).json({ error: "Invalid type" });
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const safeId = path.basename(id);
      const audioDir = path.join(process.cwd(), "storage", "projects", safeId, "audio");
      if (fs.existsSync(audioDir)) {
        const existing = fs.readdirSync(audioDir).filter(f => f.startsWith(type));
        existing.forEach(f => { try { fs.unlinkSync(path.join(audioDir, f)); } catch {} });
      }
      if (project.settings.audioSettings) {
        delete (project.settings.audioSettings as any)[type === "voiceover" ? "voiceoverTrack" : "bgmTrack"];
        DB.saveProject(project);
      }
      res.json({ success: true, message: `${type} removed` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  
  // Built-in audio library — categories with pre-generated mp3 files
  const BUILTIN_AUDIO_DIR = path.join(process.cwd(), "storage", "audio", "builtin");

  // List built-in BGM categories and tracks
  app.get("/api/audio/builtin/bgm", (req, res) => {
    try {
      const bgmDir = path.join(BUILTIN_AUDIO_DIR, "bgm");
      if (!fs.existsSync(bgmDir)) return res.json([]);

      const categories: Record<string, any[]> = {};
      const files = fs.readdirSync(bgmDir).filter(f => f.endsWith(".mp3"));
      for (const f of files) {
        const match = f.match(/^(.+?)_\d+\.mp3$/);
        const cat = match ? match[1] : "other";
        const filePath = path.join(bgmDir, f);
        const stat = fs.statSync(filePath);
        let duration = 0;
        try {
          duration = parseFloat(execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
          ).toString().trim()) || 0;
        } catch {}
        const url = `/api/audio/builtin/bgm/${f}`;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({ name: f, label: f.replace(/\.mp3$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), size: stat.size, duration, url, filePath });
      }
      res.json(categories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List built-in SFX categories and tracks
  app.get("/api/audio/builtin/sfx", (req, res) => {
    try {
      const sfxDir = path.join(BUILTIN_AUDIO_DIR, "sfx");
      if (!fs.existsSync(sfxDir)) return res.json([]);

      const categories: Record<string, any[]> = {};
      const files = fs.readdirSync(sfxDir).filter(f => f.endsWith(".mp3"));
      for (const f of files) {
        const match = f.match(/^(.+?)_\d+\.mp3$/);
        const cat = match ? match[1] : "other";
        const filePath = path.join(sfxDir, f);
        const stat = fs.statSync(filePath);
        let duration = 0;
        try {
          duration = parseFloat(execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
          ).toString().trim()) || 0;
        } catch {}
        const url = `/api/audio/builtin/sfx/${f}`;
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push({ name: f, label: f.replace(/\.mp3$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), size: stat.size, duration, url, filePath });
      }
      res.json(categories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve built-in audio file
  app.get("/api/audio/builtin/:type/:filename", (req, res) => {
    try {
      const { type, filename } = req.params;
      if (type !== "bgm" && type !== "sfx") {
        return res.status(400).json({ error: 'type must be "bgm" or "sfx"' });
      }
      const safeFilename = path.basename(filename);
      const filePath = path.join(BUILTIN_AUDIO_DIR, type, safeFilename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      const ext = path.extname(safeFilename).toLowerCase();
      const mime = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : "audio/mpeg";
      return res.setHeader("Content-Type", mime).sendFile(filePath);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // v16 FIX: Serve downloaded stock-music files from the shared audio library.
  // The stock download endpoint returns url "/audio/library/<file>" but there was no
  // route serving that path, so it fell through to the SPA HTML fallback and the
  // BGM player got HTML instead of audio (nothing played, BGM never applied).
  app.get("/audio/library/:filename", (req, res) => {
    try {
      const safeFilename = path.basename(req.params.filename);
      const libDir = path.join(process.cwd(), "storage", "audio", "library");
      const filePath = path.join(libDir, safeFilename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Library file not found" });
      }
      const ext = path.extname(safeFilename).toLowerCase();
      const mime = ext === ".wav" ? "audio/wav" : "audio/mpeg";
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(filePath);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Upload custom audio to server library (for future manually added BGM/SFX)
  app.post("/api/audio/upload", async (req, res) => {
    try {
      const { type, fileName } = req.query;
      if (!type || (type !== "bgm" && type !== "sfx")) {
        return res.status(400).json({ error: 'type must be "bgm" or "sfx"' });
      }

      const builtinDir = path.join(BUILTIN_AUDIO_DIR, type);
      fs.mkdirSync(builtinDir, { recursive: true });

      const raw = req.body?.audioData || req.body?.file;
      if (!raw) return res.status(400).json({ error: "No audio data provided" });

      const safeName = (fileName as string || "custom").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
      const uploadName = `${safeName}.mp3`;
      const filePath = path.join(builtinDir, uploadName);
      fs.writeFileSync(filePath, Buffer.from(raw, "base64"));

      res.json({
        success: true,
        filePath,
        url: `/api/audio/builtin/${type}/${uploadName}`,
        fileName: uploadName
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- v13: CUSTOM FONT UPLOAD / LIST / SERVE ---
  app.post("/api/fonts/upload", (req, res) => {
    try {
      const { fontData, fileName } = req.body || {};
      if (!fontData) return res.status(400).json({ error: "No font data provided" });

      const safeName = String(fileName || "custom").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
      const finalName = /\.(ttf|otf|woff|woff2)$/i.test(safeName) ? safeName : `${safeName}.ttf`;

      fs.mkdirSync(FONTS_DIR, { recursive: true });
      const filePath = path.join(FONTS_DIR, finalName);
      fs.writeFileSync(filePath, Buffer.from(fontData, "base64"));

      res.json({ success: true, fileName: finalName, url: `/api/fonts/${finalName}`, filePath });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/fonts", (req, res) => {
    try {
      fs.mkdirSync(FONTS_DIR, { recursive: true });
      const fonts = fs.readdirSync(FONTS_DIR)
        .filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f))
        .map(f => {
          const stat = fs.statSync(path.join(FONTS_DIR, f));
          return { fileName: f, size: stat.size, url: `/api/fonts/${f}` };
        });
      res.json(fonts);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/fonts/:filename", (req, res) => {
    const safeName = (req.params.filename || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = path.join(FONTS_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Font not found" });
    const ext = path.extname(safeName).toLowerCase();
    const mime = ext === ".woff2" ? "font/woff2" : ext === ".woff" ? "font/woff" : ext === ".otf" ? "font/otf" : "font/ttf";
    res.setHeader("Content-Type", mime);
    res.sendFile(filePath);
  });

  // --- v13: WATERMARK / LOGO UPLOAD + LIST + SERVE ---
  app.post("/api/watermarks/upload", (req, res) => {
    try {
      const { fileData, fileName } = req.body || {};
      if (!fileData) return res.status(400).json({ error: "No watermark data provided" });

      const safeName = String(fileName || "watermark").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
      const finalName = /\.(png|jpg|jpeg|webp|svg)$/i.test(safeName) ? safeName : `${safeName}.png`;

      fs.mkdirSync(WATERMARK_DIR, { recursive: true });
      const filePath = path.join(WATERMARK_DIR, finalName);
      fs.writeFileSync(filePath, Buffer.from(fileData, "base64"));

      res.json({ success: true, fileName: finalName, url: `/api/watermarks/${finalName}`, filePath });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/watermarks", (req, res) => {
    try {
      fs.mkdirSync(WATERMARK_DIR, { recursive: true });
      const items = fs.readdirSync(WATERMARK_DIR)
        .filter(f => /\.(png|jpg|jpeg|webp|svg)$/i.test(f))
        .map(f => {
          const stat = fs.statSync(path.join(WATERMARK_DIR, f));
          return { fileName: f, size: stat.size, url: `/api/watermarks/${f}` };
        });
      res.json(items);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/watermarks/:filename", (req, res) => {
    const safeName = (req.params.filename || "").replace(/[^a-zA-Z0-9._-]/g, "");
    const filePath = path.join(WATERMARK_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Watermark not found" });
    const ext = path.extname(safeName).toLowerCase();
    const mime = ext === ".webp" ? "image/webp" : ext === ".svg" ? "image/svg+xml" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(filePath);
  });

  // Get Video Sources Configuration
  app.get("/api/sources", (req, res) => {
    try {
      res.json(DB.getVideoSources());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle Video Source Status
  app.post("/api/sources/:id/toggle", (req, res) => {
    try {
      const { id } = req.params;
      const sources = DB.getVideoSources();
      const target = sources.find(s => s.id === id);
      if (!target) return res.status(404).json({ error: "Source not found" });

      target.enabled = !target.enabled;
      DB.saveVideoSource(target);
      res.json(target);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get and Save global settings
  app.get("/api/settings", (req, res) => {
    try {
      res.json(DB.getDefaultSettings());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings", (req, res) => {
    try {
      const updated = DB.saveDefaultSettings(req.body);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- v16: VOICE CLONING (Colab XTTS-v2 server) ---

  // Test the Colab voice-clone server connection
  app.post("/api/voice-clone/test", async (req, res) => {
    try {
      const url = req.body?.url || getVoiceCloneUrl();
      const result = await testVoiceCloneServer(url);
      res.json({ success: result.ok, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate a short preview clip in the cloned voice
  app.post("/api/voice-clone/preview", async (req, res) => {
    try {
      const url = (req.body?.url || getVoiceCloneUrl()).trim().replace(/\/+$/, "");
      if (!url) return res.status(400).json({ error: "No voice clone URL configured. Paste the Colab tunnel URL in Settings → Voice Cloning." });

      const text = (req.body?.text || "Hello! This is a test of my cloned voice. How does it sound?").trim();
      const language = req.body?.language || detectXttsLanguage(text);

      const audioDir = path.join(process.cwd(), "storage", "audio", "voice-clone");
      fs.mkdirSync(audioDir, { recursive: true });
      const outPath = path.join(audioDir, `preview_${Date.now()}.mp3`);

      // Temporarily use the provided URL for this request
      const settings: any = DB.getDefaultSettings();
      const prevUrl = settings.voiceCloneUrl;
      settings.voiceCloneUrl = url;
      DB.saveDefaultSettings(settings);

      const result = await generateClonedVoice(text, language, outPath);

      // Restore previous URL if it was different
      if (prevUrl !== url) {
        settings.voiceCloneUrl = prevUrl;
        DB.saveDefaultSettings(settings);
      }

      if (!result) return res.status(502).json({ error: "Voice generation failed. Check that the Colab notebook is running and the URL is correct." });

      const stat = fs.statSync(outPath);
      const durOut = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outPath}"`, { timeout: 15000, encoding: "utf-8" });
      const duration = parseFloat((durOut || "0").toString().trim()) || 0;

      res.json({
        success: true,
        audioUrl: `/api/voice-clone/preview-audio/${path.basename(outPath)}`,
        duration,
        fileSize: stat.size,
        message: `Preview generated (${duration.toFixed(1)}s) in language: ${language}`
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve preview audio files
  app.get("/api/voice-clone/preview-audio/:file", (req, res) => {
    try {
      const file = path.basename(req.params.file);
      const filePath = path.join(process.cwd(), "storage", "audio", "voice-clone", file);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Audio not found" });
      res.setHeader("Content-Type", "audio/mpeg");
      res.sendFile(filePath);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Download the Colab notebook for voice cloning
  app.get("/colab/voice_clone_server.ipynb", (req, res) => {
    try {
      const nbPath = path.join(process.cwd(), "colab", "voice_clone_server.ipynb");
      if (!fs.existsSync(nbPath)) return res.status(404).json({ error: "Notebook not found" });
      res.setHeader("Content-Type", "application/x-ipynb+json");
      res.setHeader("Content-Disposition", 'attachment; filename="voice_clone_server.ipynb"');
      res.sendFile(nbPath);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update project settings (transitions, SFX, etc.)
  // v14: Update project fields (script/title) — used by Script Rewriter apply flow
  app.patch("/api/projects/:id", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const { script, title, topic } = req.body || {};
      if (typeof script === "string") project.script = script;
      if (typeof title === "string" && title.trim()) project.title = title.trim();
      if (typeof topic === "string") project.topic = topic;
      project.updatedAt = new Date().toISOString();
      DB.saveProject(project);
      res.json({ success: true, project });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/projects/:id/settings", (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const incoming = req.body || {};
      // Deep-merge audioSettings so a stale/empty audioSettings object from the
      // frontend can never wipe a previously-saved voiceoverTrack/bgmTrack.
      if (incoming.audioSettings !== undefined) {
        const prevAudio = (project.settings as any)?.audioSettings || {};
        const nextAudio = { ...prevAudio, ...incoming.audioSettings };
        // Guard: never drop an existing track reference when the incoming value is empty/undefined
        if (prevAudio.voiceoverTrack && !nextAudio.voiceoverTrack) nextAudio.voiceoverTrack = prevAudio.voiceoverTrack;
        if (prevAudio.bgmTrack && !nextAudio.bgmTrack) nextAudio.bgmTrack = prevAudio.bgmTrack;
        incoming.audioSettings = nextAudio;
      }
      project.settings = { ...project.settings, ...incoming };
      DB.saveProject(project);
      res.json(project.settings);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Trigger Gemini SEO Optimizer
  app.post("/api/projects/:id/seo", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const seo = await AIProviderManager.generateSEO(project.title, project.script || "");
      // Persist SEO metadata on the project so YouTube upload reuses it.
      // generateSEO returns {viralTitle, description, hashtags}; store the normalized shape.
      project.seoTags = { title: seo.viralTitle, description: seo.description, tags: seo.hashtags };
      DB.saveProject(project);
      // Keep the HTTP response in the shape ProjectDetailsView.tsx consumes
      res.json(seo);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // v14: Script Rewriter — rewrite project script in viral style
  app.post("/api/projects/:id/rewrite-script", async (req, res) => {
    try {
      const { id } = req.params;
      const { style } = req.body || {};
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const script = project.script || DB.getScenes(id).map(s => s.text).join("\n\n");
      if (!script.trim()) return res.status(400).json({ error: "No script to rewrite" });
      const validStyles = ["viral", "storytelling", "educational", "dramatic"];
      const rewriteStyle = validStyles.includes(style) ? style : "viral";
      const result = await AIProviderManager.rewriteScript(script, rewriteStyle as any);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Script rewrite failed" });
    }
  });

  // v16: A/B Title Generator — 3 title variants with predicted CTR scores + winner
  app.post("/api/projects/:id/ab-titles", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ success: false, error: "Project not found" });
      const script = project.script || DB.getScenes(id).map(s => s.text).join("\n\n");
      const result = await AIProviderManager.generateABTitles(project.title, script);
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "A/B title generation failed" });
    }
  });

  // v14: Stock Music Search — find royalty-free BGM by mood via yt-dlp YouTube audio search.
  // Pixabay's music page is Cloudflare-protected and their public API has no music endpoint,
  // so we search YouTube for "no copyright" tracks and pull the audio with yt-dlp instead.
  app.get("/api/audio/stock/search", async (req, res) => {
    try {
      const mood = String(req.query.mood || req.query.q || "cinematic").trim();
      const limit = Math.min(parseInt(String(req.query.limit || "6"), 10) || 6, 10);
      // v16: user wants short (1-2 min) copyright-free tracks. Search a wider pool,
      // then filter by duration + copyright-free signals so 4-hour mixes never show up.
      const minDur = parseInt(String(req.query.minDur || "60"), 10) || 60;   // 1 min
      const maxDur = parseInt(String(req.query.maxDur || "150"), 10) || 150; // 2.5 min (slack over 2 min)
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      // Copyright-free signal keywords (title or channel)
      const CF_RE = /no.?copyright|royalty.?free|copyright.?free|\bncs\b|free.?download|no.?dmca|creative.?commons|royalty/i;

      // Run one yt-dlp search and return duration/copyright-filtered candidates.
      const runSearch = async (query: string): Promise<any[]> => {
        let raw = "";
        try {
          const { stdout } = await execFileAsync("yt-dlp", [
            "--flat-playlist", "-J", query,
          ], { encoding: "utf-8", timeout: 90000, maxBuffer: 10 * 1024 * 1024 });
          raw = stdout;
        } catch (e: any) {
          return [];
        }
        let entries: any[] = [];
        try { entries = JSON.parse(raw).entries || []; } catch { entries = []; }
        return entries
          .filter(e => e && e.id)
          .map(e => ({
            id: e.id,
            title: e.title || "Untitled track",
            artist: e.channel || e.uploader || "Unknown",
            duration: e.duration || 0,
            videoUrl: `https://www.youtube.com/watch?v=${e.id}`,
            downloadUrl: `/api/audio/stock/download?id=${e.id}`,
            cf: CF_RE.test(`${e.title || ""} ${e.channel || e.uploader || ""}`) ? 1 : 0,
          }))
          // keep only 1-2.5 min tracks (drop the 4-hour mixes & tiny clips)
          .filter(t => t.duration >= minDur && t.duration <= maxDur);
      };

      // Primary search
      let candidates = await runSearch(`ytsearch25:${mood} no copyright music`);

      // v16 fallback: some moods (chill/lofi/study) return only multi-hour mixes.
      // If we got too few short tracks, retry with "short background music" phrasing.
      if (candidates.length < 2) {
        const fallback = await runSearch(`ytsearch25:${mood} short background music no copyright`);
        // merge, dedupe by id
        const seen = new Set(candidates.map(c => c.id));
        for (const t of fallback) if (!seen.has(t.id)) { candidates.push(t); seen.add(t.id); }
      }

      // Prefer copyright-free-flagged tracks first, then longest-within-range (more usable BGM)
      candidates.sort((a, b) => (b.cf - a.cf) || (b.duration - a.duration));
      const tracks = candidates.slice(0, limit);

      res.json({ success: true, mood, tracks, filtered: true, minDur, maxDur });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Stock music search failed" });
    }
  });

  // v14: Download a stock music track's audio (mp3) into the shared audio library
  app.get("/api/audio/stock/download", async (req, res) => {
    try {
      const id = String(req.query.id || "").trim();
      if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return res.status(400).json({ success: false, error: "Invalid video id" });
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const libDir = path.join(process.cwd(), "storage", "audio", "library");
      fs.mkdirSync(libDir, { recursive: true });
      const outPath = path.join(libDir, `stock_${id}.mp3`);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10240) {
        return res.json({ success: true, filePath: outPath, url: `/audio/library/stock_${id}.mp3`, fileName: `stock_${id}.mp3` });
      }
      try {
        await execFileAsync("yt-dlp", [
          "-f", "bestaudio/best", "-x", "--audio-format", "mp3",
          "-o", outPath, "--no-playlist", "--no-warnings",
          `https://www.youtube.com/watch?v=${id}`,
        ], { encoding: "utf-8", timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
      } catch (e: any) {
        return res.status(502).json({ success: false, error: "Could not download this track. Try another." });
      }
      // yt-dlp -x may append an extension; locate the actual file
      let finalPath = outPath;
      if (!fs.existsSync(finalPath)) {
        const alt = path.join(libDir, `stock_${id}.mp3.mp3`);
        if (fs.existsSync(alt)) { fs.renameSync(alt, outPath); finalPath = outPath; }
      }
      if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 10240) {
        return res.status(502).json({ success: false, error: "Download produced an invalid file. Try another track." });
      }
      res.json({ success: true, filePath: finalPath, url: `/audio/library/stock_${id}.mp3`, fileName: `stock_${id}.mp3` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Stock music download failed" });
    }
  });

  // --- API KEYS MANAGEMENT ENDPOINTS ---
  
  // Get all API Key configs with masked keys
  app.get("/api/keys", (req, res) => {
    try {
      const keys = DB.getApiKeys();
      const sanitizedKeys = keys.map(k => {
        let masked = "";
        if (k.encryptedKey) {
          const decrypted = decrypt(k.encryptedKey);
          if (decrypted) {
            masked = decrypted.length > 8 
              ? `${decrypted.slice(0, 4)}••••••••${decrypted.slice(-4)}`
              : "••••••••";
          }
        }
        return {
          id: k.id,
          name: k.name,
          enabled: k.enabled,
          status: k.status,
          lastTested: k.lastTested,
          errorMessage: k.errorMessage,
          useCount: k.useCount,
          model: k.model,
          hasKey: !!k.encryptedKey,
          maskedKey: masked
        };
      });
      res.json(sanitizedKeys);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Save/Update an API Key
  app.post("/api/keys", (req, res) => {
    try {
      const { id, key, enabled } = req.body;
      if (!id) return res.status(400).json({ error: "Provider ID required" });

      const config = DB.getApiKeyById(id);
      if (!config) return res.status(404).json({ error: "API Key Configuration not found" });

      if (key !== undefined) {
        if (key === "") {
          config.encryptedKey = "";
          config.status = "unconfigured";
          config.errorMessage = "";
        } else {
          // If the key does not contain bullets, update it. If it does, we don't overwrite with masked bullets!
          if (!key.includes("••••")) {
            config.encryptedKey = encrypt(key);
            config.status = "inactive"; // Resets status until tested
            config.errorMessage = "";
          }
        }
      }

      if (req.body.model !== undefined) {
        config.model = req.body.model;
      }

      if (enabled !== undefined) {
        config.enabled = enabled;
        
        // Sync with VideoSources configuration
        const videoSources = DB.getVideoSources();
        const vs = videoSources.find(s => s.id === id);
        if (vs) {
          vs.enabled = enabled;
          vs.apiKeyConfigured = !!config.encryptedKey;
          DB.saveVideoSource(vs);
        }
      }

      DB.saveApiKey(config);
      res.json({ success: true, config });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get AI Provider Configuration and Statistics
  app.get("/api/ai/config", (req, res) => {
    try {
      const systemSettings = DB.getAiSystemSettings();
      const stats = DB.getAiStats();
      res.json({ systemSettings, stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update AI Provider Configuration
  app.post("/api/ai/config", (req, res) => {
    try {
      const { activeMode, smartRouting, defaultProvider } = req.body;
      const settings = DB.getAiSystemSettings();
      
      if (activeMode !== undefined) settings.activeMode = activeMode;
      if (smartRouting !== undefined) settings.smartRouting = smartRouting;
      if (defaultProvider !== undefined) settings.defaultProvider = defaultProvider;

      DB.saveAiSystemSettings(settings);
      res.json({ success: true, settings });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Reset AI Usage Stats
  app.post("/api/ai/stats/reset", (req, res) => {
    try {
      const emptyStats = {
        totalRequests: 0,
        totalSuccess: 0,
        totalFailure: 0,
        providers: {
          gemini: { requests: 0, success: 0, failures: 0 },
          groq: { requests: 0, success: 0, failures: 0 },
          openrouter: { requests: 0, success: 0, failures: 0 },
          nvidia: { requests: 0, success: 0, failures: 0 }
        }
      };
      DB.saveAiStats(emptyStats);
      res.json({ success: true, stats: emptyStats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Toggle API Provider status
  app.post("/api/keys/:id/toggle", (req, res) => {
    try {
      const { id } = req.params;
      const config = DB.getApiKeyById(id);
      if (!config) return res.status(404).json({ error: "API Key Configuration not found" });

      config.enabled = !config.enabled;

      // Sync with VideoSources configuration
      const videoSources = DB.getVideoSources();
      const vs = videoSources.find(s => s.id === id);
      if (vs) {
        vs.enabled = config.enabled;
        vs.apiKeyConfigured = !!config.encryptedKey;
        DB.saveVideoSource(vs);
      }

      DB.saveApiKey(config);
      res.json(config);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Test API Key connection
  app.post("/api/keys/:id/test", async (req, res) => {
    try {
      const { id } = req.params;
      const config = DB.getApiKeyById(id);
      if (!config) return res.status(404).json({ error: "API Key Configuration not found" });

      if (!config.encryptedKey) {
        config.status = "unconfigured";
        config.errorMessage = "Please enter an API Key first before testing.";
        DB.saveApiKey(config);
        return res.json({ success: false, status: config.status, error: config.errorMessage });
      }

      const decryptedKey = decrypt(config.encryptedKey);
      if (!decryptedKey) {
        config.status = "error";
        config.errorMessage = "Could not decrypt saved API Key.";
        DB.saveApiKey(config);
        return res.json({ success: false, status: config.status, error: config.errorMessage });
      }

      let testSuccess = false;
      let testError = "";

      if (id === "gemini") {
        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({
            apiKey: decryptedKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
          });
          const response = await ai.models.generateContent({
            model: "gemini-3.5-flash-lite",
            contents: "Test connection. Reply with exactly 'OK'.",
            config: { maxOutputTokens: 5 }
          });
          if (response.text) {
            testSuccess = true;
          } else {
            testError = "Empty response received from Gemini API.";
          }
        } catch (err: any) {
          testError = err.message || "Gemini API test failed.";
        }
      } else if (id === "groq") {
        try {
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${decryptedKey}`
            },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 5
            })
          });
          if (response.ok) {
            testSuccess = true;
          } else {
            const errText = await response.text();
            testError = `Groq API responded with status ${response.status}: ${errText.slice(0, 100)}`;
          }
        } catch (err: any) {
          testError = err.message || "Groq API test request failed.";
        }
      } else if (id === "openrouter") {
        try {
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${decryptedKey}`,
              "HTTP-Referer": "https://ai.studio/build",
              "X-Title": "AI Shorts Video Creator"
            },
            body: JSON.stringify({
              model: "meta-llama/llama-3.3-70b-instruct",
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 5
            })
          });
          if (response.ok) {
            testSuccess = true;
          } else {
            const errText = await response.text();
            testError = `OpenRouter API responded with status ${response.status}: ${errText.slice(0, 100)}`;
          }
        } catch (err: any) {
          testError = err.message || "OpenRouter API test request failed.";
        }
      } else if (id === "pexels") {
        try {
          const response = await fetch("https://api.pexels.com/v1/search?query=nature&per_page=1", {
            headers: { "Authorization": decryptedKey }
          });
          if (response.ok) {
            testSuccess = true;
          } else {
            const errText = await response.text();
            testError = `Pexels API responded with status ${response.status}: ${errText.slice(0, 100)}`;
          }
        } catch (err: any) {
          testError = err.message || "Pexels API test request failed.";
        }
      } else if (id === "pixabay") {
        try {
          const response = await fetch(`https://pixabay.com/api/videos/?key=${decryptedKey}&q=nature&per_page=3`);
          if (response.ok) {
            const data: any = await response.json();
            if (data && data.hits !== undefined) {
              testSuccess = true;
            } else if (data && data.error) {
              testError = `Pixabay error: ${data.error}`;
            } else {
              testError = "Invalid response format from Pixabay API.";
            }
          } else {
            testError = `Pixabay API responded with status ${response.status}`;
          }
        } catch (err: any) {
          testError = err.message || "Pixabay API test request failed.";
        }
      } else if (id === "nvidia") {
        try {
          const model = config.model || "nvidia/llama-3.1-nemotron-70b-instruct";
          const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${decryptedKey}`
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 5
            })
          });
          if (response.ok) {
            testSuccess = true;
          } else {
            const errText = await response.text();
            testError = `NVIDIA API responded with status ${response.status}: ${errText.slice(0, 100)}`;
          }
        } catch (err: any) {
          testError = err.message || "NVIDIA API test request failed.";
        }
      } else {
        testError = "Unsupported provider for direct API testing.";
      }

      config.lastTested = new Date().toISOString();
      if (testSuccess) {
        config.status = "active";
        config.errorMessage = "";
      } else {
        config.status = "error";
        config.errorMessage = testError;
      }

      DB.saveApiKey(config);
      res.json({
        success: testSuccess,
        status: config.status,
        errorMessage: config.errorMessage,
        lastTested: config.lastTested
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Batch render queue API ──────────────────────────────────────────
  app.post("/api/batch/render", (req, res) => {
    try {
      const { projectIds } = req.body || {};
      if (!Array.isArray(projectIds) || projectIds.length === 0) {
        return res.status(400).json({ error: "projectIds must be a non-empty array" });
      }
      const missing = projectIds.filter(id => !DB.getProjectById(id));
      if (missing.length > 0) {
        return res.status(404).json({ error: `Projects not found: ${missing.join(", ")}` });
      }
      const status = renderQueue.enqueue(projectIds);
      res.json({ success: true, ...status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/batch/status", (req, res) => {
    try {
      res.json(renderQueue.status());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/batch/stop", (req, res) => {
    try {
      res.json({ success: true, ...renderQueue.stop() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/batch/clear", (req, res) => {
    try {
      res.json({ success: true, ...renderQueue.clearFinished() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== AUTOPILOT ROUTES ==========

  // Get autopilot config + queue + status
  app.get("/api/autopilot", async (req, res) => {
    try {
      const cfg = Autopilot.getConfig();
      const queue = Autopilot.getQueue();
      let accounts: any[] = [];
      try { accounts = await listAccounts(); } catch {}
      res.json({
        config: cfg,
        queue,
        processing: Autopilot.isProcessing(),
        accounts
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Save autopilot config
  app.post("/api/autopilot/config", (req, res) => {
    try {
      const cfg = Autopilot.saveConfig(req.body || {});
      res.json({ success: true, config: cfg });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Add topics to the queue
  app.post("/api/autopilot/queue", (req, res) => {
    try {
      const { topics } = req.body || {};
      if (!Array.isArray(topics) || !topics.length) {
        return res.status(400).json({ error: "topics array is required" });
      }
      const added = Autopilot.addToQueue(topics);
      res.json({ success: true, added, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove a queue item
  app.delete("/api/autopilot/queue/:id", (req, res) => {
    try {
      const ok = Autopilot.removeFromQueue(req.params.id);
      res.json({ success: ok, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Approve a rendered item (moves it back to pending for scheduling)
  app.post("/api/autopilot/queue/:id/approve", async (req, res) => {
    try {
      const item = Autopilot.approveItem(req.params.id);
      if (!item) return res.status(404).json({ error: "Queue item not found" });
      // Immediately schedule it for the next best slot.
      const scheduled = await Autopilot.scheduleItem(req.params.id);
      res.json({ success: true, item: scheduled || item, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate AI title options for a queue item's topic
  app.post("/api/autopilot/queue/:id/titles", async (req, res) => {
    try {
      const count = Math.min(Number(req.body?.count) || 4, 8);
      const result = await Autopilot.generateTitlesForItem(req.params.id, count);
      if (!result) return res.status(404).json({ error: "Queue item not found" });
      res.json({ success: true, titles: result.titles, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set the user-selected title for a queue item (empty title clears it)
  app.post("/api/autopilot/queue/:id/select-title", (req, res) => {
    try {
      const item = Autopilot.selectTitleForItem(req.params.id, req.body?.title || "");
      if (!item) return res.status(404).json({ error: "Queue item not found" });
      res.json({ success: true, item, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Re-schedule a scheduled/rendered item to a specific date/time
  // (date: YYYY-MM-DD, time: HH:mm IST — both optional, "" = auto)
  app.post("/api/autopilot/queue/:id/reschedule", async (req, res) => {
    try {
      const item = await Autopilot.rescheduleItem(req.params.id, req.body?.date || "", req.body?.time || "");
      if (!item) return res.status(404).json({ error: "Queue item not found or not schedulable" });
      res.json({ success: true, item, queue: Autopilot.getQueue() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // === Autopilot BGM: upload / list / serve / delete (mirrors main-project audio upload) ===
  const AUTOPILOT_BGM_DIR = path.join(process.cwd(), "storage", "audio", "autopilot");

  // List all BGM available to Autopilot: built-in + user-uploaded (flat array)
  app.get("/api/autopilot/bgm", (req, res) => {
    try {
      const tracks: any[] = [];
      const scan = (dir: string, source: string) => {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir).filter(x => /\.(mp3|wav)$/i.test(x))) {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          let duration = 0;
          try {
            duration = parseFloat(execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
            ).toString().trim()) || 0;
          } catch {}
          tracks.push({
            name: f,
            label: f.replace(/\.(mp3|wav)$/i, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            url: source === "builtin" ? `/api/audio/builtin/bgm/${f}` : `/api/autopilot/bgm/file/${f}`,
            filePath,
            duration,
            size: stat.size,
            source
          });
        }
      };
      scan(path.join(process.cwd(), "storage", "audio", "builtin", "bgm"), "builtin");
      scan(AUTOPILOT_BGM_DIR, "uploaded");
      res.json({ success: true, tracks });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve an uploaded autopilot BGM file
  app.get("/api/autopilot/bgm/file/:filename", (req, res) => {
    try {
      const safe = path.basename(req.params.filename);
      const filePath = path.join(AUTOPILOT_BGM_DIR, safe);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
      const mime = filePath.toLowerCase().endsWith(".wav") ? "audio/wav" : "audio/mpeg";
      res.setHeader("Content-Type", mime).sendFile(filePath);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Upload a new BGM track for Autopilot (base64 audio, same shape as main project)
  app.post("/api/autopilot/bgm/upload", (req, res) => {
    try {
      const raw = req.body?.audioData || req.body?.file;
      if (!raw || typeof raw !== "string") return res.status(400).json({ error: "No audio data provided" });
      const ext = req.body?.format === "wav" ? ".wav" : ".mp3";
      const baseName = (req.body?.name || "custom").toString().replace(/[^\w\- ]/g, "").trim() || "custom";
      fs.mkdirSync(AUTOPILOT_BGM_DIR, { recursive: true });
      const fileName = `${baseName}_${Date.now()}${ext}`;
      const filePath = path.join(AUTOPILOT_BGM_DIR, fileName);
      if (raw.includes("base64,")) {
        fs.writeFileSync(filePath, Buffer.from(raw.split("base64,")[1], "base64"));
      } else {
        fs.writeFileSync(filePath, Buffer.from(raw, "base64"));
      }
      // Validate with ffprobe before accepting
      try {
        const probeOut = execSync(
          `ffprobe -v error -show_entries format=duration,size -of json "${filePath}"`
        ).toString();
        const info = JSON.parse(probeOut);
        const duration = parseFloat(info.format?.duration || "0");
        const fileSize = parseInt(info.format?.size || "0");
        if (duration <= 0 || fileSize <= 0) throw new Error("Invalid or corrupted audio file");
        res.json({
          success: true,
          track: {
            name: fileName,
            label: fileName.replace(/\.(mp3|wav)$/i, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            url: `/api/autopilot/bgm/file/${fileName}`,
            filePath,
            duration,
            size: fileSize,
            source: "uploaded"
          }
        });
      } catch (probeErr: any) {
        try { fs.unlinkSync(filePath); } catch {}
        res.status(400).json({ error: `Audio validation failed: ${probeErr.message}` });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Delete an uploaded autopilot BGM track (built-in tracks are protected)
  app.delete("/api/autopilot/bgm/:filename", (req, res) => {
    try {
      const safe = path.basename(req.params.filename);
      const filePath = path.join(AUTOPILOT_BGM_DIR, safe);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate topics from a category (preview, does not auto-queue)
  app.post("/api/autopilot/generate-topics", async (req, res) => {
    try {
      const { category, count } = req.body || {};
      if (!category || typeof category !== "string") {
        return res.status(400).json({ error: "category is required" });
      }
      const topics = await Autopilot.generateTopicsFromCategory(category.trim(), Math.min(Number(count) || 5, 10));
      res.json({ success: true, topics });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Trigger one processing cycle manually (run next pending item now).
  // Also turns the Autopilot engine ON so it keeps running afterwards.
  app.post("/api/autopilot/run", async (req, res) => {
    try {
      const cfg = Autopilot.getConfig();
      if (!cfg.enabled) Autopilot.saveConfig({ enabled: true });
      const id = await Autopilot.processNext();
      res.json({ success: true, processedId: id, queue: Autopilot.getQueue(), config: Autopilot.getConfig() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== YOUTUBE UPLOAD ROUTES ==========

  // Check YouTube auth status (OAuth + cookies)
  app.get("/api/youtube/status", (req, res) => {
    const tokens = loadYoutubeToken();
    res.json({
      authenticated: !!tokens?.access_token,
      hasRefreshToken: !!tokens?.refresh_token,
      hasCookies: hasValidCookies(),
      oauthConfigured: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET)
    });
  });

  // ===== Multi-channel account routes =====
  // List all connected YouTube channels (no tokens exposed)
  app.get("/api/youtube/accounts", async (req, res) => {
    try {
      const accounts = await listAccounts();
      res.json({ accounts });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Remove a connected channel
  app.delete("/api/youtube/accounts/:accountId", async (req, res) => {
    try {
      const removed = await removeAccount(req.params.accountId);
      res.json({ success: removed });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Set the default channel for uploads
  app.post("/api/youtube/accounts/:accountId/default", async (req, res) => {
    try {
      const ok = await setDefaultAccount(req.params.accountId);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Check cookies status (real validation — tests against YouTube API)
  app.get("/api/youtube/cookies-status", async (req, res) => {
    try {
      if (!hasValidCookies()) return res.json({ valid: false, message: "No cookies file or SAPISID missing" });
      const result = await verifyCookies();
      res.json(result);
    } catch {
      res.json({ valid: false, message: "Verification failed" });
    }
  });

  // Upload cookies.txt
  app.post("/api/youtube/cookies", express.text({ type: "text/plain" }), async (req, res) => {
    try {
      const content = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "No cookies content provided" });
      }
      saveCookies(content);
      const result = await verifyCookies();
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Export cookies via yt-dlp (gets ALL cookies including Secure ones)
  app.post("/api/youtube/export-cookies", async (req, res) => {
    const { browser } = req.body || {};
    const browserName = browser || "firefox";
    try {
      const cookiesPath = path.join(process.cwd(), "data", "youtube-cookies.txt");
      const cmd = `yt-dlp --cookies-from-browser ${browserName} --cookies "${cookiesPath}" --skip-download "https://www.youtube.com" 2>&1`;
      execSync(cmd, { timeout: 30000 }).toString();
      const result = await verifyCookies();
      res.json({ success: true, ...result, browser: browserName });
    } catch (e: any) {
      const msg = e.message?.slice(0, 300) || "";
      if (e.code === "ENOENT") {
        res.status(500).json({ error: `yt-dlp not found. Install: pip install yt-dlp`, details: msg });
      } else if (msg.includes("not found") || msg.includes("No such") || msg.includes("database") || msg.includes("cookies")) {
        res.status(500).json({ error: `${browser} profile not accessible on Android. Use Kiwi Browser to export cookies or upload manually.` });
      } else {
        res.status(500).json({ error: `Export failed: ${msg}` });
      }
    }
  });

  // Redirect to Google OAuth consent screen
  app.get("/api/youtube/auth", (req, res) => {
    const url = getYoutubeAuthUrl(req);
    res.redirect(url);
  });

  // OAuth callback - save tokens
  app.get("/api/youtube/callback", async (req, res) => {
    try {
      const { code } = req.query;
      if (!code) return res.status(400).send("Missing authorization code");
      // Use dynamic callback URL for token exchange
      const client = getOAuthClient(req);
      const { tokens } = await client.getToken(code as string);
      saveYoutubeToken(tokens); // legacy single-token (kept for backward compat)
      // Multi-channel: upsert into accounts store keyed by channelId
      const account = await upsertAccountFromTokens(tokens);
      // Redirect back to app (using same host + protocol as request — tunnel is HTTPS)
      const host = (req.headers?.host || `localhost:${PORT}`).replace("0.0.0.0", "localhost");
      const fwdProto = req.headers?.["x-forwarded-proto"];
      const proto = fwdProto ? String(fwdProto).split(",")[0].trim() : (req.secure ? "https" : "http");
      res.redirect(`${proto}://${host}/?youtube=connected&channel=${encodeURIComponent(account.channelTitle)}`);
    } catch (e: any) {
      res.status(500).send(`OAuth error: ${e.message}`);
    }
  });

  // Upload rendered video to YouTube
  app.post("/api/youtube/upload/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const renderedPath = path.join(process.cwd(), "storage", "projects", id, "renders", `${id}_final.mp4`);
      if (!fs.existsSync(renderedPath)) {
        return res.status(400).json({ error: "No rendered video found. Render first." });
      }

      // Build title/description/tags — prefer saved SEO, else auto-generate when enabled
      let title = project.title || "YouTube Shorts";
      let description = "Created with AI Shorts Generator\n\n#shorts #ai";
      let tags: string[] = ["shorts", "ai", "shortsvideo"];
      let seo: { title?: string; description?: string; tags?: string[] } | undefined = project.seoTags;
      if (!seo && project.settings.autoHashtags !== false) {
        try {
          const generated = await AIProviderManager.generateSEO(project.title, project.script || "");
          seo = { title: generated.viralTitle, description: generated.description, tags: generated.hashtags };
          project.seoTags = { title: generated.viralTitle, description: generated.description, tags: generated.hashtags };
          DB.saveProject(project);
        } catch (seoErr: any) {
          console.log("SEO generation failed, using defaults:", seoErr.message?.slice(0, 100));
        }
      }
      if (seo) {
        title = seo.title || title;
        description = seo.description || description;
        if (seo.tags?.length) tags = seo.tags;
      }
      const scenes = DB.getScenes(id);
      if (scenes.length > 0 && (scenes[0] as any).hook) {
        title = `${(scenes[0] as any).hook} - ${title}`;
      }

      // Method 1: OAuth-based upload (official YouTube Data API v3 — most reliable).
      // Preferred over cookies: the cookies/InnerTube path accepts the video bytes
      // (STATUS_SUCCESS) but often never actually creates the video entity.
      // Multi-channel: pick the requested account (or the default connected one).
      const requestedAccountId = (req.body && req.body.accountId) || (req.query.accountId as string) || null;
      const account = requestedAccountId ? await getAccount(requestedAccountId) : await getDefaultAccount();
      const tokens = account?.tokens || loadYoutubeToken();
      if (tokens?.access_token) {
        try {
          const youtubeOAuth2Client = getOAuthClient(req);
          youtubeOAuth2Client.setCredentials(tokens);
          const youtube = google.youtube({ version: "v3", auth: youtubeOAuth2Client });
          const uploadRes = await youtube.videos.insert({
            part: ["snippet", "status"],
            requestBody: {
              snippet: {
                title: title.slice(0, 100),
                description: description.slice(0, 5000),
                tags: tags.slice(0, 25),
                categoryId: "22"
              },
              status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
            },
            media: { body: fs.createReadStream(renderedPath) }
          } as any);
          const videoId = uploadRes.data.id;
          return res.json({ success: true, videoId, url: `https://youtu.be/${videoId}`, title: title.slice(0, 100), method: "oauth", channel: account?.channelTitle });
        } catch (oauthErr: any) {
          const msg = String(oauthErr.message || "");
          console.log("OAuth upload failed:", msg.slice(0, 150));
          if (msg.includes("401") || /token/i.test(msg) || /invalid_grant/i.test(msg)) {
            const refreshed = account ? await refreshAccountToken(account) : await refreshYoutubeToken();
            if (refreshed) return res.status(503).json({ error: "YouTube token refreshed. Tap Upload again.", retry: true });
            return res.status(401).json({ error: "YouTube connection expired. Tap 'Connect YouTube' to reconnect.", authUrl: getYoutubeAuthUrl(req) });
          }
          // Non-auth OAuth error (quota, etc.) — fall through to cookies as last resort
        }
      }

      // Method 2: Cookies-based upload (fallback when OAuth is not connected)
      if (hasValidCookies()) {
        try {
          const result = await uploadVideo(id, title.slice(0, 100), description.slice(0, 5000), tags.slice(0, 25));
          if (result.uploadedWithoutId) {
            // Video reached YouTube but the ID couldn't be recovered — honest success.
            return res.json({ success: true, videoId: null, url: null, title: title.slice(0, 100), method: "cookies", note: "Video uploaded to YouTube. Check YouTube Studio for the link." });
          }
          return res.json({ success: true, videoId: result.videoId, url: `https://youtu.be/${result.videoId}`, title: title.slice(0, 100), method: "cookies" });
        } catch (cookieErr: any) {
          console.log("Cookies upload failed too:", cookieErr.message?.slice(0, 100));
        }
      }

      return res.status(401).json({ error: "No YouTube auth available. Connect YouTube (OAuth) in Settings, or upload cookies." });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Upload failed" });
    }
  });

  // ========== SCHEDULED UPLOAD ROUTES ==========

  // Schedule a video for later upload.
  // `scheduledAt` may arrive as either a naive "YYYY-MM-DDTHH:mm" (interpreted
  // as Indian Standard Time, since the whole process runs with TZ=Asia/Kolkata)
  // or a full ISO string. We normalise to a UTC ISO string for storage.
  app.post("/api/youtube/schedule/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { scheduledAt } = req.body;
      if (!scheduledAt) return res.status(400).json({ error: "Missing scheduledAt (ISO date string)" });

      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const renderedPath = path.join(process.cwd(), "storage", "projects", id, "renders", `${id}_final.mp4`);
      if (!fs.existsSync(renderedPath)) {
        return res.status(400).json({ error: "No rendered video found. Render first." });
      }

      // Naive date-time => IST local; full ISO => parsed as-is. Store UTC.
      const dt = new Date(scheduledAt);
      if (isNaN(dt.getTime())) return res.status(400).json({ error: "Invalid scheduledAt date" });
      const iso = dt.toISOString();

      (project as any).scheduledAt = iso;
      (project as any).uploadScheduleStatus = "pending";
      DB.saveProject(project);

      const istLabel = dt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
      res.json({ success: true, scheduledAt: iso, message: `Upload scheduled for ${istLabel} IST` });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Cancel scheduled upload
  app.post("/api/youtube/schedule/:id/cancel", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      (project as any).scheduledAt = undefined;
      (project as any).uploadScheduleStatus = undefined;
      DB.saveProject(project);
      res.json({ success: true, message: "Schedule cancelled" });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- VITE DEV AND PROD MIDDLEWARES ---
  const isProduction = process.env.NODE_ENV === "production" || process.argv[1]?.endsWith("server.cjs");

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
  }

  // Background scheduler: check every 60s for pending uploads
  const scheduleInterval = setInterval(async () => {
    try {
      const projects = DB.getProjects().filter((p: any) => {
        if (!p.scheduledAt || p.uploadScheduleStatus !== "pending") return false;
        return new Date(p.scheduledAt) <= new Date();
      });
      for (const project of projects) {
        const id = project.id;
        console.log(`[Scheduler] Auto-uploading scheduled video: ${project.title} (${id})`);

        (project as any).uploadScheduleStatus = "uploading";
        DB.saveProject(project);

        try {
          const renderedPath = path.join(process.cwd(), "storage", "projects", id, "renders", `${id}_final.mp4`);
          if (!fs.existsSync(renderedPath)) {
            console.log(`[Scheduler] Rendered file missing for ${id}, skipping`);
            (project as any).uploadScheduleStatus = "failed";
            DB.saveProject(project);
            continue;
          }

          // Try OAuth method first (official API — most reliable)
          // Multi-channel: use the project's target account (autopilot) or the default.
          let uploaded = false;
          try {
            const targetAccountId = (project as any).autopilotAccountId;
            const schedAccount = (targetAccountId ? await getAccount(targetAccountId) : null) || await getDefaultAccount();
            const tokens = schedAccount?.tokens || loadYoutubeToken();
            if (tokens?.access_token) {
              const youtubeOAuth2Client = getOAuthClient();
              youtubeOAuth2Client.setCredentials(tokens);
              const youtube = google.youtube({ version: "v3", auth: youtubeOAuth2Client });
              const seo = (project as any).seoTags || {};
              const title = (seo.title || project.title || "YouTube Shorts").slice(0, 100);
              const uploadRes = await youtube.videos.insert({
                part: ["snippet", "status"],
                requestBody: {
                  snippet: { title, description: (seo.description || "").slice(0, 5000), tags: (seo.tags || []).slice(0, 25), categoryId: "22" },
                  status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
                },
                media: { body: fs.createReadStream(renderedPath) }
              } as any);
              console.log(`[Scheduler] Uploaded via OAuth (${schedAccount?.channelTitle || "default"}): ${uploadRes.data.id}`);
              uploaded = true;
            }
          } catch (oauthErr: any) {
            console.log(`[Scheduler] OAuth method failed: ${oauthErr.message?.slice(0, 100)}`);
          }

          // Fallback to cookies method
          if (!uploaded && hasValidCookies()) {
            try {
              const seo = (project as any).seoTags || {};
              const vidTitle = (seo.title || project.title || "YouTube Shorts").slice(0, 100);
              const vidDesc = (seo.description || "Created with AI Shorts Generator").slice(0, 5000);
              const vidTags = (seo.tags || ["shorts", "ai"]).slice(0, 25);
              const result = await uploadVideo(id, vidTitle, vidDesc, vidTags);
              console.log(`[Scheduler] Uploaded via cookies: ${result.videoId || "(no id recovered)"}`);
              uploaded = true;
            } catch (cErr: any) {
              console.log(`[Scheduler] Cookies failed: ${cErr.message?.slice(0, 100)}`);
            }
          }

          (project as any).uploadScheduleStatus = uploaded ? "done" : "failed";
          // If this project came from the autopilot engine, sync its queue item status.
          if (uploaded) {
            try {
              const apQueue = Autopilot.getQueue();
              const apItem = apQueue.find(i => i.projectId === id);
              if (apItem && apItem.status === "scheduled") {
                Autopilot.markUploaded(apItem.id);
              }
            } catch {}
          }
        } catch (err: any) {
          console.log(`[Scheduler] Upload error for ${id}: ${err.message?.slice(0, 100)}`);
          (project as any).uploadScheduleStatus = "failed";
        }
        DB.saveProject(project);
      }
    } catch (e: any) {
      // silent
    }
  }, 60_000);

  // Background autopilot engine: every 90s, top up the queue from topics/category
  // and process the next item (script -> voice -> BGM -> render -> schedule).
  const autopilotInterval = setInterval(() => {
    void Autopilot.tick();
  }, 90_000);
  // Kick one cycle shortly after boot so a restart doesn't stall pending work.
  setTimeout(() => { void Autopilot.tick(); }, 15_000);

  // ===== Trend Intelligence =====
  app.get("/api/trends/categories", (req, res) => {
    res.json({ success: true, categories: TrendsService.getCategories() });
  });

  app.get("/api/trends/trending", async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit || "24"), 10) || 24, 40);
      const category = String(req.query.category || "all");
      const platform = String(req.query.platform || "tiktok");
      const data = platform === "youtube"
        ? await TrendsService.getYoutubeTrending(limit, category)
        : await TrendsService.getTrending(limit, category);
      res.json({ success: true, platform, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Failed to load trending feed" });
    }
  });

  app.post("/api/trends/competitor", async (req, res) => {
    try {
      const { username } = req.body || {};
      if (!username || typeof username !== "string") {
        return res.status(400).json({ success: false, message: "TikTok username is required" });
      }
      const data = await TrendsService.analyzeCompetitor(username);
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Competitor analysis failed" });
    }
  });

  app.post("/api/trends/hashtags", async (req, res) => {
    try {
      const { topic, platform } = req.body || {};
      if (!topic || typeof topic !== "string") {
        return res.status(400).json({ success: false, message: "Topic is required" });
      }
      const data = await TrendsService.generateHashtags(topic, platform || "TikTok");
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Hashtag generation failed" });
    }
  });

  app.post("/api/trends/posting-time", async (req, res) => {
    try {
      const { niche, platform, region } = req.body || {};
      if (!niche || typeof niche !== "string") {
        return res.status(400).json({ success: false, message: "Niche is required" });
      }
      const data = await TrendsService.predictPostingTime(niche, platform || "TikTok", region || "Global");
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Posting time prediction failed" });
    }
  });

  // === v15: Competitor Script Reverse-Engineering ===
  app.post("/api/trends/reverse-engineer", async (req, res) => {
    try {
      const { url, style } = req.body || {};
      if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) {
        return res.status(400).json({ success: false, message: "A valid video URL is required" });
      }
      const data = await TrendsService.reverseEngineerVideo(url, style || "viral");
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Reverse-engineering failed" });
    }
  });

  // === v15: Niche Finder ===
  app.post("/api/trends/niche-finder", async (req, res) => {
    try {
      const { interest } = req.body || {};
      if (!interest || typeof interest !== "string") {
        return res.status(400).json({ success: false, message: "Interest area is required" });
      }
      const data = await TrendsService.findNiches(interest.trim());
      res.json({ success: true, ...data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Niche analysis failed" });
    }
  });

  // === v15: Trend Alerts — rules CRUD ===
  app.get("/api/trends/alerts/rules", (req, res) => {
    res.json({ success: true, rules: DB.getTrendAlertRules() });
  });

  app.post("/api/trends/alerts/rules", (req, res) => {
    try {
      const { keyword, platform, minViews } = req.body || {};
      if (!keyword || typeof keyword !== "string") {
        return res.status(400).json({ success: false, message: "Keyword is required" });
      }
      const rule = DB.saveTrendAlertRule({
        id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        keyword: keyword.trim(),
        platform: platform === "youtube" ? "youtube" : "tiktok",
        minViews: typeof minViews === "number" ? minViews : 0,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      res.json({ success: true, rule });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message });
    }
  });

  app.patch("/api/trends/alerts/rules/:id", (req, res) => {
    const rule = DB.getTrendAlertRules().find(r => r.id === req.params.id);
    if (!rule) return res.status(404).json({ success: false, message: "Rule not found" });
    if (typeof req.body?.enabled === "boolean") rule.enabled = req.body.enabled;
    if (typeof req.body?.minViews === "number") rule.minViews = req.body.minViews;
    if (typeof req.body?.keyword === "string" && req.body.keyword.trim()) rule.keyword = req.body.keyword.trim();
    res.json({ success: true, rule: DB.saveTrendAlertRule(rule) });
  });

  app.delete("/api/trends/alerts/rules/:id", (req, res) => {
    DB.deleteTrendAlertRule(req.params.id);
    res.json({ success: true });
  });

  // === v15: Trend Alerts — notifications ===
  app.get("/api/trends/alerts/notifications", (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit)) || 50, 200);
    const notifications = DB.getTrendAlertNotifications(limit);
    res.json({ success: true, notifications, unread: notifications.filter(n => !n.read).length });
  });

  app.post("/api/trends/alerts/notifications/:id/read", (req, res) => {
    DB.markTrendAlertRead(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/trends/alerts/notifications/read-all", (req, res) => {
    DB.markAllTrendAlertsRead();
    res.json({ success: true });
  });

  app.delete("/api/trends/alerts/notifications", (req, res) => {
    DB.clearTrendAlertNotifications();
    res.json({ success: true });
  });

  // Manual "check now" trigger
  app.post("/api/trends/alerts/check", async (req, res) => {
    try {
      const result = await TrendsService.checkTrendAlerts();
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || "Alert check failed" });
    }
  });

  // v15: Background trend-alert watcher — every 30 minutes
  const trendAlertInterval = setInterval(async () => {
    try {
      const rules = DB.getTrendAlertRules().filter(r => r.enabled);
      if (rules.length === 0) return;
      const result = await TrendsService.checkTrendAlerts();
      if (result.newAlerts > 0) {
        console.log(`[TrendAlerts] ${result.newAlerts} new trend alert(s) detected`);
      }
    } catch (e: any) {
      console.error("[TrendAlerts] Scheduled check failed:", e?.message?.slice(0, 120));
    }
  }, 30 * 60 * 1000);

  // SPA fallback — must come after all API routes
  app.get("*", (req, res) => {
    res.sendFile(path.join(process.cwd(), "dist", "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server listening on http://0.0.0.0:${PORT}`);
  });

  // Graceful shutdown: stop scheduler, allow ffmpeg to finish
  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());

  function shutdown() {
    console.log("[SERVER] Shutting down gracefully...");
    clearInterval(scheduleInterval);
    clearInterval(trendAlertInterval);
    // Give ffmpeg a moment to finish current operation
    setTimeout(() => process.exit(0), 3000).unref();
  }
}

startServer().catch(err => {
  console.error("Express startup crash:", err);
});
