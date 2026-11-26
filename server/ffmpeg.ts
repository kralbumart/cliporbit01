import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  FFMPEG_BIN,
  FFPROBE_BIN,
  STORAGE_ROOT,
  TEMP_DIR,
  assertSafePath,
} from './paths.ts';
import type {
  AspectRatioMode,
  CaptionStylePreset,
  CropRegion,
  EditPipelineConfig,
  ExtractAudioConfig,
  FfmpegSpeedPreset,
  LogoCorner,
  MergeVideosConfig,
  ResolutionPreset,
  SilenceSegment,
  SubtitlePosition,
} from '../src/types/studio.ts';

export interface MediaProbeResult {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
}

export interface RunningFfmpegHandle {
  process: ChildProcess;
  pause: () => boolean;
  resume: () => boolean;
  cancel: () => void;
}

function parseFrameRate(rateStr?: string): number | null {
  if (!rateStr || rateStr === '0/0') return null;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Number((num / den).toFixed(2));
    }
  }
  const val = Number(rateStr);
  return Number.isFinite(val) ? Number(val.toFixed(2)) : null;
}

export function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const safePath = assertSafePath(STORAGE_ROOT, filePath);
  return new Promise((resolve) => {
    const child = spawn(
      FFPROBE_BIN,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', safePath],
      { shell: false },
    );

    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.on('error', () => {
      resolve({
        durationSec: null,
        width: null,
        height: null,
        fps: null,
        videoCodec: null,
        audioCodec: null,
        bitrate: null,
      });
    });

    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string; bit_rate?: string };
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            width?: number;
            height?: number;
            avg_frame_rate?: string;
            r_frame_rate?: string;
          }>;
        };
        const streams = parsed.streams ?? [];
        const vStream = streams.find((s) => s.codec_type === 'video');
        const aStream = streams.find((s) => s.codec_type === 'audio');

        const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;
        const bitrate = parsed.format?.bit_rate ? Number(parsed.format.bit_rate) : null;

        resolve({
          durationSec: duration !== null && Number.isFinite(duration) ? Number(duration.toFixed(2)) : null,
          width: vStream?.width ?? null,
          height: vStream?.height ?? null,
          fps: parseFrameRate(vStream?.avg_frame_rate || vStream?.r_frame_rate),
          videoCodec: vStream?.codec_name ?? null,
          audioCodec: aStream?.codec_name ?? null,
          bitrate: bitrate !== null && Number.isFinite(bitrate) ? Math.round(bitrate) : null,
        });
      } catch {
        resolve({
          durationSec: null,
          width: null,
          height: null,
          fps: null,
          videoCodec: null,
          audioCodec: null,
          bitrate: null,
        });
      }
    });
  });
}

export function generateThumbnail(videoPath: string, outputThumbPath: string, seekSec = 1): Promise<boolean> {
  const safeIn = assertSafePath(STORAGE_ROOT, videoPath);
  const safeOut = assertSafePath(STORAGE_ROOT, outputThumbPath);
  return new Promise((resolve) => {
    const child = spawn(
      FFMPEG_BIN,
      [
        '-y',
        '-ss',
        String(Math.max(0, Number.isFinite(seekSec) ? seekSec : 0)),
        '-i',
        safeIn,
        '-vframes',
        '1',
        '-vf',
        'scale=480:-1',
        '-q:v',
        '4',
        safeOut,
      ],
      { shell: false },
    );

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && fs.existsSync(safeOut)));
  });
}

export function generateSampleVideo(outputVideoPath: string, threads = 2): Promise<boolean> {
  const safeOut = assertSafePath(STORAGE_ROOT, outputVideoPath);
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=12',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='if(lt(t,4.2),0.22*sin(2*PI*330*t),if(lt(t,6.8),0,0.22*sin(2*PI*440*t)))':d=12:s=44100",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '24',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-threads',
      String(Math.max(1, Math.min(4, threads))),
      '-movflags',
      '+faststart',
      safeOut,
    ];

    const child = spawn(FFMPEG_BIN, args, { shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && fs.existsSync(safeOut)));
  });
}

