/**
 * RenderQueue — server-side sequential batch render queue.
 *
 * Guarantees that only ONE ffmpeg render runs at a time, regardless of
 * how many clients trigger renders. Projects are enqueued via
 * POST /api/batch/render, processed one-at-a-time, and their job status
 * is polled until terminal (completed/failed/cancelled).
 *
 * The queue is in-memory: a server restart clears it. Clients that care
 * about cross-restart state already poll project/job status themselves.
 */
import { DB } from "./db";
import { FFmpegService } from "./ffmpeg";

export type QueueItemStatus = "queued" | "rendering" | "completed" | "failed" | "cancelled";

export interface QueueItem {
  projectId: string;
  status: QueueItemStatus;
  error?: string;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface QueueStatus {
  running: boolean;
  stopRequested: boolean;
  items: QueueItem[];
}

const POLL_MS = 1500;
const HARD_CAP_MS = 30 * 60 * 1000; // 30 min per project

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

class RenderQueue {
  private items: QueueItem[] = [];
  private running = false;
  private stopRequested = false;

  /** Add projects to the queue (dedupes against queued/rendering entries). */
  enqueue(projectIds: string[]): QueueStatus {
    const now = new Date().toISOString();
    for (const projectId of projectIds) {
      const dup = this.items.find(
        i => i.projectId === projectId && (i.status === "queued" || i.status === "rendering")
      );
      if (dup) continue;
      this.items.push({ projectId, status: "queued", enqueuedAt: now });
    }
    void this.pump();
    return this.status();
  }

  /** Cancel the current render and mark every queued item as cancelled. */
  stop(): QueueStatus {
    if (!this.running && this.items.every(i => i.status !== "queued")) return this.status();
    this.stopRequested = true;
    const current = this.items.find(i => i.status === "rendering");
    if (current) {
      const job = DB.getJobByProjectId(current.projectId);
      if (job) {
        DB.saveJob({
          ...job,
          cancelRequested: true,
          logOutput: [...(job.logOutput || []), "[QUEUE] Stop requested — finishing current step..."]
        });
      }
    }
    return this.status();
  }

  /** Drop finished entries so the queue list stays readable. */
  clearFinished(): QueueStatus {
    this.items = this.items.filter(i => i.status === "queued" || i.status === "rendering");
    return this.status();
  }

  status(): QueueStatus {
    return {
      running: this.running,
      stopRequested: this.stopRequested,
      items: this.items.map(i => ({ ...i }))
    };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopRequested) {
        const next = this.items.find(i => i.status === "queued");
        if (!next) break;

        // Fail fast on projects that can never render
        const scenes = DB.getScenes(next.projectId);
        if (scenes.length === 0) {
          next.status = "failed";
          next.error = "Cannot render a project with zero scenes";
          next.finishedAt = new Date().toISOString();
          continue;
        }

        next.status = "rendering";
        next.startedAt = new Date().toISOString();
        next.error = undefined;
        const started = Date.now();

        try {
          await FFmpegService.renderProject(next.projectId);
          next.status = await this.waitForTerminal(next.projectId);
        } catch (e: any) {
          next.status = "failed";
          next.error = e.message || "Render failed to start";
        }

        next.finishedAt = new Date().toISOString();
        next.durationMs = Date.now() - started;
      }
    } finally {
      if (this.stopRequested) {
        for (const i of this.items) {
          if (i.status === "queued") {
            i.status = "cancelled";
            i.finishedAt = new Date().toISOString();
          }
        }
        this.stopRequested = false;
      }
      this.running = false;
    }
  }

  private async waitForTerminal(projectId: string): Promise<QueueItemStatus> {
    const deadline = Date.now() + HARD_CAP_MS;
    while (Date.now() < deadline) {
      const job = DB.getJobByProjectId(projectId);
      if (job) {
        if (job.step === "completed") return "completed";
        if (job.step === "failed") return "failed";
        if (job.step === "cancelled") return "cancelled";
      }
      await delay(POLL_MS);
    }
    return "failed";
  }
}

export const renderQueue = new RenderQueue();
