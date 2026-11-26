import type {
  AiProviderConfig,
  AiProviderId,
  AutomationConfig,
  BrandTemplate,
  CampaignRecord,
  ClippingMode,
  CreatorProfile,
  EditPipelineConfig,
  ExtractAudioConfig,
  JobRecord,
  MediaAsset,
  MediaKind,
  MergeVideosConfig,
  SilenceSegment,
  SystemMetrics,
  UrlInspectResult,
  ViralClipRecord,
  ViralClipRules,
  WorkerSettings,
} from '../types/studio';

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export const studioApi = {
  getMetrics: () => apiRequest<SystemMetrics>('/api/system/metrics'),
  getSettings: () => apiRequest<WorkerSettings>('/api/settings'),
  updateSettings: (patch: Partial<WorkerSettings>) =>
    apiRequest<WorkerSettings>('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  // Universal Video URL Input
  inspectUrl: (url: string) =>
    apiRequest<UrlInspectResult>('/api/url/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  importUrl: (url: string) =>
    apiRequest<{
      mode: 'direct_downloaded' | 'queued_ytdlp';
      asset?: MediaAsset;
      job?: JobRecord;
      inspect: UrlInspectResult;
    }>('/api/url/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  // AI Providers
  listAiProviders: () => apiRequest<AiProviderConfig[]>('/api/ai/providers'),
  updateAiProvider: (
    id: AiProviderId,
    patch: Partial<Pick<AiProviderConfig, 'baseUrl' | 'model' | 'enabled' | 'isDefault'>>,
  ) =>
    apiRequest<AiProviderConfig>(`/api/ai/providers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  testAiProvider: (id: AiProviderId) =>
    apiRequest<{ ok: boolean; message: string; models?: string[]; providers: AiProviderConfig[] }>(
      `/api/ai/providers/${encodeURIComponent(id)}/test`,
      { method: 'POST' },
    ),

  // AI Transcription & Viral Clipping
  transcribeVideo: (mediaId: string, language = 'Auto') =>
    apiRequest<{ transcript: string; srtContent: string; providerUsed: string }>('/api/ai/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaId, language }),
    }),

  analyzeClips: (payload: {
    mediaId: string;
    transcript: string;
    mode: ClippingMode;
    providerId?: AiProviderId | null;
    creatorId?: string | null;
    rules: ViralClipRules;
  }) =>
    apiRequest<{ clips: ViralClipRecord[]; providerUsed: string; warning?: string }>('/api/ai/analyze-clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  listClips: (mediaId?: string) =>
    apiRequest<ViralClipRecord[]>(mediaId ? `/api/clips?mediaId=${encodeURIComponent(mediaId)}` : '/api/clips'),

  updateClip: (id: string, patch: Partial<ViralClipRecord>) =>
    apiRequest<ViralClipRecord>(`/api/clips/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteClip: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/clips/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  renderClip: (id: string, opts?: { templateId?: string | null; aspectRatio?: string }) =>
    apiRequest<{ job: JobRecord; clip: ViralClipRecord }>(`/api/clips/${encodeURIComponent(id)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    }),

  // Brand Templates
  listTemplates: () => apiRequest<BrandTemplate[]>('/api/templates'),
  saveTemplate: (template: Partial<BrandTemplate>) =>
    apiRequest<BrandTemplate>('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    }),
  deleteTemplate: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Automation
  getAutomation: () => apiRequest<AutomationConfig>('/api/automation'),
  updateAutomation: (patch: Partial<AutomationConfig>) =>
    apiRequest<AutomationConfig>('/api/automation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  testWebhook: () =>
    apiRequest<{ ok: boolean; statusCode?: number; message: string }>('/api/automation/test-webhook', {
      method: 'POST',
    }),
  triggerSampleInbox: () =>
    apiRequest<{ ok: boolean; droppedFile: string; watchDir: string }>('/api/automation/trigger-sample-inbox', {
      method: 'POST',
    }),

  // Creators & Campaigns
  listCreators: () => apiRequest<CreatorProfile[]>('/api/creators'),
  createCreator: (payload: {
    name: string;
    platform: 'youtube' | 'twitch' | 'kick' | 'other';
    channelUrl: string;
    handle: string;
    autoClipEnabled: boolean;
    monitoringEnabled: boolean;
  }) =>
    apiRequest<CreatorProfile>('/api/creators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  updateCreator: (id: string, patch: Partial<Pick<CreatorProfile, 'autoClipEnabled' | 'monitoringEnabled'>>) =>
    apiRequest<CreatorProfile>(`/api/creators/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  checkCreator: (id: string) =>
    apiRequest<CreatorProfile>(`/api/creators/${encodeURIComponent(id)}/check`, { method: 'POST' }),
  deleteCreator: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/creators/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listCampaigns: () => apiRequest<CampaignRecord[]>('/api/campaigns'),
  createCampaign: (payload: Omit<CampaignRecord, 'id' | 'createdAt'>) =>
    apiRequest<CampaignRecord>('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  deleteCampaign: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/campaigns/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Media Library
  listMedia: (kind?: MediaKind) =>
    apiRequest<MediaAsset[]>(kind ? `/api/media?kind=${encodeURIComponent(kind)}` : '/api/media'),

  uploadMedia: async (files: FileList | File[]): Promise<{ assets: MediaAsset[] }> => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    return apiRequest<{ assets: MediaAsset[] }>('/api/media/upload', {
      method: 'POST',
      body: form,
    });
  },

  generateSamplePack: () =>
    apiRequest<{
      videoAsset: MediaAsset;
      logoAsset: MediaAsset | null;
      subtitleAsset: MediaAsset | null;
    }>('/api/media/generate-sample', { method: 'POST' }),

  getSubtitleContent: (id: string) =>
    apiRequest<{ id: string; originalName: string; content: string }>(`/api/media/${encodeURIComponent(id)}/content`),

  deleteMedia: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  detectSilences: (mediaId: string, noiseDb: number, minSilenceSec: number) =>
    apiRequest<{ mediaId: string; segments: SilenceSegment[] }>(
      `/api/media/${encodeURIComponent(mediaId)}/silence-detect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noiseDb, minSilenceSec }),
      },
    ),

  // Jobs
  listJobs: () => apiRequest<JobRecord[]>('/api/jobs'),

  createEditJob: (config: EditPipelineConfig) =>
    apiRequest<JobRecord>('/api/jobs/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  createMergeJob: (config: MergeVideosConfig) =>
    apiRequest<JobRecord>('/api/jobs/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  createExtractAudioJob: (config: ExtractAudioConfig) =>
    apiRequest<JobRecord>('/api/jobs/extract-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    }),

  createBatchClipJobs: (payload: {
    mediaId: string;
    aspectRatio: 'original' | '9:16' | '16:9' | '1:1';
    fitMode: 'crop' | 'blur_pad' | 'split_facecam';
    resolution: 'source' | '1080p' | '720p' | '480p';
    segments: Array<{ startSec: number; endSec: number; label?: string }>;
  }) =>
    apiRequest<{ jobs: JobRecord[] }>('/api/jobs/batch-clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  pauseJob: (id: string) => apiRequest<JobRecord>(`/api/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST' }),
  resumeJob: (id: string) => apiRequest<JobRecord>(`/api/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
  cancelJob: (id: string) => apiRequest<JobRecord>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  retryJob: (id: string) => apiRequest<JobRecord>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  deleteJob: (id: string) => apiRequest<{ ok: boolean }>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  pauseQueue: () => apiRequest<{ queuePaused: boolean }>('/api/queue/pause', { method: 'POST' }),
  resumeQueue: () => apiRequest<{ queuePaused: boolean }>('/api/queue/resume', { method: 'POST' }),
  cleanTempStorage: () => apiRequest<{ ok: boolean; removed: number }>('/api/storage/clean-temp', { method: 'POST' }),
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, seconds);
  const mins = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const tenths = Math.floor((total - Math.floor(total)) * 10);
  if (mins > 0) {
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }
  return `${secs}.${tenths}s`;
}

export function formatTimeAgo(isoDate: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
