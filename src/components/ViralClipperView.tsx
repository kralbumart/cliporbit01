import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Film,
  Link2,
  Mic,
  Play,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { formatBytes, formatDuration, studioApi } from '../lib/api';
import type {
  AiProviderConfig,
  AiProviderId,
  AspectRatioMode,
  BrandTemplate,
  ClippingMode,
  CreatorProfile,
  MediaAsset,
  UrlInspectResult,
  ViralClipRecord,
  ViralClipRules,
} from '../types/studio';

interface ViralClipperViewProps {
  media: MediaAsset[];
  clips: ViralClipRecord[];
  providers: AiProviderConfig[];
  templates: BrandTemplate[];
  creators: CreatorProfile[];
  generatingSample: boolean;
  onGenerateSample: () => void;
  onRefreshMedia: () => Promise<void>;
  onRefreshClips: () => Promise<void>;
  onOpenClipInEditor: (clip: ViralClipRecord) => void;
  onJobQueued: () => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

const DEFAULT_RULES: ViralClipRules = {
  strongHook: true,
  removeSilence: true,
  meaningfulContext: true,
  completeSentences: true,
  engagingMoments: true,
  noAbruptEnding: true,
  noMisleadingEdits: true,
  minDurationSec: 4,
  maxDurationSec: 45,
  maxClips: 3,
  language: 'English',
  aspectRatio: '9:16',
  minViralScore: 65,
  sceneDetection: true,
  facecamSplit: false,
  speakerFocus: false,
};

export function ViralClipperView({
  media,
  clips,
  providers,
  templates,
  creators,
  generatingSample,
  onGenerateSample,
  onRefreshMedia,
  onRefreshClips,
  onOpenClipInEditor,
  onJobQueued,
  onNotify,
}: ViralClipperViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videos = media.filter((m) => m.kind === 'video');
  const subtitleFiles = media.filter((m) => m.kind === 'subtitle');

  // Universal URL Input state
  const [urlInput, setUrlInput] = useState('');
  const [inspectingUrl, setInspectingUrl] = useState(false);
  const [importingUrl, setImportingUrl] = useState(false);
  const [urlInfo, setUrlInfo] = useState<UrlInspectResult | null>(null);

  // Selected source video & transcript
  const [selectedVideoId, setSelectedVideoId] = useState<string>(videos[0]?.id || '');
  const [selectedCreatorId, setSelectedCreatorId] = useState<string>('');
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const [uploadingLocal, setUploadingLocal] = useState(false);

  // AI Engine & Rules
  const defaultProv = providers.find((p) => p.isDefault && p.configured) || providers.find((p) => p.configured);
  const [providerId, setProviderId] = useState<AiProviderId | ''>(defaultProv?.id || 'gemini');
  const [mode, setMode] = useState<ClippingMode>(defaultProv ? 'balanced' : 'non_ai');
  const [rules, setRules] = useState<ViralClipRules>(DEFAULT_RULES);
  const [analyzing, setAnalyzing] = useState(false);

  // Batch Brand Template for rendering clips
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [renderingClipId, setRenderingClipId] = useState<string | null>(null);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeVideo = videos.find((v) => v.id === selectedVideoId) || videos[0] || null;

  async function handleInspectUrl() {
    if (!urlInput.trim()) return;
    setInspectingUrl(true);
    setUrlInfo(null);
    try {
      const info = await studioApi.inspectUrl(urlInput.trim());
      setUrlInfo(info);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'URL inspection failed', 'error');
    } finally {
      setInspectingUrl(false);
    }
  }

  async function handleImportUrl() {
    if (!urlInput.trim()) return;
    setImportingUrl(true);
    try {
      const res = await studioApi.importUrl(urlInput.trim());
      if (res.mode === 'direct_downloaded' && res.asset) {
        await onRefreshMedia();
        setSelectedVideoId(res.asset.id);
        onNotify(`Imported "${res.asset.originalName}" directly into Media Library.`);
      } else if (res.mode === 'queued_ytdlp') {
        onNotify('Queued video download via local yt-dlp worker.');
        onJobQueued();
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'URL import failed', 'error');
    } finally {
      setImportingUrl(false);
    }
  }

