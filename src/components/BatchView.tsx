/**
 * BatchView — enqueue multiple selected projects into the server-side render
 * queue (POST /api/batch/render), then poll /api/batch/status until every
 * project reaches a terminal state (completed/failed/cancelled), with a live
 * progress log. The queue guarantees only ONE ffmpeg render runs at a time,
 * regardless of how many clients trigger renders.
 */
import { useRef, useState } from "react";
import { Play, Square, ListOrdered } from "lucide-react";
import type { Project } from "../types";

interface BatchViewProps {
  projects: Project[];
  onNavigate: (view: string) => void;
}

type BatchResult = "completed" | "failed" | "skipped";

type QueueItemStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";

interface QueueItemLite {
  projectId: string;
  status: QueueItemStatus;
  error?: string;
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const POLL_MS = 2000;
const MAX_POLLS = 900; // 30 min — matches the queue's per-project hard cap

export default function BatchView({ projects, onNavigate }: BatchViewProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(projects.map(p => [p.id, true]))
  );
  const [running, setRunning] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, BatchResult>>({});
  const stopRef = useRef(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);

  const addLog = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    setLog(prev => [...prev, line]);
    setTimeout(() => {
      logBoxRef.current?.scrollTo({ top: logBoxRef.current.scrollHeight, behavior: "smooth" });
    }, 30);
  };

  const titleFor = (id: string) => projects.find(p => p.id === id)?.title || id;

  const formatDur = (sec: number) =>
    `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

  const runBatch = async () => {
    if (running) return;
    const ids = Object.keys(selected).filter(k => selected[k]);
    if (ids.length === 0) return;

    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setResults({});
    setCurrentProjectId(null);

    // 1. Enqueue the whole batch — the server serializes the renders itself.
    addLog(`Enqueuing ${ids.length} project(s) into the render queue...`);
    let res: Response;
    try {
      res = await fetch("/api/batch/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: ids })
      });
    } catch (e: any) {
      addLog(`Network error: ${e.message || "fetch failed"}`);
      setRunning(false);
      return;
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        if (err.error) msg = err.error;
      } catch { /* non-json body */ }
      addLog(`Failed to start batch: ${msg}`);
      setRunning(false);
      return;
    }

    // 2. Poll the queue until every selected project is terminal.
    const terminal = new Set<string>();
    const lastLogged: Record<string, QueueItemStatus> = {};
    let polled = 0;

    while (polled < MAX_POLLS) {
      await delay(POLL_MS);
      polled += 1;

      let q: any;
      try {
        q = await fetch("/api/batch/status").then(r => r.json());
      } catch (e: any) {
        addLog(`Poll error: ${e.message || "fetch failed"} — retrying...`);
        continue;
      }

      const items: QueueItemLite[] = q.items || [];
      const seen = new Set<string>();

      for (const item of items) {
        if (!ids.includes(item.projectId)) continue;
        seen.add(item.projectId);
        const t = titleFor(item.projectId);
        const st = item.status;

        if (st === "queued" && lastLogged[item.projectId] !== "queued") {
          lastLogged[item.projectId] = "queued";
          addLog(`⏳ "${t}" queued...`);
        } else if (st === "rendering") {
          if (lastLogged[item.projectId] !== "rendering") {
            lastLogged[item.projectId] = "rendering";
            addLog(`▶ Rendering "${t}"...`);
          }
          setCurrentProjectId(item.projectId);
        } else if (st === "completed" && !terminal.has(item.projectId)) {
          terminal.add(item.projectId);
          setResults(prev => ({ ...prev, [item.projectId]: "completed" }));
          let dur = "";
          try {
            const p = await fetch(`/api/projects/${item.projectId}`).then(r => r.json());
            if (p.duration) dur = ` (${formatDur(p.duration)})`;
          } catch { /* duration is optional */ }
          addLog(`✓ "${t}" done${dur}`);
          setCurrentProjectId(null);
        } else if (st === "failed" && !terminal.has(item.projectId)) {
          terminal.add(item.projectId);
          setResults(prev => ({ ...prev, [item.projectId]: "failed" }));
          addLog(`✗ "${t}" failed${item.error ? ` — ${item.error}` : ""}`);
          setCurrentProjectId(null);
        } else if (st === "cancelled" && !terminal.has(item.projectId)) {
          terminal.add(item.projectId);
          setResults(prev => ({ ...prev, [item.projectId]: "skipped" }));
          addLog(`— "${t}" cancelled`);
          setCurrentProjectId(null);
        }
      }

      // Queue went idle while we still wait on ids that never appeared
      // (e.g. cleared by another client). Mark them rather than hang forever.
      if (!q.running && !q.stopRequested && polled > 5) {
        for (const id of ids) {
          if (!terminal.has(id) && !seen.has(id)) {
            terminal.add(id);
            setResults(prev => ({ ...prev, [id]: stopRef.current ? "skipped" : "failed" }));
            addLog(`${stopRef.current ? "—" : "✗"} "${titleFor(id)}" never entered the queue`);
          }
        }
      }

      if (ids.every(id => terminal.has(id))) break;
    }

    // Timeout safety net.
    if (polled >= MAX_POLLS) {
      for (const id of ids) {
        if (!terminal.has(id)) {
          terminal.add(id);
          setResults(prev => ({ ...prev, [id]: "failed" }));
          addLog(`Timeout waiting for "${titleFor(id)}"`);
        }
      }
    }

    // Keep the queue tidy for the next run.
    try {
      await fetch("/api/batch/clear", { method: "POST" });
    } catch { /* best-effort */ }

    setRunning(false);
    setCurrentProjectId(null);
    addLog("Batch finished");
  };

  const selectedCount = Object.keys(selected).filter(k => selected[k]).length;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      completed: "text-teal-400",
      failed: "text-rose-400",
      processing: "text-amber-400",
      draft: "text-slate-400",
    };
    return (
      <span className={`text-[10px] font-mono uppercase tracking-wider ${map[status] || "text-slate-400"}`}>
        {status}
      </span>
    );
  };

  const resultPill = (r?: BatchResult) => {
    if (r === "completed") return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-teal-500/10 text-teal-400">✓ Done</span>;
    if (r === "failed") return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-500/10 text-rose-400">✗ Failed</span>;
    if (r === "skipped") return <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-slate-700/30 text-slate-400">— Skipped</span>;
    return null;
  };

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ListOrdered className="w-12 h-12 text-slate-600 mb-4" />
        <h2 className="text-xl font-bold text-ink">No projects to batch render</h2>
        <p className="text-sm text-slate-400 mt-1">Create a short first, then come back to render them in bulk.</p>
        <button
          onClick={() => onNavigate("create")}
          className="btn btn-primary btn-lg mt-6"
        >
          Create New Short
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Batch Render</h1>
          <p className="text-sm text-slate-400 mt-1">Render multiple projects sequentially — the server queue runs one ffmpeg at a time.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">Checklist: {selectedCount} / {projects.length}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(Object.fromEntries(projects.map(p => [p.id, true])))}
              disabled={running}
              className="btn btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Select All
            </button>
            <button
              onClick={() => setSelected({})}
              disabled={running}
              className="btn btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Deselect All
            </button>
            {running ? (
              <button
                onClick={() => {
                  stopRef.current = true;
                  addLog("Stop requested — finishing current step...");
                  fetch("/api/batch/stop", { method: "POST" }).catch(() => {});
                }}
                className="btn btn-danger btn-sm"
              >
                <Square className="w-3.5 h-3.5 inline mr-1.5" /> Stop
              </button>
            ) : (
              <button
                onClick={runBatch}
                disabled={selectedCount === 0}
                className="btn btn-primary btn-sm"
              >
                <Play className="w-3.5 h-3.5 inline mr-1.5" /> Start Batch
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Project checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-3">Projects ({projects.length})</p>
        <div className="space-y-2">
          {projects.map(p => {
            const isCurrent = running && currentProjectId === p.id;
            return (
              <div
                key={p.id}
                id={`batch_row_${p.id}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                  isCurrent
                    ? "bg-indigo-500/10 border-indigo-500/30"
                    : results[p.id]
                      ? "bg-slate-800/40 border-slate-800"
                      : "bg-slate-800/30 border-slate-800/60 hover:border-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!selected[p.id]}
                  disabled={running}
                  onChange={e => setSelected(prev => ({ ...prev, [p.id]: e.target.checked }))}
                  className="accent-indigo-500 w-4 h-4 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{p.title}</p>
                  <p className="text-[10px] font-mono text-slate-500 truncate">{p.id}{p.duration ? ` · ${Math.floor(p.duration / 60)}:${String(Math.round(p.duration % 60)).padStart(2, "0")}` : ""}</p>
                </div>
                {isCurrent && (
                  <span className="flex items-center gap-1.5 text-amber-400 text-[10px] font-bold font-mono uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> Rendering
                  </span>
                )}
                {statusBadge(p.status)}
                {resultPill(results[p.id])}
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress log */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-3">Batch Log ({log.length})</p>
        <div
          ref={logBoxRef}
          className="h-56 overflow-y-auto bg-slate-950/60 border border-slate-800/60 rounded-lg p-3 font-mono text-xs leading-relaxed"
        >
          {log.length === 0 ? (
            <p className="text-slate-600">// no runs yet — select projects and hit Start Batch</p>
          ) : (
            log.map((line, i) => {
              const ok = line.includes("✓") || line.includes("done");
              const bad = line.includes("✗") || line.includes("Failed") || line.includes("failed") || line.includes("Timeout") || line.includes("Error") || line.includes("error");
              return (
                <p key={i} className={ok ? "text-teal-400" : bad ? "text-rose-400" : "text-slate-300"}>
                  <span className="text-slate-500">▸</span> {line}
                </p>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
