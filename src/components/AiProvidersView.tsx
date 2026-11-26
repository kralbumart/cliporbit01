import { useState } from 'react';
import { CheckCircle2, PlugZap, Save, Server, XCircle } from 'lucide-react';
import { studioApi } from '../lib/api';
import type { AiProviderConfig } from '../types/studio';

interface AiProvidersViewProps {
  providers: AiProviderConfig[];
  onProvidersUpdated: (list: AiProviderConfig[]) => void;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

export function AiProvidersView({
  providers,
  onProvidersUpdated,
  onNotify,
}: AiProvidersViewProps) {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { baseUrl: string; model: string }>>({});

  function getDraft(p: AiProviderConfig) {
    return drafts[p.id] || { baseUrl: p.baseUrl, model: p.model };
  }

  function setDraftField(id: string, field: 'baseUrl' | 'model', value: string, fallback: AiProviderConfig) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        baseUrl: prev[id]?.baseUrl ?? fallback.baseUrl,
        model: prev[id]?.model ?? fallback.model,
        [field]: value,
      },
    }));
  }

  async function handleSave(p: AiProviderConfig, extra?: Partial<Pick<AiProviderConfig, 'enabled' | 'isDefault'>>) {
    setSavingId(p.id);
    try {
      const d = getDraft(p);
      await studioApi.updateAiProvider(p.id, {
        baseUrl: d.baseUrl,
        model: d.model,
        ...extra,
      });
      const updated = await studioApi.listAiProviders();
      onProvidersUpdated(updated);
      onNotify(`Saved ${p.name} settings.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleTest(p: AiProviderConfig) {
    setTestingId(p.id);
    try {
      const res = await studioApi.testAiProvider(p.id);
      onProvidersUpdated(res.providers);
      onNotify(res.message);
    } catch (err) {
      const refreshed = await studioApi.listAiProviders();
      onProvidersUpdated(refreshed);
      onNotify(err instanceof Error ? err.message : 'Connection test failed', 'error');
    } finally {
      setTestingId(null);
    }
  }

  const localProviders = providers.filter((p) => p.kind === 'local');
  const cloudProviders = providers.filter((p) => p.kind === 'cloud');

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Modular Server-Side Routing · Local-First & BYOK Cloud Support · Zero Browser Key Exposure
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
          AI Provider Hub
        </h1>
        <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 max-w-3xl">
          Configure local models (Ollama, LM Studio / llama.cpp) for zero-cost offline analysis, or use server-side cloud providers (Google Gemini, Groq, OpenRouter, DeepSeek, OpenAI). Cloud API keys are read strictly from server environment variables or Settings &gt; Secrets — never stored in browser code. Free tiers have provider rate limits; no provider offers unlimited free usage.
        </p>
      </div>

      {/* Local Providers */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          Local AI Providers (Free Local Compute)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {localProviders.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              draft={getDraft(p)}
              saving={savingId === p.id}
              testing={testingId === p.id}
              onFieldChange={(field, val) => setDraftField(p.id, field, val, p)}
              onSave={() => void handleSave(p)}
              onSetDefault={() => void handleSave(p, { isDefault: true, enabled: true })}
              onToggleEnabled={() => void handleSave(p, { enabled: !p.enabled })}
              onTest={() => void handleTest(p)}
            />
          ))}
        </div>
      </section>

      {/* Cloud Providers */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          Cloud AI Providers (Server-Side Environment / Secrets)
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cloudProviders.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              draft={getDraft(p)}
              saving={savingId === p.id}
              testing={testingId === p.id}
              onFieldChange={(field, val) => setDraftField(p.id, field, val, p)}
              onSave={() => void handleSave(p)}
              onSetDefault={() => void handleSave(p, { isDefault: true, enabled: true })}
              onToggleEnabled={() => void handleSave(p, { enabled: !p.enabled })}
              onTest={() => void handleTest(p)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

interface ProviderCardProps {
  provider: AiProviderConfig;
  draft: { baseUrl: string; model: string };
  saving: boolean;
  testing: boolean;
  onFieldChange: (field: 'baseUrl' | 'model', value: string) => void;
  onSave: () => void;
  onSetDefault: () => void;
  onToggleEnabled: () => void;
  onTest: () => void;
}

function ProviderCard({
  provider,
  draft,
  saving,
  testing,
  onFieldChange,
  onSave,
  onSetDefault,
  onToggleEnabled,
  onTest,
}: ProviderCardProps) {
  return (
    <article className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{provider.name}</h3>
            {provider.isDefault && (
              <>
                <span aria-hidden="true" className="text-zinc-400">·</span>
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Default</span>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            {provider.pricingTier} ·{' '}
            {provider.kind === 'local' ? (
              <span className="text-emerald-600 dark:text-emerald-400">No API key needed</span>
            ) : provider.configured ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                Server env <code className="font-mono">{provider.envVarName}</code> detected
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Set <code className="font-mono">{provider.envVarName}</code> in server .env / Secrets
              </span>
            )}
          </p>
        </div>

        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={onToggleEnabled}
            className="h-3.5 w-3.5 rounded accent-blue-600"
          />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Model Identifier</label>
          <input
            type="text"
            value={draft.model}
            onChange={(e) => onFieldChange('model', e.target.value)}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">Endpoint Base URL</label>
          <input
            type="text"
            value={draft.baseUrl}
            disabled={provider.id === 'gemini'}
            onChange={(e) => onFieldChange('baseUrl', e.target.value)}
            className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-900 dark:text-zinc-100 disabled:opacity-60"
          />
        </div>
      </div>

      {provider.lastTestMessage && (
        <div
          className={`flex items-start gap-2 text-xs ${
            provider.lastTestOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {provider.lastTestOk ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{provider.lastTestMessage}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <PlugZap className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {!provider.isDefault && (
          <button
            type="button"
            onClick={onSetDefault}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            <Server className="h-3.5 w-3.5" />
            Set Default
          </button>
        )}
      </div>
    </article>
  );
}
