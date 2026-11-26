import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Combine,
  Film,
  FolderOpen,
  FolderSync,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { BRAND_CONFIG } from './config/branding';
import { studioApi } from './lib/api';
import { ViralClipperView } from './components/ViralClipperView';
import { DashboardView } from './components/DashboardView';
import { MediaLibraryView } from './components/MediaLibraryView';
import { VideoEditorView } from './components/VideoEditorView';
import { MergeAndClipView } from './components/MergeAndClipView';
import { JobQueueView } from './components/JobQueueView';
import { AiProvidersView } from './components/AiProvidersView';
import { AutomationView } from './components/AutomationView';
import { CreatorsCampaignsView } from './components/CreatorsCampaignsView';
import { ArchitectureAndRoadmapView } from './components/ArchitectureAndRoadmapView';
import { SettingsView } from './components/SettingsView';
import type {
  AiProviderConfig,
  AutomationConfig,
  BrandTemplate,
  CampaignRecord,
  CreatorProfile,
  JobRecord,
  MediaAsset,
  SystemMetrics,
  ViralClipRecord,
  WorkerSettings,
} from './types/studio';

type NavKey =
  | 'clipper'
  | 'dashboard'
  | 'media'
  | 'editor'
  | 'merge'
  | 'queue'
  | 'providers'
  | 'automation'
  | 'creators'
  | 'architecture'
  | 'settings';

interface ToastState {
  id: number;
  message: string;
  tone: 'info' | 'error';
}

const STUDIO_NAV: Array<{ key: NavKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'clipper', label: 'Viral Clipper', icon: Sparkles },
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'media', label: 'Media Library', icon: FolderOpen },
  { key: 'editor', label: 'Clip Editor', icon: SlidersHorizontal },
  { key: 'merge', label: 'Clipper & Merge', icon: Combine },
  { key: 'queue', label: 'Job Queue', icon: Activity },
];

const GROWTH_NAV: Array<{ key: NavKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'providers', label: 'AI Providers', icon: Bot },
  { key: 'automation', label: 'Automation', icon: FolderSync },
  { key: 'creators', label: 'Creators & Campaigns', icon: Users },
];

