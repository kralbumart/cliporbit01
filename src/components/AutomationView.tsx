import { useEffect, useState } from 'react';
import {
  Bell,
  FolderSync,
  Plus,
  Save,
  Send,
  ShieldAlert,
  X,
} from 'lucide-react';
import { formatTimeAgo, studioApi } from '../lib/api';
import type { AspectRatioMode, AutomationConfig, ClippingMode } from '../types/studio';

interface AutomationViewProps {
  automation: AutomationConfig | null;
  onAutomationUpdated: (next: AutomationConfig) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function AutomationView({
  automation,
  onAutomationUpdated,
  onNotify,
}: AutomationViewProps) {
  const [folderWatchEnabled, setFolderWatchEnabled] = useState(automation?.folderWatchEnabled ?? false);
  const [clipsPerVideo, setClipsPerVideo] = useState(automation?.clipsPerVideo ?? 3);
  const [processingMode, setProcessingMode] = useState<ClippingMode>(automation?.processingMode ?? 'balanced');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>(automation?.aspectRatio ?? '9:16');
  const [webhookEnabled, setWebhookEnabled] = useState(automation?.webhookEnabled ?? false);
  const [webhookType, setWebhookType] = useState<'discord' | 'zapier' | 'custom'>(automation?.webhookType ?? 'discord');
  const [webhookUrl, setWebhookUrl] = useState(automation?.webhookUrl ?? '');
  const [wordsToAvoid, setWordsToAvoid] = useState<string[]>(automation?.wordsToAvoid ?? []);
  const [newWord, setNewWord] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingHook, setTestingHook] = useState(false);
  const [triggeringDrop, setTriggeringDrop] = useState(false);

  useEffect(() => {
    if (automation) {
      setFolderWatchEnabled(automation.folderWatchEnabled);
      setClipsPerVideo(automation.clipsPerVideo);
      setProcessingMode(automation.processingMode);
      setAspectRatio(automation.aspectRatio);
      setWebhookEnabled(automation.webhookEnabled);
      setWebhookType(automation.webhookType);
      setWebhookUrl(automation.webhookUrl);
      setWordsToAvoid(automation.wordsToAvoid);
    }
  }, [automation]);

