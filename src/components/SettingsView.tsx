import React, { useState, useEffect } from "react";
import {
  Sliders,
  Database,
  Key,
  Lock,
  Save,
  RefreshCw,
  Eye,
  EyeOff,
  Activity,
  Check,
  AlertCircle,
  Power,
  Server,
  User,
  Film,
  Upload,
  Globe,
  Mic,
  Play,
  ExternalLink,
  LogOut
} from "lucide-react";
import { SubtitleStyleType, UserSettings, VideoSource, ApiKeyConfig, AISystemSettings, AIUsageStats, NVIDIA_MODELS } from "../types";

interface SettingsViewProps {
  onProfileUpdate?: () => void;
}

// v14: every boolean feature exposed as an on/off switch in Global Workspace Defaults
const FEATURE_TOGGLES: { key: keyof UserSettings; label: string; desc: string }[] = [
  { key: "smartSceneDistribution", label: "Smart Scene Distribution", desc: "First 4 scenes fast (3s), rest smooth (5s)" },
  { key: "subtitleEnabled", label: "Subtitle Overlay", desc: "Burn subtitles into the video" },
  { key: "autoSfxEnabled", label: "Auto Sound Effects", desc: "Place SFX by scene emotion" },
  { key: "edgeTtsEnabled", label: "AI Voiceover (Edge TTS)", desc: "Generate AI narration voice" },
  { key: "autoTikTokSource", label: "Auto TikTok Source", desc: "Search TikTok for scene footage" },
  { key: "blurTikTokWatermark", label: "Blur Watermark", desc: "Blur watermark region on clips" },
  { key: "watermarkEnabled", label: "Custom Watermark", desc: "Overlay your logo on videos" },
  { key: "ctaEnabled", label: "End-Card CTA", desc: "Call-to-action overlay at the end" },
  { key: "autoEmoji", label: "Auto Emojis", desc: "Add emojis to hooks" },
  { key: "autoHashtags", label: "Auto Hashtags", desc: "Generate hashtags for upload" },
  { key: "kenBurnsEnabled", label: "Ken Burns Effect", desc: "Zoom/pan on image scenes" },
  { key: "duckingEnabled", label: "Music Ducking", desc: "Lower music during voiceover" },
  { key: "aiThumbnail", label: "AI Thumbnail Text", desc: "Overlay title on thumbnail" },
  { key: "silenceRemoval", label: "Silence Removal", desc: "Cut silent gaps from voiceover" },
  { key: "footageQualityFilter", label: "Footage Quality Filter", desc: "Auto-swap low-res clips for HD" },
  { key: "beatSyncEnabled", label: "Beat-Sync Cuts", desc: "Snap scene cuts to BGM beats" },
];