export function generateSampleLogo(outputPngPath: string): Promise<boolean> {
  const safeOut = assertSafePath(STORAGE_ROOT, outputPngPath);
  return new Promise((resolve) => {
    const args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1D4ED8:s=260x76:d=1',
      '-vf',
      "format=rgba,drawbox=x=0:y=0:w=260:h=76:color=0xFFFFFF@0.25:t=3,drawtext=text='OPENVIDEO':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2",
      '-frames:v',
      '1',
      safeOut,
    ];
    const child = spawn(FFMPEG_BIN, args, { shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(safeOut)) {
        resolve(true);
        return;
      }
      const fallback = spawn(
        FFMPEG_BIN,
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=0x2563EB:s=220x68:d=1',
          '-vf',
          'format=rgba,drawbox=x=12:y=12:w=44:h=44:color=white@0.9:t=fill',
          '-frames:v',
          '1',
          safeOut,
        ],
        { shell: false },
      );
      fallback.on('error', () => resolve(false));
      fallback.on('close', (fbCode) => resolve(fbCode === 0 && fs.existsSync(safeOut)));
    });
  });
}

export function detectActiveSegments(
  videoPath: string,
  totalDurationSec: number,
  noiseDb = -30,
  minSilenceSec = 0.8,
): Promise<SilenceSegment[]> {
  const safeIn = assertSafePath(STORAGE_ROOT, videoPath);
  const clampedNoise = Math.max(-60, Math.min(-10, Math.round(noiseDb)));
  const clampedMinDur = Math.max(0.2, Math.min(10, Number(minSilenceSec) || 0.8));

  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG_BIN,
      [
        '-i',
        safeIn,
        '-af',
        `silencedetect=noise=${clampedNoise}dB:d=${clampedMinDur}`,
        '-f',
        'null',
        '-',
      ],
      { shell: false },
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0 && stderr.length === 0) {
        reject(new Error('FFmpeg silence detection failed'));
        return;
      }

      const silences: Array<{ start: number; end: number }> = [];
      let currentStart: number | null = null;
      const lines = stderr.split(/\r?\n/);

      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
        if (startMatch) currentStart = Number(startMatch[1]);
        const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
        if (endMatch) {
          silences.push({ start: currentStart ?? 0, end: Number(endMatch[1]) });
          currentStart = null;
        }
      }

      if (currentStart !== null && totalDurationSec > currentStart) {
        silences.push({ start: currentStart, end: totalDurationSec });
      }

      const segments: SilenceSegment[] = [];
      let cursor = 0;
      const duration = Math.max(0.5, totalDurationSec || 0);

      for (const s of silences) {
        if (s.start - cursor >= 0.8) {
          segments.push({
            index: segments.length + 1,
            startSec: Number(cursor.toFixed(2)),
            endSec: Number(s.start.toFixed(2)),
            durationSec: Number((s.start - cursor).toFixed(2)),
          });
        }
        cursor = Math.max(cursor, s.end);
      }

      if (duration - cursor >= 0.8) {
        segments.push({
          index: segments.length + 1,
          startSec: Number(cursor.toFixed(2)),
          endSec: Number(duration.toFixed(2)),
          durationSec: Number((duration - cursor).toFixed(2)),
        });
      }

      if (segments.length === 0 && duration > 0) {
        segments.push({
          index: 1,
          startSec: 0,
          endSec: Number(duration.toFixed(2)),
          durationSec: Number(duration.toFixed(2)),
        });
      }

      resolve(segments);
    });
  });
}

function getTargetDimensions(
  aspectRatio: AspectRatioMode,
  resolution: ResolutionPreset,
  sourceWidth: number | null,
  sourceHeight: number | null,
): { width: number; height: number } | null {
  const heightCap =
    resolution === '1080p' ? 1080 : resolution === '720p' ? 720 : resolution === '480p' ? 480 : null;

  if (aspectRatio === '9:16') {
    if (resolution === '1080p') return { width: 1080, height: 1920 };
    if (resolution === '480p') return { width: 480, height: 854 };
    return { width: 720, height: 1280 };
  }
  if (aspectRatio === '16:9') {
    if (resolution === '1080p') return { width: 1920, height: 1080 };
    if (resolution === '480p') return { width: 854, height: 480 };
    return { width: 1280, height: 720 };
  }
  if (aspectRatio === '1:1') {
    if (resolution === '1080p') return { width: 1080, height: 1080 };
    if (resolution === '480p') return { width: 480, height: 480 };
    return { width: 720, height: 720 };
  }

  if (!heightCap) return null;
  const sw = sourceWidth || 1280;
  const sh = sourceHeight || 720;
  if (sh <= heightCap) {
    return { width: Math.floor(sw / 2) * 2, height: Math.floor(sh / 2) * 2 };
  }
  const scaledW = Math.max(2, Math.floor(((sw * heightCap) / sh) / 2) * 2);
  const scaledH = Math.max(2, Math.floor(heightCap / 2) * 2);
  return { width: scaledW, height: scaledH };
}

