import {
  ArrowRight,
  Cpu,
  Download,
  Film,
  HardDrive,
  Layers,
  MemoryStick,
  Play,
  Scissors,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { formatDuration, formatTimeAgo } from '../lib/api';
import type { JobRecord, MediaAsset, SystemMetrics } from '../types/studio';

interface DashboardViewProps {
  metrics: SystemMetrics | null;
  media: MediaAsset[];
  jobs: JobRecord[];
  generatingSample: boolean;
  onGenerateSample: () => void;
  onNavigate: (tab: string) => void;
  onOpenEditorWithMedia: (mediaId: string) => void;
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'text-emerald-600 dark:text-emerald-400',
  running: 'text-blue-600 dark:text-blue-400',
  queued: 'text-amber-600 dark:text-amber-400',
  paused: 'text-amber-600 dark:text-amber-400',
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-zinc-500 dark:text-zinc-400',
};

export function DashboardView({
  metrics,
  media,
  jobs,
  generatingSample,
  onGenerateSample,
  onNavigate,
  onOpenEditorWithMedia,
}: DashboardViewProps) {
  const videoCount = media.filter((m) => m.kind === 'video' && !m.isExport).length;
  const exportCount = media.filter((m) => m.isExport).length;
  const recentJobs = jobs.slice(0, 6);
  const latestVideo = media.find((m) => m.kind === 'video');

  return (
    <div className="space-y-8">
      {/* Page Intro & Primary Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-6">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Phase 2 Local MVP · Deterministic FFmpeg Engine · No AI Key Required
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Studio Overview
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onGenerateSample}
            disabled={generatingSample}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Film className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {generatingSample ? 'Generating Sample...' : 'Generate 12s Sample Pack'}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('editor')}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Open Video Editor
          </button>
        </div>
      </div>

      {/* Primary Metrics Strip */}
      <section aria-label="Workspace summary" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Source Videos</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
            {videoCount}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {media.length} total files in library
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Active & Queued Jobs</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
            {(metrics?.activeJobs ?? 0) + (metrics?.queuedJobs ?? 0)}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Concurrency limit: <span className="font-mono tabular-nums">{metrics?.concurrency ?? 1}</span>
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Completed Exports</p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
            {exportCount}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {metrics?.completedJobs ?? 0} total finished renders
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">FFmpeg Runtime</p>
          <p className="mt-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
            {metrics?.ffmpegAvailable ? 'Native Ready' : 'Not Detected'}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 truncate" title={metrics?.ffmpegVersion}>
            {metrics?.dockerAvailable ? 'Docker detected (optional)' : 'Zero-Docker local mode'}
          </p>
        </div>
      </section>

      {/* Real-Time Host Resource Monitor */}
      <section
        aria-label="System resource telemetry"
        className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Live Resource Monitor
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Low-resource guardrails keep local video processing responsive on 4–8 GB RAM systems.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {metrics ? `${metrics.cpuCores} vCPU · Node ${metrics.nodeVersion} · RSS ${metrics.processRssMb} MB` : 'Sampling host...'}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* CPU */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <Cpu className="h-3.5 w-3.5 text-zinc-400" />
                CPU Utilization
              </span>
              <span className="font-mono font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                {metrics?.cpuUsagePct ?? 0}%
              </span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.min(100, metrics?.cpuUsagePct ?? 0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {metrics?.cpuCores ?? 2} cores available · Thread cap enforced
            </p>
          </div>

          {/* RAM */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <MemoryStick className="h-3.5 w-3.5 text-zinc-400" />
                Host Memory (RAM)
              </span>
              <span className="font-mono font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                {metrics ? `${metrics.ramUsedMb} / ${metrics.ramTotalMb} MB (${metrics.ramUsagePct}%)` : '—'}
              </span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (metrics?.ramUsagePct ?? 0) > 85
                    ? 'bg-red-600'
                    : (metrics?.ramUsagePct ?? 0) > 70
                      ? 'bg-amber-500'
                      : 'bg-emerald-600 dark:bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, metrics?.ramUsagePct ?? 0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {metrics ? `${metrics.ramFreeMb} MB free · No AI models preloaded` : 'Reading memory...'}
            </p>
          </div>

          {/* Disk */}
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                Disk & Media Storage
              </span>
              <span className="font-mono font-semibold tabular-nums text-zinc-950 dark:text-zinc-100">
                {metrics ? `${metrics.storageUsedMb} MB used` : '—'}
              </span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-zinc-700 dark:bg-zinc-300 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(2, metrics?.diskUsedPct ?? 2))}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
              {metrics ? `${metrics.diskFreeGb} GB free of ${metrics.diskTotalGb} GB volume` : 'Reading storage...'}
            </p>
          </div>
        </div>
      </section>

      {/* Two-Column Action Row: AI-Free Workflows + Recent Jobs */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Quick AI-Free Workflows */}
        <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            AI-Free Core Workflows
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            All deterministic operations run locally with native FFmpeg.
          </p>

          <div className="mt-5 divide-y divide-zinc-200 dark:divide-zinc-800">
            <button
              type="button"
              onClick={() => onNavigate('media')}
              className="w-full py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Import Video, Audio, Logos & SRT
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Disk-streamed upload with instant ffprobe inspection
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => (latestVideo ? onOpenEditorWithMedia(latestVideo.id) : onNavigate('editor'))}
              className="w-full py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <SlidersHorizontal className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    9:16 Vertical Shorts, Trim, Subtitles & Watermark
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Single-pass FFmpeg filtergraph with center crop or blur-pad
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('merge')}
              className="w-full py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Scissors className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Silence Detection Clipper & Multi-Video Merge
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Auto-extract non-silent segments or concatenate clips cleanly
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('architecture')}
              className="w-full py-3.5 flex items-center justify-between text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 -mx-2 px-2 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Layers className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Architecture Blueprint & 10-Phase Roadmap
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                    Inspect Phase 1 plan, AI Provider Hub spec & Cloud deployment
                  </p>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />
            </button>
          </div>
        </section>

        {/* Recent Render Queue */}
        <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6">
          <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Recent Render Jobs
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Persistent SQLite queue with live FFmpeg progress updates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('queue')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              View Full Queue
            </button>
          </div>

          {recentJobs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                No render jobs yet
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                Generate the built-in 12-second sample pack or upload a video, then convert it to 9:16 vertical Shorts or burn SRT subtitles locally.
              </p>
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onGenerateSample}
                  disabled={generatingSample}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                >
                  <Play className="h-3.5 w-3.5" />
                  {generatingSample ? 'Generating...' : 'Generate Sample Pack'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                    <th className="py-2.5 pr-4 font-medium">Job</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium text-right">Progress</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                  {recentJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <td className="py-3 pr-4 max-w-[260px]">
                        <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {job.title}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                          {job.stageMessage} · {formatTimeAgo(job.createdAt)}
                        </p>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span className={`text-xs font-medium capitalize ${STATUS_STYLES[job.status] || ''}`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                        {job.progress}%
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {job.status === 'completed' && job.outputMediaId ? (
                          <a
                            href={`/api/media/${job.outputMediaId}/stream?download=1`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-400">
                            {job.completedAt ? formatDuration(0) : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
