/**
 * Autopilot Engine — hands-free "topic → finished uploaded video" automation.
 *
 * The user supplies topics (or a category to auto-generate topics from). The
 * engine walks each topic through the EXISTING pipeline pieces:
 *   1. create project
 *   2. AI script + scene breakdown + stock-footage search
 *   3. edge-tts voiceover
 *   4. default background music
 *   5. SEO (title/description/tags)
 *   6. FFmpeg render (via the shared render queue)
 *   7. schedule upload at the niche's best posting time
 * The pre-existing YouTube upload scheduler then publishes it at that time.
 *
 * Nothing here re-implements rendering or uploading — it only orchestrates.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { DB } from "./db";
import { getPythonBin } from "./python";
import { AIProviderManager } from "./aiManager";
import { ProviderManagerService } from "./providers";
import { FFmpegService } from "./ffmpeg";
import { TrendsService } from "./trends";
import { renderQueue } from "./renderQueue";
import { Project, ProjectStatus, ProcessingJob } from "../src/types";

// ---------------------------------------------------------------------------
// Config + queue persistence
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(process.cwd(), "data", "autopilot.json");
const QUEUE_PATH = path.join(process.cwd(), "data", "autopilot-queue.json");

export type ApprovalMode = "auto" | "approve" | "manual";

export interface AutopilotConfig {
  enabled: boolean;
  approvalMode: ApprovalMode;
  topics: string[];
  category: string;
  region: string;
  platform: string;
  videosPerDay: number;
  duration: number;
  voice: string;
  voiceRate: string;
  subtitlesEnabled: boolean;
  defaultBgmPath: string;
  defaultBgmName: string;
  musicVolume: number;
  voiceVolume: number;
  accountId: string; // target channel id ("" = default account)
  /** Optional user-chosen upload date (YYYY-MM-DD). "" = auto best posting time. */
  scheduleDate: string;
  /** Optional user-chosen upload time (HH:mm, IST). "" = auto best posting time. */
  scheduleTime: string;
  autoGenerateTopics: boolean;
  autoEmoji: boolean;
  smartSceneDistribution: boolean;
  autoHashtags: boolean;
  /** Full set of per-video feature overrides merged into every autopilot project. */
  features: Record<string, any>;
  lastRunAt?: string;
}

export type QueueStatus =
  | "pending"
  | "generating"
  | "rendering"
  | "awaiting_approval"
  | "rendered"
  | "scheduled"
  | "uploaded"
  | "failed"
  | "cancelled";

export interface AutopilotQueueItem {
  id: string;
  topic: string;
  status: QueueStatus;
  projectId?: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  videoId?: string;
  /** User-selected (or AI-generated) upload title. Empty = auto SEO title. */
  title?: string;
}

const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: false,
  approvalMode: "auto",
  topics: [],
  category: "",
  region: "Global",
  platform: "YouTube",
  videosPerDay: 2,
  duration: 30,
  voice: "hi-IN-SwaraNeural",
  voiceRate: "+0%",
  subtitlesEnabled: true,
  defaultBgmPath: "",
  defaultBgmName: "",
  musicVolume: 15,
  voiceVolume: 100,
  accountId: "",
  scheduleDate: "",
  scheduleTime: "",
  autoGenerateTopics: true,
  autoEmoji: true,
  smartSceneDistribution: false,
  autoHashtags: true,
  features: {}
};

export function getConfig(): AutopilotConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return { ...DEFAULT_CONFIG, ...raw };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: Partial<AutopilotConfig>): AutopilotConfig {
  const merged = { ...getConfig(), ...cfg };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

export function getQueue(): AutopilotQueueItem[] {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
    }
  } catch {}
  return [];
}

function saveQueue(queue: AutopilotQueueItem[]): void {
  fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), "utf8");
}

function updateItem(id: string, patch: Partial<AutopilotQueueItem>): AutopilotQueueItem | undefined {
  const queue = getQueue();
  const item = queue.find(i => i.id === id);
  if (!item) return undefined;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  saveQueue(queue);
  return item;
}

