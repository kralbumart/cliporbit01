import { useState } from 'react';
import type { SystemMetrics } from '../types/studio';

interface ArchitectureAndRoadmapViewProps {
  metrics: SystemMetrics | null;
  initialSection?: 'architecture' | 'providers' | 'roadmap';
}

const PHASES = [
  {
    phase: 'Phase 1',
    title: 'Environment Audit, Architecture & Resource Plan',
    status: 'Completed',
    summary: 'Host inspection (OS/CPU/RAM/Disk/FFmpeg), ASCII architecture, dependency matrix, and 10-phase roadmap in /docs.',
  },
  {
    phase: 'Phase 2',
    title: 'AI-Free Local MVP (Native FFmpeg + SQLite Queue)',
    status: 'Completed',
    summary: 'Dashboard, disk-streamed Media Library, Sample Generator, Trim, 9:16/16:9/1:1, Blur-Pad, Subtitles, Logo Overlay, Merge, Audio Extract, Silence Clipper, SSE Queue.',
  },
  {
    phase: 'Phase 3',
    title: 'Modular AI Provider Hub & Task Router',
    status: 'Next Up',
    summary: 'Ollama, llama.cpp, LM Studio, Gemini, OpenRouter, OpenAI, Anthropic, DeepSeek, Groq, custom OpenAI-compatible endpoints, Colibri extensible adapter.',
  },
  {
    phase: 'Phase 4',
    title: 'AI Script Studio, Local Whisper & TTS Voiceover',
    status: 'Planned',
    summary: 'Topic-to-script editor, offline Whisper SRT transcription, Piper/Edge TTS voice generation, scene-by-scene review before render.',
  },
  {
    phase: 'Phase 5',
    title: 'AutoClip Highlights & Optional Face Tracking',
    status: 'Planned',
    summary: 'Combine deterministic FFmpeg clipping with optional vision/transcript highlight scoring and speaker-aware 9:16 reframing.',
  },
  {
    phase: 'Phase 6',
    title: 'Multi-User SaaS, PostgreSQL & S3 Storage',
    status: 'Planned',
    summary: 'User auth, RBAC, tenant isolation, usage/storage quotas, PostgreSQL migrations, S3/MinIO object storage, audit logs.',
  },
  {
    phase: 'Phase 7',
    title: 'Official Social Media Publishing Adapters',
    status: 'Planned',
    summary: 'Postiz/OpenPost-style OAuth publishing for YouTube, Instagram, TikTok, X, LinkedIn, Facebook, Pinterest with strict API confirmation.',
  },
  {
    phase: 'Phase 8',
    title: 'Windows Desktop (Tauri) & Android (PWA / Capacitor)',
    status: 'Planned',
    summary: 'Lightweight zero-Docker Windows installer + PowerShell setup scripts; mobile PWA/Capacitor client delegating renders to worker nodes.',
  },
  {
    phase: 'Phase 9',
    title: 'Vercel Frontend + Decoupled Cloud Workers',
    status: 'Planned',
    summary: 'Deploy static UI on Vercel while running FFmpeg/AI workers on dedicated VM/local Windows nodes.',
  },
  {
    phase: 'Phase 10',
    title: 'Automated Tests, Security Audit & GitHub Release',
    status: 'Planned',
    summary: 'CI test pipelines, LICENSE/SECURITY/CONTRIBUTING/CHANGELOG verification, and public repository publication.',
  },
];

const LOCAL_PROVIDERS = [
  { name: 'Ollama', mode: 'Local Free', note: 'Primary local LLM runner (http://localhost:11434)' },
  { name: 'llama.cpp Server', mode: 'Local Free', note: 'Ultra-low-RAM quantized GGUF inference' },
  { name: 'LM Studio', mode: 'Local Free', note: 'OpenAI-compatible local desktop server' },
  { name: 'OpenCode-Compatible Workflows', mode: 'Local Free', note: 'Scriptable agent/coding pipelines' },
  { name: 'Local OpenAI-Compatible Endpoint', mode: 'Local Free', note: 'Custom base URL for vLLM / LocalAI / Jan' },
];

const CLOUD_PROVIDERS = [
  { name: 'Google Gemini / AI Studio', tier: 'Free Tier / Paid BYOK' },
  { name: 'OpenRouter', tier: 'Multi-Model BYOK' },
  { name: 'OpenAI', tier: 'Paid BYOK' },
  { name: 'Anthropic Claude', tier: 'Paid BYOK' },
  { name: 'DeepSeek', tier: 'Paid BYOK' },
  { name: 'Groq', tier: 'Free Tier / Paid BYOK' },
  { name: 'Cerebras', tier: 'Free Tier / Paid BYOK' },
  { name: 'Mistral', tier: 'Free Tier / Paid BYOK' },
  { name: 'Cohere', tier: 'Trial / Paid BYOK' },
  { name: 'Hugging Face Inference', tier: 'Free Tier / Paid BYOK' },
  { name: 'Together AI / Fireworks AI / SambaNova', tier: 'Paid BYOK' },
  { name: 'NVIDIA NIM / Azure OpenAI / AWS Bedrock', tier: 'Enterprise BYOK' },
  { name: 'Cloudflare Workers AI / Perplexity / Qwen', tier: 'Free Tier / Paid BYOK' },
  { name: 'Colibri', tier: 'Extensible Adapter Placeholder (pending verified public API spec)' },
];

