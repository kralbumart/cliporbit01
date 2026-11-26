import { useRef, useState } from 'react';
import {
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Play,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatBytes, formatDuration, formatTimeAgo, studioApi } from '../lib/api';
import type { MediaAsset, MediaKind } from '../types/studio';

interface MediaLibraryViewProps {
  media: MediaAsset[];
  generatingSample: boolean;
  onGenerateSample: () => void;
  onRefreshMedia: () => Promise<void>;
  onOpenInEditor: (mediaId: string) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

type FilterOption = 'all' | MediaKind | 'exports';

export function MediaLibraryView({
  media,
  generatingSample,
  onGenerateSample,
  onRefreshMedia,
  onOpenInEditor,
  onNotify,
}: MediaLibraryViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = useState<FilterOption>('all');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);
  const [previewSrtText, setPreviewSrtText] = useState<string | null>(null);

  const filtered = media.filter((item) => {
    if (filter === 'exports' && !item.isExport) return false;
    if (filter !== 'all' && filter !== 'exports' && item.kind !== filter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return item.originalName.toLowerCase().includes(q) || (item.videoCodec || '').toLowerCase().includes(q);
    }
    return true;
  });

  async function handleFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const res = await studioApi.uploadMedia(files);
      await onRefreshMedia();
      onNotify(`Uploaded ${res.assets.length} file${res.assets.length > 1 ? 's' : ''} to Media Library.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(asset: MediaAsset) {
    try {
      await studioApi.deleteMedia(asset.id);
      if (previewAsset?.id === asset.id) setPreviewAsset(null);
      await onRefreshMedia();
      onNotify(`Removed ${asset.originalName}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function openPreview(asset: MediaAsset) {
    setPreviewAsset(asset);
    setPreviewSrtText(null);
    if (asset.kind === 'subtitle') {
      try {
        const res = await studioApi.getSubtitleContent(asset.id);
        setPreviewSrtText(res.content);
      } catch {
        setPreviewSrtText('Unable to read subtitle file contents.');
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Local Disk Storage · Automatic FFprobe Metadata & Thumbnails
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Media Library
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
            {generatingSample ? 'Generating...' : 'Generate Sample Pack'}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload Media'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp4,.mov,.webm,.mkv,.avi,.m4v,.mp3,.wav,.m4a,.aac,.ogg,.png,.jpg,.jpeg,.webp,.srt,.vtt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
            }}
          />
        </div>
      </div>

      {/* Drag & Drop Upload Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed p-6 text-center transition-colors ${
          dragActive
            ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
            : 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-[#111113]'
        }`}
      >
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Drop videos, audio tracks, PNG/JPG logos, or SRT/VTT subtitle files here
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Files stream straight to local disk without buffering in RAM · Max 512 MB per file
        </p>
      </div>

      {/* Filter Bar & Search */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1 overflow-x-auto">
          {(
            [
              ['all', 'All'],
              ['video', 'Videos'],
              ['audio', 'Audio'],
              ['image', 'Logos'],
              ['subtitle', 'Subtitles'],
              ['exports', 'Exports'],
            ] as Array<[FilterOption, string]>
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

        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by filename or codec..."
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] pl-9 pr-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
        </div>
      </div>

      {/* Asset Grid */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] py-16 px-6 text-center">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            No matching media assets
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
            Upload your own files or generate our built-in FFmpeg sample pack (includes a 12s 720p video, watermark logo, and SRT caption file).
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onGenerateSample}
              disabled={generatingSample}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <Film className="h-4 w-4" />
              {generatingSample ? 'Generating...' : 'Generate Sample Pack'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((asset) => (
            <article
              key={asset.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden flex flex-col"
            >
              {/* Media Preview Frame */}
              <div className="relative aspect-video bg-zinc-950 flex items-center justify-center overflow-hidden">
                {asset.kind === 'video' && asset.hasThumbnail ? (
                  <img
                    src={`/api/media/${asset.id}/thumbnail`}
                    alt={asset.originalName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : asset.kind === 'image' ? (
                  <img
                    src={`/api/media/${asset.id}/thumbnail`}
                    alt={asset.originalName}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-contain p-4 bg-zinc-900"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    {asset.kind === 'audio' ? (
                      <Music className="h-8 w-8" />
                    ) : asset.kind === 'subtitle' ? (
                      <FileText className="h-8 w-8" />
                    ) : (
                      <ImageIcon className="h-8 w-8" />
                    )}
                    <span className="text-xs font-mono uppercase">{asset.kind}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void openPreview(asset)}
                  aria-label={`Preview ${asset.originalName}`}
                  className="absolute inset-0 bg-black/0 hover:bg-black/45 transition-colors flex items-center justify-center group"
                >
                  <span className="h-10 w-10 rounded-full bg-white/90 text-zinc-950 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="h-4 w-4 ml-0.5" />
                  </span>
                </button>

                {asset.durationSec !== null && (
                  <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-white">
                    {formatDuration(asset.durationSec)}
                  </span>
                )}
              </div>

              {/* Card Body */}
              <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                <div>
                  <h3
                    className="text-sm font-semibold text-zinc-950 dark:text-zinc-100 truncate"
                    title={asset.originalName}
                  >
                    {asset.originalName}
                  </h3>
                  <p className="mt-1 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="capitalize">{asset.isExport ? 'Export' : asset.kind}</span>
                    {asset.width && asset.height && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {asset.width}×{asset.height}
                        </span>
                      </>
                    )}
                    {asset.fps && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{asset.fps} fps</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{formatBytes(asset.sizeBytes)}</span>
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {[asset.videoCodec, asset.audioCodec].filter(Boolean).join(' / ') || asset.mimeType} ·{' '}
                    {formatTimeAgo(asset.createdAt)}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    {asset.kind === 'video' && (
                      <button
                        type="button"
                        onClick={() => onOpenInEditor(asset.id)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                    <a
                      href={`/api/media/${asset.id}/stream?download=1`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleDelete(asset)}
                    aria-label={`Delete ${asset.originalName}`}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="w-full max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50 truncate">
                  {previewAsset.originalName}
                </h3>
                <p className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {previewAsset.width && previewAsset.height ? `${previewAsset.width}×${previewAsset.height} · ` : ''}
                  {previewAsset.durationSec !== null ? `${formatDuration(previewAsset.durationSec)} · ` : ''}
                  {formatBytes(previewAsset.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAsset(null)}
                aria-label="Close preview"
                className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 bg-zinc-950 flex items-center justify-center max-h-[70vh] overflow-auto">
              {previewAsset.kind === 'video' ? (
                <video
                  src={`/api/media/${previewAsset.id}/stream`}
                  controls
                  autoPlay
                  className="max-h-[60vh] max-w-full rounded"
                />
              ) : previewAsset.kind === 'audio' ? (
                <audio src={`/api/media/${previewAsset.id}/stream`} controls autoPlay className="w-full max-w-md" />
              ) : previewAsset.kind === 'image' ? (
                <img
                  src={`/api/media/${previewAsset.id}/stream`}
                  alt={previewAsset.originalName}
                  referrerPolicy="no-referrer"
                  className="max-h-[60vh] max-w-full object-contain"
                />
              ) : (
                <pre className="w-full text-left font-mono text-xs text-zinc-200 whitespace-pre-wrap p-3 bg-zinc-900 rounded-lg">
                  {previewSrtText ?? 'Loading subtitle contents...'}
                </pre>
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {previewAsset.videoCodec ? `Video: ${previewAsset.videoCodec}` : ''}{' '}
                {previewAsset.audioCodec ? `· Audio: ${previewAsset.audioCodec}` : ''}
              </span>
              <div className="flex items-center gap-2">
                {previewAsset.kind === 'video' && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = previewAsset.id;
                      setPreviewAsset(null);
                      onOpenInEditor(id);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Open in Video Editor
                  </button>
                )}
                <a
                  href={`/api/media/${previewAsset.id}/stream?download=1`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
