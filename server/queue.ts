import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import {
  getJobById,
  getMediaRowById,
  getNextQueuedJob,
  getSettings,
  insertMediaAsset,
  updateJobStatus,
  updateSettings,
  updateViralClip,
} from './db.ts';
import {
  buildEditPipelineArgs,
  buildExtractAudioArgs,
  buildMergeVideosArgs,
  generateThumbnail,
  probeMedia,
  spawnFfmpegJob,
  writeTempSubtitleFile,
  type RunningFfmpegHandle,
} from './ffmpeg.ts';
import { EXPORTS_DIR, TEMP_DIR, THUMBNAILS_DIR, assertSafePath, safeUnlink } from './paths.ts';
import { getSystemMetrics } from './system.ts';
import { dispatchAutomationWebhook } from './automation.ts';
import { downloadViaYtDlp } from './urlImport.ts';
import type {
  EditPipelineConfig,
  ExtractAudioConfig,
  JobRecord,
  MergeVideosConfig,
} from '../src/types/studio.ts';

interface ActiveExecution {
  jobId: string;
  handle: RunningFfmpegHandle | null;
  outputPath: string;
  tempFiles: string[];
  paused: boolean;
}

const activeExecutions = new Map<string, ActiveExecution>();
const sseClients = new Set<Response>();

export function registerSseClient(res: Response): void {
  sseClients.add(res);
  res.on('close', () => {
    sseClients.delete(res);
  });
}

export function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  if (sseClients.size > 0) {
    broadcastEvent('metrics', getSystemMetrics());
  }
}, 2500);

function emitJobUpdate(job: JobRecord | null): void {
  if (!job) return;
  broadcastEvent('job_update', job);
  broadcastEvent('metrics', getSystemMetrics());
}

export function scheduleQueueDrain(): void {
  const settings = getSettings();
  if (settings.queuePaused) return;

  while (activeExecutions.size < settings.concurrency) {
    const nextJob = getNextQueuedJob();
    if (!nextJob) break;
    void runJob(nextJob);
  }
}

function sanitizeOutputFilename(rawName: string | undefined, fallbackPrefix: string, ext: string): string {
  const cleaned = (rawName || fallbackPrefix)
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 64);
  const base = cleaned || fallbackPrefix;
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return base.toLowerCase().endsWith(normalizedExt) ? base : `${base}${normalizedExt}`;
}

async function runFfmpegPromise(args: string[], targetDurationSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    spawnFfmpegJob({
      args,
      targetDurationSec,
      onProgress: () => {},
      onComplete: () => resolve(),
      onError: (msg) => reject(new Error(msg)),
    });
  });
}