function getOverlayCoords(corner: LogoCorner, marginX = 24, marginY = 24): string {
  const mx = Math.max(4, Math.min(200, Math.round(marginX)));
  const my = Math.max(4, Math.min(200, Math.round(marginY)));
  switch (corner) {
    case 'top-left':
      return `${mx}:${my}`;
    case 'top-right':
      return `main_w-overlay_w-${mx}:${my}`;
    case 'bottom-left':
      return `${mx}:main_h-overlay_h-${my}`;
    case 'bottom-right':
    default:
      return `main_w-overlay_w-${mx}:main_h-overlay_h-${my}`;
  }
}

function hexToAssColor(hex: string | undefined, fallbackAss: string): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex.trim())) return fallbackAss;
  const clean = hex.trim().slice(1);
  const r = clean.slice(0, 2).toUpperCase();
  const g = clean.slice(2, 4).toUpperCase();
  const b = clean.slice(4, 6).toUpperCase();
  return `&H00${b}${g}${r}`;
}

function getSubtitleStyle(
  position: SubtitlePosition,
  fontSize: number,
  captionStyle: CaptionStylePreset = 'classic_bold',
  primaryHex?: string,
  outlineHex?: string,
): string {
  const clampedSize = Math.max(12, Math.min(48, Math.round(fontSize || 22)));
  const alignment = position === 'top' ? 6 : position === 'middle' ? 10 : 2;
  const marginV = position === 'middle' ? 10 : 38;

  if (captionStyle === 'viral_yellow') {
    const primary = hexToAssColor(primaryHex, '&H0000EAFF'); // Vivid yellow
    const outline = hexToAssColor(outlineHex, '&H00000000');
    return `FontSize=${clampedSize},Bold=1,Alignment=${alignment},MarginV=${marginV},PrimaryColour=${primary},OutlineColour=${outline},BorderStyle=1,Outline=3,Shadow=2`;
  }
  if (captionStyle === 'minimal_clean') {
    const primary = hexToAssColor(primaryHex, '&H00FFFFFF');
    const outline = hexToAssColor(outlineHex, '&H80000000');
    return `FontSize=${clampedSize},Bold=0,Alignment=${alignment},MarginV=${marginV},PrimaryColour=${primary},BackColour=&H80000000,OutlineColour=${outline},BorderStyle=3,Outline=1,Shadow=0`;
  }
  if (captionStyle === 'cinema_outline') {
    const primary = hexToAssColor(primaryHex, '&H00F4F4F5');
    const outline = hexToAssColor(outlineHex, '&H0018181B');
    return `FontSize=${clampedSize},Bold=1,Alignment=${alignment},MarginV=${marginV},PrimaryColour=${primary},OutlineColour=${outline},BorderStyle=1,Outline=2,Shadow=1`;
  }

  const primary = hexToAssColor(primaryHex, '&H00FFFFFF');
  const outline = hexToAssColor(outlineHex, '&H00000000');
  return `FontSize=${clampedSize},Bold=1,Alignment=${alignment},MarginV=${marginV},PrimaryColour=${primary},OutlineColour=${outline},BorderStyle=1,Outline=2,Shadow=1`;
}

