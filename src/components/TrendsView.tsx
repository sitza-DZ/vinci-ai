import { useState, useEffect } from "react";
import {
  TrendingUp,
  Users,
  Hash,
  Clock,
  Play,
  Heart,
  MessageCircle,
  Sparkles,
  Loader2,
  Copy,
  Check,
  PlusCircle,
  RefreshCw,
  ExternalLink,
  Lightbulb,
  Target,
  Globe,
  FileSearch,
  Compass,
  Bell,
  BellRing,
  Trash2,
  Eye,
} from "lucide-react";

interface TrendsViewProps {
  onNavigate: (view: string) => void;
  onCreateFromTopic: (topic: string) => void;
}

interface TrendVideo {
  id: string;
  title: string;
  cover: string;
  author: string;
  views: number;
  likes: number;
  comments: number;
  timeAgo: string;
  hashtags: string[];
  videoUrl: string;
  platform?: "tiktok" | "youtube";
  duration?: number;
}

interface CompetitorResult {
  profile: { name: string; username: string; bio: string };
  videos: TrendVideo[];
  analysis: {
    summary: string;
    contentPatterns: string[];
    videoIdeas: { title: string; hook: string; why: string }[];
    recommendedHashtags: string[];
  };
}

interface HashtagResult {
  topic: string;
  viral: string[];
  niche: string[];
  broad: string[];
  all: string[];
}

interface PostingTimeResult {
  niche: string;
  platform: string;
  region: string;
  bestTimes: { day: string; time: string; score: number; reason: string }[];
  summary: string;
  tips: string[];
}

const fmtCount = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
};

type TabId = "trending" | "competitor" | "hashtags" | "posting" | "reverse" | "niches" | "alerts";