async function runJob(job: JobRecord): Promise<void> {
  const settings = getSettings();
  const tempFiles: string[] = [];
  let outputPath = '';
  let outputExt = '.mp4';
  let outputMime = 'video/mp4';
  let outputKind: 'video' | 'audio' = 'video';
  let displayFilename = `export_${job.id.slice(0, 8)}.mp4`;
  let linkedClipId: string | null = null;
  let introPath: string | null = null;
  let outroPath: string | null = null;
  let editConfigForIntroOutro: EditPipelineConfig | null = null;

  const started = updateJobStatus(job.id, {
    status: 'running',
    progress: 2,
    stageMessage: 'Preparing worker pipeline',
    attempts: job.attempts + 1,
    startedAt: new Date().toISOString(),
    errorMessage: null,
  });
  emitJobUpdate(started);

  try {
    // Handle yt-dlp URL download jobs cleanly
    if (job.type === 'url_download') {
      const payload = job.payload as { url: string; title?: string };
      activeExecutions.set(job.id, {
        jobId: job.id,
        handle: null,
        outputPath: '',
        tempFiles,
        paused: false,
      });

      const downloadId = crypto.randomUUID();
      const dl = await downloadViaYtDlp(payload.url, downloadId, (pct, stage) => {
        emitJobUpdate(updateJobStatus(job.id, { progress: pct, stageMessage: stage }));
      });
      const stat = fs.statSync(dl.filePath);
      const probe = await probeMedia(dl.filePath);
      const thumbPath = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${downloadId}.jpg`));
      const okThumb = await generateThumbnail(dl.filePath, thumbPath, Math.min(1, (probe.durationSec || 2) / 2));

      const asset = insertMediaAsset({
        id: downloadId,
        filename: path.basename(dl.filePath),
        originalName: sanitizeOutputFilename(payload.title, dl.originalName, '.mp4'),
        kind: 'video',
        mimeType: 'video/mp4',
        sizeBytes: stat.size,
        durationSec: probe.durationSec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        bitrate: probe.bitrate,
        thumbnailPath: okThumb ? thumbPath : null,
        storagePath: dl.filePath,
        isExport: false,
      });

      broadcastEvent('media_added', asset);
      const finished = updateJobStatus(job.id, {
        status: 'completed',
        progress: 100,
        stageMessage: 'Downloaded to Media Library',
        outputMediaId: asset.id,
        completedAt: new Date().toISOString(),
      });
      emitJobUpdate(finished);
      activeExecutions.delete(job.id);
      scheduleQueueDrain();
      return;
    }

    let built: { args: string[]; targetDurationSec: number };

    if (job.type === 'edit_pipeline' || job.type === 'clip_export') {
      const cfg = job.payload as unknown as EditPipelineConfig;
      editConfigForIntroOutro = cfg;
      linkedClipId = cfg.clipId || null;

      const source = getMediaRowById(cfg.mediaId);
      if (!source || !fs.existsSync(source.storage_path)) {
        throw new Error('Source media file no longer exists on disk.');
      }

      if (cfg.introMediaId) {
        const introRow = getMediaRowById(cfg.introMediaId);
        if (introRow && fs.existsSync(introRow.storage_path)) introPath = introRow.storage_path;
      }
      if (cfg.outroMediaId) {
        const outroRow = getMediaRowById(cfg.outroMediaId);
        if (outroRow && fs.existsSync(outroRow.storage_path)) outroPath = outroRow.storage_path;
      }

      const outputId = crypto.randomUUID();
      outputExt = '.mp4';
      outputMime = 'video/mp4';
      outputKind = 'video';
      const diskFilename = `${outputId}${outputExt}`;
      outputPath = assertSafePath(EXPORTS_DIR, path.join(EXPORTS_DIR, diskFilename));
      displayFilename = sanitizeOutputFilename(
        cfg.outputName,
        `${path.parse(source.original_name).name}_${cfg.aspectRatio === '9:16' ? 'vertical' : 'edited'}`,
        outputExt,
      );

      let logoPath: string | null = null;
      if (cfg.logoEnabled && cfg.logoMediaId) {
        const logoRow = getMediaRowById(cfg.logoMediaId);
        if (logoRow && fs.existsSync(logoRow.storage_path)) logoPath = logoRow.storage_path;
      }

      let subtitlePath: string | null = null;
      if (cfg.subtitleEnabled) {
        if (cfg.subtitleInlineSrt && cfg.subtitleInlineSrt.trim().length > 0) {
          subtitlePath = writeTempSubtitleFile(job.id, cfg.subtitleInlineSrt);
          tempFiles.push(subtitlePath);
        } else if (cfg.subtitleMediaId) {
          const subRow = getMediaRowById(cfg.subtitleMediaId);
          if (subRow && fs.existsSync(subRow.storage_path)) subtitlePath = subRow.storage_path;
        }
      }

      let musicPath: string | null = null;
      if ((cfg.audioMode === 'mix_music' || cfg.audioMode === 'replace_music') && cfg.musicMediaId) {
        const musicRow = getMediaRowById(cfg.musicMediaId);
        if (musicRow && fs.existsSync(musicRow.storage_path)) musicPath = musicRow.storage_path;
      }

      // If intro or outro attached, render main clip into TEMP_DIR first, then concatenate cleanly
      const renderTarget =
        introPath || outroPath
          ? assertSafePath(TEMP_DIR, path.join(TEMP_DIR, `main_${outputId}.mp4`))
          : outputPath;
      if (renderTarget !== outputPath) tempFiles.push(renderTarget);

      built = buildEditPipelineArgs({
        inputPath: source.storage_path,
        inputHasAudio: Boolean(source.audio_codec),
        sourceWidth: source.width,
        sourceHeight: source.height,
        sourceDurationSec: source.duration_sec,
        outputPath: renderTarget,
        config: cfg,
        logoPath,
        subtitlePath,
        musicPath,
        ffmpegThreads: settings.ffmpegThreads,
      });
    } else if (job.type === 'merge_videos') {
      const cfg = job.payload as unknown as MergeVideosConfig;
      if (!Array.isArray(cfg.mediaIds) || cfg.mediaIds.length < 2) {
        throw new Error('Select at least 2 videos to merge.');
      }

      const inputs: Array<{ path: string; hasAudio: boolean; durationSec: number }> = [];
      for (const id of cfg.mediaIds) {
        const row = getMediaRowById(id);
        if (!row || !fs.existsSync(row.storage_path)) {
          throw new Error(`Missing source video (${id}) for merge.`);
        }
        inputs.push({
          path: row.storage_path,
          hasAudio: Boolean(row.audio_codec),
          durationSec: row.duration_sec || 5,
        });
      }

      const outputId = crypto.randomUUID();
      outputExt = '.mp4';
      outputMime = 'video/mp4';
      outputKind = 'video';
      outputPath = assertSafePath(EXPORTS_DIR, path.join(EXPORTS_DIR, `${outputId}${outputExt}`));
      displayFilename = sanitizeOutputFilename(cfg.outputName, `merged_${inputs.length}_clips`, outputExt);

      built = buildMergeVideosArgs({
        inputs,
        outputPath,
        config: cfg,
        ffmpegThreads: settings.ffmpegThreads,
      });
    } else if (job.type === 'extract_audio') {
      const cfg = job.payload as unknown as ExtractAudioConfig;
      const source = getMediaRowById(cfg.mediaId);
      if (!source || !fs.existsSync(source.storage_path)) {
        throw new Error('Source video no longer exists on disk.');
      }
      if (!source.audio_codec) {
        throw new Error('Source video has no audio track to extract.');
      }

      const outputId = crypto.randomUUID();
      outputExt = cfg.format === 'wav' ? '.wav' : '.mp3';
      outputMime = cfg.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
      outputKind = 'audio';
      outputPath = assertSafePath(EXPORTS_DIR, path.join(EXPORTS_DIR, `${outputId}${outputExt}`));
      displayFilename = sanitizeOutputFilename(
        cfg.outputName,
        `${path.parse(source.original_name).name}_audio`,
        outputExt,
      );

      built = buildExtractAudioArgs({
        inputPath: source.storage_path,
        outputPath,
        config: cfg,
        durationSec: source.duration_sec,
      });
    } else {
      throw new Error(`Unsupported job type: ${String(job.type)}`);
    }

    const previewCmd = `ffmpeg ${built.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
    emitJobUpdate(
      updateJobStatus(job.id, {
        progress: 5,
        stageMessage: 'FFmpeg process started',
        ffmpegArgsPreview: previewCmd,
      }),
    );

    const handle = spawnFfmpegJob({
      args: built.args,
      targetDurationSec: built.targetDurationSec,
      onProgress: (pct, stage) => {
        const scaledPct = introPath || outroPath ? Math.min(82, Math.round(pct * 0.82)) : pct;
        emitJobUpdate(updateJobStatus(job.id, { progress: scaledPct, stageMessage: stage }));
      },
      onComplete: async () => {
        try {
          // Optional Intro / Outro concatenation stage
          if ((introPath || outroPath) && editConfigForIntroOutro) {
            emitJobUpdate(updateJobStatus(job.id, { progress: 86, stageMessage: 'Attaching intro / outro clips' }));
            const mainTemp = tempFiles[tempFiles.length - 1];
            const parts: Array<{ path: string; hasAudio: boolean; durationSec: number }> = [];
            if (introPath) {
              const ip = await probeMedia(introPath);
              parts.push({ path: introPath, hasAudio: Boolean(ip.audioCodec), durationSec: ip.durationSec || 3 });
            }
            const mp = await probeMedia(mainTemp);
            parts.push({ path: mainTemp, hasAudio: Boolean(mp.audioCodec), durationSec: mp.durationSec || 5 });
            if (outroPath) {
              const op = await probeMedia(outroPath);
              parts.push({ path: outroPath, hasAudio: Boolean(op.audioCodec), durationSec: op.durationSec || 3 });
            }

            const mergeBuilt = buildMergeVideosArgs({
              inputs: parts,
              outputPath,
              config: {
                mediaIds: [],
                aspectRatio: editConfigForIntroOutro.aspectRatio === 'original' ? '16:9' : editConfigForIntroOutro.aspectRatio,
                resolution: editConfigForIntroOutro.resolution === 'source' ? '720p' : editConfigForIntroOutro.resolution,
                crf: editConfigForIntroOutro.crf,
                preset: editConfigForIntroOutro.preset,
              },
              ffmpegThreads: settings.ffmpegThreads,
            });
            await runFfmpegPromise(mergeBuilt.args, mergeBuilt.targetDurationSec);
          }

          const stat = fs.statSync(outputPath);
          const probe = await probeMedia(outputPath);
          const outputMediaId = crypto.randomUUID();
          let thumbPath: string | null = null;

          if (outputKind === 'video') {
            const candidateThumb = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${outputMediaId}.jpg`));
            const ok = await generateThumbnail(outputPath, candidateThumb, Math.min(1, (probe.durationSec || 2) / 2));
            if (ok) thumbPath = candidateThumb;
          }

          const asset = insertMediaAsset({
            id: outputMediaId,
            filename: path.basename(outputPath),
            originalName: displayFilename,
            kind: outputKind,
            mimeType: outputMime,
            sizeBytes: stat.size,
            durationSec: probe.durationSec,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            videoCodec: probe.videoCodec,
            audioCodec: probe.audioCodec,
            bitrate: probe.bitrate,
            thumbnailPath: thumbPath,
            storagePath: outputPath,
            isExport: true,
          });

          if (linkedClipId) {
            const updatedClip = updateViralClip(linkedClipId, {
              status: 'rendered',
              outputMediaId: asset.id,
            });
            if (updatedClip) broadcastEvent('clip_update', updatedClip);
          }

          const finished = updateJobStatus(job.id, {
            status: 'completed',
            progress: 100,
            stageMessage: 'Render complete — saved to Media Library',
            outputMediaId: asset.id,
            completedAt: new Date().toISOString(),
          });

          broadcastEvent('media_added', asset);
          emitJobUpdate(finished);

          void dispatchAutomationWebhook({
            event: 'job_completed',
            title: job.title,
            status: 'completed',
            details: `Exported ${asset.originalName} (${asset.width || '?'}x${asset.height || '?'}, ${asset.durationSec || 0}s).`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Failed to finalize exported asset';
          emitJobUpdate(
            updateJobStatus(job.id, {
              status: 'failed',
              stageMessage: 'Export finalization failed',
              errorMessage: msg,
              completedAt: new Date().toISOString(),
            }),
          );
        } finally {
          for (const tf of tempFiles) safeUnlink(tf);
          activeExecutions.delete(job.id);
          scheduleQueueDrain();
        }
      },
      onError: (message) => {
        safeUnlink(outputPath);
        for (const tf of tempFiles) safeUnlink(tf);
        activeExecutions.delete(job.id);

        const failed = updateJobStatus(job.id, {
          status: 'failed',
          stageMessage: 'Render failed',
          errorMessage: message,
          completedAt: new Date().toISOString(),
        });
        emitJobUpdate(failed);
        void dispatchAutomationWebhook({
          event: 'job_failed',
          title: job.title,
          status: 'failed',
          details: message.slice(0, 240),
        });
        scheduleQueueDrain();
      },
    });

    activeExecutions.set(job.id, {
      jobId: job.id,
      handle,
      outputPath,
      tempFiles,
      paused: false,
    });
  } catch (err) {
    safeUnlink(outputPath);
    for (const tf of tempFiles) safeUnlink(tf);
    activeExecutions.delete(job.id);
    const msg = err instanceof Error ? err.message : 'Unknown pipeline error';
    const failed = updateJobStatus(job.id, {
      status: 'failed',
      stageMessage: 'Pipeline setup failed',
      errorMessage: msg,
      completedAt: new Date().toISOString(),
    });
    emitJobUpdate(failed);
    scheduleQueueDrain();
  }
}

export function pauseJob(jobId: string): JobRecord | null {
  const exec = activeExecutions.get(jobId);
  if (exec && exec.handle) {
    const ok = exec.handle.pause();
    if (ok) {
      exec.paused = true;
      const updated = updateJobStatus(jobId, { status: 'paused', stageMessage: 'Paused by user' });
      emitJobUpdate(updated);
      return updated;
    }
  }
  const job = getJobById(jobId);
  if (job && job.status === 'queued') {
    const updated = updateJobStatus(jobId, { status: 'paused', stageMessage: 'Paused in queue' });
    emitJobUpdate(updated);
    return updated;
  }
  return job;
}

export function resumeJob(jobId: string): JobRecord | null {
  const exec = activeExecutions.get(jobId);
  if (exec && exec.handle && exec.paused) {
    const ok = exec.handle.resume();
    if (ok) {
      exec.paused = false;
      const updated = updateJobStatus(jobId, { status: 'running', stageMessage: 'Resumed rendering' });
      emitJobUpdate(updated);
      return updated;
    }
  }
  const job = getJobById(jobId);
  if (job && job.status === 'paused') {
    const updated = updateJobStatus(jobId, { status: 'queued', stageMessage: 'Resumed — queued for worker' });
    emitJobUpdate(updated);
    scheduleQueueDrain();
    return updated;
  }
  return job;
}

export function cancelJob(jobId: string): JobRecord | null {
  const exec = activeExecutions.get(jobId);
  if (exec) {
    exec.handle?.cancel();
    safeUnlink(exec.outputPath);
    for (const tf of exec.tempFiles) safeUnlink(tf);
    activeExecutions.delete(jobId);
  }
  const updated = updateJobStatus(jobId, {
    status: 'cancelled',
    stageMessage: 'Cancelled by user — temporary files released',
    completedAt: new Date().toISOString(),
  });
  emitJobUpdate(updated);
  scheduleQueueDrain();
  return updated;
}

export function retryJob(jobId: string): JobRecord | null {
  const job = getJobById(jobId);
  if (!job) return null;
  if (job.status === 'running') return job;

  const updated = updateJobStatus(jobId, {
    status: 'queued',
    progress: 0,
    stageMessage: 'Re-queued for retry',
    errorMessage: null,
    outputMediaId: null,
    startedAt: null,
    completedAt: null,
  });
  emitJobUpdate(updated);
  scheduleQueueDrain();
  return updated;
}

export function setQueuePaused(paused: boolean): void {
  updateSettings({ queuePaused: paused });
  broadcastEvent('metrics', getSystemMetrics());
  if (!paused) {
    scheduleQueueDrain();
  }
}
