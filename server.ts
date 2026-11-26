import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import {
  deleteBrandTemplateById,
  deleteCampaignById,
  deleteCreatorById,
  deleteJobById,
  deleteMediaAssetById,
  deleteViralClipById,
  getAutomationConfig,
  getJobById,
  getMediaAssetById,
  getMediaRowById,
  getSettings,
  getViralClipById,
  insertCampaign,
  insertCreator,
  insertJob,
  insertMediaAsset,
  insertViralClip,
  listAiProviders,
  listBrandTemplates,
  listCampaigns,
  listCreators,
  listJobs,
  listMediaAssets,
  listViralClips,
  updateAiProvider,
  updateAutomationConfig,
  updateCreator,
  updateSettings,
  updateViralClip,
  upsertBrandTemplate,
} from './server/db.ts';
import {
  detectActiveSegments,
  generateSampleLogo,
  generateSampleVideo,
  generateThumbnail,
  probeMedia,
} from './server/ffmpeg.ts';
import {
  STORAGE_ROOT,
  THUMBNAILS_DIR,
  UPLOADS_DIR,
  WATCH_INBOX_DIR,
  assertSafePath,
  ensureDirectories,
  safeUnlink,
} from './server/paths.ts';
import {
  broadcastEvent,
  cancelJob,
  pauseJob,
  registerSseClient,
  resumeJob,
  retryJob,
  scheduleQueueDrain,
  setQueuePaused,
} from './server/queue.ts';
import { getSystemMetrics } from './server/system.ts';
import {
  analyzeVideoForViralClips,
  scanRestrictedWords,
  testAiProvider,
  transcribeVideoWithGemini,
} from './server/ai.ts';
import {
  assertSafePublicUrl,
  downloadDirectVideoToDisk,
  inspectVideoUrl,
} from './server/urlImport.ts';
import {
  dispatchAutomationWebhook,
  isWatcherRunning,
  setAutomationCallbacks,
  syncFolderWatcher,
} from './server/automation.ts';
import type {
  AiProviderId,
  BrandTemplate,
  ClippingMode,
  EditPipelineConfig,
  ExtractAudioConfig,
  MediaKind,
  MergeVideosConfig,
  ViralClipRules,
} from './src/types/studio.ts';

ensureDirectories();

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const ALLOWED_EXTENSIONS: Record<string, MediaKind> = {
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.avi': 'video',
  '.m4v': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.aac': 'audio',
  '.ogg': 'audio',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.srt': 'subtitle',
  '.vtt': 'subtitle',
};

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext in ALLOWED_EXTENSIONS ? ext : '.bin';
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 512 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext in ALLOWED_EXTENSIONS) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${ext}". Supported: MP4, MOV, WebM, MKV, MP3, WAV, PNG, JPG, SRT, VTT.`));
    }
  },
});

