/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import SaaSLayout from "./components/SaaSLayout";
import DashboardView from "./components/DashboardView";
import CreateVideoView from "./components/CreateVideoView";
import ProjectDetailsView from "./components/ProjectDetailsView";
import VideoHistoryView from "./components/VideoHistoryView";
import SettingsView from "./components/SettingsView";
import RenderDiagnosticsView from "./components/RenderDiagnosticsView";
import { Project } from "./types";

export default function App() {
  const [currentView, setCurrentView] = useState<string>("dashboard");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; name: string; email: string; avatarUrl?: string; role?: string } | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Fetch active user profile
  const loadUser = async () => {
    try {
      const res = await fetch("/api/user");
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch (e: any) {
      console.error("Failed to load user profile:", e);
    }
  };

  // Fetch all projects from API
  const loadProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
        setApiError(null);
      } else {
        setApiError("Failed to communicate with local development API server.");
      }
    } catch (e: any) {
      setApiError("API server offline. Please verify Express server.ts setup.");
    }
  };

  useEffect(() => {
    loadProjects();
    loadUser();
  }, [currentView]);

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setCurrentView("project_details");
  };

  const handleDeleteProject = async (id: string) => {
    // Optimistic UI update: remove from current state immediately
    const originalProjects = [...projects];
    setProjects(prev => prev.filter(p => p.id !== id));

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (res.ok) {
        await loadProjects();
        if (selectedProjectId === id) {
          setSelectedProjectId(null);
          setCurrentView("dashboard");
        }
        setNotification({
          type: "success",
          message: "Video and all associated files deleted successfully."
        });
        setTimeout(() => setNotification(null), 5000);
      } else {
        // Revert optimistic update
        setProjects(originalProjects);
        const errData = await res.json();
        const msg = errData.error || errData.message || "Failed to delete project.";
        setNotification({
          type: "error",
          message: `Deletion failed: ${msg}`
        });
      }
    } catch (e: any) {
      // Revert optimistic update
      setProjects(originalProjects);
      setNotification({
        type: "error",
        message: `Deletion failed: ${e.message || "Network error"}`
      });
    }
  };

  const handleProjectCreated = (newProject: any, scenes: any[], job: any) => {
    setSelectedProjectId(newProject.id);
    setCurrentView("project_details");
  };

  const renderActiveView = () => {
    const viewContent = () => {
      switch (currentView) {
        case "create":
          return <CreateVideoView onProjectCreated={handleProjectCreated} />;
        case "project_details":
          return selectedProjectId ? (
            <ProjectDetailsView
              projectId={selectedProjectId}
              onBack={() => {
                setSelectedProjectId(null);
                setCurrentView("dashboard");
              }}
            />
          ) : (
            <DashboardView
              projects={projects}
              onNavigate={setCurrentView}
              onSelectProject={handleSelectProject}
              onDeleteProject={handleDeleteProject}
            />
          );
        case "history":
          return (
            <VideoHistoryView
              projects={projects}
              onSelectProject={handleSelectProject}
              onDeleteProject={handleDeleteProject}
            />
          );
        case "diagnostics":
          return <RenderDiagnosticsView projects={projects} />;
        case "settings":
          return <SettingsView onProfileUpdate={loadUser} />;
        default:
          return (
            <DashboardView
              projects={projects}
              onNavigate={setCurrentView}
              onSelectProject={handleSelectProject}
              onDeleteProject={handleDeleteProject}
            />
          );
      }
    };

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView + (selectedProjectId || "")}
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        >
          {viewContent()}
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <>
      {/* SleuthAgent-inspired atmosphere layers */}
      <div className="atmos">
        <div className="atmos atmos-deep" />
        <div className="atmos atmos-dots" />
        <div className="atmos atmos-scan" />
        <div className="atmos atmos-grain" />
        <div className="atmos atmos-vignette" />
      </div>
      <div className="content-layer">
        <SaaSLayout currentView={currentView} onNavigate={setCurrentView} user={user}>
      {apiError && (
        <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl text-xs font-semibold text-left">
          ⚠️ {apiError}
        </div>
      )}
      {notification && (
        <div className={`mb-6 p-4 rounded-xl text-xs font-semibold text-left flex items-center justify-between border ${
          notification.type === "success" 
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
            : "bg-rose-500/10 border-rose-500/20 text-rose-400"
        }`}>
          <span>{notification.type === "success" ? "✅" : "❌"} {notification.message}</span>
          <button onClick={() => setNotification(null)} className="text-slate-400 hover:text-white cursor-pointer ml-3 font-bold">✕</button>
        </div>
      )}
      {renderActiveView()}
    </SaaSLayout>
      </div>
    </>
  );
}
