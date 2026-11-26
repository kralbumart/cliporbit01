import fs from 'node:fs';
import path from 'node:path';

function envOrDefault(names: string | string[], fallback: string): string {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const raw = process.env[name];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
  }
  return fallback;
}

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.resolve(ROOT_DIR, 'data');
export const DB_PATH = path.resolve(ROOT_DIR, envOrDefault('DATABASE_PATH', './data/openvideo.db'));

export const STORAGE_ROOT = path.resolve(ROOT_DIR, envOrDefault('STORAGE_DIR', './storage'));
export const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
export const EXPORTS_DIR = path.join(STORAGE_ROOT, 'exports');
export const THUMBNAILS_DIR = path.join(STORAGE_ROOT, 'thumbnails');
export const TEMP_DIR = path.join(STORAGE_ROOT, 'temp');
export const WATCH_INBOX_DIR = path.join(STORAGE_ROOT, 'watch_inbox');

export const FFMPEG_BIN = envOrDefault('FFMPEG_PATH', 'ffmpeg');
export const FFPROBE_BIN = envOrDefault('FFPROBE_PATH', 'ffprobe');
export const YTDLP_BIN = envOrDefault(['YT_DLP_PATH', 'YTDLP_PATH'], 'yt-dlp');

export function ensureDirectories(): void {
  const dirs = [
    DATA_DIR,
    path.dirname(DB_PATH),
    STORAGE_ROOT,
    UPLOADS_DIR,
    EXPORTS_DIR,
    THUMBNAILS_DIR,
    TEMP_DIR,
    WATCH_INBOX_DIR,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Verifies a resolved path remains strictly inside the intended base directory.
 */
export function assertSafePath(baseDir: string, targetPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Blocked path outside allowed storage boundary.');
  }
  return resolvedTarget;
}

export function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // Ignore transient temp files removed during traversal
      }
    }
  }
  return total;
}

export function safeUnlink(filePath: string | null | undefined): void {
  if (!filePath) return;
  try {
    const resolved = assertSafePath(STORAGE_ROOT, filePath);
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch {
    // Ignore missing or already cleaned files
  }
}
