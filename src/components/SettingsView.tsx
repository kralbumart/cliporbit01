import { useEffect, useState } from 'react';
import { HardDrive, Save, Trash2 } from 'lucide-react';
import { BRAND_CONFIG } from '../config/branding';
import { studioApi } from '../lib/api';
import type { FfmpegSpeedPreset, SystemMetrics, WorkerSettings } from '../types/studio';

interface SettingsViewProps {
  settings: WorkerSettings | null;
  metrics: SystemMetrics | null;
  onSettingsUpdated: (next: WorkerSettings) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function SettingsView({
  settings,
  metrics,
  onSettingsUpdated,
  onNotify,
}: SettingsViewProps) {
  const [concurrency, setConcurrency] = useState(settings?.concurrency ?? 1);
  const [ffmpegThreads, setFfmpegThreads] = useState(settings?.ffmpegThreads ?? 2);
  const [defaultPreset, setDefaultPreset] = useState<FfmpegSpeedPreset>(settings?.defaultPreset ?? 'veryfast');
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    if (settings) {
      setConcurrency(settings.concurrency);
      setFfmpegThreads(settings.ffmpegThreads);
      setDefaultPreset(settings.defaultPreset);
    }
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await studioApi.updateSettings({
        concurrency,
        ffmpegThreads,
        defaultPreset,
      });
      onSettingsUpdated(updated);
      onNotify('Worker resource settings saved to SQLite.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleCleanTemp() {
    setCleaning(true);
    try {
      const res = await studioApi.cleanTempStorage();
      onNotify(`Cleaned ${res.removed} temporary file${res.removed === 1 ? '' : 's'}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Cleanup failed', 'error');
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Low-Resource Guardrails & Rebrandable Configuration
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
          Settings
        </h1>
      </div>

      {/* Low-Resource Worker Config */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Local FFmpeg Worker Limits
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Keep concurrency at 1 on 8 GB RAM laptops to prevent memory pressure and UI lag during video encoding.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label className="font-medium text-zinc-700 dark:text-zinc-300">Max Parallel Jobs</label>
              <span className="font-mono font-semibold tabular-nums">{concurrency}</span>
            </div>
            <input
              type="range"
              min={1}
              max={4}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              {concurrency === 1 ? 'Recommended for 4–8 GB RAM' : 'Higher RAM/CPU usage'}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <label className="font-medium text-zinc-700 dark:text-zinc-300">FFmpeg Threads / Job</label>
              <span className="font-mono font-semibold tabular-nums">{ffmpegThreads}</span>
            </div>
            <input
              type="range"
              min={1}
              max={Math.max(2, Math.min(8, metrics?.cpuCores ?? 4))}
              value={ffmpegThreads}
              onChange={(e) => setFfmpegThreads(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
              Host has {metrics?.cpuCores ?? 2} vCPU cores
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Default Encoder Preset
            </label>
            <select
              value={defaultPreset}
              onChange={(e) => setDefaultPreset(e.target.value as FfmpegSpeedPreset)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
            >
              <option value="ultrafast">ultrafast (Fastest, lowest CPU)</option>
              <option value="veryfast">veryfast (Recommended balance)</option>
              <option value="fast">fast (Tighter compression)</option>
            </select>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Worker Settings'}
          </button>
        </div>
      </section>

      {/* Storage Maintenance */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <HardDrive className="h-5 w-5 text-zinc-400 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Local Storage Usage
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
              Media & Exports: {metrics?.storageUsedMb ?? 0} MB · Free Disk: {metrics?.diskFreeGb ?? 0} GB
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={cleaning}
          onClick={() => void handleCleanTemp()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {cleaning ? 'Cleaning...' : 'Clean Temp Folder'}
        </button>
      </section>

      {/* White-Label Branding Configuration */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          Branding & White-Label Config
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          Edit <code className="font-mono text-zinc-700 dark:text-zinc-300">src/config/branding.ts</code> to rename or rebrand this studio instance.
        </p>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Application Name</dt>
            <dd className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{BRAND_CONFIG.appName}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Version</dt>
            <dd className="mt-1 font-mono text-zinc-900 dark:text-zinc-100">{BRAND_CONFIG.version}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">License</dt>
            <dd className="mt-1 font-mono text-zinc-900 dark:text-zinc-100">{BRAND_CONFIG.license}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
