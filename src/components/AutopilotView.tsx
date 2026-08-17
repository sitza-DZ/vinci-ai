/**
 * AutopilotView — hands-free "topic → finished uploaded video" automation.
 * Configure topics/category, voice, default BGM, target channel and approval
 * mode; watch the live queue as the engine generates, renders and schedules
 * each video at the niche's best posting time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Rocket, Play, Pause, Plus, Trash2, RefreshCw, Loader2, CheckCircle2,
  XCircle, Clock, Film, Music, Mic, Sparkles, ChevronDown, ChevronUp,
  CalendarClock, ShieldCheck, Hand, Zap, Type, Timer, Settings2, Upload
} from "lucide-react";

interface Account { id: string; channelTitle: string; email?: string; isDefault: boolean }

interface AutopilotConfig {
  enabled: boolean;
  approvalMode: "auto" | "approve" | "manual";
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
  accountId: string;
  /** Optional user-chosen upload date (YYYY-MM-DD). "" = auto best posting time. */
  scheduleDate: string;
  /** Optional user-chosen upload time (HH:mm, IST). "" = auto best posting time. */
  scheduleTime: string;
  autoGenerateTopics: boolean;
  autoEmoji: boolean;
  smartSceneDistribution: boolean;
  autoHashtags: boolean;
  features: Record<string, any>;
  lastRunAt?: string;
}

type QueueStatus =
  | "pending" | "generating" | "rendering" | "awaiting_approval"
  | "rendered" | "scheduled" | "uploaded" | "failed" | "cancelled";

interface QueueItem {
  id: string;
  topic: string;
  status: QueueStatus;
  projectId?: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  videoId?: string;
  title?: string;
}

interface AutopilotState {
  config: AutopilotConfig;
  queue: QueueItem[];
  processing: boolean;
  accounts: Account[];
}

const STATUS_META: Record<QueueStatus, { label: string; color: string; icon: any }> = {
  pending: { label: "Queued", color: "text-slate-400", icon: Clock },
  generating: { label: "Generating", color: "text-blue-400", icon: Loader2 },
  rendering: { label: "Rendering", color: "text-amber-400", icon: Film },
  awaiting_approval: { label: "Awaiting Approval", color: "text-purple-400", icon: Hand },
  rendered: { label: "Rendered", color: "text-cyan-400", icon: CheckCircle2 },
  scheduled: { label: "Scheduled", color: "text-indigo-400", icon: CalendarClock },
  uploaded: { label: "Uploaded", color: "text-emerald-400", icon: CheckCircle2 },
  failed: { label: "Failed", color: "text-red-400", icon: XCircle },
  cancelled: { label: "Cancelled", color: "text-slate-500", icon: XCircle }
};

interface BgmTrack { name: string; label: string; url: string; filePath: string; duration?: number; source?: string }

const DURATION_OPTIONS = [15, 30, 45, 60];
const RATE_PRESETS = [
  { label: "Slow", value: -30 },
  { label: "Normal", value: 0 },
  { label: "Fast", value: 20 }
];

// ---- Full project feature option lists (mirror src/types.ts) ----
const SUBTITLE_STYLES = [
  { v: "tiktok", l: "TikTok" }, { v: "minimal", l: "Minimal" }, { v: "youtube", l: "YouTube" },
  { v: "cinematic", l: "Cinematic" }, { v: "gaming", l: "Gaming" }, { v: "arabic_premium", l: "Arabic Premium" },
  { v: "karaoke", l: "Karaoke" }, { v: "word_pop", l: "Word Pop" }, { v: "typewriter", l: "Typewriter" }
];
const ASPECT_RATIOS = [
  { v: "9:16", l: "9:16 (Shorts)" }, { v: "1:1", l: "1:1 (Square)" }, { v: "16:9", l: "16:9 (Wide)" }
];
const TONES = [
  { v: "viral", l: "Viral" }, { v: "educational", l: "Educational" }, { v: "inspirational", l: "Inspirational" },
  { v: "humorous", l: "Humorous" }, { v: "serious", l: "Serious" }, { v: "motivational", l: "Motivational" }
];
const TRANSITIONS = [
  "none", "fade", "dissolve", "slideleft", "slideright", "slideup", "slidedown", "zoomin",
  "radial", "pixelize", "circleopen", "circleclose", "wipelr", "wiperl", "wipetb", "wipebt",
  "glitch", "glitchv", "whippan", "zoomthrough", "flashblack", "blurmorph", "windwipe",
  "coverleft", "revealright", "squeeze", "diagonal", "circlecrop", "rectcrop", "distance",
  "grayscale", "vertopen", "horzopen", "random"
];
const COLOR_GRADES = ["none", "cinematic", "warm", "cool", "vintage", "vibrant", "noir"];
const VOICE_EFFECTS = [
  { v: "none", l: "None" }, { v: "deep", l: "Deep" }, { v: "chipmunk", l: "Chipmunk" },
  { v: "robot", l: "Robot" }, { v: "echo", l: "Echo" }, { v: "radio", l: "Radio" }
];
const EMOJI_OVERLAYS = [
  { v: "none", l: "None" }, { v: "auto", l: "Auto" }, { v: "hype", l: "Hype" }
];
const VIDEO_TEMPLATES = [
  { v: "none", l: "None" }, { v: "mrbeast", l: "MrBeast" }, { v: "horror", l: "Horror" },
  { v: "motivational", l: "Motivational" }, { v: "documentary", l: "Documentary" }
];
const QUALITIES = ["720p", "1080p", "high", "ultra"];
const WM_POSITIONS = [
  { v: "tl", l: "Top Left" }, { v: "tr", l: "Top Right" }, { v: "bl", l: "Bottom Left" }, { v: "br", l: "Bottom Right" }
];

