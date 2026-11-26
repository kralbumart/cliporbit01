import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Combine,
  Film,
  Play,
  Plus,
  Scissors,
  Trash2,
} from 'lucide-react';
import { formatDuration, studioApi } from '../lib/api';
import type {
  AspectRatioMode,
  MediaAsset,
  ResolutionPreset,
  SilenceSegment,
  VerticalFitMode,
  WorkerSettings,
} from '../types/studio';

interface MergeAndClipViewProps {
  media: MediaAsset[];
  settings: WorkerSettings | null;
  generatingSample: boolean;
  onGenerateSample: () => void;
  onJobQueued: () => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function MergeAndClipView({
  media,
  settings,
  generatingSample,
  onGenerateSample,
  onJobQueued,
  onNotify,
}: MergeAndClipViewProps) {
  const videos = media.filter((m) => m.kind === 'video');
  const [mode, setMode] = useState<'clipper' | 'merge'>('clipper');

  // --- AI-Free Silence Clipper State ---
  const [clipVideoId, setClipVideoId] = useState<string>(videos[0]?.id || '');
  const [noiseDb, setNoiseDb] = useState(-30);
  const [minSilenceSec, setMinSilenceSec] = useState(0.8);
  const [analyzing, setAnalyzing] = useState(false);
  const [segments, setSegments] = useState<Array<SilenceSegment & { selected: boolean; label: string }>>([]);
  const [clipAspect, setClipAspect] = useState<AspectRatioMode>('9:16');
  const [clipFit, setClipFit] = useState<VerticalFitMode>('blur_pad');
  const [clipResolution, setClipResolution] = useState<ResolutionPreset>('720p');
  const [exportingClips, setExportingClips] = useState(false);

  // --- Multi-Video Merger State ---
  const [mergeList, setMergeList] = useState<string[]>([]);
  const [mergeOutputName, setMergeOutputName] = useState('merged_compilation');
  const [mergeAspect, setMergeAspect] = useState<AspectRatioMode>('16:9');
  const [mergeResolution, setMergeResolution] = useState<ResolutionPreset>('720p');
  const [merging, setMerging] = useState(false);

  const selectedClipVideo = videos.find((v) => v.id === clipVideoId) || videos[0] || null;

  async function runSilenceDetection() {
    if (!selectedClipVideo) return;
    setAnalyzing(true);
    try {
      const res = await studioApi.detectSilences(selectedClipVideo.id, noiseDb, minSilenceSec);
      const base = selectedClipVideo.originalName.replace(/\.[^.]+$/, '');
      setSegments(
        res.segments.map((seg) => ({
          ...seg,
          selected: true,
          label: `${base}_clip_${seg.index}`,
        })),
      );
      onNotify(`Detected ${res.segments.length} active non-silent segment${res.segments.length === 1 ? '' : 's'} using FFmpeg.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Silence detection failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function queueSelectedClips() {
    if (!selectedClipVideo) return;
    const chosen = segments.filter((s) => s.selected);
    if (chosen.length === 0) {
      onNotify('Select at least one clip segment to export.', 'error');
      return;
    }
    setExportingClips(true);
    try {
      const res = await studioApi.createBatchClipJobs({
        mediaId: selectedClipVideo.id,
        aspectRatio: clipAspect,
        fitMode: clipFit,
        resolution: clipResolution,
        segments: chosen.map((c) => ({
          startSec: c.startSec,
          endSec: c.endSec,
          label: c.label,
        })),
      });
      onNotify(`Queued ${res.jobs.length} clip export job${res.jobs.length > 1 ? 's' : ''} (processing 1 at a time).`);
      onJobQueued();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Batch clip export failed', 'error');
    } finally {
      setExportingClips(false);
    }
  }

  function moveMergeItem(index: number, direction: -1 | 1) {
    const next = [...mergeList];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setMergeList(next);
  }

  async function queueMerge() {
    if (mergeList.length < 2) {
      onNotify('Add at least 2 videos to the sequence to merge.', 'error');
      return;
    }
    setMerging(true);
    try {
      await studioApi.createMergeJob({
        mediaIds: mergeList,
        outputName: mergeOutputName.trim() || 'merged_video',
        aspectRatio: mergeAspect,
        resolution: mergeResolution,
        crf: 23,
        preset: settings?.defaultPreset || 'veryfast',
      });
      onNotify(`Queued merge job for ${mergeList.length} videos.`);
      onJobQueued();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Merge failed', 'error');
    } finally {
      setMerging(false);
    }
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] py-20 px-6 text-center">
        <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50">
          AutoClip Silence Splitter & Video Merger
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          Generate the 12-second sample video (built with two audio phrases separated by a quiet pause) or upload your own videos to test AI-free silence clipping and merging.
        </p>
        <button
          type="button"
          onClick={onGenerateSample}
          disabled={generatingSample}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Film className="h-4 w-4" />
          {generatingSample ? 'Generating...' : 'Generate Sample Pack'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Mode Switch */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Deterministic Batch Operations · FFmpeg silencedetect & Normalized Concat
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Clipper & Video Merger
          </h1>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setMode('clipper')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'clipper'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Scissors className="h-3.5 w-3.5" />
            AI-Free Silence Clipper
          </button>
          <button
            type="button"
            onClick={() => setMode('merge')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              mode === 'merge'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Combine className="h-3.5 w-3.5" />
            Multi-Video Merger
          </button>
        </div>
      </div>

      {mode === 'clipper' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Controls */}
          <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                1. Analyze Audio Track for Active Segments
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Uses native FFmpeg <code className="font-mono">silencedetect</code> to split long recordings into clips without loading an AI model.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Source Video
              </label>
              <select
                value={selectedClipVideo?.id || ''}
                onChange={(e) => {
                  setClipVideoId(e.target.value);
                  setSegments([]);
                }}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              >
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.originalName} ({formatDuration(v.durationSec)})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label className="font-medium text-zinc-700 dark:text-zinc-300">Silence Threshold</label>
                  <span className="font-mono tabular-nums">{noiseDb} dB</span>
                </div>
                <input
                  type="range"
                  min={-50}
                  max={-15}
                  value={noiseDb}
                  onChange={(e) => setNoiseDb(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <label className="font-medium text-zinc-700 dark:text-zinc-300">Min Pause</label>
                  <span className="font-mono tabular-nums">{minSilenceSec.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={3.0}
                  step={0.1}
                  value={minSilenceSec}
                  onChange={(e) => setMinSilenceSec(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => void runSilenceDetection()}
              disabled={analyzing || !selectedClipVideo}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Scissors className="h-4 w-4" />
              {analyzing ? 'Scanning Audio with FFmpeg...' : 'Detect Active Clips'}
            </button>

            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
              <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                2. Batch Clip Export Format
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label="Clip aspect ratio"
                  value={clipAspect}
                  onChange={(e) => setClipAspect(e.target.value as AspectRatioMode)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="9:16">9:16 Shorts</option>
                  <option value="16:9">16:9 Wide</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="original">Original</option>
                </select>
                <select
                  aria-label="Clip fit mode"
                  value={clipFit}
                  onChange={(e) => setClipFit(e.target.value as VerticalFitMode)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="blur_pad">Blur Pad</option>
                  <option value="crop">Center Crop</option>
                </select>
                <select
                  aria-label="Clip resolution"
                  value={clipResolution}
                  onChange={(e) => setClipResolution(e.target.value as ResolutionPreset)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="480p">480p</option>
                </select>
              </div>
            </div>
          </section>

          {/* Discovered Segments */}
          <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Detected Clip Segments ({segments.length})
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Review, adjust start/end times, and queue selected clips for sequential export.
                </p>
              </div>
              {segments.length > 0 && (
                <button
                  type="button"
                  disabled={exportingClips}
                  onClick={() => void queueSelectedClips()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  {exportingClips
                    ? 'Queuing...'
                    : `Queue ${segments.filter((s) => s.selected).length} Clip${segments.filter((s) => s.selected).length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>

            {segments.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Run silence detection to discover clip boundaries
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
                  The built-in 12s sample video includes a 2.6-second silence gap between two segments so you can verify multi-clip splitting immediately.
                </p>
              </div>
            ) : (
              <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {segments.map((seg, idx) => (
                  <div key={seg.index} className="py-3 flex flex-wrap items-center gap-3">
                    <input
                      type="checkbox"
                      checked={seg.selected}
                      onChange={(e) => {
                        const next = [...segments];
                        next[idx] = { ...seg, selected: e.target.checked };
                        setSegments(next);
                      }}
                      className="h-4 w-4 rounded accent-blue-600"
                    />
                    <input
                      type="text"
                      value={seg.label}
                      onChange={(e) => {
                        const next = [...segments];
                        next[idx] = { ...seg, label: e.target.value };
                        setSegments(next);
                      }}
                      className="flex-1 min-w-[160px] rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
                    />
                    <div className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        value={seg.startSec}
                        onChange={(e) => {
                          const start = Math.max(0, Number(e.target.value) || 0);
                          const next = [...segments];
                          next[idx] = {
                            ...seg,
                            startSec: start,
                            durationSec: Number(Math.max(0.2, seg.endSec - start).toFixed(2)),
                          };
                          setSegments(next);
                        }}
                        className="w-16 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1 text-right"
                      />
                      <span className="text-zinc-400">→</span>
                      <input
                        type="number"
                        step={0.1}
                        min={seg.startSec + 0.2}
                        value={seg.endSec}
                        onChange={(e) => {
                          const end = Math.max(seg.startSec + 0.2, Number(e.target.value) || seg.endSec);
                          const next = [...segments];
                          next[idx] = {
                            ...seg,
                            endSec: end,
                            durationSec: Number(Math.max(0.2, end - seg.startSec).toFixed(2)),
                          };
                          setSegments(next);
                        }}
                        className="w-16 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1 text-right"
                      />
                      <span className="text-zinc-500 dark:text-zinc-400 w-12 text-right">
                        ({seg.durationSec.toFixed(1)}s)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* Multi-Video Merger */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Available Library Videos */}
          <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Available Library Videos
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Click to append clips into the merge timeline (even mixed resolutions or silent videos are normalized automatically).
            </p>
            <div className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[420px] overflow-y-auto">
              {videos.map((v) => (
                <div key={v.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {v.originalName}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      {v.width}×{v.height} · {formatDuration(v.durationSec)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMergeList((prev) => [...prev, v.id])}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Merge Sequence */}
          <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                  Merge Sequence ({mergeList.length} clip{mergeList.length === 1 ? '' : 's'})
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Arrange order and choose unified export dimensions.
                </p>
              </div>
              <button
                type="button"
                disabled={merging || mergeList.length < 2}
                onClick={() => void queueMerge()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Combine className="h-3.5 w-3.5" />
                {merging ? 'Queuing...' : 'Queue Merge Render'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                value={mergeOutputName}
                onChange={(e) => setMergeOutputName(e.target.value)}
                placeholder="merged_output"
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
              />
              <select
                aria-label="Merged aspect ratio"
                value={mergeAspect}
                onChange={(e) => setMergeAspect(e.target.value as AspectRatioMode)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
              >
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Vertical Shorts</option>
                <option value="1:1">1:1 Square</option>
              </select>
              <select
                aria-label="Merged resolution"
                value={mergeResolution}
                onChange={(e) => setMergeResolution(e.target.value as ResolutionPreset)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
              >
                <option value="720p">720p HD</option>
                <option value="1080p">1080p Full HD</option>
                <option value="480p">480p Fast</option>
              </select>
            </div>

            {mergeList.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Add at least 2 videos from the left list (you can even add the same video twice to test concatenation).
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {mergeList.map((id, idx) => {
                  const v = videos.find((item) => item.id === id);
                  return (
                    <div key={`${id}-${idx}`} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs tabular-nums text-zinc-400 w-5">
                          {idx + 1}.
                        </span>
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {v?.originalName || id}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                          {formatDuration(v?.durationSec)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => moveMergeItem(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Move clip up"
                          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMergeItem(idx, 1)}
                          disabled={idx === mergeList.length - 1}
                          aria-label="Move clip down"
                          className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setMergeList((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label="Remove clip from merge"
                          className="p-1 rounded text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
