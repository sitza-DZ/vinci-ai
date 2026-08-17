import React, { useState, useEffect } from "react";
import {
  Film,
  PlusCircle,
  LayoutDashboard,
  History,
  Settings,
  HelpCircle,
  Activity,
  User as UserIcon,
  Menu,
  X,
  BarChart3,
  Layers,
  Sun,
  Moon,
  Flame,
  Rocket,
} from "lucide-react";
import { Project, ProjectStatus } from "../types";

interface SaaSLayoutProps {
  currentView: string;
  onNavigate: (view: string) => void;
  children: React.ReactNode;
  user?: { id: string; name: string; email: string; avatarUrl?: string; role?: string } | null;
  projects?: Project[];
  serverOnline?: boolean;
  health?: { nodeVersion?: string; ffmpegVersion?: string } | null;
}

export default function SaaSLayout({ currentView, onNavigate, children, user, projects, serverOnline, health }: SaaSLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDayMode, setIsDayMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem("vinci-mode") === "light";
    } catch {
      return false;
    }
  });

  // Apply mode to <html> + persist
  useEffect(() => {
    if (isDayMode) {
      document.documentElement.setAttribute("data-mode", "light");
    } else {
      document.documentElement.removeAttribute("data-mode");
    }
    try {
      localStorage.setItem("vinci-mode", isDayMode ? "light" : "dark");
    } catch {
      // storage unavailable — mode still applies for this session
    }
  }, [isDayMode]);

  const completedProjects = (projects || []).filter(p => p.status === ProjectStatus.COMPLETED);
  const isRendering = (projects || []).some(p => p.status === ProjectStatus.PROCESSING);
  const lastRenderMs = completedProjects.length
    ? Math.max(...completedProjects.map(p => new Date(p.updatedAt || p.createdAt).getTime()))
    : null;
  const lastRenderLabel = lastRenderMs
    ? (() => {
        const diffSec = Math.round((Date.now() - lastRenderMs) / 1000);
        if (diffSec < 60) return `${diffSec}s ago`;
        if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
        if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
        return `${Math.round(diffSec / 86400)}d ago`;
      })()
    : "Never";

  const menuItems = [
    { id: "dashboard", name: "Dashboard", icon: LayoutDashboard },
    { id: "create", name: "Create Short", icon: PlusCircle },
    { id: "autopilot", name: "Autopilot", icon: Rocket },
    { id: "trends", name: "Trend Intelligence", icon: Flame },
    { id: "history", name: "Video History", icon: History },
    { id: "batch", name: "Batch Render", icon: Layers },
    { id: "analytics", name: "Analytics", icon: BarChart3 },
    { id: "diagnostics", name: "Render Diagnostics", icon: Activity },
    { id: "settings", name: "Settings & Sources", icon: Settings },
  ];

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full justify-between">
      <div>
        {/* Logo Brand Header — Instagram gradient logo */}
        <div className="h-16 flex items-center px-5 gap-3 border-b border-slate-800/70 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl ig-logo flex items-center justify-center shadow-lg shadow-pink-600/40">
              <Film className="w-4.5 h-4.5 text-ink" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg tracking-tight leading-none text-ink">Vinci AI</h1>
              <span className="text-[10px] text-slate-500 font-mono tracking-wider">v12.0 ENGINE</span>
            </div>
          </div>
          {isMobile && (
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="btn btn-ghost btn-icon btn-sm lg:hidden"
              title="Close Menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Project Quick Stats (real data from API) */}
        <div className="p-4 mx-3 my-4 card space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Projects</span>
            <span className="text-emerald-400 font-bold">{projects?.length ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Completed</span>
            <span className="text-indigo-400 font-bold">{completedProjects.length}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Last Render</span>
            <span className="text-amber-400 font-bold text-[9px]">{lastRenderLabel}</span>
          </div>
        </div>

        {/* Nav Navigation Links */}
        <nav className="px-3 space-y-1">
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`nav_btn_${item.id}`}
                onClick={() => {
                  onNavigate(item.id);
                  if (isMobile) {
                    setIsMobileMenuOpen(false);
                  }
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 group relative cursor-pointer ${
                  isActive
                    ? "bg-indigo-600/15 text-ink border border-indigo-500/30 shadow-[0_0_18px_-6px_rgba(225,48,108,0.5)]"
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-ink border border-transparent"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-gradient-to-b from-indigo-300 via-indigo-500 to-fuchsia-500" />
                )}
                <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? "text-indigo-400" : "text-slate-500 group-hover:text-slate-200"}`} />
                {item.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer Account metadata */}
      <div className="p-4 border-t border-slate-800/70 space-y-3">
        <div className="card p-4">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold font-mono">Local Server</span>
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span>
          </div>
          <div className="text-xs font-mono text-slate-300">Node {health?.nodeVersion || "—"} | FFmpeg {health?.ffmpegVersion || "—"}</div>
        </div>

        <div
          onClick={() => {
            onNavigate("settings");
            if (isMobile) {
              setIsMobileMenuOpen(false);
            }
          }}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/50 cursor-pointer hover:border-indigo-500/40 hover:bg-slate-800/30 transition-all"
          title="Creator Profile Settings"
        >
          {/* Instagram story-ring avatar */}
          <div className="w-9 h-9 ig-ring shrink-0">
            <div className="ig-ring-inner overflow-hidden">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-4 h-4 text-indigo-400" />
              )}
            </div>
          </div>
          <div className="overflow-hidden text-left">
            <p className="text-xs font-semibold text-slate-200 truncate leading-none">{user?.name || "SaaS Creator"}</p>
            <p className="text-[9px] text-slate-500 truncate mt-1">{user?.email || "creator@example.com"}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans select-none antialiased">
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden lg:flex w-64 bg-slate-900/40 backdrop-blur-xl border-r border-slate-800/70 flex-col shrink-0 justify-between">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer Overlay / Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Sidebar Navigation Drawer */}
      <aside className={`fixed top-0 bottom-0 left-0 w-64 bg-slate-900 border-r border-slate-800 z-50 lg:hidden flex flex-col justify-between transition-transform duration-300 ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {renderSidebarContent(true)}
      </aside>

      {/* Main Container Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 border-b border-slate-800/70 bg-slate-900/30 backdrop-blur-xl flex items-center justify-between px-4 sm:px-8 shrink-0">
          <div className="flex items-center gap-3">
            {/* Hamburger Button for Mobile */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="btn btn-ghost btn-icon btn-sm lg:hidden"
              title="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-ink uppercase font-mono">Creator Dashboard</h2>
            <span className="hidden sm:inline-flex badge badge-info">v12.0</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Day / Night mode toggle */}
            <button
              onClick={() => setIsDayMode(prev => !prev)}
              className="btn btn-secondary btn-icon btn-sm"
              title={isDayMode ? "Switch to Night Mode" : "Switch to Day Mode"}
              aria-label={isDayMode ? "Switch to Night Mode" : "Switch to Day Mode"}
            >
              {isDayMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" title="Help">
              <HelpCircle className="w-4 h-4" />
            </button>
            <div className="h-5 w-px bg-slate-800"></div>
            <div className="text-xs text-right hidden sm:block">
              <p className="font-semibold text-slate-200">{user?.name || "SaaS Creator"}</p>
              <p className="text-[10px] text-slate-500 font-mono">{user?.role || "Administrator"}</p>
            </div>
            <button
              onClick={() => onNavigate("settings")}
              className="w-9 h-9 sm:w-10 sm:h-10 ig-ring cursor-pointer hover:shadow-[0_0_16px_-4px_rgba(225,48,108,0.6)] transition-all shrink-0"
              title="Creator Profile Settings"
            >
              <div className="ig-ring-inner overflow-hidden">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
                )}
              </div>
            </button>
          </div>
        </header>

        {/* Dynamic View Panel content - self scroll container */}
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
          <div className="fade-in-up max-w-7xl w-full mx-auto">
            {children}
          </div>
        </main>

        {/* Footer Stats */}
        <footer className="h-12 border-t border-slate-800/70 bg-slate-900/40 backdrop-blur-xl flex items-center justify-between px-4 sm:px-8 text-[11px] font-mono text-slate-500 shrink-0 select-none">
          <div className="flex gap-4 sm:gap-6">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isRendering ? "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"}`}></span>
              QUEUE: {isRendering ? "RENDERING" : "IDLE"}
            </span>
            <span className="hidden xs:flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${serverOnline === false ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" : "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"}`}></span>
              API: {serverOnline === false ? "OFFLINE" : "ONLINE"}
            </span>
          </div>
          <div className="flex gap-4 sm:gap-6">
            <span className="hidden sm:inline">NODE: {health?.nodeVersion || "—"}</span>
            <span className="hidden md:inline">FFMPEG: {health?.ffmpegVersion || "—"}</span>
          </div>
        </footer>

      </div>
    </div>
  );
}
