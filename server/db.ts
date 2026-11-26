import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { DB_PATH, WATCH_INBOX_DIR, ensureDirectories, safeUnlink } from './paths.ts';
import type {
  AiProviderConfig,
  AiProviderId,
  AspectRatioMode,
  AutomationConfig,
  BrandTemplate,
  CampaignRecord,
  CaptionStylePreset,
  ClippingMode,
  CreatorProfile,
  CropRegion,
  FfmpegSpeedPreset,
  JobRecord,
  JobStatus,
  JobType,
  LogoCorner,
  MediaAsset,
  MediaKind,
  SubtitlePosition,
  VerticalFitMode,
  ViralClipRecord,
  WorkerSettings,
} from '../src/types/studio.ts';

ensureDirectories();

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    duration_sec REAL,
    width INTEGER,
    height INTEGER,
    fps REAL,
    video_codec TEXT,
    audio_codec TEXT,
    bitrate INTEGER,
    thumbnail_path TEXT,
    storage_path TEXT NOT NULL,
    is_export INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_created_at ON media_assets(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_media_kind ON media_assets(kind);

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    stage_message TEXT NOT NULL DEFAULT 'Waiting in queue',
    input_media_id TEXT,
    payload_json TEXT NOT NULL,
    output_media_id TEXT,
    ffmpeg_args_preview TEXT,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_jobs_created_desc ON jobs(created_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    is_default INTEGER NOT NULL DEFAULT 0,
    env_var_name TEXT,
    pricing_tier TEXT NOT NULL,
    last_tested_at TEXT,
    last_test_ok INTEGER,
    last_test_message TEXT
  );

  CREATE TABLE IF NOT EXISTS viral_clips (
    id TEXT PRIMARY KEY,
    media_id TEXT NOT NULL,
    creator_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    hook TEXT NOT NULL,
    hashtags_json TEXT NOT NULL DEFAULT '[]',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL DEFAULT 'Highlight',
    viral_score INTEGER NOT NULL DEFAULT 0,
    score_explanation TEXT NOT NULL DEFAULT '',
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    transcript_excerpt TEXT NOT NULL DEFAULT '',
    srt_content TEXT NOT NULL DEFAULT '',
    restricted_warnings_json TEXT NOT NULL DEFAULT '[]',
    analysis_mode TEXT NOT NULL DEFAULT 'balanced',
    provider_used TEXT NOT NULL DEFAULT 'Non-AI',
    status TEXT NOT NULL DEFAULT 'draft',
    output_media_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_clips_media ON viral_clips(media_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_clips_created ON viral_clips(created_at DESC);

  CREATE TABLE IF NOT EXISTS brand_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automation_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    folder_watch_enabled INTEGER NOT NULL DEFAULT 0,
    watch_dir TEXT NOT NULL,
    clips_per_video INTEGER NOT NULL DEFAULT 3,
    processing_mode TEXT NOT NULL DEFAULT 'balanced',
    aspect_ratio TEXT NOT NULL DEFAULT '9:16',
    webhook_enabled INTEGER NOT NULL DEFAULT 0,
    webhook_type TEXT NOT NULL DEFAULT 'discord',
    webhook_url TEXT NOT NULL DEFAULT '',
    words_to_avoid_json TEXT NOT NULL DEFAULT '[]',
    last_event_message TEXT,
    last_event_at TEXT
  );

  CREATE TABLE IF NOT EXISTS creators (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    channel_url TEXT NOT NULL,
    handle TEXT NOT NULL,
    auto_clip_enabled INTEGER NOT NULL DEFAULT 0,
    monitoring_enabled INTEGER NOT NULL DEFAULT 0,
    live_status TEXT NOT NULL DEFAULT 'unconfirmed',
    live_status_note TEXT NOT NULL DEFAULT 'Not checked yet',
    last_checked_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'unconfirmed',
    eligibility_summary TEXT NOT NULL DEFAULT '',
    payout_info TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// Seed default low-resource settings (all env vars strictly optional)
const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
seedSetting.run('concurrency', String(parseEnvInt('WORKER_CONCURRENCY', 1, 1, 4)));
seedSetting.run('ffmpegThreads', String(parseEnvInt('FFMPEG_THREADS', 2, 1, 8)));
seedSetting.run('defaultPreset', 'veryfast');
seedSetting.run('queuePaused', 'false');

// Seed modular AI providers (all local & cloud AI providers are strictly optional)
const seedProvider = db.prepare(`
  INSERT OR IGNORE INTO ai_providers
    (id, name, kind, base_url, model, enabled, is_default, env_var_name, pricing_tier)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const ollamaEnvUrl = process.env.OLLAMA_BASE_URL?.trim();
const lmStudioEnvUrl = process.env.LMSTUDIO_BASE_URL?.trim();
const customAiEnvUrl = process.env.CUSTOM_AI_BASE_URL?.trim();

const defaultProviders: Array<[AiProviderId, string, 'local' | 'cloud', string, string, number, number, string | null, string]> = [
  ['gemini', 'Google Gemini', 'cloud', 'https://generativelanguage.googleapis.com', 'gemini-4-hydrogen', 1, 1, 'GEMINI_API_KEY', 'Free tier / Paid API'],
  ['ollama', 'Ollama (Local, Optional)', 'local', ollamaEnvUrl || 'http://127.0.0.1:11434', 'llama3.2:3b', ollamaEnvUrl ? 1 : 0, 0, null, 'Optional Local Compute'],
  ['lmstudio', 'LM Studio / llama.cpp (Optional)', 'local', lmStudioEnvUrl || 'http://127.0.0.1:1234/v1', 'local-model', lmStudioEnvUrl ? 1 : 0, 0, null, 'Optional Local Compute'],
  ['groq', 'Groq', 'cloud', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile', 1, 0, 'GROQ_API_KEY', 'Free tier / Paid API'],
  ['openrouter', 'OpenRouter', 'cloud', 'https://openrouter.ai/api/v1', 'meta-llama/llama-3.3-70b-instruct:free', 1, 0, 'OPENROUTER_API_KEY', 'Free models / Paid BYOK'],
  ['deepseek', 'DeepSeek', 'cloud', 'https://api.deepseek.com/v1', 'deepseek-chat', 0, 0, 'DEEPSEEK_API_KEY', 'Paid API'],
  ['openai', 'OpenAI', 'cloud', 'https://api.openai.com/v1', 'gpt-4o-mini', 0, 0, 'OPENAI_API_KEY', 'Paid API'],
  ['custom_openai', 'Custom OpenAI-Compatible', 'cloud', customAiEnvUrl || 'https://api.example.com/v1', 'custom-model', 0, 0, 'CUSTOM_AI_API_KEY', 'Custom / BYOK'],
];

for (const row of defaultProviders) {
  seedProvider.run(...row);
}

// Seed singleton automation config
db.prepare(`
  INSERT OR IGNORE INTO automation_settings (
    id, folder_watch_enabled, watch_dir, clips_per_video, processing_mode,
    aspect_ratio, webhook_enabled, webhook_type, webhook_url, words_to_avoid_json
  ) VALUES (1, 0, ?, 3, 'balanced', '9:16', 0, 'discord', '', '["guaranteed viral","free money","100% legit"]')
`).run(WATCH_INBOX_DIR);

// Recover stale running/paused jobs on boot
db.prepare(`
  UPDATE jobs
  SET status = 'failed',
      stage_message = 'Interrupted by server restart',
      error_message = 'Worker process stopped before render completed. Click Retry to run again.'
  WHERE status IN ('running', 'paused')
`).run();

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export interface InternalMediaRow {
  id: string;
  filename: string;
  original_name: string;
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  bitrate: number | null;
  thumbnail_path: string | null;
  storage_path: string;
  is_export: number;
  created_at: string;
}

interface InternalJobRow {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  progress: number;
  stage_message: string;
  input_media_id: string | null;
  payload_json: string;
  output_media_id: string | null;
  ffmpeg_args_preview: string | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface InternalProviderRow {
  id: AiProviderId;
  name: string;
  kind: 'local' | 'cloud';
  base_url: string;
  model: string;
  enabled: number;
  is_default: number;
  env_var_name: string | null;
  pricing_tier: string;
  last_tested_at: string | null;
  last_test_ok: number | null;
  last_test_message: string | null;
}

interface InternalClipRow {
  id: string;
  media_id: string;
  creator_id: string | null;
  title: string;
  description: string;
  hook: string;
  hashtags_json: string;
  keywords_json: string;
  category: string;
  viral_score: number;
  score_explanation: string;
  start_sec: number;
  end_sec: number;
  transcript_excerpt: string;
  srt_content: string;
  restricted_warnings_json: string;
  analysis_mode: ClippingMode;
  provider_used: string;
  status: 'draft' | 'queued' | 'rendered';
  output_media_id: string | null;
  created_at: string;
}

interface InternalAutomationRow {
  folder_watch_enabled: number;
  watch_dir: string;
  clips_per_video: number;
  processing_mode: ClippingMode;
  aspect_ratio: AspectRatioMode;
  webhook_enabled: number;
  webhook_type: 'discord' | 'zapier' | 'custom';
  webhook_url: string;
  words_to_avoid_json: string;
  last_event_message: string | null;
  last_event_at: string | null;
}

interface InternalCreatorRow {
  id: string;
  name: string;
  platform: 'youtube' | 'twitch' | 'kick' | 'other';
  channel_url: string;
  handle: string;
  auto_clip_enabled: number;
  monitoring_enabled: number;
  live_status: 'live' | 'offline' | 'unconfirmed';
  live_status_note: string;
  last_checked_at: string | null;
  created_at: string;
}

interface InternalCampaignRow {
  id: string;
  name: string;
  brand_name: string;
  platform: string;
  verification_status: 'verified' | 'unconfirmed';
  eligibility_summary: string;
  payout_info: string;
  source_url: string;
  status: 'active' | 'paused' | 'ended';
  notes: string;
  created_at: string;
}

function mapMediaRow(row: InternalMediaRow): MediaAsset {
  return {
    id: row.id,
    filename: row.filename,
    originalName: row.original_name,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    durationSec: row.duration_sec,
    width: row.width,
    height: row.height,
    fps: row.fps,
    videoCodec: row.video_codec,
    audioCodec: row.audio_codec,
    bitrate: row.bitrate,
    hasThumbnail: Boolean(row.thumbnail_path && fs.existsSync(row.thumbnail_path)),
    isExport: row.is_export === 1,
    createdAt: row.created_at,
  };
}

function mapJobRow(row: InternalJobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    status: row.status,
    progress: row.progress,
    stageMessage: row.stage_message,
    inputMediaId: row.input_media_id,
    payload: safeJsonParse<Record<string, unknown>>(row.payload_json, {}),
    outputMediaId: row.output_media_id,
    ffmpegArgsPreview: row.ffmpeg_args_preview,
    errorMessage: row.error_message,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function mapProviderRow(row: InternalProviderRow): AiProviderConfig {
  const configured =
    row.kind === 'local'
      ? row.enabled === 1 && Boolean(row.base_url.trim())
      : Boolean(
          row.env_var_name &&
            process.env[row.env_var_name] &&
            process.env[row.env_var_name]!.trim().length > 0 &&
            !process.env[row.env_var_name]!.startsWith('MY_'),
        );

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    model: row.model,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    envVarName: row.env_var_name,
    configured,
    pricingTier: row.pricing_tier,
    lastTestedAt: row.last_tested_at,
    lastTestOk: row.last_test_ok === null ? null : row.last_test_ok === 1,
    lastTestMessage: row.last_test_message,
  };
}

function mapClipRow(row: InternalClipRow): ViralClipRecord {
  return {
    id: row.id,
    mediaId: row.media_id,
    creatorId: row.creator_id,
    title: row.title,
    description: row.description,
    hook: row.hook,
    hashtags: safeJsonParse<string[]>(row.hashtags_json, []),
    keywords: safeJsonParse<string[]>(row.keywords_json, []),
    category: row.category,
    viralScore: row.viral_score,
    scoreExplanation: row.score_explanation,
    startSec: row.start_sec,
    endSec: row.end_sec,
    transcriptExcerpt: row.transcript_excerpt,
    srtContent: row.srt_content,
    restrictedWarnings: safeJsonParse<string[]>(row.restricted_warnings_json, []),
    analysisMode: row.analysis_mode,
    providerUsed: row.provider_used,
    status: row.status,
    outputMediaId: row.output_media_id,
    createdAt: row.created_at,
  };
}

// --- Media CRUD ---
export function insertMediaAsset(record: {
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
  thumbnailPath: string | null;
  storagePath: string;
  isExport: boolean;
}): MediaAsset {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO media_assets (
      id, filename, original_name, kind, mime_type, size_bytes,
      duration_sec, width, height, fps, video_codec, audio_codec,
      bitrate, thumbnail_path, storage_path, is_export, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.filename,
    record.originalName,
    record.kind,
    record.mimeType,
    record.sizeBytes,
    record.durationSec,
    record.width,
    record.height,
    record.fps,
    record.videoCodec,
    record.audioCodec,
    record.bitrate,
    record.thumbnailPath,
    record.storagePath,
    record.isExport ? 1 : 0,
    createdAt,
  );

  const saved = getMediaRowById(record.id);
  if (!saved) throw new Error('Failed to load inserted media asset');
  return mapMediaRow(saved);
}

export function listMediaAssets(kind?: MediaKind): MediaAsset[] {
  const rows = kind
    ? (db.prepare('SELECT * FROM media_assets WHERE kind = ? ORDER BY created_at DESC').all(kind) as unknown as InternalMediaRow[])
    : (db.prepare('SELECT * FROM media_assets ORDER BY created_at DESC').all() as unknown as InternalMediaRow[]);
  return rows.map(mapMediaRow);
}

export function getMediaRowById(id: string): InternalMediaRow | null {
  const row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id) as unknown as InternalMediaRow | undefined;
  return row ?? null;
}

export function getMediaAssetById(id: string): MediaAsset | null {
  const row = getMediaRowById(id);
  return row ? mapMediaRow(row) : null;
}

export function deleteMediaAssetById(id: string): boolean {
  const row = getMediaRowById(id);
  if (!row) return false;
  safeUnlink(row.storage_path);
  safeUnlink(row.thumbnail_path);
  db.prepare('DELETE FROM media_assets WHERE id = ?').run(id);
  return true;
}

// --- Jobs CRUD ---
export function insertJob(job: {
  id: string;
  type: JobType;
  title: string;
  inputMediaId: string | null;
  payload: Record<string, unknown>;
  ffmpegArgsPreview?: string | null;
}): JobRecord {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO jobs (
      id, type, title, status, progress, stage_message,
      input_media_id, payload_json, ffmpeg_args_preview, created_at
    ) VALUES (?, ?, ?, 'queued', 0, 'Queued for local worker', ?, ?, ?, ?)
  `).run(
    job.id,
    job.type,
    job.title,
    job.inputMediaId,
    JSON.stringify(job.payload),
    job.ffmpegArgsPreview ?? null,
    createdAt,
  );
  const saved = getJobById(job.id);
  if (!saved) throw new Error('Failed to retrieve created job');
  return saved;
}

export function listJobs(limit = 100): JobRecord[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as InternalJobRow[];
  return rows.map(mapJobRow);
}

export function getJobById(id: string): JobRecord | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as InternalJobRow | undefined;
  return row ? mapJobRow(row) : null;
}

export function getNextQueuedJob(): JobRecord | null {
  const row = db
    .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
    .get() as unknown as InternalJobRow | undefined;
  return row ? mapJobRow(row) : null;
}

export function updateJobStatus(
  id: string,
  patch: Partial<{
    status: JobStatus;
    progress: number;
    stageMessage: string;
    outputMediaId: string | null;
    ffmpegArgsPreview: string | null;
    errorMessage: string | null;
    attempts: number;
    startedAt: string | null;
    completedAt: string | null;
  }>,
): JobRecord | null {
  const existing = getJobById(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE jobs SET
      status = ?,
      progress = ?,
      stage_message = ?,
      output_media_id = ?,
      ffmpeg_args_preview = ?,
      error_message = ?,
      attempts = ?,
      started_at = ?,
      completed_at = ?
    WHERE id = ?
  `).run(
    patch.status ?? existing.status,
    patch.progress ?? existing.progress,
    patch.stageMessage ?? existing.stageMessage,
    patch.outputMediaId !== undefined ? patch.outputMediaId : existing.outputMediaId,
    patch.ffmpegArgsPreview !== undefined ? patch.ffmpegArgsPreview : existing.ffmpegArgsPreview,
    patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage,
    patch.attempts ?? existing.attempts,
    patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
    patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
    id,
  );

  return getJobById(id);
}

export function deleteJobById(id: string): boolean {
  const res = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

export function countJobsByStatus(): { active: number; queued: number; completed: number; failed: number } {
  const rows = db
    .prepare('SELECT status, COUNT(*) as cnt FROM jobs GROUP BY status')
    .all() as unknown as Array<{ status: JobStatus; cnt: number }>;

  let active = 0;
  let queued = 0;
  let completed = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === 'running' || row.status === 'paused') active += Number(row.cnt);
    else if (row.status === 'queued') queued += Number(row.cnt);
    else if (row.status === 'completed') completed += Number(row.cnt);
    else if (row.status === 'failed') failed += Number(row.cnt);
  }
  return { active, queued, completed, failed };
}

// --- Settings CRUD ---
export function getSettings(): WorkerSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const presetRaw = map.get('defaultPreset');
  const defaultPreset: FfmpegSpeedPreset =
    presetRaw === 'ultrafast' || presetRaw === 'fast' ? presetRaw : 'veryfast';

  return {
    concurrency: Math.max(1, Math.min(4, Number(map.get('concurrency')) || 1)),
    ffmpegThreads: Math.max(1, Math.min(8, Number(map.get('ffmpegThreads')) || 2)),
    defaultPreset,
    queuePaused: map.get('queuePaused') === 'true',
  };
}

export function updateSettings(patch: Partial<WorkerSettings>): WorkerSettings {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  if (typeof patch.concurrency === 'number' && Number.isFinite(patch.concurrency)) {
    upsert.run('concurrency', String(Math.max(1, Math.min(4, Math.round(patch.concurrency)))));
  }
  if (typeof patch.ffmpegThreads === 'number' && Number.isFinite(patch.ffmpegThreads)) {
    upsert.run('ffmpegThreads', String(Math.max(1, Math.min(8, Math.round(patch.ffmpegThreads)))));
  }
  if (patch.defaultPreset === 'ultrafast' || patch.defaultPreset === 'veryfast' || patch.defaultPreset === 'fast') {
    upsert.run('defaultPreset', patch.defaultPreset);
  }
  if (typeof patch.queuePaused === 'boolean') {
    upsert.run('queuePaused', patch.queuePaused ? 'true' : 'false');
  }
  return getSettings();
}

// --- AI Providers CRUD ---
export function listAiProviders(): AiProviderConfig[] {
  const rows = db
    .prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, kind ASC, name ASC')
    .all() as unknown as InternalProviderRow[];
  return rows.map(mapProviderRow);
}

export function getAiProviderById(id: AiProviderId): AiProviderConfig | null {
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as unknown as InternalProviderRow | undefined;
  return row ? mapProviderRow(row) : null;
}

export function updateAiProvider(
  id: AiProviderId,
  patch: Partial<{
    baseUrl: string;
    model: string;
    enabled: boolean;
    isDefault: boolean;
    lastTestedAt: string;
    lastTestOk: boolean;
    lastTestMessage: string;
  }>,
): AiProviderConfig | null {
  const existing = getAiProviderById(id);
  if (!existing) return null;

  if (patch.isDefault) {
    db.prepare('UPDATE ai_providers SET is_default = 0').run();
  }

  db.prepare(`
    UPDATE ai_providers SET
      base_url = ?,
      model = ?,
      enabled = ?,
      is_default = ?,
      last_tested_at = ?,
      last_test_ok = ?,
      last_test_message = ?
    WHERE id = ?
  `).run(
    patch.baseUrl !== undefined ? patch.baseUrl.trim() : existing.baseUrl,
    patch.model !== undefined ? patch.model.trim() : existing.model,
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
    patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.isDefault ? 1 : 0,
    patch.lastTestedAt !== undefined ? patch.lastTestedAt : existing.lastTestedAt,
    patch.lastTestOk !== undefined ? (patch.lastTestOk ? 1 : 0) : existing.lastTestOk === null ? null : existing.lastTestOk ? 1 : 0,
    patch.lastTestMessage !== undefined ? patch.lastTestMessage : existing.lastTestMessage,
    id,
  );

  return getAiProviderById(id);
}

// --- Viral Clips CRUD ---
export function insertViralClip(clip: Omit<ViralClipRecord, 'createdAt'>): ViralClipRecord {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO viral_clips (
      id, media_id, creator_id, title, description, hook,
      hashtags_json, keywords_json, category, viral_score, score_explanation,
      start_sec, end_sec, transcript_excerpt, srt_content, restricted_warnings_json,
      analysis_mode, provider_used, status, output_media_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clip.id,
    clip.mediaId,
    clip.creatorId ?? null,
    clip.title,
    clip.description,
    clip.hook,
    JSON.stringify(clip.hashtags || []),
    JSON.stringify(clip.keywords || []),
    clip.category || 'Highlight',
    Math.max(0, Math.min(100, Math.round(clip.viralScore))),
    clip.scoreExplanation || '',
    clip.startSec,
    clip.endSec,
    clip.transcriptExcerpt || '',
    clip.srtContent || '',
    JSON.stringify(clip.restrictedWarnings || []),
    clip.analysisMode,
    clip.providerUsed,
    clip.status,
    clip.outputMediaId ?? null,
    createdAt,
  );
  const saved = getViralClipById(clip.id);
  if (!saved) throw new Error('Failed to load inserted clip');
  return saved;
}

export function listViralClips(mediaId?: string): ViralClipRecord[] {
  const rows = mediaId
    ? (db.prepare('SELECT * FROM viral_clips WHERE media_id = ? ORDER BY viral_score DESC, created_at DESC').all(mediaId) as unknown as InternalClipRow[])
    : (db.prepare('SELECT * FROM viral_clips ORDER BY created_at DESC LIMIT 200').all() as unknown as InternalClipRow[]);
  return rows.map(mapClipRow);
}

export function getViralClipById(id: string): ViralClipRecord | null {
  const row = db.prepare('SELECT * FROM viral_clips WHERE id = ?').get(id) as unknown as InternalClipRow | undefined;
  return row ? mapClipRow(row) : null;
}

export function updateViralClip(
  id: string,
  patch: Partial<Omit<ViralClipRecord, 'id' | 'mediaId' | 'createdAt'>>,
): ViralClipRecord | null {
  const existing = getViralClipById(id);
  if (!existing) return null;

  db.prepare(`
    UPDATE viral_clips SET
      creator_id = ?,
      title = ?,
      description = ?,
      hook = ?,
      hashtags_json = ?,
      keywords_json = ?,
      category = ?,
      viral_score = ?,
      score_explanation = ?,
      start_sec = ?,
      end_sec = ?,
      transcript_excerpt = ?,
      srt_content = ?,
      restricted_warnings_json = ?,
      status = ?,
      output_media_id = ?
    WHERE id = ?
  `).run(
    patch.creatorId !== undefined ? patch.creatorId : existing.creatorId,
    patch.title ?? existing.title,
    patch.description ?? existing.description,
    patch.hook ?? existing.hook,
    JSON.stringify(patch.hashtags ?? existing.hashtags),
    JSON.stringify(patch.keywords ?? existing.keywords),
    patch.category ?? existing.category,
    patch.viralScore !== undefined ? Math.max(0, Math.min(100, Math.round(patch.viralScore))) : existing.viralScore,
    patch.scoreExplanation ?? existing.scoreExplanation,
    patch.startSec ?? existing.startSec,
    patch.endSec ?? existing.endSec,
    patch.transcriptExcerpt ?? existing.transcriptExcerpt,
    patch.srtContent ?? existing.srtContent,
    JSON.stringify(patch.restrictedWarnings ?? existing.restrictedWarnings),
    patch.status ?? existing.status,
    patch.outputMediaId !== undefined ? patch.outputMediaId : existing.outputMediaId,
    id,
  );
  return getViralClipById(id);
}

export function deleteViralClipById(id: string): boolean {
  const res = db.prepare('DELETE FROM viral_clips WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

// --- Brand Templates CRUD ---
export function listBrandTemplates(): BrandTemplate[] {
  const rows = db
    .prepare('SELECT id, name, config_json, created_at FROM brand_templates ORDER BY created_at DESC')
    .all() as unknown as Array<{ id: string; name: string; config_json: string; created_at: string }>;

  return rows.map((r) => {
    const parsed = safeJsonParse<Partial<BrandTemplate>>(r.config_json, {});
    return {
      id: r.id,
      name: r.name,
      aspectRatio: (parsed.aspectRatio as AspectRatioMode) || '9:16',
      fitMode: (parsed.fitMode as VerticalFitMode) || 'blur_pad',
      facecamBox: (parsed.facecamBox as CropRegion) || { xPct: 68, yPct: 5, wPct: 28, hPct: 28 },
      gameplayBox: (parsed.gameplayBox as CropRegion) || { xPct: 0, yPct: 10, wPct: 100, hPct: 80 },
      captionStyle: (parsed.captionStyle as CaptionStylePreset) || 'viral_yellow',
      captionColor: parsed.captionColor || '#FFFFFF',
      captionOutlineColor: parsed.captionOutlineColor || '#000000',
      captionFontSize: parsed.captionFontSize || 24,
      captionPosition: (parsed.captionPosition as SubtitlePosition) || 'bottom',
      wordsPerLine: parsed.wordsPerLine || 4,
      logoMediaId: parsed.logoMediaId ?? null,
      logoCorner: (parsed.logoCorner as LogoCorner) || 'top-right',
      logoScalePct: parsed.logoScalePct || 16,
      logoOpacity: parsed.logoOpacity ?? 0.85,
      logoMarginX: parsed.logoMarginX ?? 24,
      logoMarginY: parsed.logoMarginY ?? 24,
      introMediaId: parsed.introMediaId ?? null,
      outroMediaId: parsed.outroMediaId ?? null,
      fadeInSec: parsed.fadeInSec ?? 0,
      fadeOutSec: parsed.fadeOutSec ?? 0,
      brandColor: parsed.brandColor || '#2563EB',
      createdAt: r.created_at,
    };
  });
}

export function upsertBrandTemplate(template: Omit<BrandTemplate, 'createdAt'>): BrandTemplate {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO brand_templates (id, name, config_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(template.id, template.name, JSON.stringify(template), createdAt);
  return { ...template, createdAt };
}

export function deleteBrandTemplateById(id: string): boolean {
  const res = db.prepare('DELETE FROM brand_templates WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

// --- Automation Settings CRUD ---
export function getAutomationConfig(watcherActive = false): AutomationConfig {
  const row = db
    .prepare('SELECT * FROM automation_settings WHERE id = 1')
    .get() as unknown as InternalAutomationRow;
  return {
    folderWatchEnabled: row.folder_watch_enabled === 1,
    watchDir: row.watch_dir,
    clipsPerVideo: row.clips_per_video,
    processingMode: row.processing_mode,
    aspectRatio: row.aspect_ratio,
    webhookEnabled: row.webhook_enabled === 1,
    webhookType: row.webhook_type,
    webhookUrl: row.webhook_url,
    wordsToAvoid: safeJsonParse<string[]>(row.words_to_avoid_json, []),
    lastEventMessage: row.last_event_message,
    lastEventAt: row.last_event_at,
    watcherActive,
  };
}

export function updateAutomationConfig(
  patch: Partial<Omit<AutomationConfig, 'watcherActive'>>,
  watcherActive = false,
): AutomationConfig {
  const current = getAutomationConfig(watcherActive);
  const nextWords = Array.isArray(patch.wordsToAvoid)
    ? patch.wordsToAvoid.map((w) => w.trim()).filter(Boolean).slice(0, 100)
    : current.wordsToAvoid;

  db.prepare(`
    UPDATE automation_settings SET
      folder_watch_enabled = ?,
      clips_per_video = ?,
      processing_mode = ?,
      aspect_ratio = ?,
      webhook_enabled = ?,
      webhook_type = ?,
      webhook_url = ?,
      words_to_avoid_json = ?,
      last_event_message = ?,
      last_event_at = ?
    WHERE id = 1
  `).run(
    patch.folderWatchEnabled !== undefined ? (patch.folderWatchEnabled ? 1 : 0) : current.folderWatchEnabled ? 1 : 0,
    patch.clipsPerVideo !== undefined ? Math.max(1, Math.min(12, Math.round(patch.clipsPerVideo))) : current.clipsPerVideo,
    patch.processingMode ?? current.processingMode,
    patch.aspectRatio ?? current.aspectRatio,
    patch.webhookEnabled !== undefined ? (patch.webhookEnabled ? 1 : 0) : current.webhookEnabled ? 1 : 0,
    patch.webhookType ?? current.webhookType,
    patch.webhookUrl !== undefined ? patch.webhookUrl.trim() : current.webhookUrl,
    JSON.stringify(nextWords),
    patch.lastEventMessage !== undefined ? patch.lastEventMessage : current.lastEventMessage,
    patch.lastEventAt !== undefined ? patch.lastEventAt : current.lastEventAt,
  );
  return getAutomationConfig(watcherActive);
}

// --- Creators CRUD ---
export function listCreators(): CreatorProfile[] {
  const rows = db.prepare('SELECT * FROM creators ORDER BY created_at DESC').all() as unknown as InternalCreatorRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    platform: r.platform,
    channelUrl: r.channel_url,
    handle: r.handle,
    autoClipEnabled: r.auto_clip_enabled === 1,
    monitoringEnabled: r.monitoring_enabled === 1,
    liveStatus: r.live_status,
    liveStatusNote: r.live_status_note,
    lastCheckedAt: r.last_checked_at,
    createdAt: r.created_at,
  }));
}

export function insertCreator(creator: Omit<CreatorProfile, 'createdAt' | 'liveStatus' | 'liveStatusNote' | 'lastCheckedAt'>): CreatorProfile {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO creators (
      id, name, platform, channel_url, handle, auto_clip_enabled, monitoring_enabled, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    creator.id,
    creator.name,
    creator.platform,
    creator.channelUrl,
    creator.handle,
    creator.autoClipEnabled ? 1 : 0,
    creator.monitoringEnabled ? 1 : 0,
    createdAt,
  );
  return listCreators().find((c) => c.id === creator.id)!;
}

export function updateCreator(
  id: string,
  patch: Partial<Omit<CreatorProfile, 'id' | 'createdAt'>>,
): CreatorProfile | null {
  const existing = listCreators().find((c) => c.id === id);
  if (!existing) return null;
  db.prepare(`
    UPDATE creators SET
      name = ?,
      platform = ?,
      channel_url = ?,
      handle = ?,
      auto_clip_enabled = ?,
      monitoring_enabled = ?,
      live_status = ?,
      live_status_note = ?,
      last_checked_at = ?
    WHERE id = ?
  `).run(
    patch.name ?? existing.name,
    patch.platform ?? existing.platform,
    patch.channelUrl ?? existing.channelUrl,
    patch.handle ?? existing.handle,
    patch.autoClipEnabled !== undefined ? (patch.autoClipEnabled ? 1 : 0) : existing.autoClipEnabled ? 1 : 0,
    patch.monitoringEnabled !== undefined ? (patch.monitoringEnabled ? 1 : 0) : existing.monitoringEnabled ? 1 : 0,
    patch.liveStatus ?? existing.liveStatus,
    patch.liveStatusNote ?? existing.liveStatusNote,
    patch.lastCheckedAt !== undefined ? patch.lastCheckedAt : existing.lastCheckedAt,
    id,
  );
  return listCreators().find((c) => c.id === id) ?? null;
}

export function deleteCreatorById(id: string): boolean {
  const res = db.prepare('DELETE FROM creators WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

// --- Campaigns CRUD ---
export function listCampaigns(): CampaignRecord[] {
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as unknown as InternalCampaignRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    brandName: r.brand_name,
    platform: r.platform,
    verificationStatus: r.verification_status,
    eligibilitySummary: r.eligibility_summary,
    payoutInfo: r.payout_info,
    sourceUrl: r.source_url,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
  }));
}

export function insertCampaign(campaign: Omit<CampaignRecord, 'createdAt'>): CampaignRecord {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO campaigns (
      id, name, brand_name, platform, verification_status,
      eligibility_summary, payout_info, source_url, status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    campaign.id,
    campaign.name,
    campaign.brandName,
    campaign.platform,
    campaign.verificationStatus,
    campaign.eligibilitySummary,
    campaign.payoutInfo,
    campaign.sourceUrl,
    campaign.status,
    campaign.notes,
    createdAt,
  );
  return listCampaigns().find((c) => c.id === campaign.id)!;
}

export function deleteCampaignById(id: string): boolean {
  const res = db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}
