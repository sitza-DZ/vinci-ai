import { useState, useEffect } from "react";
import {
  FolderKanban,
  CheckCircle2,
  Video,
  TrendingUp,
  Youtube,
  ShieldCheck,
  ShieldAlert,
  BarChart3,
  Trophy
} from "lucide-react";
import type { Project } from "../types";

interface AnalyticsViewProps {
  projects: Project[];
  onNavigate: (view: string) => void;
}

interface YtStatus {
  ok?: boolean;
  connected?: boolean;
  error?: boolean;
  data?: string | Record<string, unknown> | null;
}

const formatDuration = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

export function AnalyticsView({ projects, onNavigate }: AnalyticsViewProps) {
  const [ytStatus, setYtStatus] = useState<YtStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchYtStatus = async () => {
      try {
        const res = await fetch("/api/youtube/status");
        const data = (await res.json()) as YtStatus;
        if (!cancelled) setYtStatus(data);
      } catch {
        if (!cancelled) setYtStatus({ ok: false, connected: false, error: true });
      }
    };
    fetchYtStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stats
  const totalProjects = projects.length;
  const completedCount = projects.filter(p => p.status === "completed").length;
  const failedCount = projects.filter(p => p.status === "failed").length;
  const processingCount = projects.filter(p => p.status === "processing").length;
  const draftsCount = projects.filter(p => p.status === "draft").length;

  const totalDurationSeconds = projects
    .filter(p => p.status === "completed")
    .reduce((sum, p) => sum + (p.duration || 0), 0);

  const avgDurationSeconds =
    completedCount > 0 ? Math.round(totalDurationSeconds / completedCount) : 0;

  const totalRenders = completedCount + failedCount;
  const successRate = totalRenders > 0 ? (completedCount / totalRenders) * 100 : 0;

  const statusRows = [
    { label: "Completed", color: "bg-[#E1306C]", count: completedCount },
    { label: "Failed", color: "bg-rose-500", count: failedCount },
    { label: "Processing", color: "bg-amber-400", count: processingCount },
    { label: "Draft", color: "bg-indigo-400", count: draftsCount }
  ];

  const topProjects = [...projects]
    .filter(p => p.status === "completed")
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, 5);

  const ytConnected = Boolean(ytStatus?.ok && ytStatus?.connected);
  const channelName = ytStatus?.data
    ? typeof ytStatus.data === "string"
      ? ytStatus.data
      : (ytStatus.data.channelName as string) ||
        (ytStatus.data.channelTitle as string) ||
        (ytStatus.data.name as string) ||
        null
    : null;

  // Empty state
  if (totalProjects === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
          <BarChart3 className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-ink font-semibold">No projects yet</h3>
          <p className="text-slate-400 text-sm">
            Create your first short to start tracking pipeline health & render stats.
          </p>
        </div>
        <button
          onClick={() => onNavigate("create")}
          className="btn btn-primary btn-sm"
        >
          Create Project
        </button>
      </div>
    );
  }

  const statCards = [
    {
      label: "Total Projects",
      value: String(totalProjects),
      accent: "text-indigo-400",
      iconBg: "bg-indigo-500/10",
      icon: <FolderKanban className="w-5 h-5" />
    },
    {
      label: "Completed",
      value: String(completedCount),
      accent: "text-[#E1306C]",
      iconBg: "bg-[#E1306C]/10",
      icon: <CheckCircle2 className="w-5 h-5" />
    },
    {
      label: "Rendered",
      value: String(totalRenders),
      accent: "text-amber-400",
      iconBg: "bg-amber-500/10",
      icon: <Video className="w-5 h-5" />
    },
    {
      label: "Success Rate",
      value: `${Math.round(successRate)}%`,
      accent: "text-[#E1306C]",
      iconBg: "bg-[#E1306C]/10",
      icon: <TrendingUp className="w-5 h-5" />
    }
  ];

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Analytics</h1>
          <p className="text-sm text-slate-400 mt-1">Project pipeline health &amp; render stats</p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div
            key={card.label}
            className="bg-slate-800/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between"
          >
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                {card.label}
              </span>
              <p className={`text-3xl font-bold mt-1 ${card.accent}`}>{card.value}</p>
            </div>
            <div
              className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center shrink-0 ${card.accent}`}
            >
              {card.icon}
            </div>
          </div>
        ))}
      </div>

      {/* Status Distribution + Top Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status Distribution */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4">
            <BarChart3 className="w-4 h-4 text-[#E1306C]" />
            Status Distribution
          </h3>
          <div className="space-y-4">
            {statusRows.map(row => {
              const pct = totalProjects > 0 ? Math.round((row.count / totalProjects) * 100) : 0;
              const width = pct > 0 ? Math.max(4, pct) : 0;
              return (
                <div key={row.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${row.color}`} />
                      <span className="text-slate-300 font-medium">{row.label}</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-slate-500">
                      <span className="text-slate-400">{row.count}</span>
                      <span className="w-10 text-right">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className={`h-2.5 rounded-full ${row.color}`}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-widest text-slate-500">
            Avg duration&nbsp;&nbsp;
            <span className="text-slate-300 font-mono normal-case tracking-normal">
              {formatDuration(avgDurationSeconds)} / completed
            </span>
          </p>
        </div>

        {/* Top Projects by Duration */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4">
            <Trophy className="w-4 h-4 text-amber-400" />
            Top Projects by Duration
          </h3>
          {topProjects.length === 0 ? (
            <p className="text-sm text-slate-500">No completed renders yet.</p>
          ) : (
            <ol className="space-y-3">
              {topProjects.map((project, index) => (
                <li key={project.id} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <span className="flex-1 min-w-0 max-w-[180px] truncate text-sm text-slate-200">
                    {project.title}
                  </span>
                  <span className="text-xs font-mono text-slate-400 shrink-0">
                    {formatDuration(project.duration || 0)}
                  </span>
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                    Completed
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* YouTube Upload Status */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200 mb-4">
          <Youtube className="w-4 h-4 text-rose-400" />
          YouTube Upload Status
        </h3>
        {ytStatus === null ? (
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
              Checking...
            </span>
          </div>
        ) : ytConnected ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Connected
              </span>
            </div>
            {channelName && (
              <p className="text-sm text-slate-300">
                Channel: <span className="text-slate-100 font-medium">{channelName}</span>
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Not Connected
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Connect YouTube in Settings for scheduled uploads
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
