import React, { useState } from "react";
import { 
  Wand2, 
  FileText, 
  Settings, 
  Check, 
  Volume2, 
  Gauge, 
  Tv, 
  Layers, 
  Sparkles,
  Loader2
} from "lucide-react";
import { SubtitleStyleType, ScriptTone, TransitionType } from "../types";

interface CreateVideoViewProps {
  onProjectCreated: (project: any, scenes: any[], job: any) => void;
}

export default function CreateVideoView({ onProjectCreated }: CreateVideoViewProps) {
  const [activeTab, setActiveTab] = useState<"topic" | "script">("topic");
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Default video settings
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleType>(SubtitleStyleType.TIKTOK);
  const [videoLength, setVideoLength] = useState<"short" | "medium" | "long">("medium");
  const [qualitySelection, setQualitySelection] = useState<"high" | "ultra">("high");
  const [preferredSources, setPreferredSources] = useState<string[]>(["pexels", "pixabay", "coverr", "mixkit", "tiktok", "pinterest"]);
  const [scriptTone, setScriptTone] = useState<ScriptTone>(ScriptTone.VIRAL);
  const [transitionType, setTransitionType] = useState<TransitionType>(TransitionType.FADE);
  const [transitionDuration, setTransitionDuration] = useState(0.3);
  const [smartSceneDistribution, setSmartSceneDistribution] = useState(false);
  const [autoSfxEnabled, setAutoSfxEnabled] = useState(false);

  const sourcesList = [
    { id: "pexels", name: "Pexels API" },
    { id: "pixabay", name: "Pixabay API" },
    { id: "coverr", name: "Coverr Video" },
    { id: "mixkit", name: "Mixkit Stock" }
  ];

  const handleSourceToggle = (sourceId: string) => {
    if (preferredSources.includes(sourceId)) {
      if (preferredSources.length > 1) {
        setPreferredSources(preferredSources.filter(s => s !== sourceId));
      }
    } else {
      setPreferredSources([...preferredSources, sourceId]);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    
    if (activeTab === "topic" && !topic.trim()) {
      setErrorMsg("Please provide a topic for your short.");
      return;
    }
    if (activeTab === "script" && !script.trim()) {
      setErrorMsg("Please paste your script narration.");
      return;
    }

    setIsGenerating(true);

    try {
      // Step 1: Create Draft Project on server
      const draftRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: activeTab === "topic" ? topic : "My Custom Script Short",
          topic: activeTab === "topic" ? topic : "",
          script: activeTab === "script" ? script : "",
          settings: {
            subtitleEnabled,
            subtitleStyle,
            videoLength,
            sceneDuration: 5,
            qualitySelection,
            exportFormat: "mp4",
            preferredSources,
            videoTone: scriptTone,
            transitionType,
            transitionDuration,
            smartSceneDistribution,
            autoSfxEnabled
          }
        })
      });

      if (!draftRes.ok) {
        const errorData = await draftRes.json();
        throw new Error(errorData.error || "Failed to create draft project");
      }

      const draftProject = await draftRes.json();

      // Step 2: Trigger AI Generation depending on tab selection
      const targetDuration = videoLength === "short" ? 15 : videoLength === "medium" ? 30 : 60;
      const apiEndpoint = activeTab === "topic" 
        ? `/api/projects/${draftProject.id}/generate-script` 
        : `/api/projects/${draftProject.id}/breakdown-script`;

      const payload = activeTab === "topic" 
        ? { topic, duration: targetDuration } 
        : { script, duration: targetDuration };

      const generateRes = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!generateRes.ok) {
        const errorData = await generateRes.json();
        throw new Error(errorData.error || "AI generation pipeline failed");
      }

      const result = await generateRes.json();
      
      // Successfully generated script, storyboard and matched footage
      onProjectCreated(result.project, result.scenes, result.job);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An error occurred while generating the short storyboard.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 relative">
      {isGenerating && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-6 text-center select-none animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full space-y-6 shadow-2xl">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto" />
            <div className="space-y-2">
              <h3 className="text-xl font-display font-bold text-white">AI Engine Spinning...</h3>
              <p className="text-sm text-slate-400">Gemini is creating script segments, designing storyboard scenes, and sourcing matching vertical footage clips from stock providers.</p>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/40 text-left font-mono text-[11px] text-indigo-400 space-y-1">
              <p className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block animate-pulse"></span>
                [Gemini API] Planning script pacing
              </p>
              <p className="text-slate-500">[System] Sourcing direct vertical MP4 clips</p>
            </div>
          </div>
        </div>
      )}

      {/* Header section */}
      <div>
        <h2 className="text-3xl font-display font-bold text-white flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-indigo-500" />
          Create Viral Short Storyboard
        </h2>
        <p className="text-slate-400 text-sm mt-1">Select your input style, customize subtitle templates, and leverage Gemini API to automatically build a cinematic project storyboard.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Columns - Form Details */}
        <form onSubmit={handleGenerate} className="lg:col-span-2 space-y-6 bg-slate-900 border border-slate-800 p-6 rounded-xl ticks">
          {/* Tab Selection buttons */}
          <div className="grid grid-cols-2 p-1.5 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => { setActiveTab("topic"); setErrorMsg(null); }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "topic" 
                  ? "bg-indigo-600 text-white shadow" 
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI Topic Generator
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab("script"); setErrorMsg(null); }}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === "script" 
                  ? "bg-indigo-600 text-white shadow" 
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Paste Complete Script
            </button>
          </div>

          {/* Dynamic input textareas */}
          {activeTab === "topic" ? (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Short Topic or Idea</label>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Example: 10 Jaw-dropping space anomalies we found in 2026, or 5 Habits that make you a high value developer..."
                className="w-full h-32 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 outline-none transition-colors resize-none placeholder:text-slate-600"
              />
              <span className="text-[11px] text-slate-400 block">The generator works best with specific, hook-driven vertical topics.</span>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">Narration Script</label>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Example: Did you know that space is actually silent? It is a complete vacuum, so sound cannot travel. But the black hole in Perseus emits sound waves! Here's how..."
                className="w-full h-40 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm text-slate-100 outline-none transition-colors resize-none placeholder:text-slate-600"
              />
              <span className="text-[11px] text-slate-400 block">The script will be automatically segmented sequentially among vertical scenes.</span>
            </div>
          )}

          {errorMsg && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* Submit Trigger */}
          <button
            type="submit"
            className="cta-btn w-full justify-center text-xs"
          >
            <Sparkles className="w-4 h-4 text-indigo-300" />
            Generate AI Storyboard
          </button>
        </form>

        {/* Right Column - Generation / Styling Configuration */}
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-6 ticks">
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider font-mono border-b border-slate-800 pb-3 flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" />
              Settings & Templates
            </h3>

            {/* Video Target Length */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-slate-400" />
                Target Video Pacing
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "short", name: "~15s", label: "Short" },
                  { id: "medium", name: "~30s", label: "Medium" },
                  { id: "long", name: "~60s", label: "Long" }
                ].map(len => (
                  <button
                    key={len.id}
                    type="button"
                    onClick={() => setVideoLength(len.id as any)}
                    className={`py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      videoLength === len.id 
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" 
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <p className="font-semibold">{len.name}</p>
                    <p className="text-[9px] text-slate-500">{len.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Smart Scene Distribution */}
            <div className="flex items-center justify-between bg-slate-950 border border-slate-800/85 rounded-xl px-3 py-2.5 mt-2">
              <div className="flex-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">Smart Scene Distribution</label>
                <p className="text-[9px] text-slate-500 mt-0.5">First 4 clips fast (3s), rest smooth (5s) — 14 total</p>
              </div>
              <button
                type="button"
                onClick={() => setSmartSceneDistribution(!smartSceneDistribution)}
                className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${
                  smartSceneDistribution ? "bg-indigo-600" : "bg-slate-800"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all ${
                  smartSceneDistribution ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Auto SFX */}
            <div className="flex items-center justify-between bg-slate-950 border border-slate-800/85 rounded-xl px-3 py-2.5 mt-2">
              <div className="flex-1">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono">Auto Sound Effects</label>
                <p className="text-[9px] text-slate-500 mt-0.5">Auto-places SFX based on scene text emotion</p>
              </div>
              <button
                type="button"
                onClick={() => setAutoSfxEnabled(!autoSfxEnabled)}
                className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${
                  autoSfxEnabled ? "bg-indigo-600" : "bg-slate-800"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all ${
                  autoSfxEnabled ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* Subtitle presets */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Subtitle Template Style
              </label>
              <select
                value={subtitleStyle}
                onChange={(e) => setSubtitleStyle(e.target.value as SubtitleStyleType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:border-indigo-500 font-medium"
              >
                <option value={SubtitleStyleType.TIKTOK}>TikTok Bold Highlights</option>
                <option value={SubtitleStyleType.YOUTUBE}>YouTube Shorts Outline</option>
                <option value={SubtitleStyleType.MINIMAL}>Modern Elegant Minimal</option>
                <option value={SubtitleStyleType.CINEMATIC}>Cinematic Bottom Serif</option>
                <option value={SubtitleStyleType.GAMING}>Gaming neon yellow style</option>
                <option value={SubtitleStyleType.ARABIC_PREMIUM}>Arabic Premium (RTL Support)</option>
              </select>
            </div>

            {/* Source providers list checkboxes */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Tv className="w-3.5 h-3.5 text-slate-400" />
                Sourced Footage Providers
              </label>
              <div className="space-y-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
                {sourcesList.map(src => {
                  const isChecked = preferredSources.includes(src.id);
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => handleSourceToggle(src.id)}
                      className="w-full flex items-center justify-between py-1.5 text-xs text-left cursor-pointer group"
                    >
                      <span className={`transition-colors ${isChecked ? "text-slate-200 font-medium" : "text-slate-500 group-hover:text-slate-300"}`}>{src.name}</span>
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                        isChecked 
                          ? "bg-indigo-600 border-indigo-500 text-white" 
                          : "border-slate-800 text-transparent"
                      }`}>
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quality Select details */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                Render Output Quality
              </label>
              <div className="grid grid-cols-2 gap-2">
                {["high", "ultra"].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQualitySelection(q as any)}
                    className={`py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      qualitySelection === q
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-400"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {q === "high" ? "High (1080x1920)" : "Ultra (1080p + Max Bitrate)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Script Tone Selection */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-slate-400" />
                Script Tone
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: ScriptTone.VIRAL, label: "Viral" },
                  { id: ScriptTone.EDUCATIONAL, label: "Educational" },
                  { id: ScriptTone.INSPIRATIONAL, label: "Inspirational" },
                  { id: ScriptTone.HUMOROUS, label: "Humorous" },
                  { id: ScriptTone.SERIOUS, label: "Serious" },
                  { id: ScriptTone.MOTIVATIONAL, label: "Motivational" }
                ].map(tone => (
                  <button
                    key={tone.id}
                    type="button"
                    onClick={() => setScriptTone(tone.id)}
                    className={`py-1.5 rounded-lg text-[9px] font-semibold border transition-colors cursor-pointer ${
                      scriptTone === tone.id
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-400"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {tone.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scene Transition Type */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Scene Transition
              </label>
              <div className="grid grid-cols-4 gap-1">
                {[
                  { id: TransitionType.NONE, label: "Off" },
                  { id: TransitionType.FADE, label: "Fade" },
                  { id: TransitionType.DISSOLVE, label: "Dissolve" },
                  { id: TransitionType.SLIDE_LEFT, label: "S-L" },
                  { id: TransitionType.SLIDE_RIGHT, label: "S-R" },
                  { id: TransitionType.SLIDE_UP, label: "S-U" },
                  { id: TransitionType.SLIDE_DOWN, label: "S-D" },
                  { id: TransitionType.ZOOM_IN, label: "Zoom" },
                  { id: TransitionType.RADIAL, label: "Radial" },
                  { id: TransitionType.PIXELIZE, label: "Pixel" },
                  { id: TransitionType.CIRCLE_OPEN, label: "Cir-O" },
                  { id: TransitionType.CIRCLE_CLOSE, label: "Cir-C" },
                  { id: "wipelr", label: "W-LR" },
                  { id: "wiperl", label: "W-RL" },
                  { id: "wipetb", label: "W-TB" },
                  { id: "wipebt", label: "W-BT" },
                  { id: "random", label: "🎲 Random" },
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTransitionType(t.id as TransitionType)}
                    className={`py-1.5 text-[8px] font-mono font-bold rounded border transition-colors cursor-pointer ${
                      transitionType === t.id
                        ? "bg-indigo-600/10 border-indigo-500 text-indigo-400"
                        : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {transitionType !== TransitionType.NONE && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[8px] text-slate-500 font-mono">Dur</span>
                  <input type="range" min={0.1} max={1.0} step={0.1}
                    value={transitionDuration}
                    onChange={e => setTransitionDuration(parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                  />
                  <span className="text-[9px] text-indigo-400 font-mono min-w-[28px] text-right">{transitionDuration.toFixed(1)}s</span>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