export default function TrendsView({ onNavigate, onCreateFromTopic }: TrendsViewProps) {
  const [tab, setTab] = useState<TabId>("trending");

  // ===== Trending =====
  const [trending, setTrending] = useState<TrendVideo[] | null>(null);
  const [topHashtags, setTopHashtags] = useState<{ tag: string; count: number }[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState("");
  const [categories, setCategories] = useState<{ id: string; label: string; emoji: string; hashtag: string }[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [platform, setPlatform] = useState<"tiktok" | "youtube">("tiktok");

  // Load category list once
  useEffect(() => {
    let cancelled = false;
    fetch("/api/trends/categories")
      .then(r => r.json())
      .then(data => {
        if (!cancelled && data.success && Array.isArray(data.categories)) {
          setCategories(data.categories);
        }
      })
      .catch(() => { /* keep empty — UI falls back to All only */ });
    return () => { cancelled = true; };
  }, []);

  // ===== Competitor =====
  const [compUser, setCompUser] = useState("");
  const [compResult, setCompResult] = useState<CompetitorResult | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState("");

  // ===== Hashtags =====
  const [hashTopic, setHashTopic] = useState("");
  const [hashPlatform, setHashPlatform] = useState("TikTok");
  const [hashResult, setHashResult] = useState<HashtagResult | null>(null);
  const [hashLoading, setHashLoading] = useState(false);
  const [hashError, setHashError] = useState("");
  const [copied, setCopied] = useState(false);

  // ===== Posting Time =====
  const [ptNiche, setPtNiche] = useState("");
  const [ptPlatform, setPtPlatform] = useState("TikTok");
  const [ptRegion, setPtRegion] = useState("Global");
  const [ptResult, setPtResult] = useState<PostingTimeResult | null>(null);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState("");

  // ===== v15: Reverse-Engineer =====
  const [revUrl, setRevUrl] = useState("");
  const [revStyle, setRevStyle] = useState<"viral" | "storytelling" | "educational" | "dramatic">("viral");
  const [revResult, setRevResult] = useState<any | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [revError, setRevError] = useState("");

  // ===== v15: Niche Finder =====
  const [nicheInterest, setNicheInterest] = useState("");
  const [nicheResult, setNicheResult] = useState<any | null>(null);
  const [nicheLoading, setNicheLoading] = useState(false);
  const [nicheError, setNicheError] = useState("");

  // ===== v15: Trend Alerts =====
  const [alertRules, setAlertRules] = useState<any[]>([]);
  const [alertNotifs, setAlertNotifs] = useState<any[]>([]);
  const [alertUnread, setAlertUnread] = useState(0);
  const [newRuleKeyword, setNewRuleKeyword] = useState("");
  const [newRulePlatform, setNewRulePlatform] = useState<"tiktok" | "youtube">("tiktok");
  const [newRuleMinViews, setNewRuleMinViews] = useState("");
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertCheckMsg, setAlertCheckMsg] = useState("");

  const loadAlerts = async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/trends/alerts/rules").then(r => r.json()),
        fetch("/api/trends/alerts/notifications").then(r => r.json()),
      ]);
      if (r1.success) setAlertRules(r1.rules || []);
      if (r2.success) { setAlertNotifs(r2.notifications || []); setAlertUnread(r2.unread || 0); }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (tab === "alerts") loadAlerts();
  }, [tab]);

  const loadTrending = async (categoryId?: string, platformOverride?: "tiktok" | "youtube") => {
    const cat = categoryId ?? activeCategory;
    const plat = platformOverride ?? platform;
    if (categoryId) setActiveCategory(categoryId);
    if (platformOverride) setPlatform(platformOverride);
    setTrendLoading(true);
    setTrendError("");
    try {
      const res = await fetch(`/api/trends/trending?category=${encodeURIComponent(cat)}&platform=${plat}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to load trending");
      setTrending(data.videos || []);
      setTopHashtags(data.topHashtags || []);
    } catch (e: any) {
      setTrendError(e.message || "Failed to load trending feed");
    } finally {
      setTrendLoading(false);
    }
  };

  const runCompetitor = async () => {
    if (!compUser.trim()) return;
    setCompLoading(true);
    setCompError("");
    setCompResult(null);
    try {
      const res = await fetch("/api/trends/competitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: compUser.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Analysis failed");
      setCompResult(data);
    } catch (e: any) {
      setCompError(e.message || "Competitor analysis failed");
    } finally {
      setCompLoading(false);
    }
  };

  const runHashtags = async () => {
    if (!hashTopic.trim()) return;
    setHashLoading(true);
    setHashError("");
    setHashResult(null);
    try {
      const res = await fetch("/api/trends/hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: hashTopic.trim(), platform: hashPlatform }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Hashtag generation failed");
      setHashResult(data);
    } catch (e: any) {
      setHashError(e.message || "Hashtag generation failed");
    } finally {
      setHashLoading(false);
    }
  };

  const runPostingTime = async () => {
    if (!ptNiche.trim()) return;
    setPtLoading(true);
    setPtError("");
    setPtResult(null);
    try {
      const res = await fetch("/api/trends/posting-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: ptNiche.trim(), platform: ptPlatform, region: ptRegion.trim() || "Global" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Prediction failed");
      setPtResult(data);
    } catch (e: any) {
      setPtError(e.message || "Posting time prediction failed");
    } finally {
      setPtLoading(false);
    }
  };

  const copyAll = async (tags: string[]) => {
    try {
      await navigator.clipboard.writeText(tags.join(" "));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  // ===== v15 handlers =====
  const runReverseEngineer = async () => {
    if (!revUrl.trim()) return;
    setRevLoading(true);
    setRevError("");
    setRevResult(null);
    try {
      const res = await fetch("/api/trends/reverse-engineer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: revUrl.trim(), style: revStyle }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Reverse-engineering failed");
      setRevResult(data);
    } catch (e: any) {
      setRevError(e.message || "Reverse-engineering failed");
    } finally {
      setRevLoading(false);
    }
  };

  const runNicheFinder = async () => {
    if (!nicheInterest.trim()) return;
    setNicheLoading(true);
    setNicheError("");
    setNicheResult(null);
    try {
      const res = await fetch("/api/trends/niche-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interest: nicheInterest.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Niche analysis failed");
      setNicheResult(data);
    } catch (e: any) {
      setNicheError(e.message || "Niche analysis failed");
    } finally {
      setNicheLoading(false);
    }
  };

  const addAlertRule = async () => {
    if (!newRuleKeyword.trim()) return;
    try {
      const res = await fetch("/api/trends/alerts/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: newRuleKeyword.trim(),
          platform: newRulePlatform,
          minViews: newRuleMinViews ? parseInt(newRuleMinViews) : 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setNewRuleKeyword("");
        setNewRuleMinViews("");
        loadAlerts();
      }
    } catch { /* ignore */ }
  };

  const toggleAlertRule = async (rule: any) => {
    try {
      await fetch(`/api/trends/alerts/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      loadAlerts();
    } catch { /* ignore */ }
  };

  const deleteAlertRule = async (id: string) => {
    try {
      await fetch(`/api/trends/alerts/rules/${id}`, { method: "DELETE" });
      loadAlerts();
    } catch { /* ignore */ }
  };

  const checkAlertsNow = async () => {
    setAlertsLoading(true);
    setAlertCheckMsg("");
    try {
      const res = await fetch("/api/trends/alerts/check", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setAlertCheckMsg(`Checked ${data.checked} rule(s), ${data.newAlerts} new alert(s) found`);
        loadAlerts();
      } else {
        setAlertCheckMsg(data.message || "Check failed");
      }
    } catch (e: any) {
      setAlertCheckMsg(e.message || "Check failed");
    } finally {
      setAlertsLoading(false);
    }
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/trends/alerts/notifications/read-all", { method: "POST" });
      loadAlerts();
    } catch { /* ignore */ }
  };

  const clearNotifs = async () => {
    try {
      await fetch("/api/trends/alerts/notifications", { method: "DELETE" });
      loadAlerts();
    } catch { /* ignore */ }
  };

  const tabs: { id: TabId; name: string; icon: any }[] = [
    { id: "trending", name: "Trending Feed", icon: TrendingUp },
    { id: "competitor", name: "Competitor Analysis", icon: Users },
    { id: "hashtags", name: "Hashtag Generator", icon: Hash },
    { id: "posting", name: "Best Posting Time", icon: Clock },
    { id: "reverse", name: "Script Reverse-Engineer", icon: FileSearch },
    { id: "niches", name: "Niche Finder", icon: Compass },
    { id: "alerts", name: "Trend Alerts", icon: Bell },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-brand" />
          Trend Intelligence
        </h1>
        <p className="text-sm text-muted mt-1">
          Viral topics, competitor insights, hashtags aur best posting times — sab ek jagah.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
            >
              <Icon className="w-4 h-4" />
              {t.name}
            </button>
          );
        })}
      </div>

      {/* ===== TRENDING FEED ===== */}
      {tab === "trending" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">
              {platform === "youtube" ? "Aaj ke Viral YouTube Videos" : "Aaj ke Viral TikTok Videos"}
            </h2>
            <button onClick={() => loadTrending()} disabled={trendLoading} className="btn btn-primary btn-sm">
              {trendLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {trending ? "Refresh" : "Load Trends"}
            </button>
          </div>

          {/* Platform toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => loadTrending(undefined, "tiktok")}
              disabled={trendLoading}
              className={`btn btn-sm ${platform === "tiktok" ? "btn-primary" : "btn-secondary"}`}
            >
              🎵 TikTok
            </button>
            <button
              onClick={() => loadTrending(undefined, "youtube")}
              disabled={trendLoading}
              className={`btn btn-sm ${platform === "youtube" ? "btn-primary" : "btn-secondary"}`}
            >
              ▶️ YouTube
            </button>
          </div>

          {/* Category chips */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => loadTrending(c.id)}
                  disabled={trendLoading}
                  className={`btn btn-sm ${activeCategory === c.id ? "btn-primary" : "btn-secondary"}`}
                >
                  <span>{c.emoji}</span>
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {trendError && (
            <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{trendError}</div>
          )}

          {trendLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>Trending videos load ho rahi hain...</p>
            </div>
          )}

          {!trendLoading && trending && trending.length === 0 && (
            <div className="card p-8 text-center text-muted">Koi trending video nahi mili. Refresh karke dobara try karein.</div>
          )}

          {topHashtags.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                <Hash className="w-4 h-4 text-brand" /> Trending Hashtags
              </h3>
              <div className="flex flex-wrap gap-2">
                {topHashtags.map(h => (
                  <button
                    key={h.tag}
                    onClick={() => { setTab("hashtags"); setHashTopic(h.tag); }}
                    className="badge hover:opacity-80 transition-opacity"
                    title="Is hashtag se hashtags generate karein"
                  >
                    #{h.tag} <span className="opacity-60">({h.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {trending && trending.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {trending.map(v => {
                const isYt = v.platform === "youtube";
                const durLabel = v.duration ? `${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, "0")}` : "";
                return (
                <div key={v.id} className="card overflow-hidden group">
                  <div className={`relative ${isYt ? "aspect-video" : "aspect-[9/12]"} bg-slate-900`}>
                    {v.cover ? (
                      <img src={v.cover} alt={v.title} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <Play className="w-10 h-10" />
                      </div>
                    )}
                    {/* Platform badge */}
                    <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${isYt ? "bg-red-600 text-white" : "bg-black/70 text-white"}`}>
                      {isYt ? "▶ YouTube" : "🎵 TikTok"}
                    </span>
                    {durLabel && (
                      <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/70 text-white">{durLabel}</span>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                      <p className="text-white text-xs font-medium line-clamp-2">{v.title}</p>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="truncate">{isYt ? v.author : "@" + v.author}</span>
                      <span>{v.timeAgo}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted">
                      <span className="flex items-center gap-1"><Play className="w-3.5 h-3.5" />{fmtCount(v.views)}</span>
                      {!isYt && (
                        <>
                          <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{fmtCount(v.likes)}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{fmtCount(v.comments)}</span>
                        </>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => onCreateFromTopic(v.title.replace(/#[\w\u0600-\u06FF]+/g, "").trim() || v.title)}
                        className="btn btn-primary btn-sm flex-1"
                        title="Is topic se nayi video banayein"
                      >
                        <PlusCircle className="w-4 h-4" /> Create Video
                      </button>
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-secondary btn-sm"
                        title={isYt ? "YouTube pe dekhein" : "TikTok pe dekhein"}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== COMPETITOR ANALYSIS ===== */}
      {tab === "competitor" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
              <Users className="w-5 h-5 text-brand" /> Kisi bhi TikTok Creator ko Analyze karein
            </h2>
            <div className="flex gap-2">
              <input
                value={compUser}
                onChange={e => setCompUser(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runCompetitor()}
                placeholder="TikTok username (e.g. khaby.lame)"
                className="input flex-1"
              />
              <button onClick={runCompetitor} disabled={compLoading || !compUser.trim()} className="btn btn-primary">
                {compLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                Analyze
              </button>
            </div>
            <p className="text-xs text-muted">Creator ke top videos, content patterns aur viral ideas milenge.</p>
          </div>

          {compError && <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{compError}</div>}

          {compLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>Creator analyze ho raha hai... (videos fetch + AI analysis)</p>
            </div>
          )}

          {compResult && (
            <div className="space-y-4">
              {/* Profile */}
              <div className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-brand to-accent flex items-center justify-center text-white font-bold text-lg">
                    {compResult.profile.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-bold text-ink">{compResult.profile.name}</h3>
                    <p className="text-sm text-muted">@{compResult.profile.username}</p>
                    {compResult.profile.bio && <p className="text-sm text-muted mt-1">{compResult.profile.bio}</p>}
                  </div>
                </div>
              </div>

              {/* AI Summary */}
              {compResult.analysis.summary && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand" /> AI Summary
                  </h3>
                  <p className="text-sm text-muted">{compResult.analysis.summary}</p>
                </div>
              )}

              {/* Content Patterns */}
              {compResult.analysis.contentPatterns.length > 0 && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-brand" /> Content Patterns
                  </h3>
                  <ul className="space-y-1.5">
                    {compResult.analysis.contentPatterns.map((p, i) => (
                      <li key={i} className="text-sm text-muted flex gap-2">
                        <span className="text-brand">•</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Video Ideas */}
              {compResult.analysis.videoIdeas.length > 0 && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand" /> Viral Video Ideas
                  </h3>
                  <div className="space-y-3">
                    {compResult.analysis.videoIdeas.map((idea, i) => (
                      <div key={i} className="border border-border rounded-lg p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-ink">{idea.title}</p>
                          <button
                            onClick={() => onCreateFromTopic(idea.title)}
                            className="btn btn-primary btn-sm shrink-0"
                            title="Is idea se video banayein"
                          >
                            <PlusCircle className="w-4 h-4" /> Create
                          </button>
                        </div>
                        <p className="text-xs text-brand font-medium">Hook: {idea.hook}</p>
                        <p className="text-xs text-muted">{idea.why}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Hashtags */}
              {compResult.analysis.recommendedHashtags.length > 0 && (
                <div className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                      <Hash className="w-4 h-4 text-brand" /> Recommended Hashtags
                    </h3>
                    <button onClick={() => copyAll(compResult.analysis.recommendedHashtags)} className="btn btn-secondary btn-sm">
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} Copy All
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {compResult.analysis.recommendedHashtags.map((h, i) => (
                      <span key={i} className="badge">{h.startsWith("#") ? h : "#" + h}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Videos */}
              <div className="card p-4">
                <h3 className="text-sm font-semibold text-ink mb-3">Top Videos (by views)</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[...compResult.videos].sort((a, b) => b.views - a.views).slice(0, 8).map(v => (
                    <div key={v.id} className="relative aspect-[9/12] rounded-lg overflow-hidden bg-slate-900 group">
                      {v.cover && <img src={v.cover} alt={v.title} className="w-full h-full object-cover" loading="lazy" />}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <p className="text-white text-[10px] line-clamp-2">{v.title}</p>
                        <p className="text-white/70 text-[10px] mt-0.5">{fmtCount(v.views)} views</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== HASHTAG GENERATOR ===== */}
      {tab === "hashtags" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
              <Hash className="w-5 h-5 text-brand" /> Topic se Best Hashtags Generate karein
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={hashTopic}
                onChange={e => setHashTopic(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runHashtags()}
                placeholder="Topic likhein (e.g. funny cats, space facts, cooking)"
                className="input flex-1"
              />
              <select value={hashPlatform} onChange={e => setHashPlatform(e.target.value)} className="input sm:w-40">
                <option>TikTok</option>
                <option>YouTube Shorts</option>
                <option>Instagram Reels</option>
              </select>
              <button onClick={runHashtags} disabled={hashLoading || !hashTopic.trim()} className="btn btn-primary">
                {hashLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate
              </button>
            </div>
          </div>

          {hashError && <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{hashError}</div>}

          {hashLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>AI hashtags generate kar raha hai...</p>
            </div>
          )}

          {hashResult && (
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-ink">Sab Hashtags ({hashResult.all.length})</h3>
                  <button onClick={() => copyAll(hashResult.all)} className="btn btn-primary btn-sm">
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} Copy All
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hashResult.all.map((h, i) => (
                    <span key={i} className="badge">{h}</span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {([
                  { label: "Viral / High Reach", tags: hashResult.viral, color: "text-brand" },
                  { label: "Niche / Targeted", tags: hashResult.niche, color: "text-accent" },
                  { label: "Broad / Discovery", tags: hashResult.broad, color: "text-muted" },
                ] as const).map(group => (
                  <div key={group.label} className="card p-4">
                    <h4 className={`text-xs font-semibold mb-2 ${group.color}`}>{group.label}</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {group.tags.map((h, i) => (
                        <span key={i} className="badge">{h}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== BEST POSTING TIME ===== */}
      {tab === "posting" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand" /> Best Posting Time Predictor
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={ptNiche}
                onChange={e => setPtNiche(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runPostingTime()}
                placeholder="Niche likhein (e.g. comedy, tech, food)"
                className="input flex-1"
              />
              <select value={ptPlatform} onChange={e => setPtPlatform(e.target.value)} className="input sm:w-40">
                <option>TikTok</option>
                <option>YouTube Shorts</option>
                <option>Instagram Reels</option>
              </select>
              <div className="relative sm:w-44">
                <Globe className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={ptRegion}
                  onChange={e => setPtRegion(e.target.value)}
                  placeholder="Region (e.g. Pakistan)"
                  className="input pl-9"
                />
              </div>
              <button onClick={runPostingTime} disabled={ptLoading || !ptNiche.trim()} className="btn btn-primary">
                {ptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                Predict
              </button>
            </div>
          </div>

          {ptError && <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{ptError}</div>}

          {ptLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>AI best posting times predict kar raha hai...</p>
            </div>
          )}

          {ptResult && (
            <div className="space-y-4">
              <div className="card p-4">
                <p className="text-sm text-muted">{ptResult.summary}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...ptResult.bestTimes].sort((a, b) => b.score - a.score).map((slot, i) => (
                  <div key={i} className="card p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink">{slot.day}</span>
                      <span className={`badge ${slot.score >= 80 ? "bg-green-500/15 text-green-500" : slot.score >= 60 ? "bg-yellow-500/15 text-yellow-500" : "bg-slate-500/15 text-muted"}`}>
                        {slot.score}/100
                      </span>
                    </div>
                    <p className="text-lg font-bold text-brand">{slot.time}</p>
                    <p className="text-xs text-muted">{slot.reason}</p>
                  </div>
                ))}
              </div>

              {ptResult.tips.length > 0 && (
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                    <Lightbulb className="w-4 h-4 text-brand" /> Posting Tips
                  </h3>
                  <ul className="space-y-1.5">
                    {ptResult.tips.map((t, i) => (
                      <li key={i} className="text-sm text-muted flex gap-2">
                        <span className="text-brand">•</span> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== v15: SCRIPT REVERSE-ENGINEER ===== */}
      {tab === "reverse" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
              <FileSearch className="w-5 h-5 text-brand" /> Competitor Script Reverse-Engineering
            </h2>
            <p className="text-xs text-muted">Viral video ka URL do — AI uski script structure nikalega aur aapke style me rewrite karega.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={revUrl}
                onChange={e => setRevUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runReverseEngineer()}
                placeholder="YouTube/TikTok video URL paste karein..."
                className="input flex-1"
              />
              <select value={revStyle} onChange={e => setRevStyle(e.target.value as any)} className="input sm:w-44">
                <option value="viral">🔥 Viral Style</option>
                <option value="storytelling">📖 Storytelling</option>
                <option value="educational">🎓 Educational</option>
                <option value="dramatic">🎭 Dramatic</option>
              </select>
              <button onClick={runReverseEngineer} disabled={revLoading || !revUrl.trim()} className="btn btn-primary">
                {revLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSearch className="w-4 h-4" />}
                Analyze
              </button>
            </div>
          </div>

          {revError && <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{revError}</div>}

          {revLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>Transcript fetch + AI analysis ho raha hai... (30-60s lag sakte hain)</p>
            </div>
          )}

          {revResult && (
            <div className="space-y-4">
              <div className="card p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-semibold text-ink">{revResult.videoTitle}</h3>
                    <p className="text-xs text-muted">{revResult.channel} • {revResult.duration}s</p>
                  </div>
                  <span className="badge bg-brand/15 text-brand">Analyzed ✓</span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="card p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <Target className="w-4 h-4 text-brand" /> Why It Works
                  </h3>
                  <p className="text-sm text-muted">{revResult.analysis.whyItWorks}</p>
                  <div className="space-y-2 text-xs">
                    <p><span className="font-semibold text-ink">Hook Type:</span> <span className="text-muted">{revResult.analysis.hookType}</span></p>
                    <p><span className="font-semibold text-ink">Pacing:</span> <span className="text-muted">{revResult.analysis.pacing}</span></p>
                    <p><span className="font-semibold text-ink">Emotional Arc:</span> <span className="text-muted">{revResult.analysis.emotionalArc}</span></p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink mb-1.5">Structure Beats:</p>
                    <ol className="space-y-1">
                      {revResult.analysis.structure.map((s: string, i: number) => (
                        <li key={i} className="text-xs text-muted flex gap-2">
                          <span className="text-brand font-mono">{i + 1}.</span> {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-ink mb-1.5">Retention Tricks:</p>
                    <ul className="space-y-1">
                      {revResult.analysis.retentionTricks.map((t: string, i: number) => (
                        <li key={i} className="text-xs text-muted flex gap-2">
                          <span className="text-brand">•</span> {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="card p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-brand" /> Rewritten Script ({revStyle})
                  </h3>
                  <div className="bg-surface rounded-lg p-3 border border-border">
                    <p className="text-xs font-bold text-brand mb-2">NEW HOOK: {revResult.newHook}</p>
                    <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{revResult.rewrittenScript}</p>
                  </div>
                  <button
                    onClick={() => onCreateFromTopic(revResult.rewrittenScript)}
                    className="btn btn-primary w-full"
                  >
                    <PlusCircle className="w-4 h-4" /> Is Script Se Video Banao
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== v15: NICHE FINDER ===== */}
      {tab === "niches" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
              <Compass className="w-5 h-5 text-brand" /> Niche Finder
            </h2>
            <p className="text-xs text-muted">Broad interest do — AI real YouTube search signals se underserved niches dhundhega (high demand, low competition).</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={nicheInterest}
                onChange={e => setNicheInterest(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runNicheFinder()}
                placeholder="Interest area likhein (e.g. ocean, space, cooking, psychology)"
                className="input flex-1"
              />
              <button onClick={runNicheFinder} disabled={nicheLoading || !nicheInterest.trim()} className="btn btn-primary">
                {nicheLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Compass className="w-4 h-4" />}
                Find Niches
              </button>
            </div>
          </div>

          {nicheError && <div className="card p-4 border-red-500/30 bg-red-500/10 text-red-500 text-sm">{nicheError}</div>}

          {nicheLoading && (
            <div className="card p-10 flex flex-col items-center gap-3 text-muted">
              <Loader2 className="w-8 h-8 animate-spin text-brand" />
              <p>YouTube search signals collect + AI scoring ho rahi hai... (1-2 min)</p>
            </div>
          )}

          {nicheResult && (
            <div className="space-y-4">
              <div className="card p-4">
                <p className="text-sm text-muted">{nicheResult.summary}</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {nicheResult.niches.map((n: any, i: number) => (
                  <div key={i} className="card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-ink">{n.niche}</h3>
                      <span className={`badge text-[10px] font-bold ${
                        n.verdict?.includes("GOLD") ? "bg-green-500/15 text-green-500"
                        : n.verdict?.includes("SATURATED") ? "bg-red-500/15 text-red-500"
                        : "bg-yellow-500/15 text-yellow-500"
                      }`}>{n.verdict}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-surface rounded-lg p-2 border border-border">
                        <p className="text-lg font-bold text-green-500">{n.demandScore}</p>
                        <p className="text-[9px] text-muted uppercase font-mono">Demand</p>
                      </div>
                      <div className="bg-surface rounded-lg p-2 border border-border">
                        <p className="text-lg font-bold text-red-400">{n.competitionScore}</p>
                        <p className="text-[9px] text-muted uppercase font-mono">Competition</p>
                      </div>
                      <div className="bg-surface rounded-lg p-2 border border-border">
                        <p className="text-lg font-bold text-brand">{n.opportunityScore}</p>
                        <p className="text-[9px] text-muted uppercase font-mono">Opportunity</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted"><span className="font-semibold text-ink">Audience:</span> {n.targetAudience}</p>
                    <div>
                      <p className="text-xs font-semibold text-ink mb-1">Example Topics:</p>
                      <ul className="space-y-1">
                        {(n.exampleTopics || []).map((t: string, j: number) => (
                          <li key={j} className="text-xs text-muted flex gap-2 items-start">
                            <button
                              onClick={() => onCreateFromTopic(t)}
                              className="text-brand hover:underline flex-shrink-0 cursor-pointer"
                              title="Is topic se video banao"
                            >▶</button>
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== v15: TREND ALERTS ===== */}
      {tab === "alerts" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                <Bell className="w-5 h-5 text-brand" /> Trend Alerts
                {alertUnread > 0 && <span className="badge bg-red-500/15 text-red-500">{alertUnread} new</span>}
              </h2>
              <div className="flex gap-2">
                <button onClick={checkAlertsNow} disabled={alertsLoading} className="btn btn-secondary btn-sm">
                  {alertsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Check Now
                </button>
                <button onClick={markAllRead} className="btn btn-secondary btn-sm">
                  <Check className="w-3.5 h-3.5" /> Mark All Read
                </button>
                <button onClick={clearNotifs} className="btn btn-secondary btn-sm">
                  <Trash2 className="w-3.5 h-3.5" /> Clear
                </button>
              </div>
            </div>
            <p className="text-xs text-muted">Keywords watch karo — har 30 min me auto-check hota hai, high-view matching videos pe alert milta hai.</p>
            {alertCheckMsg && <p className="text-xs text-brand font-mono">{alertCheckMsg}</p>}

            {/* Add new rule */}
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <input
                value={newRuleKeyword}
                onChange={e => setNewRuleKeyword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addAlertRule()}
                placeholder="Keyword/niche (e.g. horror stories, AI tools)"
                className="input flex-1"
              />
              <select value={newRulePlatform} onChange={e => setNewRulePlatform(e.target.value as any)} className="input sm:w-36">
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
              <input
                value={newRuleMinViews}
                onChange={e => setNewRuleMinViews(e.target.value.replace(/\D/g, ""))}
                placeholder="Min views (optional)"
                className="input sm:w-40"
              />
              <button onClick={addAlertRule} disabled={!newRuleKeyword.trim()} className="btn btn-primary">
                <PlusCircle className="w-4 h-4" /> Watch
              </button>
            </div>
          </div>

          {/* Active rules */}
          {alertRules.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-sm font-semibold text-ink">Watched Keywords ({alertRules.length})</h3>
              {alertRules.map(rule => (
                <div key={rule.id} className="flex items-center justify-between gap-3 bg-surface rounded-lg px-3 py-2 border border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.enabled ? "bg-green-500" : "bg-slate-600"}`} />
                    <span className="text-sm text-ink font-medium truncate">{rule.keyword}</span>
                    <span className="badge bg-brand/10 text-brand text-[9px] uppercase">{rule.platform}</span>
                    {rule.minViews > 0 && <span className="text-[10px] text-muted font-mono flex items-center gap-0.5"><Eye className="w-3 h-3" />{fmtCount(rule.minViews)}+</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleAlertRule(rule)}
                      className={`w-9 h-5 rounded-full relative transition-all cursor-pointer ${rule.enabled ? "bg-brand" : "bg-slate-700"}`}
                      title={rule.enabled ? "Disable" : "Enable"}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-all ${rule.enabled ? "translate-x-4" : ""}`} />
                    </button>
                    <button onClick={() => deleteAlertRule(rule.id)} className="p-1 text-muted hover:text-red-500 cursor-pointer" title="Delete rule">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notifications */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
              <BellRing className="w-4 h-4 text-brand" /> Recent Alerts
            </h3>
            {alertNotifs.length === 0 ? (
              <div className="card p-8 text-center text-muted text-sm">
                Abhi koi alert nahi. Keyword watch add karo aur "Check Now" dabao.
              </div>
            ) : (
              alertNotifs.map(n => (
                <div key={n.id} className={`card p-3 flex items-start justify-between gap-3 ${!n.read ? "border-brand/40 bg-brand/5" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {!n.read && <span className="w-2 h-2 rounded-full bg-brand flex-shrink-0" />}
                      <p className="text-sm text-ink font-medium truncate">{n.videoTitle}</p>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      @{n.author} • <span className="font-mono">{fmtCount(n.views)} views</span> • keyword: <span className="text-brand">{n.keyword}</span> • {n.platform}
                    </p>
                    <p className="text-[10px] text-muted font-mono mt-0.5">{new Date(n.detectedAt).toLocaleString()}</p>
                  </div>
                  {n.videoUrl && (
                    <a href={n.videoUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm flex-shrink-0">
                      <ExternalLink className="w-3.5 h-3.5" /> View
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
