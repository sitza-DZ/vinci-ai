import { useState } from "react";
import { 
  FileVideo, 
  Download, 
  ExternalLink, 
  Calendar, 
  Tv, 
  Trash2, 
  CheckCircle,
  FileDown
} from "lucide-react";
import { Project, ProjectStatus } from "../types";

interface VideoHistoryViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

export default function VideoHistoryView({ 
  projects, 
  onSelectProject, 
  onDeleteProject 
}: VideoHistoryViewProps) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  
  const completedProjects = projects.filter(p => p.status === ProjectStatus.COMPLETED);

  return (
    <div className="space-y-6 text-left">
      <div>
        <h2 className="text-3xl font-display font-bold text-white">Video History & Exports</h2>
        <p className="text-slate-400 text-sm mt-1">Review compiled H264 MP4 outputs, review duration metrics, and download rendered files.</p>
      </div>

      {completedProjects.length === 0 ? (
        <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-2xl p-16 text-center max-w-xl mx-auto space-y-4">
          <div className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mx-auto">
            <FileVideo className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-white font-semibold">No finished exports found</h4>
            <p className="text-slate-400 text-sm max-w-xs mx-auto">
              Once you trigger video compilation in a project workspace, the final rendered MP4 files will appear here for fast retrieval.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-[10px] uppercase font-bold text-slate-400 tracking-wider font-mono">
                  <th className="py-4 px-6">Project Short Name</th>
                  <th className="py-4 px-6">Date Rendered</th>
                  <th className="py-4 px-6">Format</th>
                  <th className="py-4 px-6">Length</th>
                  <th className="py-4 px-6">File Size</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-xs">
                {completedProjects.map(project => {
                  const dateText = new Date(project.updatedAt || project.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit"
                  });

                  return (
                    <tr key={project.id} className="hover:bg-slate-950/40 transition-colors">
                      {/* Name/Title */}
                      <td className="py-4 px-6 font-semibold text-slate-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                          </div>
                          <div>
                            <p className="line-clamp-1">{project.title}</p>
                            <span className="text-[10px] text-slate-500 uppercase font-bold font-mono">ID: {project.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-4 px-6 text-slate-400 font-mono">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          {dateText}
                        </div>
                      </td>

                      {/* Format preset */}
                      <td className="py-4 px-6 text-slate-300 font-mono">
                        <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-bold uppercase">
                          {project.settings.exportFormat || "mp4"}
                        </span>
                      </td>

                      {/* Video duration */}
                      <td className="py-4 px-6 text-slate-300 font-mono font-semibold">
                        {project.duration || 30}s
                      </td>

                      {/* File size */}
                      <td className="py-4 px-6 text-slate-300 font-mono font-semibold">
                        {project.fileSize || "42.0 MB"}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                          <button
                            onClick={() => onSelectProject(project.id)}
                            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold px-2.5 py-1.5 hover:bg-indigo-600/10 rounded-lg transition-colors cursor-pointer"
                          >
                            Workspace
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          
                          <a
                            href={project.renderedVideoUrl}
                            download={`rendered_short_${project.id}.mp4`}
                            className="text-slate-400 hover:text-emerald-400 p-1.5 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                            title="Download File"
                          >
                            <FileDown className="w-4.5 h-4.5" />
                          </a>

                          {deleteConfirmId === project.id ? (
                            <div className="flex items-center gap-1 bg-rose-950/40 border border-rose-900/40 p-1 rounded-lg">
                              <span className="text-[10px] text-rose-400 font-bold px-1 font-mono">SURE?</span>
                              <button
                                onClick={() => {
                                  onDeleteProject(project.id);
                                  setDeleteConfirmId(null);
                                }}
                                className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-colors"
                              >
                                YES
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-[10px] px-2 py-1 rounded cursor-pointer transition-colors"
                              >
                                NO
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirmId(project.id)}
                              className="text-slate-500 hover:text-rose-400 p-1.5 hover:bg-slate-800 rounded-lg transition-all cursor-pointer"
                              title="Delete File"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
