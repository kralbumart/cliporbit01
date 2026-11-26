import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { formatTimeAgo, studioApi } from '../lib/api';
import type { JobRecord, SystemMetrics } from '../types/studio';

interface JobQueueViewProps {
  jobs: JobRecord[];
  metrics: SystemMetrics | null;
  onRefreshJobs: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  running: 'text-blue-600 dark:text-blue-400',
  queued: 'text-amber-600 dark:text-amber-400',
  paused: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-zinc-500 dark:text-zinc-400',
};

export function JobQueueView({
  jobs,
  metrics,
  onRefreshJobs,
  onNavigate,
  onNotify,
}: JobQueueViewProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = jobs.filter((job) => {
    if (filter === 'active') return job.status === 'running' || job.status === 'queued' || job.status === 'paused';
    if (filter === 'completed') return job.status === 'completed';
    if (filter === 'failed') return job.status === 'failed' || job.status === 'cancelled';
    return true;
  });

  async function runAction(jobId: string, action: () => Promise<unknown>, successMsg: string) {
    setBusyId(jobId);
    try {
      await action();
      await onRefreshJobs();
      onNotify(successMsg);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleGlobalQueue() {
    try {
      if (metrics?.queuePaused) {
        await studioApi.resumeQueue();
        onNotify('Worker queue resumed.');
      } else {
        await studioApi.pauseQueue();
        onNotify('Worker queue paused — new queued jobs will wait.');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Queue toggle failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            SQLite-Backed Persistent Queue · Default Concurrency {metrics?.concurrency ?? 1} · Live SSE Updates
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Job Queue
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void toggleGlobalQueue()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
          >
            {metrics?.queuePaused ? (
              <>
                <Play className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Resume Queue
              </>
            ) : (
              <>
                <Pause className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                Pause Queue
              </>
            )}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1">
          {(
            [
              ['all', `All (${jobs.length})`],
              [
                'active',
                `Active (${jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused').length})`,
              ],
              ['completed', `Completed (${jobs.filter((j) => j.status === 'completed').length})`],
              ['failed', `Failed / Cancelled (${jobs.filter((j) => j.status === 'failed' || j.status === 'cancelled').length})`],
            ] as Array<[StatusFilter, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filter === key
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
          {metrics?.queuePaused ? 'Queue State: Paused' : 'Queue State: Accepting Jobs'} · Active:{' '}
          {metrics?.activeJobs ?? 0}/{metrics?.concurrency ?? 1}
        </p>
      </div>

      {/* Job List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] py-16 px-6 text-center">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No jobs in this view
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Queue a video edit, vertical conversion, merge, or audio extraction to watch live FFmpeg rendering progress here.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('editor')}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Open Video Editor
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] divide-y divide-zinc-200 dark:divide-zinc-800">
          {filtered.map((job) => {
            const isExpanded = expandedId === job.id;
            const disabled = busyId === job.id;

            return (
              <div key={job.id} className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 truncate">
                        {job.title}
                      </h3>
                      <span aria-hidden="true" className="text-zinc-400">
                        ·
                      </span>
                      <span className={`text-xs font-semibold capitalize ${STATUS_COLOR[job.status] || ''}`}>
                        {job.status}
                      </span>
                      <span aria-hidden="true" className="text-zinc-400">
                        ·
                      </span>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                        Attempt {job.attempts}
                      </span>
                      <span aria-hidden="true" className="text-zinc-400">
                        ·
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {formatTimeAgo(job.createdAt)}
                      </span>
                    </div>

                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{job.stageMessage}</p>

                    {job.errorMessage && (
                      <p className="mt-1.5 text-xs text-red-600 dark:text-red-400 font-mono break-all">
                        {job.errorMessage}
                      </p>
                    )}

                    {/* Progress Bar */}
                    <div className="mt-3 flex items-center gap-3 max-w-xl">
                      <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-200 ${
                            job.status === 'failed'
                              ? 'bg-red-600'
                              : job.status === 'completed'
                                ? 'bg-emerald-600 dark:bg-emerald-500'
                                : job.status === 'paused'
                                  ? 'bg-amber-500'
                                  : 'bg-blue-600 dark:bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300 w-10 text-right">
                        {job.progress}%
                      </span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {(job.status === 'running' || job.status === 'queued') && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void runAction(job.id, () => studioApi.pauseJob(job.id), 'Job paused.')}
                        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </button>
                    )}

                    {job.status === 'paused' && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void runAction(job.id, () => studioApi.resumeJob(job.id), 'Job resumed.')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )}

                    {(job.status === 'running' || job.status === 'queued' || job.status === 'paused') && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void runAction(job.id, () => studioApi.cancelJob(job.id), 'Job cancelled and temp files cleaned.')}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                    )}

                    {(job.status === 'failed' || job.status === 'cancelled') && (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void runAction(job.id, () => studioApi.retryJob(job.id), 'Job re-queued for retry.')}
                        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    )}

                    {job.status === 'completed' && job.outputMediaId && (
                      <a
                        href={`/api/media/${job.outputMediaId}/stream?download=1`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </a>
                    )}

                    {job.ffmpegArgsPreview && (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : job.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        FFmpeg
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void runAction(job.id, () => studioApi.deleteJob(job.id), 'Job removed from history.')}
                      aria-label="Delete job record"
                      className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Expandable FFmpeg Command Inspector */}
                {isExpanded && job.ffmpegArgsPreview && (
                  <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                      Executed Deterministic FFmpeg Command
                    </p>
                    <pre className="rounded-lg bg-zinc-950 text-zinc-200 p-3 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      {job.ffmpegArgsPreview}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