function escapeSubtitleFilterPath(safeAbsPath: string): string {
  return safeAbsPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function clampCropBox(box: CropRegion | undefined, fallback: CropRegion): CropRegion {
  if (!box) return fallback;
  const wPct = Math.max(10, Math.min(100, Number(box.wPct) || fallback.wPct));
  const hPct = Math.max(10, Math.min(100, Number(box.hPct) || fallback.hPct));
  const xPct = Math.max(0, Math.min(100 - wPct, Number(box.xPct) || 0));
  const yPct = Math.max(0, Math.min(100 - hPct, Number(box.yPct) || 0));
  return { xPct, yPct, wPct, hPct };
}

export function buildEditPipelineArgs(params: {
  inputPath: string;
  inputHasAudio: boolean;
  sourceWidth: number | null;
  sourceHeight: number | null;
  sourceDurationSec: number | null;
  outputPath: string;
  config: EditPipelineConfig;
  logoPath?: string | null;
  subtitlePath?: string | null;
  musicPath?: string | null;
  ffmpegThreads: number;
}): { args: string[]; targetDurationSec: number } {
  const safeInput = assertSafePath(STORAGE_ROOT, params.inputPath);
  const safeOutput = assertSafePath(STORAGE_ROOT, params.outputPath);
  const cfg = params.config;

  const args: string[] = ['-y'];
  const totalDur = Math.max(0.5, params.sourceDurationSec || 10);

  const validSegments =
    Array.isArray(cfg.segments) && cfg.segments.length > 0
      ? cfg.segments
          .map((s) => {
            const st = Math.max(0, Math.min(totalDur - 0.2, Number(s.startSec) || 0));
            const en = Math.max(st + 0.2, Math.min(totalDur, Number(s.endSec) || totalDur));
            return { startSec: st, endSec: en };
          })
          .slice(0, 12)
      : null;

  const useMultiSegment = Boolean(validSegments && validSegments.length > 1);
  const startSec = cfg.trimEnabled
    ? Math.max(0, Math.min(totalDur - 0.2, Number(cfg.startSec) || 0))
    : 0;
  const endSec = cfg.trimEnabled
    ? Math.max(startSec + 0.2, Math.min(totalDur, Number(cfg.endSec) || totalDur))
    : totalDur;

  const targetDurationSec = useMultiSegment && validSegments
    ? Number(validSegments.reduce((acc, s) => acc + (s.endSec - s.startSec), 0).toFixed(2))
    : Math.max(0.2, Number((endSec - startSec).toFixed(2)));

  if (!useMultiSegment && cfg.trimEnabled && startSec > 0) {
    args.push('-ss', String(startSec));
  }
  args.push('-i', safeInput);

  let nextInputIdx = 1;
  let logoIdx: number | null = null;
  let musicIdx: number | null = null;

  if (cfg.logoEnabled && params.logoPath) {
    const safeLogo = assertSafePath(STORAGE_ROOT, params.logoPath);
    args.push('-i', safeLogo);
    logoIdx = nextInputIdx++;
  }

  if ((cfg.audioMode === 'mix_music' || cfg.audioMode === 'replace_music') && params.musicPath) {
    const safeMusic = assertSafePath(STORAGE_ROOT, params.musicPath);
    args.push('-stream_loop', '-1', '-i', safeMusic);
    musicIdx = nextInputIdx++;
  }

  const filterParts: string[] = [];
  let videoLabel = '0:v';
  let sourceAudioLabel = params.inputHasAudio ? '0:a' : null;

  // Multi-segment timeline trim + reorder + duplicate concat
  if (useMultiSegment && validSegments) {
    const concatParts: string[] = [];
    validSegments.forEach((seg, idx) => {
      filterParts.push(`[0:v]trim=start=${seg.startSec.toFixed(2)}:end=${seg.endSec.toFixed(2)},setpts=PTS-STARTPTS[sv${idx}]`);
      if (params.inputHasAudio) {
        filterParts.push(`[0:a]atrim=start=${seg.startSec.toFixed(2)}:end=${seg.endSec.toFixed(2)},asetpts=PTS-STARTPTS[sa${idx}]`);
        concatParts.push(`[sv${idx}][sa${idx}]`);
      } else {
        concatParts.push(`[sv${idx}]`);
      }
    });
    if (params.inputHasAudio) {
      filterParts.push(`${concatParts.join('')}concat=n=${validSegments.length}:v=1:a=1[v_tl][a_tl]`);
      videoLabel = 'v_tl';
      sourceAudioLabel = 'a_tl';
    } else {
      filterParts.push(`${concatParts.join('')}concat=n=${validSegments.length}:v=1:a=0[v_tl]`);
      videoLabel = 'v_tl';
    }
  }

  const dims = getTargetDimensions(cfg.aspectRatio, cfg.resolution, params.sourceWidth, params.sourceHeight);

  if (dims) {
    if (cfg.aspectRatio === '9:16' && cfg.fitMode === 'split_facecam') {
      const topH = Math.floor((dims.height * 0.38) / 2) * 2;
      const botH = dims.height - topH;
      const face = clampCropBox(cfg.facecamBox, { xPct: 68, yPct: 4, wPct: 28, hPct: 30 });
      const game = clampCropBox(cfg.gameplayBox, { xPct: 0, yPct: 12, wPct: 100, hPct: 76 });
      const fw = (face.wPct / 100).toFixed(4);
      const fh = (face.hPct / 100).toFixed(4);
      const fx = (face.xPct / 100).toFixed(4);
      const fy = (face.yPct / 100).toFixed(4);
      const gw = (game.wPct / 100).toFixed(4);
      const gh = (game.hPct / 100).toFixed(4);
      const gx = (game.xPct / 100).toFixed(4);
      const gy = (game.yPct / 100).toFixed(4);

      filterParts.push(
        `[${videoLabel}]split=2[v_face_in][v_game_in]`,
        `[v_face_in]crop=iw*${fw}:ih*${fh}:iw*${fx}:ih*${fy},scale=${dims.width}:${topH}:force_original_aspect_ratio=increase,crop=${dims.width}:${topH},setsar=1[v_face_out]`,
        `[v_game_in]crop=iw*${gw}:ih*${gh}:iw*${gx}:ih*${gy},scale=${dims.width}:${botH}:force_original_aspect_ratio=increase,crop=${dims.width}:${botH},setsar=1[v_game_out]`,
        `[v_face_out][v_game_out]vstack=inputs=2[v_framed]`,
      );
      videoLabel = 'v_framed';
    } else if (cfg.aspectRatio !== 'original' && cfg.fitMode === 'blur_pad') {
      filterParts.push(
        `[${videoLabel}]split=2[bg_raw][fg_raw]`,
        `[bg_raw]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},boxblur=20:5[bg_blur]`,
        `[fg_raw]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease[fg_fit]`,
        `[bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2,setsar=1[v_framed]`,
      );
      videoLabel = 'v_framed';
    } else if (cfg.aspectRatio !== 'original') {
      filterParts.push(
        `[${videoLabel}]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},setsar=1[v_framed]`,
      );
      videoLabel = 'v_framed';
    } else {
      filterParts.push(`[${videoLabel}]scale=${dims.width}:${dims.height},setsar=1[v_framed]`);
      videoLabel = 'v_framed';
    }
  } else {
    filterParts.push(`[${videoLabel}]scale=trunc(iw/2)*2:trunc(ih/2)*2[v_even]`);
    videoLabel = 'v_even';
  }

  // Watermark / Logo overlay with margins
  if (logoIdx !== null) {
    const baseW = dims?.width || params.sourceWidth || 1280;
    const scalePct = Math.max(5, Math.min(45, Number(cfg.logoScalePct) || 18));
    const logoWidth = Math.max(24, Math.floor(((baseW * scalePct) / 100) / 2) * 2);
    const opacity = Math.max(0.1, Math.min(1, Number(cfg.logoOpacity) || 0.85));
    const coords = getOverlayCoords(cfg.logoCorner, cfg.logoMarginX ?? 24, cfg.logoMarginY ?? 24);

    filterParts.push(
      `[${logoIdx}:v]format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)},scale=${logoWidth}:-1[wm_scaled]`,
      `[${videoLabel}][wm_scaled]overlay=${coords}[v_wm]`,
    );
    videoLabel = 'v_wm';
  }

  // Subtitle burn-in with caption style presets & custom colors
  if (cfg.subtitleEnabled && params.subtitlePath) {
    const safeSub = assertSafePath(STORAGE_ROOT, params.subtitlePath);
    const escaped = escapeSubtitleFilterPath(safeSub);
    const style = getSubtitleStyle(
      cfg.subtitlePosition,
      cfg.subtitleFontSize,
      cfg.captionStyle || 'classic_bold',
      cfg.captionColor,
      cfg.captionOutlineColor,
    );
    filterParts.push(`[${videoLabel}]subtitles='${escaped}':force_style='${style}'[v_sub]`);
    videoLabel = 'v_sub';
  }

  // Fade-in / Fade-out transitions
  const fadeIn = Math.max(0, Math.min(3, Number(cfg.fadeInSec) || 0));
  const fadeOut = Math.max(0, Math.min(3, Number(cfg.fadeOutSec) || 0));
  if (fadeIn > 0 || fadeOut > 0) {
    const fadeChain: string[] = [];
    if (fadeIn > 0) fadeChain.push(`fade=t=in:st=0:d=${fadeIn.toFixed(2)}`);
    if (fadeOut > 0 && targetDurationSec > fadeOut) {
      fadeChain.push(`fade=t=out:st=${Math.max(0, targetDurationSec - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`);
    }
    if (fadeChain.length > 0) {
      filterParts.push(`[${videoLabel}]${fadeChain.join(',')}[v_fade]`);
      videoLabel = 'v_fade';
    }
  }

  // Audio processing
  let audioMap: string | null = null;
  const musicVol = Math.max(0.05, Math.min(1.5, Number(cfg.musicVolume) || 0.35));

  if (cfg.audioMode === 'mute') {
    audioMap = null;
  } else if (cfg.audioMode === 'replace_music' && musicIdx !== null) {
    filterParts.push(`[${musicIdx}:a]volume=${musicVol.toFixed(2)}[a_out]`);
    audioMap = '[a_out]';
  } else if (cfg.audioMode === 'mix_music' && musicIdx !== null) {
    if (sourceAudioLabel) {
      filterParts.push(
        `[${musicIdx}:a]volume=${musicVol.toFixed(2)}[a_bgm]`,
        `[${sourceAudioLabel}][a_bgm]amix=inputs=2:duration=first:dropout_transition=2[a_out]`,
      );
      audioMap = '[a_out]';
    } else {
      filterParts.push(`[${musicIdx}:a]volume=${musicVol.toFixed(2)}[a_out]`);
      audioMap = '[a_out]';
    }
  } else if (sourceAudioLabel) {
    audioMap = sourceAudioLabel === '0:a' ? '0:a?' : `[${sourceAudioLabel}]`;
  }

  if (filterParts.length > 0) {
    args.push('-filter_complex', filterParts.join(';'));
  }

  args.push('-map', `[${videoLabel}]`);
  if (audioMap) {
    args.push('-map', audioMap);
  } else {
    args.push('-an');
  }

  const preset: FfmpegSpeedPreset =
    cfg.preset === 'ultrafast' || cfg.preset === 'fast' ? cfg.preset : 'veryfast';
  const crf = Math.max(16, Math.min(35, Math.round(Number(cfg.crf) || 23)));
  const threads = Math.max(1, Math.min(8, Math.round(params.ffmpegThreads || 2)));

  if (!useMultiSegment && cfg.trimEnabled && endSec < totalDur) {
    args.push('-t', String(targetDurationSec));
  }

  args.push(
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-threads',
    String(threads),
  );

  if (audioMap) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
  }

  args.push('-movflags', '+faststart', safeOutput);

  return { args, targetDurationSec };
}