const fmtTime = (iso?: string) => {
  if (!iso) return "—";
  // Always show scheduled times in Indian Standard Time so they match when the
  // upload actually fires, regardless of the viewer's device timezone.
  try {
    return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST";
  } catch { return iso; }
};

// Today's date in IST as YYYY-MM-DD (used for the date picker / Aaj / Kal).
const istDateStr = (offsetDays = 0): string => {
  const d = new Date(Date.now() + offsetDays * 86400000);
  // Format the wall-clock date as seen in Asia/Kolkata.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA gives YYYY-MM-DD
};

// Convert a stored UTC ISO timestamp to its IST wall-clock date (YYYY-MM-DD).
const isoToIstDate = (iso?: string): string => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch { return iso.slice(0, 10); }
};

// Convert a stored UTC ISO timestamp to its IST wall-clock time (HH:mm).
const isoToIstTime = (iso?: string): string => {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch { return ""; }
};

const path2name = (p: string) => {
  const base = p.split(/[\\/]/).pop() || p;
  return base.replace(/\.(mp3|wav|m4a|ogg)$/i, "").replace(/_/g, " ");
};

// "+20%" / "-30%" / "0%" -> number
const parseRate = (r?: string) => {
  const n = parseInt(r || "0", 10);
  return isNaN(n) ? 0 : Math.max(-50, Math.min(50, n));
};
const fmtRate = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;

