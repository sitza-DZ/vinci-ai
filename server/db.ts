import fs from "fs";
import path from "path";
import { 
  User, 
  Project, 
  Scene, 
  ProcessingJob, 
  VideoSource, 
  ProjectStatus, 
  SubtitleStyleType,
  UserSettings,
  ApiKeyConfig,
  DeleteLog,
  AIUsageStats,
  AISystemSettings,
  AIProviderType,
  AIMode,
  SmartRoutingStrategy,
  TrendAlertRule,
  TrendAlertNotification
} from "../src/types";

const DB_FILE = path.join(process.cwd(), "data", "db.json");

interface DatabaseSchema {
  users: User[];
  projects: Project[];
  scenes: Scene[];
  jobs: ProcessingJob[];
  videoSources: VideoSource[];
  defaultSettings: UserSettings;
  apiKeys: ApiKeyConfig[];
  deletions?: DeleteLog[];
  aiStats?: AIUsageStats;
  aiSystemSettings?: AISystemSettings;
  trendAlertRules?: TrendAlertRule[];
  trendAlertNotifications?: TrendAlertNotification[];
  auth?: AuthConfig;
}

export interface AuthSession {
  token: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthConfig {
  pinHash: string;
  sessions: AuthSession[];
}

const DEFAULT_SETTINGS: UserSettings = {
  subtitleEnabled: true,
  subtitleStyle: SubtitleStyleType.TIKTOK,
  videoLength: "medium",
  sceneDuration: 5,
  qualitySelection: "1080p",
  exportFormat: "mp4",
  preferredSources: ["pexels", "pixabay", "coverr", "tiktok", "pinterest"],
  fontSize: 14,
  wordSpacing: 8,
  letterSpacing: 8,
  smartSceneDistribution: false,
  // === v13 feature-set defaults (merged on read, never force-written) ===
  aspectRatio: "9:16",
  transitionDuration: 0.3,
  language: "en-US",
  autoEmoji: true,
  autoHashtags: true,
  kenBurnsEnabled: true,
  duckingEnabled: true,
  aiThumbnail: true,
  watermarkPosition: "br",
  watermarkSize: 15,
  autoSfxEnabled: false,
  edgeTtsEnabled: false,
  autoTikTokSource: false,
  blurTikTokWatermark: false
};

/**
 * Merge v13 default settings into a (possibly older) stored settings object.
 * Stored values always win; missing optional fields get sensible defaults.
 * This NEVER writes to the DB — existing project records stay untouched.
 */
export function mergeSettingsDefaults(settings: UserSettings | null | undefined): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };
}

const INITIAL_DB: DatabaseSchema = {
  users: [
    {
      id: "u1",
      email: "creator@example.com",
      name: "SaaS Creator",
      createdAt: new Date().toISOString()
    }
  ],
  projects: [],
  scenes: [],
  jobs: [],
  videoSources: [
    { id: "pexels", name: "Pexels Video API", enabled: true, apiKeyConfigured: false },
    { id: "pixabay", name: "Pixabay Video API", enabled: true, apiKeyConfigured: false },
    { id: "coverr", name: "Coverr Video Provider", enabled: true, apiKeyConfigured: false },
    { id: "mixkit", name: "Mixkit Provider", enabled: true, apiKeyConfigured: false },
    { id: "instagram", name: "Instagram Public Provider", enabled: false, apiKeyConfigured: false },
    { id: "tiktok", name: "TikTok Public Provider", enabled: false, apiKeyConfigured: false },
    { id: "pinterest", name: "Pinterest Import Provider", enabled: false, apiKeyConfigured: false }
  ],
  defaultSettings: DEFAULT_SETTINGS,
  apiKeys: [
    { id: "gemini", name: "Gemini Pro / Flash AI API", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0 },
    { id: "groq", name: "Groq LLaMA-3 AI API", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0 },
    { id: "openrouter", name: "OpenRouter LLM API Gateway", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0 },
    { id: "nvidia", name: "NVIDIA NIM AI API", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0, model: "nvidia/llama-3.1-nemotron-70b-instruct" },
    { id: "pexels", name: "Pexels Vertical Stock API", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0 },
    { id: "pixabay", name: "Pixabay HD Video API", encryptedKey: "", enabled: true, status: "unconfigured", useCount: 0 }
  ],
  deletions: [],
  aiStats: {
    totalRequests: 0,
    totalSuccess: 0,
    totalFailure: 0,
    providers: {
      gemini: { requests: 0, success: 0, failures: 0 },
      groq: { requests: 0, success: 0, failures: 0 },
      openrouter: { requests: 0, success: 0, failures: 0 },
      nvidia: { requests: 0, success: 0, failures: 0 }
    }
  },
  aiSystemSettings: {
    activeMode: "auto",
    smartRouting: "auto",
    defaultProvider: "gemini"
  }
};

