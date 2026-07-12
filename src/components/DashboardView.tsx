import { useState } from "react";
import {
  Plus,
  Video,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  ArrowRight,
  TrendingUp,
  FileVideo,
  Flame
} from "lucide-react";
import { Project, ProjectStatus } from "../types";

interface DashboardViewProps {
  projects: Project[];
  onNavigate: (view: string) => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

export default function DashboardView({ 
  projects, 
  onNavigate, 
  onSelectProject, 
  onDeleteProject 
}: DashboardViewProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  // Status calculation counters
  const totalCount = projects.length;
  const completedCount = projects.filter(p => p.status === ProjectStatus.COMPLETED).length;
  const processingCount = projects.filter(p => p.status === ProjectStatus.PROCESSING).length;

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case ProjectStatus.COMPLETED:
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case ProjectStatus.PROCESSING:
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block animate-ping"></span>
            Rendering
          </span>
        );
      case ProjectStatus.FAILED:
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold bg-slate-500/10 text-slate-300 border border-slate-500/20">
            <Clock className="w-3.5 h-3.5" />
            Draft Storyboard
          </span>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* Page Title Dashboard Greetings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-display font-bold tracking-tight text-white">Creator Dashboard</h2>
          <p className="text-slate-400 text-sm mt-1">Manage your viral shorts projects, edit storyboards, and run local renders.</p>
        </div>
        <button
          id="dashboard_btn_create"
          onClick={() => onNavigate("create")}
          className="flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all duration-200 shadow-lg shadow-indigo-500/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Create New Short
        </button>
      </div>

      {/* Quick Creator Stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-mono">ALL PROJECTS</span>
            <h3 className="text-2xl font-bold text-white mt-1 font-display">{totalCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
            <Video className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-mono">COMPLETED</span>
            <h3 className="text-2xl font-bold text-emerald-400 mt-1 font-display">{completedCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-mono">RENDER PIPELINE</span>
            <h3 className="text-2xl font-bold text-indigo-400 mt-1 font-display">{processingCount}</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-400 font-mono">VIRAL AUDIENCE IMPRINT</span>
            <h3 className="text-2xl font-bold text-amber-400 mt-1 font-display">9:16 vertical</h3>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
            <Flame className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Projects List Segment */}
      <div className="space-y-4">
        <h3 className="text-lg font-display font-semibold text-slate-200 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          Recent Creator Workspaces
        </h3>

        {projects.length === 0 ? (
          <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
            <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mx-auto">
              <FileVideo className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-white font-semibold">No vertical short projects yet</h4>
              <p className="text-slate-400 text-sm max-w-xs mx-auto">Input a topic or paste a script, and let the Gemini AI generator construct your short storyboard in seconds.</p>
            </div>
            <button
              onClick={() => onNavigate("create")}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors cursor-pointer"
            >
              Start Generating
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(project => {
              // Use project thumbnail if available, otherwise show default gradient placeholder
              const previewSrc = project.thumbnailUrl
                ? project.thumbnailUrl
                : project.status === ProjectStatus.COMPLETED
                ? (project.renderedVideoUrl ? `/api/projects/${project.id}/thumbnail.jpg` : null)
                : null;
              const dateText = new Date(project.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
              });

              return (
                <div
                  key={project.id}
                  id={`project_card_${project.id}`}
                  className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-all duration-300 flex flex-col group"
                >
                  {/* Aspect image placeholder / Video thumbnail */}
                  <div className="relative aspect-video bg-slate-950 overflow-hidden shrink-0">
                    {previewSrc ? (
                      <img
                        src={previewSrc}
                        alt={project.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#0A0D13] via-[#11151D] to-[#1C2230] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2 opacity-40">
                          <Video className="w-8 h-8 text-[#2FD0C4]" />
                          <span className="font-mono text-[10px] text-[#5C6678] uppercase tracking-wider">{project.status === ProjectStatus.DRAFT ? 'Storyboard' : project.status}</span>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      {getStatusBadge(project.status)}
                    </div>
                    {project.duration && (
                      <div className="absolute bottom-3 right-3 text-[10px] font-mono bg-slate-950/80 text-slate-300 px-1.5 py-0.5 rounded border border-slate-800">
                        {project.duration}s
                      </div>
                    )}
                  </div>

                  {/* Metadata fields */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1">
                      <h4 className="font-semibold text-slate-100 group-hover:text-indigo-400 transition-colors line-clamp-1">
                        {project.title}
                      </h4>
                      {project.topic && (
                        <p className="text-xs text-slate-400 line-clamp-2">
                          Topic: <span className="text-slate-300">{project.topic}</span>
                        </p>
                      )}
                    </div>

                    <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                      <span>Created {dateText}</span>
                      <div className="flex items-center gap-2">
                        {deleteConfirmId === project.id ? (
                          <div className="flex items-center gap-1.5 bg-rose-950/40 border border-rose-900/40 p-1 rounded-lg">
                            <span className="text-[10px] text-rose-400 font-bold px-1 font-mono">DELETE?</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteProject(project.id);
                                setDeleteConfirmId(null);
                              }}
                              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-colors"
                            >
                              YES
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-colors"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(project.id);
                            }}
                            className="text-slate-500 hover:text-rose-400 p-1.5 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Delete Project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold px-2.5 py-1.5 hover:bg-indigo-600/10 rounded-lg transition-colors cursor-pointer"
                        >
                          Workspace
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