const SYSTEM_NAV: Array<{ key: NavKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'architecture', label: 'Architecture & Plan', icon: Layers },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavKey>('clipper');
  const [editorMediaId, setEditorMediaId] = useState<string | null>(null);
  const [editorClip, setEditorClip] = useState<ViralClipRecord | null>(null);
  const [darkMode, setDarkMode] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [settings, setSettings] = useState<WorkerSettings | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [clips, setClips] = useState<ViralClipRecord[]>([]);
  const [providers, setProviders] = useState<AiProviderConfig[]>([]);
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [automation, setAutomation] = useState<AutomationConfig | null>(null);
  const [creators, setCreators] = useState<CreatorProfile[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [generatingSample, setGeneratingSample] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    const id = Date.now();
    setToast({ id, message, tone });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 4400);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  const refreshMedia = useCallback(async () => {
    const list = await studioApi.listMedia();
    setMedia(list);
  }, []);

  const refreshJobs = useCallback(async () => {
    const list = await studioApi.listJobs();
    setJobs(list);
  }, []);

  const refreshClips = useCallback(async () => {
    const list = await studioApi.listClips();
    setClips(list);
  }, []);

  const refreshTemplates = useCallback(async () => {
    const list = await studioApi.listTemplates();
    setTemplates(list);
  }, []);

  const refreshCreators = useCallback(async () => {
    const list = await studioApi.listCreators();
    setCreators(list);
  }, []);

  const refreshCampaigns = useCallback(async () => {
    const list = await studioApi.listCampaigns();
    setCampaigns(list);
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      const [m, s, med, jb, clp, prov, tpl, auto, cr, cmp] = await Promise.all([
        studioApi.getMetrics(),
        studioApi.getSettings(),
        studioApi.listMedia(),
        studioApi.listJobs(),
        studioApi.listClips(),
        studioApi.listAiProviders(),
        studioApi.listTemplates(),
        studioApi.getAutomation(),
        studioApi.listCreators(),
        studioApi.listCampaigns(),
      ]);
      setMetrics(m);
      setSettings(s);
      setMedia(med);
      setJobs(jb);
      setClips(clp);
      setProviders(prov);
      setTemplates(tpl);
      setAutomation(auto);
      setCreators(cr);
      setCampaigns(cmp);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to connect to studio backend.', 'error');
    }
  }, [notify]);

  useEffect(() => {
    void loadInitialData();

    const es = new EventSource('/api/events');
    es.addEventListener('metrics', (e) => {
      try {
        setMetrics(JSON.parse((e as MessageEvent).data) as SystemMetrics);
      } catch {
        // Ignore malformed SSE tick
      }
    });

    es.addEventListener('job_update', (e) => {
      try {
        const updated = JSON.parse((e as MessageEvent).data) as JobRecord;
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === updated.id);
          if (exists) {
            return prev.map((j) => (j.id === updated.id ? updated : j));
          }
          return [updated, ...prev];
        });
      } catch {
        // Ignore
      }
    });

    es.addEventListener('job_deleted', (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
        setJobs((prev) => prev.filter((j) => j.id !== id));
      } catch {
        // Ignore
      }
    });

    es.addEventListener('media_added', (e) => {
      try {
        const asset = JSON.parse((e as MessageEvent).data) as MediaAsset;
        setMedia((prev) => {
          if (prev.some((m) => m.id === asset.id)) return prev;
          return [asset, ...prev];
        });
      } catch {
        // Ignore
      }
    });

    es.addEventListener('media_deleted', (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
        setMedia((prev) => prev.filter((m) => m.id !== id));
      } catch {
        // Ignore
      }
    });

    es.addEventListener('clip_update', (e) => {
      try {
        const updated = JSON.parse((e as MessageEvent).data) as ViralClipRecord;
        setClips((prev) => {
          const exists = prev.some((c) => c.id === updated.id);
          if (exists) {
            return prev.map((c) => (c.id === updated.id ? updated : c));
          }
          return [updated, ...prev];
        });
      } catch {
        // Ignore
      }
    });

    es.addEventListener('clip_deleted', (e) => {
      try {
        const { id } = JSON.parse((e as MessageEvent).data) as { id: string };
        setClips((prev) => prev.filter((c) => c.id !== id));
      } catch {
        // Ignore
      }
    });

    return () => {
      es.close();
    };
  }, [loadInitialData]);

  async function handleGenerateSample() {
    setGeneratingSample(true);
    try {
      const res = await studioApi.generateSamplePack();
      await refreshMedia();
      setEditorMediaId(res.videoAsset.id);
      notify('Generated 12s 720p sample video, studio logo PNG, and SRT captions.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Sample generation failed', 'error');
    } finally {
      setGeneratingSample(false);
    }
  }

  function handleNavigate(tab: string) {
    setActiveTab(tab as NavKey);
    setMobileNavOpen(false);
  }

  function handleOpenEditorWithMedia(mediaId: string) {
    setEditorClip(null);
    setEditorMediaId(mediaId);
    setActiveTab('editor');
    setMobileNavOpen(false);
  }

  function handleOpenClipInEditor(clip: ViralClipRecord) {
    setEditorMediaId(clip.mediaId);
    setEditorClip(clip);
    setActiveTab('editor');
    setMobileNavOpen(false);
  }

  const activeJobsCount = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const configuredAiCount = providers.filter((p) => p.configured && p.enabled).length;

  const pageLabel =
    [...STUDIO_NAV, ...GROWTH_NAV, ...SYSTEM_NAV].find((n) => n.key === activeTab)?.label ||
    'Viral Clipper';

  return (
    <div className="min-h-screen flex bg-zinc-50 dark:bg-[#09090B] text-zinc-950 dark:text-zinc-100">
      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-14 px-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <button
            type="button"
            onClick={() => handleNavigate('clipper')}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0"
          >
            <span className="h-7 w-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-display text-xs font-bold">
              {BRAND_CONFIG.shortName}
            </span>
            <span className="font-display text-sm font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              {BRAND_CONFIG.appName}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation menu"
            className="p-1 text-zinc-500 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-5">
          <div>
            <p className="px-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5">
              Studio Workspace
            </p>
            <div className="space-y-0.5">
              {STUDIO_NAV.map(({ key, label, icon: Icon }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleNavigate(key)}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-zinc-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                    {key === 'clipper' && clips.length > 0 && (
                      <span className="font-mono text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                        {clips.length}
                      </span>
                    )}
                    {key === 'queue' && activeJobsCount > 0 && (
                      <span className="font-mono text-xs tabular-nums text-blue-600 dark:text-blue-400">
                        {activeJobsCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="px-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5">
              AI & Automation
            </p>
            <div className="space-y-0.5">
              {GROWTH_NAV.map(({ key, label, icon: Icon }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleNavigate(key)}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-zinc-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                    {key === 'providers' && (
                      <span className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                        {configuredAiCount}
                      </span>
                    )}
                    {key === 'automation' && metrics?.watcherActive && (
                      <span className="font-mono text-[11px] text-emerald-500">ON</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="px-2.5 text-[11px] font-medium text-zinc-400 dark:text-zinc-500 mb-1.5">
              System
            </p>
            <div className="space-y-0.5">
              {SYSTEM_NAV.map(({ key, label, icon: Icon }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleNavigate(key)}
                    className={`w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 hover:text-zinc-950 dark:hover:text-zinc-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Sidebar Footer: Theme Switch & Compact Resource Readout */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
          {metrics && (
            <div className="px-2.5 text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
              <span>CPU {metrics.cpuUsagePct}%</span>
              <span aria-hidden="true">·</span>
              <span>RAM {metrics.ramUsagePct}%</span>
              <span aria-hidden="true">·</span>
              <span>Q:{metrics.activeJobs}/{metrics.concurrency}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setDarkMode((prev) => !prev)}
            className="w-full flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="flex items-center gap-2">
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {darkMode ? 'Light Theme' : 'Dark Theme'}
            </span>
            <span className="text-[11px] text-zinc-400">{darkMode ? 'Dark' : 'Light'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb Left + 1-2 Actions Right */}
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-[#111113]/90 backdrop-blur-sm px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-zinc-400 dark:text-zinc-500 hidden sm:inline">{BRAND_CONFIG.appName}</span>
              <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">/</span>
              <span className="font-semibold text-zinc-950 dark:text-zinc-50 truncate">{pageLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleGenerateSample()}
              disabled={generatingSample}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Film className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              {generatingSample ? 'Generating...' : 'Sample Pack'}
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('queue')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 px-3 py-1.5 text-xs font-medium text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Activity className="h-3.5 w-3.5" />
              Queue ({activeJobsCount})
            </button>
          </div>
        </header>

        {/* Active View Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'clipper' && (
            <ViralClipperView
              media={media}
              clips={clips}
              providers={providers}
              templates={templates}
              creators={creators}
              generatingSample={generatingSample}
              onGenerateSample={() => void handleGenerateSample()}
              onRefreshMedia={refreshMedia}
              onRefreshClips={refreshClips}
              onOpenClipInEditor={handleOpenClipInEditor}
              onJobQueued={() => {
                void refreshJobs();
                setActiveTab('queue');
              }}
              onNotify={notify}
            />
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              metrics={metrics}
              media={media}
              jobs={jobs}
              generatingSample={generatingSample}
              onGenerateSample={() => void handleGenerateSample()}
              onNavigate={handleNavigate}
              onOpenEditorWithMedia={handleOpenEditorWithMedia}
            />
          )}

          {activeTab === 'media' && (
            <MediaLibraryView
              media={media}
              generatingSample={generatingSample}
              onGenerateSample={() => void handleGenerateSample()}
              onRefreshMedia={refreshMedia}
              onOpenInEditor={handleOpenEditorWithMedia}
              onNotify={notify}
            />
          )}

          {activeTab === 'editor' && (
            <VideoEditorView
              media={media}
              settings={settings}
              templates={templates}
              initialMediaId={editorMediaId}
              initialClip={editorClip}
              generatingSample={generatingSample}
              onGenerateSample={() => void handleGenerateSample()}
              onRefreshTemplates={refreshTemplates}
              onJobQueued={() => {
                void refreshJobs();
                setActiveTab('queue');
              }}
              onNotify={notify}
            />
          )}

          {activeTab === 'merge' && (
            <MergeAndClipView
              media={media}
              settings={settings}
              generatingSample={generatingSample}
              onGenerateSample={() => void handleGenerateSample()}
              onJobQueued={() => {
                void refreshJobs();
                setActiveTab('queue');
              }}
              onNotify={notify}
            />
          )}

          {activeTab === 'queue' && (
            <JobQueueView
              jobs={jobs}
              metrics={metrics}
              onRefreshJobs={refreshJobs}
              onNavigate={handleNavigate}
              onNotify={notify}
            />
          )}

          {activeTab === 'providers' && (
            <AiProvidersView
              providers={providers}
              onProvidersUpdated={setProviders}
              onNotify={notify}
            />
          )}

          {activeTab === 'automation' && (
            <AutomationView
              automation={automation}
              onAutomationUpdated={setAutomation}
              onNotify={notify}
            />
          )}

          {activeTab === 'creators' && (
            <CreatorsCampaignsView
              creators={creators}
              campaigns={campaigns}
              clips={clips}
              onRefreshCreators={refreshCreators}
              onRefreshCampaigns={refreshCampaigns}
              onNotify={notify}
            />
          )}

          {activeTab === 'architecture' && (
            <ArchitectureAndRoadmapView key="architecture" metrics={metrics} initialSection="architecture" />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              metrics={metrics}
              onSettingsUpdated={setSettings}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Inline Toast Feedback (replaces window.alert) */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-md rounded-lg border px-4 py-3 text-xs font-medium shadow-lg ${
            toast.tone === 'error'
              ? 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200'
              : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