  async function handleSave(overrides?: Partial<AutomationConfig>) {
    setSaving(true);
    try {
      const updated = await studioApi.updateAutomation({
        folderWatchEnabled,
        clipsPerVideo,
        processingMode,
        aspectRatio,
        webhookEnabled,
        webhookType,
        webhookUrl,
        wordsToAvoid,
        ...overrides,
      });
      onAutomationUpdated(updated);
      onNotify('Automation configuration saved.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save automation config', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestWebhook() {
    setTestingHook(true);
    try {
      await handleSave();
      const res = await studioApi.testWebhook();
      onNotify(res.message);
      const latest = await studioApi.getAutomation();
      onAutomationUpdated(latest);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Webhook test failed', 'error');
    } finally {
      setTestingHook(false);
    }
  }

  async function handleTriggerInboxDrop() {
    setTriggeringDrop(true);
    try {
      const res = await studioApi.triggerSampleInbox();
      onNotify(`Dropped "${res.droppedFile}" into watch folder — watcher will auto-queue render.`);
      setTimeout(async () => {
        const latest = await studioApi.getAutomation();
        onAutomationUpdated(latest);
      }, 1000);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Inbox test failed', 'error');
    } finally {
      setTriggeringDrop(false);
    }
  }

  function addWord() {
    const clean = newWord.trim();
    if (!clean) return;
    if (!wordsToAvoid.some((w) => w.toLowerCase() === clean.toLowerCase())) {
      setWordsToAvoid((prev) => [...prev, clean]);
    }
    setNewWord('');
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Folder Watcher · Discord / Zapier / Custom Webhooks · Restricted-Word Compliance
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Automation & Guardrails
          </h1>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : 'Save Automation Rules'}
        </button>
      </div>

      {/* Folder Watching */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <FolderSync className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Automatic Folder Watcher
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Monitors <code className="font-mono text-zinc-700 dark:text-zinc-300">{automation?.watchDir || './storage/watch_inbox'}</code> for new MP4/MOV/WebM videos and queues processing automatically (1 job at a time).
              </p>
              <p className="mt-1 text-xs font-medium">
                Live Watcher State:{' '}
                <span className={automation?.watcherActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}>
                  {automation?.watcherActive ? 'ON — Actively Watching Inbox' : 'OFF — Stopped'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !folderWatchEnabled;
              setFolderWatchEnabled(next);
              void handleSave({ folderWatchEnabled: next });
            }}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              folderWatchEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {folderWatchEnabled ? 'Watcher: ON' : 'Watcher: OFF'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-zinc-200 dark:border-zinc-800">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Clips per Video
            </label>
            <input
              type="number"
              min={1}
              max={12}
              value={clipsPerVideo}
              onChange={(e) => setClipsPerVideo(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Processing Mode
            </label>
            <select
              value={processingMode}
              onChange={(e) => setProcessingMode(e.target.value as ClippingMode)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="non_ai">Non-AI (FFmpeg Only)</option>
              <option value="fast">Fast AI</option>
              <option value="balanced">Balanced AI</option>
              <option value="best">Best AI</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Auto Output Framing
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatioMode)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="9:16">9:16 Vertical Shorts</option>
              <option value="16:9">16:9 Landscape</option>
              <option value="1:1">1:1 Square</option>
              <option value="original">Original</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {automation?.lastEventMessage
              ? `Last event: ${automation.lastEventMessage} (${automation.lastEventAt ? formatTimeAgo(automation.lastEventAt) : ''})`
              : 'No automation events recorded yet.'}
          </p>
          <button
            type="button"
            disabled={!folderWatchEnabled || triggeringDrop}
            onClick={() => void handleTriggerInboxDrop()}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
          >
            {triggeringDrop ? 'Dropping File...' : 'Test Watch Trigger (Drop Sample)'}
          </button>
        </div>
      </section>

      {/* Webhooks */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
                Webhook Notifications (Discord / Zapier / Custom)
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Sends real HTTP POST notifications when render jobs complete or fail. Private/localhost URLs are blocked for safety.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              const next = !webhookEnabled;
              setWebhookEnabled(next);
              void handleSave({ webhookEnabled: next });
            }}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              webhookEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {webhookEnabled ? 'Webhook: ON' : 'Webhook: OFF'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Payload Format
            </label>
            <select
              value={webhookType}
              onChange={(e) => setWebhookType(e.target.value as 'discord' | 'zapier' | 'custom')}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              <option value="discord">Discord Webhook</option>
              <option value="zapier">Zapier / Make JSON</option>
              <option value="custom">Custom HTTP JSON</option>
            </select>
          </div>
          <div className="sm:col-span-7">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Public HTTPS Webhook URL
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="sm:col-span-2 flex items-end">
            <button
              type="button"
              disabled={testingHook || !webhookUrl.trim()}
              onClick={() => void handleTestWebhook()}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {testingHook ? 'Sending...' : 'Test'}
            </button>
          </div>
        </div>
      </section>

      {/* Words-to-Avoid Rules */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Words-to-Avoid & Brand Safety Rules
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Automatically flags any clip title, hook, description, transcript, or caption containing restricted words.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addWord();
              }
            }}
            placeholder="Add restricted word or phrase (e.g., guaranteed viral)..."
            className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addWord}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Word
          </button>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-t border-zinc-200 dark:border-zinc-800">
          {wordsToAvoid.length === 0 ? (
            <p className="py-4 text-xs text-zinc-500">No restricted words configured.</p>
          ) : (
            wordsToAvoid.map((word) => (
              <div key={word} className="py-2 flex items-center justify-between text-xs">
                <span className="font-mono text-zinc-800 dark:text-zinc-200">{word}</span>
                <button
                  type="button"
                  onClick={() => setWordsToAvoid((prev) => prev.filter((w) => w !== word))}
                  aria-label={`Remove ${word}`}
                  className="p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
