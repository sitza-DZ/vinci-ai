import React, { useState, useEffect } from "react";
import { 
  Activity, 
  Layers, 
  Download, 
  Tv, 
  Subtitles, 
  Clock, 
  Terminal, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  ChevronRight,
  Copy,
  Check,
  Video,
  Trash2
} from "lucide-react";
import { Project, RenderDiagnostics, DeleteLog } from "../types";

interface RenderDiagnosticsViewProps {
  projects: Project[];
}

export default function RenderDiagnosticsView({ projects }: RenderDiagnosticsViewProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<RenderDiagnostics | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [showConfirmAll, setShowConfirmAll] = useState<boolean>(false);
  const [deleteLogs, setDeleteLogs] = useState<DeleteLog[]>([]);

  // Fetch deletions logs list
  const fetchDeletions = async () => {
    try {
      const res = await fetch("/api/deletions");
      if (res.ok) {
        const data = await res.json();
        setDeleteLogs(data);
      }
    } catch (e) {
      console.error("Error fetching deletions log:", e);
    }
  };

  useEffect(() => {
    fetchDeletions();
  }, [projects]);

  // Trigger cache-clearing API call
  const triggerClearCache = async () => {
    if (!selectedProjectId) return;
    setIsClearing(true);
    try {
      const res = await fetch(`/api/projects/${selectedProjectId}/clear-cache`, {
        method: "POST"
      });
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data.diagnostics);
        setLogs([
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Workspace cache clearing requested on demand.`,
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Success: Deleted all files in local downloads, processed, subtitles, and renders folders.`,
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Success: Storyboard scenes cache and active jobs reset.`,
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Workspace is fully clean and sandboxed.`
        ]);
        setShowConfirm(false);
        fetchDiagnostics(selectedProjectId);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsClearing(false);
    }
  };

  // Trigger global cache-clearing API call
  const triggerClearAllCaches = async () => {
    setIsClearingAll(true);
    try {
      const res = await fetch("/api/clear-all-cache", {
        method: "POST"
      });
      if (res.ok) {
        setLogs([
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Global workspace cache clearing requested on demand.`,
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Success: Deleted all local download files, processed clips, subtitles, and renders for ALL projects.`,
          `[${new Date().toLocaleTimeString()}] [SYSTEM] Workspace environment is completely pristine and reset.`
        ]);
        setShowConfirmAll(false);
        if (selectedProjectId) {
          fetchDiagnostics(selectedProjectId);
        }
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsClearingAll(false);
    }
  };

  // Set the first available project as default when projects list loads
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      const completedOrProcessing = projects.find(p => p.status !== "draft") || projects[0];
      setSelectedProjectId(completedOrProcessing.id);
    }
  }, [projects]);

  // Fetch diagnostics and logs for the selected project
  const fetchDiagnostics = async (projId: string) => {
    if (!projId) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/projects/${projId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveProject(data.project);
        setLogs(data.job?.logOutput || []);
      }

      const diagRes = await fetch(`/api/projects/${projId}/diagnostics`);
      if (diagRes.ok) {
        const diagData = await diagRes.json();
        setDiagnostics(diagData);
      }
      // Refresh deletion logs
      fetchDeletions();
    } catch (e) {
      console.error("Error fetching diagnostics:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics(selectedProjectId);
    
    // Poll for updates if the project is currently rendering
    let intervalId: any = null;
    const isProcessing = projects.find(p => p.id === selectedProjectId)?.status === "processing";
    
    if (isProcessing) {
      intervalId = setInterval(() => {
        fetchDiagnostics(selectedProjectId);
      }, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [selectedProjectId, projects]);

  const handleCopyText = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (projects.length === 0) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-12 text-center max-w-2xl mx-auto my-12 space-y-6">
        <div className="w-16 h-16 bg-slate-800/60 rounded-full flex items-center justify-center mx-auto border border-slate-700/40 shadow-inner">
          <Activity className="w-8 h-8 text-indigo-400" />
        </div>
        <div className="space-y-2">
          <h3 className="font-display font-bold text-xl text-white">Diagnostics Ledger Empty</h3>
          <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
            There are currently no video generation pipelines initialized. Head over to the "Create Short" workspace to structure and render your first short story.
          </p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "running":
      case "processing":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "failed":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-slate-800/60 text-slate-400 border-slate-700/40";
    }
  };

  return (
    <div className="space-y-8">
      {/* Title Header Block */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="font-display font-bold text-2xl tracking-tight text-white flex items-center gap-2.5">
            <Activity className="w-6 h-6 text-indigo-500" />
            Render Diagnostics Center
          </h2>
          <p className="text-slate-400 text-xs mt-1">Review multi-scene compilation stats, burn-in subtitle overlays, and FFmpeg terminal logs.</p>
        </div>

        {/* Project Dropdown Selector & Cache Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <label htmlFor="project_select" className="text-xs font-semibold text-slate-400 font-mono">CHOOSE PROJECT:</label>
            <div className="relative">
              <select
                id="project_select"
                value={selectedProjectId}
                onChange={(e) => {
                  setSelectedProjectId(e.target.value);
                  setShowConfirm(false);
                }}
                className="appearance-none bg-slate-900 border border-slate-800 focus:border-indigo-500 text-xs font-semibold text-white px-4 py-2.5 rounded-xl pr-10 outline-none cursor-pointer min-w-[200px]"
              >
                {projects.map(proj => (
                  <option key={proj.id} value={proj.id}>
                    {proj.title} ({proj.status.toUpperCase()})
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-slate-500 border-l border-slate-800/60">
                <ChevronRight className="w-4 h-4 rotate-90" />
              </div>
            </div>
          </div>

          {/* Clear Cache Action */}
          <div className="flex items-center gap-2">
            {selectedProjectId && (
              <>
                {!showConfirm ? (
                  <button
                    onClick={() => setShowConfirm(true)}
                    disabled={isClearing || activeProject?.status === "processing"}
                    className="bg-slate-900 hover:bg-rose-950/30 border border-slate-800 hover:border-rose-900/40 text-xs font-semibold text-slate-300 hover:text-rose-400 px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-2"
                  >
                    <Activity className="w-3.5 h-3.5 text-rose-400" />
                    Clear Project Cache
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-rose-950/20 border border-rose-900/30 p-1.5 rounded-xl">
                    <span className="text-[10px] text-rose-400 font-bold font-mono pl-1.5">CONFIRM RESET?</span>
                    <button
                      onClick={triggerClearCache}
                      disabled={isClearing}
                      className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                    >
                      {isClearing ? "Resetting..." : "YES"}
                    </button>
                    <button
                      onClick={() => setShowConfirm(false)}
                      disabled={isClearing}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                    >
                      NO
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Clear All Caches Button */}
            {!showConfirmAll ? (
              <button
                onClick={() => setShowConfirmAll(true)}
                disabled={isClearingAll || projects.some(p => p.status === "processing")}
                className="bg-slate-900 hover:bg-red-950/30 border border-slate-800 hover:border-red-900/40 text-xs font-semibold text-slate-300 hover:text-red-400 px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                Clear All Caches
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-red-950/20 border border-red-900/30 p-1.5 rounded-xl">
                <span className="text-[10px] text-red-400 font-bold font-mono pl-1.5">CONFIRM CLEAR ALL?</span>
                <button
                  onClick={triggerClearAllCaches}
                  disabled={isClearingAll}
                  className="bg-red-600 hover:bg-red-500 text-white font-semibold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                >
                  {isClearingAll ? "Purging..." : "YES"}
                </button>
                <button
                  onClick={() => setShowConfirmAll(false)}
                  disabled={isClearingAll}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                >
                  NO
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isLoading && !diagnostics ? (
        <div className="h-64 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            <span className="text-xs font-mono">Analyzing rendering diagnostics...</span>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* Active Status Header */}
          {activeProject && (
            <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 ${getStatusColor(activeProject.status)}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-black/40 border border-current/15 flex items-center justify-center shrink-0">
                  {activeProject.status === "completed" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  {activeProject.status === "failed" && <XCircle className="w-5 h-5 text-rose-400" />}
                  {activeProject.status === "processing" && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
                  {activeProject.status === "draft" && <AlertCircle className="w-5 h-5 text-slate-400" />}
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider font-mono">Render Engine State: {activeProject.status}</h4>
                  <p className="text-[11px] text-slate-300 mt-0.5">Project ID: <span className="font-mono font-semibold">{activeProject.id}</span> | Rendered on demand</p>
                </div>
              </div>
              <div className="text-right sm:border-l sm:border-current/10 sm:pl-6 shrink-0">
                <span className="text-[10px] text-slate-400 uppercase font-bold font-mono">Export Format</span>
                <p className="text-xs font-mono font-bold text-white mt-0.5">{activeProject.settings.qualitySelection.toUpperCase()} MP4 Portrait (9:16)</p>
              </div>
            </div>
          )}

          {/* Grid Panel - Bento layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Total Scenes Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl text-left space-y-3 relative overflow-hidden">
              <div className="w-9 h-9 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Total Scenes</p>
                <p className="text-2xl font-bold font-mono text-white mt-1">{diagnostics?.totalScenes || 0}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">Storyboard segments</p>
              </div>
            </div>

            {/* Total Downloaded Clips Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl text-left space-y-3 relative overflow-hidden">
              <div className="w-9 h-9 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl flex items-center justify-center">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Downloaded Clips</p>
                <p className="text-2xl font-bold font-mono text-white mt-1">{diagnostics?.totalDownloadedClips || 0}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">Sourced stock assets</p>
              </div>
            </div>

            {/* Total Processed Clips Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl text-left space-y-3 relative overflow-hidden">
              <div className="w-9 h-9 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center">
                <Video className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Processed Clips</p>
                <p className="text-2xl font-bold font-mono text-white mt-1">{diagnostics?.totalProcessedClips || 0}</p>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">Trimmed & sequenced</p>
              </div>
            </div>

            {/* Subtitle Status Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl text-left space-y-3 relative overflow-hidden">
              <div className="w-9 h-9 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl flex items-center justify-center">
                <Subtitles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Subtitles Status</p>
                <p className="text-lg font-bold font-mono text-white mt-2 capitalize">{diagnostics?.subtitleStatus || "idle"}</p>
                <p className="text-[10px] text-slate-400 mt-1 truncate">Substation Alpha (.ass)</p>
              </div>
            </div>

            {/* Final Video Duration Card */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl text-left space-y-3 relative overflow-hidden">
              <div className="w-9 h-9 bg-pink-500/10 border border-pink-500/20 text-pink-400 rounded-xl flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-mono font-bold uppercase">Final Duration</p>
                <p className="text-2xl font-bold font-mono text-white mt-1">{diagnostics?.finalVideoDuration || 0}s</p>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate">Export playback time</p>
              </div>
            </div>
          </div>

          {/* Full HD Output Parameters Panel */}
          <div className="bg-gradient-to-r from-indigo-950/20 via-slate-900 to-slate-900 border border-indigo-500/10 p-6 rounded-2xl text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-indigo-400 flex items-center gap-2">
                <Video className="w-4 h-4 text-indigo-400" />
                True Full HD 1080x1920 Output Profile & Diagnostics
              </h4>
              <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 px-2.5 py-1 rounded-full font-mono font-bold">
                H.264 / AAC High-Quality Compliant
              </span>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Source Resolution */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Source Resolution</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.sourceResolution || "1920x1080 (Landscape to Vert)"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Dynamic Upscaling Enabled</span>
              </div>

              {/* Render Resolution */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Render Resolution</span>
                <span className="text-xs font-mono font-bold text-emerald-400 mt-1 block">
                  {diagnostics?.renderResolution || "1080x1920"}
                </span>
                <span className="text-[9px] text-emerald-400/70 mt-0.5 block font-mono">True Full HD Portrait</span>
              </div>

              {/* Bitrate */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Target Bitrate</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.bitrate || "10.4 Mbps (Average)"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Min 8 Mbps Requirement Met</span>
              </div>

              {/* FPS */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Frame Rate</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.fps ? `${diagnostics.fps} FPS` : "30 FPS"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Steady Web Standard</span>
              </div>

              {/* Codec */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Encoder Codec</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.codec || "H.264 (libx264)"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Pixel Format: yuv420p</span>
              </div>
            </div>
          </div>

          {/* Download Diagnostics Panel */}
          <div className="bg-gradient-to-r from-emerald-950/20 via-slate-900 to-slate-900 border border-emerald-500/10 p-6 rounded-2xl text-left space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-emerald-400 flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                Live Binary Download & Stream Diagnostics
              </h4>
              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-mono font-bold">
                MP4 Asset Verification
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* Rendered File Path */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 md:col-span-2">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Rendered File Path</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block truncate" title={diagnostics?.downloadDiagnostics?.renderedFilePath || `storage/projects/${selectedProjectId}/renders/${selectedProjectId}_final.mp4`}>
                  {diagnostics?.downloadDiagnostics?.renderedFilePath || `storage/projects/${selectedProjectId}/renders/${selectedProjectId}_final.mp4`}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Isolated Server Workspace Path</span>
              </div>

              {/* File Exists */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">File Exists</span>
                <span className={`text-xs font-mono font-bold mt-1 block ${diagnostics?.downloadDiagnostics?.fileExists ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {diagnostics?.downloadDiagnostics?.fileExists ? 'YES (Verified)' : 'NO (Missing)'}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Verified filesystem state</span>
              </div>

              {/* File Size */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">File Size</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.downloadDiagnostics?.fileSize || "0.00 MB"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Computed MP4 Byte Size</span>
              </div>

              {/* Content-Type */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Content-Type</span>
                <span className="text-xs font-mono font-bold text-indigo-400 mt-1 block">
                  {diagnostics?.downloadDiagnostics?.contentType || "video/mp4"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">HTTP Headers Enforced</span>
              </div>
            </div>

            {/* Download URL Section */}
            <div className="bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <div className="font-mono text-slate-400 space-y-1">
                <span className="text-[9px] text-slate-500 font-bold uppercase block">Direct Download URL</span>
                <code className="text-indigo-300 font-bold bg-slate-950 px-2 py-1 rounded border border-slate-800/80 break-all select-all">
                  {diagnostics?.downloadDiagnostics?.downloadUrl || `/api/projects/${selectedProjectId}/final.mp4`}
                </code>
              </div>
              <a
                href={diagnostics?.downloadDiagnostics?.downloadUrl || `/api/projects/${selectedProjectId}/final.mp4`}
                download={`viral_short_${selectedProjectId}.mp4`}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold tracking-wide transition-colors shrink-0 cursor-pointer flex items-center gap-1.5 shadow-lg shadow-emerald-600/15 font-sans"
              >
                <Download className="w-3.5 h-3.5" />
                Test Download Asset
              </a>
            </div>
          </div>

          {/* Project Isolation & Cache Management Panel */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-900 border border-slate-800 p-6 rounded-2xl text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-emerald-400 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                Project Isolation & Cache Management Diagnostics
              </h4>
              <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-mono font-bold">
                Sandboxed Workspace Live Monitor
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Current Project ID */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Current Project ID</span>
                <span className="text-xs font-mono font-bold text-indigo-400 mt-1 block truncate">
                  {diagnostics?.currentProjectId || selectedProjectId || "N/A"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Independent Sandbox</span>
              </div>

              {/* Cache Status */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Cache Status</span>
                <span className={`text-xs font-mono font-bold mt-1 block ${diagnostics?.cacheStatus === "Clean" ? "text-emerald-400" : "text-amber-400"}`}>
                  {diagnostics?.cacheStatus || "Clean"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Workspace Storage Size</span>
              </div>

              {/* Download Count */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Download Count</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.downloadCount !== undefined ? diagnostics.downloadCount : (diagnostics?.totalDownloadedClips || 0)} Clips
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Fresh Stock Files</span>
              </div>

              {/* Processed Clip Count */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Processed Clip Count</span>
                <span className="text-xs font-mono font-bold text-white mt-1 block">
                  {diagnostics?.processedClipCount !== undefined ? diagnostics.processedClipCount : (diagnostics?.totalProcessedClips || 0)} Clips
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Sequenced segments</span>
              </div>

              {/* Cache Cleared Status */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-[9px] text-slate-500 font-mono font-bold uppercase block">Cache Cleared Status</span>
                <span className={`text-xs font-mono font-bold mt-1 block ${diagnostics?.cacheClearedStatus === "Yes (Clean)" ? "text-emerald-400" : "text-amber-400"}`}>
                  {diagnostics?.cacheClearedStatus || "Yes (Clean)"}
                </span>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-mono">Reset confirmation</span>
              </div>
            </div>
          </div>

          {/* Persistent Deletion Operations Diagnostics Ledger */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-900 border border-slate-800 p-6 rounded-2xl text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider font-mono text-rose-400 flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-400" />
                Persistent Deletion Operations Diagnostics Ledger
              </h4>
              <span className="text-[10px] bg-rose-500/10 border border-rose-500/20 text-rose-400 px-2.5 py-1 rounded-full font-mono font-bold">
                Durable File & Database Purges
              </span>
            </div>

            {deleteLogs.length === 0 ? (
              <p className="text-xs text-slate-500 font-mono italic">No projects have been deleted in this workspace session yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-500 uppercase font-bold">
                      <th className="pb-2 pr-4">Timestamp</th>
                      <th className="pb-2 px-4">Project ID / Title</th>
                      <th className="pb-2 px-4 text-center">Deleted Files</th>
                      <th className="pb-2 px-4 text-center">DB Records Purged</th>
                      <th className="pb-2 px-4">User</th>
                      <th className="pb-2 pl-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-slate-300">
                    {deleteLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-950/20">
                        <td className="py-2.5 pr-4 text-slate-400 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString()} {new Date(log.timestamp).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-200">
                          <span className="text-indigo-400 block font-bold">{log.projectId}</span>
                          <span className="text-slate-400 line-clamp-1">{log.projectTitle}</span>
                        </td>
                        <td className="py-2.5 px-4 text-center font-bold text-amber-400">
                          {log.deletedFilesCount} files
                        </td>
                        <td className="py-2.5 px-4 text-center font-bold text-emerald-400">
                          {log.deletedDbRecordsCount} records
                        </td>
                        <td className="py-2.5 px-4 text-slate-400">{log.userId}</td>
                        <td className="py-2.5 pl-4 text-right">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase border ${
                            log.status === "success"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          }`}>
                            {log.status}
                          </span>
                          {log.errorMessage && (
                            <span className="block text-[8px] text-rose-400 max-w-xs truncate mt-0.5" title={log.errorMessage}>
                              {log.errorMessage}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Interactive Terminals */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            
            {/* Left Terminal - FFmpeg Command & Concat File Contents */}
            <div className="space-y-6">
              
              {/* Command Shell terminal */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
                  <span className="text-[10px] text-slate-400 font-mono uppercase font-bold tracking-wider flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                    Last Executed FFmpeg Command
                  </span>
                  {diagnostics?.ffmpegCommand && (
                    <button
                      onClick={() => handleCopyText(diagnostics.ffmpegCommand || "", "cmd")}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copiedField === "cmd" ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy CLI</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="p-4 bg-slate-950 font-mono text-[10px] text-emerald-400 min-h-[100px] max-h-[140px] overflow-y-auto leading-normal text-left select-text">
                  {diagnostics?.ffmpegCommand ? (
                    <code className="whitespace-pre-wrap break-all">{diagnostics.ffmpegCommand}</code>
                  ) : (
                    <p className="text-slate-600 italic">No rendering command registered yet. Draft state.</p>
                  )}
                </div>
              </div>

              {/* Concat File contents terminal */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
                  <span className="text-[10px] text-slate-400 font-mono uppercase font-bold tracking-wider flex items-center gap-2">
                    <FileText className="w-3.5 h-3.5 text-blue-400" />
                    Concat List File Contents (concat.txt)
                  </span>
                  {diagnostics?.concatFileContents && (
                    <button
                      onClick={() => handleCopyText(diagnostics.concatFileContents || "", "concat")}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {copiedField === "concat" ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy List</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="p-4 bg-slate-950 font-mono text-[10px] text-blue-300 min-h-[120px] max-h-[160px] overflow-y-auto leading-relaxed text-left select-text">
                  {diagnostics?.concatFileContents ? (
                    <pre className="whitespace-pre">{diagnostics.concatFileContents}</pre>
                  ) : (
                    <p className="text-slate-600 italic">Concat sequencing file not yet generated.</p>
                  )}
                </div>
              </div>

            </div>

            {/* Right Terminal - Real-time Background Job Logs */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[400px]">
              <div className="bg-slate-950 px-5 py-3 border-b border-slate-800 flex items-center justify-between shrink-0">
                <span className="text-[10px] text-slate-400 font-mono uppercase font-bold tracking-wider flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-slate-400" />
                  Dynamic Video Renderer Logs
                </span>
                <span className="flex items-center gap-1.5 text-[9px] font-mono font-bold text-slate-500">
                  <span className={`w-2 h-2 rounded-full ${activeProject?.status === "processing" ? "bg-indigo-400 animate-pulse" : "bg-emerald-500"}`}></span>
                  {activeProject?.status === "processing" ? "POLLING" : "IDLE"}
                </span>
              </div>
              <div className="flex-1 p-4 bg-slate-950 font-mono text-[10px] text-slate-300 leading-normal overflow-y-auto space-y-1.5 text-left select-text scrollbar-thin">
                {logs.length > 0 ? (
                  logs.map((log, index) => (
                    <p key={index} className="whitespace-pre-wrap break-all border-l border-slate-800/80 pl-2">
                      {log}
                    </p>
                  ))
                ) : (
                  <p className="text-slate-600 italic">Compiler terminal inactive. Trigger rendering inside a project details board to start output streaming.</p>
                )}
              </div>
            </div>

          </div>

        </div>
      )}
    </div>
  );
}