// Ensure database directory exists
function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(INITIAL_DB, null, 2), "utf-8");
  }
}

export class DB {
  private static read(): DatabaseSchema {
    ensureDb();
    try {
      const data = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (!parsed.apiKeys) {
        parsed.apiKeys = INITIAL_DB.apiKeys;
        this.write(parsed);
      } else {
        // Enforce migration to ensure groq and openrouter exist in apiKeys
        const requiredIds = ["gemini", "groq", "openrouter", "nvidia", "pexels", "pixabay"];
        let keysModified = false;
        requiredIds.forEach(id => {
          if (!parsed.apiKeys.some((k: any) => k.id === id)) {
            const templateKey = INITIAL_DB.apiKeys.find(k => k.id === id);
            if (templateKey) {
              parsed.apiKeys.push({ ...templateKey });
              keysModified = true;
            }
          }
        });
        if (keysModified) {
          this.write(parsed);
        }
      }
      if (!parsed.deletions) {
        parsed.deletions = [];
        this.write(parsed);
      }
      if (!parsed.aiStats) {
        parsed.aiStats = {
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
        this.write(parsed);
      }
      if (!parsed.aiSystemSettings) {
        parsed.aiSystemSettings = {
          activeMode: "auto",
          smartRouting: "auto",
          defaultProvider: "gemini"
        };
        this.write(parsed);
      }
      // Enforce videoSources migration — add Coverr/Mixkit if missing from older DB files
      if (parsed.videoSources && Array.isArray(parsed.videoSources)) {
        const sourceIds = parsed.videoSources.map((s: any) => s.id);
        let sourcesModified = false;
        INITIAL_DB.videoSources.forEach(template => {
          if (!sourceIds.includes(template.id)) {
            parsed.videoSources.push({ ...template });
            sourcesModified = true;
          }
        });
        if (sourcesModified) {
          this.write(parsed);
        }
      }
      return parsed;
    } catch (e) {
      console.error("Error reading DB file, resetting to initial state", e);
      return INITIAL_DB;
    }
  }

  private static write(db: DatabaseSchema) {
    ensureDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf-8");
  }

  // Users
  static getUsers(): User[] {
    return this.read().users;
  }

  static getUserById(id: string): User | undefined {
    return this.read().users.find(u => u.id === id);
  }

  static saveUser(user: User): User {
    const db = this.read();
    const index = db.users.findIndex(u => u.id === user.id);
    if (index >= 0) {
      db.users[index] = { ...user };
    } else {
      db.users.push(user);
    }
    this.write(db);
    return user;
  }

  // Projects
  static getProjects(): Project[] {
    return this.read().projects.map(p => ({ ...p, settings: mergeSettingsDefaults(p.settings) }));
  }

  static getProjectById(id: string): Project | undefined {
    const p = this.read().projects.find(p => p.id === id);
    return p ? { ...p, settings: mergeSettingsDefaults(p.settings) } : undefined;
  }

  static saveProject(project: Project): Project {
    const db = this.read();
    const index = db.projects.findIndex(p => p.id === project.id);
    if (index >= 0) {
      db.projects[index] = { ...project, updatedAt: new Date().toISOString() };
    } else {
      db.projects.push(project);
    }
    this.write(db);
    return project;
  }

  static deleteProject(id: string): {
    success: boolean;
    deletedDbRecordsCount: number;
    projectTitle: string;
    userId: string;
  } {
    const db = this.read();
    const project = db.projects.find(p => p.id === id);
    const projectTitle = project ? project.title : "Unknown Project";
    const userId = project ? project.userId : "u1";
    
    const beforeProjects = db.projects.length;
    const beforeScenes = db.scenes.length;
    const beforeJobs = db.jobs.length;

    db.projects = db.projects.filter(p => p.id !== id);
    db.scenes = db.scenes.filter(s => s.projectId !== id);
    db.jobs = db.jobs.filter(j => j.projectId !== id);

    const deletedProjectsCount = beforeProjects - db.projects.length;
    const deletedScenesCount = beforeScenes - db.scenes.length;
    const deletedJobsCount = beforeJobs - db.jobs.length;

    const deletedDbRecordsCount = deletedProjectsCount + deletedScenesCount + deletedJobsCount;
    this.write(db);

    return {
      success: deletedProjectsCount > 0,
      deletedDbRecordsCount,
      projectTitle,
      userId
    };
  }

  // Deletion Logs
  static getDeleteLogs(): DeleteLog[] {
    const db = this.read();
    if (!db.deletions) return [];
    return db.deletions;
  }

  static saveDeleteLog(log: DeleteLog): DeleteLog {
    const db = this.read();
    if (!db.deletions) {
      db.deletions = [];
    }
    db.deletions.unshift(log); // newest first
    this.write(db);
    return log;
  }

  // Scenes
  static getScenes(projectId: string): Scene[] {
    return this.read().scenes.filter(s => s.projectId === projectId).sort((a, b) => a.sceneIndex - b.sceneIndex);
  }

  static saveScenes(projectId: string, scenes: Scene[]): Scene[] {
    const db = this.read();
    // Remove old scenes for this project
    db.scenes = db.scenes.filter(s => s.projectId !== projectId);
    // Add new scenes
    db.scenes.push(...scenes);
    this.write(db);
    return scenes;
  }

  static updateScene(scene: Scene): Scene {
    const db = this.read();
    const index = db.scenes.findIndex(s => s.id === scene.id);
    if (index >= 0) {
      db.scenes[index] = scene;
    } else {
      db.scenes.push(scene);
    }
    this.write(db);
    return scene;
  }

  // Jobs
  static getJobs(): ProcessingJob[] {
    return this.read().jobs;
  }

  static getJobByProjectId(projectId: string): ProcessingJob | undefined {
    return this.read().jobs.find(j => j.projectId === projectId);
  }

  static saveJob(job: ProcessingJob): ProcessingJob {
    const db = this.read();
    const index = db.jobs.findIndex(j => j.id === job.id);
    if (index >= 0) {
      db.jobs[index] = { ...job, updatedAt: new Date().toISOString() };
    } else {
      db.jobs.push(job);
    }
    this.write(db);
    return job;
  }

  // Video Sources
  static getVideoSources(): VideoSource[] {
    return this.read().videoSources;
  }

  static saveVideoSource(source: VideoSource): VideoSource {
    const db = this.read();
    const index = db.videoSources.findIndex(s => s.id === source.id);
    if (index >= 0) {
      db.videoSources[index] = source;
    } else {
      db.videoSources.push(source);
    }
    this.write(db);
    return source;
  }

  // Default Settings
  static getDefaultSettings(): UserSettings {
    return mergeSettingsDefaults(this.read().defaultSettings);
  }

  static saveDefaultSettings(settings: UserSettings): UserSettings {
    const db = this.read();
    db.defaultSettings = settings;
    this.write(db);
    return settings;
  }

  // API Keys
  static getApiKeys(): ApiKeyConfig[] {
    return this.read().apiKeys || [];
  }

  static getApiKeyById(id: string): ApiKeyConfig | undefined {
    return this.getApiKeys().find(k => k.id === id);
  }

  static saveApiKey(config: ApiKeyConfig): ApiKeyConfig {
    const db = this.read();
    if (!db.apiKeys) {
      db.apiKeys = [];
    }
    const index = db.apiKeys.findIndex(k => k.id === config.id);
    if (index >= 0) {
      db.apiKeys[index] = config;
    } else {
      db.apiKeys.push(config);
    }
    this.write(db);
    return config;
  }

  // AI System Settings
  static getAiSystemSettings(): AISystemSettings {
    const db = this.read();
    if (!db.aiSystemSettings) {
      db.aiSystemSettings = {
        activeMode: "auto",
        smartRouting: "auto",
        defaultProvider: "gemini"
      };
      this.write(db);
    }
    return db.aiSystemSettings;
  }

  static saveAiSystemSettings(settings: AISystemSettings): AISystemSettings {
    const db = this.read();
    db.aiSystemSettings = settings;
    this.write(db);
    return settings;
  }

  // AI Usage Stats
  static getAiStats(): AIUsageStats {
    const db = this.read();
    if (!db.aiStats) {
      db.aiStats = {
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
      this.write(db);
    }
    return db.aiStats;
  }

  static saveAiStats(stats: AIUsageStats): AIUsageStats {
    const db = this.read();
    db.aiStats = stats;
    this.write(db);
    return stats;
  }

  static incrementAiRequest(providerId: AIProviderType, isSuccess: boolean) {
    const db = this.read();
    if (!db.aiStats) {
      db.aiStats = {
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
    }
    
    db.aiStats.totalRequests += 1;
    db.aiStats.lastUsedProvider = providerId;
    if (isSuccess) {
      db.aiStats.totalSuccess += 1;
    } else {
      db.aiStats.totalFailure += 1;
    }

    if (!db.aiStats.providers[providerId]) {
      db.aiStats.providers[providerId] = { requests: 0, success: 0, failures: 0 };
    }

    db.aiStats.providers[providerId].requests += 1;
    db.aiStats.providers[providerId].lastUsedAt = new Date().toISOString();
    if (isSuccess) {
      db.aiStats.providers[providerId].success += 1;
    } else {
      db.aiStats.providers[providerId].failures += 1;
    }

    // Also increment useCount on the apiKeyConfig
    if (!db.apiKeys) {
      db.apiKeys = [];
    }
    const apiKey = db.apiKeys.find(k => k.id === providerId);
    if (apiKey) {
      apiKey.useCount = (apiKey.useCount || 0) + 1;
    }

    this.write(db);
  }

  // === v15: Trend Alerts ===
  static getTrendAlertRules(): TrendAlertRule[] {
    return this.read().trendAlertRules || [];
  }

  static saveTrendAlertRule(rule: TrendAlertRule): TrendAlertRule {
    const db = this.read();
    if (!db.trendAlertRules) db.trendAlertRules = [];
    const idx = db.trendAlertRules.findIndex(r => r.id === rule.id);
    if (idx >= 0) db.trendAlertRules[idx] = rule;
    else db.trendAlertRules.push(rule);
    this.write(db);
    return rule;
  }

  static deleteTrendAlertRule(id: string): void {
    const db = this.read();
    db.trendAlertRules = (db.trendAlertRules || []).filter(r => r.id !== id);
    this.write(db);
  }

  static getTrendAlertNotifications(limit = 50): TrendAlertNotification[] {
    const all = this.read().trendAlertNotifications || [];
    return all.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, limit);
  }

  static addTrendAlertNotification(n: TrendAlertNotification): TrendAlertNotification {
    const db = this.read();
    if (!db.trendAlertNotifications) db.trendAlertNotifications = [];
    // Dedupe: skip if same videoTitle+keyword already notified
    const dup = db.trendAlertNotifications.find(x => x.videoTitle === n.videoTitle && x.keyword === n.keyword);
    if (dup) return dup;
    db.trendAlertNotifications.unshift(n);
    // Cap stored notifications at 200
    if (db.trendAlertNotifications.length > 200) db.trendAlertNotifications = db.trendAlertNotifications.slice(0, 200);
    this.write(db);
    return n;
  }

  static markTrendAlertRead(id: string): void {
    const db = this.read();
    const n = (db.trendAlertNotifications || []).find(x => x.id === id);
    if (n) { n.read = true; this.write(db); }
  }

  static markAllTrendAlertsRead(): void {
    const db = this.read();
    for (const n of db.trendAlertNotifications || []) n.read = true;
    this.write(db);
  }

  static clearTrendAlertNotifications(): void {
    const db = this.read();
    db.trendAlertNotifications = [];
    this.write(db);
  }

  // === v16: PIN Authentication ===
  static getAuth(): AuthConfig | undefined {
    return this.read().auth;
  }

  static setPinHash(pinHash: string): void {
    const db = this.read();
    if (!db.auth) db.auth = { pinHash: "", sessions: [] };
    db.auth.pinHash = pinHash;
    this.write(db);
  }

  static addSession(token: string, expiresAt: string): void {
    const db = this.read();
    if (!db.auth) db.auth = { pinHash: "", sessions: [] };
    // Prune expired sessions while we're here
    const now = Date.now();
    db.auth.sessions = db.auth.sessions.filter(s => new Date(s.expiresAt).getTime() > now);
    db.auth.sessions.push({ token, createdAt: new Date().toISOString(), expiresAt });
    // Cap sessions at 20
    if (db.auth.sessions.length > 20) db.auth.sessions = db.auth.sessions.slice(-20);
    this.write(db);
  }

  static isValidSession(token: string): boolean {
    const auth = this.read().auth;
    if (!auth) return false;
    const s = auth.sessions.find(x => x.token === token);
    if (!s) return false;
    return new Date(s.expiresAt).getTime() > Date.now();
  }

  static removeSession(token: string): void {
    const db = this.read();
    if (!db.auth) return;
    db.auth.sessions = db.auth.sessions.filter(s => s.token !== token);
    this.write(db);
  }
}