export function addToQueue(topics: string[]): AutopilotQueueItem[] {
  const queue = getQueue();
  const now = new Date().toISOString();
  const added: AutopilotQueueItem[] = [];
  for (const t of topics) {
    const topic = (t || "").trim();
    if (!topic) continue;
    // Skip exact duplicates that are still active
    const dup = queue.find(i => i.topic === topic && ["pending", "generating", "rendering", "scheduled"].includes(i.status));
    if (dup) continue;
    const item: AutopilotQueueItem = {
      id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      topic,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    queue.push(item);
    added.push(item);
  }
  saveQueue(queue);
  return added;
}

export function removeFromQueue(id: string): boolean {
  const queue = getQueue();
  const idx = queue.findIndex(i => i.id === id);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  saveQueue(queue);
  return true;
}

export function approveItem(id: string): AutopilotQueueItem | undefined {
  return updateItem(id, { status: "pending" });
}

export function markUploaded(id: string): AutopilotQueueItem | undefined {
  return updateItem(id, { status: "uploaded" });
}

/**
 * Generate AI title options for a queue item's topic.
 * Returns { titles } or null if the item doesn't exist.
 */
export async function generateTitlesForItem(id: string, count: number): Promise<{ titles: string[] } | null> {
  const item = getQueue().find(i => i.id === id);
  if (!item) return null;
  try {
    const { GeminiService } = await import("./gemini");
    const res = await GeminiService.generateTitles(item.topic, count);
    if (Array.isArray(res?.titles) && res.titles.length) return { titles: res.titles.slice(0, count) };
    return { titles: [] };
  } catch (e: any) {
    console.error("[Autopilot] title generation failed:", e?.message);
    // Fallback: simple angled titles so the user always gets options.
    return {
      titles: [
        item.topic,
        `You won't believe this: ${item.topic}`,
        `${item.topic} — the truth nobody tells you`
      ].slice(0, count)
    };
  }
}

/** Set (or clear, with "") the user-selected title for a queue item. */
export function selectTitleForItem(id: string, title: string): AutopilotQueueItem | undefined {
  return updateItem(id, { title: (title || "").trim() });
}

// ---------------------------------------------------------------------------
// Small helpers (mirrors of server.ts utilities, kept local to avoid cycles)
// ---------------------------------------------------------------------------
const FALLBACK_CLIP = {
  url: "https://videos.pexels.com/video-files/853889/853889-hd_1080_1920_25fps.mp4",
  id: "space_stars_1",
  provider: "pexels",
  duration: 15,
  previewUrl: "https://images.pexels.com/photos/853889/pexels-photo-853889.jpeg?auto=compress&cs=tinysrgb&dpr=1&w=500"
};

const HOOK_EMOJIS = ["🔥", "💥", "😱", "🤯", "👀", "🚨", "✨", "💯", "😳", "🎯", "⚡", "🥶", "😲", "🤫", "🗿", "🎬"];
function withAutoEmoji(hook: string, enabled?: boolean): string {
  if (!enabled || !hook) return hook;
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]$/u.test(hook.trim())) return hook;
  const emoji = HOOK_EMOJIS[Math.floor(Math.random() * HOOK_EMOJIS.length)];
  return `${hook.trim()} ${emoji}`;
}

// Auto-pick a matching edge-tts voice when the script is in a native script.
function detectEdgeVoiceForScript(text: string): string {
  if (!text) return "";
  const map: { test: RegExp; voice: string }[] = [
    { test: /[\u0900-\u097F]/, voice: "hi-IN-SwaraNeural" },
    { test: /[\u0980-\u09FF]/, voice: "bn-IN-TanishaaNeural" },
    { test: /[\u0A00-\u0A7F]/, voice: "pa-IN-OjasNeural" },
    { test: /[\u0A80-\u0AFF]/, voice: "gu-IN-DhwaniNeural" },
    { test: /[\u0B80-\u0BFF]/, voice: "ta-IN-PallaviNeural" },
    { test: /[\u0C00-\u0C7F]/, voice: "te-IN-ShrutiNeural" },
    { test: /[\u0C80-\u0CFF]/, voice: "kn-IN-SapnaNeural" },
    { test: /[\u0D00-\u0D7F]/, voice: "ml-IN-SobhanaNeural" },
    { test: /[\u0600-\u06FF\u0750-\u077F]/, voice: "ur-PK-UzmaNeural" },
    { test: /[\u0E00-\u0E7F]/, voice: "th-TH-PremwadeeNeural" }
  ];
  for (const { test, voice } of map) {
    if (test.test(text)) return voice;
  }
  return "";
}