export function buildMergeVideosArgs(params: {
  inputs: Array<{ path: string; hasAudio: boolean; durationSec: number }>;
  outputPath: string;
  config: MergeVideosConfig;
  ffmpegThreads: number;
}): { args: string[]; targetDurationSec: number } {
  const safeOutput = assertSafePath(STORAGE_ROOT, params.outputPath);
  const dims =
    getTargetDimensions(params.config.aspectRatio, params.config.resolution, 1280, 720) || {
      width: 1280,
      height: 720,
    };

  const args: string[] = ['-y'];
  for (const item of params.inputs) {
    args.push('-i', assertSafePath(STORAGE_ROOT, item.path));
  }

  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  let totalDuration = 0;

  params.inputs.forEach((item, idx) => {
    const dur = Math.max(0.5, item.durationSec || 5);
    totalDuration += dur;

    filterParts.push(
      `[${idx}:v]scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1[v${idx}]`,
    );

    if (item.hasAudio) {
      filterParts.push(`[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${idx}]`);
    } else {
      filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=44100:d=${dur.toFixed(2)}[a${idx}]`);
    }
    concatInputs.push(`[v${idx}][a${idx}]`);
  });

  filterParts.push(`${concatInputs.join('')}concat=n=${params.inputs.length}:v=1:a=1[vout][aout]`);

  const preset: FfmpegSpeedPreset =
    params.config.preset === 'ultrafast' || params.config.preset === 'fast' ? params.config.preset : 'veryfast';
  const crf = Math.max(16, Math.min(35, Math.round(Number(params.config.crf) || 23)));
  const threads = Math.max(1, Math.min(8, Math.round(params.ffmpegThreads || 2)));

  args.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    String(crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-threads',
    String(threads),
    '-movflags',
    '+faststart',
    safeOutput,
  );

  return { args, targetDurationSec: Math.max(1, totalDuration) };
}

export function buildExtractAudioArgs(params: {
  inputPath: string;
  outputPath: string;
  config: ExtractAudioConfig;
  durationSec: number | null;
}): { args: string[]; targetDurationSec: number } {
  const safeIn = assertSafePath(STORAGE_ROOT, params.inputPath);
  const safeOut = assertSafePath(STORAGE_ROOT, params.outputPath);
  const args: string[] = ['-y', '-i', safeIn, '-vn'];

  if (params.config.format === 'wav') {
    args.push('-c:a', 'pcm_s16le', '-ar', '44100', safeOut);
  } else {
    const bitrate = Math.max(64, Math.min(320, Math.round(params.config.bitrateKbps || 192)));
    args.push('-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, safeOut);
  }

  return { args, targetDurationSec: Math.max(1, params.durationSec || 10) };
}

export function writeTempSubtitleFile(jobId: string, rawContent: string): string {
  const safeFilename = `sub_${jobId.replace(/[^a-zA-Z0-9-]/g, '')}.srt`;
  const target = assertSafePath(TEMP_DIR, path.join(TEMP_DIR, safeFilename));
  fs.writeFileSync(target, rawContent.trim() + '\n', 'utf8');
  return target;
}

function parseTimecodeSeconds(str: string): number | null {
  const match = str.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function spawnFfmpegJob(params: {
  args: string[];
  targetDurationSec: number;
  onProgress: (pct: number, stage: string) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}): RunningFfmpegHandle {
  const child = spawn(FFMPEG_BIN, params.args, { shell: false });
  let stderrTail = '';
  let cancelled = false;
  let lastReportedPct = -1;

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stderrTail = (stderrTail + text).slice(-2500);

    const secs = parseTimecodeSeconds(text);
    if (secs !== null && params.targetDurationSec > 0) {
      const pct = Math.max(1, Math.min(98, Math.round((secs / params.targetDurationSec) * 100)));
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        params.onProgress(pct, `Rendering with native FFmpeg (${secs.toFixed(1)}s / ${params.targetDurationSec.toFixed(1)}s)`);
      }
    }
  });

  child.on('error', (err) => {
    if (!cancelled) {
      params.onError(`Failed to spawn FFmpeg: ${err.message}`);
    }
  });

  child.on('close', (code) => {
    if (cancelled) return;
    if (code === 0) {
      params.onComplete();
    } else {
      const lastLines = stderrTail
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-4)
        .join(' | ');
      params.onError(lastLines || `FFmpeg exited with code ${code}`);
    }
  });

  return {
    process: child,
    pause: () => {
      if (process.platform === 'win32' || child.killed) return false;
      try {
        return child.kill('SIGSTOP');
      } catch {
        return false;
      }
    },
    resume: () => {
      if (process.platform === 'win32' || child.killed) return false;
      try {
        return child.kill('SIGCONT');
      } catch {
        return false;
      }
    },
    cancel: () => {
      cancelled = true;
      try {
        if (process.platform !== 'win32') {
          child.kill('SIGCONT');
        }
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // Already exited
            }
          }
        }, 1200);
      } catch {
        // Ignore already-closed child
      }
    },
  };
}
