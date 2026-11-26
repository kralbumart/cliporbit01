import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FFMPEG_BIN, STORAGE_ROOT, getDirectorySizeBytes } from './paths.ts';
import { countJobsByStatus, getSettings } from './db.ts';
import { detectYtDlpInstalled } from './urlImport.ts';
import { isWatcherRunning } from './automation.ts';
import type { SystemMetrics } from '../src/types/studio.ts';

interface CpuSnapshot {
  idle: number;
  total: number;
}

function captureCpuTimes(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

let prevCpu = captureCpuTimes();
let cachedCpuPct = 0;

function sampleCpuUsagePct(): number {
  const next = captureCpuTimes();
  const totalDelta = next.total - prevCpu.total;
  const idleDelta = next.idle - prevCpu.idle;
  prevCpu = next;
  if (totalDelta > 0) {
    cachedCpuPct = Math.max(0, Math.min(100, Math.round(((totalDelta - idleDelta) / totalDelta) * 100)));
  }
  return cachedCpuPct;
}

function detectFfmpeg(): { available: boolean; version: string } {
  try {
    const result = spawnSync(FFMPEG_BIN, ['-version'], { encoding: 'utf8', timeout: 3000, shell: false });
    if (result.status === 0 && result.stdout) {
      const firstLine = result.stdout.split('\n')[0]?.trim() || 'ffmpeg available';
      return { available: true, version: firstLine };
    }
    return { available: false, version: 'FFmpeg not found on PATH' };
  } catch {
    return { available: false, version: 'FFmpeg not found on PATH' };
  }
}

function detectDocker(): boolean {
  try {
    const result = spawnSync('docker', ['--version'], { encoding: 'utf8', timeout: 2000, shell: false });
    return result.status === 0;
  } catch {
    return false;
  }
}

const ffmpegInfo = detectFfmpeg();
const dockerInstalled = detectDocker();
const ytDlpInstalled = detectYtDlpInstalled();

export function getSystemMetrics(): SystemMetrics {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramTotalMb = Math.round(totalMem / (1024 * 1024));
  const ramUsedMb = Math.round(usedMem / (1024 * 1024));
  const ramFreeMb = Math.round(freeMem / (1024 * 1024));
  const ramUsagePct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;
  const processRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

  let diskTotalGb = 0;
  let diskFreeGb = 0;
  let diskUsedPct = 0;
  try {
    const stats = fs.statfsSync(STORAGE_ROOT);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    diskTotalGb = Number((totalBytes / 1024 ** 3).toFixed(1));
    diskFreeGb = Number((freeBytes / 1024 ** 3).toFixed(1));
    diskUsedPct = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
  } catch {
    // Fallback if statfsSync is unavailable
  }

  const storageUsedMb = Number((getDirectorySizeBytes(STORAGE_ROOT) / (1024 * 1024)).toFixed(2));
  const jobCounts = countJobsByStatus();
  const settings = getSettings();

  return {
    timestamp: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    cpuCores: os.cpus().length,
    cpuUsagePct: sampleCpuUsagePct(),
    ramTotalMb,
    ramUsedMb,
    ramFreeMb,
    ramUsagePct,
    processRssMb,
    diskTotalGb,
    diskFreeGb,
    diskUsedPct,
    storageUsedMb,
    ffmpegAvailable: ffmpegInfo.available,
    ffmpegVersion: ffmpegInfo.version,
    ytDlpAvailable: ytDlpInstalled,
    dockerAvailable: dockerInstalled,
    activeJobs: jobCounts.active,
    queuedJobs: jobCounts.queued,
    completedJobs: jobCounts.completed,
    queuePaused: settings.queuePaused,
    concurrency: settings.concurrency,
    watcherActive: isWatcherRunning(),
  };
}
