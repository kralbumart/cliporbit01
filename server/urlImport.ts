import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { UPLOADS_DIR, YTDLP_BIN, assertSafePath, safeUnlink } from './paths.ts';
import type { UrlInspectResult, VideoPlatform } from '../src/types/studio.ts';

const DIRECT_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const MAX_REMOTE_VIDEO_BYTES = 250 * 1024 * 1024; // 250 MB safety cap

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

function isPrivateIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
    if (lower.startsWith('::ffff:')) {
      return isPrivateIpv4(lower.replace('::ffff:', ''));
    }
    return false;
  }
  return true;
}

/**
 * Validates that an outbound URL uses http(s) and resolves only to public internet IPs.
 * Prevents SSRF to localhost, private LANs, and cloud metadata endpoints.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format. Provide a valid https:// link.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Local or internal hostnames are blocked for security.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Private or loopback IP addresses are blocked.');
    }
    return parsed;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname "${hostname}".`);
  }

  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error('Target domain resolved to a restricted private or loopback IP address.');
  }
  return parsed;
}

export function detectYtDlpInstalled(): boolean {
  try {
    const res = spawnSync(YTDLP_BIN, ['--version'], { encoding: 'utf8', timeout: 2500, shell: false });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function classifyVideoUrl(parsed: URL): VideoPlatform {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
    return 'youtube';
  }
  if (host === 'twitch.tv' || host === 'm.twitch.tv' || host === 'clips.twitch.tv') {
    return 'twitch';
  }
  if (host === 'kick.com' || host === 'm.kick.com') {
    return 'kick';
  }
  const ext = path.extname(parsed.pathname).toLowerCase();
  if (DIRECT_VIDEO_EXTS.has(ext)) {
    return 'direct_video';
  }
  return 'unsupported';
}

export async function inspectVideoUrl(rawUrl: string): Promise<UrlInspectResult> {
  const parsed = await assertSafePublicUrl(rawUrl);
  const ytDlpAvailable = detectYtDlpInstalled();
  const platform = classifyVideoUrl(parsed);

  if (platform === 'youtube') {
    let title: string | null = null;
    let author: string | null = null;
    let thumbnailUrl: string | null = null;
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.toString())}&format=json`;
      const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = (await resp.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        title = data.title || null;
        author = data.author_name || null;
        thumbnailUrl = data.thumbnail_url || null;
      }
    } catch {
      // oEmbed unreachable or private video
    }

    return {
      url: parsed.toString(),
      platform: 'youtube',
      supported: true,
      canDownloadNow: ytDlpAvailable,
      ytDlpAvailable,
      title,
      author,
      thumbnailUrl,
      contentType: 'video/mp4',
      contentLengthBytes: null,
      reason: ytDlpAvailable
        ? 'YouTube URL verified. Ready to download via local yt-dlp.'
        : 'YouTube metadata verified, but yt-dlp is not installed on this server runtime. Install yt-dlp locally (pip install yt-dlp) for direct YouTube downloads, or upload the MP4 file / paste a direct HTTPS .mp4 link.',
    };
  }

  if (platform === 'twitch' || platform === 'kick') {
    return {
      url: parsed.toString(),
      platform,
      supported: true,
      canDownloadNow: ytDlpAvailable,
      ytDlpAvailable,
      title: `${platform === 'twitch' ? 'Twitch' : 'Kick'} VOD / Clip (${parsed.pathname.slice(1, 48) || 'stream'})`,
      author: null,
      thumbnailUrl: null,
      contentType: 'video/mp4',
      contentLengthBytes: null,
      reason: ytDlpAvailable
        ? `${platform === 'twitch' ? 'Twitch' : 'Kick'} URL recognized. Ready to fetch via local yt-dlp where publicly accessible.`
        : `${platform === 'twitch' ? 'Twitch' : 'Kick'} URL recognized, but yt-dlp is not installed on this host. Run our Windows/Linux setup script (pip install yt-dlp) or upload your local recording.`,
    };
  }

  // Check direct HTTP/HTTPS video stream headers via HEAD
  try {
    const head = await fetch(parsed.toString(), {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    });
    const finalUrl = await assertSafePublicUrl(head.url || parsed.toString());
    const contentType = head.headers.get('content-type') || '';
    const contentLengthHeader = head.headers.get('content-length');
    const contentLengthBytes = contentLengthHeader ? Number(contentLengthHeader) : null;
    const isVideoMime = contentType.toLowerCase().startsWith('video/');

    if (head.ok && (isVideoMime || platform === 'direct_video')) {
      const filename = path.basename(finalUrl.pathname) || 'remote_video.mp4';
      const tooBig = contentLengthBytes !== null && contentLengthBytes > MAX_REMOTE_VIDEO_BYTES;
      return {
        url: finalUrl.toString(),
        platform: 'direct_video',
        supported: !tooBig,
        canDownloadNow: !tooBig,
        ytDlpAvailable,
        title: filename,
        author: finalUrl.hostname,
        thumbnailUrl: null,
        contentType: contentType || 'video/mp4',
        contentLengthBytes: Number.isFinite(contentLengthBytes) ? contentLengthBytes : null,
        reason: tooBig
          ? `Direct video exceeds the ${Math.round(MAX_REMOTE_VIDEO_BYTES / (1024 * 1024))} MB remote import safety limit.`
          : 'Direct HTTPS video stream verified. Ready to download into Media Library.',
      };
    }

    return {
      url: parsed.toString(),
      platform: 'unsupported',
      supported: false,
      canDownloadNow: false,
      ytDlpAvailable,
      title: null,
      author: parsed.hostname,
      thumbnailUrl: null,
      contentType: contentType || null,
      contentLengthBytes: null,
      reason: `URL returned "${contentType || `HTTP ${head.status}`}" which is not a direct video stream or supported platform link (YouTube, Twitch, Kick, or direct .mp4/.webm/.mov).`,
    };
  } catch (err) {
    return {
      url: parsed.toString(),
      platform: 'unsupported',
      supported: false,
      canDownloadNow: false,
      ytDlpAvailable,
      title: null,
      author: parsed.hostname,
      thumbnailUrl: null,
      contentType: null,
      contentLengthBytes: null,
      reason: err instanceof Error ? `Unable to verify URL: ${err.message}` : 'Unable to reach URL.',
    };
  }
}

/**
 * Streams a verified direct HTTPS video file to local disk with strict size cap.
 */
