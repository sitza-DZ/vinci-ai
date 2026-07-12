import express from "express";
import path from "path";
import fs from "fs";
import { DB } from "./server/db";
import { encrypt, decrypt } from "./server/crypto";
import { GeminiService } from "./server/gemini";
import { AIProviderManager } from "./server/aiManager";
import { ProviderManagerService } from "./server/providers";
import { FFmpegService } from "./server/ffmpeg";
import { hasValidCookies, saveCookies, uploadVideo } from "./server/yt-cookies-upload";
import { Project, ProjectStatus, SubtitleStyleType, UserSettings, ProcessingJob, DeleteLog, AISystemSettings } from "./src/types";
import "dotenv/config";

// YouTube OAuth2 setup
import { google } from "googleapis";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parsers
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // --- API ENDPOINTS ---

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
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
          hook: sceneData.hook || sceneData.text.split(" ").slice(0, 3).join(" ") + "...",
          visualDescription: sceneData.visualDescription,
          keywords: sceneData.keywords,
          selectedVideoUrl: bestClip?.url || "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4",
          selectedVideoId: bestClip?.id || "space_stars_1",
          selectedVideoProvider: bestClip?.provider || "pexels",
          selectedVideoDuration: bestClip?.duration || 15,
          selectedVideoPreviewUrl: bestClip?.previewUrl || "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
          duration: sceneData.duration || 5
        });

        // Track used clip to prevent reuse across scenes
        if (bestClip?.id) usedClipIds.add(bestClip.id);
      }

      // Apply smart scene distribution if enabled
      if (project.settings.smartSceneDistribution && scenesList.length >= 6) {
        const firstFastCount = 4;
        const fastDuration = 3;
        const slowDuration = scenesList.length <= 14 ? 5 : 6;
        for (let i = 0; i < scenesList.length; i++) {
          scenesList[i].duration = i < firstFastCount ? fastDuration : slowDuration;
        }
      }

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
          hook: sceneData.hook || sceneData.text.split(" ").slice(0, 3).join(" ") + "...",
          visualDescription: sceneData.visualDescription,
          keywords: sceneData.keywords,
          selectedVideoUrl: bestClip?.url || "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4",
          selectedVideoId: bestClip?.id || "space_stars_1",
          selectedVideoProvider: bestClip?.provider || "pexels",
          selectedVideoDuration: bestClip?.duration || 15,
          selectedVideoPreviewUrl: bestClip?.previewUrl || "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500",
          duration: sceneData.duration || 5
        });

        if (bestClip?.id) usedClipIds.add(bestClip.id);
      }

      // Apply smart scene distribution if enabled
      if (project.settings.smartSceneDistribution && scenesList.length >= 6) {
        const firstFastCount = 4;
        const fastDuration = 3;
        const slowDuration = scenesList.length <= 14 ? 5 : 6;
        for (let i = 0; i < scenesList.length; i++) {
          scenesList[i].duration = i < firstFastCount ? fastDuration : slowDuration;
        }
      }

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

      DB.updateScene(targetScene);
      res.json(targetScene);
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

      // Method 1: yt-dlp with impersonation
      try {
        const { execSync } = require("child_process");
        const outputPath = path.join(importsDir, `${safeName}.%(ext)s`);
        const cmd = `yt-dlp --impersonate Chrome-133 -f "bestvideo+bestaudio/best" --merge-output-format mp4 -o "${outputPath}" --no-playlist --no-warnings "${url}" 2>&1`;
        execSync(cmd, { encoding: "utf-8", timeout: 120000, shell: true });
        const files = fs.readdirSync(importsDir);
        const mp4 = files.find(f => f.startsWith(safeName) && f.endsWith(".mp4"));
        if (mp4) actualFile = path.join(importsDir, mp4);
        console.log("TikTok: yt-dlp method succeeded");
      } catch (e: any) {
        console.log("TikTok: yt-dlp failed, trying API fallback...", e.message?.slice(0, 100));
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
    const filePath = path.join(process.cwd(), "storage", "projects", req.params.projectId, "tiktok_imports", req.params.filename);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  // Pinterest Video Download via yt-dlp (supports images & videos)
  app.post("/api/pinterest/download", async (req, res) => {
    try {
      const { url, projectId } = req.body;
      if (!url) return res.status(400).json({ error: "Pinterest URL required" });
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      const importsDir = path.join(process.cwd(), "storage", "projects", projectId, "pinterest_imports");
      fs.mkdirSync(importsDir, { recursive: true });

      const safeName = "pinterest_" + Date.now();

      let actualFile = "";
      try {
        const { execSync } = require("child_process");
        const outputPath = path.join(importsDir, `${safeName}.%(ext)s`);
        const cmd = `yt-dlp --impersonate Chrome-133 -o "${outputPath}" --no-playlist --no-warnings "${url}" 2>&1`;
        execSync(cmd, { encoding: "utf-8", timeout: 120000, shell: true });
        const files = fs.readdirSync(importsDir);
        const mp4 = files.find(f => f.startsWith(safeName) && f.endsWith(".mp4"));
        if (mp4) actualFile = path.join(importsDir, mp4);
        console.log("Pinterest: yt-dlp method succeeded");
      } catch (e: any) {
        console.error("Pinterest: yt-dlp failed:", e.message?.slice(0, 200));
      }

      if (!actualFile || !fs.existsSync(actualFile)) {
        // Fallback: find the file in the imports dir
        const files = fs.readdirSync(importsDir);
        const mp4 = files.find(f => f.startsWith(safeName));
        if (mp4) actualFile = path.join(importsDir, mp4);
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
    const filePath = path.join(process.cwd(), "storage", "projects", req.params.projectId, "pinterest_imports", req.params.filename);
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
      const { execSync } = await import("child_process");
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
    const thumbPath = path.join(process.cwd(), "storage", "projects", id, "thumbnails", `${id}_thumbnail.jpg`);
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
    const audioDir = path.join(process.cwd(), "storage", "projects", id, "audio");
    if (!fs.existsSync(audioDir)) return res.status(404).json({ error: "Audio not found" });
    const files = fs.readdirSync(audioDir).filter(f => f.startsWith(type));
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
        duration = parseFloat(require("child_process").execSync(
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
      (project.settings.audioSettings as any).bgmTrack = audioTrack;
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
      // If request reached here with "apply-builtin", pass through to correct handler
      if (type === "apply-builtin") {
        const { type: bodyType, fileName, filePath } = req.body;
        if (!bodyType || (bodyType !== "bgm" && bodyType !== "sfx")) {
          return res.status(400).json({ error: 'type must be "bgm" or "sfx"' });
        }
        const project = DB.getProjectById(id);
        if (!project) return res.status(404).json({ error: "Project not found" });
        if (!fs.existsSync(filePath)) return res.status(400).json({ error: "File not found on disk" });
        const stat = fs.statSync(filePath);
        let duration = 0;
        try {
          duration = parseFloat(require("child_process").execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
          ).toString().trim()) || 0;
        } catch {}
        if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
        const audioTrack = { type: bodyType, url: `/api/audio/builtin/${bodyType}/${fileName}`, filePath, fileName, fileSize: stat.size, duration, format: "mp3" };
        (project.settings.audioSettings as any).bgmTrack = audioTrack;
        DB.saveProject(project);
        return res.json({ success: true, audioTrack });
      }
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

      const audioDir = path.join(process.cwd(), "storage", "projects", id, "audio");
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
        const { execSync } = await import("child_process");
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

      const voice = req.body?.voice || project.settings.edgeTtsVoice || "hi-IN-SwaraNeural";
      const rate = req.body?.rate || project.settings.edgeTtsRate || "+0%";
      const fullText = scenes.map((s: any, i: number) => `${s.text || ""}`).join(" ");
      if (!fullText.trim()) return res.status(400).json({ error: "No text content in scenes to generate voiceover." });

      const audioDir = path.join(process.cwd(), "storage", "projects", id, "audio");
      fs.mkdirSync(audioDir, { recursive: true });

      // Remove old voiceover
      const existing = fs.readdirSync(audioDir).filter(f => f.startsWith("voiceover"));
      existing.forEach(f => { try { fs.unlinkSync(path.join(audioDir, f)); } catch {} });

      const outputPath = path.join(audioDir, `voiceover_${Date.now()}.mp3`);
      const pythonScript = path.join(process.cwd(), "server", "tts.py");

      const textFile = path.join(audioDir, `tts_text_${Date.now()}.txt`);
      fs.writeFileSync(textFile, fullText, "utf-8");

      const { execSync } = require("child_process");
      const cmd = `python3 "${pythonScript}" "$(cat "${textFile}")" "${voice}" "${outputPath}" "${rate}"`;
      let result;
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

      res.json({ success: true, audioTrack, message: `Voiceover generated (${result.duration?.toFixed(1)}s) using ${voice}` });
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
      const audioDir = path.join(process.cwd(), "storage", "projects", id, "audio");
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
          duration = parseFloat(require("child_process").execSync(
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
          duration = parseFloat(require("child_process").execSync(
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
      const filePath = path.join(BUILTIN_AUDIO_DIR, type, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : "audio/mpeg";
      return res.setHeader("Content-Type", mime).sendFile(filePath);
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

  // Trigger Gemini SEO Optimizer
  app.post("/api/projects/:id/seo", async (req, res) => {
    try {
      const { id } = req.params;
      const project = DB.getProjectById(id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const seo = await AIProviderManager.generateSEO(project.title, project.script || "");
      res.json(seo);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
            model: "gemini-3.5-flash",
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

  // --- VITE DEV AND PROD MIDDLEWARES ---
  const isProduction = process.env.NODE_ENV === "production" || (typeof __filename !== "undefined" && __filename.endsWith("server.cjs"));

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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // ========== YOUTUBE UPLOAD ROUTES ==========

  // Check YouTube auth status (OAuth + cookies)
  app.get("/api/youtube/status", (req, res) => {
    const tokens = loadYoutubeToken();
    res.json({
      authenticated: !!tokens?.access_token,
      hasRefreshToken: !!tokens?.refresh_token,
      hasCookies: hasValidCookies()
    });
  });

  // Check cookies status specifically
  app.get("/api/youtube/cookies-status", (req, res) => {
    res.json({ valid: hasValidCookies() });
  });

  // Upload cookies.txt
  app.post("/api/youtube/cookies", express.text({ type: "text/plain" }), async (req, res) => {
    try {
      const content = req.body;
      if (!content || typeof content !== "string") {
        return res.status(400).json({ error: "No cookies content provided" });
      }
      saveCookies(content);
      const valid = hasValidCookies();
      res.json({ success: true, valid, message: valid ? "YouTube cookies saved and valid!" : "Cookies saved but may not be valid (missing SAPISID). Re-export from browser." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
      const callbackUrl = getYoutubeCallbackUrl(req);
      const client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID || "",
        process.env.YOUTUBE_CLIENT_SECRET || "",
        callbackUrl
      );
      const { tokens } = await client.getToken(code as string);
      saveYoutubeToken(tokens);
      // Redirect back to app (using same host as request to handle 0.0.0.0 vs localhost)
      const host = (req.headers?.host || "localhost:3000").replace("0.0.0.0", "localhost");
      res.redirect(`http://${host}/?youtube=connected`);
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

      // Build title/description/tags
      let title = project.title || "YouTube Shorts";
      let description = "Created with AI Shorts Generator\n\n#shorts #ai";
      let tags: string[] = ["shorts", "ai", "shortsvideo"];
      if ((project as any).seoTags) {
        const seo = (project as any).seoTags;
        title = seo.title || title;
        description = seo.description || description;
        tags = seo.tags || tags;
      }
      const scenes = DB.getScenes(id);
      if (scenes.length > 0 && (scenes[0] as any).hook) {
        title = `${(scenes[0] as any).hook} - ${title}`;
      }

      // Method 1: Cookies-based upload (no Google Cloud setup)
      if (hasValidCookies()) {
        try {
          const result = await uploadVideo(renderedPath, { title: title.slice(0, 100), description: description.slice(0, 5000), tags: tags.slice(0, 25) });
          return res.json({ success: true, videoId: result.videoId, url: `https://youtu.be/${result.videoId}`, title: title.slice(0, 100), method: "cookies" });
        } catch (cookieErr: any) {
          console.log("Cookies failed, fallback to OAuth:", cookieErr.message?.slice(0, 100));
        }
      }

      // Method 2: OAuth-based upload
      const tokens = loadYoutubeToken();
      if (!tokens?.access_token) {
        return res.status(401).json({ error: "No YouTube auth available. Upload cookies in Settings or set up OAuth." });
      }
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
      res.json({ success: true, videoId, url: `https://youtu.be/${videoId}`, title: title.slice(0, 100), method: "oauth" });
    } catch (e: any) {
      if (e.message?.includes("Token") || e.message?.includes("401")) {
        const refreshed = await refreshYoutubeToken();
        if (refreshed) return res.status(503).json({ error: "Token refreshed. Try again.", retry: true });
        return res.status(401).json({ error: "Auth expired. Reconnect.", authUrl: getYoutubeAuthUrl() });
      }
      res.status(500).json({ error: e.message || "Upload failed" });
    }
  });

  // ========== SCHEDULED UPLOAD ROUTES ==========

  // Schedule a video for later upload
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

      (project as any).scheduledAt = scheduledAt;
      (project as any).uploadScheduleStatus = "pending";
      DB.saveProject(project);

      res.json({ success: true, scheduledAt, message: `Upload scheduled for ${new Date(scheduledAt).toLocaleString()}` });
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

          // Try cookies method first
          let uploaded = false;
          if (hasValidCookies()) {
            try {
              const seo = (project as any).seoTags || {};
              const result = await uploadVideo(renderedPath, {
                title: (seo.title || project.title || "YouTube Shorts").slice(0, 100),
                description: (seo.description || "Created with AI Shorts Generator").slice(0, 5000),
                tags: (seo.tags || ["shorts", "ai"]).slice(0, 25),
              });
              console.log(`[Scheduler] Uploaded via cookies: ${result.videoId}`);
              uploaded = true;
            } catch (cErr: any) {
              console.log(`[Scheduler] Cookies failed: ${cErr.message?.slice(0, 100)}`);
            }
          }

          // Fallback to OAuth
          if (!uploaded) {
            const tokens = loadYoutubeToken();
            if (tokens?.access_token) {
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
              console.log(`[Scheduler] Uploaded via OAuth: ${uploadRes.data.id}`);
              uploaded = true;
            }
          }

          (project as any).uploadScheduleStatus = uploaded ? "done" : "failed";
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Express startup crash:", err);
});
