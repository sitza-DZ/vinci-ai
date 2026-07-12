/**
 * Shared Type Definitions for the AI Shorts Generator
 */

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  passwordHash?: string;
  createdAt: string;
}

export enum ProjectStatus {
  DRAFT = "draft",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed"
}

export enum SubtitleStyleType {
  TIKTOK = "tiktok",
  MINIMAL = "minimal",
  YOUTUBE = "youtube",
  CINEMATIC = "cinematic",
  GAMING = "gaming",
  ARABIC_PREMIUM = "arabic_premium"
}

export interface SubtitleStyleConfig {
  type: SubtitleStyleType;
  fontSize: number; // in pixels or relative
  position: "top" | "center" | "bottom";
  opacity: number; // 0 to 1
  highlightColor: string; // hex
  fontFamily: string;
  emojiSupport: boolean;
  outlineColor: string;
  outlineWidth: number;
}

export enum ScriptTone {
  VIRAL = "viral",
  EDUCATIONAL = "educational",
  INSPIRATIONAL = "inspirational",
  HUMOROUS = "humorous",
  SERIOUS = "serious",
  MOTIVATIONAL = "motivational"
}

export enum TransitionType {
  NONE = "none",
  FADE = "fade",
  DISSOLVE = "dissolve",
  SLIDE_LEFT = "slideleft",
  SLIDE_RIGHT = "slideright",
  SLIDE_UP = "slideup",
  SLIDE_DOWN = "slidedown",
  ZOOM_IN = "zoomin",
  RADIAL = "radial",
  PIXELIZE = "pixelize",
  CIRCLE_OPEN = "circleopen",
  CIRCLE_CLOSE = "circleclose",
  WIPE_LEFT = "wipelr",
  WIPE_RIGHT = "wiperl",
  WIPE_UP = "wipetb",
  WIPE_DOWN = "wipebt",
  RANDOM = "random"
}

export interface AudioTrack {
  type: "voiceover" | "bgm";
  url: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  duration: number;
  format: string;
}

export interface AudioSettings {
  voiceVolume: number;    // 0-200 (percentage)
  musicVolume: number;    // 0-100 (percentage)
  bgmMode: "none" | "loop" | "trim" | "fade_in" | "fade_out" | "fade_both";
  autoSync: boolean;
}

export interface UserSettings {
  subtitleEnabled: boolean;
  subtitleStyle: SubtitleStyleType;
  videoLength: "short" | "medium" | "long"; // e.g. 15s, 30s, 60s
  sceneDuration: number; // target duration per scene in seconds, e.g. 4-6s
  qualitySelection: "high" | "ultra" | "1080p" | "720p";
  exportFormat: "mp4" | "mov";
  preferredSources: string[]; // e.g. ["pexels", "pixabay", "coverr", "mixkit", "tiktok", "pinterest"]
  fontSize?: number;
  wordSpacing?: number;
  letterSpacing?: number;
  videoTone?: ScriptTone;
  transitionType?: TransitionType;
  transitionDuration?: number; // seconds for xfade transition between clips (default 0.3)
  audioSettings?: AudioSettings;
  smartSceneDistribution?: boolean; // first 4 scenes @3s, rest @6s for 60s/12scenes
  autoSfxEnabled?: boolean;  // Auto place SFX based on scene text emotion
  edgeTtsEnabled?: boolean; // Enable edge-tts AI voice generation
  edgeTtsVoice?: string;    // edge-tts voice name (e.g. "hi-IN-SwaraNeural")
  edgeTtsRate?: string;    // edge-tts speech rate (e.g. "+0%", "-30%", "+50%")
}

export interface Project {
  id: string;
  userId: string;
  title: string;
  topic?: string;
  script?: string;
  status: ProjectStatus;
  settings: UserSettings;
  createdAt: string;
  updatedAt: string;
  renderedVideoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  fileSize?: string;
  scheduledAt?: string;   // ISO date for scheduled upload
  uploadScheduleStatus?: "pending" | "uploading" | "done" | "failed";
}

export interface Scene {
  id: string;
  projectId: string;
  sceneIndex: number;
  text: string; // The subtitle/narration text for this scene
  hook?: string; // Attention-grabbing hook text for this scene (e.g., "Wait for it... 🤯")
  visualDescription: string; // AI generated visual scene description
  keywords: string[]; // Search terms generated for finding footage
  selectedVideoUrl?: string;
  selectedVideoId?: string;
  selectedVideoProvider?: string;
  selectedVideoDuration?: number;
  selectedVideoPreviewUrl?: string; // thumbnail or first frame
  duration: number; // duration of this scene in seconds
}

export interface DownloadedClip {
  id: string;
  sceneId: string;
  url: string;
  localPath: string;
  provider: string;
  score: number;
  metadata: {
    title?: string;
    duration?: number;
    width?: number;
    height?: number;
    tags?: string[];
  };
}