export default function SettingsView({ onProfileUpdate }: SettingsViewProps) {
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [defaultSettings, setDefaultSettings] = useState<UserSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [alertMsg, setAlertMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Tabs state
  const [activeTab, setActiveTab] = useState<"defaults" | "keys" | "ai" | "youtube" | "profile" | "security">("defaults");

  // Profile fields state
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileRole, setProfileRole] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // AI Providers state
  const [aiSettings, setAiSettings] = useState<AISystemSettings | null>(null);
  const [aiStats, setAiStats] = useState<AIUsageStats | null>(null);
  const [isSavingAi, setIsSavingAi] = useState(false);

  // API Keys state
  const [keys, setKeys] = useState<ApiKeyConfig[]>([]);
  const [inputKeys, setInputKeys] = useState<Record<string, string>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Logout handler — clears session cookie and returns to landing page
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore network errors — still clear local state
    } finally {
      // Reload to drop back to the landing page (session cookie cleared server-side)
      window.location.reload();
    }
  };

  // v16: Voice Cloning (Colab XTTS server)
  const [vcTesting, setVcTesting] = useState(false);
  const [vcTestResult, setVcTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [vcPreviewing, setVcPreviewing] = useState(false);
  const [vcPreviewUrl, setVcPreviewUrl] = useState<string | null>(null);
  const [vcPreviewMsg, setVcPreviewMsg] = useState<string | null>(null);

  // Fetch settings & API keys
  const fetchSettingsAndKeys = async () => {
    setIsLoading(true);
    try {
      const srcRes = await fetch("/api/sources");
      const setRes = await fetch("/api/settings");
      const keyRes = await fetch("/api/keys");
      const userRes = await fetch("/api/user");
      const aiRes = await fetch("/api/ai/config");
      
      if (srcRes.ok && setRes.ok && keyRes.ok) {
        setSources(await srcRes.json());
        setDefaultSettings(await setRes.json());
        
        const fetchedKeys: ApiKeyConfig[] = await keyRes.json();
        setKeys(fetchedKeys);
        
        // Initialize inputs with masked values if set
        const initialInputs: Record<string, string> = {};
        fetchedKeys.forEach(k => {
          initialInputs[k.id] = k.hasKey ? k.maskedKey : "";
        });
        setInputKeys(initialInputs);
      }

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        setAiSettings(aiData.systemSettings);
        setAiStats(aiData.stats);
      }

      if (userRes.ok) {
        const u = await userRes.json();
        setProfileName(u.name || "");
        setProfileEmail(u.email || "");
        setProfileAvatarUrl(u.avatarUrl || "");
        setProfileRole(u.role || "");
      }
    } catch (e) {
      console.error("Failed to load settings data", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettingsAndKeys();
  }, []);

  const handleToggleSource = async (sourceId: string) => {
    try {
      const res = await fetch(`/api/sources/${sourceId}/toggle`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setSources(sources.map(s => s.id === sourceId ? updated : s));
        
        // Also refresh keys list to keep toggles in sync
        const keyRes = await fetch("/api/keys");
        if (keyRes.ok) {
          setKeys(await keyRes.json());
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!defaultSettings) return;
    setIsSaving(true);
    setAlertMsg(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaultSettings)
      });
      if (res.ok) {
        setAlertMsg({ type: "success", text: "Global settings successfully updated!" });
        setTimeout(() => setAlertMsg(null), 3000);
      }
    } catch (e: any) {
      setAlertMsg({ type: "error", text: e.message || "Failed to update settings" });
    } finally {
      setIsSaving(false);
    }
  };

  // API key handlers
  const handleInputChange = (id: string, value: string) => {
    setInputKeys(prev => ({ ...prev, [id]: value }));
  };

  // v16: Voice Cloning handlers
  const handleVcTest = async () => {
    if (!defaultSettings) return;
    setVcTesting(true);
    setVcTestResult(null);
    try {
      const res = await fetch("/api/voice-clone/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: (defaultSettings as any).voiceCloneUrl || "" })
      });
      const data = await res.json();
      setVcTestResult({ ok: !!data.success, detail: data.detail || data.error || "Unknown result" });
    } catch (e: any) {
      setVcTestResult({ ok: false, detail: e.message || "Connection failed" });
    } finally {
      setVcTesting(false);
    }
  };

  const handleVcPreview = async () => {
    if (!defaultSettings) return;
    setVcPreviewing(true);
    setVcPreviewUrl(null);
    setVcPreviewMsg(null);
    try {
      const res = await fetch("/api/voice-clone/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: (defaultSettings as any).voiceCloneUrl || "" })
      });
      const data = await res.json();
      if (data.success && data.audioUrl) {
        setVcPreviewUrl(data.audioUrl);
        setVcPreviewMsg(data.message || "Preview ready");
      } else {
        setVcPreviewMsg(data.error || "Preview generation failed");
      }
    } catch (e: any) {
      setVcPreviewMsg(e.message || "Preview request failed");
    } finally {
      setVcPreviewing(false);
    }
  };

  const toggleVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSaveKey = async (id: string) => {
    setSavingId(id);
    setAlertMsg(null);
    const keyValue = inputKeys[id] || "";

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, key: keyValue })
      });

      if (res.ok) {
        setAlertMsg({ type: "success", text: `${id.toUpperCase()} API Key configuration updated successfully!` });
        
        // Reload keys
        const keyRes = await fetch("/api/keys");
        if (keyRes.ok) {
          const updatedKeys: ApiKeyConfig[] = await keyRes.json();
          setKeys(updatedKeys);
          
          // Re-initialize this specific input
          const matchingKey = updatedKeys.find(k => k.id === id);
          if (matchingKey) {
            setInputKeys(prev => ({ ...prev, [id]: matchingKey.hasKey ? matchingKey.maskedKey : "" }));
          }
        }
        
        // Reload sources in case changed
        const srcRes = await fetch("/api/sources");
        if (srcRes.ok) {
          setSources(await srcRes.json());
        }

        setTimeout(() => setAlertMsg(null), 4000);
      } else {
        const errData = await res.json();
        setAlertMsg({ type: "error", text: errData.error || "Failed to update key." });
      }
    } catch (e: any) {
      setAlertMsg({ type: "error", text: e.message || "Error saving key" });
    } finally {
      setSavingId(null);
    }
  };

  const handleModelChange = async (id: string, model: string) => {
    try {
      const res = await fetch(`/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, model })
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, model } : k));
        setAlertMsg({ type: "success", text: `${id.toUpperCase()} model updated to ${model}` });
        setTimeout(() => setAlertMsg(null), 2000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleTestKey = async (id: string) => {
    setTestingId(id);
    setAlertMsg(null);

    try {
      const res = await fetch(`/api/keys/${id}/test`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        
        // Reload keys to get updated status and lastTested date
        const keyRes = await fetch("/api/keys");
        if (keyRes.ok) {
          setKeys(await keyRes.json());
        }

        if (data.success) {
          setAlertMsg({ type: "success", text: `Connection test succeeded for ${id.toUpperCase()}! Your credentials are valid.` });
        } else {
          setAlertMsg({ type: "error", text: `Connection test failed for ${id.toUpperCase()}: ${data.errorMessage}` });
        }
        setTimeout(() => setAlertMsg(null), 6000);
      } else {
        const errText = await res.text();
        setAlertMsg({ type: "error", text: `Server error during connection test: ${errText}` });
      }
    } catch (e: any) {
      setAlertMsg({ type: "error", text: `Failed to test connection: ${e.message}` });
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleKeyProvider = async (id: string) => {
    try {
      const res = await fetch(`/api/keys/${id}/toggle`, { method: "POST" });
      if (res.ok) {
        // Reload keys
        const keyRes = await fetch("/api/keys");
        if (keyRes.ok) {
          setKeys(await keyRes.json());
        }
        
        // Reload sources in case changed
        const srcRes = await fetch("/api/sources");
        if (srcRes.ok) {
          setSources(await srcRes.json());
        }

        setAlertMsg({ type: "success", text: `${id.toUpperCase()} provider toggled successfully!` });
        setTimeout(() => setAlertMsg(null), 3000);
      }
    } catch (e: any) {
      setAlertMsg({ type: "error", text: `Failed to toggle provider: ${e.message}` });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setAlertMsg(null);

    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName,
          email: profileEmail,
          avatarUrl: profileAvatarUrl,
          role: profileRole
        })
      });

      if (res.ok) {
        setAlertMsg({ type: "success", text: "Creator profile updated successfully!" });
        if (onProfileUpdate) {
          onProfileUpdate();
        }
        setTimeout(() => setAlertMsg(null), 4000);
      } else {
        const err = await res.json();
        setAlertMsg({ type: "error", text: err.error || "Failed to update profile." });
      }
    } catch (err: any) {
      setAlertMsg({ type: "error", text: err.message || "An error occurred." });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiSettings) return;
    setIsSavingAi(true);
    setAlertMsg(null);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiSettings)
      });
      if (res.ok) {
        const data = await res.json();
        setAiSettings(data.settings);
        setAlertMsg({ type: "success", text: "AI Router settings successfully updated!" });
        setTimeout(() => setAlertMsg(null), 3000);
      } else {
        const err = await res.json();
        setAlertMsg({ type: "error", text: err.error || "Failed to save AI settings." });
      }
    } catch (e: any) {
      setAlertMsg({ type: "error", text: e.message || "Failed to update AI settings" });
    } finally {
      setIsSavingAi(false);
    }
  };

  const handleResetAiStats = async () => {
    if (!window.confirm("Are you sure you want to reset all AI Provider usage statistics?")) return;
    try {
      const res = await fetch("/api/ai/stats/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAiStats(data.stats);
        setAlertMsg({ type: "success", text: "Usage statistics successfully reset!" });
        setTimeout(() => setAlertMsg(null), 3000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (isLoading || !defaultSettings) {
    return (
      <div className="py-24 text-center">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold text-ink">Settings</h2>
          <p className="text-slate-400 text-sm mt-1">
            Configure default video ratios, override global subtitle templates, and manage secure external APIs.
          </p>
        </div>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider font-mono border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/60 transition-all cursor-pointer disabled:opacity-50"
          title="Sign out and return to the landing page"
        >
          <LogOut className="w-4 h-4" />
          {isLoggingOut ? "Signing out…" : "Logout"}
        </button>
      </div>

      {/* Elegant Sub-navigation Bar */}
      <div className="flex border-b border-slate-800 pb-px">
        <button
          onClick={() => setActiveTab("defaults")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer ${
            activeTab === "defaults"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          General Defaults
        </button>
        <button
          onClick={() => setActiveTab("keys")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "keys"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          Stock APIs
        </button>
        <button
          onClick={() => setActiveTab("ai")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "ai"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          AI Providers Settings
        </button>
        <button
          onClick={() => setActiveTab("youtube")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "youtube"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          YouTube
        </button>
        <button
          onClick={() => setActiveTab("profile")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "profile"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <User className="w-3.5 h-3.5" />
          Creator Profile
        </button>
        <button
          onClick={() => setActiveTab("security")}
          className={`px-5 py-3 text-xs font-bold uppercase tracking-wider font-mono border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            activeTab === "security"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          Security
        </button>
      </div>

      {alertMsg && (
        <div className={`p-4 rounded-xl text-xs font-semibold border ${
          alertMsg.type === "success" 
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
            : "bg-rose-500/10 border-rose-500/20 text-rose-400"
        }`}>
          {alertMsg.text}
        </div>
      )}

      {activeTab === "defaults" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* LEFT COLUMN - Global Defaults Form (2 cols) */}
          <form onSubmit={handleSaveSettings} className="md:col-span-2 bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono border-b border-slate-800 pb-3 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              Global Workspace Defaults
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Preferred format */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Render Format</label>
                <select
                  value={defaultSettings.exportFormat}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, exportFormat: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none"
                >
                  <option value="mp4">H264 MP4 (Optimized for Web)</option>
                  <option value="mov">ProRes MOV (Lossless Master)</option>
                </select>
              </div>

              {/* Default Pacing */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Target Clip Pacing</label>
                <select
                  value={defaultSettings.videoLength}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, videoLength: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none"
                >
                  <option value="short">15s Short (Fast loop)</option>
                  <option value="medium">30s Standard (Reels/TikTok)</option>
                  <option value="long">60s Narrative (YouTube Shorts)</option>
                </select>
              </div>

              {/* Default Subtitle Style preset */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Default Subtitle Style</label>
                <select
                  value={defaultSettings.subtitleStyle}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, subtitleStyle: e.target.value as SubtitleStyleType })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none"
                >
                  <option value={SubtitleStyleType.TIKTOK}>TikTok Bold Highlights</option>
                  <option value={SubtitleStyleType.YOUTUBE}>YouTube Shorts Outline</option>
                  <option value={SubtitleStyleType.MINIMAL}>Elegant Minimal</option>
                  <option value={SubtitleStyleType.CINEMATIC}>Cinematic Serif</option>
                  <option value={SubtitleStyleType.GAMING}>Neon Gaming Yellow</option>
                  <option value={SubtitleStyleType.ARABIC_PREMIUM}>Arabic Premium (RTL)</option>
                  <option value={SubtitleStyleType.KARAOKE}>🎤 Karaoke Fill Sweep</option>
                  <option value={SubtitleStyleType.WORD_POP}>💥 Word Pop (MrBeast)</option>
                  <option value={SubtitleStyleType.TYPEWRITER}>⌨️ Typewriter Reveal</option>
                </select>
              </div>

              {/* Default Font Scale */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono uppercase font-bold text-slate-300">
                  <label>Default Font Scale</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.fontSize !== undefined ? defaultSettings.fontSize : 14;
                        setDefaultSettings({ ...defaultSettings, fontSize: Math.max(0, current - 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={defaultSettings.fontSize !== undefined ? defaultSettings.fontSize : 14}
                      onChange={(e) => {
                        let val = Number(e.target.value);
                        if (isNaN(val)) val = 0;
                        setDefaultSettings({ ...defaultSettings, fontSize: Math.min(100, Math.max(0, val)) });
                      }}
                      className="w-12 text-center bg-slate-950 border border-slate-800 rounded text-xs text-slate-300 outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.fontSize !== undefined ? defaultSettings.fontSize : 14;
                        setDefaultSettings({ ...defaultSettings, fontSize: Math.min(100, current + 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      +
                    </button>
                    <span className="text-slate-400 ml-0.5">px</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={defaultSettings.fontSize !== undefined ? defaultSettings.fontSize : 14}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, fontSize: Number(e.target.value) })}
                  className="w-full accent-indigo-600 bg-slate-950 h-1.5 rounded-full cursor-pointer"
                />
              </div>

              {/* Default Word Spacing */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono uppercase font-bold text-slate-300">
                  <label>Default Word Spacing</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.wordSpacing !== undefined ? defaultSettings.wordSpacing : 8;
                        setDefaultSettings({ ...defaultSettings, wordSpacing: Math.max(0, current - 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={defaultSettings.wordSpacing !== undefined ? defaultSettings.wordSpacing : 8}
                      onChange={(e) => {
                        let val = Number(e.target.value);
                        if (isNaN(val)) val = 0;
                        setDefaultSettings({ ...defaultSettings, wordSpacing: Math.min(50, Math.max(0, val)) });
                      }}
                      className="w-12 text-center bg-slate-950 border border-slate-800 rounded text-xs text-slate-300 outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.wordSpacing !== undefined ? defaultSettings.wordSpacing : 8;
                        setDefaultSettings({ ...defaultSettings, wordSpacing: Math.min(50, current + 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      +
                    </button>
                    <span className="text-slate-400 ml-0.5">px</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={defaultSettings.wordSpacing !== undefined ? defaultSettings.wordSpacing : 8}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, wordSpacing: Number(e.target.value) })}
                  className="w-full accent-indigo-600 bg-slate-950 h-1.5 rounded-full cursor-pointer"
                />
              </div>

              {/* Default Letter Spacing */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono uppercase font-bold text-slate-300">
                  <label>Default Letter Spacing</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.letterSpacing !== undefined ? defaultSettings.letterSpacing : 8;
                        setDefaultSettings({ ...defaultSettings, letterSpacing: Math.max(0, current - 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={defaultSettings.letterSpacing !== undefined ? defaultSettings.letterSpacing : 8}
                      onChange={(e) => {
                        let val = Number(e.target.value);
                        if (isNaN(val)) val = 0;
                        setDefaultSettings({ ...defaultSettings, letterSpacing: Math.min(50, Math.max(0, val)) });
                      }}
                      className="w-12 text-center bg-slate-950 border border-slate-800 rounded text-xs text-slate-300 outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const current = defaultSettings.letterSpacing !== undefined ? defaultSettings.letterSpacing : 8;
                        setDefaultSettings({ ...defaultSettings, letterSpacing: Math.min(50, current + 1) });
                      }}
                      className="btn btn-ghost btn-xs"
                    >
                      +
                    </button>
                    <span className="text-slate-400 ml-0.5">px</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={defaultSettings.letterSpacing !== undefined ? defaultSettings.letterSpacing : 8}
                  onChange={(e) => setDefaultSettings({ ...defaultSettings, letterSpacing: Number(e.target.value) })}
                  className="w-full accent-indigo-600 bg-slate-950 h-1.5 rounded-full cursor-pointer"
                />
              </div>
            </div>

            {/* ===== v14: FEATURE TOGGLES — on/off for every function ===== */}
            <div className="border-t border-slate-800 pt-5 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Power className="w-3.5 h-3.5 text-indigo-400" />
                  Feature Toggles
                </h4>
                <span className="text-[10px] font-mono text-slate-500">
                  {FEATURE_TOGGLES.filter(t => (defaultSettings as any)[t.key] === true).length}/{FEATURE_TOGGLES.length} ON
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {FEATURE_TOGGLES.map(t => {
                  const isOn = (defaultSettings as any)[t.key] === true;
                  return (
                    <div
                      key={t.key}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                        isOn ? "bg-indigo-600/10 border-indigo-500/40" : "bg-slate-950 border-slate-800/85"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-bold font-mono ${isOn ? "text-indigo-300" : "text-slate-300"}`}>{t.label}</p>
                        <p className="text-[10px] text-slate-500 leading-snug">{t.desc}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        aria-label={t.label}
                        onClick={() => setDefaultSettings({ ...defaultSettings, [t.key]: !isOn })}
                        className={`w-11 h-6 rounded-full transition-all relative flex-shrink-0 cursor-pointer ${
                          isOn ? "bg-indigo-600" : "bg-slate-800"
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                          isOn ? "translate-x-5" : "translate-x-0"
                        }`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ===== v16: VOICE CLONING (Colab XTTS server) ===== */}
            <div className="border-t border-slate-800 pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-amber-400" />
                  Voice Cloning (Colab XTTS)
                </h4>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  (defaultSettings as any).voiceCloneEnabled ? "bg-amber-600/20 text-amber-300" : "bg-slate-800 text-slate-500"
                }`}>
                  {(defaultSettings as any).voiceCloneEnabled ? "ENABLED" : "OFF"}
                </span>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Apni awaaz clone karke narration ke liye use karo. Colab notebook chalao, URL yahan paste karo.
                Agar Colab server band ho to automatically edge-tts pe fallback ho jayega.
              </p>

              {/* Enable toggle */}
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-slate-950 border-slate-800/85 px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold font-mono text-slate-300">Use Cloned Voice</p>
                  <p className="text-[10px] text-slate-500 leading-snug">Voiceover me cloned voice use karo (edge-tts ki jagah)</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!(defaultSettings as any).voiceCloneEnabled}
                  onClick={() => setDefaultSettings({ ...defaultSettings, voiceCloneEnabled: !(defaultSettings as any).voiceCloneEnabled })}
                  className={`w-11 h-6 rounded-full transition-all relative flex-shrink-0 cursor-pointer ${
                    (defaultSettings as any).voiceCloneEnabled ? "bg-amber-600" : "bg-slate-800"
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                    (defaultSettings as any).voiceCloneEnabled ? "translate-x-5" : "translate-x-0"
                  }`} />
                </button>
              </div>

              {/* URL input */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Colab Tunnel URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={(defaultSettings as any).voiceCloneUrl || ""}
                    onChange={(e) => setDefaultSettings({ ...defaultSettings, voiceCloneUrl: e.target.value })}
                    placeholder="https://xxxx-xxxx.trycloudflare.com"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-amber-500/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleVcTest}
                    disabled={vcTesting}
                    className="btn btn-outline btn-sm flex-shrink-0"
                  >
                    {vcTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
                    Test
                  </button>
                </div>
                {vcTestResult && (
                  <div className={`flex items-start gap-2 text-[11px] rounded-lg px-3 py-2 ${
                    vcTestResult.ok ? "bg-emerald-600/10 text-emerald-300" : "bg-red-600/10 text-red-300"
                  }`}>
                    {vcTestResult.ok ? <Check className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                    <span>{vcTestResult.detail}</span>
                  </div>
                )}
              </div>

              {/* Preview button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleVcPreview}
                  disabled={vcPreviewing || !(defaultSettings as any).voiceCloneUrl}
                  className="btn btn-outline btn-sm"
                >
                  {vcPreviewing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {vcPreviewing ? "Generating..." : "Preview Cloned Voice"}
                </button>
                <a
                  href="/colab/voice_clone_server.ipynb"
                  download="voice_clone_server.ipynb"
                  className="btn btn-outline btn-sm text-slate-400"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Colab Notebook
                </a>
              </div>
              {vcPreviewMsg && (
                <p className={`text-[11px] ${vcPreviewUrl ? "text-emerald-300" : "text-red-300"}`}>{vcPreviewMsg}</p>
              )}
              {vcPreviewUrl && (
                <audio controls src={vcPreviewUrl} className="w-full h-10" />
              )}
            </div>

            <div className="border-t border-slate-800 pt-5 flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="btn btn-primary btn-lg"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Workspace Defaults
              </button>
            </div>
          </form>

          {/* RIGHT COLUMN - Video API Provider Configs overview */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono border-b border-slate-800 pb-3 flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              Footage Sources Status
            </h3>

            <div className="space-y-4">
              {sources.map(source => (
                <div key={source.id} className="p-3.5 bg-slate-950 rounded-xl border border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">{source.name}</span>
                    <button
                      type="button"
                      onClick={() => handleToggleSource(source.id)}
                      className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors cursor-pointer ${
                        source.enabled 
                          ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" 
                          : "bg-slate-900 border-slate-800 text-slate-500"
                      }`}
                    >
                      {source.enabled ? "ACTIVE" : "DISABLED"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span className="flex items-center gap-1">
                      <Key className="w-3 h-3 text-slate-600" />
                      {source.apiKeyConfigured ? "PERSONAL KEY ACTIVE" : "LOCAL BACKUP ACTIVE"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 bg-indigo-600/5 border border-indigo-500/10 rounded-xl space-y-1 text-[11px] text-slate-400 leading-relaxed text-left">
              <p className="font-semibold text-indigo-400 flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" />
                Live API Sourcing
              </p>
              <p>
                Configure credentials under the <strong>Stock APIs</strong> tab to query live stock clips. Otherwise, Pexels and Pixabay will use built-in local fallback libraries.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "keys" && (
        /* DEDICATED API KEYS MANAGEMENT PAGE */
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-3">
            <h3 className="text-base font-bold text-ink flex items-center gap-2">
              <Lock className="w-5 h-5 text-indigo-400" />
              Secure Encrypted Key-Vault
            </h3>
            <p className="text-slate-400 text-xs leading-relaxed max-w-2xl">
              All stored API keys are encrypted at-rest using AES-256-CBC server-side before persisting in the JSON database. For extreme security, keys are never sent in plain-text to the client. You can disable providers or test connection paths directly below.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {keys.filter(key => key.id === "pexels" || key.id === "pixabay").map((key) => {
              const hasActualKey = key.hasKey;
              const isPwrEnabled = key.enabled;
              const isTestingThis = testingId === key.id;
              const isSavingThis = savingId === key.id;

              return (
                <div 
                  key={key.id} 
                  className={`bg-slate-900 border rounded-2xl p-6 transition-all duration-300 ${
                    isPwrEnabled 
                      ? "border-slate-800 hover:border-slate-700 shadow-md shadow-indigo-950/5" 
                      : "border-slate-800/50 opacity-75"
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-100 font-mono">{key.name}</h4>
                        <span className="text-[10px] bg-slate-950 border border-slate-800 text-indigo-400 px-2 py-0.5 rounded font-mono uppercase">
                          {key.id}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {key.id === "gemini" && "Powers script synthesis, automatic scene storyboard splitting, and intelligent video clip relevance matching."}
                        {key.id === "pexels" && "Enables automated vertical stock video searches. Falls back to beautiful local repository on failure."}
                        {key.id === "pixabay" && "Enables auxiliary HD stock footage queries for comprehensive visual topic coverage."}
                      </p>
                    </div>

                    {/* Enable / Disable Provider Toggle Switch */}
                    <div className="flex items-center gap-2 bg-slate-950 px-3 py-2 rounded-xl border border-slate-800 self-start md:self-auto">
                      <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">Provider Toggle</span>
                      <button
                        type="button"
                        onClick={() => handleToggleKeyProvider(key.id)}
                        className={`w-9 h-5 rounded-full transition-all relative ${
                          isPwrEnabled ? "bg-indigo-600" : "bg-slate-800"
                        }`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all ${
                          isPwrEnabled ? "translate-x-4" : "translate-x-0"
                        }`} />
                      </button>
                    </div>
                  </div>

                  {/* Body: Inputs & Action Triggers */}
                  <div className="py-5 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                          API KEY / AUTH TOKEN
                        </label>
                        {hasActualKey && (
                          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Saved & Protected
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={visibleKeys[key.id] ? "text" : "password"}
                            value={inputKeys[key.id] || ""}
                            onChange={(e) => handleInputChange(key.id, e.target.value)}
                            placeholder={hasActualKey ? "••••••••••••••••••••••••" : `Enter your personal ${key.id.toUpperCase()} API Key...`}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-slate-200 outline-none font-mono focus:border-indigo-500/50 transition-colors"
                          />
                          <button
                            type="button"
                            onClick={() => toggleVisibility(key.id)}
                            className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                          >
                            {visibleKeys[key.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>

                        {/* Save Key Trigger */}
                        <button
                          type="button"
                          onClick={() => handleSaveKey(key.id)}
                          disabled={isSavingThis}
                          className="btn btn-primary btn-sm"
                        >
                          {isSavingThis ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          Save
                        </button>

                        {/* Test Connection Trigger */}
                        <button
                          type="button"
                          onClick={() => handleTestKey(key.id)}
                          disabled={isTestingThis || !hasActualKey}
                          title={!hasActualKey ? "Save an API Key first before testing connection." : ""}
                          className="btn btn-secondary btn-sm"
                        >
                          {isTestingThis ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          ) : (
                            <Activity className="w-3.5 h-3.5 text-indigo-400" />
                          )}
                          Test Link
                        </button>
                      </div>
                    </div>

                    {/* Connection Status & Error Log if failed */}
                    {key.status === "error" && key.errorMessage && (
                      <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <div className="space-y-1">
                          <p className="font-semibold font-mono">CONNECTION ERROR LOG:</p>
                          <p className="text-[11px] leading-relaxed font-mono">{key.errorMessage}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Metadata indicators */}
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/60 pt-4 text-[10px] text-slate-500 font-mono">
                    {/* Active/Inactive Status Badge */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Connection Status:</span>
                      {key.status === "active" && (
                        <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                          ACTIVE & CONNECTED
                        </span>
                      )}
                      {key.status === "inactive" && (
                        <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                          <span className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                          PENDING VERIFICATION
                        </span>
                      )}
                      {key.status === "error" && (
                        <span className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                          <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-bounce" />
                          FAILED CONNECTION
                        </span>
                      )}
                      {key.status === "unconfigured" && (
                        <span className="bg-slate-950 border border-slate-800 text-slate-400 px-2 py-0.5 rounded flex items-center gap-1 font-bold">
                          <span className="w-1.5 h-1.5 bg-slate-600 rounded-full" />
                          UNCONFIGURED
                        </span>
                      )}
                    </div>

                    {/* Usage Request Count Indicator */}
                    <div className="flex items-center gap-1">
                      <Server className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-slate-400">Total API Calls:</span>
                      <span className="text-slate-200 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {key.useCount || 0} requests
                      </span>
                    </div>

                    {/* Last Tested Date */}
                    {key.lastTested && (
                      <div className="text-right">
                        Last tested: <span className="text-slate-300 font-semibold">{new Date(key.lastTested).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "ai" && (
        <div className="space-y-8">
          {/* TOP ROW: Usage stats dashboard */}
          {aiStats && (
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-ink flex items-center gap-2">
                    <Activity className="w-5 h-5 text-indigo-400" />
                    AI Provider Usage Dashboard
                  </h3>
                  <p className="text-slate-400 text-xs">
                    Real-time monitoring of AI system load, success metrics, and routing performance.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleResetAiStats}
                  className="btn btn-secondary btn-xs self-start sm:self-auto"
                >
                  RESET STATISTICS
                </button>
              </div>

              {/* Stats Counters Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Total Requests</span>
                  <span className="text-2xl font-bold text-ink block">{aiStats.totalRequests || 0}</span>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Success Rate</span>
                  <span className="text-2xl font-bold text-emerald-400 block">
                    {aiStats.totalRequests > 0 
                      ? `${Math.round(((aiStats.totalSuccess || 0) / aiStats.totalRequests) * 100)}%` 
                      : "100%"}
                  </span>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Failure Rate</span>
                  <span className="text-2xl font-bold text-rose-400 block">
                    {aiStats.totalRequests > 0 
                      ? `${Math.round(((aiStats.totalFailure || 0) / aiStats.totalRequests) * 100)}%` 
                      : "0%"}
                  </span>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/60 text-center space-y-1">
                  <span className="text-[10px] font-bold text-slate-500 uppercase font-mono block">Last Used Provider</span>
                  <span className="text-xs font-bold text-indigo-400 font-mono uppercase block py-1.5">
                    {aiStats.lastUsedProvider || "None"}
                  </span>
                </div>
              </div>

              {/* Provider Performance Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                {Object.entries(aiStats.providers || {}).map(([pId, stats]) => {
                  const s = stats as any;
                  const rate = s.requests > 0 ? Math.round((s.success / s.requests) * 100) : 100;
                  return (
                    <div key={pId} className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/50 space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b border-slate-800/40 pb-1.5">
                        <span className="font-bold text-slate-300 font-mono uppercase">{pId}</span>
                        <span className={`text-[10px] font-semibold ${rate >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {rate}% Success
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono text-slate-400">
                        <div>
                          <span className="text-slate-500 block">Reqs</span>
                          <span className="font-bold text-slate-300">{s.requests}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">OK</span>
                          <span className="font-bold text-emerald-500">{s.success}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">ERR</span>
                          <span className="font-bold text-rose-500">{s.failures}</span>
                        </div>
                      </div>
                      {s.lastUsedAt && (
                        <div className="text-[9px] text-slate-500 text-center font-mono pt-1">
                          Last: {new Date(s.lastUsedAt).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* LEFT COLUMN: Configuration settings */}
            {aiSettings && (
              <form onSubmit={handleSaveAiSettings} className="md:col-span-1 bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-6 self-start">
                <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono border-b border-slate-800 pb-3 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  Router Configuration
                </h3>

                <div className="space-y-4">
                  {/* AI Modes selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono block">AI Active Mode</label>
                    <select
                      value={aiSettings.activeMode}
                      onChange={(e) => setAiSettings({ ...aiSettings, activeMode: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="auto">Auto (Smart Fallback)</option>
                      <option value="gemini">Gemini Only</option>
                      <option value="groq">Groq Only</option>
                      <option value="openrouter">OpenRouter Only</option>
                      <option value="nvidia">NVIDIA NIM Only</option>
                    </select>
                    <span className="text-[10px] text-slate-500 block leading-normal">
                      Auto mode routes requests using failover and smart criteria.
                    </span>
                  </div>

                  {/* Smart Routing Strategy */}
                  {aiSettings.activeMode === "auto" && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono block">Routing Preference</label>
                      <select
                        value={aiSettings.smartRouting}
                        onChange={(e) => setAiSettings({ ...aiSettings, smartRouting: e.target.value as any })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="auto">Auto (Balanced Fallback)</option>
                        <option value="cheapest">Cheapest Provider First</option>
                        <option value="fastest">Fastest Response First</option>
                        <option value="quality">Highest Quality Model First</option>
                      </select>
                    </div>
                  )}

                  {/* Default Provider Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono block">Default Provider</label>
                    <select
                      value={aiSettings.defaultProvider}
                      onChange={(e) => setAiSettings({ ...aiSettings, defaultProvider: e.target.value as any })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="groq">Groq</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="nvidia">NVIDIA NIM</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <button
                    type="submit"
                    disabled={isSavingAi}
                    className="btn btn-primary btn-sm w-full"
                  >
                    {isSavingAi ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Router Settings
                  </button>
                </div>
              </form>
            )}

            {/* RIGHT COLUMN: AI Keys management */}
            <div className="md:col-span-2 space-y-4">
              {keys.filter(k => k.id === "gemini" || k.id === "groq" || k.id === "openrouter" || k.id === "nvidia").map(key => {
                const hasActualKey = key.hasKey;
                const isPwrEnabled = key.enabled;
                const isTestingThis = testingId === key.id;
                const isSavingThis = savingId === key.id;

                return (
                  <div 
                    key={key.id} 
                    className={`bg-slate-900 border rounded-2xl p-5 transition-all duration-300 ${
                      isPwrEnabled 
                        ? "border-slate-800 hover:border-slate-700" 
                        : "border-slate-800/50 opacity-75"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/60 pb-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-100 font-mono">{key.name}</h4>
                          <span className="text-[9px] bg-slate-950 border border-slate-800 text-indigo-400 px-1.5 py-0.5 rounded font-mono uppercase">
                            {key.id}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 self-start sm:self-auto">
                        <span className="text-[9px] font-mono font-bold text-slate-400 uppercase">Status</span>
                        <button
                          type="button"
                          onClick={() => handleToggleKeyProvider(key.id)}
                          className={`w-8 h-4.5 rounded-full transition-all relative ${
                            isPwrEnabled ? "bg-indigo-600" : "bg-slate-800"
                          }`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-all ${
                            isPwrEnabled ? "translate-x-3.5" : "translate-x-0"
                          }`} />
                        </button>
                      </div>
                    </div>

                    <div className="py-3 space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
                          <span>API KEY Credentials</span>
                          {hasActualKey && (
                            <span className="text-emerald-400 font-semibold flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> Configured
                            </span>
                          )}
                        </div>

                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type={visibleKeys[key.id] ? "text" : "password"}
                              value={inputKeys[key.id] || ""}
                              onChange={(e) => handleInputChange(key.id, e.target.value)}
                              placeholder={hasActualKey ? "••••••••••••••••••••••••" : `Enter your personal ${key.id.toUpperCase()} API Key...`}
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-3 pr-8 py-2 text-xs text-slate-200 outline-none font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => toggleVisibility(key.id)}
                              className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                            >
                              {visibleKeys[key.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSaveKey(key.id)}
                            disabled={isSavingThis}
                            className="btn btn-primary btn-sm"
                          >
                            {isSavingThis ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTestKey(key.id)}
                            disabled={isTestingThis || !hasActualKey}
                            className="btn btn-secondary btn-sm"
                          >
                            {isTestingThis ? <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" /> : <Activity className="w-3 h-3 text-indigo-400" />}
                            Test
                          </button>
                        </div>
                      </div>

                      {/* NVIDIA Model Selector */}
                      {key.id === "nvidia" && (
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mb-1.5 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-[#E1306C] rounded-full" />
                            NVIDIA NIM Model
                          </div>
                          <select
                            value={key.model || "nvidia/llama-3.1-nemotron-70b-instruct"}
                            onChange={(e) => handleModelChange(key.id, e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-slate-200 outline-none focus:border-[#E1306C] cursor-pointer font-mono"
                          >
                            {(() => {
                              const groups: Record<string, string[]> = {};
                              NVIDIA_MODELS.forEach(m => {
                                const prefix = m.split("/")[0];
                                const group = ({
                                  "nvidia": "NVIDIA Nemotron / Embed",
                                  "nv-mistralai": "NVIDIA Mistral",
                                  "meta": "Meta Llama",
                                  "mistralai": "Mistral AI",
                                  "google": "Google Gemma",
                                  "microsoft": "Microsoft Phi",
                                  "deepseek-ai": "DeepSeek",
                                  "qwen": "Qwen",
                                  "writer": "Writer / Palmyra",
                                  "01-ai": "01.AI Yi",
                                  "minimaxai": "MiniMax",
                                  "moonshotai": "Moonshot AI",
                                  "sarvamai": "Sarvam AI",
                                  "snowflake": "Snowflake",
                                  "stepfun-ai": "StepFun",
                                  "stockmark": "Stockmark",
                                  "upstage": "Upstage",
                                  "z-ai": "Z.AI GLM",
                                  "zyphra": "Zyphra",
                                })[prefix] || "Other (" + prefix + ")";
                                if (!groups[group]) groups[group] = [];
                                groups[group].push(m);
                              });
                              return Object.entries(groups).map(([groupName, models]) =>
                                React.createElement('optgroup', { label: `${groupName} (${models.length})`, key: groupName },
                                  ...models.map(m =>
                                    React.createElement('option', { key: m, value: m },
                                      m.split("/").pop()!.replace(/-/g, " ")
                                    )
                                  )
                                )
                              );
                            })()}
                          </select>
                          <span className="text-[9px] text-slate-500 font-mono mt-1 block">
                            Showing all {NVIDIA_MODELS.length} free models from NVIDIA NIM
                          </span>
                        </div>
                      )}

                      {key.status === "error" && key.errorMessage && (
                        <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[10px] text-rose-400 font-mono leading-relaxed">
                          {key.errorMessage}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 text-[10px] text-slate-500 font-mono">
                      <div className="flex items-center gap-1">
                        <span>Connection:</span>
                        {key.status === "active" && <span className="text-emerald-400 font-bold">● ACTIVE</span>}
                        {key.status === "inactive" && <span className="text-amber-400 font-bold">● UNTESTED</span>}
                        {key.status === "error" && <span className="text-rose-400 font-bold">● FAILED</span>}
                        {key.status === "unconfigured" && <span className="text-slate-400 font-bold">● UNCONFIGURED</span>}
                      </div>

                      <div>
                        Calls: <span className="text-slate-300 font-bold">{key.useCount || 0}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === "youtube" && (
        <YoutubeTab />
      )}

      {activeTab === "profile" && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-ink flex items-center gap-2">
              <User className="w-5 h-5 text-indigo-400" />
              Creator Identity Configuration
            </h3>
            <p className="text-slate-400 text-xs mt-1">
              Personalize your workspaces, headers, and watermark tags across all generated video channels.
            </p>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-6">
            {/* Avatar picker container */}
            <div className="bg-slate-950/40 border border-slate-800/80 p-5 rounded-xl space-y-4">
              <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block">
                Creator Avatar Image
              </label>
              
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Visual Avatar Preview Circle */}
                <div className="w-16 h-16 rounded-full bg-slate-800 border-2 border-indigo-500 overflow-hidden shrink-0 flex items-center justify-center shadow-lg shadow-indigo-600/10">
                  {profileAvatarUrl ? (
                    <img 
                      src={profileAvatarUrl} 
                      alt="Creator Avatar" 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <User className="w-8 h-8 text-indigo-400" />
                  )}
                </div>

                {/* Pick preset / Custom URL input */}
                <div className="flex-1 space-y-3 w-full">
                  <div className="text-xs text-slate-400 font-medium">Select a Preset Avatar:</div>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { name: "Neon Cypher", url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80" },
                      { name: "Midnight Indie", url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&h=150&q=80" },
                      { name: "Solar Breeze", url: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&h=150&q=80" },
                      { name: "Cosmic Dev", url: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=150&h=150&q=80" },
                    ].map(preset => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => setProfileAvatarUrl(preset.url)}
                        className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                          profileAvatarUrl === preset.url
                            ? "bg-indigo-600/20 border-indigo-500 text-indigo-300"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  <div className="pt-1">
                    <div className="text-xs text-slate-400 font-medium mb-1.5">Or paste any custom Image URL:</div>
                    <input
                      type="url"
                      placeholder="https://example.com/avatar.png"
                      value={profileAvatarUrl}
                      onChange={(e) => setProfileAvatarUrl(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Fields Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SaaS Creator"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Contact Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. creator@example.com"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Creator Role
                </label>
                <select
                  value={profileRole}
                  onChange={(e) => setProfileRole(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors cursor-pointer"
                >
                  <option value="Administrator">Administrator</option>
                  <option value="Senior Editor">Senior Editor</option>
                  <option value="Video Producer">Video Producer</option>
                  <option value="Director">Director</option>
                  <option value="Chief Content Creator">Chief Content Creator</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="btn btn-primary btn-sm w-full shadow-lg shadow-indigo-600/10 h-[38px]"
                >
                  <Save className="w-4 h-4" />
                  {isSavingProfile ? "Saving Profile..." : "Save Profile Identity"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {activeTab === "security" && (
        <SecurityTab />
      )}
    </div>
  );
}

/* Security / PIN sub-component */
function SecurityTab() {
  const [pinSet, setPinSet] = useState<boolean | null>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then(r => r.json())
      .then(d => setPinSet(d.pinSet === true))
      .catch(() => setPinSet(false));
  }, []);

  const handleSavePin = async () => {
    if (newPin.length < 4) {
      setMsg({ type: "error", text: "PIN kam se kam 4 characters ka hona chahiye" });
      return;
    }
    if (newPin !== confirmPin) {
      setMsg({ type: "error", text: "Dono PIN match nahi kar rahe" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPin }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMsg({ type: "success", text: "PIN save ho gaya! Ab app kholne par PIN lagega." });
        setPinSet(true);
        setNewPin("");
        setConfirmPin("");
      } else {
        setMsg({ type: "error", text: data.error || "PIN save nahi hua" });
      }
    } catch (e: any) {
      setMsg({ type: "error", text: "Server error: " + (e.message || "unknown") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 max-w-lg">
      <div>
        <h3 className="text-lg font-bold text-ink flex items-center gap-2">
          <Lock className="w-5 h-5 text-indigo-400" />
          PIN Security
        </h3>
        <p className="text-slate-400 text-xs mt-1">
          App kholne par PIN lagega. Koi email/password nahi — sirf ek secret PIN.
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs font-mono">
        <span className={`w-2 h-2 rounded-full ${pinSet ? "bg-emerald-400" : "bg-amber-400"}`} />
        <span className="text-slate-300">
          {pinSet === null ? "Checking..." : pinSet ? "PIN active hai ✅" : "PIN set nahi hai — app abhi open hai ⚠️"}
        </span>
      </div>

      {msg && (
        <div className={`text-xs px-4 py-2.5 rounded-lg border ${
          msg.type === "success"
            ? "bg-emerald-900/30 text-emerald-400 border-emerald-800"
            : "bg-rose-900/30 text-rose-400 border-rose-800"
        }`}>
          {msg.text}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
            {pinSet ? "New PIN" : "Set PIN"}
          </label>
          <div className="relative">
            <input
              type={showPin ? "text" : "password"}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              placeholder="••••••"
              maxLength={20}
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors font-mono tracking-widest pr-10"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-2">
            Confirm PIN
          </label>
          <input
            type={showPin ? "text" : "password"}
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            placeholder="••••••"
            maxLength={20}
            className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-sm text-slate-100 outline-none transition-colors font-mono tracking-widest"
            autoComplete="new-password"
          />
        </div>

        <button
          onClick={handleSavePin}
          disabled={saving || !newPin || !confirmPin}
          className="btn btn-primary btn-sm w-full shadow-lg shadow-indigo-600/10"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : pinSet ? "Change PIN" : "Set PIN"}
        </button>
      </div>

      <div className="text-[10px] text-slate-500 border-t border-slate-800 pt-4 space-y-1 font-mono">
        <p>• PIN set karne ke baad app kholne par landing page aayegi</p>
        <p>• PIN bhool jao to db.json se auth section delete karke reset kar sakte ho</p>
        <p>• Session 30 din ke liye valid rehta hai (ek baar login ke baad)</p>
      </div>
    </div>
  );
}

/* YouTube cookies upload sub-component */
function YoutubeTab() {
  const [cookiesValid, setCookiesValid] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [cookiesText, setCookiesText] = useState("");
  const [oauthConnected, setOauthConnected] = useState<boolean | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; channelTitle: string; email?: string; isDefault: boolean }[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAccounts = () => {
    fetch("/api/youtube/accounts")
      .then(r => r.json())
      .then(d => setAccounts(Array.isArray(d.accounts) ? d.accounts : []))
      .catch(() => setAccounts([]));
  };

  useEffect(() => {
    fetch("/api/youtube/cookies-status")
      .then(r => r.json())
      .then(d => {
        setCookiesValid(d.valid);
        if (d.message) setMessage({ type: d.valid ? "success" : "error", text: d.message });
      })
      .catch(() => setCookiesValid(false));
    fetch("/api/youtube/status")
      .then(r => r.json())
      .then(d => {
        setOauthConnected(!!d.authenticated);
        setOauthConfigured(!!d.oauthConfigured);
      })
      .catch(() => { setOauthConnected(false); setOauthConfigured(false); });
    loadAccounts();
  }, []);

  const handleRemoveAccount = async (id: string) => {
    setRemovingId(id);
    try {
      await fetch(`/api/youtube/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      loadAccounts();
    } finally {
      setRemovingId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await fetch(`/api/youtube/accounts/${encodeURIComponent(id)}/default`, { method: "POST" });
      loadAccounts();
    } catch {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/youtube/cookies", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: text
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Upload failed" });
      } else {
        setCookiesValid(data.valid);
        setMessage({ type: data.valid ? "success" : "error", text: data.message });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  const handlePasteSubmit = async () => {
    if (!cookiesText.trim()) return;
    setUploading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/youtube/cookies", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: cookiesText
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Upload failed" });
      } else {
        setCookiesValid(data.valid);
        setMessage({ type: data.valid ? "success" : "error", text: data.message });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Upload failed" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
      {/* ===== OAuth (recommended) ===== */}
      <div>
        <h3 className="text-lg font-bold text-ink flex items-center gap-2">
          <Globe className="w-5 h-5 text-indigo-400" />
          YouTube Upload — Official OAuth (Recommended)
        </h3>
        <p className="text-slate-400 text-xs mt-1">
          Uses the official YouTube Data API with your Google Cloud Client ID &amp; Secret. Most reliable — videos are created properly and you get the link back.
        </p>
      </div>

      <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
        <div className={`w-3 h-3 rounded-full ${oauthConnected === null ? "bg-slate-500" : oauthConnected ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500"}`} />
        <span className="text-sm text-slate-300">
          {oauthConnected === null ? "Checking..." : oauthConnected ? "YouTube connected via OAuth ✓" : "YouTube not connected via OAuth"}
        </span>
      </div>

      {oauthConfigured === false && (
        <div className="text-xs px-4 py-3 rounded-lg bg-amber-900/20 text-amber-400 border border-amber-800/50 space-y-1">
          <p className="font-bold">⚠️ Google Cloud credentials not configured yet.</p>
          <p>Add <code className="text-amber-300">YOUTUBE_CLIENT_ID</code> and <code className="text-amber-300">YOUTUBE_CLIENT_SECRET</code> to your <code className="text-amber-300">.env</code> file, then restart the server. See the steps below.</p>
        </div>
      )}

      {oauthConfigured === true && (
        <button
          onClick={() => { window.location.href = "/api/youtube/auth"; }}
          className="btn btn-primary btn-sm w-full shadow-lg shadow-indigo-600/10"
        >
          <Film className="w-4 h-4" />
          {accounts.length === 0 ? "Connect YouTube Account (OAuth)" : "Add Another Channel"}
        </button>
      )}

      {/* Connected channels list */}
      {accounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-400">Connected channels ({accounts.length}):</p>
          {accounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
              <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate font-medium">{acc.channelTitle}</p>
                {acc.email && <p className="text-[11px] text-slate-500 truncate">{acc.email}</p>}
              </div>
              {acc.isDefault ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-700/50 shrink-0">Default</span>
              ) : (
                <button onClick={() => handleSetDefault(acc.id)} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700 shrink-0">
                  Set default
                </button>
              )}
              <button
                onClick={() => handleRemoveAccount(acc.id)}
                disabled={removingId === acc.id}
                className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-400 hover:text-red-300 border border-red-800/50 shrink-0 disabled:opacity-50"
              >
                {removingId === acc.id ? "..." : "Remove"}
              </button>
            </div>
          ))}
          <p className="text-[11px] text-slate-500">
            When uploading a video you can pick which channel it goes to. The default channel is used for scheduled uploads.
          </p>
        </div>
      )}

      {oauthConnected && accounts.length === 0 && (
        <div className="text-xs px-4 py-2 rounded-lg bg-green-900/30 text-green-400 border border-green-800">
          ✓ Connected. Uploads will use the official YouTube API automatically.
        </div>
      )}

      <div className="text-xs text-slate-500 border-t border-slate-800 pt-4 space-y-1">
        <p className="font-medium text-slate-400">How to set up OAuth (one-time):</p>
        <p>1. Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-indigo-300 underline">console.cloud.google.com</a> → create/select a project</p>
        <p>2. Enable the <strong>YouTube Data API v3</strong> (APIs &amp; Services → Library)</p>
        <p>3. Configure the <strong>OAuth consent screen</strong> (External, add your Google email as a test user)</p>
        <p>4. Create an <strong>OAuth Client ID</strong> (Web application)</p>
        <p>5. Add this redirect URI: <code className="text-indigo-300 break-all">{typeof window !== "undefined" ? window.location.origin : ""}/api/youtube/callback</code></p>
        <p>6. Copy the Client ID &amp; Secret into <code className="text-indigo-300">.env</code> as <code className="text-indigo-300">YOUTUBE_CLIENT_ID</code> / <code className="text-indigo-300">YOUTUBE_CLIENT_SECRET</code>, restart, then click Connect above</p>
      </div>

      <div className="border-t border-slate-800 pt-6">
        <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-1">
          <Globe className="w-4 h-4 text-slate-500" />
          Fallback — Cookies Method
        </h4>
        <p className="text-slate-500 text-xs">
          Only used if OAuth is not connected. Export cookies from YouTube using a browser extension and upload the <strong>cookies.txt</strong> file.
        </p>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-3 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-3">
        <div className={`w-3 h-3 rounded-full ${cookiesValid === null ? "bg-slate-500" : cookiesValid ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-red-500"}`} />
        <span className="text-sm text-slate-300">
          {cookiesValid === null ? "Checking..." : cookiesValid ? "YouTube cookies are valid" : "No valid cookies found"}
        </span>
      </div>

      {message && (
        <div className={`text-xs px-4 py-2 rounded-lg ${message.type === "success" ? "bg-green-900/30 text-green-400 border border-green-800" : "bg-red-900/30 text-red-400 border border-red-800"}`}>
          {message.text}
        </div>
      )}

      {/* File upload */}
      <div>
        <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-3">
          Upload cookies.txt file
        </label>
        <label className="flex items-center justify-center gap-3 w-full border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-xl px-5 py-8 cursor-pointer transition-colors bg-slate-950/30">
          <Upload className="w-6 h-6 text-slate-500" />
          <span className="text-sm text-slate-400">
            {uploading ? "Uploading..." : "Click to select cookies.txt from your browser export"}
          </span>
          <input type="file" accept=".txt" className="hidden" onChange={handleFileUpload} disabled={uploading} />
        </label>
      </div>

      {/* Paste alternative */}
      <div>
        <label className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 block mb-3">
          Or paste cookies content directly
        </label>
        <textarea
          value={cookiesText}
          onChange={(e) => setCookiesText(e.target.value)}
          rows={6}
          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors font-mono"
          placeholder="Paste Netscape HTTP Cookie File content here..."
        />
        <button
          onClick={handlePasteSubmit}
          disabled={uploading || !cookiesText.trim()}
          className="mt-3 btn btn-primary btn-sm w-full shadow-lg shadow-indigo-600/10"
        >
          <Save className="w-4 h-4" />
          {uploading ? "Saving..." : "Save Cookies"}
        </button>
      </div>

      {/* yt-dlp auto export (Termux-friendly) */}
      <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
            🚀 Auto Export via yt-dlp
          </span>
          <span className="text-[8px] text-slate-600 font-mono bg-slate-950 px-2 py-0.5 rounded-full">Termux / CLI</span>
        </div>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          Export cookies directly from your browser using yt-dlp. Gets ALL cookies including Secure ones.
        </p>
        <div className="flex gap-2">
          {["firefox", "chrome", "chromium", "brave", "edge"].map(b => (
            <button key={b} onClick={async () => {
              setUploading(true); setMessage(null);
              try {
                const res = await fetch("/api/youtube/export-cookies", {
                  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browser: b })
                });
                const data = await res.json();
                if (!res.ok) {
                  setMessage({ type: "error", text: data.error || "Export failed" });
                } else {
                  setCookiesValid(data.valid);
                  setMessage({ type: data.valid ? "success" : "error", text: data.message });
                }
              } catch (err: any) { setMessage({ type: "error", text: err.message }); }
              finally { setUploading(false); }
            }} disabled={uploading}
              className="flex-1 py-2 text-[9px] font-bold font-mono rounded-lg border cursor-pointer transition-colors disabled:opacity-40 bg-slate-950 border-slate-800 text-slate-400 hover:text-ink hover:border-indigo-500">
              {b === "firefox" ? "🦊 " : "🌐 "}{b}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-slate-500 border-t border-slate-800 pt-4 space-y-1">
        <p className="font-medium text-slate-400">How to export cookies:</p>
        <p><strong>Method 1</strong> — yt-dlp: Click a browser button above (requires yt-dlp installed: <code className="text-indigo-300">pip install yt-dlp</code>)</p>
        <p><strong>Method 2</strong> — Browser extension: Install "Get cookies.txt" (Chrome/Firefox), go to youtube.com logged in, click extension → export → upload file</p>
        <p><strong>Method 3</strong> — Manual CLI: <code className="text-indigo-300">!yt-dlp --cookies-from-browser firefox --cookies /data/data/com.termux/files/home/shorts2/data/youtube-cookies.txt --skip-download youtube.com</code></p>
      </div>
    </div>
  );
}