export function ArchitectureAndRoadmapView({
  metrics,
  initialSection = 'architecture',
}: ArchitectureAndRoadmapViewProps) {
  const [section, setSection] = useState<'architecture' | 'providers' | 'roadmap'>(initialSection);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Phase 1 Engineering Deliverables · Honest Implementation Boundary
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Architecture & Platform Roadmap
          </h1>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-1">
          {(
            [
              ['architecture', 'Architecture & Host'],
              ['providers', 'AI Provider Hub (Ph 3)'],
              ['roadmap', '10-Phase Plan'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                section === key
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {section === 'architecture' && (
        <div className="space-y-6">
          {/* Live Inspected Host Baseline */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Inspected Runtime Environment
            </h2>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">OS & Arch</p>
                <p className="mt-1 font-mono text-zinc-900 dark:text-zinc-100">
                  {metrics ? `${metrics.platform} (${metrics.arch})` : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">CPU & RAM</p>
                <p className="mt-1 font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {metrics ? `${metrics.cpuCores} vCPU · ${metrics.ramTotalMb} MB RAM` : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">Node & SQLite</p>
                <p className="mt-1 font-mono text-zinc-900 dark:text-zinc-100">
                  {metrics ? `${metrics.nodeVersion} · node:sqlite WAL` : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 dark:text-zinc-400">FFmpeg / Docker</p>
                <p className="mt-1 font-mono text-zinc-900 dark:text-zinc-100">
                  {metrics?.ffmpegAvailable ? 'FFmpeg Ready' : 'FFmpeg Missing'} ·{' '}
                  {metrics?.dockerAvailable ? 'Docker Optional' : 'No Docker Needed'}
                </p>
              </div>
            </div>
          </section>

          {/* ASCII Architecture Diagram */}
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-6">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
              Decoupled Local-First & Cloud-Scalable Architecture
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Runs as one lightweight Node.js process on 8 GB RAM Windows/Linux machines today; swaps SQLite → PostgreSQL and local disk → S3 in Phase 6–9 without rewriting the UI.
            </p>
            <pre className="mt-4 rounded-lg bg-zinc-950 text-zinc-200 p-4 text-[11px] font-mono overflow-x-auto leading-relaxed">
{`[ React 19 UI (Web / Vercel / Android PWA / Windows Tauri) ]
                       |  REST API + Live SSE Stream
                       v
[ Express API Server ] — Disk-streamed Multer uploads & HTTP Range video streaming
   ├── SQLite (WAL mode)  --> Upgrade path: PostgreSQL (Phase 6)
   ├── Local Worker Queue (Default Concurrency = 1, Pause/Resume/Cancel/Retry)
   │      └── Native FFmpeg / FFprobe (shell:false, single-pass filtergraphs)
   ├── Local Storage (uploads / exports / thumbnails / temp) --> Upgrade: S3 / MinIO
   └── Modular Extension Slots (Inactive until configured):
          ├── Phase 3: AI Provider Hub (Ollama local + BYOK Cloud APIs)
          └── Phase 7: Social Publishing Adapters (YouTube, IG, TikTok, X, LinkedIn)`}
            </pre>
          </section>
        </div>
      )}

      {section === 'providers' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              Status: Scheduled for Phase 3 (Core Editing Works 100% AI-Free Today)
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              In alignment with our phased development discipline, AI provider credentials and remote inference calls are intentionally deferred until Phase 3 so that every deterministic FFmpeg operation is verified first. All provider keys will be stored exclusively server-side (BYOK) with zero browser exposure, and local models (Ollama / llama.cpp) will take routing priority over paid APIs.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Planned Local AI Providers (Zero API Cost)
              </h3>
              <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {LOCAL_PROVIDERS.map((p) => (
                  <div key={p.name} className="py-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{p.mode}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{p.note}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Planned Cloud AI Providers (BYOK / Optional)
              </h3>
              <div className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[340px] overflow-y-auto">
                {CLOUD_PROVIDERS.map((p) => (
                  <div key={p.name} className="py-2 flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                    <span className="text-zinc-500 dark:text-zinc-400 text-right">{p.tier}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {section === 'roadmap' && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/50">
                  <th className="py-3 px-4 font-medium">Phase</th>
                  <th className="py-3 px-4 font-medium">Milestone</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
                {PHASES.map((item) => (
                  <tr key={item.phase} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <td className="py-3 px-4 font-mono font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                      {item.phase}
                    </td>
                    <td className="py-3 px-4 font-medium text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          item.status === 'Completed'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : item.status === 'Next Up'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-zinc-600 dark:text-zinc-400 max-w-md">
                      {item.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