export interface RenderDiagnostics {
  totalScenes: number;
  totalDownloadedClips: number;
  totalProcessedClips: number;
  subtitleStatus: "idle" | "generating" | "generated" | "error" | "disabled";
  ffmpegStatus: "idle" | "running" | "completed" | "failed";
  ffmpegCommand?: string;
  concatFileContents?: string;
  finalVideoDuration: number;
  sourceResolution?: string;
  renderResolution?: string;
  bitrate?: string;
  fps?: number;
  codec?: string;
  currentProjectId?: string;
  cacheStatus?: string;
  downloadCount?: number;
  processedClipCount?: number;
  cacheClearedStatus?: string;
  downloadDiagnostics?: {
    renderedFilePath: string;
    fileExists: boolean;
    fileSize: string;
    contentType: string;
    downloadUrl: string;
  };
}

export interface ProcessingJob {
  id: string;
  projectId: string;
  step: "idle" | "script" | "scenes" | "searching" | "downloading" | "rendering" | "completed" | "failed";
  progress: number; // 0 to 100
  logOutput: string[];
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  diagnostics?: RenderDiagnostics;
}

export interface VideoSource {
  id: string;
  name: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
}

export interface ApiKeyConfig {
  id: string; // "gemini" | "pexels" | "pixabay" | "nvidia"
  name: string;
  encryptedKey: string;
  enabled: boolean;
  status: "active" | "inactive" | "error" | "unconfigured";
  lastTested?: string;
  errorMessage?: string;
  useCount: number;
  hasKey?: boolean;
  maskedKey?: string;
  model?: string; // NVIDIA NIM model selection
}

export interface StockClip {
  id: string;
  provider: "pexels" | "pixabay" | "coverr" | "mixkit" | "instagram" | "tiktok" | "pinterest";
  url: string;
  previewUrl: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  tags: string[];
  relevanceScore: number;
  scoreExplanation: string;
  aspectRatio: "9:16" | "16:9" | "other";
}

export interface DeleteLog {
  id: string;
  userId: string;
  projectId: string;
  projectTitle: string;
  deletedFilesCount: number;
  deletedDbRecordsCount: number;
  status: "success" | "failed";
  errorMessage?: string;
  timestamp: string;
}

export interface AudioLibraryTrack {
  id: string;
  title: string;
  url: string;       // Pixabay preview URL or local cache URL
  tags: string[];
  duration: number;
  localPath?: string; // if cached locally
  provider: "pixabay" | "local";
}

export type AIProviderType = "gemini" | "groq" | "openrouter" | "nvidia";
export type AIMode = "gemini" | "groq" | "openrouter" | "nvidia" | "auto";

