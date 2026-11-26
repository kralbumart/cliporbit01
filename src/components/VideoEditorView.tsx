import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  Eye,
  FileAudio,
  Film,
  Image as ImageIcon,
  Layers,
  Play,
  Redo2,
  Save,
  Scissors,
  SplitSquareVertical,
  Subtitles,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { downloadTextFile, formatBytes, formatDuration, studioApi } from '../lib/api';
import type {
  AspectRatioMode,
  AudioMode,
  BrandTemplate,
  CaptionStylePreset,
  CropRegion,
  EditPipelineConfig,
  FfmpegSpeedPreset,
  LogoCorner,
  MediaAsset,
  ResolutionPreset,
  SubtitlePosition,
  TimelineSegment,
  VerticalFitMode,
  ViralClipRecord,
  WorkerSettings,
} from '../types/studio';

interface VideoEditorViewProps {
  media: MediaAsset[];
  settings: WorkerSettings | null;
  templates: BrandTemplate[];
  initialMediaId: string | null;
  initialClip?: ViralClipRecord | null;
  generatingSample: boolean;
  onGenerateSample: () => void;
  onRefreshTemplates: () => Promise<void>;
  onJobQueued: () => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

type EditorTab = 'frame' | 'timeline' | 'subtitles' | 'logo' | 'audio';

interface EditorStateSnapshot {
  outputName: string;
  trimEnabled: boolean;
  startSec: number;
  endSec: number;
  segments: TimelineSegment[];
  aspectRatio: AspectRatioMode;
  fitMode: VerticalFitMode;
  facecamBox: CropRegion;
  gameplayBox: CropRegion;
  resolution: ResolutionPreset;
  crf: number;
  preset: FfmpegSpeedPreset;
  subtitleEnabled: boolean;
  subtitleMediaId: string;
  subtitleInlineSrt: string;
  subtitlePosition: SubtitlePosition;
  subtitleFontSize: number;
  captionStyle: CaptionStylePreset;
  captionColor: string;
  captionOutlineColor: string;
  wordsPerLine: number;
  logoEnabled: boolean;
  logoMediaId: string;
  logoCorner: LogoCorner;
  logoScalePct: number;
  logoOpacity: number;
  logoMarginX: number;
  logoMarginY: number;
  fadeInSec: number;
  fadeOutSec: number;
  introMediaId: string;
  outroMediaId: string;
  brandColor: string;
  audioMode: AudioMode;
  musicMediaId: string;
  musicVolume: number;
}

const DEFAULT_FACECAM_BOX: CropRegion = { xPct: 70, yPct: 5, wPct: 28, hPct: 35 };
const DEFAULT_GAMEPLAY_BOX: CropRegion = { xPct: 10, yPct: 10, wPct: 80, hPct: 80 };

const DEFAULT_SAMPLE_SRT = `1
00:00:00,400 --> 00:00:03,800
OpenVideo Studio runs locally with native FFmpeg

2
00:00:04,000 --> 00:00:07,800
Edit captions, split facecam, and apply brand templates

3
00:00:08,000 --> 00:00:11,500
Export crisp 9:16 vertical Shorts on 8 GB RAM`;

function rewrapSrtByWordsPerLine(srt: string, maxWords: number): string {
  const limit = Math.max(1, Math.min(12, Math.round(maxWords)));
  const blocks = srt.trim().split(/\r?\n\r?\n+/);
  return blocks
    .map((block) => {
      const lines = block.split(/\r?\n/);
      if (lines.length < 3) return block;
      const header = lines.slice(0, 2);
      const bodyWords = lines
        .slice(2)
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (bodyWords.length <= limit) return [...header, bodyWords.join(' ')].join('\n');
      const wrapped: string[] = [];
      for (let i = 0; i < bodyWords.length; i += limit) {
        wrapped.push(bodyWords.slice(i, i + limit).join(' '));
      }
      return [...header, ...wrapped].join('\n');
    })
    .join('\n\n');
}

export function VideoEditorView({
  media,
  settings,
  templates,
  initialMediaId,
  initialClip = null,
  generatingSample,
  onGenerateSample,
  onRefreshTemplates,
  onJobQueued,
  onNotify,
}: VideoEditorViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videos = media.filter((m) => m.kind === 'video');
  const logos = media.filter((m) => m.kind === 'image');
  const subtitles = media.filter((m) => m.kind === 'subtitle');
  const audioTracks = media.filter((m) => m.kind === 'audio');

  const [selectedVideoId, setSelectedVideoId] = useState<string>(
    initialClip?.mediaId || initialMediaId || videos[0]?.id || '',
  );
  const [loadedClipId, setLoadedClipId] = useState<string | null>(initialClip?.id || null);
  const [activeTab, setActiveTab] = useState<EditorTab>('frame');
  const [showSafeAreas, setShowSafeAreas] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [extractingAudio, setExtractingAudio] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) || videos[0] || null;
  const maxDuration = Math.max(1, Number((selectedVideo?.durationSec || 12).toFixed(1)));

  const buildInitialState = useCallback(
    (video: MediaAsset | null): EditorStateSnapshot => {
      const dur = Math.max(1, Number((video?.durationSec || 12).toFixed(1)));
      return {
        outputName: video ? `${video.originalName.replace(/\.[^.]+$/, '')}_short` : 'clip_export',
        trimEnabled: false,
        startSec: 0,
        endSec: dur,
        segments: [{ id: 'seg_1', label: 'Segment 1', startSec: 0, endSec: dur }],
        aspectRatio: '9:16',
        fitMode: 'blur_pad',
        facecamBox: { ...DEFAULT_FACECAM_BOX },
        gameplayBox: { ...DEFAULT_GAMEPLAY_BOX },
        resolution: '720p',
        crf: 23,
        preset: settings?.defaultPreset || 'veryfast',
        subtitleEnabled: false,
        subtitleMediaId: '',
        subtitleInlineSrt: '',
        subtitlePosition: 'bottom',
        subtitleFontSize: 22,
        captionStyle: 'classic_bold',
        captionColor: '#FFFFFF',
        captionOutlineColor: '#000000',
        wordsPerLine: 4,
        logoEnabled: false,
        logoMediaId: logos[0]?.id || '',
        logoCorner: 'top-right',
        logoScalePct: 18,
        logoOpacity: 0.85,
        logoMarginX: 24,
        logoMarginY: 24,
        fadeInSec: 0,
        fadeOutSec: 0,
        introMediaId: '',
        outroMediaId: '',
        brandColor: '#2563EB',
        audioMode: 'keep',
        musicMediaId: audioTracks[0]?.id || '',
        musicVolume: 0.35,
      };
    },
    [audioTracks, logos, settings?.defaultPreset],
  );

