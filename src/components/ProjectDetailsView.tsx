import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Play,
  Pause,
  RefreshCw,
  Download,
  Settings,
  Maximize2,
  Edit,
  Search,
  Subtitles,
  Tv,
  Terminal,
  Check,
  FileText,
  Volume2,
  VolumeX,
  Sparkles,
  Copy,
  ChevronRight,
  Loader2,
  ClipboardCheck,
  Type,
  Image
} from "lucide-react";
import {
  Project,
  Scene,
  ProcessingJob,
  SubtitleStyleType,
  TransitionType,
  ProjectStatus,
  StockClip,
  AudioLibraryTrack
} from "../types";

interface ProjectDetailsViewProps {
  projectId: string;
  onBack: () => void;
}

export default function ProjectDetailsView({ projectId, onBack }: ProjectDetailsViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [job, setJob] = useState<ProcessingJob | null>(null);

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sceneStartTimestampRef = useRef<number>(0);

  // Full-screen video preview overlay state
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);
  const [fullScreenMode, setFullScreenMode] = useState<"storyboard" | "rendered">("storyboard");
  const fullScreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const [fullDuration, setFullDuration] = useState(0);
  const [fullCurrentTime, setFullCurrentTime] = useState(0);
  const [isFullScreenPlaying, setIsFullScreenPlaying] = useState(false);
  const [isFullScreenMuted, setIsFullScreenMuted] = useState(true);

  // Keyboard shortcut listener for escape key to close fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullScreenOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Sync scene start time when play state or scene index changes
  useEffect(() => {
    if (isPlaying || isFullScreenPlaying) {
      sceneStartTimestampRef.current = Date.now();
    }
  }, [isPlaying, isFullScreenPlaying, activeSceneIndex]);

  // Handle synchronization of states when entering/exiting fullscreen preview overlay
  useEffect(() => {
    if (isFullScreenOpen) {
      if (videoRef.current) {
        videoRef.current.pause();
      }
      setIsFullScreenPlaying(isPlaying);
      setIsFullScreenMuted(isMuted);
      if (project?.status === ProjectStatus.COMPLETED) {
        setFullScreenMode("rendered");
      } else {
        setFullScreenMode("storyboard");
      }
    } else {
      setIsPlaying(isFullScreenPlaying);
      setIsMuted(isFullScreenMuted);
    }
  }, [isFullScreenOpen]);

  // Storyboard editing
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [sceneEditText, setSceneEditText] = useState("");
  const [sceneEditHook, setSceneEditHook] = useState("");

  // Live styling options (override project settings in real time!)
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [selectedStyle, setSelectedStyle] = useState<SubtitleStyleType>(SubtitleStyleType.TIKTOK);
  const [fontSize, setFontSize] = useState(14);
  const [position, setPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [opacity, setOpacity] = useState(0.9);
  const [wordSpacing, setWordSpacing] = useState(8);
  const [letterSpacing, setLetterSpacing] = useState(8);

  // Transition state
  const [transitionType, setTransitionType] = useState<TransitionType>(TransitionType.NONE);
  const [transitionDuration, setTransitionDuration] = useState(0.3);

  // Swap Clip Modal state
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const [modalClips, setModalClips] = useState<StockClip[]>([]);
  const [isSearchingModal, setIsSearchingModal] = useState(false);

  // TikTok import state
  const [tiktokMode, setTiktokMode] = useState(false);
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [isDownloadingTikTok, setIsDownloadingTikTok] = useState(false);
  const [tiktokDownloaded, setTiktokDownloaded] = useState<StockClip | null>(null);
  const [tiktokError, setTiktokError] = useState("");

  // Pinterest import state
  const [pinterestMode, setPinterestMode] = useState(false);
  const [pinterestUrl, setPinterestUrl] = useState("");
  const [isDownloadingPinterest, setIsDownloadingPinterest] = useState(false);
  const [pinterestDownloaded, setPinterestDownloaded] = useState<StockClip | null>(null);
  const [pinterestError, setPinterestError] = useState("");

  // SEO modal/results state
  const [isGeneratingSEO, setIsGeneratingSEO] = useState(false);
  const [seoResult, setSeoResult] = useState<{ viralTitle: string; description: string; hashtags: string[] } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Copy Script state
  const [copyScriptSuccess, setCopyScriptSuccess] = useState(false);

  // Thumbnail state
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // YouTube upload state
  const [youtubeAuth, setYoutubeAuth] = useState<boolean | null>(null);
  const [youtubeHasCookies, setYoutubeHasCookies] = useState(false);
  const [isYoutubeUploading, setIsYoutubeUploading] = useState(false);
  const [youtubeResult, setYoutubeResult] = useState<{ url: string; title: string } | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduledInfo, setScheduledInfo] = useState<{ scheduledAt: string; status: string } | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);

  // Check YouTube auth status
  useEffect(() => {
    fetch("/api/youtube/status").then(r => r.json()).then(d => {
      setYoutubeAuth(d.authenticated);
      setYoutubeHasCookies(d.hasCookies || false);
    }).catch(() => {});
  }, []);

  // Handle YouTube upload
  const handleYoutubeUpload = async () => {
    if (!project) return;
    if (!youtubeAuth && !youtubeHasCookies) {
      window.location.href = "/api/youtube/auth";
      return;
    }
    setIsYoutubeUploading(true);
    try {
      const res = await fetch(`/api/youtube/upload/${project!.id}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setYoutubeResult(data);
      } else if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        console.error("Upload failed:", data.error);
      }
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsYoutubeUploading(false);
    }
  };

  // TTS state
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsVoice, setTtsVoice] = useState("hi-IN-SwaraNeural");
  const [ttsRate, setTtsRate] = useState("+0%");
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);

  useEffect(() => {
    if (project?.settings) {
      setTtsEnabled(project.settings.edgeTtsEnabled ?? false);
      if (project.settings.edgeTtsVoice) setTtsVoice(project.settings.edgeTtsVoice);
      if (project.settings.edgeTtsRate) setTtsRate(project.settings.edgeTtsRate);
    }
  }, [project]);

  const handleTtsToggle = async (enabled: boolean) => {
    setTtsEnabled(enabled);
    if (project) {
      project.settings.edgeTtsEnabled = enabled;
      project.settings.edgeTtsRate = ttsRate;
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project.settings)
      });
    }
  };

  const handleGenerateTts = async () => {
    if (!project) return;
    setIsGeneratingTts(true);
    setTtsStatus("Generating voiceover...");
    try {
      const res = await fetch(`/api/projects/${project.id}/tts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: ttsVoice, rate: ttsRate })
      });
      const data = await res.json();
      if (data.success) {
        setAudioVoiceover(data.audioTrack);
        setTtsStatus(null);
      } else {
        setTtsStatus(`Error: ${data.error}`);
      }
    } catch (e: any) {
      setTtsStatus(`Error: ${e.message}`);
    } finally {
      setIsGeneratingTts(false);
    }
  };

  // Schedule handlers
  useEffect(() => {
    if (!project) return;
    if ((project as any).scheduledAt) {
      setScheduledInfo({ scheduledAt: (project as any).scheduledAt, status: (project as any).uploadScheduleStatus || "pending" });
    }
  }, [project]);

  const handleSchedule = async () => {
    if (!project || !scheduleDate || !scheduleTime) return;
    setIsScheduling(true);
    try {
      const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const res = await fetch(`/api/youtube/schedule/${project.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt })
      });
      const data = await res.json();
      if (data.success) {
        setScheduledInfo({ scheduledAt, status: "pending" });
        setScheduleDate("");
        setScheduleTime("");
      }
    } catch (e) { console.error(e); }
    finally { setIsScheduling(false); }
  };

  const handleCancelSchedule = async () => {
    if (!project) return;
    try {
      await fetch(`/api/youtube/schedule/${project.id}/cancel`, { method: "POST" });
      setScheduledInfo(null);
    } catch (e) { console.error(e); }
  };

  // Audio state
  const [audioVoiceover, setAudioVoiceover] = useState<{ url: string; name: string; size: number; duration: number } | null>(null);
  const [audioBgm, setAudioBgm] = useState<{ url: string; name: string; size: number; duration: number } | null>(null);
  const [audioSfx, setAudioSfx] = useState<{ url: string; name: string; duration: number } | null>(null);
  const [voiceVolume, setVoiceVolume] = useState(100);
  const [musicVolume, setMusicVolume] = useState(15);
  const [bgmMode, setBgmMode] = useState<string>("none");
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPreviewId, setAudioPreviewId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Built-in BGM Library & SFX state
  const [showBgmLibrary, setShowBgmLibrary] = useState(false);
  const [showSfxBrowser, setShowSfxBrowser] = useState(false);
  const [bgmCategories, setBgmCategories] = useState<Record<string, any[]>>({});
  const [sfxCategories, setSfxCategories] = useState<Record<string, any[]>>({});
  const [sfxSelectedCategory, setSfxSelectedCategory] = useState<string | null>(null);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [sfxLoading, setSfxLoading] = useState(false);
  const [autoSfxEnabled, setAutoSfxEnabled] = useState(false);
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const previewAudioRef2 = useRef<HTMLAudioElement | null>(null);
  const [previewSfxUrl, setPreviewSfxUrl] = useState<string | null>(null);
  const sfxPreviewRef = useRef<HTMLAudioElement | null>(null);

  // Load audio tracks from project settings
  useEffect(() => {
    if (project?.settings?.audioSettings) {
      const as = project.settings.audioSettings as any;
      if (as.voiceoverTrack) setAudioVoiceover(as.voiceoverTrack);
      if (as.bgmTrack) setAudioBgm(as.bgmTrack);
      if (as.voiceVolume) setVoiceVolume(as.voiceVolume);
      if (as.musicVolume) setMusicVolume(as.musicVolume);
      if (as.bgmMode) setBgmMode(as.bgmMode);
    }
  }, [project?.id]);

  // Audio handlers
  const handleAudioUpload = async (type: "voiceover" | "bgm", file: File) => {
    setIsUploadingAudio(true);
    setAudioError(null);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const b64 = reader.result as string;
        const res = await fetch(`/api/projects/${project?.id}/audio/${type}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioData: b64, format: file.name.endsWith(".wav") ? "wav" : "mp3" })
        });
        const data = await res.json();
        if (data.success && data.audioTrack) {
          if (type === "voiceover") setAudioVoiceover(data.audioTrack);
          else setAudioBgm(data.audioTrack);
        } else {
          setAudioError(data.error || "Upload failed");
        }
        setIsUploadingAudio(false);
      };
      reader.onerror = () => { setAudioError("File read failed"); setIsUploadingAudio(false); };
    } catch (e: any) {
      setAudioError(e.message);
      setIsUploadingAudio(false);
    }
  };

  const handleAudioRemove = async (type: "voiceover" | "bgm") => {
    await fetch(`/api/projects/${project?.id}/audio/${type}`, { method: "DELETE" });
    if (type === "voiceover") setAudioVoiceover(null);
    else setAudioBgm(null);
  };

  const handleAudioSync = async () => {
    const res = await fetch(`/api/projects/${project?.id}/audio/sync`, { method: "POST" });
    const data = await res.json();
    if (data.success) setAudioError(null);
    else setAudioError(data.error);
  };

  const handlePreviewAudio = (url: string | null) => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    if (!url) { setAudioPreviewId(null); return; }
    const audio = new Audio(url);
    audio.onended = () => setAudioPreviewId(null);
    audio.play().catch(() => {});
    previewAudioRef.current = audio;
    setAudioPreviewId(url);
  };

  const handleSaveAudioSettings = async () => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/render`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          audioSettings: {
            voiceVolume, musicVolume, bgmMode,
            autoSync: true,
            voiceoverTrack: audioVoiceover,
            bgmTrack: audioBgm
          }
        }
      })
    });
    if (res.ok) setAudioError(null);
  };

  // Library preview handler
  // Load built-in BGM categories from server
  const loadBgmCategories = async () => {
    setBgmLoading(true);
    try {
      const res = await fetch("/api/audio/builtin/bgm");
      if (res.ok) setBgmCategories(await res.json());
    } catch {} finally {
      setBgmLoading(false);
    }
  };

  // Load built-in SFX categories from server
  const loadSfxCategories = async () => {
    setSfxLoading(true);
    try {
      const res = await fetch("/api/audio/builtin/sfx");
      if (res.ok) {
        const data = await res.json();
        setSfxCategories(data);
        const keys = Object.keys(data);
        if (keys.length > 0) setSfxSelectedCategory(keys[0]);
      }
    } catch {} finally {
      setSfxLoading(false);
    }
  };

  // Apply built-in BGM to project
  const handleApplyBuiltinBgm = async (track: any) => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/audio/apply-builtin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bgm", fileName: track.name, filePath: track.filePath })
    });
    const data = await res.json();
    if (data.success && data.audioTrack) {
      setAudioBgm(data.audioTrack);
      setShowBgmLibrary(false);
    } else {
      setAudioError(data.error || "Failed to apply BGM");
    }
  };

  // Open BGM library and load categories
  const handleOpenBgmLibrary = () => {
    setShowBgmLibrary(true);
    loadBgmCategories();
  };
  // Open SFX browser and load categories
  const handleOpenSfxBrowser = () => {
    setShowSfxBrowser(true);
    loadSfxCategories();
  };

  const handleBgmPreview = (url: string | null) => {
    if (previewAudioRef2.current) { previewAudioRef2.current.pause(); previewAudioRef2.current = null; }
    if (!url) { setPreviewAudioUrl(null); return; }
    const audio = new Audio(url);
    audio.onended = () => setPreviewAudioUrl(null);
    audio.play().catch(() => {});
    previewAudioRef2.current = audio;
    setPreviewAudioUrl(url);
  };

  const handleSfxPreview = (url: string | null) => {
    if (sfxPreviewRef.current) { sfxPreviewRef.current.pause(); sfxPreviewRef.current = null; }
    if (!url) { setPreviewSfxUrl(null); return; }
    const audio = new Audio(url);
    audio.onended = () => setPreviewSfxUrl(null);
    audio.play().catch(() => {});
    sfxPreviewRef.current = audio;
    setPreviewSfxUrl(url);
  };
  // Apply built-in SFX to project
  const handleApplyBuiltinSfx = async (track: any) => {
    if (!project) return;
    const res = await fetch(`/api/projects/${project.id}/audio/apply-builtin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sfx", fileName: track.name, filePath: track.filePath })
    });
    const data = await res.json();
    if (data.success && data.audioTrack) {
      setAudioSfx({ url: data.audioTrack.url, name: data.audioTrack.fileName, duration: data.audioTrack.duration });
      setShowSfxBrowser(false);
    } else {
      setAudioError(data.error || "Failed to apply SFX");
    }
  };

  useEffect(() => {
    if (showBgmLibrary && Object.keys(bgmCategories).length === 0) loadBgmCategories();
  }, [showBgmLibrary]);

  // Handle Thumbnail Generation
  const handleGenerateThumbnail = async () => {
    if (!project) return;
    setIsGeneratingThumbnail(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/thumbnail`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setThumbnailUrl(data.thumbnailUrl);
      }
    } catch (e) {
      console.error("Thumbnail generation error:", e);
    } finally {
      setIsGeneratingThumbnail(false);
    }
  };

  // Fetch full project data
  const fetchData = async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data.project);
        setScenes(data.scenes);
        setJob(data.job);

        // Apply defaults from settings on load
        if (data.project) {
          setSubtitleEnabled(data.project.settings.subtitleEnabled);
          setSelectedStyle(data.project.settings.subtitleStyle);
          setFontSize(data.project.settings.fontSize !== undefined ? data.project.settings.fontSize : 14);
          setWordSpacing(data.project.settings.wordSpacing !== undefined ? data.project.settings.wordSpacing : 8);
          setLetterSpacing(data.project.settings.letterSpacing !== undefined ? data.project.settings.letterSpacing : 8);
          setTransitionType(data.project.settings.transitionType || TransitionType.NONE);
          if (data.project.settings.transitionDuration !== undefined) {
            setTransitionDuration(data.project.settings.transitionDuration);
          }
          setAutoSfxEnabled(data.project.settings.autoSfxEnabled ?? false);
        }
      }
    } catch (e) {
      console.error("Error fetching project data:", e);
    }
  };

  useEffect(() => {
    fetchData();
  }, [projectId]);

  // Polling for Render Job progress (runs every 2 seconds if status is processing)
  useEffect(() => {
    let intervalId: any = null;
    if (project?.status === ProjectStatus.PROCESSING) {
      intervalId = setInterval(async () => {
        try {
          const res = await fetch(`/api/projects/${projectId}`);
          if (res.ok) {
            const data = await res.json();
            setProject(data.project);
            setJob(data.job);
            if (data.project.status !== ProjectStatus.PROCESSING) {
              clearInterval(intervalId);
              setScenes(data.scenes); // load compiled scenes
            }
          }
        } catch (e) {
          console.error("Error polling job status:", e);
        }
      }, 2000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [project?.status]);

  // Player timeline tick & loop scenes sequently when "Playing full short"
  useEffect(() => {
    let animationFrameId: any = null;
    
    const activePlayer = isFullScreenOpen && fullScreenMode === "storyboard" ? fullScreenVideoRef.current : videoRef.current;
    const activePlayState = isFullScreenOpen ? isFullScreenPlaying : isPlaying;

    if (activePlayState && activePlayer) {
      const updateTimeline = () => {
        const player = isFullScreenOpen && fullScreenMode === "storyboard" ? fullScreenVideoRef.current : videoRef.current;
        if (player) {
          const currentVideoTime = player.currentTime;
          if (isFullScreenOpen) {
            setFullCurrentTime(currentVideoTime);
          } else {
            setCurrentTime(currentVideoTime);
          }

          // Get active scene based on video time matching scene duration or elapsed wall-clock time
          const currentScene = scenes[activeSceneIndex];
          const elapsed = (Date.now() - sceneStartTimestampRef.current) / 1000;

          if (currentScene && (currentVideoTime >= currentScene.duration || elapsed >= currentScene.duration)) {
            // Move to next scene if available
            if (activeSceneIndex < scenes.length - 1) {
              setActiveSceneIndex(prev => prev + 1);
              if (player) {
                player.currentTime = 0;
              }
            } else {
              // Full short ended. Rewind or stop
              if (isFullScreenOpen) {
                setIsFullScreenPlaying(false);
              } else {
                setIsPlaying(false);
              }
              setActiveSceneIndex(0);
              if (player) {
                player.currentTime = 0;
              }
            }
          }
        }
        animationFrameId = requestAnimationFrame(updateTimeline);
      };
      animationFrameId = requestAnimationFrame(updateTimeline);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, isFullScreenPlaying, isFullScreenOpen, fullScreenMode, activeSceneIndex, scenes]);

  // Handle scene change (swapping background source video for active player)
  useEffect(() => {
    if (isFullScreenOpen && fullScreenMode === "storyboard") {
      if (fullScreenVideoRef.current) {
        fullScreenVideoRef.current.load();
        if (isFullScreenPlaying) {
          fullScreenVideoRef.current.play().catch(e => console.log("Auto-play prevented", e));
        }
      }
    } else if (videoRef.current) {
      videoRef.current.load();
      if (isPlaying) {
        videoRef.current.play().catch(e => console.log("Auto-play prevented", e));
      }
    }
  }, [activeSceneIndex, scenes, isFullScreenOpen, fullScreenMode]);

  // Manage fullscreen player play/pause and mute state
  useEffect(() => {
    if (isFullScreenOpen && fullScreenVideoRef.current) {
      fullScreenVideoRef.current.muted = isFullScreenMuted;
      
      if (isFullScreenPlaying) {
        fullScreenVideoRef.current.play().catch(e => console.log("Auto-play prevented", e));
      } else {
        fullScreenVideoRef.current.pause();
      }
    }
  }, [isFullScreenPlaying, isFullScreenMuted, isFullScreenOpen, fullScreenMode, activeSceneIndex]);

  // Trigger server-side FFmpeg compiler
  const handleTriggerRender = async () => {
    if (!project) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            subtitleEnabled,
            subtitleStyle: selectedStyle,
            fontSize,
            wordSpacing,
            letterSpacing
          }
        })
      });

      if (res.ok) {
        setProject({
          ...project,
          status: ProjectStatus.PROCESSING
        });
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Open clip swap search window (full manual search)
  const openSwapModal = (sceneIndex: number) => {
    const scene = scenes[sceneIndex];
    if (!scene) return;
    const query = scene.keywords.join(" ") || scene.visualDescription || "";
    setModalSearchQuery(query);
    setActiveSceneIndex(sceneIndex);
    setIsSwapModalOpen(true);
    handleModalSearch(query);
  };

  const handleModalSearch = async (query: string) => {
    setIsSearchingModal(true);
    try {
      // Full search: skip AI scoring, get 15+ results from Pexels/Pixabay
      // Duplicate prevention handled server-side via projectId
      const url = `/api/search?query=${encodeURIComponent(query)}&full=true&projectId=${project!.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setModalClips(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearchingModal(false);
    }
  };

  // Get used clip IDs from all scenes EXCEPT the one being swapped
  const getUsedClipIds = (): Set<string> => {
    const used = new Set<string>();
    scenes.forEach(s => {
      if (s.id !== scenes[activeSceneIndex]?.id && s.selectedVideoId) {
        used.add(s.selectedVideoId);
      }
    });
    return used;
  };

  // Download TikTok video and add as clip
  const handleTikTokDownload = async () => {
    if (!tiktokUrl.trim()) return;
    setIsDownloadingTikTok(true);
    setTiktokError("");
    setTiktokDownloaded(null);
    try {
      const res = await fetch("/api/tiktok/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: tiktokUrl.trim(), projectId: project!.id })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Server error: ${res.status}`);
      }
      const data = await res.json();
      if (data.clip) {
        const newClip: StockClip = {
          id: data.clip.id,
          provider: "tiktok",
          url: data.clip.url,
          previewUrl: "",
          title: data.clip.title || "TikTok Import",
          duration: 10,
          width: 1080,
          height: 1920,
          tags: ["tiktok", "imported"],
          relevanceScore: 100,
          scoreExplanation: "User-imported TikTok video.",
          aspectRatio: "9:16"
        };
        setTiktokDownloaded(newClip);
        // Auto-add to current scene
        await handleSwapClip(newClip);
        setIsSwapModalOpen(false);
      }
    } catch (e: any) {
      setTiktokError(e.message || "TikTok download failed. Check the URL or try again.");
      console.error("TikTok download error:", e);
    } finally {
      setIsDownloadingTikTok(false);
    }
  };

  // Download Pinterest pin video and add as clip
  const handlePinterestDownload = async () => {
    if (!pinterestUrl.trim()) return;
    setIsDownloadingPinterest(true);
    setPinterestError("");
    setPinterestDownloaded(null);
    try {
      const res = await fetch("/api/pinterest/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pinterestUrl.trim(), projectId: project!.id })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Server error: ${res.status}`);
      }
      const data = await res.json();
      if (data.clip) {
        const newClip: StockClip = {
          id: data.clip.id,
          provider: "pinterest",
          url: data.clip.url,
          previewUrl: "",
          title: data.clip.title || "Pinterest Import",
          duration: 10,
          width: 1080,
          height: 1920,
          tags: ["pinterest", "imported"],
          relevanceScore: 100,
          scoreExplanation: "User-imported from Pinterest.",
          aspectRatio: "9:16"
        };
        setPinterestDownloaded(newClip);
        await handleSwapClip(newClip);
        setIsSwapModalOpen(false);
      }
    } catch (e: any) {
      setPinterestError(e.message || "Pinterest download failed. Check the URL or try again.");
      console.error("Pinterest download error:", e);
    } finally {
      setIsDownloadingPinterest(false);
    }
  };

  const handleSwapClip = async (clip: StockClip) => {
    const scene = scenes[activeSceneIndex];
    if (!scene) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/${scene.id}/swap-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip })
      });

      if (res.ok) {
        const updatedScene = await res.json();
        // Update local scenes state
        setScenes(scenes.map(s => s.id === scene.id ? updatedScene : s));
        setIsSwapModalOpen(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Generate SEO suggestions
  const handleGenerateSEO = async () => {
    if (!project) return;
    setIsGeneratingSEO(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/seo`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSeoResult(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingSEO(false);
    }
  };

  // Save edited subtitle script text
  const handleSaveSceneText = async (sceneId: string) => {
    const target = scenes.find(s => s.id === sceneId);
    if (!target) return;

    target.text = sceneEditText;
    target.hook = sceneEditHook;
    try {
      // Simulate/post to server scene edit
      const res = await fetch(`/api/projects/${projectId}/scenes/${sceneId}/swap-clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clip: { url: target.selectedVideoUrl, id: target.selectedVideoId, provider: target.selectedVideoProvider, previewUrl: target.selectedVideoPreviewUrl, duration: target.selectedVideoDuration } })
      });
      if (res.ok) {
        // Simple update local
        setScenes(scenes.map(s => s.id === sceneId ? { ...s, text: sceneEditText, hook: sceneEditHook } : s));
        setEditingSceneId(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Copy Script functionality
  const getFullScript = () => {
    if (project?.script && project.script.trim()) {
      return project.script;
    }
    // Fallback: concatenate all scene texts
    return scenes.map(s => s.text).join("\n\n");
  };

  const handleCopyScript = async () => {
    const scriptText = getFullScript();
    if (!scriptText.trim()) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(scriptText);
      } else {
        // Fallback for non-secure contexts
        const textArea = document.createElement("textarea");
        textArea.value = scriptText;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopyScriptSuccess(true);
      setTimeout(() => setCopyScriptSuccess(false), 2500);
    } catch (err) {
      console.error("Failed to copy script:", err);
      // Try fallback
      try {
        const textArea = document.createElement("textarea");
        textArea.value = scriptText;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopyScriptSuccess(true);
        setTimeout(() => setCopyScriptSuccess(false), 2500);
      } catch (fallbackErr) {
        console.error("Fallback copy also failed:", fallbackErr);
      }
    }
  };

  const getScriptStats = () => {
    const scriptText = getFullScript();
    const words = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
    const chars = scriptText.length;
    return { words, chars };
  };

  // Render player subtitle based on style template selection
  const renderSubtitles = (isFullScreen = false) => {
    if (!subtitleEnabled) return null;
    const activeScene = scenes[activeSceneIndex];
    if (!activeScene) return null;

    // Split text into words to simulate dynamic keyword highlight
    const words = activeScene.text.split(" ");
    const halfIndex = Math.floor(words.length / 2);

    const scaleFactor = isFullScreen ? 1.4 : 1.0;
    const currentFontSize = fontSize * scaleFactor;

    let positionClass = isFullScreen ? "bottom-24" : "bottom-12";
    if (position === "center") positionClass = "top-1/2 -translate-y-1/2";
    if (position === "top") positionClass = isFullScreen ? "top-24" : "top-12";

    const getTemplateStyles = () => {
      switch (selectedStyle) {
        case SubtitleStyleType.YOUTUBE:
          return (
            <div className="text-center px-4">
              <span className="font-display font-extrabold uppercase italic tracking-wide text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] text-shadow-thick animate-bounce" style={{ fontSize: `${currentFontSize}px`, textShadow: `${isFullScreen ? "4px 4px" : "3px 3px"} 0px #000`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                🔥 {activeScene.text}
              </span>
            </div>
          );
        case SubtitleStyleType.MINIMAL:
          return (
            <div className="bg-black/70 px-4 py-2 rounded-xl border border-slate-800/40 max-w-[85%] mx-auto text-center backdrop-blur-sm animate-fade-in">
              <p className="font-sans font-medium text-slate-100 tracking-tight leading-relaxed" style={{ fontSize: `${currentFontSize - 4}px`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                {activeScene.text}
              </p>
            </div>
          );
        case SubtitleStyleType.CINEMATIC:
          return (
            <div className="text-center px-6 max-w-[90%] mx-auto animate-fade-in" style={{ fontFamily: "Georgia, serif" }}>
              <p className="font-medium text-slate-200 tracking-widest leading-loose italic" style={{ fontSize: `${currentFontSize - 2}px`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                "{activeScene.text}"
              </p>
            </div>
          );
        case SubtitleStyleType.GAMING:
          return (
            <div className="text-center px-4">
              <span className="font-display font-black uppercase text-yellow-300 tracking-tighter filter drop-shadow-[0_2px_8px_rgba(234,179,8,0.6)] animate-pulse" style={{ fontSize: `${currentFontSize + 2}px`, WebkitTextStroke: `${isFullScreen ? "2px" : "1.5px"} black`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                🎯 {activeScene.text}
              </span>
            </div>
          );
        case SubtitleStyleType.ARABIC_PREMIUM:
          return (
            <div className="text-center px-4" dir="auto">
              <p className="font-sans font-bold text-white drop-shadow-lg leading-loose" style={{ fontSize: `${currentFontSize + 4}px`, textShadow: "0 2px 4px rgba(0,0,0,0.9)", wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                {activeScene.text}
              </p>
            </div>
          );
        default: // TIKTOK Style
          return (
            <div className="text-center px-4 select-none leading-none">
              <p className="font-display font-black uppercase tracking-tight flex flex-wrap justify-center leading-normal" style={{ fontSize: `${currentFontSize}px`, columnGap: `${wordSpacing * 1.5 + 4}px`, rowGap: "8px" }}>
                {words.map((word, idx) => {
                  const isHighlighted = idx === halfIndex || idx === halfIndex - 1;
                  return (
                    <span 
                      key={idx} 
                      style={{ letterSpacing: `${letterSpacing}px` }}
                      className={`inline-block py-1 px-1.5 rounded transition-all duration-300 ${
                        isHighlighted 
                          ? "text-yellow-400 bg-black/90 scale-110 rotate-1 shadow-lg border border-yellow-400/20" 
                          : "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]"
                      }`}
                    >
                      {word}
                    </span>
                  );
                })}
              </p>
            </div>
          );
      }
    };

    return (
      <div 
        className={`absolute left-0 right-0 z-10 p-4 pointer-events-none transition-all duration-300 flex items-center justify-center ${positionClass}`}
        style={{ opacity }}
      >
        {getTemplateStyles()}
      </div>
    );
  };

  const getStepProgress = (step: string) => {
    switch (step) {
      case "script": return 20;
      case "scenes": return 40;
      case "searching": return 60;
      case "downloading": return 80;
      case "rendering": return 90;
      case "completed": return 100;
      default: return 0;
    }
  };

  if (!project) {
    return (
      <div className="space-y-6 animate-pulse">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-10 w-36 bg-slate-800/60 rounded-xl" />
          <div className="h-5 w-48 bg-slate-800/40 rounded" />
        </div>
        {/* 3-column grid skeleton */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          {/* Left column - Storyboard */}
          <div className="xl:col-span-4 space-y-4">
            <div className="h-7 w-40 bg-slate-800/50 rounded" />
            {[1,2,3,4].map(i => (
              <div key={i} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex justify-between">
                  <div className="h-4 w-24 bg-slate-800/60 rounded" />
                  <div className="h-4 w-16 bg-slate-800/40 rounded" />
                </div>
                <div className="h-3 w-full bg-slate-800/60 rounded" />
                <div className="h-3 w-3/4 bg-slate-800/40 rounded" />
                <div className="h-3 w-1/2 bg-slate-800/40 rounded" />
              </div>
            ))}
          </div>
          {/* Middle column - Phone frame */}
          <div className="xl:col-span-4 flex flex-col items-center space-y-4">
            <div className="h-7 w-48 bg-slate-800/50 rounded" />
            <div className="w-full max-w-[320px] aspect-[9/16] bg-slate-900 rounded-[32px] border-4 border-slate-800" />
            <div className="w-full max-w-[320px] h-48 bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3">
              <div className="h-4 w-32 bg-slate-800/60 rounded" />
              <div className="h-3 w-full bg-slate-800/40 rounded" />
              <div className="h-8 w-full bg-slate-800/60 rounded-lg" />
            </div>
          </div>
          {/* Right column - Render panel */}
          <div className="xl:col-span-4 space-y-6">
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4">
              <div className="h-6 w-48 bg-slate-800/50 rounded" />
              <div className="h-3 w-full bg-slate-800/40 rounded" />
              <div className="h-12 w-full bg-slate-800/60 rounded-xl" />
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="h-4 w-32 bg-slate-800/50 rounded" />
              <div className="h-3 w-full bg-slate-800/40 rounded" />
              <div className="h-3 w-3/4 bg-slate-800/40 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeScene = scenes[activeSceneIndex];

  return (
    <div className="space-y-6 relative">
      
      {/* Swap Footage Clip Browser Modal popup */}
      {isSwapModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="font-display font-bold text-lg text-white">Swap Storyboard Footage</h4>
                <p className="text-slate-400 text-xs mt-0.5">Search multiple stock API providers and select the ultimate matching clip.</p>
              </div>
              <button 
                onClick={() => setIsSwapModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-xs font-semibold px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>

            {/* Modal Search Input bar — hidden in import modes */}
            {!tiktokMode && !pinterestMode && (
            <div className="p-4 bg-slate-950 border-b border-slate-800/60 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleModalSearch(modalSearchQuery)}
                  placeholder="Enter custom keywords (e.g., galaxy, cyber tech, finance bills...)"
                  className="w-full bg-slate-900 border border-slate-800 focus:border-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 outline-none"
                />
              </div>
              <button
                onClick={() => handleModalSearch(modalSearchQuery)}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0"
              >
                Search API
              </button>
            </div>
            )}

            {/* Import Mode Toggle: Stock API Search | TikTok | Pinterest */}
            <div className="flex gap-2 px-4 pt-3 pb-1 bg-slate-950 border-b border-slate-800/40 shrink-0 sticky top-0 z-10">
              <button
                onClick={() => { setTiktokMode(false); setPinterestMode(false); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-colors cursor-pointer shrink-0 ${
                  !tiktokMode && !pinterestMode ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200 bg-slate-800/50"
                }`}
              >
                Stock API Search
              </button>
              <button
                onClick={() => { setTiktokMode(true); setPinterestMode(false); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-colors cursor-pointer shrink-0 ${
                  tiktokMode ? "bg-rose-600 text-white" : "text-slate-400 hover:text-slate-200 bg-slate-800/50"
                }`}
              >
                🎵 TikTok Import
              </button>
              <button
                onClick={() => { setPinterestMode(true); setTiktokMode(false); }}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-colors cursor-pointer shrink-0 ${
                  pinterestMode ? "bg-red-700 text-white" : "text-slate-400 hover:text-slate-200 bg-slate-800/50"
                }`}
              >
                📌 Pinterest Import
              </button>
            </div>

            {/* TikTok Import section */}
            {tiktokMode && (
              <div className="p-4 bg-slate-950 border-b border-slate-800/60 space-y-3">
                <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                  Paste a TikTok video URL to download and use as footage. Works with any public TikTok video.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="url"
                    value={tiktokUrl}
                    onChange={(e) => { setTiktokUrl(e.target.value); setTiktokError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleTikTokDownload()}
                    placeholder="https://www.tiktok.com/@user/video/1234567890"
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-rose-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleTikTokDownload}
                    disabled={isDownloadingTikTok || !tiktokUrl.trim()}
                    className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    {isDownloadingTikTok ? (
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Downloading...
                      </span>
                    ) : "Download"}
                  </button>
                </div>
                {tiktokError && (
                  <p className="text-[10px] text-rose-400 font-mono">{tiktokError}</p>
                )}
                {tiktokDownloaded && !tiktokError && (
                  <p className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    ✅ TikTok video imported! Applying to scene...
                  </p>
                )}
              </div>
            )}

            {/* Pinterest Import section */}
            {pinterestMode && (
              <div className="p-4 bg-slate-950 border-b border-slate-800/60 space-y-3">
                <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
                  Paste a Pinterest pin URL to download the video/image. Works with any public Pinterest pin.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="url"
                    value={pinterestUrl}
                    onChange={(e) => { setPinterestUrl(e.target.value); setPinterestError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handlePinterestDownload()}
                    placeholder="https://www.pinterest.com/pin/1234567890/"
                    className="flex-1 bg-slate-900 border border-slate-800 focus:border-red-500 rounded-xl px-4 py-2.5 text-sm text-slate-100 outline-none"
                  />
                  <button
                    type="button"
                    onClick={handlePinterestDownload}
                    disabled={isDownloadingPinterest || !pinterestUrl.trim()}
                    className="px-4 py-2.5 bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    {isDownloadingPinterest ? (
                      <span className="flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Downloading...
                      </span>
                    ) : "Download"}
                  </button>
                </div>
                {pinterestError && (
                  <p className="text-[10px] text-rose-400 font-mono">{pinterestError}</p>
                )}
                {pinterestDownloaded && !pinterestError && (
                  <p className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    ✅ Pinterest pin imported! Applying to scene...
                  </p>
                )}
              </div>
            )}

            {/* Modal Results list — hidden in import modes */}
            {!tiktokMode && !pinterestMode && (
            <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-950/20">
              {isSearchingModal ? (
                <div className="py-12 text-center">
                  <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Fetching footage from Pexels, Pixabay & more...</p>
                </div>
              ) : modalClips.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  No footage found. Try different keywords like "space", "nature", "money", or "tech".
                </div>
              ) : (
                <div className="space-y-1 mb-3 text-[10px] text-slate-500 font-mono">
                  {modalClips.length} results — click any clip to swap
                </div>
              )}
              {!isSearchingModal && modalClips.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {modalClips.map((clip) => (
                    <div
                      key={clip.id}
                      onClick={() => { if (!getUsedClipIds().has(clip.id)) handleSwapClip(clip); }}
                      className={`border rounded-xl overflow-hidden cursor-pointer bg-slate-900/60 flex flex-col group relative ${getUsedClipIds().has(clip.id) ? "border-amber-700/50 opacity-50" : "border-slate-800 hover:border-indigo-500/80"}`}
                    >
                      <div className="aspect-video bg-slate-950 relative overflow-hidden">
                        <img
                          src={clip.previewUrl}
                          alt={clip.title}
                          className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-300"
                        />
                        <span className="absolute top-2 right-2 text-[9px] bg-black/80 px-1 py-0.5 rounded border border-slate-800 text-slate-300 font-mono">
                          {clip.aspectRatio.toUpperCase()}
                        </span>
                        {getUsedClipIds().has(clip.id) ? (
                          <span className="absolute top-2 left-2 text-[9px] bg-amber-700/90 text-white font-mono px-1.5 py-0.5 rounded">
                            USED
                          </span>
                        ) : (
                          <span className="absolute bottom-2 left-2 text-[9px] bg-indigo-600/90 text-white font-mono px-1.5 py-0.5 rounded">
                            Score: {clip.relevanceScore}%
                          </span>
                        )}
                      </div>
                      <div className="p-3 space-y-1">
                        <h5 className="text-[11px] font-semibold text-slate-200 line-clamp-1 group-hover:text-indigo-400 transition-colors">
                          {clip.title}
                        </h5>
                        <p className="text-[9px] text-slate-400 truncate uppercase tracking-wider font-mono">Provider: {clip.provider}</p>
                        {clip.scoreExplanation && (
                          <p className="text-[9px] text-slate-500 italic line-clamp-1 mt-1 border-t border-slate-800/50 pt-1">
                            {clip.scoreExplanation}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      )}

      {/* Breadcrumb back navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-200 text-xs font-semibold px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
          <span>Project Workspace</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-indigo-400">{project.id}</span>
        </div>
      </div>

      {/* Two Column Workspace Grid */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
        className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-8 items-start"
      >
        
        {/* LEFT COLUMN - Storyboard & Scene Management (4 cols) */}
        <div className="xl:col-span-4 space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-[#2FD0C4] rounded-full shadow-[0_0_8px_#2FD0C4]"></span>
              <h3 className="font-display font-bold text-lg text-[#F3F6FA]">Storyboard</h3>
            </div>
            <span className="text-[10px] bg-slate-900 border border-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
              {scenes.length} scenes
            </span>
          </div>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {scenes.map((scene, idx) => {
              const isActive = activeSceneIndex === idx;
              const isEditing = editingSceneId === scene.id;

              return (
                <motion.div
                  key={scene.id}
                  id={`storyboard_scene_${scene.id}`}
                  onClick={() => setActiveSceneIndex(idx)}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.06, ease: [0.34, 1.56, 0.64, 1] }}
                  whileHover={{ scale: 1.008, borderColor: "rgba(99,102,241,0.4)" }}
                  whileTap={{ scale: 0.99 }}
                  className={`p-3 sm:p-4 rounded-xl border transition-colors cursor-pointer text-left space-y-3 relative overflow-hidden min-h-[60px] ${
                    isActive
                      ? "bg-indigo-600/10 border-indigo-500/80 shadow-md shadow-indigo-600/5 glow-pulse"
                      : "bg-slate-900 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {/* Scene Number Index Indicator */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400">
                      Scene {idx + 1} ({scene.duration}s)
                    </span>
                    <span className="text-[9px] font-mono bg-slate-950/80 border border-slate-800 px-1.5 py-0.5 rounded text-slate-400 capitalize">
                      {scene.selectedVideoProvider}
                    </span>
                  </div>

                  {/* Hook Text - Attention Grabber */}
                  {scene.hook && (
                    <div className="bg-gradient-to-r from-amber-600/15 to-orange-600/10 border border-amber-600/30 rounded-lg px-3 py-1.5 flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-600/20 px-1.5 py-0.5 rounded font-mono">HOOK</span>
                      <span className="text-xs font-bold text-amber-300 truncate">{scene.hook}</span>
                    </div>
                  )}

                  {/* Scene Text segment */}
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 uppercase font-bold font-mono tracking-wider">Subtitles / Narration</label>
                    {isEditing ? (
                      <div className="space-y-2" onClick={e => e.stopPropagation()}>
                        {/* Hook Edit */}
                        {scene.hook && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-amber-400 bg-amber-600/20 px-1.5 py-0.5 rounded font-mono uppercase">Hook</span>
                            <input
                              value={sceneEditHook}
                              onChange={(e) => setSceneEditHook(e.target.value)}
                              className="flex-1 bg-slate-950 border border-amber-600/30 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 outline-none"
                              placeholder="Attention-grabbing hook..."
                            />
                          </div>
                        )}
                        <textarea
                          value={sceneEditText}
                          onChange={(e) => setSceneEditText(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none resize-none h-16"
                        />
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => setEditingSceneId(null)}
                            className="px-2 py-1 bg-slate-800 text-[10px] text-slate-300 rounded font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveSceneText(scene.id)}
                            className="px-2.5 py-1 bg-indigo-600 text-[10px] text-white rounded font-bold cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between group/text gap-2">
                        <p className="text-xs font-medium text-slate-200 leading-relaxed italic">
                          "{scene.text}"
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingSceneId(scene.id);
                            setSceneEditText(scene.text);
                            setSceneEditHook(scene.hook || "");
                          }}
                          className="text-slate-500 hover:text-slate-300 opacity-0 group-hover/text:opacity-100 p-1 hover:bg-slate-800 rounded transition-all cursor-pointer shrink-0"
                          title="Edit Script"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Scene visual details */}
                  <div className="space-y-1 text-[11px] text-slate-400 leading-relaxed border-t border-slate-800/40 pt-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold font-mono tracking-wider block">AI Stock Footage Prompt</span>
                    <p className="line-clamp-2 text-slate-300 text-[11px]">{scene.visualDescription}</p>
                  </div>

                  {/* Metadata and Swap Button */}
                  <div className="flex items-center justify-between border-t border-slate-800/40 pt-2">
                    <span className="text-[9px] text-slate-400 truncate max-w-[65%] font-mono">
                      Query tags: {scene.keywords.slice(0, 2).join(", ")}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveSceneIndex(idx);
                        openSwapModal(idx);
                      }}
                      className="flex items-center gap-1 px-2 py-1 bg-slate-950 border border-slate-800 hover:bg-slate-800 rounded text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold transition-colors cursor-pointer"
                    >
                      <Search className="w-3 h-3" />
                      Swap Footage
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* MIDDLE COLUMN - The Flagship Vertical Player (4 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease: [0.34, 1.56, 0.64, 1] }}
          className="xl:col-span-4 flex flex-col items-center space-y-3 sm:space-y-4"
        >
          <div className="w-full flex items-center justify-between border-b border-slate-800 pb-2 sm:pb-3 shrink-0 px-1">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-[#2FD0C4] rounded-full shadow-[0_0_8px_#2FD0C4]"></span>
                <span className="hud-label text-[10px]">Live Preview</span>
              </div>
              <span className="tag-chip tag-chip--signal text-[9px]">9:16</span>
            </div>

          {/* High Fidelity Mobile/Vertical Framing Canvas */}
          <div className="w-full max-w-[320px] aspect-[9/16] bg-slate-950 rounded-[32px] border-4 border-slate-800 shadow-2xl relative overflow-hidden group flex flex-col justify-between">
            {/* Screen Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-4 bg-slate-800 rounded-b-xl z-20 pointer-events-none"></div>

            {/* Video Background render */}
            {activeScene ? (
              <div className="absolute inset-0 z-0">
                <video
                  ref={videoRef}
                  src={activeScene.selectedVideoUrl}
                  loop
                  muted={isMuted}
                  className="w-full h-full object-cover"
                  playsInline
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/30 pointer-events-none"></div>
              </div>
            ) : (
              <div className="absolute inset-0 bg-slate-900 flex items-center justify-center p-6 text-center text-xs text-slate-500">
                Select or generate storyboard scenes to render.
              </div>
            )}

            {/* Subtitle overlays burnt here dynamically */}
            {renderSubtitles()}

            {/* Left and Right Scene swap triggers */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-between px-3 pointer-events-none z-10 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setActiveSceneIndex(prev => Math.max(0, prev - 1))}
                disabled={activeSceneIndex === 0}
                className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 border border-slate-800 flex items-center justify-center text-white pointer-events-auto cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
              >
                &lsaquo;
              </button>
              <button
                onClick={() => setActiveSceneIndex(prev => Math.min(scenes.length - 1, prev + 1))}
                disabled={activeSceneIndex === scenes.length - 1}
                className="w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 border border-slate-800 flex items-center justify-center text-white pointer-events-auto cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
              >
                &rsaquo;
              </button>
            </div>

            {/* Vertical Video Metadata overlay / aesthetic profile */}
            <div className="absolute top-6 left-4 z-10 text-[10px] text-slate-300 font-mono flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2 py-1 rounded border border-slate-800/30">
              <Tv className="w-3.5 h-3.5 text-indigo-400" />
              <span>Scene {activeSceneIndex + 1}/{scenes.length}</span>
            </div>

            {/* Maximize / Full-screen overlay trigger */}
            <div className="absolute top-6 right-4 z-10">
              <button
                onClick={() => {
                  setFullScreenMode("storyboard");
                  setIsFullScreenOpen(true);
                }}
                className="p-1.5 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-slate-800/30 text-slate-300 hover:text-white transition-all cursor-pointer flex items-center justify-center shadow-lg hover:scale-105 active:scale-95"
                title="Full-Screen Playback"
              >
                <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              </button>
            </div>

            {/* Bottom Controls strip */}
            <div className="absolute bottom-4 inset-x-4 bg-black/60 border border-slate-800/50 backdrop-blur-md rounded-2xl p-2.5 z-10 flex items-center justify-between gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-white cursor-pointer shrink-0"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              <div className="flex-1 text-[10px] font-mono text-slate-300 truncate">
                <p className="font-semibold text-slate-100 truncate">{project.title}</p>
                <p className="text-slate-400 text-[9px]">Codec: H264 | 1080x1920</p>
              </div>

              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-800 rounded-lg cursor-pointer"
                title={isMuted ? "Unmute Ambiance" : "Mute Video"}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4 text-indigo-400 animate-pulse" />}
              </button>
            </div>
          </div>

          {/* Quick styling live tweaks below phone frame */}
          <div className="w-full max-w-[320px] bg-slate-900 border border-slate-800 p-4 rounded-2xl space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase flex items-center gap-1">
                <Subtitles className="w-3.5 h-3.5 text-indigo-400" />
                Live Subtitle Studio
              </span>
              <button
                onClick={() => setSubtitleEnabled(!subtitleEnabled)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                  subtitleEnabled 
                    ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" 
                    : "bg-slate-950 border-slate-800 text-slate-500"
                }`}
              >
                {subtitleEnabled ? "ENABLED" : "MUTED"}
              </button>
            </div>

            {subtitleEnabled && (
              <div className="space-y-3 text-xs">
                {/* Template choice */}
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold font-mono">Style Preset</span>
                  <select
                    value={selectedStyle}
                    onChange={(e) => setSelectedStyle(e.target.value as SubtitleStyleType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
                  >
                    <option value={SubtitleStyleType.TIKTOK}>TikTok Highlights</option>
                    <option value={SubtitleStyleType.YOUTUBE}>YouTube Shorts Outline</option>
                    <option value={SubtitleStyleType.MINIMAL}>Modern Minimal</option>
                    <option value={SubtitleStyleType.CINEMATIC}>Cinematic Serif</option>
                    <option value={SubtitleStyleType.GAMING}>Gaming Yellow Neon</option>
                    <option value={SubtitleStyleType.ARABIC_PREMIUM}>Arabic Premium (RTL)</option>
                  </select>
                </div>

                {/* Font Size slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                    <span>Font Scale</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setFontSize(Math.max(0, fontSize - 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={fontSize}
                        onChange={(e) => {
                          let val = Number(e.target.value);
                          if (isNaN(val)) val = 0;
                          setFontSize(Math.min(100, Math.max(0, val)));
                        }}
                        className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => setFontSize(Math.min(100, fontSize + 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                  />
                </div>

                {/* Word Spacing slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                    <span>Word Spacing</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setWordSpacing(Math.max(0, wordSpacing - 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={wordSpacing}
                        onChange={(e) => {
                          let val = Number(e.target.value);
                          if (isNaN(val)) val = 0;
                          setWordSpacing(Math.min(50, Math.max(0, val)));
                        }}
                        className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => setWordSpacing(Math.min(50, wordSpacing + 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                    value={wordSpacing}
                    onChange={(e) => setWordSpacing(Number(e.target.value))}
                    className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                  />
                </div>

                {/* Letter Spacing slider */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                    <span>Letter Spacing</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setLetterSpacing(Math.max(0, letterSpacing - 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={letterSpacing}
                        onChange={(e) => {
                          let val = Number(e.target.value);
                          if (isNaN(val)) val = 0;
                          setLetterSpacing(Math.min(50, Math.max(0, val)));
                        }}
                        className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => setLetterSpacing(Math.min(50, letterSpacing + 1))}
                        className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                    value={letterSpacing}
                    onChange={(e) => setLetterSpacing(Number(e.target.value))}
                    className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                  />
                </div>

                {/* Layout Position selection */}
                <div className="space-y-1">
                  <span className="text-[10px] text-slate-500 uppercase font-bold font-mono block mb-1">Canvas Positioning</span>
                  <div className="grid grid-cols-3 gap-1">
                    {["top", "center", "bottom"].map(pos => (
                      <button
                        key={pos}
                        onClick={() => setPosition(pos as any)}
                        className={`py-1 text-[10px] font-mono font-bold capitalize rounded border transition-colors ${
                          position === pos 
                            ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" 
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* RIGHT COLUMN - Render Queue status & System Terminal Logs (4 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
          className="xl:col-span-4 space-y-4 sm:space-y-6"
        >

          {/* Script Box - Copy Script Feature */}
          <div className="bg-slate-900 border border-slate-800 p-3 sm:p-5 rounded-xl space-y-3 sm:space-y-4 ticks card-glow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="w-2 h-2 bg-[#2FD0C4] rounded-full shadow-[0_0_8px_#2FD0C4]"></span>
                <span className="hud-label text-[10px]">Generated Script</span>
              </div>
              <button
                onClick={handleCopyScript}
                disabled={!getFullScript().trim()}
                className="outline-btn text-[10px] font-bold px-3 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Copy className="w-3.5 h-3.5" />
                {copyScriptSuccess ? (
                  <span className="text-emerald-400">✓ Script Copied</span>
                ) : (
                  <span>Copy Script</span>
                )}
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 max-h-64 overflow-y-auto font-mono text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
              {getFullScript().trim() ? getFullScript() : (
                <span className="text-slate-500 italic">No script generated yet. Generate a storyboard first.</span>
              )}
            </div>

            <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500">
              <span>Words: {getScriptStats().words}</span>
              <span>Characters: {getScriptStats().chars}</span>
            </div>
          </div>

          {/* Audio Management Panel */}
          <div className="bg-slate-900 border border-slate-800 p-3 sm:p-5 rounded-xl space-y-3 sm:space-y-4 ticks card-glow">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-[#2FD0C4] rounded-full shadow-[0_0_8px_#2FD0C4]"></span>
              <span className="hud-label text-[10px]">Audio Studio</span>
            </div>

            {/* Hidden Audio Preview Element */}
            <audio ref={previewAudioRef} className="hidden" />

            {/* AI Voiceover TTS Section */}
            <div className="space-y-2 border-b border-slate-800 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  AI Voiceover (edge-tts)
                </span>
                <button
                  onClick={() => handleTtsToggle(!ttsEnabled)}
                  className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${ttsEnabled ? "bg-[#2FD0C4]" : "bg-slate-700"}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${ttsEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              </div>
              {ttsEnabled && (
                <div className="space-y-2">
                  <select value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-[#2FD0C4] rounded-lg px-2 py-1.5 text-[10px] text-slate-200 outline-none cursor-pointer font-mono"
                  >
                    <optgroup label="Hindi">
                      <option value="hi-IN-SwaraNeural">Swara (Female)</option>
                      <option value="hi-IN-MadhurNeural">Madhur (Male)</option>
                    </optgroup>
                    <optgroup label="Arabic">
                      <option value="ar-SA-ZariyahNeural">Zariyah (Female)</option>
                      <option value="ar-SA-HamedNeural">Hamed (Male)</option>
                      <option value="ar-EG-SalmaNeural">Salma (Egypt, Female)</option>
                    </optgroup>
                    <optgroup label="English">
                      <option value="en-US-JennyNeural">Jenny (US, Female)</option>
                      <option value="en-US-GuyNeural">Guy (US, Male)</option>
                      <option value="en-GB-SoniaNeural">Sonia (UK, Female)</option>
                    </optgroup>
                    <optgroup label="Urdu">
                      <option value="ur-PK-UzmaNeural">Uzma (Female)</option>
                      <option value="ur-PK-AsadNeural">Asad (Male)</option>
                    </optgroup>
                    <optgroup label="Turkish">
                      <option value="tr-TR-EmelNeural">Emel (Female)</option>
                      <option value="tr-TR-AhmetNeural">Ahmet (Male)</option>
                    </optgroup>
                  </select>
                  {/* Speed control */}
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono text-slate-500 min-w-[28px] text-right">Slow</span>
                    <input type="range" min="-50" max="50" value={parseInt(ttsRate)} step="5"
                      onChange={e => {
                        const val = e.target.value;
                        const rateStr = `${parseInt(val) >= 0 ? "+" : ""}${val}%`;
                        setTtsRate(rateStr);
                        if (project) {
                          project.settings.edgeTtsRate = rateStr;
                          fetch("/api/settings", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(project.settings)
                          });
                        }
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-[#2FD0C4] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#2FD0C4] [&::-webkit-slider-thumb]:shadow-[0_0_6px_#2FD0C4]"
                    />
                    <span className="text-[9px] font-mono text-slate-500 min-w-[28px]">Fast</span>
                    <span className="text-[9px] font-mono text-[#2FD0C4] min-w-[36px] text-right">{ttsRate}</span>
                  </div>
                  <button onClick={handleGenerateTts} disabled={isGeneratingTts}
                    className="w-full bg-gradient-to-r from-[#2FD0C4]/20 to-[#2FD0C4]/10 hover:from-[#2FD0C4]/30 hover:to-[#2FD0C4]/20 border border-[#2FD0C4]/30 text-[#2FD0C4] text-[9px] font-bold font-mono rounded-lg py-1.5 cursor-pointer disabled:opacity-50 transition-all"
                  >
                    {isGeneratingTts ? `Generating...` : `Generate Voiceover (${ttsVoice.split("-").slice(2).join(" ")})`}
                  </button>
                  {ttsStatus && <p className="text-[9px] text-slate-500 font-mono">{ttsStatus}</p>}
                </div>
              )}
            </div>

            {/* Voiceover Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Voiceover</span>
                {audioVoiceover && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handlePreviewAudio(audioVoiceover.url)} className="outline-btn !px-2 !py-0.5 !text-[9px]">
                      {audioPreviewId === audioVoiceover.url ? "Playing..." : "Play"}
                    </button>
                    <button onClick={() => handleAudioRemove("voiceover")} className="outline-btn !px-2 !py-0.5 !text-[9px] !border-rose-500/30 !text-rose-400 hover:!border-rose-500">Remove</button>
                  </div>
                )}
              </div>

              {audioVoiceover ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="truncate max-w-[120px]">{audioVoiceover.name}</span>
                    <span>{(audioVoiceover.duration || 0).toFixed(1)}s</span>
                  </div>
                  <div className="h-1.5 bg-slate-950 border border-slate-800 rounded-full overflow-hidden">
                    <div className="h-full w-full bg-gradient-to-r from-[#2FD0C4]/30 to-[#2FD0C4]/60 rounded-full" />
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-lg p-3 cursor-pointer hover:border-[#2FD0C4]/40 transition-colors">
                  <input type="file" accept=".mp3,.wav" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) handleAudioUpload("voiceover", f);
                  }} />
                  <span className="text-[9px] font-mono text-slate-500 text-center leading-relaxed">
                    Tap to upload MP3/WAV<br />voiceover file
                  </span>
                  {isUploadingAudio && <span className="text-[8px] text-[#2FD0C4] mt-1">Uploading...</span>}
                </label>
              )}
            </div>

            {/* BGM Section */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Background Music</span>
                {audioBgm && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handlePreviewAudio(audioBgm.url)} className="outline-btn !px-2 !py-0.5 !text-[9px]">
                      {audioPreviewId === audioBgm.url ? "Playing..." : "Play"}
                    </button>
                    <button onClick={() => handleAudioRemove("bgm")} className="outline-btn !px-2 !py-0.5 !text-[9px] !border-rose-500/30 !text-rose-400 hover:!border-rose-500">Remove</button>
                  </div>
                )}
              </div>

              {audioBgm ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="truncate max-w-[120px]">{audioBgm.name}</span>
                    <span>{(audioBgm.duration || 0).toFixed(1)}s</span>
                  </div>
                  <div className="h-1.5 bg-slate-950 border border-slate-800 rounded-full overflow-hidden">
                    <div className="h-full w-2/3 bg-gradient-to-r from-violet-500/30 to-violet-500/60 rounded-full" />
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-lg p-3 cursor-pointer hover:border-[#2FD0C4]/40 transition-colors">
                  <input type="file" accept=".mp3,.wav" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0]; if (f) handleAudioUpload("bgm", f);
                  }} />
                  <span className="text-[9px] font-mono text-slate-500 text-center leading-relaxed">
                    Tap to upload background<br />music MP3/WAV
                  </span>
                </label>
              )}
            </div>

            {/* Auto SFX Toggle */}
            <div className="flex items-center justify-between bg-slate-950 border border-slate-800/60 rounded-xl px-3 py-2.5">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Auto Sound Effects</label>
                <p className="text-[8px] text-slate-500 mt-0.5">Places SFX based on scene text emotion</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const newVal = !autoSfxEnabled;
                  setAutoSfxEnabled(newVal);
                  if (project) {
                    project.settings.autoSfxEnabled = newVal;
                    await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(project.settings)
                    });
                  }
                }}
                className={`w-9 h-5 rounded-full transition-all relative flex-shrink-0 ${
                  autoSfxEnabled ? "bg-indigo-600" : "bg-slate-800"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all ${
                  autoSfxEnabled ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
            </div>

            {/* BGM Library & SFX Browser Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={handleOpenBgmLibrary}
                className="outline-btn !py-1.5 !text-[9px] text-[10px] flex items-center justify-center gap-1">
                <span className="text-sm">🎵</span> BGM Library
              </button>
              <button onClick={handleOpenSfxBrowser}
                className="outline-btn !py-1.5 !text-[9px] text-[10px] flex items-center justify-center gap-1">
                <span className="text-sm">🔊</span> SFX Browser
              </button>
            </div>

            {/* Volume Controls */}
            {(audioVoiceover || audioBgm) && (
              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                {audioVoiceover && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-slate-400">Voice Volume</span>
                      <span className="text-[#2FD0C4]">{voiceVolume}%</span>
                    </div>
                    <input type="range" min={0} max={200} value={voiceVolume}
                      onChange={(e) => setVoiceVolume(Number(e.target.value))}
                      className="w-full accent-[#2FD0C4] bg-slate-950 h-1 rounded-full cursor-pointer" />
                  </div>
                )}
                {audioBgm && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[9px] font-mono">
                      <span className="text-slate-400">Music Volume</span>
                      <span className="text-violet-400">{musicVolume}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={musicVolume}
                      onChange={(e) => setMusicVolume(Number(e.target.value))}
                      className="w-full accent-violet-500 bg-slate-950 h-1 rounded-full cursor-pointer" />
                  </div>
                )}

                {/* BGM Mode Selector */}
                {audioBgm && (
                  <div className="grid grid-cols-3 gap-1">
                    {[{ id: "none", label: "No FX" }, { id: "loop", label: "Loop" }, { id: "fade_in", label: "Fade In" },
                      { id: "fade_out", label: "Fade Out" }, { id: "fade_both", label: "Fade I+O" }].map(m => (
                      <button key={m.id} onClick={() => setBgmMode(m.id)}
                        className={`text-[8px] font-mono font-bold py-1 rounded border transition-colors cursor-pointer ${
                          bgmMode === m.id ? "border-[#2FD0C4]/50 bg-[#2FD0C4]/10 text-[#2FD0C4]" : "border-slate-800 text-slate-500 hover:text-slate-300"
                        }`}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Auto Sync + Save */}
                <div className="flex items-center gap-1.5 pt-1">
                  {audioVoiceover && (
                    <button onClick={handleAudioSync} className="outline-btn !px-2 !py-1 !text-[9px] text-[10px]">
                      ↻ Auto Sync Scenes
                    </button>
                  )}
                  <button onClick={handleSaveAudioSettings} className="outline-btn !px-2 !py-1 !text-[9px] text-[10px] ml-auto">
                      Save Audio Settings
                  </button>
                </div>
              </div>
            )}

            {audioError && <div className="text-[9px] text-rose-400 font-mono">{audioError}</div>}
          </div>

          {/* Main Action card depending on Status */}
          <div className="bg-slate-900 border border-slate-800 p-3 sm:p-5 rounded-xl space-y-3 sm:space-y-4 ticks card-glow">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 bg-[#2FD0C4] rounded-full shadow-[0_0_8px_#2FD0C4]"></span>
              <span className="hud-label text-[10px]">Render Pipeline</span>
            </div>

            {project.status === ProjectStatus.DRAFT && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  The storyboard is fully structured and source videos are matched. Click below to execute the background FFmpeg render compiler.
                </p>
                <button
                  id="btn_trigger_render"
                  onClick={handleTriggerRender}
                  className="outline-btn w-full justify-center text-[11px] font-semibold"
                >
                  <RefreshCw className="w-4 h-4 animate-spin-slow" />
                  Render Final Short MP4
                </button>
              </div>
            )}

            {project.status === ProjectStatus.PROCESSING && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-indigo-400 uppercase font-bold animate-pulse">
                    Rendering Project...
                  </span>
                  <span>{job?.progress || 10}%</span>
                </div>
                {/* Visual Progress Bar */}
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${job?.progress || 10}%` }}
                  ></div>
                </div>
                <div className="flex items-center gap-2 p-2.5 bg-slate-950 rounded-xl border border-slate-800/60 text-[10px] text-slate-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 block animate-ping"></span>
                  <span>Active Step: {job?.step.toUpperCase()}</span>
                </div>
              </div>
            )}

            {project.status === ProjectStatus.COMPLETED && (
              <div className="space-y-4">
                <div className="p-3.5 bg-emerald-500/5 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <p className="font-semibold text-emerald-400">Short Render Successful!</p>
                    <p className="text-slate-400">MP4 compiled at 1080x1920 30FPS. Sound layers matched and normalized.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950 p-3 rounded-xl border border-slate-800/60 text-slate-400">
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold">Duration</p>
                    <p className="text-slate-200 mt-0.5">{project.duration}s</p>
                  </div>
                  <div>
                    <p className="text-slate-500 text-[10px] uppercase font-bold">File Size</p>
                    <p className="text-slate-200 mt-0.5">{project.fileSize}</p>
                  </div>
                </div>

                {/* Download Verification Diagnostics */}
                <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800/80 text-left space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                    <span className="text-[10px] text-indigo-400 font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <Download className="w-3.5 h-3.5" />
                      Download Diagnostics
                    </span>
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono font-bold">
                      VERIFIED MP4
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[10px] font-mono text-slate-400">
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-500">Rendered File Path:</span>
                      <span className="text-slate-200 select-all truncate max-w-[180px]" title={`storage/projects/${project.id}/renders/${project.id}_final.mp4`}>
                        {job?.diagnostics?.downloadDiagnostics?.renderedFilePath || `storage/projects/${project.id}/renders/${project.id}_final.mp4`}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">File Exists on Server:</span>
                      <span className="text-emerald-400 font-bold">
                        {job?.diagnostics?.downloadDiagnostics?.fileExists !== undefined 
                          ? (job.diagnostics.downloadDiagnostics.fileExists ? "YES (Verified)" : "NO (Missing)")
                          : "YES (Verified)"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">File Size:</span>
                      <span className="text-slate-200">{project.fileSize || job?.diagnostics?.downloadDiagnostics?.fileSize || "Calculating..."}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Content-Type:</span>
                      <span className="text-indigo-400 font-bold">video/mp4</span>
                    </div>
                    <div className="flex justify-between items-center gap-2">
                      <span className="text-slate-500">Download URL:</span>
                      <code className="text-indigo-300 select-all truncate max-w-[180px]" title={project.renderedVideoUrl}>
                        {project.renderedVideoUrl}
                      </code>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => {
                      setFullScreenMode("rendered");
                      setIsFullScreenPlaying(true);
                      setIsFullScreenOpen(true);
                    }}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-lg shadow-indigo-600/25 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4 fill-white" />
                    Watch Fullscreen Playback
                  </button>

                  <div className="flex gap-2">
                    <a
                      href={project.renderedVideoUrl}
                      download={`viral_short_${project.id}.mp4`}
                      className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-colors shadow-lg shadow-emerald-600/10 cursor-pointer flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download MP4
                    </a>
                    <button
                      onClick={handleTriggerRender}
                      className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      Re-render
                    </button>
                  </div>

                  <button
                    onClick={handleGenerateSEO}
                    disabled={isGeneratingSEO}
                    className="outline-btn w-full justify-center text-[11px] font-bold"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    {isGeneratingSEO ? "Generating SEO Ideas..." : "AI SEO & Tags Generator"}
                  </button>

                  <button
                    onClick={handleGenerateThumbnail}
                    disabled={isGeneratingThumbnail}
                    className="w-full py-2.5 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <Image className="w-3.5 h-3.5" />
                    {isGeneratingThumbnail ? "Generating Thumbnail..." : thumbnailUrl ? "✓ Thumbnail Ready" : "Generate YouTube Thumbnail"}
                  </button>

                  {thumbnailUrl && (
                    <div className="space-y-2 animate-fade-in">
                      <div className="rounded-xl overflow-hidden border border-slate-800">
                        <img src={thumbnailUrl} alt="YouTube Thumbnail" className="w-full aspect-video object-cover" />
                      </div>
                      <a
                        href={thumbnailUrl}
                        download={`thumbnail_${project.id}.jpg`}
                        className="w-full py-2 bg-slate-950 hover:bg-slate-800 text-indigo-400 border border-slate-800 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Thumbnail
                      </a>
                    </div>
                  )}

                  {/* YouTube Upload Button */}
                  <button
                    onClick={handleYoutubeUpload}
                    disabled={isYoutubeUploading}
                    className="outline-btn w-full justify-center text-[11px] font-bold"
                  >
                    {isYoutubeUploading ? (
                      <>Uploading to YouTube...</>
                    ) : youtubeResult ? (
                      <>✓ Uploaded: {youtubeResult.title?.slice(0, 30)}</>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.19a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 34 34 0 0 0 0 12a34 34 0 0 0 .5 5.81 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1 34 34 0 0 0 .5-5.8 34 34 0 0 0-.5-5.81zM9.5 15.57V8.43L15.8 12z"/></svg>
                        {youtubeAuth || youtubeHasCookies ? "Upload to YouTube" : "Connect YouTube"}
                      </>
                    )}
                  </button>
                  {youtubeResult && (
                    <a href={youtubeResult.url} target="_blank" rel="noopener noreferrer"
                      className="text-[10px] text-[#2FD0C4] font-mono text-center block hover:underline truncate">
                      {youtubeResult.url}
                    </a>
                  )}

                  {/* Schedule UI */}
                  {!youtubeResult && (project as any).status === ProjectStatus.COMPLETED && (
                    <div className="mt-2 border-t border-slate-800 pt-2">
                      {scheduledInfo ? (
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-400">
                            Scheduled: {new Date(scheduledInfo.scheduledAt).toLocaleString()}
                            <span className={`ml-2 ${scheduledInfo.status === "done" ? "text-green-400" : scheduledInfo.status === "failed" ? "text-red-400" : "text-yellow-400"}`}>
                              ({scheduledInfo.status})
                            </span>
                          </span>
                          <button onClick={handleCancelSchedule} className="text-[10px] text-red-400 hover:underline cursor-pointer">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-200 outline-none" />
                          <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)}
                            className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-200 outline-none" />
                          <button onClick={handleSchedule} disabled={isScheduling || !scheduleDate || !scheduleTime}
                            className="text-[10px] bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white px-2 py-1 rounded cursor-pointer whitespace-nowrap">
                            {isScheduling ? "..." : "Schedule"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {project.status === ProjectStatus.FAILED && (
              <div className="space-y-3">
                <div className="p-3.5 bg-rose-500/5 border border-rose-500/20 rounded-xl space-y-1.5 text-xs">
                  <p className="font-semibold text-rose-400">Compilation Pipeline Crashed</p>
                  <p className="text-slate-400 leading-relaxed">
                    {job?.errorMessage || "Verify your stock API quota and environment configuration settings."}
                  </p>
                </div>
                <button
                  onClick={handleTriggerRender}
                  className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry Compilation
                </button>
              </div>
            )}
          </div>

          {/* AI SEO Generation details output */}
          {seoResult && (
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-4 animate-fade-in text-left">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono border-b border-slate-800 pb-2 flex items-center justify-between">
                <span>AI SEO Accelerator</span>
                <button 
                  onClick={() => setSeoResult(null)}
                  className="text-slate-500 hover:text-slate-300 text-[10px] uppercase font-bold"
                >
                  Hide
                </button>
              </h4>

              {/* Title option */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">Viral Title option</span>
                  <button 
                    onClick={() => copyToClipboard(seoResult.viralTitle, "title")}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === "title" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy
                  </button>
                </div>
                <p className="text-xs font-semibold text-slate-200 bg-slate-950 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed">
                  {seoResult.viralTitle}
                </p>
              </div>

              {/* Description template */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono uppercase font-bold">SaaS SEO Description</span>
                  <button 
                    onClick={() => copyToClipboard(seoResult.description, "desc")}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === "desc" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    Copy
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800/60 leading-relaxed h-20 overflow-y-auto">
                  {seoResult.description}
                </p>
              </div>

              {/* Tag bubble items */}
              <div className="space-y-1.5">
                <span className="text-[10px] text-slate-500 font-mono uppercase font-bold block">Optimized Hashtags</span>
                <div className="flex flex-wrap gap-1.5">
                  {seoResult.hashtags.map((tag, i) => (
                    <span key={i} className="text-[10px] bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-md font-mono">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* System Compiler Logs Terminal panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-64">
            <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-slate-400 font-mono uppercase font-bold tracking-wider flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                FFmpeg Compiler Output Logs
              </span>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse block"></span>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto bg-slate-950 font-mono text-[10px] text-slate-300 leading-normal space-y-1 text-left select-text">
              {job?.logOutput && job.logOutput.length > 0 ? (
                job.logOutput.map((log, idx) => (
                  <p key={idx} className="whitespace-pre-wrap truncate">
                    {log}
                  </p>
                ))
              ) : (
                <p className="text-slate-600 italic">Compiler terminal idle. Press "Render Final Short" to launch.</p>
              )}
            </div>
          </div>

        </motion.div>
      </motion.div>

      {/* FULL-SCREEN VIDEO PREVIEW OVERLAY */}
      {isFullScreenOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-xl z-50 flex flex-col items-center justify-between p-4 sm:p-6 select-none"
        >
          {/* Top Bar Controls */}
          <div className="w-full max-w-5xl flex items-center justify-between border-b border-slate-800/80 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-pulse"></span>
              <div className="text-left">
                <h3 className="font-display font-bold text-sm sm:text-base text-white tracking-tight">
                  {project.title}
                </h3>
                <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                  PREVIEW SYSTEM • {fullScreenMode === "rendered" ? "COMPILED MP4" : `STORYBOARD SCENE ${activeSceneIndex + 1}/${scenes.length}`}
                </p>
              </div>
            </div>

            {/* Mode Toggle (if project is completed) */}
            {project.status === ProjectStatus.COMPLETED && (
              <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl">
                <button
                  onClick={() => {
                    setFullScreenMode("storyboard");
                    setIsFullScreenPlaying(true);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-mono font-bold tracking-wide transition-all cursor-pointer ${
                    fullScreenMode === "storyboard"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  STORYBOARD PREVIEW
                </button>
                <button
                  onClick={() => {
                    setFullScreenMode("rendered");
                    setIsFullScreenPlaying(true);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-[10px] sm:text-xs font-mono font-bold tracking-wide transition-all cursor-pointer ${
                    fullScreenMode === "rendered"
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  FINAL COMPRESSED SHORT
                </button>
              </div>
            )}

            <button
              onClick={() => setIsFullScreenOpen(false)}
              className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center"
              title="Close Fullscreen (Esc)"
            >
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Main Visual Stage (Adaptive layout: Video in center, Live subtitle edit on side) */}
          <div className="flex-1 w-full max-w-5xl flex flex-col md:flex-row items-center justify-center gap-6 sm:gap-10 my-4 overflow-hidden">
            
            {/* Left/Center Area: Large Vertical Video Canvas */}
            <div className="flex-1 flex items-center justify-center h-full max-h-[70vh] sm:max-h-[75vh]">
              <div className="relative aspect-[9/16] h-full bg-slate-950 rounded-2xl border-2 border-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between group">
                
                {/* Visual Video Stream */}
                <div className="absolute inset-0 z-0">
                  <video
                    ref={fullScreenVideoRef}
                    src={fullScreenMode === "rendered" ? project.renderedVideoUrl : activeScene?.selectedVideoUrl}
                    loop
                    muted={isFullScreenMuted}
                    className="w-full h-full object-cover"
                    playsInline
                    onTimeUpdate={(e) => {
                      if (fullScreenMode === "rendered") {
                        setFullCurrentTime(e.currentTarget.currentTime);
                      }
                    }}
                    onLoadedMetadata={(e) => {
                      if (fullScreenMode === "rendered") {
                        setFullDuration(e.currentTarget.duration || project.duration);
                      }
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40 pointer-events-none"></div>
                </div>

                {/* Live Styled Subtitles (Always overlayed) */}
                {fullScreenMode === "storyboard" && renderSubtitles(true)}
                {fullScreenMode === "rendered" && subtitleEnabled && (
                  <div className={`absolute left-0 right-0 z-10 p-4 pointer-events-none transition-all duration-300 flex items-center justify-center ${
                    position === "center" ? "top-1/2 -translate-y-1/2" : position === "top" ? "top-24" : "bottom-24"
                  }`} style={{ opacity }}>
                    <div className="text-center px-4">
                      {(() => {
                        // Find which scene's duration corresponds to the current elapsed time of the rendered video
                        let elapsed = 0;
                        let matchedScene = scenes[0];
                        for (const s of scenes) {
                          if (fullCurrentTime >= elapsed && fullCurrentTime < elapsed + s.duration) {
                            matchedScene = s;
                            break;
                          }
                          elapsed += s.duration;
                        }
                        if (!matchedScene) return null;
                        
                        const words = matchedScene.text.split(" ");
                        const halfIndex = Math.floor(words.length / 2);
                        
                        if (selectedStyle === SubtitleStyleType.YOUTUBE) {
                          return (
                            <span className="font-display font-extrabold uppercase italic tracking-wide text-white drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] text-shadow-thick" style={{ fontSize: `${fontSize * 1.4}px`, textShadow: "4px 4px 0px #000", wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                              🔥 {matchedScene.text}
                            </span>
                          );
                        } else if (selectedStyle === SubtitleStyleType.MINIMAL) {
                          return (
                            <div className="bg-black/75 px-5 py-2.5 rounded-xl border border-slate-800/40 max-w-[85%] mx-auto backdrop-blur-sm">
                              <p className="font-sans font-medium text-slate-100 tracking-tight leading-relaxed" style={{ fontSize: `${(fontSize - 4) * 1.3}px`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                                {matchedScene.text}
                              </p>
                            </div>
                          );
                        } else if (selectedStyle === SubtitleStyleType.CINEMATIC) {
                          return (
                            <p className="font-medium text-slate-200 tracking-widest leading-loose italic" style={{ fontFamily: "Georgia, serif", fontSize: `${(fontSize - 2) * 1.3}px`, wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                              "{matchedScene.text}"
                            </p>
                          );
                        } else if (selectedStyle === SubtitleStyleType.GAMING) {
                          return (
                            <span className="font-display font-black uppercase text-yellow-300 tracking-tighter filter drop-shadow-[0_2px_8px_rgba(234,179,8,0.6)]" style={{ fontSize: `${(fontSize + 2) * 1.4}px`, WebkitTextStroke: "2px black", wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                              🎯 {matchedScene.text}
                            </span>
                          );
                        } else if (selectedStyle === SubtitleStyleType.ARABIC_PREMIUM) {
                          return (
                            <p className="font-sans font-bold text-white drop-shadow-lg leading-loose" dir="auto" style={{ fontSize: `${(fontSize + 4) * 1.3}px`, textShadow: "0 2px 4px rgba(0,0,0,0.9)", wordSpacing: `${wordSpacing}px`, letterSpacing: `${letterSpacing}px` }}>
                              {matchedScene.text}
                            </p>
                          );
                        } else {
                          return (
                            <p className="font-display font-black uppercase tracking-tight flex flex-wrap justify-center leading-normal" style={{ fontSize: `${fontSize * 1.4}px`, columnGap: `${wordSpacing * 1.5 + 4}px`, rowGap: "8px" }}>
                              {words.map((word, idx) => {
                                const isHighlighted = idx === halfIndex || idx === halfIndex - 1;
                                return (
                                  <span 
                                    key={idx} 
                                    style={{ letterSpacing: `${letterSpacing}px` }}
                                    className={`inline-block py-1 px-1.5 rounded transition-all duration-300 ${
                                      isHighlighted 
                                        ? "text-yellow-400 bg-black/95 scale-110 rotate-1 shadow-lg border border-yellow-400/25" 
                                        : "text-white drop-shadow-[0_2px_4px_rgba(0,0,0,1)]"
                                    }`}
                                  >
                                    {word}
                                  </span>
                                );
                              })}
                            </p>
                          );
                        }
                      })()}
                    </div>
                  </div>
                )}

                {/* Left / Right Scene arrows (only in Storyboard mode) */}
                {fullScreenMode === "storyboard" && (
                  <div className="absolute inset-x-3 top-1/2 -translate-y-1/2 flex items-center justify-between pointer-events-none z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setActiveSceneIndex(prev => Math.max(0, prev - 1));
                        setIsFullScreenPlaying(true);
                      }}
                      disabled={activeSceneIndex === 0}
                      className="w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 border border-slate-800 flex items-center justify-center text-white pointer-events-auto cursor-pointer disabled:opacity-30 disabled:pointer-events-none hover:scale-105 transition-transform"
                    >
                      &lsaquo;
                    </button>
                    <button
                      onClick={() => {
                        setActiveSceneIndex(prev => Math.min(scenes.length - 1, prev + 1));
                        setIsFullScreenPlaying(true);
                      }}
                      disabled={activeSceneIndex === scenes.length - 1}
                      className="w-10 h-10 rounded-full bg-black/70 hover:bg-black/90 border border-slate-800 flex items-center justify-center text-white pointer-events-auto cursor-pointer disabled:opacity-30 disabled:pointer-events-none hover:scale-105 transition-transform"
                    >
                      &rsaquo;
                    </button>
                  </div>
                )}

                {/* TikTok / Shorts UI Overlays for aesthetic immersion */}
                <div className="absolute right-4 bottom-28 z-10 flex flex-col items-center gap-5 text-white pointer-events-auto">
                  <div className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform">
                    <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-slate-800 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white fill-white" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold mt-1 text-slate-300">12.4K</span>
                  </div>
                  <div className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform">
                    <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-slate-800 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white fill-white" viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold mt-1 text-slate-300">894</span>
                  </div>
                  <div className="flex flex-col items-center cursor-pointer hover:scale-105 transition-transform">
                    <div className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-slate-800 flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.684 10.742l3.415-1.708m0 4.928l3.414-1.708m-1.707-1.707a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm6.828-4.928a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm-13.656 9.856a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/></svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold mt-1 text-slate-300">Share</span>
                  </div>
                </div>

                {/* Left Bottom Channel Tag Overlay */}
                <div className="absolute left-4 bottom-24 z-10 max-w-[70%] text-left text-white drop-shadow-md">
                  <p className="font-sans font-bold text-xs flex items-center gap-1.5">
                    <span className="bg-indigo-600 w-5 h-5 rounded-full flex items-center justify-center text-[9px] border border-indigo-500/30">C</span>
                    @creator_studio
                  </p>
                  <p className="text-[10px] text-slate-200 mt-1.5 line-clamp-2 leading-relaxed">
                    {fullScreenMode === "storyboard" ? activeScene?.text : "The ultimate viral compilation. Generated completely with high-fidelity stock and professional live subtitle automation."}
                  </p>
                  <p className="text-[9px] text-indigo-400 font-semibold font-mono mt-1 flex items-center gap-1">
                    <span>#viral</span> <span>#shorts</span> <span>#saas</span> <span>#ai</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Right Area: Interactive Subtitle Live Editor */}
            <div className="w-full md:w-80 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between max-h-[40vh] md:max-h-[70vh] overflow-y-auto">
              <div className="space-y-4">
                <div className="border-b border-slate-800 pb-2 flex items-center justify-between text-left">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-indigo-400" />
                    Fullscreen Studio Settings
                  </h4>
                </div>

                {/* Subtitle styles & sliders */}
                <div className="space-y-4 text-xs text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-mono uppercase font-bold">Subtitles Overlay</span>
                    <button
                      onClick={() => setSubtitleEnabled(!subtitleEnabled)}
                      className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                        subtitleEnabled 
                          ? "bg-indigo-600/25 border-indigo-500 text-indigo-400" 
                          : "bg-slate-950 border-slate-800 text-slate-500"
                      }`}
                    >
                      {subtitleEnabled ? "ENABLED" : "MUTED"}
                    </button>
                  </div>

                  {subtitleEnabled && (
                    <div className="space-y-3.5">
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 uppercase font-bold font-mono">Style Template</span>
                        <select
                          value={selectedStyle}
                          onChange={(e) => setSelectedStyle(e.target.value as SubtitleStyleType)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none cursor-pointer"
                        >
                          <option value={SubtitleStyleType.TIKTOK}>TikTok Highlights</option>
                          <option value={SubtitleStyleType.YOUTUBE}>YouTube Shorts Outline</option>
                          <option value={SubtitleStyleType.MINIMAL}>Modern Minimal</option>
                          <option value={SubtitleStyleType.CINEMATIC}>Cinematic Serif</option>
                          <option value={SubtitleStyleType.GAMING}>Gaming Yellow Neon</option>
                          <option value={SubtitleStyleType.ARABIC_PREMIUM}>Arabic Premium (RTL)</option>
                        </select>
                      </div>

                      {/* Font Scale slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                          <span>Font Scale</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setFontSize(Math.max(0, fontSize - 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={fontSize}
                              onChange={(e) => {
                                let val = Number(e.target.value);
                                if (isNaN(val)) val = 0;
                                setFontSize(Math.min(100, Math.max(0, val)));
                              }}
                              className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => setFontSize(Math.min(100, fontSize + 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                          value={fontSize}
                          onChange={(e) => setFontSize(Number(e.target.value))}
                          className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                        />
                      </div>

                      {/* Word Spacing slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                          <span>Word Spacing</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setWordSpacing(Math.max(0, wordSpacing - 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={wordSpacing}
                              onChange={(e) => {
                                let val = Number(e.target.value);
                                if (isNaN(val)) val = 0;
                                setWordSpacing(Math.min(50, Math.max(0, val)));
                              }}
                              className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => setWordSpacing(Math.min(50, wordSpacing + 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                          value={wordSpacing}
                          onChange={(e) => setWordSpacing(Number(e.target.value))}
                          className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                        />
                      </div>

                      {/* Letter Spacing slider */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono uppercase font-bold">
                          <span>Letter Spacing</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setLetterSpacing(Math.max(0, letterSpacing - 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={letterSpacing}
                              onChange={(e) => {
                                let val = Number(e.target.value);
                                if (isNaN(val)) val = 0;
                                setLetterSpacing(Math.min(50, Math.max(0, val)));
                              }}
                              className="w-10 text-center bg-slate-950 border border-slate-800 rounded text-[9px] text-slate-300 outline-none focus:border-indigo-500 font-bold"
                            />
                            <button
                              type="button"
                              onClick={() => setLetterSpacing(Math.min(50, letterSpacing + 1))}
                              className="px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
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
                          value={letterSpacing}
                          onChange={(e) => setLetterSpacing(Number(e.target.value))}
                          className="w-full accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase font-bold">
                          <span>Canvas Positioning</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {["top", "center", "bottom"].map(pos => (
                            <button
                              key={pos}
                              onClick={() => setPosition(pos as any)}
                              className={`py-1 text-[9px] font-mono font-bold capitalize rounded border transition-colors cursor-pointer ${
                                position === pos 
                                  ? "bg-indigo-600/10 border-indigo-500 text-indigo-400" 
                                  : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300"
                              }`}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Transition Effects Settings */}
                  <div className="space-y-3 border-t border-slate-800/60 pt-3 mt-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase font-bold">
                      <span className="flex items-center gap-1.5">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Clip Transitions
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono">{transitionType === "none" ? "Off" : `${transitionDuration}s`}</span>
                    </div>

                    {/* Transition type grid */}
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { key: "none", label: "Off" },
                        { key: "fade", label: "Fade" },
                        { key: "dissolve", label: "Dissolve" },
                        { key: "slideleft", label: "S-L" },
                        { key: "slideright", label: "S-R" },
                        { key: "slideup", label: "S-U" },
                        { key: "slidedown", label: "S-D" },
                        { key: "zoomin", label: "Zoom" },
                        { key: "radial", label: "Radial" },
                        { key: "pixelize", label: "Pixel" },
                        { key: "circleopen", label: "Cir-O" },
                        { key: "circleclose", label: "Cir-C" },
                        { key: "wipelr", label: "W-LR" },
                        { key: "wiperl", label: "W-RL" },
                        { key: "wipetb", label: "W-TB" },
                        { key: "wipebt", label: "W-BT" },
                        { key: "random", label: "🎲 Random" },
                      ].map(t => (
                        <button
                          key={t.key}
                          onClick={() => {
                            const val = t.key as TransitionType;
                            setTransitionType(val);
                            if (project) {
                              project.settings.transitionType = val;
                              project.settings.transitionDuration = transitionDuration;
                              fetch("/api/settings", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(project.settings)
                              });
                            }
                          }}
                          className={`py-1.5 text-[8px] font-mono font-bold rounded border transition-colors cursor-pointer ${
                            transitionType === t.key
                              ? "bg-indigo-600/10 border-indigo-500 text-indigo-400"
                              : "bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-600"
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* Transition duration slider */}
                    {transitionType !== "none" && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] text-slate-500 font-mono uppercase">
                          <span>Duration</span>
                          <span className="text-indigo-400">{transitionDuration.toFixed(1)}s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[8px] text-slate-600">0.1</span>
                          <input type="range" min={0.1} max={1.0} step={0.1}
                            value={transitionDuration}
                            onChange={e => {
                              const val = parseFloat(e.target.value);
                              setTransitionDuration(val);
                              if (project) {
                                project.settings.transitionDuration = val;
                                project.settings.transitionType = transitionType;
                                fetch("/api/settings", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(project.settings)
                                });
                              }
                            }}
                            className="flex-1 accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                          />
                          <span className="text-[8px] text-slate-600">1.0</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {fullScreenMode === "storyboard" && (
                    <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/60 space-y-1 text-left">
                      <span className="text-[9px] text-slate-500 uppercase font-bold font-mono">Active Scene Text</span>
                      <p className="text-[11px] text-slate-300 italic">"{activeScene?.text}"</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Channel Branding / Watermark details */}
              <div className="border-t border-slate-800/80 pt-4 mt-4 text-left text-[10px] text-slate-500 font-mono space-y-1 bg-slate-900">
                <div className="flex justify-between">
                  <span>Aspect ratio:</span>
                  <span className="text-slate-300">9:16 (Vertical)</span>
                </div>
                <div className="flex justify-between">
                  <span>Resolution:</span>
                  <span className="text-slate-300">1080 x 1920</span>
                </div>
                <div className="flex justify-between">
                  <span>Frame rate:</span>
                  <span className="text-slate-300">30.00 fps</span>
                </div>
              </div>
            </div>

          </div>

          {/* Bottom Playback bar for full-screen controls */}
          <div className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl p-4 shrink-0 flex items-center justify-between gap-4">
            <button
              onClick={() => setIsFullScreenPlaying(!isFullScreenPlaying)}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center text-white cursor-pointer transition-colors shadow-lg shadow-indigo-600/20 shrink-0"
              title={isFullScreenPlaying ? "Pause Playback" : "Start Playback"}
            >
              {isFullScreenPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
            </button>

            {/* Rendered Mode timeline slider */}
            {fullScreenMode === "rendered" ? (
              <div className="flex-1 flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400">
                  {Math.floor(fullCurrentTime / 60)}:{(Math.floor(fullCurrentTime % 60)).toString().padStart(2, "0")}
                </span>
                <input
                  type="range"
                  min={0}
                  max={fullDuration || 30}
                  step={0.1}
                  value={fullCurrentTime}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setFullCurrentTime(t);
                    if (fullScreenVideoRef.current) {
                      fullScreenVideoRef.current.currentTime = t;
                    }
                  }}
                  className="flex-1 accent-indigo-600 bg-slate-950 h-1 rounded-full cursor-pointer"
                />
                <span className="text-[10px] font-mono text-slate-400">
                  {Math.floor(fullDuration / 60)}:{(Math.floor(fullDuration % 60)).toString().padStart(2, "0")}
                </span>
              </div>
            ) : (
              // Storyboard Mode Scene Trackers
              <div className="flex-1 flex flex-wrap gap-1.5 justify-center">
                {scenes.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setActiveSceneIndex(idx);
                      setIsFullScreenPlaying(true);
                    }}
                    className={`px-3 py-1 text-[10px] font-mono font-bold rounded-lg border transition-all cursor-pointer ${
                      activeSceneIndex === idx
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Scene {idx + 1}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setIsFullScreenMuted(!isFullScreenMuted)}
              className="p-2.5 bg-slate-950 border border-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl cursor-pointer transition-colors"
              title={isFullScreenMuted ? "Unmute Volume" : "Mute Volume"}
            >
              {isFullScreenMuted ? <VolumeX className="w-5 h-5 text-slate-500" /> : <Volume2 className="w-5 h-5 text-indigo-400 animate-pulse" />}
            </button>
          </div>
        </motion.div>
      )}

      {/* BGM Library Modal - Built-in Categories */}
      {showBgmLibrary && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h4 className="font-display font-bold text-sm text-white">🎵 BGM Library</h4>
              <button onClick={() => setShowBgmLibrary(false)} className="text-slate-400 hover:text-slate-200 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {bgmLoading ? (
                <p className="text-center text-[10px] text-slate-500 py-8">Loading BGM library...</p>
              ) : Object.keys(bgmCategories).length === 0 ? (
                <p className="text-center text-[10px] text-slate-500 py-8">No built-in BGM tracks found. Add MP3 files to the builtin library.</p>
              ) : (
                Object.entries(bgmCategories).map(([cat, tracks]) => (
                  <div key={cat}>
                    <p className="text-[9px] text-slate-500 font-mono font-bold uppercase mb-2 tracking-wider">{cat}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(tracks as any[]).map((track: any, i: number) => (
                        <div key={i} className="bg-slate-950 border border-slate-800/60 rounded-lg p-2">
                          <p className="text-[9px] text-slate-200 font-mono truncate">{track.label}</p>
                          <p className="text-[7px] text-slate-500 font-mono mb-1.5">{(track.duration || 0).toFixed(1)}s</p>
                          <div className="flex gap-1">
                            <button onClick={() => handleBgmPreview(previewAudioUrl === track.url ? null : track.url)}
                              className={`flex-1 px-2 py-1 text-[8px] rounded-lg cursor-pointer font-semibold transition-colors ${
                                previewAudioUrl === track.url ? "bg-emerald-700 text-emerald-200" : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                              }`}>
                              {previewAudioUrl === track.url ? "⏹ Stop" : "▶ Play"}
                            </button>
                            <button onClick={() => handleApplyBuiltinBgm(track)}
                              className="flex-1 px-2 py-1 text-[8px] bg-violet-600 hover:bg-violet-500 text-white rounded-lg cursor-pointer font-semibold">
                              Select
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SFX Browser Modal - Built-in Categories */}
      {showSfxBrowser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h4 className="font-display font-bold text-sm text-white">🔊 Sound Effects</h4>
              <button onClick={() => setShowSfxBrowser(false)} className="text-slate-400 hover:text-slate-200 text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer">Close</button>
            </div>
            {/* Category tabs */}
            <div className="p-3 bg-slate-950 border-b border-slate-800/60 overflow-x-auto">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(sfxCategories).map(cat => (
                  <button key={cat} onClick={() => setSfxSelectedCategory(cat)}
                    className={`px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold cursor-pointer transition-colors ${
                      sfxSelectedCategory === cat ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
                    }`}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {/* Tracks */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {sfxLoading ? (
                <p className="text-center text-[10px] text-slate-500 py-8">Loading SFX library...</p>
              ) : sfxSelectedCategory && sfxCategories[sfxSelectedCategory] ? (
                <div className="grid grid-cols-2 gap-1.5">
                  {(sfxCategories[sfxSelectedCategory] as any[]).map((track: any, i: number) => (
                    <div key={i} className="bg-slate-950 border border-slate-800/60 rounded-lg p-2">
                      <p className="text-[9px] text-slate-200 font-mono truncate">{track.label}</p>
                      <p className="text-[7px] text-slate-500 font-mono mb-1.5">{(track.duration || 0).toFixed(1)}s</p>
                      <div className="flex gap-1">
                        <button onClick={() => handleSfxPreview(previewSfxUrl === track.url ? null : track.url)}
                          className={`flex-1 px-2 py-1 text-[8px] rounded-lg cursor-pointer font-semibold transition-colors ${
                            previewSfxUrl === track.url ? "bg-emerald-700 text-emerald-200" : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                          }`}>
                          {previewSfxUrl === track.url ? "⏹" : "▶"}
                        </button>
                        <button onClick={() => handleApplyBuiltinSfx(track)}
                          className="flex-1 px-2 py-1 text-[8px] bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg cursor-pointer font-semibold">
                          + Add
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-[10px] text-slate-500 py-8">Select a category above to browse sound effects.</p>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
