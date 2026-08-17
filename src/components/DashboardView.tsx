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
          <span className="badge badge-success">
            <CheckCircle className="w-3.5 h-3.5" />
            Completed
          </span>
        );
      case ProjectStatus.PROCESSING:
        return (
          <span className="badge badge-info animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 block animate-ping"></span>
            Rendering
          </span>
        );
      case ProjectStatus.FAILED:
        return (
          <span className="badge badge-danger">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed
          </span>
        );
      default:
        return (
          <span className="badge badge-neutral">
            <Clock className="w-3.5 h-3.5" />
            Draft Storyboard
          </span>
        );
    }
  };

  const statCards = [
    { label: "ALL PROJECTS", value: String(totalCount), icon: Video, iconClass: "bg-slate-800 text-slate-300", valueClass: "text-white" },
    { label: "COMPLETED", value: String(completedCount), icon: CheckCircle, iconClass: "bg-emerald-500/10 text-emerald-400", valueClass: "text-emerald-400" },
    { label: "RENDER PIPELINE", value: String(processingCount), icon: Clock, iconClass: "bg-indigo-500/10 text-indigo-400", valueClass: "text-indigo-400" },
    { label: "VIRAL AUDIENCE IMPRINT", value: "9:16 vertical", icon: Flame, iconClass: "bg-amber-500/10 text-amber-400", valueClass: "text-amber-400" },
  ];

  return (
    <div className="space-y-8">
      {/* Page Title Dashboard Greetings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="kicker-violet">Workspace Overview</span>
          <h2 className="text-3xl font-display font-bold tracking-tight text-ink mt-1">Creator Dashboard</h2>
          <p className="text-slate-400 text-sm mt-1">Manage your viral shorts projects, edit storyboards, and run local renders.</p>
        </div>
        <button
          id="dashboard_btn_create"
          onClick={() => onNavigate("create")}
          className="btn btn-primary btn-lg"
        >
          <Plus className="w-4 h-4" />
          Create New Short
        </button>
      </div>

      {/* Quick Creator Stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className={`card card-hover p-5 flex items-center justify-between stagger-${i + 1} fade-in-up`}>
              <div>
                <span className="text-[10px] text-slate-400 font-mono tracking-wider">{stat.label}</span>
                <h3 className={`text-2xl font-bold mt-1 font-display ${stat.valueClass}`}>{stat.value}</h3>
              </div>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${stat.iconClass}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Projects List Segment */}
      <div className="space-y-4">
        <h3 className="section-title text-lg">
          <TrendingUp className="w-4 h-4 text-indigo-400" />
          Recent Creator Workspaces
        </h3>

        {projects.length === 0 ? (
          <div className="card border-dashed p-12 text-center max-w-xl mx-auto space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/20 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto">
              <FileVideo className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-ink font-semibold">No vertical short projects yet</h4>
              <p className="text-slate-400 text-sm max-w-xs mx-auto">Input a topic or paste a script, and let the Gemini AI generator construct your short storyboard in seconds.</p>
            </div>
            <button
              onClick={() => onNavigate("create")}
              className="btn btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
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
                  className="card card-hover overflow-hidden flex flex-col group"
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
                      <div className="w-full h-full bg-gradient-to-br from-[#000000] via-[#0F0F0F] to-[#1C1C1E] flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2 opacity-50">
                          <Video className="w-8 h-8 text-indigo-400" />
                          <span className="font-mono text-[10px] text-slate-500 uppercase tracking-wider">{project.status === ProjectStatus.DRAFT ? 'Storyboard' : project.status}</span>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent"></div>
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      {getStatusBadge(project.status)}
                    </div>
                    {project.duration && (
                      <div className="absolute bottom-3 right-3 text-[10px] font-mono bg-slate-950/80 text-slate-300 px-1.5 py-0.5 rounded-md border border-slate-800">
                        {project.duration}s
                      </div>
                    )}
                  </div>

                  {/* Metadata fields */}
                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1">
                      <h4 className="font-semibold text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-1">
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
                              className="btn btn-danger btn-xs"
                            >
                              YES
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(null);
                              }}
                              className="btn btn-secondary btn-xs"
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
                            className="btn btn-ghost btn-icon btn-xs text-slate-500 hover:text-rose-400"
                            title="Delete Project"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className="btn btn-outline btn-sm"
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