function streamFileWithRanges(req: Request, res: Response, filePath: string, mimeType: string, downloadName?: string): void {
  const safePath = assertSafePath(STORAGE_ROOT, filePath);
  if (!fs.existsSync(safePath)) {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  const stat = fs.statSync(safePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (downloadName) {
    const safeHeaderName = downloadName.replace(/["\r\n]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeHeaderName}"`);
  }

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(safePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(safePath).pipe(res);
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  setAutomationCallbacks({
    onMediaAdded: (asset) => broadcastEvent('media_added', asset),
    onQueueReady: () => scheduleQueueDrain(),
  });
  syncFolderWatcher();

  // --- Health & Telemetry ---
  app.get('/api/health', (_req, res) => {
    const metrics = getSystemMetrics();
    res.json({
      ok: true,
      ffmpegAvailable: metrics.ffmpegAvailable,
      ytDlpAvailable: metrics.ytDlpAvailable,
      version: '0.4.0-viral-studio',
    });
  });

  app.get('/api/system/metrics', (_req, res) => {
    res.json(getSystemMetrics());
  });

  // --- Server-Sent Events ---
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    registerSseClient(res);
    res.write(`event: metrics\ndata: ${JSON.stringify(getSystemMetrics())}\n\n`);

    req.on('close', () => {
      res.end();
    });
  });

  // --- Settings ---
  app.get('/api/settings', (_req, res) => {
    res.json(getSettings());
  });

  app.patch('/api/settings', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = updateSettings({
      concurrency: typeof body.concurrency === 'number' ? body.concurrency : undefined,
      ffmpegThreads: typeof body.ffmpegThreads === 'number' ? body.ffmpegThreads : undefined,
      defaultPreset:
        body.defaultPreset === 'ultrafast' || body.defaultPreset === 'veryfast' || body.defaultPreset === 'fast'
          ? body.defaultPreset
          : undefined,
      queuePaused: typeof body.queuePaused === 'boolean' ? body.queuePaused : undefined,
    });
    if (!updated.queuePaused) scheduleQueueDrain();
    broadcastEvent('metrics', getSystemMetrics());
    res.json(updated);
  });

  // --- Universal Video URL Inspect & Import ---
  app.post('/api/url/inspect', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Please paste a video URL to inspect.' });
      return;
    }
    try {
      const info = await inspectVideoUrl(rawUrl);
      res.json(info);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid URL' });
    }
  });

  app.post('/api/url/import', async (req, res) => {
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'URL is required.' });
      return;
    }
    try {
      const info = await inspectVideoUrl(rawUrl);
      if (!info.supported) {
        res.status(422).json({ error: info.reason, inspect: info });
        return;
      }

      if (info.platform === 'direct_video') {
        const downloaded = await downloadDirectVideoToDisk(info.url);
        const probe = await probeMedia(downloaded.filePath);
        const assetId = crypto.randomUUID();
        const thumbPath = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${assetId}.jpg`));
        const hasThumb = await generateThumbnail(
          downloaded.filePath,
          thumbPath,
          Math.min(1, (probe.durationSec || 2) / 2),
        );

        const asset = insertMediaAsset({
          id: assetId,
          filename: downloaded.filename,
          originalName: downloaded.originalName,
          kind: 'video',
          mimeType: downloaded.mimeType,
          sizeBytes: downloaded.sizeBytes,
          durationSec: probe.durationSec,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          videoCodec: probe.videoCodec,
          audioCodec: probe.audioCodec,
          bitrate: probe.bitrate,
          thumbnailPath: hasThumb ? thumbPath : null,
          storagePath: downloaded.filePath,
          isExport: false,
        });

        broadcastEvent('media_added', asset);
        res.status(201).json({ mode: 'direct_downloaded', asset, inspect: info });
        return;
      }

      if (!info.canDownloadNow) {
        res.status(501).json({
          error: info.reason,
          inspect: info,
        });
        return;
      }

      const job = insertJob({
        id: crypto.randomUUID(),
        type: 'url_download',
        title: `Download ${info.title || info.platform.toUpperCase()} Video`,
        inputMediaId: null,
        payload: { url: info.url, title: info.title || undefined },
      });
      broadcastEvent('job_update', job);
      scheduleQueueDrain();
      res.status(202).json({ mode: 'queued_ytdlp', job, inspect: info });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'URL import failed' });
    }
  });

  // --- AI Provider Hub ---
  app.get('/api/ai/providers', (_req, res) => {
    res.json(listAiProviders());
  });

  app.patch('/api/ai/providers/:id', (req, res) => {
    const id = req.params.id as AiProviderId;
    const body = req.body as Record<string, unknown>;
    const updated = updateAiProvider(id, {
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      isDefault: typeof body.isDefault === 'boolean' ? body.isDefault : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'AI provider not found' });
      return;
    }
    res.json(updated);
  });

  app.post('/api/ai/providers/:id/test', async (req, res) => {
    const id = req.params.id as AiProviderId;
    const result = await testAiProvider(id);
    const providers = listAiProviders();
    res.status(result.ok ? 200 : 400).json({ ...result, providers });
  });

  // --- AI Transcription & Viral Clipping Engine ---
  app.post('/api/ai/transcribe', async (req, res) => {
    const mediaId = typeof req.body?.mediaId === 'string' ? req.body.mediaId : '';
    const language = typeof req.body?.language === 'string' ? req.body.language : 'Auto';
    const row = getMediaRowById(mediaId);
    if (!row || (row.kind !== 'video' && row.kind !== 'audio')) {
      res.status(404).json({ error: 'Video or audio asset not found.' });
      return;
    }
    if (!row.audio_codec) {
      res.status(400).json({ error: 'Selected video has no audio track to transcribe.' });
      return;
    }

    try {
      const result = await transcribeVideoWithGemini({
        videoPath: row.storage_path,
        durationSec: row.duration_sec,
        language,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Transcription failed' });
    }
  });

  app.post('/api/ai/analyze-clips', async (req, res) => {
    const body = req.body as {
      mediaId?: string;
      transcript?: string;
      mode?: ClippingMode;
      providerId?: AiProviderId | null;
      creatorId?: string | null;
      rules?: Partial<ViralClipRules>;
    };

    if (!body.mediaId) {
      res.status(400).json({ error: 'mediaId is required.' });
      return;
    }
    const source = getMediaRowById(body.mediaId);
    if (!source || source.kind !== 'video') {
      res.status(404).json({ error: 'Source video not found.' });
      return;
    }

    const mode: ClippingMode =
      body.mode === 'fast' || body.mode === 'best' || body.mode === 'non_ai' ? body.mode : 'balanced';

    const rules: ViralClipRules = {
      strongHook: body.rules?.strongHook ?? true,
      removeSilence: body.rules?.removeSilence ?? true,
      meaningfulContext: body.rules?.meaningfulContext ?? true,
      completeSentences: body.rules?.completeSentences ?? true,
      engagingMoments: body.rules?.engagingMoments ?? true,
      noAbruptEnding: body.rules?.noAbruptEnding ?? true,
      noMisleadingEdits: body.rules?.noMisleadingEdits ?? true,
      minDurationSec: Math.max(2, Math.min(120, Number(body.rules?.minDurationSec) || 5)),
      maxDurationSec: Math.max(5, Math.min(180, Number(body.rules?.maxDurationSec) || 60)),
      maxClips: Math.max(1, Math.min(10, Math.round(Number(body.rules?.maxClips) || 3))),
      language: typeof body.rules?.language === 'string' && body.rules.language.trim() ? body.rules.language.trim() : 'English',
      aspectRatio:
        body.rules?.aspectRatio === '16:9' || body.rules?.aspectRatio === '1:1' || body.rules?.aspectRatio === 'original'
          ? body.rules.aspectRatio
          : '9:16',
      minViralScore: Math.max(0, Math.min(95, Math.round(Number(body.rules?.minViralScore) || 60))),
      sceneDetection: Boolean(body.rules?.sceneDetection),
      facecamSplit: Boolean(body.rules?.facecamSplit),
      speakerFocus: Boolean(body.rules?.speakerFocus),
    };

    try {
      const result = await analyzeVideoForViralClips({
        mediaId: source.id,
        videoPath: source.storage_path,
        videoName: source.original_name,
        durationSec: source.duration_sec || 10,
        hasAudio: Boolean(source.audio_codec),
        transcript: typeof body.transcript === 'string' ? body.transcript : '',
        mode,
        providerId: body.providerId ?? null,
        rules,
        creatorId: body.creatorId ?? null,
      });

      const savedClips = result.clips.map((c) => {
        const saved = insertViralClip(c);
        broadcastEvent('clip_update', saved);
        return saved;
      });

      res.status(201).json({
        clips: savedClips,
        providerUsed: result.providerUsed,
        warning: result.warning,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Clip analysis failed' });
    }
  });

  // --- Viral Clips CRUD & Render ---
  app.get('/api/clips', (req, res) => {
    const mediaId = typeof req.query.mediaId === 'string' ? req.query.mediaId : undefined;
    res.json(listViralClips(mediaId));
  });

  app.patch('/api/clips/:id', (req, res) => {
    const existing = getViralClipById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const automation = getAutomationConfig(isWatcherRunning());
    const nextTitle = typeof body.title === 'string' ? body.title : existing.title;
    const nextDesc = typeof body.description === 'string' ? body.description : existing.description;
    const nextHook = typeof body.hook === 'string' ? body.hook : existing.hook;
    const nextSrt = typeof body.srtContent === 'string' ? body.srtContent : existing.srtContent;
    const nextTranscript = typeof body.transcriptExcerpt === 'string' ? body.transcriptExcerpt : existing.transcriptExcerpt;
    const nextHashtags = Array.isArray(body.hashtags) ? body.hashtags.map(String) : existing.hashtags;

    const warnings = scanRestrictedWords(
      [nextTitle, nextDesc, nextHook, nextTranscript, nextSrt, ...nextHashtags],
      automation.wordsToAvoid,
    );

    const updated = updateViralClip(req.params.id, {
      title: nextTitle,
      description: nextDesc,
      hook: nextHook,
      hashtags: nextHashtags,
      keywords: Array.isArray(body.keywords) ? body.keywords.map(String) : existing.keywords,
      category: typeof body.category === 'string' ? body.category : existing.category,
      startSec: typeof body.startSec === 'number' ? body.startSec : existing.startSec,
      endSec: typeof body.endSec === 'number' ? body.endSec : existing.endSec,
      transcriptExcerpt: nextTranscript,
      srtContent: nextSrt,
      restrictedWarnings: warnings,
    });
    if (updated) broadcastEvent('clip_update', updated);
    res.json(updated);
  });

  app.delete('/api/clips/:id', (req, res) => {
    const ok = deleteViralClipById(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    broadcastEvent('clip_deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/clips/:id/render', (req, res) => {
    const clip = getViralClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found' });
      return;
    }
    const source = getMediaRowById(clip.mediaId);
    if (!source) {
      res.status(404).json({ error: 'Source video for this clip no longer exists.' });
      return;
    }
    const settings = getSettings();
    const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId : null;
    const template = templateId ? listBrandTemplates().find((t) => t.id === templateId) : null;

    const payload: EditPipelineConfig = {
      mediaId: source.id,
      clipId: clip.id,
      outputName: clip.title.replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 48) || `clip_${clip.id.slice(0, 6)}`,
      trimEnabled: true,
      startSec: clip.startSec,
      endSec: clip.endSec,
      aspectRatio: template?.aspectRatio || (req.body?.aspectRatio as EditPipelineConfig['aspectRatio']) || '9:16',
      fitMode: template?.fitMode || 'blur_pad',
      facecamBox: template?.facecamBox,
      gameplayBox: template?.gameplayBox,
      resolution: '720p',
      crf: 23,
      preset: settings.defaultPreset,
      subtitleEnabled: Boolean(clip.srtContent.trim()),
      subtitleInlineSrt: clip.srtContent,
      subtitlePosition: template?.captionPosition || 'bottom',
      subtitleFontSize: template?.captionFontSize || 24,
      captionStyle: template?.captionStyle || 'viral_yellow',
      captionColor: template?.captionColor,
      captionOutlineColor: template?.captionOutlineColor,
      logoEnabled: Boolean(template?.logoMediaId),
      logoMediaId: template?.logoMediaId || null,
      logoCorner: template?.logoCorner || 'top-right',
      logoScalePct: template?.logoScalePct || 16,
      logoOpacity: template?.logoOpacity ?? 0.85,
      logoMarginX: template?.logoMarginX ?? 24,
      logoMarginY: template?.logoMarginY ?? 24,
      fadeInSec: template?.fadeInSec ?? 0,
      fadeOutSec: template?.fadeOutSec ?? 0,
      introMediaId: template?.introMediaId ?? null,
      outroMediaId: template?.outroMediaId ?? null,
      audioMode: 'keep',
      musicVolume: 0.35,
    };

    const job = insertJob({
      id: crypto.randomUUID(),
      type: 'clip_export',
      title: `Viral Clip: ${clip.title} (${payload.aspectRatio})`,
      inputMediaId: source.id,
      payload: payload as unknown as Record<string, unknown>,
    });

    const updatedClip = updateViralClip(clip.id, { status: 'queued' });
    if (updatedClip) broadcastEvent('clip_update', updatedClip);
    broadcastEvent('job_update', job);
    scheduleQueueDrain();
    res.status(201).json({ job, clip: updatedClip });
  });

  // --- Brand & Layout Templates ---
  app.get('/api/templates', (_req, res) => {
    res.json(listBrandTemplates());
  });

  app.post('/api/templates', (req, res) => {
    const body = req.body as Partial<BrandTemplate>;
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Custom Studio Template';
    const saved = upsertBrandTemplate({
      id: body.id || crypto.randomUUID(),
      name,
      aspectRatio: body.aspectRatio || '9:16',
      fitMode: body.fitMode || 'blur_pad',
      facecamBox: body.facecamBox || { xPct: 68, yPct: 4, wPct: 28, hPct: 30 },
      gameplayBox: body.gameplayBox || { xPct: 0, yPct: 12, wPct: 100, hPct: 76 },
      captionStyle: body.captionStyle || 'viral_yellow',
      captionColor: body.captionColor || '#FFFFFF',
      captionOutlineColor: body.captionOutlineColor || '#000000',
      captionFontSize: body.captionFontSize || 24,
      captionPosition: body.captionPosition || 'bottom',
      wordsPerLine: body.wordsPerLine || 4,
      logoMediaId: body.logoMediaId ?? null,
      logoCorner: body.logoCorner || 'top-right',
      logoScalePct: body.logoScalePct || 16,
      logoOpacity: body.logoOpacity ?? 0.85,
      logoMarginX: body.logoMarginX ?? 24,
      logoMarginY: body.logoMarginY ?? 24,
      introMediaId: body.introMediaId ?? null,
      outroMediaId: body.outroMediaId ?? null,
      fadeInSec: body.fadeInSec ?? 0,
      fadeOutSec: body.fadeOutSec ?? 0,
      brandColor: body.brandColor || '#2563EB',
    });
    res.status(201).json(saved);
  });

  app.delete('/api/templates/:id', (req, res) => {
    const ok = deleteBrandTemplateById(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Automation (Folder Watcher, Webhooks, Words-to-Avoid) ---
  app.get('/api/automation', (_req, res) => {
    res.json(getAutomationConfig(isWatcherRunning()));
  });

  app.patch('/api/automation', (req, res) => {
    const body = req.body as Record<string, unknown>;
    updateAutomationConfig(
      {
        folderWatchEnabled: typeof body.folderWatchEnabled === 'boolean' ? body.folderWatchEnabled : undefined,
        clipsPerVideo: typeof body.clipsPerVideo === 'number' ? body.clipsPerVideo : undefined,
        processingMode:
          body.processingMode === 'fast' ||
          body.processingMode === 'balanced' ||
          body.processingMode === 'best' ||
          body.processingMode === 'non_ai'
            ? body.processingMode
            : undefined,
        aspectRatio:
          body.aspectRatio === '9:16' ||
          body.aspectRatio === '16:9' ||
          body.aspectRatio === '1:1' ||
          body.aspectRatio === 'original'
            ? body.aspectRatio
            : undefined,
        webhookEnabled: typeof body.webhookEnabled === 'boolean' ? body.webhookEnabled : undefined,
        webhookType:
          body.webhookType === 'discord' || body.webhookType === 'zapier' || body.webhookType === 'custom'
            ? body.webhookType
            : undefined,
        webhookUrl: typeof body.webhookUrl === 'string' ? body.webhookUrl : undefined,
        wordsToAvoid: Array.isArray(body.wordsToAvoid) ? body.wordsToAvoid.map(String) : undefined,
      },
      isWatcherRunning(),
    );

    const active = syncFolderWatcher();
    const updated = getAutomationConfig(active);
    broadcastEvent('metrics', getSystemMetrics());
    res.json(updated);
  });

  app.post('/api/automation/test-webhook', async (_req, res) => {
    const result = await dispatchAutomationWebhook({
      event: 'test_notification',
      title: 'OpenVideo Studio Webhook Test',
      status: 'connected',
      details: 'Verified live webhook delivery from OpenVideo Studio automation engine.',
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/automation/trigger-sample-inbox', async (_req, res) => {
    const cfg = getAutomationConfig(isWatcherRunning());
    if (!cfg.folderWatchEnabled) {
      res.status(400).json({ error: 'Enable Folder Watching first to test automatic inbox ingestion.' });
      return;
    }
    const existingVideo = listMediaAssets('video')[0];
    if (!existingVideo) {
      res.status(400).json({ error: 'Generate a sample video or upload one first.' });
      return;
    }
    const row = getMediaRowById(existingVideo.id);
    if (!row || !fs.existsSync(row.storage_path)) {
      res.status(404).json({ error: 'Source file not found.' });
      return;
    }
    const dropName = `inbox_drop_${Date.now().toString().slice(-5)}.mp4`;
    const target = assertSafePath(WATCH_INBOX_DIR, path.join(WATCH_INBOX_DIR, dropName));
    fs.copyFileSync(row.storage_path, target);
    res.json({ ok: true, droppedFile: dropName, watchDir: WATCH_INBOX_DIR });
  });

  // --- Creators & Campaigns ---
  app.get('/api/creators', (_req, res) => {
    res.json(listCreators());
  });

  app.post('/api/creators', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const channelUrl = typeof body.channelUrl === 'string' ? body.channelUrl.trim() : '';
    if (!name || !channelUrl) {
      res.status(400).json({ error: 'Creator name and channel URL are required.' });
      return;
    }
    const creator = insertCreator({
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      platform:
        body.platform === 'youtube' || body.platform === 'twitch' || body.platform === 'kick'
          ? body.platform
          : 'other',
      channelUrl: channelUrl.slice(0, 300),
      handle: typeof body.handle === 'string' ? body.handle.trim().slice(0, 80) : name,
      autoClipEnabled: Boolean(body.autoClipEnabled),
      monitoringEnabled: Boolean(body.monitoringEnabled),
    });
    res.status(201).json(creator);
  });

  app.patch('/api/creators/:id', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const updated = updateCreator(req.params.id, {
      autoClipEnabled: typeof body.autoClipEnabled === 'boolean' ? body.autoClipEnabled : undefined,
      monitoringEnabled: typeof body.monitoringEnabled === 'boolean' ? body.monitoringEnabled : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }
    res.json(updated);
  });

  app.post('/api/creators/:id/check', async (req, res) => {
    const creator = listCreators().find((c) => c.id === req.params.id);
    if (!creator) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }
    const now = new Date().toISOString();
    try {
      const safeUrl = await assertSafePublicUrl(creator.channelUrl);
      const resp = await fetch(safeUrl.toString(), { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      const reachable = resp.ok || resp.status === 405;
      const updated = updateCreator(creator.id, {
        liveStatus: 'unconfirmed',
        liveStatusNote: reachable
          ? `Channel URL reachable (HTTP ${resp.status}). Live stream state is Unconfirmed until official platform API credentials or local yt-dlp monitor is connected.`
          : `Channel check returned HTTP ${resp.status}. Live state unconfirmed.`,
        lastCheckedAt: now,
      });
      res.json(updated);
    } catch (err) {
      const updated = updateCreator(creator.id, {
        liveStatus: 'unconfirmed',
        liveStatusNote: `Check failed: ${err instanceof Error ? err.message : 'Unable to reach channel URL'}`,
        lastCheckedAt: now,
      });
      res.json(updated);
    }
  });

  app.delete('/api/creators/:id', (req, res) => {
    const ok = deleteCreatorById(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Creator not found' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/campaigns', (_req, res) => {
    res.json(listCampaigns());
  });

  app.post('/api/campaigns', (req, res) => {
    const body = req.body as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const brandName = typeof body.brandName === 'string' ? body.brandName.trim() : '';
    if (!name || !brandName) {
      res.status(400).json({ error: 'Campaign name and brand name are required.' });
      return;
    }
    const campaign = insertCampaign({
      id: crypto.randomUUID(),
      name: name.slice(0, 100),
      brandName: brandName.slice(0, 80),
      platform: typeof body.platform === 'string' ? body.platform.slice(0, 40) : 'YouTube Shorts / TikTok',
      verificationStatus: body.verificationStatus === 'verified' ? 'verified' : 'unconfirmed',
      eligibilitySummary: typeof body.eligibilitySummary === 'string' ? body.eligibilitySummary.slice(0, 300) : '',
      payoutInfo: typeof body.payoutInfo === 'string' ? body.payoutInfo.slice(0, 200) : 'Unconfirmed — verify directly with campaign sponsor',
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.trim().slice(0, 300) : '',
      status: body.status === 'paused' || body.status === 'ended' ? body.status : 'active',
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 400) : '',
    });
    res.status(201).json(campaign);
  });

  app.delete('/api/campaigns/:id', (req, res) => {
    const ok = deleteCampaignById(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Media Library ---
  app.get('/api/media', (req, res) => {
    const kindParam = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const validKind: MediaKind | undefined =
      kindParam === 'video' || kindParam === 'audio' || kindParam === 'image' || kindParam === 'subtitle'
        ? kindParam
        : undefined;
    res.json(listMediaAssets(validKind));
  });

  app.post('/api/media/upload', (req, res) => {
    upload.array('files', 10)(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
        return;
      }

      const files = (req.files as Express.Multer.File[]) || [];
      if (files.length === 0) {
        res.status(400).json({ error: 'No files uploaded.' });
        return;
      }

      const created = [];
      for (const file of files) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const kind: MediaKind = ALLOWED_EXTENSIONS[ext] || 'video';
        const assetId = crypto.randomUUID();
        const safeFilePath = assertSafePath(STORAGE_ROOT, file.path);

        let durationSec: number | null = null;
        let width: number | null = null;
        let height: number | null = null;
        let fps: number | null = null;
        let videoCodec: string | null = null;
        let audioCodec: string | null = null;
        let bitrate: number | null = null;
        let thumbPath: string | null = null;

        if (kind === 'video' || kind === 'audio' || kind === 'image') {
          const probe = await probeMedia(safeFilePath);
          durationSec = probe.durationSec;
          width = probe.width;
          height = probe.height;
          fps = probe.fps;
          videoCodec = probe.videoCodec;
          audioCodec = probe.audioCodec;
          bitrate = probe.bitrate;

          if (kind === 'video') {
            const candidateThumb = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${assetId}.jpg`));
            const ok = await generateThumbnail(safeFilePath, candidateThumb, Math.min(1, (durationSec || 2) / 2));
            if (ok) thumbPath = candidateThumb;
          }
        }

        const saved = insertMediaAsset({
          id: assetId,
          filename: file.filename,
          originalName: path.basename(file.originalname || file.filename),
          kind,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          durationSec,
          width,
          height,
          fps,
          videoCodec,
          audioCodec,
          bitrate,
          thumbnailPath: thumbPath,
          storagePath: safeFilePath,
          isExport: false,
        });

        broadcastEvent('media_added', saved);
        created.push(saved);
      }

      res.status(201).json({ assets: created });
    });
  });

  app.post('/api/media/generate-sample', async (_req, res) => {
    try {
      const settings = getSettings();
      const videoId = crypto.randomUUID();
      const videoFilename = `${videoId}.mp4`;
      const videoPath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, videoFilename));

      const okVideo = await generateSampleVideo(videoPath, settings.ffmpegThreads);
      if (!okVideo) {
        res.status(500).json({ error: 'FFmpeg failed to generate the sample video.' });
        return;
      }

      const probe = await probeMedia(videoPath);
      const thumbPath = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${videoId}.jpg`));
      const hasThumb = await generateThumbnail(videoPath, thumbPath, 1.5);
      const vStat = fs.statSync(videoPath);

      const videoAsset = insertMediaAsset({
        id: videoId,
        filename: videoFilename,
        originalName: 'OpenVideo_Sample_720p_12s.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        sizeBytes: vStat.size,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        bitrate: probe.bitrate,
        thumbnailPath: hasThumb ? thumbPath : null,
        storagePath: videoPath,
        isExport: false,
      });
      broadcastEvent('media_added', videoAsset);

      let logoAsset = listMediaAssets('image')[0] ?? null;
      if (!logoAsset) {
        const logoId = crypto.randomUUID();
        const logoPath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, `${logoId}.png`));
        const okLogo = await generateSampleLogo(logoPath);
        if (okLogo) {
          const lStat = fs.statSync(logoPath);
          const lProbe = await probeMedia(logoPath);
          logoAsset = insertMediaAsset({
            id: logoId,
            filename: `${logoId}.png`,
            originalName: 'OpenVideo_Watermark_Logo.png',
            kind: 'image',
            mimeType: 'image/png',
            sizeBytes: lStat.size,
            durationSec: null,
            width: lProbe.width,
            height: lProbe.height,
            fps: null,
            videoCodec: lProbe.videoCodec,
            audioCodec: null,
            bitrate: null,
            thumbnailPath: null,
            storagePath: logoPath,
            isExport: false,
          });
          broadcastEvent('media_added', logoAsset);
        }
      }

      let subtitleAsset = listMediaAssets('subtitle')[0] ?? null;
      if (!subtitleAsset) {
        const subId = crypto.randomUUID();
        const subPath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, `${subId}.srt`));
        const sampleSrt = [
          '1',
          '00:00:00,400 --> 00:00:04,000',
          'Welcome to OpenVideo Studio — Viral Clipping Engine',
          '',
          '2',
          '00:00:04,200 --> 00:00:07,500',
          'Detect strong hooks and convert 16:9 to 9:16 locally',
          '',
          '3',
          '00:00:07,700 --> 00:00:11,600',
          'Export captioned Shorts on 8 GB RAM with zero Docker',
          '',
        ].join('\n');
        fs.writeFileSync(subPath, sampleSrt, 'utf8');
        const sStat = fs.statSync(subPath);
        subtitleAsset = insertMediaAsset({
          id: subId,
          filename: `${subId}.srt`,
          originalName: 'Sample_Captions.srt',
          kind: 'subtitle',
          mimeType: 'application/x-subrip',
          sizeBytes: sStat.size,
          durationSec: null,
          width: null,
          height: null,
          fps: null,
          videoCodec: null,
          audioCodec: null,
          bitrate: null,
          thumbnailPath: null,
          storagePath: subPath,
          isExport: false,
        });
        broadcastEvent('media_added', subtitleAsset);
      }

      res.status(201).json({ videoAsset, logoAsset, subtitleAsset });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sample generation failed' });
    }
  });

  app.get('/api/media/:id', (req, res) => {
    const asset = getMediaAssetById(req.params.id);
    if (!asset) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }
    res.json(asset);
  });

  app.get('/api/media/:id/content', (req, res) => {
    const row = getMediaRowById(req.params.id);
    if (!row || row.kind !== 'subtitle') {
      res.status(404).json({ error: 'Subtitle file not found' });
      return;
    }
    try {
      const safePath = assertSafePath(STORAGE_ROOT, row.storage_path);
      const text = fs.readFileSync(safePath, 'utf8');
      res.json({ id: row.id, originalName: row.original_name, content: text });
    } catch {
      res.status(404).json({ error: 'Subtitle file unreadable' });
    }
  });

  app.get('/api/media/:id/stream', (req, res) => {
    const row = getMediaRowById(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }
    const isDownload = req.query.download === '1';
    streamFileWithRanges(req, res, row.storage_path, row.mime_type, isDownload ? row.original_name : undefined);
  });

  app.get('/api/media/:id/thumbnail', (req, res) => {
    const row = getMediaRowById(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }
    const targetPath = row.kind === 'image' ? row.storage_path : row.thumbnail_path;
    if (!targetPath) {
      res.status(404).json({ error: 'Thumbnail unavailable' });
      return;
    }
    streamFileWithRanges(req, res, targetPath, row.kind === 'image' ? row.mime_type : 'image/jpeg');
  });

  app.delete('/api/media/:id', (req, res) => {
    const deleted = deleteMediaAssetById(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }
    broadcastEvent('media_deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/media/:id/silence-detect', async (req, res) => {
    const row = getMediaRowById(req.params.id);
    if (!row || row.kind !== 'video') {
      res.status(404).json({ error: 'Video asset not found' });
      return;
    }
    if (!row.audio_codec) {
      res.status(400).json({ error: 'This video has no audio track for silence detection.' });
      return;
    }
    try {
      const body = (req.body || {}) as { noiseDb?: number; minSilenceSec?: number };
      const segments = await detectActiveSegments(
        row.storage_path,
        row.duration_sec || 10,
        typeof body.noiseDb === 'number' ? body.noiseDb : -30,
        typeof body.minSilenceSec === 'number' ? body.minSilenceSec : 0.8,
      );
      res.json({ mediaId: row.id, segments });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Silence detection failed' });
    }
  });

  // --- Jobs API ---
  app.get('/api/jobs', (_req, res) => {
    res.json(listJobs(100));
  });

  app.post('/api/jobs/edit', (req, res) => {
    const body = req.body as Partial<EditPipelineConfig>;
    if (!body.mediaId || typeof body.mediaId !== 'string') {
      res.status(400).json({ error: 'mediaId is required.' });
      return;
    }
    const source = getMediaRowById(body.mediaId);
    if (!source || source.kind !== 'video') {
      res.status(404).json({ error: 'Source video not found.' });
      return;
    }

    const settings = getSettings();
    const config: EditPipelineConfig = {
      mediaId: body.mediaId,
      clipId: typeof body.clipId === 'string' ? body.clipId : null,
      outputName: typeof body.outputName === 'string' ? body.outputName.slice(0, 80) : undefined,
      trimEnabled: Boolean(body.trimEnabled),
      startSec: Number(body.startSec) || 0,
      endSec: Number(body.endSec) || source.duration_sec || 10,
      segments: Array.isArray(body.segments) ? body.segments : undefined,
      aspectRatio:
        body.aspectRatio === '9:16' || body.aspectRatio === '16:9' || body.aspectRatio === '1:1'
          ? body.aspectRatio
          : 'original',
      fitMode:
        body.fitMode === 'blur_pad' || body.fitMode === 'split_facecam' ? body.fitMode : 'crop',
      facecamBox: body.facecamBox,
      gameplayBox: body.gameplayBox,
      resolution:
        body.resolution === '1080p' || body.resolution === '720p' || body.resolution === '480p'
          ? body.resolution
          : 'source',
      crf: Math.max(16, Math.min(35, Math.round(Number(body.crf) || 23))),
      preset:
        body.preset === 'ultrafast' || body.preset === 'veryfast' || body.preset === 'fast'
          ? body.preset
          : settings.defaultPreset,
      subtitleEnabled: Boolean(body.subtitleEnabled),
      subtitleMediaId: typeof body.subtitleMediaId === 'string' ? body.subtitleMediaId : null,
      subtitleInlineSrt: typeof body.subtitleInlineSrt === 'string' ? body.subtitleInlineSrt.slice(0, 100000) : '',
      subtitlePosition:
        body.subtitlePosition === 'top' || body.subtitlePosition === 'middle' ? body.subtitlePosition : 'bottom',
      subtitleFontSize: Math.max(12, Math.min(48, Math.round(Number(body.subtitleFontSize) || 22))),
      captionStyle: body.captionStyle || 'classic_bold',
      captionColor: typeof body.captionColor === 'string' ? body.captionColor : undefined,
      captionOutlineColor: typeof body.captionOutlineColor === 'string' ? body.captionOutlineColor : undefined,
      wordsPerLine: typeof body.wordsPerLine === 'number' ? body.wordsPerLine : undefined,
      logoEnabled: Boolean(body.logoEnabled),
      logoMediaId: typeof body.logoMediaId === 'string' ? body.logoMediaId : null,
      logoCorner:
        body.logoCorner === 'top-left' ||
        body.logoCorner === 'top-right' ||
        body.logoCorner === 'bottom-left'
          ? body.logoCorner
          : 'bottom-right',
      logoScalePct: Math.max(5, Math.min(45, Math.round(Number(body.logoScalePct) || 18))),
      logoOpacity: Math.max(0.1, Math.min(1, Number(body.logoOpacity) || 0.85)),
      logoMarginX: typeof body.logoMarginX === 'number' ? body.logoMarginX : 24,
      logoMarginY: typeof body.logoMarginY === 'number' ? body.logoMarginY : 24,
      fadeInSec: typeof body.fadeInSec === 'number' ? body.fadeInSec : 0,
      fadeOutSec: typeof body.fadeOutSec === 'number' ? body.fadeOutSec : 0,
      introMediaId: typeof body.introMediaId === 'string' ? body.introMediaId : null,
      outroMediaId: typeof body.outroMediaId === 'string' ? body.outroMediaId : null,
      audioMode:
        body.audioMode === 'mute' || body.audioMode === 'mix_music' || body.audioMode === 'replace_music'
          ? body.audioMode
          : 'keep',
      musicMediaId: typeof body.musicMediaId === 'string' ? body.musicMediaId : null,
      musicVolume: Math.max(0.05, Math.min(1.5, Number(body.musicVolume) || 0.35)),
    };

    const labels: string[] = [];
    if (config.aspectRatio !== 'original') labels.push(config.aspectRatio);
    if (config.fitMode === 'split_facecam') labels.push('Facecam Split');
    if (config.segments && config.segments.length > 1) labels.push(`${config.segments.length} Segments`);
    else if (config.trimEnabled) labels.push(`Trim ${config.startSec.toFixed(1)}s-${config.endSec.toFixed(1)}s`);
    if (config.subtitleEnabled) labels.push('Captions');
    if (config.logoEnabled) labels.push('Watermark');
    const summary = labels.length > 0 ? labels.join(' + ') : 'Transcode';

    const job = insertJob({
      id: crypto.randomUUID(),
      type: 'edit_pipeline',
      title: `${config.outputName || source.original_name} (${summary})`,
      inputMediaId: source.id,
      payload: config as unknown as Record<string, unknown>,
    });

    broadcastEvent('job_update', job);
    scheduleQueueDrain();
    res.status(201).json(job);
  });

  app.post('/api/jobs/merge', (req, res) => {
    const body = req.body as Partial<MergeVideosConfig>;
    if (!Array.isArray(body.mediaIds) || body.mediaIds.length < 2) {
      res.status(400).json({ error: 'Select at least 2 videos to merge.' });
      return;
    }

    const settings = getSettings();
    const config: MergeVideosConfig = {
      mediaIds: body.mediaIds.filter((id): id is string => typeof id === 'string').slice(0, 12),
      outputName: typeof body.outputName === 'string' ? body.outputName.slice(0, 80) : undefined,
      aspectRatio:
        body.aspectRatio === '9:16' || body.aspectRatio === '16:9' || body.aspectRatio === '1:1'
          ? body.aspectRatio
          : '16:9',
      resolution: body.resolution === '1080p' || body.resolution === '480p' ? body.resolution : '720p',
      crf: Math.max(16, Math.min(35, Math.round(Number(body.crf) || 23))),
      preset:
        body.preset === 'ultrafast' || body.preset === 'veryfast' || body.preset === 'fast'
          ? body.preset
          : settings.defaultPreset,
    };

    const job = insertJob({
      id: crypto.randomUUID(),
      type: 'merge_videos',
      title: `Merge ${config.mediaIds.length} Videos (${config.aspectRatio} ${config.resolution})`,
      inputMediaId: config.mediaIds[0] || null,
      payload: config as unknown as Record<string, unknown>,
    });

    broadcastEvent('job_update', job);
    scheduleQueueDrain();
    res.status(201).json(job);
  });

  app.post('/api/jobs/extract-audio', (req, res) => {
    const body = req.body as Partial<ExtractAudioConfig>;
    if (!body.mediaId || typeof body.mediaId !== 'string') {
      res.status(400).json({ error: 'mediaId is required.' });
      return;
    }
    const source = getMediaRowById(body.mediaId);
    if (!source || source.kind !== 'video') {
      res.status(404).json({ error: 'Source video not found.' });
      return;
    }

    const config: ExtractAudioConfig = {
      mediaId: body.mediaId,
      outputName: typeof body.outputName === 'string' ? body.outputName.slice(0, 80) : undefined,
      format: body.format === 'wav' ? 'wav' : 'mp3',
      bitrateKbps: Math.max(64, Math.min(320, Math.round(Number(body.bitrateKbps) || 192))),
    };

    const job = insertJob({
      id: crypto.randomUUID(),
      type: 'extract_audio',
      title: `Extract ${config.format.toUpperCase()} — ${source.original_name}`,
      inputMediaId: source.id,
      payload: config as unknown as Record<string, unknown>,
    });

    broadcastEvent('job_update', job);
    scheduleQueueDrain();
    res.status(201).json(job);
  });

  app.post('/api/jobs/batch-clips', (req, res) => {
    const body = req.body as {
      mediaId?: string;
      aspectRatio?: 'original' | '9:16' | '16:9' | '1:1';
      fitMode?: 'crop' | 'blur_pad';
      resolution?: 'source' | '1080p' | '720p' | '480p';
      segments?: Array<{ startSec: number; endSec: number; label?: string }>;
    };

    if (!body.mediaId || !Array.isArray(body.segments) || body.segments.length === 0) {
      res.status(400).json({ error: 'mediaId and at least one clip segment are required.' });
      return;
    }
    const source = getMediaRowById(body.mediaId);
    if (!source || source.kind !== 'video') {
      res.status(404).json({ error: 'Source video not found.' });
      return;
    }

    const settings = getSettings();
    const createdJobs = [];
    const safeSegments = body.segments.slice(0, 20);

    for (let i = 0; i < safeSegments.length; i++) {
      const seg = safeSegments[i];
      const startSec = Math.max(0, Number(seg.startSec) || 0);
      const endSec = Math.max(startSec + 0.5, Number(seg.endSec) || startSec + 2);
      const baseName = path.parse(source.original_name).name;
      const clipConfig: EditPipelineConfig = {
        mediaId: source.id,
        outputName: seg.label || `${baseName}_clip_${i + 1}`,
        trimEnabled: true,
        startSec,
        endSec,
        aspectRatio:
          body.aspectRatio === '9:16' || body.aspectRatio === '16:9' || body.aspectRatio === '1:1'
            ? body.aspectRatio
            : '9:16',
        fitMode: body.fitMode === 'blur_pad' ? 'blur_pad' : 'crop',
        resolution:
          body.resolution === '1080p' || body.resolution === '480p' || body.resolution === 'source'
            ? body.resolution
            : '720p',
        crf: 23,
        preset: settings.defaultPreset,
        subtitleEnabled: false,
        subtitlePosition: 'bottom',
        subtitleFontSize: 22,
        logoEnabled: false,
        logoCorner: 'bottom-right',
        logoScalePct: 18,
        logoOpacity: 0.85,
        audioMode: 'keep',
        musicVolume: 0.35,
      };

      const job = insertJob({
        id: crypto.randomUUID(),
        type: 'clip_export',
        title: `Clip #${i + 1} (${startSec.toFixed(1)}s–${endSec.toFixed(1)}s · ${clipConfig.aspectRatio})`,
        inputMediaId: source.id,
        payload: clipConfig as unknown as Record<string, unknown>,
      });
      broadcastEvent('job_update', job);
      createdJobs.push(job);
    }

    scheduleQueueDrain();
    res.status(201).json({ jobs: createdJobs });
  });

  app.post('/api/jobs/:id/pause', (req, res) => {
    const job = pauseJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.post('/api/jobs/:id/resume', (req, res) => {
    const job = resumeJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.post('/api/jobs/:id/cancel', (req, res) => {
    const job = cancelJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.post('/api/jobs/:id/retry', (req, res) => {
    const job = retryJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.delete('/api/jobs/:id', (req, res) => {
    const existing = getJobById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (existing.status === 'running' || existing.status === 'paused') cancelJob(req.params.id);
    deleteJobById(req.params.id);
    broadcastEvent('job_deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  app.post('/api/queue/pause', (_req, res) => {
    setQueuePaused(true);
    res.json({ queuePaused: true });
  });

  app.post('/api/queue/resume', (_req, res) => {
    setQueuePaused(false);
    res.json({ queuePaused: false });
  });

  app.post('/api/storage/clean-temp', (_req, res) => {
    const tempDir = path.join(STORAGE_ROOT, 'temp');
    let removed = 0;
    if (fs.existsSync(tempDir)) {
      for (const name of fs.readdirSync(tempDir)) {
        safeUnlink(path.join(tempDir, name));
        removed++;
      }
    }
    broadcastEvent('metrics', getSystemMetrics());
    res.json({ ok: true, removed });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OpenVideo Studio running at http://localhost:${PORT} (concurrency=${getSettings().concurrency})`);
    scheduleQueueDrain();
  });
}

void startServer();