export default function AutopilotView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [state, setState] = useState<AutopilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [genPreview, setGenPreview] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [bgmTracks, setBgmTracks] = useState<BgmTrack[]>([]);
  const [voices, setVoices] = useState<{ ShortName: string; Gender: string; Locale: string; FriendlyName: string }[]>([]);
  // Local drafts for free-text fields. The 5s poll must NEVER overwrite what
  // the user is typing — inputs bind to these drafts, not to server state.
  const [draft, setDraft] = useState<{ category: string; region: string } | null>(null);
  const [titlePanel, setTitlePanel] = useState<{ id: string; loading: boolean; options: string[] } | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [showFeatures, setShowFeatures] = useState(true);
  // Per-item reschedule draft: { itemId: { date, time } } — applied via button.
  const [reschedDraft, setReschedDraft] = useState<Record<string, { date: string; time: string }>>({});
  const pollRef = useRef<any>(null);
  const saveTimer = useRef<any>(null);

  const flash = (type: "success" | "error", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilot");
      if (res.ok) {
        const data = await res.json();
        setState(data);
        // Initialise the drafts ONCE from the server config; after that the
        // user's typing is the source of truth (no more cursor jumps/deletes).
        setDraft(d => d ?? { category: data?.config?.category || "", region: data?.config?.region || "" });
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 5000);
    return () => {
      clearInterval(pollRef.current);
      clearTimeout(saveTimer.current);
    };
  }, [load]);

  // Load available BGM tracks (built-in + uploaded) for the default-BGM picker,
  // and the edge-tts voice list for the voice dropdown.
  const loadBgmTracks = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilot/bgm");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tracks)) setBgmTracks(data.tracks);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadBgmTracks();
    (async () => {
      try {
        const vres = await fetch("/api/voices");
        if (vres.ok) {
          const vdata = await vres.json();
          if (Array.isArray(vdata.voices) && vdata.voices.length) setVoices(vdata.voices);
        }
      } catch {}
    })();
  }, [loadBgmTracks]);

  // Upload a new BGM track for Autopilot (base64, same shape as main project)
  const [bgmUploading, setBgmUploading] = useState(false);
  const bgmFileRef = useRef<HTMLInputElement>(null);
  const handleBgmUpload = async (file: File) => {
    if (!file) return;
    if (!/\.(mp3|wav)$/i.test(file.name)) {
      flash("error", "Sirf MP3 ya WAV file upload karein");
      return;
    }
    setBgmUploading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        try {
          const b64 = reader.result as string;
          const res = await fetch("/api/autopilot/bgm/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audioData: b64,
              format: file.name.toLowerCase().endsWith(".wav") ? "wav" : "mp3",
              name: file.name.replace(/\.(mp3|wav)$/i, "")
            })
          });
          const data = await res.json();
          if (data.success && data.track) {
            await loadBgmTracks();
            // Auto-select the freshly uploaded track as default BGM
            saveConfig({ defaultBgmPath: data.track.filePath, defaultBgmName: data.track.label }, true);
            flash("success", `BGM uploaded: ${data.track.label}`);
          } else {
            flash("error", data.error || "Upload failed");
          }
        } catch (e: any) {
          flash("error", e.message || "Upload failed");
        } finally {
          setBgmUploading(false);
          if (bgmFileRef.current) bgmFileRef.current.value = "";
        }
      };
    } catch (e: any) {
      setBgmUploading(false);
      flash("error", e.message || "Upload failed");
    }
  };

  const handleBgmDelete = async (track: BgmTrack) => {
    if (track.source !== "uploaded") return;
    try {
      const res = await fetch(`/api/autopilot/bgm/${encodeURIComponent(track.name)}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        // Clear default if it was pointing at the deleted track
        if (cfg.defaultBgmPath === track.filePath) {
          saveConfig({ defaultBgmPath: "", defaultBgmName: "" }, true);
        }
        await loadBgmTracks();
        flash("success", "BGM deleted");
      } else {
        flash("error", data.error || "Delete failed");
      }
    } catch (e: any) {
      flash("error", e.message || "Delete failed");
    }
  };

  const saveConfig = async (patch: Partial<AutopilotConfig>, silent = false) => {
    setSaving(true);
    try {
      const res = await fetch("/api/autopilot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      if (data.success) {
        setState(s => s ? { ...s, config: data.config } : s);
        if (!silent) flash("success", "Settings saved");
      } else if (!silent) flash("error", data.error || "Save failed");
    } catch (e: any) {
      if (!silent) flash("error", e.message || "Save failed");
    }
    setSaving(false);
  };

  // Debounced save for free-text fields: saves ~900ms after typing stops.
  const onDraftChange = (field: "category" | "region", value: string) => {
    setDraft(d => ({ ...(d || { category: "", region: "" }), [field]: value }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveConfig({ [field]: value } as Partial<AutopilotConfig>, true);
    }, 900);
  };

  // Update a single key inside the features override map.
  const setFeature = (key: string, value: any) => {
    const features = { ...(state?.config.features || {}), [key]: value };
    saveConfig({ features } as Partial<AutopilotConfig>, true);
  };

  // Upload a watermark/logo image (base64) and store its URL in features.
  const uploadWatermark = async (file: File) => {
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/watermarks/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileData: b64, fileName: file.name })
      });
      const data = await res.json();
      if (data.success) {
        setFeature("watermarkUrl", data.url);
        setFeature("watermarkEnabled", true);
        flash("success", "Watermark uploaded");
      } else flash("error", data.error || "Upload failed");
    } catch (e: any) { flash("error", e.message); }
  };

  const toggleEnabled = () => {
    if (!state) return;
    saveConfig({ enabled: !state.config.enabled });
  };

  const addTopic = async () => {
    const t = newTopic.trim();
    if (!t) return;
    try {
      const res = await fetch("/api/autopilot/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: [t] })
      });
      const data = await res.json();
      if (data.success) { setNewTopic(""); setState(s => s ? { ...s, queue: data.queue } : s); flash("success", "Topic queued"); }
      else flash("error", data.error || "Failed");
    } catch (e: any) { flash("error", e.message); }
  };

  const removeItem = async (id: string) => {
    try {
      const res = await fetch(`/api/autopilot/queue/${id}`, { method: "DELETE" });
      const data = await res.json();
      setState(s => s ? { ...s, queue: data.queue } : s);
      if (titlePanel?.id === id) setTitlePanel(null);
    } catch {}
  };

  const approveItem = async (id: string) => {
    try {
      const res = await fetch(`/api/autopilot/queue/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (data.success) { setState(s => s ? { ...s, queue: data.queue } : s); flash("success", "Approved & scheduled"); }
      else flash("error", data.error || "Approve failed");
    } catch (e: any) { flash("error", e.message); }
  };

  // Re-schedule a scheduled/rendered item to a specific date/time ("" = auto best time)
  const rescheduleItem = async (id: string, date: string, time: string) => {
    try {
      const res = await fetch(`/api/autopilot/queue/${id}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time })
      });
      const data = await res.json();
      if (data.success) {
        setState(s => s ? { ...s, queue: data.queue } : s);
        flash("success", date ? `Rescheduled to ${date}${time ? " " + time + " IST" : ""}` : "Rescheduled to best time");
      } else flash("error", data.error || "Reschedule failed");
    } catch (e: any) { flash("error", e.message); }
  };

  const generateTopics = async () => {
    // Always read the freshest typed value from the draft.
    const cat = ((draft?.category ?? "") || state?.config.category || "").trim();
    if (!cat) { flash("error", "Pehle category set karein"); return; }
    setGenLoading(true);
    setGenPreview([]);
    try {
      // Ensure the category is persisted server-side before generating.
      await fetch("/api/autopilot/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat })
      });
      const res = await fetch("/api/autopilot/generate-topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, count: 5 })
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.topics) && data.topics.length) setGenPreview(data.topics);
      else flash("error", data.error || "Generation failed");
    } catch (e: any) { flash("error", e.message); }
    setGenLoading(false);
  };

  const queueGenerated = async () => {
    if (!genPreview.length) return;
    try {
      const res = await fetch("/api/autopilot/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: genPreview })
      });
      const data = await res.json();
      if (data.success) { setGenPreview([]); setState(s => s ? { ...s, queue: data.queue } : s); flash("success", `${genPreview.length} topics queued`); }
    } catch (e: any) { flash("error", e.message); }
  };

  // ---- Per-topic AI title generation + selection ----
  const genTitles = async (id: string) => {
    setTitlePanel({ id, loading: true, options: [] });
    setCustomTitle("");
    try {
      const res = await fetch(`/api/autopilot/queue/${id}/titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 4 })
      });
      const data = await res.json();
      if (data.success) {
        setTitlePanel({ id, loading: false, options: data.titles || [] });
        if (data.queue) setState(s => s ? { ...s, queue: data.queue } : s);
      } else {
        flash("error", data.error || "Title generation failed");
        setTitlePanel(null);
      }
    } catch (e: any) {
      flash("error", e.message);
      setTitlePanel(null);
    }
  };

  const pickTitle = async (id: string, title: string) => {
    try {
      const res = await fetch(`/api/autopilot/queue/${id}/select-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await res.json();
      if (data.success) {
        setState(s => s ? { ...s, queue: data.queue } : s);
        setTitlePanel(null);
        flash("success", title ? "Title selected" : "Title cleared — auto SEO title use hogi");
      } else flash("error", data.error || "Failed");
    } catch (e: any) { flash("error", e.message); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/autopilot/run", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setState(s => s ? { ...s, queue: data.queue, config: data.config || s.config } : s);
        flash("success", data.processedId ? "Processing started — Autopilot ON" : "Queue empty — nothing to run");
      }
    } catch (e: any) { flash("error", e.message); }
    setRunning(false);
  };

  if (loading || !state || !draft) {
    return (
      <div className="card p-10 flex flex-col items-center gap-3 text-muted">
        <Loader2 className="w-8 h-8 animate-spin text-brand" />
        Loading Autopilot…
      </div>
    );
  }

  const cfg = state.config;
  const feat = cfg.features || {};
  const queue = state.queue;
  const accounts = state.accounts;
  const activeCount = queue.filter(i => ["pending", "generating", "rendering", "scheduled", "awaiting_approval"].includes(i.status)).length;
  const isWorking = queue.some(i => i.status === "generating" || i.status === "rendering");
  const rateNum = parseRate(cfg.voiceRate);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Rocket className="w-6 h-6 text-brand" />
            Autopilot Mode
          </h1>
          <p className="text-sm text-muted mt-1">
            Topics do — system khud script, voiceover, BGM, render aur best-time upload karega.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runNow} disabled={running || state.processing} className="btn btn-secondary btn-sm">
            {running || state.processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Run Now
          </button>
          <button
            onClick={toggleEnabled}
            className={`btn btn-sm ${cfg.enabled ? "btn-primary" : "btn-secondary"}`}
          >
            {cfg.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {cfg.enabled ? "Autopilot ON" : "Autopilot OFF"}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`card p-3 text-sm font-semibold ${msg.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs text-muted">Status</div>
          {cfg.enabled ? (
            <div className="text-lg font-bold text-emerald-400 flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span></span>
              Active
            </div>
          ) : isWorking ? (
            <div className="text-lg font-bold text-amber-400 flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Running (Manual)
            </div>
          ) : (
            <div className="text-lg font-bold text-slate-400">Paused</div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Active in queue</div>
          <div className="text-lg font-bold text-ink">{activeCount}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Uploaded</div>
          <div className="text-lg font-bold text-emerald-400">{queue.filter(i => i.status === "uploaded").length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Last run</div>
          <div className="text-sm font-semibold text-ink">{cfg.lastRunAt ? fmtTime(cfg.lastRunAt) : "Never"}</div>
        </div>
      </div>

      {/* Config panel */}
      <div className="card">
        <button onClick={() => setShowConfig(v => !v)} className="w-full flex items-center justify-between p-4 text-left">
          <span className="font-semibold text-ink flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-brand" /> Autopilot Settings</span>
          {showConfig ? <ChevronUp className="w-5 h-5 text-muted" /> : <ChevronDown className="w-5 h-5 text-muted" />}
        </button>

        {showConfig && (
          <div className="p-4 pt-0 space-y-5">
            {/* Approval mode */}
            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wide">Approval Mode</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {([
                  { v: "auto", label: "Full Auto", desc: "Render + auto upload", icon: Zap },
                  { v: "approve", label: "Approve First", desc: "Render, phir aap approve karo", icon: Hand },
                  { v: "manual", label: "Manual Upload", desc: "Sirf render + schedule", icon: Film }
                ] as const).map(o => (
                  <button
                    key={o.v}
                    onClick={() => saveConfig({ approvalMode: o.v })}
                    className={`btn btn-sm ${cfg.approvalMode === o.v ? "btn-primary" : "btn-secondary"}`}
                  >
                    <o.icon className="w-4 h-4" /> {o.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted mt-1">
                {cfg.approvalMode === "auto" ? "Bilkul hands-free — video ban ke khud upload ho jayegi." :
                 cfg.approvalMode === "approve" ? "Video render hone ke baad aap approve karoge tabhi upload hogi." :
                 "Video render + schedule hogi, upload aap khud trigger karoge."}
              </p>
            </div>

            {/* Category + region + videos/day */}
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide">Category / Niche</label>
                <input
                  value={draft.category}
                  onChange={e => onDraftChange("category", e.target.value)}
                  placeholder="e.g. Kids stories, Tech facts"
                  className="input mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide">Region</label>
                <input
                  value={draft.region}
                  onChange={e => onDraftChange("region", e.target.value)}
                  placeholder="e.g. India, Global"
                  className="input mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide">Videos / Day</label>
                <div className="flex gap-1.5 mt-1">
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => saveConfig({ videosPerDay: n }, true)}
                      className={`btn btn-sm flex-1 ${cfg.videosPerDay === n ? "btn-primary" : "btn-secondary"}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1">YouTube API quota me ~6 uploads/day possible hain.</p>
              </div>
            </div>

            {/* Video duration */}
            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1"><Timer className="w-3 h-3" /> Video Duration</label>
              <div className="flex gap-2 mt-2">
                {DURATION_OPTIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => saveConfig({ duration: d }, true)}
                    className={`btn btn-sm flex-1 ${cfg.duration === d ? "btn-primary" : "btn-secondary"}`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {/* ===== ALL VIDEO FEATURES ===== */}
            <div className="card border-indigo-500/20">
              <button onClick={() => setShowFeatures(v => !v)} className="w-full flex items-center justify-between p-3 text-left">
                <span className="text-sm font-semibold text-ink flex items-center gap-2"><Settings2 className="w-4 h-4 text-indigo-400" /> All Video Features <span className="text-xs text-muted font-normal">(har feature on/off + options)</span></span>
                {showFeatures ? <ChevronUp className="w-4 h-4 text-muted" /> : <ChevronDown className="w-4 h-4 text-muted" />}
              </button>

              {showFeatures && (
                <div className="px-3 pb-3 space-y-4">

                  {/* --- Format & Quality --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Format & Quality</div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted">Aspect Ratio</label>
                        <select value={feat.aspectRatio || "9:16"} onChange={e => setFeature("aspectRatio", e.target.value)} className="input mt-1 w-full">
                          {ASPECT_RATIOS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Quality</label>
                        <select value={feat.qualitySelection || "1080p"} onChange={e => setFeature("qualitySelection", e.target.value)} className="input mt-1 w-full">
                          {QUALITIES.map(q => <option key={q} value={q}>{q}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Export Format</label>
                        <select value={feat.exportFormat || "mp4"} onChange={e => setFeature("exportFormat", e.target.value)} className="input mt-1 w-full">
                          <option value="mp4">MP4</option>
                          <option value="mov">MOV</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* --- Subtitles --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Subtitles</div>
                    <div className="grid md:grid-cols-3 gap-3 items-end">
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer pb-2">
                        <input type="checkbox" checked={cfg.subtitlesEnabled !== false} onChange={e => saveConfig({ subtitlesEnabled: e.target.checked }, true)} className="w-4 h-4 accent-indigo-500" />
                        Enable Subtitles
                      </label>
                      <div>
                        <label className="text-xs text-muted">Style</label>
                        <select value={feat.subtitleStyle || "tiktok"} onChange={e => setFeature("subtitleStyle", e.target.value)} className="input mt-1 w-full">
                          {SUBTITLE_STYLES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Font Size: {feat.fontSize ?? 14}px</label>
                        <input type="range" min={8} max={32} value={feat.fontSize ?? 14} onChange={e => setFeature("fontSize", Number(e.target.value))} className="w-full mt-2 accent-indigo-500" />
                      </div>
                    </div>
                  </div>

                  {/* --- Script & AI --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Script & AI</div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted">Script Tone</label>
                        <select value={feat.videoTone || "viral"} onChange={e => setFeature("videoTone", e.target.value)} className="input mt-1 w-full">
                          {TONES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Language</label>
                        <select value={feat.language || "en-US"} onChange={e => setFeature("language", e.target.value)} className="input mt-1 w-full">
                          <option value="en-US">English (US)</option>
                          <option value="hi-IN">Hindi</option>
                          <option value="ur-PK">Urdu</option>
                          <option value="es-ES">Spanish</option>
                          <option value="ar-SA">Arabic</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 items-center">
                        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                          <input type="checkbox" checked={cfg.autoEmoji !== false} onChange={e => saveConfig({ autoEmoji: e.target.checked }, true)} className="w-4 h-4 accent-indigo-500" />
                          Auto Emoji
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                          <input type="checkbox" checked={cfg.autoHashtags !== false} onChange={e => saveConfig({ autoHashtags: e.target.checked }, true)} className="w-4 h-4 accent-indigo-500" />
                          Auto Hashtags
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer col-span-2" title="Lambi videos ke liye scenes smartly distribute hote hain">
                          <input type="checkbox" checked={cfg.smartSceneDistribution === true} onChange={e => saveConfig({ smartSceneDistribution: e.target.checked }, true)} className="w-4 h-4 accent-indigo-500" />
                          Smart Scene Distribution
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* --- Transitions --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Transitions</div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted">Transition Type</label>
                        <select value={feat.transitionType || "fade"} onChange={e => setFeature("transitionType", e.target.value)} className="input mt-1 w-full">
                          {TRANSITIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Duration: {(feat.transitionDuration ?? 0.3).toFixed(1)}s</label>
                        <input type="range" min={0} max={1.5} step={0.1} value={feat.transitionDuration ?? 0.3} onChange={e => setFeature("transitionDuration", Number(e.target.value))} className="w-full mt-2 accent-indigo-500" />
                      </div>
                    </div>
                  </div>

                  {/* --- Visual Effects --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Visual Effects</div>
                    <div className="grid md:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-muted">Color Grade</label>
                        <select value={feat.colorGrade || "none"} onChange={e => setFeature("colorGrade", e.target.value)} className="input mt-1 w-full">
                          {COLOR_GRADES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Emoji Overlays</label>
                        <select value={feat.emojiOverlays || "none"} onChange={e => setFeature("emojiOverlays", e.target.value)} className="input mt-1 w-full">
                          {EMOJI_OVERLAYS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Video Template</label>
                        <select value={feat.videoTemplate || "none"} onChange={e => setFeature("videoTemplate", e.target.value)} className="input mt-1 w-full">
                          {VIDEO_TEMPLATES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5 mt-2">
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.kenBurnsEnabled !== false} onChange={e => setFeature("kenBurnsEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Ken Burns Zoom
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.aiThumbnail !== false} onChange={e => setFeature("aiThumbnail", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        AI Thumbnail
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.footageQualityFilter !== false} onChange={e => setFeature("footageQualityFilter", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Footage Quality Filter
                      </label>
                    </div>
                  </div>

                  {/* --- Audio --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Audio</div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted">Voice Effect</label>
                        <select value={feat.voiceEffect || "none"} onChange={e => setFeature("voiceEffect", e.target.value)} className="input mt-1 w-full">
                          {VOICE_EFFECTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Voice Volume: {cfg.voiceVolume}%</label>
                        <input type="range" min={0} max={200} value={cfg.voiceVolume} onChange={e => saveConfig({ voiceVolume: Number(e.target.value) }, true)} className="w-full mt-2 accent-indigo-500" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 mt-2">
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.duckingEnabled !== false} onChange={e => setFeature("duckingEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Music Ducking
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.silenceRemoval === true} onChange={e => setFeature("silenceRemoval", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Silence Removal
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.beatSyncEnabled === true} onChange={e => setFeature("beatSyncEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Beat Sync
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.autoSfxEnabled === true} onChange={e => setFeature("autoSfxEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Auto SFX
                      </label>
                    </div>
                  </div>

                  {/* --- Watermark / Logo --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Watermark / Logo</div>
                    <div className="grid md:grid-cols-3 gap-3 items-end">
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                          <input type="checkbox" checked={feat.watermarkEnabled === true} onChange={e => setFeature("watermarkEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                          Enable Watermark
                        </label>
                        <label className="btn btn-secondary btn-sm cursor-pointer inline-flex items-center gap-1">
                          <Plus className="w-3 h-3" /> Upload Logo
                          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadWatermark(f); e.target.value = ""; }} />
                        </label>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Position</label>
                        <select value={feat.watermarkPosition || "br"} onChange={e => setFeature("watermarkPosition", e.target.value)} className="input mt-1 w-full">
                          {WM_POSITIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-muted">Size: {feat.watermarkSize ?? 15}%</label>
                        <input type="range" min={5} max={40} value={feat.watermarkSize ?? 15} onChange={e => setFeature("watermarkSize", Number(e.target.value))} className="w-full mt-2 accent-indigo-500" />
                      </div>
                    </div>
                    {feat.watermarkUrl && (
                      <div className="flex items-center gap-2 mt-2 bg-slate-950 border border-slate-800 rounded-lg p-1.5 w-fit">
                        <img src={feat.watermarkUrl} alt="watermark" className="w-8 h-8 object-contain bg-white rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        <span className="text-[10px] font-mono text-slate-400 truncate max-w-[140px]">{String(feat.watermarkUrl).split("/").pop()}</span>
                        <button onClick={() => { setFeature("watermarkEnabled", false); setFeature("watermarkUrl", ""); }} className="text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer">Remove</button>
                      </div>
                    )}
                  </div>

                  {/* --- CTA End Card --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">CTA End Card</div>
                    <div className="grid md:grid-cols-3 gap-3 items-end">
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer pb-2">
                        <input type="checkbox" checked={feat.ctaEnabled === true} onChange={e => setFeature("ctaEnabled", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Enable CTA
                      </label>
                      <div className="md:col-span-2">
                        <label className="text-xs text-muted">CTA Text</label>
                        <input value={feat.ctaText || ""} onChange={e => setFeature("ctaText", e.target.value)} placeholder="e.g. Subscribe for more! 🔔" className="input mt-1 w-full" />
                      </div>
                    </div>
                  </div>

                  {/* --- Footage Sources --- */}
                  <div>
                    <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-2">Footage Sources</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1.5">
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.autoTikTokSource === true} onChange={e => setFeature("autoTikTokSource", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Auto TikTok Source
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                        <input type="checkbox" checked={feat.blurTikTokWatermark === true} onChange={e => setFeature("blurTikTokWatermark", e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                        Blur TikTok Watermark
                      </label>
                    </div>
                  </div>

                </div>
              )}
            </div>

            {/* Auto-generate topics */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfg.autoGenerateTopics}
                  onChange={e => saveConfig({ autoGenerateTopics: e.target.checked }, true)}
                  className="w-4 h-4 accent-indigo-500"
                />
                Auto-generate topics from category (AI)
              </label>
              <button onClick={generateTopics} disabled={genLoading} className="btn btn-secondary btn-sm">
                {genLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate Topic Ideas
              </button>
            </div>

            {genPreview.length > 0 && (
              <div className="card p-3 bg-indigo-500/5 border-indigo-500/20 space-y-2">
                <div className="text-xs font-semibold text-indigo-400">AI Topic Suggestions — queue me add karein:</div>
                {genPreview.map((t, i) => (
                  <div key={i} className="text-sm text-ink flex items-start gap-2">
                    <span className="text-indigo-400">•</span> {t}
                  </div>
                ))}
                <button onClick={queueGenerated} className="btn btn-primary btn-sm mt-1">
                  <Plus className="w-4 h-4" /> Queue All {genPreview.length}
                </button>
              </div>
            )}

            {/* Voice + BGM + channel */}
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1"><Mic className="w-3 h-3" /> Edge-TTS Voice</label>
                {voices.length > 0 ? (
                  <select
                    value={cfg.voice}
                    onChange={e => saveConfig({ voice: e.target.value }, true)}
                    className="input mt-1 w-full"
                  >
                    {!voices.some(v => v.ShortName === cfg.voice) && cfg.voice && (
                      <option value={cfg.voice}>{cfg.voice}</option>
                    )}
                    {voices.map(v => (
                      <option key={v.ShortName} value={v.ShortName}>
                        {v.ShortName} ({v.Gender})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={cfg.voice}
                    onChange={e => saveConfig({ voice: e.target.value }, true)}
                    placeholder="hi-IN-SwaraNeural"
                    className="input mt-1 w-full"
                  />
                )}
                <div className="mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted">Voice Speed</span>
                    <span className="text-xs font-bold text-ink">{fmtRate(rateNum)}</span>
                  </div>
                  <input
                    type="range" min={-50} max={50} step={5}
                    value={rateNum}
                    onChange={e => saveConfig({ voiceRate: fmtRate(Number(e.target.value)) }, true)}
                    className="w-full mt-1 accent-indigo-500"
                  />
                  <div className="flex gap-1.5 mt-1">
                    {RATE_PRESETS.map(p => (
                      <button
                        key={p.label}
                        onClick={() => saveConfig({ voiceRate: fmtRate(p.value) }, true)}
                        className={`btn btn-sm flex-1 ${rateNum === p.value ? "btn-primary" : "btn-secondary"}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1"><Music className="w-3 h-3" /> Default BGM</label>
                <select
                  value={cfg.defaultBgmPath}
                  onChange={e => {
                    const t = bgmTracks.find(x => x.filePath === e.target.value);
                    saveConfig({ defaultBgmPath: e.target.value, defaultBgmName: t?.label || (e.target.value ? path2name(e.target.value) : "") }, true);
                  }}
                  className="input mt-1 w-full"
                >
                  <option value="">No background music</option>
                  {bgmTracks.map(t => (
                    <option key={t.filePath} value={t.filePath}>
                      {t.label}{t.source === "uploaded" ? " (uploaded)" : ""}
                    </option>
                  ))}
                </select>
                {/* Upload / delete BGM */}
                <div className="flex items-center gap-2 mt-2">
                  <input
                    ref={bgmFileRef}
                    type="file"
                    accept=".mp3,.wav,audio/mpeg,audio/wav"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleBgmUpload(f);
                    }}
                  />
                  <button
                    onClick={() => bgmFileRef.current?.click()}
                    disabled={bgmUploading}
                    className="btn btn-sm btn-secondary flex items-center gap-1"
                  >
                    {bgmUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                    {bgmUploading ? "Uploading..." : "Upload BGM"}
                  </button>
                  {(() => {
                    const sel = bgmTracks.find(t => t.filePath === cfg.defaultBgmPath);
                    return sel && sel.source === "uploaded" ? (
                      <button
                        onClick={() => handleBgmDelete(sel)}
                        className="btn btn-sm btn-secondary flex items-center gap-1 text-red-400"
                        title="Delete uploaded track"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    ) : null;
                  })()}
                </div>
                <div className="text-xs text-muted mt-2">Music volume: {cfg.musicVolume}%</div>
                <input
                  type="range" min={0} max={100}
                  value={cfg.musicVolume}
                  onChange={e => saveConfig({ musicVolume: Number(e.target.value) }, true)}
                  className="w-full mt-1 accent-indigo-500"
                />
                <p className="text-xs text-muted mt-1">Apna music upload karein (MP3/WAV) — upload hote hi default BGM set ho jayega. Built-in tracks delete nahi ho sakte.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1"><Film className="w-3 h-3" /> Target Channel</label>
                <select
                  value={cfg.accountId}
                  onChange={e => saveConfig({ accountId: e.target.value }, true)}
                  className="input mt-1 w-full"
                >
                  <option value="">Default channel</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.channelTitle}{a.isDefault ? " (default)" : ""}</option>
                  ))}
                </select>
                <p className="text-xs text-muted mt-2">
                  Baaki saare video features (subtitles, transitions, effects, watermark, CTA) upar "All Video Features" panel me hain.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Upload Date</label>
                <input
                  type="date"
                  value={cfg.scheduleDate || ""}
                  min={istDateStr(0)}
                  onChange={e => saveConfig({ scheduleDate: e.target.value }, true)}
                  className="input mt-1 w-full"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => saveConfig({ scheduleDate: "" }, true)}
                    className={`btn btn-sm flex-1 ${!cfg.scheduleDate ? "btn-primary" : "btn-secondary"}`}
                  >
                    Auto (Best Time)
                  </button>
                  <button
                    onClick={() => saveConfig({ scheduleDate: istDateStr(0) }, true)}
                    className={`btn btn-sm flex-1 ${cfg.scheduleDate === istDateStr(0) ? "btn-primary" : "btn-secondary"}`}
                  >
                    Aaj
                  </button>
                  <button
                    onClick={() => saveConfig({ scheduleDate: istDateStr(1) }, true)}
                    className={`btn btn-sm flex-1 ${cfg.scheduleDate === istDateStr(1) ? "btn-primary" : "btn-secondary"}`}
                  >
                    Kal
                  </button>
                </div>

                {/* Manual time selection (IST) */}
                <label className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1 mt-3"><CalendarClock className="w-3 h-3" /> Upload Time (IST)</label>
                <input
                  type="time"
                  value={cfg.scheduleTime || ""}
                  onChange={e => saveConfig({ scheduleTime: e.target.value }, true)}
                  className="input mt-1 w-full"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => saveConfig({ scheduleTime: "" }, true)}
                    className={`btn btn-sm flex-1 ${!cfg.scheduleTime ? "btn-primary" : "btn-secondary"}`}
                  >
                    Auto Time
                  </button>
                </div>

                <p className="text-xs text-muted mt-2">
                  {cfg.scheduleTime
                    ? (cfg.scheduleDate
                        ? `Video ${cfg.scheduleDate} ko ${cfg.scheduleTime} IST par upload hogi.`
                        : `Video har roz ${cfg.scheduleTime} IST par upload hogi.`)
                    : (cfg.scheduleDate
                        ? `Video ${cfg.scheduleDate} ko upload hogi (us din ke best time par).`
                        : "Auto: har video apne best posting time par upload hogi.")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add topic */}
      <div className="card p-4">
        <label className="text-xs font-semibold text-muted uppercase tracking-wide">Add Topic Manually</label>
        <div className="flex gap-2 mt-2">
          <input
            value={newTopic}
            onChange={e => setNewTopic(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addTopic()}
            placeholder="e.g. 5 amazing space facts IN HINDI"
            className="input flex-1"
          />
          <button onClick={addTopic} className="btn btn-primary btn-sm"><Plus className="w-4 h-4" /> Add</button>
        </div>
      </div>

      {/* Queue */}
      <div className="card">
        <div className="p-4 flex items-center justify-between">
          <span className="font-semibold text-ink">Autopilot Queue</span>
          <button onClick={load} className="btn btn-secondary btn-sm"><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>
        <div className="divide-y divide-white/5">
          {queue.length === 0 && (
            <div className="p-8 text-center text-muted text-sm">Queue khali hai. Upar se topic add karein ya category se auto-generate karein.</div>
          )}
          {[...queue].reverse().map(item => {
            const meta = STATUS_META[item.status] || STATUS_META.pending;
            const Icon = meta.icon;
            const spinning = item.status === "generating" || item.status === "rendering";
            const canEditTitle = !["uploaded", "cancelled"].includes(item.status);
            const panelOpen = titlePanel?.id === item.id;
            return (
              <div key={item.id} className="p-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <Icon className={`w-5 h-5 ${meta.color} ${spinning ? "animate-spin" : ""}`} />
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-semibold text-ink truncate">{item.topic}</div>
                    <div className="text-xs text-muted">
                      {meta.label}
                      {item.scheduledAt && ` · ${fmtTime(item.scheduledAt)}`}
                      {item.projectId && ` · ${item.projectId}`}
                    </div>
                    {item.title && (
                      <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                        <Type className="w-3 h-3" /> Title: {item.title}
                      </div>
                    )}
                    {item.error && <div className="text-xs text-red-400 mt-1">{item.error}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditTitle && (
                      <button onClick={() => panelOpen ? setTitlePanel(null) : genTitles(item.id)} className="btn btn-secondary btn-sm" title="AI title options">
                        {panelOpen && titlePanel?.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Type className="w-4 h-4" />}
                        Title
                      </button>
                    )}
                    {item.status === "awaiting_approval" && (
                      <button onClick={() => approveItem(item.id)} className="btn btn-primary btn-sm"><CheckCircle2 className="w-4 h-4" /> Approve</button>
                    )}
                    {(item.status === "scheduled" || item.status === "rendered") && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          min={istDateStr(0)}
                          value={reschedDraft[item.id]?.date ?? isoToIstDate(item.scheduledAt)}
                          onChange={e => setReschedDraft(d => ({ ...d, [item.id]: { date: e.target.value, time: reschedDraft[item.id]?.time ?? isoToIstTime(item.scheduledAt) } }))}
                          className="input btn-sm w-[140px] text-xs"
                          title="Change upload date"
                        />
                        <input
                          type="time"
                          value={reschedDraft[item.id]?.time ?? isoToIstTime(item.scheduledAt)}
                          onChange={e => setReschedDraft(d => ({ ...d, [item.id]: { date: reschedDraft[item.id]?.date ?? isoToIstDate(item.scheduledAt), time: e.target.value } }))}
                          className="input btn-sm w-[100px] text-xs"
                          title="Change upload time (IST)"
                        />
                        <button
                          onClick={() => {
                            const dr = reschedDraft[item.id];
                            if (dr?.date) { rescheduleItem(item.id, dr.date, dr.time || ""); setReschedDraft(d => { const { [item.id]: _, ...rest } = d; return rest; }); }
                          }}
                          className="btn btn-primary btn-sm"
                          title="Apply new date/time"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {item.projectId && (
                      <button onClick={() => onNavigate && (window as any).__openProject?.(item.projectId)} className="btn btn-secondary btn-sm" title="Open project">
                        <Film className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => removeItem(item.id)} className="btn btn-secondary btn-sm" title="Remove">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Title selection panel */}
                {panelOpen && !titlePanel.loading && (
                  <div className="mt-3 ml-8 card p-3 bg-indigo-500/5 border-indigo-500/20 space-y-2">
                    <div className="text-xs font-semibold text-indigo-400">Title choose karein (upload isi se hogi):</div>
                    {(titlePanel.options || []).map((t, i) => (
                      <button
                        key={i}
                        onClick={() => pickTitle(item.id, t)}
                        className={`w-full text-left text-sm rounded-lg px-3 py-2 border transition ${item.title === t ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-ink hover:border-indigo-500/40"}`}
                      >
                        {t}
                      </button>
                    ))}
                    {(titlePanel.options || []).length === 0 && (
                      <div className="text-xs text-muted">Koi option nahi mila — neeche khud likh kar set karein.</div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <input
                        value={customTitle}
                        onChange={e => setCustomTitle(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && customTitle.trim() && pickTitle(item.id, customTitle.trim())}
                        placeholder="Ya apni title yahan likhein…"
                        className="input flex-1"
                      />
                      <button onClick={() => customTitle.trim() && pickTitle(item.id, customTitle.trim())} className="btn btn-primary btn-sm">Set</button>
                      {item.title && (
                        <button onClick={() => pickTitle(item.id, "")} className="btn btn-secondary btn-sm" title="Auto SEO title wapas lao">Clear</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