function probeDuration(filePath: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    ).toString().trim();
    return parseFloat(out) || 0;
  } catch {
    return 0;
  }
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// ---------------------------------------------------------------------------
// Topic generation from a category
// ---------------------------------------------------------------------------
export async function generateTopicsFromCategory(category: string, count: number): Promise<string[]> {
  try {
    const { GeminiService } = await import("./gemini");
    const res = await GeminiService.generateTopics(category, count);
    if (Array.isArray(res?.topics) && res.topics.length) return res.topics.slice(0, count);
    return [];
  } catch (e: any) {
    console.error("[Autopilot] topic generation failed:", e?.message);
    // Fallback: derive simple angled topics so automation never hard-fails.
    const angles = ["Top 5 facts about", "The shocking truth behind", "What nobody tells you about", "Beginner mistakes in", "The future of"];
    return Array.from({ length: Math.min(count, 3) }, (_, i) => `${angles[i % angles.length]} ${category}`);
  }
}

// ---------------------------------------------------------------------------
// Best posting-time slot selection
// ---------------------------------------------------------------------------
const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

function parseTimeToMinutes(time: string): { h: number; m: number } | null {
  // Handles "7:00 PM", "19:30", "7 PM", "07:00"
  const m = time.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = (m[3] || "").toUpperCase();
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  if (h > 23) h = 23;
  return { h, m: min };
}

function nextOccurrence(day: string, time: string, after: Date): Date | null {
  const dayIdx = DAY_INDEX[day.toLowerCase()];
  const t = parseTimeToMinutes(time);
  if (dayIdx === undefined || !t) return null;
  const candidate = new Date(after);
  candidate.setHours(t.h, t.m, 0, 0);
  // Advance to the target weekday (today counts if the time is still ahead).
  let addDays = (dayIdx - candidate.getDay() + 7) % 7;
  if (addDays === 0 && candidate <= after) addDays = 7;
  candidate.setDate(candidate.getDate() + addDays);
  return candidate;
}