export async function downloadDirectVideoToDisk(
  rawUrl: string,
): Promise<{ filePath: string; filename: string; originalName: string; mimeType: string; sizeBytes: number }> {
  const parsed = await assertSafePublicUrl(rawUrl);
  const resp = await fetch(parsed.toString(), {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`Remote server returned HTTP ${resp.status}.`);
  }

  // Re-validate final redirect destination for SSRF protection
  const finalUrl = await assertSafePublicUrl(resp.url || parsed.toString());
  const contentType = (resp.headers.get('content-type') || 'video/mp4').split(';')[0].trim();
  const extFromUrl = path.extname(finalUrl.pathname).toLowerCase();
  const safeExt = DIRECT_VIDEO_EXTS.has(extFromUrl) ? extFromUrl : '.mp4';
  const originalName = path.basename(finalUrl.pathname) || `imported_video${safeExt}`;

  const filename = `${crypto.randomUUID()}${safeExt}`;
  const filePath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, filename));

  let downloadedBytes = 0;
  const writeStream = fs.createWriteStream(filePath);
  const nodeStream = Readable.fromWeb(resp.body as unknown as import('node:stream/web').ReadableStream);

  nodeStream.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (downloadedBytes > MAX_REMOTE_VIDEO_BYTES) {
      nodeStream.destroy(new Error('Remote video exceeded 250 MB safety cap during download.'));
    }
  });

  try {
    await pipeline(nodeStream, writeStream);
  } catch (err) {
    safeUnlink(filePath);
    throw err;
  }

  return {
    filePath,
    filename,
    originalName,
    mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    sizeBytes: downloadedBytes,
  };
}

/**
 * Downloads via local yt-dlp binary (shell:false) when installed on Windows/Linux hosts.
 */
export function downloadViaYtDlp(
  safeUrl: string,
  outputPrefixId: string,
  onProgress?: (pct: number, stage: string) => void,
): Promise<{ filePath: string; originalName: string }> {
  const templatePath = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, `${outputPrefixId}.%(ext)s`));
  return new Promise((resolve, reject) => {
    const child = spawn(
      YTDLP_BIN,
      [
        '--no-playlist',
        '-f',
        'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '--newline',
        '-o',
        templatePath,
        safeUrl,
      ],
      { shell: false },
    );

    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (match && onProgress) {
        onProgress(Math.min(95, Math.round(Number(match[1]))), `Downloading via yt-dlp (${match[1]}%)`);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const expectedMp4 = assertSafePath(UPLOADS_DIR, path.join(UPLOADS_DIR, `${outputPrefixId}.mp4`));
      if (code === 0 && fs.existsSync(expectedMp4)) {
        resolve({ filePath: expectedMp4, originalName: `ytdlp_${outputPrefixId.slice(0, 8)}.mp4` });
      } else {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}