  async function handleLocalUpload(files: FileList) {
    if (!files.length) return;
    setUploadingLocal(true);
    try {
      const res = await studioApi.uploadMedia(files);
      await onRefreshMedia();
      const firstVideo = res.assets.find((a) => a.kind === 'video');
      if (firstVideo) setSelectedVideoId(firstVideo.id);
      onNotify(`Uploaded ${res.assets.length} file(s).`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploadingLocal(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleLoadSubtitleFile(subId: string) {
    if (!subId) return;
    try {
      const res = await studioApi.getSubtitleContent(subId);
      setTranscript(res.content);
      onNotify(`Loaded transcript from ${res.originalName}.`);
    } catch {
      onNotify('Failed to read subtitle file.', 'error');
    }
  }

  async function handleTranscribeAudio() {
    if (!activeVideo) return;
    setTranscribing(true);
    try {
      const res = await studioApi.transcribeVideo(activeVideo.id, rules.language);
      if (!res.transcript) {
        onNotify('No spoken words detected in audio track (tone/music only). You can paste a transcript or use Non-AI clipping.');
      } else {
        setTranscript(res.srtContent || res.transcript);
        onNotify(`Transcribed audio using ${res.providerUsed}.`);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Transcription failed', 'error');
    } finally {
      setTranscribing(false);
    }
  }

  async function handleAnalyzeClips() {
    if (!activeVideo) {
      onNotify('Select or upload a source video first.', 'error');
      return;
    }
    setAnalyzing(true);
    try {
      const res = await studioApi.analyzeClips({
        mediaId: activeVideo.id,
        transcript,
        mode,
        providerId: mode === 'non_ai' ? null : (providerId || undefined),
        creatorId: selectedCreatorId || null,
        rules,
      });
      await onRefreshClips();
      onNotify(`Generated ${res.clips.length} clip candidate(s) using ${res.providerUsed}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Clip analysis failed', 'error');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleRenderClip(clip: ViralClipRecord) {
    setRenderingClipId(clip.id);
    try {
      await studioApi.renderClip(clip.id, {
        templateId: selectedTemplateId || null,
        aspectRatio: rules.aspectRatio,
      });
      await onRefreshClips();
      onNotify(`Queued MP4 render for "${clip.title}".`);
      onJobQueued();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to queue render', 'error');
    } finally {
      setRenderingClipId(null);
    }
  }

  async function handleSaveClipMetadata(clip: ViralClipRecord, patch: Partial<ViralClipRecord>) {
    try {
      await studioApi.updateClip(clip.id, patch);
      await onRefreshClips();
      setEditingClipId(null);
      onNotify('Clip metadata saved & re-checked against restricted words.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to update clip', 'error');
    }
  }

  async function handleDeleteClip(clipId: string) {
    try {
      await studioApi.deleteClip(clipId);
      await onRefreshClips();
      onNotify('Removed clip candidate.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  function copyClipMetadata(clip: ViralClipRecord) {
    const text = [
      `Title: ${clip.title}`,
      `Hook: ${clip.hook}`,
      `Description: ${clip.description}`,
      `Hashtags: ${clip.hashtags.join(' ')}`,
      `Keywords: ${clip.keywords.join(', ')}`,
    ].join('\n');
    void navigator.clipboard.writeText(text);
    setCopiedId(clip.id);
    onNotify('Copied clip metadata to clipboard.');
    setTimeout(() => setCopiedId((prev) => (prev === clip.id ? null : prev)), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Universal Link Input · AI Highlight Detection · Honest Non-AI Fallback
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            AI Viral Clipping Studio
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingLocal}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploadingLocal ? 'Uploading...' : 'Upload Local Video'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.webm,.mkv,.avi,.srt,.vtt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleLocalUpload(e.target.files);
            }}
          />
          <button
            type="button"
            onClick={onGenerateSample}
            disabled={generatingSample}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
          >
            <Film className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            {generatingSample ? 'Generating...' : 'Sample Pack'}
          </button>
        </div>
      </div>

      {/* 1. Prominent Universal Video Link Input */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              1. Universal Video Link Input
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Paste a YouTube, Twitch, Kick, or direct HTTPS MP4/WebM link to validate source metadata and import where supported.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Link2 className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleInspectUrl();
              }}
              placeholder="https://www.youtube.com/watch?v=... or https://example.com/clip.mp4"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 pl-9 pr-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleInspectUrl()}
            disabled={inspectingUrl || !urlInput.trim()}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-xs font-medium text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {inspectingUrl ? 'Inspecting...' : 'Validate Link'}
          </button>
          <button
            type="button"
            onClick={() => void handleImportUrl()}
            disabled={importingUrl || !urlInput.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {importingUrl ? 'Importing...' : 'Import Video'}
          </button>
        </div>

        {urlInfo && (
          <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row items-start gap-4">
            {urlInfo.thumbnailUrl && (
              <img
                src={urlInfo.thumbnailUrl}
                alt={urlInfo.title || 'Source video preview'}
                referrerPolicy="no-referrer"
                className="w-40 aspect-video rounded-lg object-cover bg-zinc-900 shrink-0"
              />
            )}
            <div className="space-y-1 text-xs flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-zinc-950 dark:text-zinc-50">
                  {urlInfo.title || urlInfo.url}
                </span>
                <span aria-hidden="true" className="text-zinc-400">·</span>
                <span className="uppercase font-mono text-zinc-500 dark:text-zinc-400">{urlInfo.platform}</span>
                {urlInfo.author && (
                  <>
                    <span aria-hidden="true" className="text-zinc-400">·</span>
                    <span className="text-zinc-600 dark:text-zinc-400">{urlInfo.author}</span>
                  </>
                )}
                {urlInfo.contentLengthBytes && (
                  <>
                    <span aria-hidden="true" className="text-zinc-400">·</span>
                    <span className="font-mono tabular-nums text-zinc-500">
                      {formatBytes(urlInfo.contentLengthBytes)}
                    </span>
                  </>
                )}
              </div>
              <p
                className={
                  urlInfo.canDownloadNow
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }
              >
                {urlInfo.reason}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* 2. AI Clipping Engine & Viral Rules */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <section className="xl:col-span-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              2. AI Clipping Engine & Rules
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Choose Fast, Balanced, Best, or Non-AI FFmpeg mode. Provider keys remain strictly server-side.
            </p>
          </div>

          {/* Source Video & Creator Link */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Source Video
              </label>
              <select
                value={activeVideo?.id || ''}
                onChange={(e) => setSelectedVideoId(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              >
                {videos.length === 0 && <option value="">No videos yet — upload or generate sample</option>}
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.originalName} ({formatDuration(v.durationSec)})
                  </option>
                ))}
              </select>
            </div>

            {creators.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Link to Creator (Optional)
                </label>
                <select
                  value={selectedCreatorId}
                  onChange={(e) => setSelectedCreatorId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
                >
                  <option value="">Unassigned</option>
                  {creators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.platform})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Mode Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Analysis Mode
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(
                [
                  ['fast', 'Fast AI'],
                  ['balanced', 'Balanced'],
                  ['best', 'Best AI'],
                  ['non_ai', 'Non-AI'],
                ] as Array<[ClippingMode, string]>
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    mode === m
                      ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode !== 'non_ai' && (
            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                AI Provider
              </label>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value as AiProviderId)}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.model}) — {p.configured ? 'Ready' : `Needs ${p.envVarName || 'URL'}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Transcript / SRT Source */}
          <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Transcript / SRT Input
              </label>
              <div className="flex items-center gap-2">
                {subtitleFiles.length > 0 && (
                  <select
                    aria-label="Load SRT from library"
                    defaultValue=""
                    onChange={(e) => void handleLoadSubtitleFile(e.target.value)}
                    className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-300"
                  >
                    <option value="">Load SRT...</option>
                    {subtitleFiles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.originalName}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => void handleTranscribeAudio()}
                  disabled={transcribing || !activeVideo}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Mic className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                  {transcribing ? 'Transcribing...' : 'Auto-Transcribe'}
                </button>
              </div>
            </div>
            <textarea
              rows={4}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Click Auto-Transcribe, load an .srt file, or paste your transcript here for hook & viral moment scoring..."
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2.5 font-mono text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
          </div>

          {/* Viral Rules Grid */}
          <div className="space-y-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Configurable Viral Clip Rules
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(
                [
                  ['strongHook', 'Strong opening hook'],
                  ['removeSilence', 'Remove dead silence'],
                  ['meaningfulContext', 'Meaningful context'],
                  ['completeSentences', 'Complete sentences'],
                  ['engagingMoments', 'Emotional / story peaks'],
                  ['noAbruptEnding', 'No abrupt endings'],
                  ['noMisleadingEdits', 'No misleading edits'],
                  ['facecamSplit', 'Facecam split ready'],
                ] as Array<[keyof ViralClipRules, string]>
              ).map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 cursor-pointer text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={Boolean(rules[field])}
                    onChange={(e) => setRules((prev) => ({ ...prev, [field]: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded accent-blue-600"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Max Clips</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={rules.maxClips}
                  onChange={(e) => setRules((prev) => ({ ...prev, maxClips: Math.max(1, Number(e.target.value) || 1) }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Min Score</label>
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={rules.minViralScore}
                  onChange={(e) => setRules((prev) => ({ ...prev, minViralScore: Math.max(0, Number(e.target.value) || 0) }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Aspect Ratio</label>
                <select
                  value={rules.aspectRatio}
                  onChange={(e) => setRules((prev) => ({ ...prev, aspectRatio: e.target.value as AspectRatioMode }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2 py-1.5 text-xs"
                >
                  <option value="9:16">9:16 Shorts</option>
                  <option value="16:9">16:9 Wide</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="original">Original</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Min Sec</label>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={rules.minDurationSec}
                  onChange={(e) => setRules((prev) => ({ ...prev, minDurationSec: Math.max(2, Number(e.target.value) || 4) }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Max Sec</label>
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={rules.maxDurationSec}
                  onChange={(e) => setRules((prev) => ({ ...prev, maxDurationSec: Math.max(5, Number(e.target.value) || 45) }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">Language</label>
                <input
                  type="text"
                  value={rules.language}
                  onChange={(e) => setRules((prev) => ({ ...prev, language: e.target.value }))}
                  className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleAnalyzeClips()}
            disabled={analyzing || !activeVideo}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Wand2 className="h-4 w-4" />
            {analyzing
              ? mode === 'non_ai'
                ? 'Detecting Non-AI Segments...'
                : `Analyzing Clips (${mode})...`
              : mode === 'non_ai'
                ? 'Generate Clips (Non-AI FFmpeg)'
                : 'Generate AI Viral Clips'}
          </button>
        </section>

        {/* 3. Generated Viral Clips List & Metadata Optimization */}
        <section className="xl:col-span-7 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Generated Viral Clips ({clips.length})
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Edit hooks, metadata, hashtags, apply a saved Brand Template, or open directly in the timeline editor.
              </p>
            </div>

            {templates.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Render Template:</span>
                <select
                  aria-label="Brand template for clip rendering"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 text-xs"
                >
                  <option value="">Default 9:16 Blur-Pad</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {clips.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                No viral clip candidates yet
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                Select a video on the left (or click Sample Pack), optionally load or auto-transcribe captions, and run AI Viral Clipping or Non-AI FFmpeg Clipping.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {clips.map((clip) => (
                <ClipCardItem
                  key={clip.id}
                  clip={clip}
                  isEditing={editingClipId === clip.id}
                  isRendering={renderingClipId === clip.id}
                  isCopied={copiedId === clip.id}
                  onToggleEdit={() => setEditingClipId(editingClipId === clip.id ? null : clip.id)}
                  onSave={(patch) => void handleSaveClipMetadata(clip, patch)}
                  onCopy={() => copyClipMetadata(clip)}
                  onRender={() => void handleRenderClip(clip)}
                  onOpenEditor={() => onOpenClipInEditor(clip)}
                  onDelete={() => void handleDeleteClip(clip.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

interface ClipCardItemProps {
  clip: ViralClipRecord;
  isEditing: boolean;
  isRendering: boolean;
  isCopied: boolean;
  onToggleEdit: () => void;
  onSave: (patch: Partial<ViralClipRecord>) => void;
  onCopy: () => void;
  onRender: () => void;
  onOpenEditor: () => void;
  onDelete: () => void;
}

function ClipCardItem({
  clip,
  isEditing,
  isRendering,
  isCopied,
  onToggleEdit,
  onSave,
  onCopy,
  onRender,
  onOpenEditor,
  onDelete,
}: ClipCardItemProps) {
  const [title, setTitle] = useState(clip.title);
  const [hook, setHook] = useState(clip.hook);
  const [description, setDescription] = useState(clip.description);
  const [hashtagsStr, setHashtagsStr] = useState(clip.hashtags.join(' '));
  const [keywordsStr, setKeywordsStr] = useState(clip.keywords.join(', '));
  const [category, setCategory] = useState(clip.category);

  return (
    <article className="py-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{clip.title}</h3>
          <p className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-1.5">
            <span>
              {clip.startSec.toFixed(1)}s → {clip.endSec.toFixed(1)}s ({(clip.endSec - clip.startSec).toFixed(1)}s)
            </span>
            <span aria-hidden="true">·</span>
            <span>{clip.category}</span>
            <span aria-hidden="true">·</span>
            <span>{clip.providerUsed}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                clip.viralScore >= 80
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : clip.viralScore >= 60
                    ? 'text-blue-600 dark:text-blue-400 font-semibold'
                    : 'text-zinc-500'
              }
            >
              {clip.analysisMode === 'non_ai' ? 'Non-AI Segment' : `Viral Score ${clip.viralScore}/100`}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onRender}
            disabled={isRendering}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            {isRendering ? 'Queuing...' : 'Render MP4'}
          </button>
          <button
            type="button"
            onClick={onOpenEditor}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Edit
          </button>
          {clip.outputMediaId && (
            <a
              href={`/api/media/${clip.outputMediaId}/stream?download=1`}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              <Download className="h-3 w-3" />
              MP4
            </a>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            title="Copy metadata"
          >
            {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleEdit}
            className="rounded-md border border-zinc-200 dark:border-zinc-700 px-2 py-1.5 text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {isEditing ? 'Close' : 'Metadata'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete clip"
            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Words-to-Avoid Warning */}
      {clip.restrictedWarnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800/80 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Restricted words detected: <strong>{clip.restrictedWarnings.join(', ')}</strong>. Edit metadata before publishing.
          </span>
        </div>
      )}

      {/* Hook & Explanation */}
      <div className="text-xs space-y-1 text-zinc-600 dark:text-zinc-400">
        {clip.hook && (
          <p>
            <strong className="text-zinc-800 dark:text-zinc-200">Hook:</strong> {clip.hook}
          </p>
        )}
        {clip.description && <p>{clip.description}</p>}
        {clip.scoreExplanation && (
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            <strong className="text-zinc-700 dark:text-zinc-300">Scoring Rationale:</strong> {clip.scoreExplanation}
          </p>
        )}
        {clip.hashtags.length > 0 && (
          <p className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
            {clip.hashtags.join(' ')}
          </p>
        )}
      </div>

      {/* Inline Metadata Editor */}
      {isEditing && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3.5 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Opening Hook</label>
            <input
              type="text"
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Hashtags (space-separated)</label>
              <input
                type="text"
                value={hashtagsStr}
                onChange={(e) => setHashtagsStr(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">Keywords (comma-separated)</label>
              <input
                type="text"
                value={keywordsStr}
                onChange={(e) => setKeywordsStr(e.target.value)}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2.5 py-1.5"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                onSave({
                  title: title.trim(),
                  hook: hook.trim(),
                  description: description.trim(),
                  category: category.trim(),
                  hashtags: hashtagsStr.split(/\s+/).filter(Boolean),
                  keywords: keywordsStr.split(',').map((k) => k.trim()).filter(Boolean),
                })
              }
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Save Metadata
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