/** Parse a YYYY-MM-DD string into a local Date (midnight). */
function parseScheduleDate(s: string): Date | null {
  const m = (s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Pick the next best posting slot that is in the future and not already taken
 * by another scheduled autopilot item. If the user chose a fixed upload date
 * (cfg.scheduleDate) the slot is constrained to that day. Falls back to
 * "now + 10 min" if the posting-time prediction is unavailable.
 */
export async function pickNextSlot(cfg: AutopilotConfig): Promise<Date> {
  const taken = new Set(
    getQueue()
      .filter(i => i.scheduledAt && ["scheduled", "rendering", "generating"].includes(i.status))
      .map(i => new Date(i.scheduledAt!).getTime())
  );
  const fallback = () => new Date(Date.now() + 10 * 60 * 1000);
  const isTaken = (ms: number) => [...taken].some(t => Math.abs(t - ms) < 30 * 60 * 1000);

  // --- User-chosen MANUAL time (HH:mm, IST) ---
  // If the user picked a specific time, honour it exactly. Combined with an
  // optional fixed date; otherwise use the next occurrence of that time.
  const manualTime = parseTimeToMinutes(cfg.scheduleTime || "");
  if (manualTime) {
    if (cfg.scheduleDate) {
      const target = parseScheduleDate(cfg.scheduleDate);
      if (target) {
        const d = new Date(target);
        d.setHours(manualTime.h, manualTime.m, 0, 0);
        if (d.getTime() > Date.now() && !isTaken(d.getTime())) return d;
        // That exact slot already passed / taken — fall through to best-time.
      }
    } else {
      // No fixed date: next occurrence of the manual time (today if ahead).
      const d = new Date();
      d.setHours(manualTime.h, manualTime.m, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      if (!isTaken(d.getTime())) return d;
    }
  }

  // --- User-chosen fixed upload date (YYYY-MM-DD), auto best time ---
  if (cfg.scheduleDate) {
    const target = parseScheduleDate(cfg.scheduleDate);
    if (target) {
      try {
        const niche = cfg.category || "general";
        const data = await TrendsService.predictPostingTime(niche, cfg.platform || "YouTube", cfg.region || "Global");
        const slots: Date[] = [];
        for (const bt of data.bestTimes || []) {
          const t = parseTimeToMinutes(bt.time);
          if (!t) continue;
          const d = new Date(target);
          d.setHours(t.h, t.m, 0, 0);
          slots.push(d);
        }
        slots.sort((a, b) => a.getTime() - b.getTime());
        for (const s of slots) {
          if (s.getTime() > Date.now() && !isTaken(s.getTime())) return s;
        }
      } catch (e: any) {
        console.log("[Autopilot] posting-time prediction unavailable for fixed date, using fallback:", e?.message?.slice(0, 80));
      }
      // All best times on that date already passed (or prediction failed):
      // default to 6 PM on the chosen date, else upload ASAP.
      const def = new Date(target);
      def.setHours(18, 0, 0, 0);
      if (def.getTime() > Date.now() && !isTaken(def.getTime())) return def;
      return fallback();
    }
  }

  // --- Default: next best posting time on any upcoming day ---
  try {
    const niche = cfg.category || "general";
    const data = await TrendsService.predictPostingTime(niche, cfg.platform || "YouTube", cfg.region || "Global");
    const slots: Date[] = [];
    for (const bt of data.bestTimes || []) {
      const d = nextOccurrence(bt.day, bt.time, new Date());
      if (d) slots.push(d);
    }
    slots.sort((a, b) => a.getTime() - b.getTime());
    for (const s of slots) {
      // Avoid collisions within a 30-minute window of an already-taken slot.
      if (!isTaken(s.getTime())) return s;
    }
    if (slots.length) return slots[0];
  } catch (e: any) {
    console.log("[Autopilot] posting-time prediction unavailable, using fallback slot:", e?.message?.slice(0, 80));
  }
  return fallback();
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------
function createAutopilotProject(topic: string, cfg: AutopilotConfig): Project {
  const defaultSettings = DB.getDefaultSettings();
  const projects = DB.getProjects();
  let nextNum = 1;
  for (const p of projects) {
    if (p.id.startsWith("project_")) {
      const num = parseInt(p.id.split("_")[1], 10);
      if (!isNaN(num) && num >= nextNum) nextNum = num + 1;
    }
  }
  const paddedNum = String(nextNum).padStart(3, "0");
  const projectId = `project_${paddedNum}`;

  const settings: any = {
    ...defaultSettings,
    ...(cfg.features || {}),
    subtitleEnabled: cfg.subtitlesEnabled,
    edgeTtsEnabled: true,
    edgeTtsVoice: cfg.voice,
    edgeTtsRate: cfg.voiceRate,
    autoEmoji: cfg.autoEmoji !== false,
    smartSceneDistribution: cfg.smartSceneDistribution === true,
    autoHashtags: cfg.autoHashtags !== false
  };
  if (!settings.audioSettings) settings.audioSettings = {};
  settings.audioSettings.musicVolume = cfg.musicVolume;
  settings.audioSettings.voiceVolume = cfg.voiceVolume;

  const project: Project = {
    id: projectId,
    userId: "u1",
    title: topic,
    topic,
    script: "",
    status: ProjectStatus.DRAFT,
    settings,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  DB.saveProject(project);
  return project;
}

async function generateScriptAndFootage(project: Project, cfg: AutopilotConfig): Promise<void> {
  let genDuration = cfg.duration || 30;
  if (project.settings.smartSceneDistribution && genDuration >= 60) genDuration = 70;

  const result = await AIProviderManager.generateScriptAndScenes(project.topic, genDuration);
  project.title = result.title;
  project.script = result.script;
  project.status = ProjectStatus.DRAFT;
  DB.saveProject(project);

  const scenesList: any[] = [];
  const usedClipIds = new Set<string>();
  for (let i = 0; i < result.scenes.length; i++) {
    const sceneData = result.scenes[i];
    const foundClips = await ProviderManagerService.searchFootage(
      sceneData.visualDescription,
      sceneData.keywords,
      project.settings.preferredSources,
      6,
      3,
      true,
      usedClipIds
    );
    const bestClip = foundClips[0];
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
  DB.saveScenes(project.id, scenesList);
}

async function generateVoiceover(project: Project, cfg: AutopilotConfig): Promise<void> {
  const scenes = DB.getScenes(project.id);
  if (!scenes.length) throw new Error("No scenes to narrate");

  const sceneTexts = scenes.map((s: any) => (s.text || "").trim()).filter(Boolean);
  const joined = sceneTexts.join(" ");
  const scriptLangVoice = detectEdgeVoiceForScript(joined);
  const voice = scriptLangVoice || cfg.voice || "hi-IN-SwaraNeural";
  const rate = cfg.voiceRate || "+0%";

  const fullText = sceneTexts.map((t, i) => (i < sceneTexts.length - 1 ? t.replace(/[.!?]+$/, "").trim() : t)).join(", ");
  if (!fullText.trim()) throw new Error("No narration text");

  const audioDir = path.join(process.cwd(), "storage", "projects", project.id, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  for (const f of fs.readdirSync(audioDir).filter(f => f.startsWith("voiceover"))) {
    try { fs.unlinkSync(path.join(audioDir, f)); } catch {}
  }
  const outputPath = path.join(audioDir, `voiceover_${Date.now()}.mp3`);
  const pythonScript = path.join(process.cwd(), "server", "tts.py");
  const textFile = path.join(audioDir, `tts_text_${Date.now()}.txt`);
  fs.writeFileSync(textFile, fullText, "utf-8");

  let result: any = null;
  const cmd = `${getPythonBin()} "${pythonScript}" "${textFile}" "${voice}" "${outputPath}" "${rate}"`;
  try {
    const stdout = execSync(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }).toString();
    result = JSON.parse(stdout);
  } catch (execErr: any) {
    if (fs.existsSync(outputPath)) {
      result = { duration: probeDuration(outputPath), path: outputPath };
    }
    if (!result) throw new Error(`TTS failed: ${execErr.stderr?.toString()?.slice(0, 200) || execErr.message}`);
  } finally {
    try { fs.unlinkSync(textFile); } catch {}
  }

  const stat = fs.statSync(outputPath);
  const audioTrack = {
    url: `/api/projects/${project.id}/audio/voiceover`,
    filePath: outputPath,
    fileName: "voiceover_tts.mp3",
    fileSize: stat.size,
    duration: result.duration || 0,
    format: "mp3"
  };
  if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
  (project.settings.audioSettings as any).voiceoverTrack = audioTrack;
  DB.saveProject(project);
}

function applyDefaultBgm(project: Project, cfg: AutopilotConfig): void {
  if (!cfg.defaultBgmPath || !fs.existsSync(cfg.defaultBgmPath)) return;
  const duration = probeDuration(cfg.defaultBgmPath);
  const fileName = path.basename(cfg.defaultBgmPath);
  if (!project.settings.audioSettings) (project.settings as any).audioSettings = {};
  (project.settings.audioSettings as any).bgmTrack = {
    url: "",
    filePath: cfg.defaultBgmPath,
    fileName,
    fileSize: fs.statSync(cfg.defaultBgmPath).size,
    duration,
    format: fileName.split(".").pop() || "mp3"
  };
  (project.settings.audioSettings as any).musicVolume = cfg.musicVolume;
  DB.saveProject(project);
}

async function generateSeo(project: Project, preferredTitle?: string): Promise<void> {
  try {
    const seo = await AIProviderManager.generateSEO(project.title, project.script || "");
    (project as any).seoTags = {
      title: (preferredTitle || seo.viralTitle || "").trim() || seo.viralTitle,
      description: seo.description,
      tags: seo.hashtags
    };
    DB.saveProject(project);
  } catch (e: any) {
    // Even if SEO generation fails, honour the user's chosen title.
    if (preferredTitle) {
      (project as any).seoTags = { title: preferredTitle, description: "", tags: [] };
      DB.saveProject(project);
    }
    console.log("[Autopilot] SEO generation skipped:", e?.message?.slice(0, 80));
  }
}

async function renderAndWait(projectId: string, timeoutMs = 30 * 60 * 1000): Promise<boolean> {
  renderQueue.enqueue([projectId]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = DB.getJobByProjectId(projectId);
    if (job) {
      if (job.step === "completed") return true;
      if (job.step === "failed" || job.step === "cancelled") return false;
    }
    // Also treat a finished render file as success even if job state lags.
    const finalPath = path.join(process.cwd(), "storage", "projects", projectId, "renders", `${projectId}_final.mp4`);
    const proj = DB.getProjectById(projectId);
    if (proj?.status === ProjectStatus.COMPLETED && fs.existsSync(finalPath)) return true;
    await delay(3000);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
let processing = false;

export function isProcessing(): boolean {
  return processing;
}

/**
 * Process the next actionable queue item. Returns the item id processed, or null.
 */
export async function processNext(): Promise<string | null> {
  if (processing) return null;
  const cfg = getConfig();
  const queue = getQueue();

  // Find the next item to work on.
  let item = queue.find(i => i.status === "pending");
  if (!item) return null;

  processing = true;
  try {
    // 1. Create project
    updateItem(item.id, { status: "generating" });
    const project = createAutopilotProject(item.topic, cfg);
    updateItem(item.id, { projectId: project.id });
    console.log(`[Autopilot] Generating "${item.topic}" -> ${project.id}`);

    // 2. Script + footage
    await generateScriptAndFootage(project, cfg);

    // 3. Voiceover
    await generateVoiceover(project, cfg);

    // 4. Default BGM
    applyDefaultBgm(project, cfg);

    // 5. SEO (uses the user-selected title if one was chosen)
    await generateSeo(project, item.title);

    // 6. Render
    updateItem(item.id, { status: "rendering" });
    const ok = await renderAndWait(project.id);
    if (!ok) {
      updateItem(item.id, { status: "failed", error: "Render failed or timed out" });
      return item.id;
    }

    // 7. Approval gate / scheduling
    if (cfg.approvalMode === "approve") {
      updateItem(item.id, { status: "awaiting_approval" });
      console.log(`[Autopilot] "${item.topic}" rendered — awaiting approval.`);
    } else if (cfg.approvalMode === "manual") {
      updateItem(item.id, { status: "rendered" });
      console.log(`[Autopilot] "${item.topic}" rendered — manual upload mode.`);
    } else {
      await scheduleItem(item.id, cfg);
    }
    return item.id;
  } catch (e: any) {
    console.error(`[Autopilot] pipeline error for "${item.topic}":`, e?.message);
    updateItem(item.id, { status: "failed", error: e?.message?.slice(0, 300) });
    return item.id;
  } finally {
    processing = false;
  }
}

/** Schedule a rendered item for upload at the next best slot. */
export async function scheduleItem(itemId: string, cfg?: AutopilotConfig): Promise<AutopilotQueueItem | undefined> {
  const config = cfg || getConfig();
  const item = getQueue().find(i => i.id === itemId);
  if (!item || !item.projectId) return undefined;
  const project = DB.getProjectById(item.projectId);
  if (!project) return undefined;

  const slot = await pickNextSlot(config);
  (project as any).scheduledAt = slot.toISOString();
  (project as any).uploadScheduleStatus = "pending";
  if (config.accountId) (project as any).autopilotAccountId = config.accountId;
  DB.saveProject(project);

  return updateItem(itemId, { status: "scheduled", scheduledAt: slot.toISOString() });
}

/**
 * Re-schedule an already-scheduled (or rendered) item to a specific date/time.
 * Pass dateStr as YYYY-MM-DD and optional timeStr as HH:mm (IST); empty date
 * re-picks the next best slot. If a time is given it is honoured exactly.
 */
export async function rescheduleItem(itemId: string, dateStr: string, timeStr = ""): Promise<AutopilotQueueItem | undefined> {
  const item = getQueue().find(i => i.id === itemId);
  if (!item || !item.projectId) return undefined;
  const project = DB.getProjectById(item.projectId);
  if (!project) return undefined;

  let slot: Date;
  const target = parseScheduleDate(dateStr || "");
  const manualTime = parseTimeToMinutes(timeStr || "");

  if (target && manualTime) {
    // Exact date + time chosen — use it directly.
    const d = new Date(target);
    d.setHours(manualTime.h, manualTime.m, 0, 0);
    slot = d.getTime() > Date.now() ? d : new Date(Date.now() + 10 * 60 * 1000);
  } else if (target) {
    // Date only — use the best time on that date, else 6 PM, else ASAP.
    try {
      const cfg = getConfig();
      const data = await TrendsService.predictPostingTime(cfg.category || "general", cfg.platform || "YouTube", cfg.region || "Global");
      const slots: Date[] = [];
      for (const bt of data.bestTimes || []) {
        const t = parseTimeToMinutes(bt.time);
        if (!t) continue;
        const d = new Date(target);
        d.setHours(t.h, t.m, 0, 0);
        if (d.getTime() > Date.now()) slots.push(d);
      }
      slots.sort((a, b) => a.getTime() - b.getTime());
      slot = slots[0] || (() => { const d = new Date(target); d.setHours(18, 0, 0, 0); return d.getTime() > Date.now() ? d : new Date(Date.now() + 10 * 60 * 1000); })();
    } catch {
      const d = new Date(target);
      d.setHours(18, 0, 0, 0);
      slot = d.getTime() > Date.now() ? d : new Date(Date.now() + 10 * 60 * 1000);
    }
  } else {
    slot = await pickNextSlot(getConfig());
  }

  (project as any).scheduledAt = slot.toISOString();
  (project as any).uploadScheduleStatus = "pending";
  DB.saveProject(project);
  return updateItem(itemId, { status: "scheduled", scheduledAt: slot.toISOString() });
}

/**
 * Background tick. When enabled, tops up the queue from the topic list /
 * category and processes the next item. Runs on an interval from server.ts.
 */
export async function tick(): Promise<void> {
  try {
    const cfg = getConfig();
    if (!cfg.enabled) return;
    if (processing) return;

    // Top up the queue if it's running low on actionable items.
    const queue = getQueue();
    const actionable = queue.filter(i => ["pending", "generating", "rendering", "scheduled", "awaiting_approval"].includes(i.status));
    if (actionable.length < Math.max(1, cfg.videosPerDay)) {
      const fresh = cfg.topics.filter(t => !queue.some(i => i.topic === t && i.status !== "failed" && i.status !== "cancelled"));
      if (fresh.length) {
        addToQueue(fresh.slice(0, cfg.videosPerDay));
      } else if (cfg.autoGenerateTopics && cfg.category) {
        const generated = await generateTopicsFromCategory(cfg.category, cfg.videosPerDay);
        if (generated.length) addToQueue(generated);
      }
    }

    await processNext();
    saveConfig({ lastRunAt: new Date().toISOString() });
  } catch (e: any) {
    console.error("[Autopilot] tick error:", e?.message?.slice(0, 150));
  }
}
