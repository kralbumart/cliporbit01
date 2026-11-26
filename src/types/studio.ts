export type MediaKind = 'video' | 'audio' | 'image' | 'subtitle';

export interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  hasThumbnail: boolean;
  isExport: boolean;
  createdAt: string;
}

export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type JobType =
  | 'edit_pipeline'
  | 'merge_videos'
  | 'extract_audio'
  | 'clip_export'
  | 'url_download';

export type AspectRatioMode = 'original' | '9:16' | '16:9' | '1:1';
export type VerticalFitMode = 'crop' | 'blur_pad' | 'split_facecam';
export type ResolutionPreset = 'source' | '1080p' | '720p' | '480p';
export type FfmpegSpeedPreset = 'ultrafast' | 'veryfast' | 'fast';
export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type SubtitlePosition = 'bottom' | 'middle' | 'top';
export type CaptionStylePreset = 'classic_bold' | 'viral_yellow' | 'minimal_clean' | 'cinema_outline';
export type AudioMode = 'keep' | 'mute' | 'mix_music' | 'replace_music';

export interface CropRegion {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface TimelineSegment {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
}

export interface EditPipelineConfig {
  mediaId: string;
  clipId?: string | null;
  outputName?: string;
  trimEnabled: boolean;
  startSec: number;
  endSec: number;
  segments?: TimelineSegment[];
  aspectRatio: AspectRatioMode;
  fitMode: VerticalFitMode;
  facecamBox?: CropRegion;
  gameplayBox?: CropRegion;
  resolution: ResolutionPreset;
  crf: number;
  preset: FfmpegSpeedPreset;
  subtitleEnabled: boolean;
  subtitleMediaId?: string | null;
  subtitleInlineSrt?: string;
  subtitlePosition: SubtitlePosition;
  subtitleFontSize: number;
  captionStyle?: CaptionStylePreset;
  captionColor?: string;
  captionOutlineColor?: string;
  wordsPerLine?: number;
  logoEnabled: boolean;
  logoMediaId?: string | null;
  logoCorner: LogoCorner;
  logoScalePct: number;
  logoOpacity: number;
  logoMarginX?: number;
  logoMarginY?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  introMediaId?: string | null;
  outroMediaId?: string | null;
  audioMode: AudioMode;
  musicMediaId?: string | null;
  musicVolume: number;
}

export interface MergeVideosConfig {
  mediaIds: string[];
  outputName?: string;
  aspectRatio: AspectRatioMode;
  resolution: ResolutionPreset;
  crf: number;
  preset: FfmpegSpeedPreset;
}

export interface ExtractAudioConfig {
  mediaId: string;
  outputName?: string;
  format: 'mp3' | 'wav';
  bitrateKbps: number;
}

export interface JobRecord {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  progress: number;
  stageMessage: string;
  inputMediaId: string | null;
  payload: Record<string, unknown>;
  outputMediaId: string | null;
  ffmpegArgsPreview: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SilenceSegment {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface WorkerSettings {
  concurrency: number;
  ffmpegThreads: number;
  defaultPreset: FfmpegSpeedPreset;
  queuePaused: boolean;
}

export interface SystemMetrics {
  timestamp: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  cpuCores: number;
  cpuUsagePct: number;
  ramTotalMb: number;
  ramUsedMb: number;
  ramFreeMb: number;
  ramUsagePct: number;
  processRssMb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  diskUsedPct: number;
  storageUsedMb: number;
  ffmpegAvailable: boolean;
  ffmpegVersion: string;
  ytDlpAvailable: boolean;
  dockerAvailable: boolean;
  activeJobs: number;
  queuedJobs: number;
  completedJobs: number;
  queuePaused: boolean;
  concurrency: number;
  watcherActive: boolean;
}

// --- Universal URL Input ---
export type VideoPlatform = 'youtube' | 'twitch' | 'kick' | 'direct_video' | 'unsupported';

export interface UrlInspectResult {
  url: string;
  platform: VideoPlatform;
  supported: boolean;
  canDownloadNow: boolean;
  ytDlpAvailable: boolean;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  contentType: string | null;
  contentLengthBytes: number | null;
  reason: string;
}

// --- AI Provider Hub & Clipping Engine ---
export type AiProviderId =
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'groq'
  | 'openrouter'
  | 'deepseek'
  | 'openai'
  | 'custom_openai';

export type ClippingMode = 'fast' | 'balanced' | 'best' | 'non_ai';

export interface AiProviderConfig {
  id: AiProviderId;
  name: string;
  kind: 'local' | 'cloud';
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  envVarName: string | null;
  configured: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  pricingTier: string;
}

export interface ViralClipRules {
  strongHook: boolean;
  removeSilence: boolean;
  meaningfulContext: boolean;
  completeSentences: boolean;
  engagingMoments: boolean;
  noAbruptEnding: boolean;
  noMisleadingEdits: boolean;
  minDurationSec: number;
  maxDurationSec: number;
  maxClips: number;
  language: string;
  aspectRatio: AspectRatioMode;
  minViralScore: number;
  sceneDetection: boolean;
  facecamSplit: boolean;
  speakerFocus: boolean;
}

export interface ViralClipRecord {
  id: string;
  mediaId: string;
  creatorId: string | null;
  title: string;
  description: string;
  hook: string;
  hashtags: string[];
  keywords: string[];
  category: string;
  viralScore: number;
  scoreExplanation: string;
  startSec: number;
  endSec: number;
  transcriptExcerpt: string;
  srtContent: string;
  restrictedWarnings: string[];
  analysisMode: ClippingMode;
  providerUsed: string;
  status: 'draft' | 'queued' | 'rendered';
  outputMediaId: string | null;
  createdAt: string;
}

// --- Branding & Saved Templates ---
export interface BrandTemplate {
  id: string;
  name: string;
  aspectRatio: AspectRatioMode;
  fitMode: VerticalFitMode;
  facecamBox: CropRegion;
  gameplayBox: CropRegion;
  captionStyle: CaptionStylePreset;
  captionColor: string;
  captionOutlineColor: string;
  captionFontSize: number;
  captionPosition: SubtitlePosition;
  wordsPerLine: number;
  logoMediaId: string | null;
  logoCorner: LogoCorner;
  logoScalePct: number;
  logoOpacity: number;
  logoMarginX: number;
  logoMarginY: number;
  introMediaId: string | null;
  outroMediaId: string | null;
  fadeInSec: number;
  fadeOutSec: number;
  brandColor: string;
  createdAt: string;
}

// --- Automation ---
export interface AutomationConfig {
  folderWatchEnabled: boolean;
  watchDir: string;
  clipsPerVideo: number;
  processingMode: ClippingMode;
  aspectRatio: AspectRatioMode;
  webhookEnabled: boolean;
  webhookType: 'discord' | 'zapier' | 'custom';
  webhookUrl: string;
  wordsToAvoid: string[];
  lastEventMessage: string | null;
  lastEventAt: string | null;
  watcherActive: boolean;
}

// --- Creator & Campaign Management ---
export interface CreatorProfile {
  id: string;
  name: string;
  platform: 'youtube' | 'twitch' | 'kick' | 'other';
  channelUrl: string;
  handle: string;
  autoClipEnabled: boolean;
  monitoringEnabled: boolean;
  liveStatus: 'live' | 'offline' | 'unconfirmed';
  liveStatusNote: string;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  brandName: string;
  platform: string;
  verificationStatus: 'verified' | 'unconfirmed';
  eligibilitySummary: string;
  payoutInfo: string;
  sourceUrl: string;
  status: 'active' | 'paused' | 'ended';
  notes: string;
  createdAt: string;
}