  // Undo/Redo state management
  const [state, setState] = useState<EditorStateSnapshot>(() => buildInitialState(selectedVideo));
  const [past, setPast] = useState<EditorStateSnapshot[]>([]);
  const [future, setFuture] = useState<EditorStateSnapshot[]>([]);
  const [extractFormat, setExtractFormat] = useState<'mp3' | 'wav'>('mp3');

  const commitChange = useCallback(
    (updater: (prev: EditorStateSnapshot) => EditorStateSnapshot) => {
      setState((prev) => {
        const next = updater(prev);
        setPast((history) => [...history.slice(-29), prev]);
        setFuture([]);
        return next;
      });
    },
    [],
  );

  const patchState = useCallback(
    (patch: Partial<EditorStateSnapshot>) => {
      commitChange((prev) => ({ ...prev, ...patch }));
    },
    [commitChange],
  );

  const handleUndo = useCallback(() => {
    setPast((history) => {
      if (history.length === 0) return history;
      const previous = history[history.length - 1];
      setState((curr) => {
        setFuture((f) => [curr, ...f.slice(0, 29)]);
        return previous;
      });
      return history.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setFuture((nextList) => {
      if (nextList.length === 0) return nextList;
      const next = nextList[0];
      setState((curr) => {
        setPast((p) => [...p.slice(-29), curr]);
        return next;
      });
      return nextList.slice(1);
    });
  }, []);

  // Keyboard shortcuts for Undo / Redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  // Sync external initialMediaId
  useEffect(() => {
    if (initialClip && videos.some((v) => v.id === initialClip.mediaId)) {
      setSelectedVideoId(initialClip.mediaId);
      setLoadedClipId(initialClip.id);
      const start = Math.max(0, Number(initialClip.startSec.toFixed(1)));
      const end = Math.max(start + 0.5, Number(initialClip.endSec.toFixed(1)));
      setState((prev) => ({
        ...prev,
        outputName: initialClip.title.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48) || 'viral_clip',
        trimEnabled: true,
        startSec: start,
        endSec: end,
        segments: [{ id: 'seg_clip', label: initialClip.title.slice(0, 28), startSec: start, endSec: end }],
        subtitleEnabled: Boolean(initialClip.srtContent?.trim()),
        subtitleInlineSrt: initialClip.srtContent || prev.subtitleInlineSrt,
      }));
      setPast([]);
      setFuture([]);
    } else if (initialMediaId && videos.some((v) => v.id === initialMediaId)) {
      setSelectedVideoId(initialMediaId);
      setLoadedClipId(null);
    } else if (!selectedVideoId && videos.length > 0) {
      setSelectedVideoId(videos[0].id);
    }
  }, [initialClip, initialMediaId, videos.length]);

  // Reset range when switching source video manually (unless hydrated by a matching clip)
  const prevVideoRef = useRef<string | null>(selectedVideo?.id || null);
  useEffect(() => {
    if (!selectedVideo) return;
    if (prevVideoRef.current && prevVideoRef.current !== selectedVideo.id) {
      const dur = Math.max(1, Number((selectedVideo.durationSec || 12).toFixed(1)));
      if (!initialClip || initialClip.mediaId !== selectedVideo.id) {
        setLoadedClipId(null);
        setState((prev) => ({
          ...prev,
          outputName: `${selectedVideo.originalName.replace(/\.[^.]+$/, '')}_short`,
          trimEnabled: false,
          startSec: 0,
          endSec: dur,
          segments: [{ id: 'seg_1', label: 'Segment 1', startSec: 0, endSec: dur }],
        }));
      }
    }
    prevVideoRef.current = selectedVideo.id;
  }, [selectedVideo?.id, initialClip]);

  async function handleSelectSubtitleFile(id: string) {
    patchState({ subtitleMediaId: id });
    if (!id) return;
    try {
      const res = await studioApi.getSubtitleContent(id);
      patchState({
        subtitleMediaId: id,
        subtitleInlineSrt: res.content,
        subtitleEnabled: true,
      });
    } catch {
      onNotify('Could not read subtitle file content.', 'error');
    }
  }

  function setFromPlayhead(bound: 'start' | 'end') {
    const t = Number((videoRef.current?.currentTime || playheadSec || 0).toFixed(1));
    commitChange((prev) => {
      const nextStart = bound === 'start' ? Math.min(t, Math.max(0, prev.endSec - 0.5)) : prev.startSec;
      const nextEnd = bound === 'end' ? Math.max(t, Math.min(maxDuration, prev.startSec + 0.5)) : prev.endSec;
      const updatedSegments =
        prev.segments.length === 1
          ? [{ ...prev.segments[0], startSec: nextStart, endSec: nextEnd }]
          : prev.segments;
      return {
        ...prev,
        trimEnabled: true,
        startSec: nextStart,
        endSec: nextEnd,
        segments: updatedSegments,
      };
    });
  }

  function handleSplitAtPlayhead() {
    const t = Number((videoRef.current?.currentTime || playheadSec || maxDuration / 2).toFixed(1));
    commitChange((prev) => {
      const idx = prev.segments.findIndex((s) => t > s.startSec + 0.4 && t < s.endSec - 0.4);
      if (idx === -1) {
        onNotify('Move the video playhead inside an active segment (at least 0.4s from its edges) to split.', 'error');
        return prev;
      }
      const target = prev.segments[idx];
      const left: TimelineSegment = {
        id: `${target.id}_a_${Date.now().toString().slice(-3)}`,
        label: `${target.label} (A)`,
        startSec: target.startSec,
        endSec: t,
      };
      const right: TimelineSegment = {
        id: `${target.id}_b_${Date.now().toString().slice(-3)}`,
        label: `${target.label} (B)`,
        startSec: t,
        endSec: target.endSec,
      };
      const nextSegs = [...prev.segments];
      nextSegs.splice(idx, 1, left, right);
      return { ...prev, trimEnabled: true, segments: nextSegs };
    });
  }

  function handleDuplicateSegment(index: number) {
    commitChange((prev) => {
      const seg = prev.segments[index];
      if (!seg) return prev;
      const copy: TimelineSegment = {
        ...seg,
        id: `seg_copy_${Date.now().toString().slice(-4)}`,
        label: `${seg.label} copy`,
      };
      const next = [...prev.segments];
      next.splice(index + 1, 0, copy);
      return { ...prev, trimEnabled: true, segments: next };
    });
  }

  function handleMoveSegment(index: number, dir: -1 | 1) {
    commitChange((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.segments.length) return prev;
      const next = [...prev.segments];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, segments: next };
    });
  }

  function handleDeleteSegment(index: number) {
    commitChange((prev) => {
      if (prev.segments.length <= 1) {
        onNotify('At least one timeline segment must remain.', 'error');
        return prev;
      }
      return { ...prev, segments: prev.segments.filter((_, i) => i !== index) };
    });
  }

  function handleUpdateSegmentBounds(index: number, field: 'startSec' | 'endSec', value: number) {
    commitChange((prev) => {
      const next = prev.segments.map((seg, i) => {
        if (i !== index) return seg;
        if (field === 'startSec') {
          return { ...seg, startSec: Math.max(0, Math.min(value, seg.endSec - 0.3)) };
        }
        return { ...seg, endSec: Math.min(maxDuration, Math.max(value, seg.startSec + 0.3)) };
      });
      return {
        ...prev,
        trimEnabled: true,
        startSec: next[0]?.startSec ?? prev.startSec,
        endSec: next[0]?.endSec ?? prev.endSec,
        segments: next,
      };
    });
  }

  function handleApplyTemplate(id: string) {
    setSelectedTemplateId(id);
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    patchState({
      aspectRatio: tpl.aspectRatio,
      fitMode: tpl.fitMode,
      facecamBox: { ...tpl.facecamBox },
      gameplayBox: { ...tpl.gameplayBox },
      captionStyle: tpl.captionStyle,
      captionColor: tpl.captionColor,
      captionOutlineColor: tpl.captionOutlineColor,
      subtitleFontSize: tpl.captionFontSize,
      subtitlePosition: tpl.captionPosition,
      wordsPerLine: tpl.wordsPerLine,
      logoEnabled: Boolean(tpl.logoMediaId),
      logoMediaId: tpl.logoMediaId || state.logoMediaId,
      logoCorner: tpl.logoCorner,
      logoScalePct: tpl.logoScalePct,
      logoOpacity: tpl.logoOpacity,
      logoMarginX: tpl.logoMarginX,
      logoMarginY: tpl.logoMarginY,
      introMediaId: tpl.introMediaId || '',
      outroMediaId: tpl.outroMediaId || '',
      fadeInSec: tpl.fadeInSec,
      fadeOutSec: tpl.fadeOutSec,
      brandColor: tpl.brandColor,
    });
    onNotify(`Applied template "${tpl.name}".`);
  }

  async function handleSaveTemplate() {
    const cleanName = templateName.trim() || `Brand Preset ${templates.length + 1}`;
    setSavingTemplate(true);
    try {
      const saved = await studioApi.saveTemplate({
        name: cleanName,
        aspectRatio: state.aspectRatio,
        fitMode: state.fitMode,
        facecamBox: state.facecamBox,
        gameplayBox: state.gameplayBox,
        captionStyle: state.captionStyle,
        captionColor: state.captionColor,
        captionOutlineColor: state.captionOutlineColor,
        captionFontSize: state.subtitleFontSize,
        captionPosition: state.subtitlePosition,
        wordsPerLine: state.wordsPerLine,
        logoMediaId: state.logoEnabled && state.logoMediaId ? state.logoMediaId : null,
        logoCorner: state.logoCorner,
        logoScalePct: state.logoScalePct,
        logoOpacity: state.logoOpacity,
        logoMarginX: state.logoMarginX,
        logoMarginY: state.logoMarginY,
        introMediaId: state.introMediaId || null,
        outroMediaId: state.outroMediaId || null,
        fadeInSec: state.fadeInSec,
        fadeOutSec: state.fadeOutSec,
        brandColor: state.brandColor,
      });
      await onRefreshTemplates();
      setSelectedTemplateId(saved.id);
      setTemplateName('');
      onNotify(`Saved brand template "${saved.name}".`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save template', 'error');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    try {
      await studioApi.deleteTemplate(id);
      await onRefreshTemplates();
      if (selectedTemplateId === id) setSelectedTemplateId('');
      onNotify('Brand template deleted.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleQueueRender() {
    if (!selectedVideo) return;
    setSubmitting(true);
    try {
      const multiSegmentActive = state.segments.length > 1;
      const payload: EditPipelineConfig = {
        mediaId: selectedVideo.id,
        clipId: loadedClipId,
        outputName: state.outputName.trim() || undefined,
        trimEnabled: state.trimEnabled,
        startSec: state.segments[0]?.startSec ?? state.startSec,
        endSec: state.segments[0]?.endSec ?? state.endSec,
        segments: multiSegmentActive ? state.segments : undefined,
        aspectRatio: state.aspectRatio,
        fitMode: state.fitMode,
        facecamBox: state.fitMode === 'split_facecam' ? state.facecamBox : undefined,
        gameplayBox: state.fitMode === 'split_facecam' ? state.gameplayBox : undefined,
        resolution: state.resolution,
        crf: state.crf,
        preset: state.preset,
        subtitleEnabled: state.subtitleEnabled,
        subtitleMediaId: state.subtitleMediaId || null,
        subtitleInlineSrt: state.subtitleEnabled ? state.subtitleInlineSrt : '',
        subtitlePosition: state.subtitlePosition,
        subtitleFontSize: state.subtitleFontSize,
        captionStyle: state.captionStyle,
        captionColor: state.captionColor,
        captionOutlineColor: state.captionOutlineColor,
        wordsPerLine: state.wordsPerLine,
        logoEnabled: state.logoEnabled && Boolean(state.logoMediaId),
        logoMediaId: state.logoEnabled ? state.logoMediaId || null : null,
        logoCorner: state.logoCorner,
        logoScalePct: state.logoScalePct,
        logoOpacity: state.logoOpacity,
        logoMarginX: state.logoMarginX,
        logoMarginY: state.logoMarginY,
        fadeInSec: state.fadeInSec,
        fadeOutSec: state.fadeOutSec,
        introMediaId: state.introMediaId || null,
        outroMediaId: state.outroMediaId || null,
        audioMode: state.audioMode,
        musicMediaId:
          state.audioMode === 'mix_music' || state.audioMode === 'replace_music'
            ? state.musicMediaId || null
            : null,
        musicVolume: state.musicVolume,
      };
      await studioApi.createEditJob(payload);
      onNotify('Render job queued for local FFmpeg worker.');
      onJobQueued();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to queue render job', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtractAudio() {
    if (!selectedVideo) return;
    setExtractingAudio(true);
    try {
      await studioApi.createExtractAudioJob({
        mediaId: selectedVideo.id,
        outputName: `${selectedVideo.originalName.replace(/\.[^.]+$/, '')}_audio`,
        format: extractFormat,
        bitrateKbps: 192,
      });
      onNotify(`Queued ${extractFormat.toUpperCase()} audio extraction.`);
      onJobQueued();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Audio extraction failed', 'error');
    } finally {
      setExtractingAudio(false);
    }
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] py-20 px-6 text-center">
        <h1 className="text-xl font-bold text-zinc-950 dark:text-zinc-50">
          Clip Editor — No Source Video Yet
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          Upload a video in Media Library, paste a link in Viral Clipper, or generate our 12-second 720p FFmpeg sample pack to edit right now.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onGenerateSample}
            disabled={generatingSample}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Film className="h-4 w-4" />
            {generatingSample ? 'Generating Sample Pack...' : 'Generate 12s Sample Pack'}
          </button>
        </div>
      </div>
    );
  }

  const logoStyle: React.CSSProperties = {
    width: `${state.logoScalePct}%`,
    opacity: state.logoOpacity,
    ...(state.logoCorner === 'top-left'
      ? { top: `${Math.min(48, Math.round(state.logoMarginY / 2))}px`, left: `${Math.min(48, Math.round(state.logoMarginX / 2))}px` }
      : state.logoCorner === 'top-right'
        ? { top: `${Math.min(48, Math.round(state.logoMarginY / 2))}px`, right: `${Math.min(48, Math.round(state.logoMarginX / 2))}px` }
        : state.logoCorner === 'bottom-left'
          ? { bottom: `${Math.min(48, Math.round(state.logoMarginY / 2))}px`, left: `${Math.min(48, Math.round(state.logoMarginX / 2))}px` }
          : { bottom: `${Math.min(48, Math.round(state.logoMarginY / 2))}px`, right: `${Math.min(48, Math.round(state.logoMarginX / 2))}px` }),
  };

  const subtitlePosClass =
    state.subtitlePosition === 'top'
      ? 'top-5'
      : state.subtitlePosition === 'middle'
        ? 'top-1/2 -translate-y-1/2'
        : 'bottom-7';

  const firstSubtitleLine = state.subtitleInlineSrt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^\d+$/.test(l) && !l.includes('-->'));

  const totalTimelineDuration = state.segments.reduce(
    (sum, s) => sum + Math.max(0.2, s.endSec - s.startSec),
    0,
  );

  const previewCaptionColor =
    state.captionStyle === 'viral_yellow' ? '#FACC15' : state.captionColor || '#FFFFFF';

  return (
    <div className="space-y-5">
      {/* Header + Undo/Redo + Render */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Multi-Segment Timeline · Facecam Split · Styled Captions · Brand Templates
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Clip Editor
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <button
              type="button"
              onClick={handleUndo}
              disabled={past.length === 0}
              title="Undo (Ctrl+Z)"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 rounded-l-lg"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
            <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
            <button
              type="button"
              onClick={handleRedo}
              disabled={future.length === 0}
              title="Redo (Ctrl+Y)"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 rounded-r-lg"
            >
              <Redo2 className="h-3.5 w-3.5" />
              Redo
            </button>
          </div>

          <select
            aria-label="Select source video"
            value={selectedVideo?.id || ''}
            onChange={(e) => setSelectedVideoId(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 max-w-xs"
          >
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.originalName} ({formatDuration(v.durationSec)})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void handleQueueRender()}
            disabled={submitting || !selectedVideo}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Play className="h-4 w-4" />
            {submitting ? 'Queuing...' : 'Export MP4'}
          </button>
        </div>
      </div>

      {/* Saved Brand Templates Bar */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Brand Templates:
          </span>
          <select
            aria-label="Apply saved brand template"
            value={selectedTemplateId}
            onChange={(e) => handleApplyTemplate(e.target.value)}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
          >
            <option value="">Load saved layout & branding ({templates.length})...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.aspectRatio} · {t.fitMode})
              </option>
            ))}
          </select>
          {selectedTemplateId && (
            <button
              type="button"
              onClick={() => void handleDeleteTemplate(selectedTemplateId)}
              className="rounded-md p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10"
              title="Delete selected template"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="New template name..."
            className="w-44 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void handleSaveTemplate()}
            disabled={savingTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {savingTemplate ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>

      {loadedClipId && initialClip && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-2.5 text-xs text-blue-700 dark:text-blue-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Editing generated clip: <strong>{initialClip.title}</strong> ({initialClip.startSec.toFixed(1)}s →{' '}
            {initialClip.endSec.toFixed(1)}s · Viral score {initialClip.viralScore}/100)
          </span>
          <button
            type="button"
            onClick={() => setLoadedClipId(null)}
            className="underline hover:no-underline"
          >
            Detach from clip record
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Preview Stage & Visual Timeline */}
        <section className="xl:col-span-6 space-y-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Monitor · <strong className="text-zinc-900 dark:text-zinc-100">{state.aspectRatio}</strong> ·{' '}
                {state.fitMode === 'split_facecam'
                  ? 'Split Facecam + Gameplay'
                  : state.fitMode === 'crop'
                    ? 'Center Crop'
                    : 'Blur Pad'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowSafeAreas((s) => !s)}
                  className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
                    showSafeAreas
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Safe Areas {showSafeAreas ? 'ON' : 'OFF'}
                </button>
                {selectedVideo && (
                  <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {selectedVideo.width}×{selectedVideo.height} · {formatBytes(selectedVideo.sizeBytes)}
                  </span>
                )}
              </div>
            </div>

            {/* Interactive Preview Stage */}
            <div className="relative rounded-lg bg-zinc-950 flex items-center justify-center overflow-hidden min-h-[340px] max-h-[460px]">
              {selectedVideo && (
                <div
                  className={`relative overflow-hidden bg-black flex items-center justify-center transition-all ${
                    state.aspectRatio === '9:16' && state.fitMode !== 'split_facecam'
                      ? 'aspect-[9/16] h-[420px]'
                      : state.aspectRatio === '1:1'
                        ? 'aspect-square h-[360px]'
                        : 'w-full aspect-video'
                  }`}
                >
                  <video
                    ref={videoRef}
                    key={selectedVideo.id}
                    src={`/api/media/${selectedVideo.id}/stream`}
                    controls
                    onTimeUpdate={(e) => setPlayheadSec(e.currentTarget.currentTime)}
                    className={`h-full w-full ${
                      state.aspectRatio !== 'original' && state.fitMode === 'crop'
                        ? 'object-cover'
                        : 'object-contain'
                    }`}
                  />

                  {/* Facecam & Gameplay Crop Boxes when Split mode active */}
                  {state.fitMode === 'split_facecam' && (
                    <>
                      <div
                        className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-500/15"
                        style={{
                          left: `${state.facecamBox.xPct}%`,
                          top: `${state.facecamBox.yPct}%`,
                          width: `${state.facecamBox.wPct}%`,
                          height: `${state.facecamBox.hPct}%`,
                        }}
                      >
                        <span className="bg-emerald-500 text-zinc-950 text-[10px] font-bold px-1.5 py-0.5">
                          FACECAM (TOP)
                        </span>
                      </div>
                      <div
                        className="pointer-events-none absolute border-2 border-blue-400 bg-blue-500/10"
                        style={{
                          left: `${state.gameplayBox.xPct}%`,
                          top: `${state.gameplayBox.yPct}%`,
                          width: `${state.gameplayBox.wPct}%`,
                          height: `${state.gameplayBox.hPct}%`,
                        }}
                      >
                        <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5">
                          GAMEPLAY (BOTTOM)
                        </span>
                      </div>
                    </>
                  )}

                  {/* Safe Area Guides (TikTok / Reels / Shorts) */}
                  {showSafeAreas && (
                    <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-amber-400/70">
                      <div className="absolute top-0 inset-x-0 h-[10%] bg-amber-400/10 border-b border-dashed border-amber-400/60 flex items-center justify-center text-[10px] font-mono text-amber-300">
                        TOP UI SAFE MARGIN
                      </div>
                      <div className="absolute right-0 top-[25%] bottom-[22%] w-[16%] bg-amber-400/10 border-l border-dashed border-amber-400/60 flex items-center justify-center text-[9px] font-mono text-amber-300">
                        ICONS
                      </div>
                      <div className="absolute bottom-0 inset-x-0 h-[20%] bg-amber-400/10 border-t border-dashed border-amber-400/60 flex items-center justify-center text-[10px] font-mono text-amber-300">
                        CAPTION / DESCRIPTION SAFE ZONE
                      </div>
                    </div>
                  )}

                  {/* Visual Logo Overlay Preview */}
                  {state.logoEnabled && state.logoMediaId && (
                    <img
                      src={`/api/media/${state.logoMediaId}/stream`}
                      alt="Watermark preview"
                      referrerPolicy="no-referrer"
                      style={logoStyle}
                      className="pointer-events-none absolute object-contain"
                    />
                  )}

                  {/* Visual Subtitle Style Preview */}
                  {state.subtitleEnabled && (
                    <div
                      className={`pointer-events-none absolute left-4 right-4 text-center ${subtitlePosClass}`}
                    >
                      <span
                        className={`inline-block px-2.5 py-1 font-bold ${
                          state.captionStyle === 'minimal_clean'
                            ? 'bg-black/40 rounded'
                            : state.captionStyle === 'cinema_outline'
                              ? 'bg-transparent tracking-wide uppercase'
                              : 'bg-black/65 rounded'
                        }`}
                        style={{
                          fontSize: `${Math.max(11, Math.min(22, state.subtitleFontSize * 0.68))}px`,
                          color: previewCaptionColor,
                          textShadow: `0 1px 3px ${state.captionOutlineColor || '#000000'}`,
                        }}
                      >
                        {firstSubtitleLine || 'Subtitle preview will appear here'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Visual Timeline Strip & Quick Playhead Actions */}
            <div className="mt-4 space-y-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
              <div className="relative h-7 rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                {state.segments.map((seg, idx) => {
                  const leftPct = Math.max(0, Math.min(100, (seg.startSec / maxDuration) * 100));
                  const widthPct = Math.max(2, Math.min(100 - leftPct, ((seg.endSec - seg.startSec) / maxDuration) * 100));
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = seg.startSec;
                      }}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className="absolute inset-y-0.5 rounded bg-blue-600/25 border border-blue-500/60 px-1.5 text-[10px] font-mono text-blue-700 dark:text-blue-300 truncate text-left hover:bg-blue-600/35"
                      title={`${seg.label}: ${seg.startSec.toFixed(1)}s - ${seg.endSec.toFixed(1)}s`}
                    >
                      #{idx + 1} {seg.startSec.toFixed(1)}s–{seg.endSec.toFixed(1)}s
                    </button>
                  );
                })}
                {/* Playhead line */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500"
                  style={{ left: `${Math.min(100, (playheadSec / maxDuration) * 100)}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFromPlayhead('start')}
                    className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Mark Start
                  </button>
                  <button
                    type="button"
                    onClick={() => setFromPlayhead('end')}
                    className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Mark End
                  </button>
                  <button
                    type="button"
                    onClick={handleSplitAtPlayhead}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-600/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-600/20"
                  >
                    <SplitSquareVertical className="h-3.5 w-3.5" />
                    Split at {playheadSec.toFixed(1)}s
                  </button>
                </div>
                <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {state.segments.length} seg · {totalTimelineDuration.toFixed(1)}s output
                </span>
              </div>
            </div>
          </div>

          {/* Transparent Pre-Execution Summary */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-4">
            <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Export Pipeline Summary
            </h2>
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Renderer</dt>
                <dd className="font-medium text-zinc-900 dark:text-zinc-100">Native FFmpeg (Local CPU)</dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Format & Quality</dt>
                <dd className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {state.aspectRatio} · {state.resolution} · CRF {state.crf}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Timeline & Transitions</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {state.segments.length > 1
                    ? `${state.segments.length} stitched segments`
                    : state.trimEnabled
                      ? `${state.startSec.toFixed(1)}s–${state.endSec.toFixed(1)}s`
                      : 'Full video'}
                  {state.fadeInSec > 0 || state.fadeOutSec > 0
                    ? ` · Fade ${state.fadeInSec}s/${state.fadeOutSec}s`
                    : ''}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Overlays & Branding</dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {[
                    state.fitMode === 'split_facecam' ? 'Split Facecam' : null,
                    state.subtitleEnabled ? `Captions (${state.captionStyle})` : null,
                    state.logoEnabled && state.logoMediaId ? 'Logo' : null,
                    state.introMediaId ? 'Intro' : null,
                    state.outroMediaId ? 'Outro' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Standard transcode'}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Right: Modular Controls */}
        <section className="xl:col-span-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden">
          <div className="flex items-center gap-1 p-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 overflow-x-auto">
            {(
              [
                ['frame', 'Frame & Crop', Scissors],
                ['timeline', `Timeline (${state.segments.length})`, Layers],
                ['subtitles', 'Captions', Subtitles],
                ['logo', 'Branding & FX', ImageIcon],
                ['audio', 'Audio', Volume2],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === key
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-5">
            {/* Export Filename */}
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Export Filename
              </label>
              <input
                type="text"
                value={state.outputName}
                onChange={(e) => patchState({ outputName: e.target.value })}
                placeholder="my_vertical_short"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              />
            </div>

            {activeTab === 'frame' && (
              <div className="space-y-5">
                {/* Aspect Ratio */}
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Target Aspect Ratio
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        ['9:16', '9:16 Shorts'],
                        ['16:9', '16:9 Landscape'],
                        ['1:1', '1:1 Square'],
                        ['original', 'Original'],
                      ] as Array<[AspectRatioMode, string]>
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => patchState({ aspectRatio: mode })}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          state.aspectRatio === mode
                            ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Framing Strategy including Split Facecam + Gameplay */}
                {state.aspectRatio !== 'original' && (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Framing & Layout Strategy
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(
                        [
                          ['blur_pad', 'Blurred Pad', 'Full width + blurred bg'],
                          ['crop', 'Center Fill', 'Edge-to-edge center crop'],
                          ['split_facecam', 'Split Facecam', 'Facecam top + gameplay'],
                        ] as Array<[VerticalFitMode, string, string]>
                      ).map(([mode, title, desc]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => patchState({ fitMode: mode })}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                            state.fitMode === mode
                              ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                              : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          <p className="text-xs font-semibold">{title}</p>
                          <p className="text-[11px] opacity-80 mt-0.5">{desc}</p>
                        </button>
                      ))}
                    </div>

                    {state.fitMode === 'split_facecam' && (
                      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3.5 space-y-3">
                        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          Manual Crop Boxes (% of source frame)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                          <div className="space-y-2">
                            <p className="font-medium text-emerald-600 dark:text-emerald-400">
                              Facecam Crop Box (Top Stack)
                            </p>
                            {(['xPct', 'yPct', 'wPct', 'hPct'] as const).map((field) => (
                              <div key={field} className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] w-10 uppercase text-zinc-500">
                                  {field.replace('Pct', '')}
                                </span>
                                <input
                                  type="range"
                                  min={field === 'wPct' || field === 'hPct' ? 10 : 0}
                                  max={field === 'wPct' || field === 'hPct' ? 100 : 90}
                                  value={state.facecamBox[field]}
                                  onChange={(e) =>
                                    patchState({
                                      facecamBox: {
                                        ...state.facecamBox,
                                        [field]: Number(e.target.value),
                                      },
                                    })
                                  }
                                  className="flex-1 accent-emerald-500"
                                />
                                <span className="font-mono text-[11px] w-9 text-right tabular-nums">
                                  {state.facecamBox[field]}%
                                </span>
                              </div>
                            ))}
                          </div>

                          <div className="space-y-2">
                            <p className="font-medium text-blue-600 dark:text-blue-400">
                              Gameplay Crop Box (Bottom Stack)
                            </p>
                            {(['xPct', 'yPct', 'wPct', 'hPct'] as const).map((field) => (
                              <div key={field} className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] w-10 uppercase text-zinc-500">
                                  {field.replace('Pct', '')}
                                </span>
                                <input
                                  type="range"
                                  min={field === 'wPct' || field === 'hPct' ? 10 : 0}
                                  max={field === 'wPct' || field === 'hPct' ? 100 : 90}
                                  value={state.gameplayBox[field]}
                                  onChange={(e) =>
                                    patchState({
                                      gameplayBox: {
                                        ...state.gameplayBox,
                                        [field]: Number(e.target.value),
                                      },
                                    })
                                  }
                                  className="flex-1 accent-blue-500"
                                />
                                <span className="font-mono text-[11px] w-9 text-right tabular-nums">
                                  {state.gameplayBox[field]}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Resolution, Preset, CRF */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      Resolution
                    </label>
                    <select
                      value={state.resolution}
                      onChange={(e) => patchState({ resolution: e.target.value as ResolutionPreset })}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="720p">720p HD (Recommended for 8 GB RAM)</option>
                      <option value="1080p">1080p Full HD</option>
                      <option value="480p">480p Fast / Lightweight</option>
                      <option value="source">Keep Source Resolution</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                      CPU Speed Preset
                    </label>
                    <select
                      value={state.preset}
                      onChange={(e) => patchState({ preset: e.target.value as FfmpegSpeedPreset })}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="ultrafast">ultrafast (Lowest CPU usage)</option>
                      <option value="veryfast">veryfast (Balanced default)</option>
                      <option value="fast">fast (Smaller file size)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label className="font-medium text-zinc-700 dark:text-zinc-300">
                      Compression Quality (CRF)
                    </label>
                    <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                      CRF {state.crf} ({state.crf <= 20 ? 'High Quality' : state.crf <= 25 ? 'Balanced' : 'Compact'})
                    </span>
                  </div>
                  <input
                    type="range"
                    min={18}
                    max={32}
                    value={state.crf}
                    onChange={(e) => patchState({ crf: Number(e.target.value) })}
                    className="w-full accent-blue-600"
                  />
                </div>
              </div>
            )}

            {activeTab === 'timeline' && (
              <div className="space-y-4 pt-1 border-t border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      Timeline Segments
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Split, duplicate, reorder, or trim multiple ranges. FFmpeg stitches all segments in order.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      patchState({
                        trimEnabled: false,
                        startSec: 0,
                        endSec: maxDuration,
                        segments: [{ id: 'seg_reset', label: 'Full Clip', startSec: 0, endSec: maxDuration }],
                      })
                    }
                    className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Reset Full Span
                  </button>
                </div>

                <div className="space-y-2.5">
                  {state.segments.map((seg, idx) => (
                    <div
                      key={seg.id}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                          #{idx + 1} · {seg.label} ({(seg.endSec - seg.startSec).toFixed(1)}s)
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveSegment(idx, -1)}
                            disabled={idx === 0}
                            title="Move earlier"
                            className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveSegment(idx, 1)}
                            disabled={idx === state.segments.length - 1}
                            title="Move later"
                            className="p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicateSegment(idx)}
                            title="Duplicate segment"
                            className="p-1 text-zinc-500 hover:text-blue-500"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSegment(idx)}
                            disabled={state.segments.length <= 1}
                            title="Delete segment"
                            className="p-1 text-zinc-500 hover:text-red-500 disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-zinc-500 mb-1">Start (sec)</label>
                          <input
                            type="number"
                            min={0}
                            max={Math.max(0, seg.endSec - 0.3)}
                            step={0.1}
                            value={seg.startSec}
                            onChange={(e) => handleUpdateSegmentBounds(idx, 'startSec', Number(e.target.value) || 0)}
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-500 mb-1">End (sec)</label>
                          <input
                            type="number"
                            min={seg.startSec + 0.3}
                            max={maxDuration}
                            step={0.1}
                            value={seg.endSec}
                            onChange={(e) => handleUpdateSegmentBounds(idx, 'endSec', Number(e.target.value) || maxDuration)}
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'subtitles' && (
              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-zinc-200 dark:border-zinc-800">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Burn Styled Captions into Exported Video
                  </span>
                  <input
                    type="checkbox"
                    checked={state.subtitleEnabled}
                    onChange={(e) => patchState({ subtitleEnabled: e.target.checked })}
                    className="h-4 w-4 rounded accent-blue-600"
                  />
                </label>

                {/* Caption Style Presets */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      ['classic_bold', 'Classic Bold'],
                      ['viral_yellow', 'Viral Yellow'],
                      ['minimal_clean', 'Minimal Clean'],
                      ['cinema_outline', 'Cinema Outline'],
                    ] as Array<[CaptionStylePreset, string]>
                  ).map(([presetKey, label]) => (
                    <button
                      key={presetKey}
                      type="button"
                      onClick={() =>
                        patchState({
                          captionStyle: presetKey,
                          captionColor: presetKey === 'viral_yellow' ? '#FACC15' : '#FFFFFF',
                        })
                      }
                      className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                        state.captionStyle === presetKey
                          ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Text Color
                    </label>
                    <input
                      type="color"
                      value={state.captionColor}
                      onChange={(e) => patchState({ captionColor: e.target.value })}
                      className="h-8 w-full rounded border border-zinc-200 dark:border-zinc-800 bg-transparent cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Outline Color
                    </label>
                    <input
                      type="color"
                      value={state.captionOutlineColor}
                      onChange={(e) => patchState({ captionOutlineColor: e.target.value })}
                      className="h-8 w-full rounded border border-zinc-200 dark:border-zinc-800 bg-transparent cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Position
                    </label>
                    <select
                      value={state.subtitlePosition}
                      onChange={(e) => patchState({ subtitlePosition: e.target.value as SubtitlePosition })}
                      className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
                    >
                      <option value="bottom">Bottom</option>
                      <option value="middle">Middle</option>
                      <option value="top">Top</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                      Size ({state.subtitleFontSize}px)
                    </label>
                    <input
                      type="range"
                      min={14}
                      max={40}
                      value={state.subtitleFontSize}
                      onChange={(e) => patchState({ subtitleFontSize: Number(e.target.value) })}
                      className="w-full accent-blue-600 mt-1.5"
                    />
                  </div>
                </div>

                {/* Words Per Line & SRT Tools */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Load SRT/VTT from library"
                    value={state.subtitleMediaId}
                    onChange={(e) => void handleSelectSubtitleFile(e.target.value)}
                    className="flex-1 min-w-[160px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">Load uploaded .srt / .vtt...</option>
                    {subtitles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.originalName}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() =>
                      patchState({
                        subtitleInlineSrt: DEFAULT_SAMPLE_SRT,
                        subtitleEnabled: true,
                      })
                    }
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Sample SRT
                  </button>

                  {state.subtitleInlineSrt.trim() && (
                    <button
                      type="button"
                      onClick={() => downloadTextFile(`${state.outputName || 'captions'}.srt`, state.subtitleInlineSrt)}
                      className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                      .srt
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">Words per line:</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={state.wordsPerLine}
                      onChange={(e) => patchState({ wordsPerLine: Math.max(1, Math.min(10, Number(e.target.value) || 4)) })}
                      className="w-14 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 font-mono text-xs text-center"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!state.subtitleInlineSrt.trim()}
                    onClick={() =>
                      patchState({
                        subtitleInlineSrt: rewrapSrtByWordsPerLine(state.subtitleInlineSrt, state.wordsPerLine),
                      })
                    }
                    className="rounded-md bg-zinc-900 dark:bg-zinc-100 px-2.5 py-1 text-xs font-medium text-white dark:text-zinc-950 disabled:opacity-40"
                  >
                    Re-wrap Captions
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Transcript & SRT Word Correction Editor
                  </label>
                  <textarea
                    rows={7}
                    value={state.subtitleInlineSrt}
                    onChange={(e) =>
                      patchState({
                        subtitleInlineSrt: e.target.value,
                        subtitleEnabled: state.subtitleEnabled || Boolean(e.target.value.trim()),
                      })
                    }
                    placeholder="Paste or correct SRT cues and transcript words here..."
                    className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 font-mono text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
              </div>
            )}

            {activeTab === 'logo' && (
              <div className="space-y-4">
                <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-zinc-200 dark:border-zinc-800">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Overlay Watermark / Brand Logo
                  </span>
                  <input
                    type="checkbox"
                    checked={state.logoEnabled}
                    onChange={(e) => patchState({ logoEnabled: e.target.checked })}
                    className="h-4 w-4 rounded accent-blue-600"
                  />
                </label>

                {logos.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    No PNG/JPG logos uploaded yet. Upload a logo in Media Library or generate the Sample Pack.
                  </p>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                        Logo Image Asset
                      </label>
                      <select
                        value={state.logoMediaId}
                        onChange={(e) => patchState({ logoMediaId: e.target.value })}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                      >
                        {logos.map((img) => (
                          <option key={img.id} value={img.id}>
                            {img.originalName} ({img.width}×{img.height})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['top-left', 'Top Left'],
                          ['top-right', 'Top Right'],
                          ['bottom-left', 'Bottom Left'],
                          ['bottom-right', 'Bottom Right'],
                        ] as Array<[LogoCorner, string]>
                      ).map(([c, label]) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => patchState({ logoCorner: c })}
                          className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                            state.logoCorner === c
                              ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                              : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <label>Logo Width</label>
                          <span className="font-mono tabular-nums">{state.logoScalePct}%</span>
                        </div>
                        <input
                          type="range"
                          min={8}
                          max={40}
                          value={state.logoScalePct}
                          onChange={(e) => patchState({ logoScalePct: Number(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <label>Opacity</label>
                          <span className="font-mono tabular-nums">{Math.round(state.logoOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min={0.15}
                          max={1}
                          step={0.05}
                          value={state.logoOpacity}
                          onChange={(e) => patchState({ logoOpacity: Number(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <label>Horizontal Margin</label>
                          <span className="font-mono tabular-nums">{state.logoMarginX}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          step={4}
                          value={state.logoMarginX}
                          onChange={(e) => patchState({ logoMarginX: Number(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <label>Vertical Margin</label>
                          <span className="font-mono tabular-nums">{state.logoMarginY}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={120}
                          step={4}
                          value={state.logoMarginY}
                          onChange={(e) => patchState({ logoMarginY: Number(e.target.value) })}
                          className="w-full accent-blue-600"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Transitions & Intro/Outro */}
                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Transitions & Intro / Outro Clips
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <label>Fade In</label>
                        <span className="font-mono tabular-nums">{state.fadeInSec.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={state.fadeInSec}
                        onChange={(e) => patchState({ fadeInSec: Number(e.target.value) })}
                        className="w-full accent-blue-600"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <label>Fade Out</label>
                        <span className="font-mono tabular-nums">{state.fadeOutSec.toFixed(1)}s</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={state.fadeOutSec}
                        onChange={(e) => patchState({ fadeOutSec: Number(e.target.value) })}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                        Prepend Intro Video (optional)
                      </label>
                      <select
                        value={state.introMediaId}
                        onChange={(e) => patchState({ introMediaId: e.target.value })}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs"
                      >
                        <option value="">None</option>
                        {videos.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.originalName} ({formatDuration(v.durationSec)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                        Append Outro Video (optional)
                      </label>
                      <select
                        value={state.outroMediaId}
                        onChange={(e) => patchState({ outroMediaId: e.target.value })}
                        className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-2 text-xs"
                      >
                        <option value="">None</option>
                        {videos.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.originalName} ({formatDuration(v.durationSec)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-5">
                <div className="pt-1 border-t border-zinc-200 dark:border-zinc-800">
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Video Render Audio Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['keep', 'Keep Original Audio'],
                        ['mute', 'Mute Audio Track'],
                        ['mix_music', 'Mix Background Audio'],
                        ['replace_music', 'Replace with Audio File'],
                      ] as Array<[AudioMode, string]>
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => patchState({ audioMode: mode })}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors ${
                          state.audioMode === mode
                            ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                            : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {(state.audioMode === 'mix_music' || state.audioMode === 'replace_music') && (
                  <div className="space-y-3">
                    {audioTracks.length === 0 ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Upload an MP3 or WAV track in Media Library (or extract audio below) to mix background audio.
                      </p>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                            Background Audio Asset
                          </label>
                          <select
                            value={state.musicMediaId}
                            onChange={(e) => patchState({ musicMediaId: e.target.value })}
                            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                          >
                            {audioTracks.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.originalName} ({formatDuration(a.durationSec)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <label className="font-medium text-zinc-700 dark:text-zinc-300">Audio Volume</label>
                            <span className="font-mono tabular-nums">{Math.round(state.musicVolume * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.1}
                            max={1.2}
                            step={0.05}
                            value={state.musicVolume}
                            onChange={(e) => patchState({ musicVolume: Number(e.target.value) })}
                            className="w-full accent-blue-600"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Standalone Audio Extraction
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Extract the audio track from the selected video directly into your Media Library.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <select
                      aria-label="Audio output format"
                      value={extractFormat}
                      onChange={(e) => setExtractFormat(e.target.value === 'wav' ? 'wav' : 'mp3')}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                    >
                      <option value="mp3">MP3 (192 kbps)</option>
                      <option value="wav">WAV (Uncompressed PCM)</option>
                    </select>
                    <button
                      type="button"
                      disabled={extractingAudio || !selectedVideo?.audioCodec}
                      onClick={() => void handleExtractAudio()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                    >
                      <FileAudio className="h-3.5 w-3.5" />
                      {extractingAudio ? 'Queuing...' : `Extract ${extractFormat.toUpperCase()}`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
