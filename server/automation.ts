import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAutomationConfig,
  insertJob,
  insertMediaAsset,
  updateAutomationConfig,
} from './db.ts';
import { generateThumbnail, probeMedia } from './ffmpeg.ts';
import {
  THUMBNAILS_DIR,
  UPLOADS_DIR,
  WATCH_INBOX_DIR,
  assertSafePath,
} from './paths.ts';
import { assertSafePublicUrl } from './urlImport.ts';
import type { EditPipelineConfig, MediaAsset } from '../src/types/studio.ts';

const WATCH_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

let fsWatcher: fs.FSWatcher | null = null;
const processedFiles = new Set<string>();
let onAutoIngestedCallback: ((asset: MediaAsset) => void) | null = null;
let onQueueRequestedCallback: (() => void) | null = null;

export function isWatcherRunning(): boolean {
  return fsWatcher !== null;
}

export function setAutomationCallbacks(opts: {
  onMediaAdded: (asset: MediaAsset) => void;
  onQueueReady: () => void;
}): void {
  onAutoIngestedCallback = opts.onMediaAdded;
  onQueueRequestedCallback = opts.onQueueReady;
}

async function ingestWatchedFile(filename: string): Promise<void> {
  const ext = path.extname(filename).toLowerCase();
  if (!WATCH_VIDEO_EXTS.has(ext)) return;

  const fullPath = assertSafePath(WATCH_INBOX_DIR, path.join(WATCH_INBOX_DIR, path.basename(filename)));
  if (!fs.existsSync(fullPath)) return;

  const stat = fs.statSync(fullPath);
  if (!stat.isFile() || stat.size < 1024) return;

  const key = `${path.basename(filename)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  if (processedFiles.has(key)) return;
  processedFiles.add(key);

  const cfg = getAutomationConfig(isWatcherRunning());
  if (!cfg.folderWatchEnabled) return;

  try {
    const assetId = crypto.randomUUID();
    const destFilename = `${assetId}${ext}`;
    const destPath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, destFilename));
    fs.copyFileSync(fullPath, destPath);

    const probe = await probeMedia(destPath);
    const thumbPath = assertSafePath(THUMBNAILS_DIR, path.join(THUMBNAILS_DIR, `${assetId}.jpg`));
    const hasThumb = await generateThumbnail(destPath, thumbPath, Math.min(1, (probe.durationSec || 2) / 2));

    const asset = insertMediaAsset({
      id: assetId,
      filename: destFilename,
      originalName: path.basename(filename),
      kind: 'video',
      mimeType: ext === '.webm' ? 'video/webm' : 'video/mp4',
      sizeBytes: stat.size,
      durationSec: probe.durationSec,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      bitrate: probe.bitrate,
      thumbnailPath: hasThumb ? thumbPath : null,
      storagePath: destPath,
      isExport: false,
    });

    onAutoIngestedCallback?.(asset);

    // Queue an automatic clip render job respecting automation settings
    const clipPayload: EditPipelineConfig = {
      mediaId: asset.id,
      outputName: `auto_${path.parse(filename).name}`,
      trimEnabled: false,
      startSec: 0,
      endSec: probe.durationSec || 12,
      aspectRatio: cfg.aspectRatio,
      fitMode: 'blur_pad',
      resolution: '720p',
      crf: 23,
      preset: 'veryfast',
      subtitleEnabled: false,
      subtitlePosition: 'bottom',
      subtitleFontSize: 22,
      logoEnabled: false,
      logoCorner: 'top-right',
      logoScalePct: 16,
      logoOpacity: 0.85,
      audioMode: 'keep',
      musicVolume: 0.35,
    };

    insertJob({
      id: crypto.randomUUID(),
      type: 'edit_pipeline',
      title: `[Auto-Watch] ${asset.originalName} (${cfg.aspectRatio})`,
      inputMediaId: asset.id,
      payload: clipPayload as unknown as Record<string, unknown>,
    });

    updateAutomationConfig(
      {
        lastEventMessage: `Auto-ingested "${path.basename(filename)}" and queued ${cfg.aspectRatio} render.`,
        lastEventAt: new Date().toISOString(),
      },
      isWatcherRunning(),
    );

    onQueueRequestedCallback?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Folder watch ingest error';
    updateAutomationConfig(
      {
        lastEventMessage: `Watch error on "${path.basename(filename)}": ${msg}`,
        lastEventAt: new Date().toISOString(),
      },
      isWatcherRunning(),
    );
  }
}

export function syncFolderWatcher(): boolean {
  const cfg = getAutomationConfig(false);
  if (cfg.folderWatchEnabled) {
    if (!fsWatcher) {
      fs.mkdirSync(WATCH_INBOX_DIR, { recursive: true });
      fsWatcher = fs.watch(WATCH_INBOX_DIR, (_eventType, filename) => {
        if (filename) {
          setTimeout(() => {
            void ingestWatchedFile(filename.toString());
          }, 400);
        }
      });
      fsWatcher.on('error', () => {
        stopFolderWatcher();
      });
    }
    return true;
  } else {
    stopFolderWatcher();
    return false;
  }
}

export function stopFolderWatcher(): void {
  if (fsWatcher) {
    try {
      fsWatcher.close();
    } catch {
      // Ignore
    }
    fsWatcher = null;
  }
}

export async function dispatchAutomationWebhook(payload: {
  event: string;
  title: string;
  details: string;
  status: string;
}): Promise<{ ok: boolean; statusCode?: number; message: string }> {
  const cfg = getAutomationConfig(isWatcherRunning());
  if (!cfg.webhookEnabled || !cfg.webhookUrl.trim()) {
    return { ok: false, message: 'Webhook notifications are disabled or URL is empty.' };
  }

  try {
    const safeUrl = await assertSafePublicUrl(cfg.webhookUrl);
    const body =
      cfg.webhookType === 'discord'
        ? {
            username: 'OpenVideo Studio',
            content: `**${payload.title}**\nStatus: \`${payload.status}\`\n${payload.details}`,
          }
        : {
            source: 'OpenVideo Studio',
            timestamp: new Date().toISOString(),
            ...payload,
          };

    const resp = await fetch(safeUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });

    const ok = resp.ok;
    const message = ok
      ? `Webhook delivered (HTTP ${resp.status}).`
      : `Webhook endpoint rejected payload with HTTP ${resp.status}.`;

    updateAutomationConfig(
      {
        lastEventMessage: `${payload.event}: ${message}`,
        lastEventAt: new Date().toISOString(),
      },
      isWatcherRunning(),
    );
    return { ok, statusCode: resp.status, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook request failed';
    updateAutomationConfig(
      {
        lastEventMessage: `Webhook error: ${message}`,
        lastEventAt: new Date().toISOString(),
      },
      isWatcherRunning(),
    );
    return { ok: false, message };
  }
}