// NVIDIA NIM Free Models (120+ free models from api.nvidia.com)
export const NVIDIA_MODELS = [
  // NVIDIA Nemotron & Llama Nemotron
  "nvidia/nemotron-4-340b-reward", "nvidia/nemotron-4-340b-instruct",
  "nvidia/nemotron-3-ultra-550b-a55b", "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-nano-30b-a3b", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/nemotron-3-content-safety", "nvidia/nemotron-3.5-content-safety",
  "nvidia/nemotron-content-safety-reasoning-4b", "nvidia/nemotron-mini-4b-instruct",
  "nvidia/nemotron-nano-3-30b-a3b", "nvidia/nemotron-nano-12b-v2-vl",
  "nvidia/nvidia-nemotron-nano-9b-v2",
  "nvidia/llama-3.1-nemotron-70b-instruct", "nvidia/llama-3.1-nemotron-51b-instruct",
  "nvidia/llama-3.1-nemotron-ultra-253b-v1", "nvidia/llama-3.1-nemotron-nano-8b-v1",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "nvidia/llama-3.1-nemotron-safety-guard-8b-v3",
  "nvidia/llama-3.1-nemoguard-8b-content-safety", "nvidia/llama-3.1-nemoguard-8b-topic-control",
  "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1", "nvidia/llama-3.2-nv-embedqa-1b-v1",
  "nvidia/llama-3.3-nemotron-super-49b-v1", "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/llama-nemotron-embed-1b-v2", "nvidia/llama-nemotron-embed-vl-1b-v2",
  "nvidia/llama3-chatqa-1.5-70b",
  // NVIDIA Embedding & Vision
  "nvidia/nv-embed-v1", "nvidia/nv-embedqa-e5-v5", "nvidia/nv-embedqa-mistral-7b-v2",
  "nvidia/nv-embedcode-7b-v1", "nvidia/nvclip", "nvidia/embed-qa-4",
  "nvidia/neva-22b", "nvidia/vila",
  "nvidia/cosmos-reason2-8b", "nvidia/ai-synthetic-video-detector",
  "nvidia/gliner-pii", "nvidia/ising-calibration-1-35b-a3b",
  "nvidia/mistral-nemo-minitron-8b-8k-instruct",
  "nvidia/nemoretriever-parse", "nvidia/nemotron-parse",
  "nvidia/riva-translate-4b-instruct", "nvidia/riva-translate-4b-instruct-v1.1",
  // Meta Llama
  "meta/llama-3.1-405b-instruct", "meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct",
  "meta/llama-3.2-90b-vision-instruct", "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-3b-instruct", "meta/llama-3.2-1b-instruct",
  "meta/llama-3.3-70b-instruct", "meta/llama-4-maverick-17b-128e-instruct",
  "meta/llama-guard-4-12b", "meta/llama2-70b", "meta/codellama-70b",
  // Mistral AI
  "mistralai/mistral-7b-instruct-v0.3", "mistralai/mistral-large",
  "mistralai/mistral-large-2-instruct", "mistralai/mistral-large-3-675b-instruct-2512",
  "mistralai/mistral-medium-3.5-128b", "mistralai/mistral-nemotron",
  "mistralai/mistral-small-4-119b-2603", "mistralai/mixtral-8x22b-v0.1",
  "mistralai/mixtral-8x7b-instruct-v0.1", "mistralai/codestral-22b-instruct-v0.1",
  "mistralai/ministral-14b-instruct-2512",
  "nv-mistralai/mistral-nemo-12b-instruct",
  // Google Gemma
  "google/gemma-2-27b-it", "google/gemma-2-9b-it", "google/gemma-2-2b-it",
  "google/gemma-2b", "google/gemma-3-12b-it", "google/gemma-3-4b-it",
  "google/gemma-3n-e2b-it", "google/gemma-3n-e4b-it", "google/gemma-4-31b-it",
  "google/recurrentgemma-2b", "google/codegemma-1.1-7b", "google/codegemma-7b",
  "google/deplot", "google/diffusiongemma-26b-a4b-it",
  // Microsoft Phi
  "microsoft/phi-3-vision-128k-instruct", "microsoft/phi-3.5-moe-instruct",
  "microsoft/phi-4-mini-instruct", "microsoft/phi-4-multimodal-instruct", "microsoft/kosmos-2",
  // DeepSeek
  "deepseek-ai/deepseek-coder-6.7b-instruct", "deepseek-ai/deepseek-v4-flash", "deepseek-ai/deepseek-v4-pro",
  // Qwen
  "qwen/qwen3-next-80b-a3b-instruct", "qwen/qwen3.5-122b-a10b", "qwen/qwen3.5-397b-a17b",
  // Writers & Enterprise
  "writer/palmyra-creative-122b", "writer/palmyra-fin-70b-32k",
  "writer/palmyra-med-70b", "writer/palmyra-med-70b-32k",
  // Other notable
  "01-ai/yi-large", "abacusai/dracarys-llama-3.1-70b-instruct",
  "adept/fuyu-8b", "ai21labs/jamba-1.5-large-instruct",
  "aisingapore/sea-lion-7b-instruct", "baai/bge-m3",
  "bigcode/starcoder2-15b", "bytedance/seed-oss-36b-instruct",
  "databricks/dbrx-instruct", "ibm/granite-3.0-3b-a800m-instruct",
  "ibm/granite-3.0-8b-instruct", "ibm/granite-34b-code-instruct", "ibm/granite-8b-code-instruct",
  "minimaxai/minimax-m2.7", "minimaxai/minimax-m3",
  "moonshotai/kimi-k2.6", "openai/gpt-oss-120b", "openai/gpt-oss-20b",
  "sarvamai/sarvam-m", "snowflake/arctic-embed-l",
  "stepfun-ai/step-3.5-flash", "stepfun-ai/step-3.7-flash",
  "stockmark/stockmark-2-100b-instruct", "upstage/solar-10.7b-instruct",
  "z-ai/glm-5.2", "zyphra/zamba2-7b-instruct",
] as const;

export type NvidiaModel = typeof NVIDIA_MODELS[number];
export type SmartRoutingStrategy = "cheapest" | "fastest" | "quality" | "auto";

export interface AIProviderStats {
  requests: number;
  success: number;
  failures: number;
  lastUsedAt?: string;
}

export interface AIUsageStats {
  totalRequests: number;
  totalSuccess: number;
  totalFailure: number;
  lastUsedProvider?: string;
  providers: {
    gemini: AIProviderStats;
    groq: AIProviderStats;
    openrouter: AIProviderStats;
    nvidia: AIProviderStats;
  };
}

export interface AISystemSettings {
  activeMode: AIMode;
  smartRouting: SmartRoutingStrategy;
  defaultProvider: AIProviderType;
}


