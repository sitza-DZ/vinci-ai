import React, { useState } from "react";
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
  X
} from "lucide-react";

interface SaaSLayoutProps {
  currentView: string;
  onNavigate: (view: string) => void;
  children: React.ReactNode;
  user?: { id: string; name: string; email: string; avatarUrl?: string; role?: string } | null;
}

export default function SaaSLayout({ currentView, onNavigate, children, user }: SaaSLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mascotAnimating, setMascotAnimating] = useState(false);

  const menuItems = [
    { id: "dashboard", name: "Dashboard", icon: LayoutDashboard },
    { id: "create", name: "Create Short", icon: PlusCircle },
    { id: "history", name: "Video History", icon: History },
    { id: "diagnostics", name: "Render Diagnostics", icon: Activity },
    { id: "settings", name: "Settings & Sources", icon: Settings },
  ];

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex flex-col h-full justify-between">
      <div>
        {/* Logo Brand Header */}
        <div className="h-16 flex items-center px-6 gap-3 border-b border-slate-800 justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Film className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg tracking-tight leading-none text-white">Vinci AI</h1>
              <span className="text-[10px] text-slate-500 font-mono tracking-wider">v12.0 ENGINE</span>
            </div>
          </div>
          {isMobile && (
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer lg:hidden"
              title="Close Menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Project Quick Stats */}
        <div className="p-4 mx-3 my-4 bg-slate-800/30 rounded-xl border border-slate-800/60 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Projects</span>
            <span className="text-emerald-400 font-bold">12</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Scenes</span>
            <span className="text-indigo-400 font-bold">168</span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-400">Last Render</span>
            <span className="text-amber-400 font-bold text-[8px]">2m ago</span>
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
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 group relative cursor-pointer ${
                  isActive 
                    ? "bg-slate-800 text-white font-bold shadow-sm" 
                    : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                }`}
              >
                <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? "text-indigo-400" : "text-slate-400 group-hover:text-slate-200"}`} />
                {item.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Sidebar Footer Account metadata */}
      <div className="p-4 border-t border-slate-800 space-y-3">
        <div className="bg-slate-800/50 rounded-xl p-4">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold font-mono">Local Server</span>
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
          </div>
          <div className="text-xs font-mono text-slate-300">Node v20.10 | FFmpeg 7.0</div>
        </div>

        <div 
          onClick={() => {
            onNavigate("settings");
            if (isMobile) {
              setIsMobileMenuOpen(false);
            }
          }}
          className="flex items-center gap-3 p-2 rounded-lg bg-slate-950/30 border border-slate-800/40 cursor-pointer hover:bg-slate-800/30 transition-colors"
          title="Creator Profile Settings"
        >
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs overflow-hidden border border-indigo-500/20">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <UserIcon className="w-4 h-4 text-indigo-400" />
            )}
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
      <aside className="hidden lg:flex w-64 bg-slate-900/50 border-r border-slate-800 flex-col shrink-0 justify-between">
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
        <header className="h-16 border-b border-slate-800/80 bg-slate-900/30 flex items-center justify-between px-4 sm:px-8 shrink-0">
          <div className="flex items-center gap-3">
            {/* Hamburger Button for Mobile */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Open Navigation Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-white uppercase font-mono">Creator Dashboard</h2>
            <span className="hidden sm:inline-block px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold rounded border border-indigo-500/20">v12.0</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button className="text-slate-400 hover:text-slate-200 p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer">
              <HelpCircle className="w-4 h-4" />
            </button>
            <div className="h-5 w-px bg-slate-800"></div>
            <div className="text-xs text-right hidden sm:block">
              <p className="font-semibold text-slate-200">{user?.name || "SaaS Creator"}</p>
              <p className="text-[10px] text-slate-500 font-mono">{user?.role || "Administrator"}</p>
            </div>
            <button 
              onClick={() => onNavigate("settings")}
              className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-slate-800 border border-slate-700 overflow-hidden cursor-pointer hover:border-indigo-500 transition-colors flex items-center justify-center shrink-0"
              title="Creator Profile Settings"
            >
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
              )}
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
        <footer className="h-12 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between px-4 sm:px-8 text-[11px] font-mono text-slate-500 shrink-0 select-none">
          <div className="flex gap-4 sm:gap-6">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              QUEUE: IDLE
            </span>
            <span className="hidden xs:flex items-center gap-1.5">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              GEMINI: CONNECTED
            </span>
          </div>
          <div className="flex gap-4 sm:gap-6">
            <span className="hidden sm:inline">UPTIME: 14:02:11</span>
            <span className="hidden md:inline">CPU: 12%</span>
            <span>FFMPEG: v7.0</span>
          </div>
        </footer>

      </div>
    </div>
  );
}
