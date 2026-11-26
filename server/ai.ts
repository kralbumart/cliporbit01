import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getAiProviderById, getAutomationConfig, listAiProviders, updateAiProvider } from './db.ts';
import { detectActiveSegments, buildExtractAudioArgs, spawnFfmpegJob } from './ffmpeg.ts';
import { STORAGE_ROOT, TEMP_DIR, assertSafePath, safeUnlink } from './paths.ts';
import { assertSafePublicUrl } from './urlImport.ts';
import type {
  AiProviderConfig,
  AiProviderId,
  ClippingMode,
  ViralClipRecord,
  ViralClipRules,
} from '../src/types/studio.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !apiKey.trim() || apiKey.startsWith('MY_')) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getProviderApiKey(provider: AiProviderConfig): string | null {
  if (provider.kind === 'local') return null;
  if (!provider.envVarName) return null;
  const val = process.env[provider.envVarName];
  if (!val || !val.trim() || val.startsWith('MY_')) return null;
  return val.trim();
}

export function scanRestrictedWords(texts: string[], wordsToAvoid: string[]): string[] {
  if (!wordsToAvoid.length) return [];
  const combined = texts.join(' ').toLowerCase();
  const matched: string[] = [];
  for (const rawWord of wordsToAvoid) {
    const word = rawWord.trim().toLowerCase();
    if (word && combined.includes(word)) {
      matched.push(rawWord.trim());
    }
  }
  return Array.from(new Set(matched));
}

export function formatSrtTime(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const secs = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(Math.min(999, ms)).padStart(3, '0')}`;
}

export function wrapTextToSrt(text: string, durationSec: number, wordsPerLine = 5): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const chunkSize = Math.max(2, Math.min(12, wordsPerLine));
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  const slotDur = Math.max(0.8, durationSec / Math.max(1, chunks.length));
  return chunks
    .map((line, idx) => {
      const start = idx * slotDur;
      const end = Math.min(durationSec, (idx + 1) * slotDur);
      return `${idx + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${line}`;
    })
    .join('\n\n');
}

export async function testAiProvider(providerId: AiProviderId): Promise<{
  ok: boolean;
  message: string;
  models?: string[];
}> {
  const provider = getAiProviderById(providerId);
  if (!provider) {
    return { ok: false, message: 'Provider not found.' };
  }

  const now = new Date().toISOString();

  try {
    if (provider.id === 'gemini') {
      const ai = getGeminiClient();
      if (!ai) {
        const msg = 'GEMINI_API_KEY is not configured in server environment / Secrets.';
        updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: false, lastTestMessage: msg });
        return { ok: false, message: msg };
      }
      const res = await ai.models.generateContent({
        model: provider.model || 'gemini-4-hydrogen',
        contents: 'Reply with OK.',
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      const ok = Boolean(res.text && res.text.trim().length > 0);
      const msg = ok
        ? `Connected to Google Gemini (${provider.model}).`
        : 'Gemini returned an empty response.';
      updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: ok, lastTestMessage: msg });
      return { ok, message: msg };
    }

    if (provider.id === 'ollama') {
      const base = provider.baseUrl.replace(/\/+$/, '');
      const resp = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!resp.ok) {
        throw new Error(`Ollama returned HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      const msg =
        models.length > 0
          ? `Connected to local Ollama (${models.length} model${models.length === 1 ? '' : 's'} installed).`
          : 'Connected to Ollama, but no models are pulled yet (run: ollama pull llama3.2:3b).';
      updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: true, lastTestMessage: msg });
      return { ok: true, message: msg, models };
    }

    // OpenAI-compatible (LM Studio local or Groq/OpenRouter/DeepSeek/OpenAI/Custom cloud)
    const apiKey = getProviderApiKey(provider);
    if (provider.kind === 'cloud' && !apiKey) {
      const msg = `Set ${provider.envVarName} in your server .env / Secrets to enable ${provider.name}.`;
      updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: false, lastTestMessage: msg });
      return { ok: false, message: msg };
    }

    const base = provider.baseUrl.replace(/\/+$/, '');
    if (provider.kind === 'cloud') {
      await assertSafePublicUrl(base);
    }

    const headers: Record<string, string> = {};
    if (apiKey && apiKey !== 'local') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const resp = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      throw new Error(`${provider.name} returned HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as { data?: Array<{ id: string }> };
    const models = (data.data || []).slice(0, 20).map((m) => m.id);
    const msg = `Connected to ${provider.name} (${models.length} models listed).`;
    updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: true, lastTestMessage: msg });
    return { ok: true, message: msg, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    updateAiProvider(providerId, { lastTestedAt: now, lastTestOk: false, lastTestMessage: msg });
    return { ok: false, message: msg };
  }
}

/**
 * Extracts a compact mono MP3 audio track and transcribes it using Gemini 3.5 Transcribe
 * when GEMINI_API_KEY is available on the server. Never fabricates speech if unavailable.
 */
export async function transcribeVideoWithGemini(params: {
  videoPath: string;
  durationSec: number | null;
  language?: string;
}): Promise<{ transcript: string; srtContent: string; providerUsed: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error(
      'Audio transcription requires GEMINI_API_KEY configured in server environment / Settings > Secrets (or upload/paste an SRT transcript directly).',
    );
  }

  const tempAudioPath = assertSafePath(TEMP_DIR, path.join(TEMP_DIR, `transcribe_${crypto.randomUUID()}.mp3`));
  const { args } = buildExtractAudioArgs({
    inputPath: params.videoPath,
    outputPath: tempAudioPath,
    config: { mediaId: 'temp', format: 'mp3', bitrateKbps: 64 },
    durationSec: params.durationSec,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      spawnFfmpegJob({
        args,
        targetDurationSec: Math.max(1, params.durationSec || 10),
        onProgress: () => {},
        onComplete: () => resolve(),
        onError: (msg) => reject(new Error(msg)),
      });
    });

    const stat = fs.statSync(tempAudioPath);
    if (stat.size > 18 * 1024 * 1024) {
      throw new Error('Extracted audio exceeds 18 MB inline transcription limit. Trim the clip or upload an SRT file.');
    }

    const base64Audio = fs.readFileSync(tempAudioPath).toString('base64');
    const langHint = params.language && params.language !== 'Auto' ? ` in ${params.language}` : '';
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/mp3',
              data: base64Audio,
            },
          },
          {
            text: `Transcribe the spoken words accurately${langHint}. If there is only music, tones, or no clear human speech, reply exactly with "[NO_SPEECH_DETECTED]". Never fabricate words.`,
          },
        ],
      },
    });

    const rawText = (response.text || '').trim();
    if (!rawText || rawText.includes('[NO_SPEECH_DETECTED]')) {
      return {
        transcript: '',
        srtContent: '',
        providerUsed: 'Google Gemini (gemini-3.5-transcribe)',
      };
    }

    const srtContent = wrapTextToSrt(rawText, Math.max(1, params.durationSec || 10), 5);
    return {
      transcript: rawText,
      srtContent,
      providerUsed: 'Google Gemini (gemini-3.5-transcribe)',
    };
  } finally {
    safeUnlink(tempAudioPath);
  }
}

interface RawAiClipCandidate {
  title: string;
  description: string;
  hook: string;
  hashtags: string[];
  keywords: string[];
  category: string;
  viralScore: number;
  scoreExplanation: string;
  startSec: number;
  endSec: number;
  transcriptExcerpt: string;
}

function selectActiveProvider(requestedId?: AiProviderId | null): AiProviderConfig | null {
  const all = listAiProviders();
  if (requestedId) {
    const found = all.find((p) => p.id === requestedId);
    if (found) return found;
  }
  // Prefer enabled default, then configured local, then configured cloud
  const defaultProv = all.find((p) => p.isDefault && p.enabled && p.configured);
  if (defaultProv) return defaultProv;
  const configuredCloudOrLocal = all.find((p) => p.enabled && p.configured);
  return configuredCloudOrLocal ?? null;
}

function buildAnalysisPrompt(params: {
  videoName: string;
  durationSec: number;
  transcript: string;
  detectedSegments: Array<{ startSec: number; endSec: number; durationSec: number }>;
  rules: ViralClipRules;
  mode: ClippingMode;
  wordsToAvoid: string[];
}): string {
  const activeRuleFlags = [
    params.rules.strongHook ? 'Strong opening hook in first 3 seconds' : null,
    params.rules.removeSilence ? 'Avoid dead air / unnecessary silence' : null,
    params.rules.meaningfulContext ? 'Standalone meaningful context' : null,
    params.rules.completeSentences ? 'Start and end on complete thoughts/sentences' : null,
    params.rules.engagingMoments ? 'Prioritize emotional reactions, insights, or storytelling peaks' : null,
    params.rules.noAbruptEnding ? 'Clean natural ending without abrupt cutoff' : null,
    params.rules.noMisleadingEdits ? 'Never fabricate speech, claims, or misleading edits' : null,
  ]
    .filter(Boolean)
    .join('; ');

  const depthInstruction =
    params.mode === 'fast'
      ? 'Perform a rapid highlight scan and pick the clearest standalone moments quickly.'
      : params.mode === 'best'
        ? 'Perform deep editorial analysis: evaluate hook strength, pacing, storytelling arc, retention drop-off risk, and verify every timestamp strictly stays within the real video duration.'
        : 'Perform balanced viral highlight selection optimizing hook strength, clarity, and pacing.';

  return [
    `You are an expert short-form video editor analyzing "${params.videoName}" (exact total duration: ${params.durationSec.toFixed(2)} seconds).`,
    depthInstruction,
    `Rules: ${activeRuleFlags}.`,
    `Target clips: up to ${params.rules.maxClips} clips. Each clip duration between ${params.rules.minDurationSec}s and ${Math.min(params.rules.maxDurationSec, params.durationSec)}s (if total video is shorter, use valid spans within 0..${params.durationSec.toFixed(2)}s).`,
    `Target language: ${params.rules.language}. Minimum viral score preference: ${params.rules.minViralScore}/100.`,
    params.wordsToAvoid.length > 0
      ? `Restricted words to avoid in titles/descriptions/hooks: ${params.wordsToAvoid.join(', ')}.`
      : '',
    `Real FFmpeg non-silent audio segments detected in this video: ${JSON.stringify(params.detectedSegments)}.`,
    params.transcript.trim()
      ? `Real transcript/SRT provided:\n${params.transcript.slice(0, 14000)}`
      : 'No spoken transcript was available for this video. Base clip timestamps strictly on the real FFmpeg audio segments above and state clearly in scoreExplanation that analysis is based on segment pacing without speech transcript. NEVER invent spoken quotes.',
    'Never invent view counts, guaranteed viral outcomes, or events not present in the source.',
    'Return ONLY a JSON array of objects with exact fields: title, description, hook, hashtags (string[]), keywords (string[]), category, viralScore (integer 0-100), scoreExplanation, startSec (number), endSec (number), transcriptExcerpt (string).',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runGeminiClipAnalysis(
  provider: AiProviderConfig,
  prompt: string,
  mode: ClippingMode,
): Promise<RawAiClipCandidate[]> {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured in server environment / Settings > Secrets.');
  }

  const thinkingLevel =
    mode === 'fast' ? ThinkingLevel.LOW : mode === 'best' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM;

  const modelName = provider.model || 'gemini-4-hydrogen';
  const useThinking = modelName.startsWith('gemini-4') || modelName.startsWith('gemini-3');

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      ...(useThinking ? { thinkingConfig: { thinkingLevel } } : {}),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            hook: { type: Type.STRING },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
            keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
            category: { type: Type.STRING },
            viralScore: { type: Type.INTEGER },
            scoreExplanation: { type: Type.STRING },
            startSec: { type: Type.NUMBER },
            endSec: { type: Type.NUMBER },
            transcriptExcerpt: { type: Type.STRING },
          },
          required: [
            'title',
            'description',
            'hook',
            'hashtags',
            'keywords',
            'category',
            'viralScore',
            'scoreExplanation',
            'startSec',
            'endSec',
            'transcriptExcerpt',
          ],
        },
      },
    },
  });

  const text = (response.text || '[]').trim();
  return JSON.parse(text) as RawAiClipCandidate[];
}

async function runOpenAiCompatibleAnalysis(
  provider: AiProviderConfig,
  prompt: string,
): Promise<RawAiClipCandidate[]> {
  const apiKey = getProviderApiKey(provider);
  if (provider.kind === 'cloud' && !apiKey) {
    throw new Error(`${provider.name} requires ${provider.envVarName} in your server environment.`);
  }

  const base = provider.baseUrl.replace(/\/+$/, '');
  if (provider.kind === 'cloud') {
    await assertSafePublicUrl(base);
  }

  if (provider.id === 'ollama') {
    const resp = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.model,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'Return a JSON object {"clips":[...]} matching the requested clip schema.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) throw new Error(`Ollama returned HTTP ${resp.status}`);
    const data = (await resp.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(data.message?.content || '{}') as { clips?: RawAiClipCandidate[] } | RawAiClipCandidate[];
    return Array.isArray(parsed) ? parsed : parsed.clips || [];
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strictly valid JSON in the form {"clips":[...]} with no markdown wrappers.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(45000),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`${provider.name} returned HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawContent = (data.choices?.[0]?.message?.content || '{}').trim();
  const cleaned = rawContent.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as { clips?: RawAiClipCandidate[] } | RawAiClipCandidate[];
  return Array.isArray(parsed) ? parsed : parsed.clips || [];
}

export async function analyzeVideoForViralClips(params: {
  mediaId: string;
  videoPath: string;
  videoName: string;
  durationSec: number;
  hasAudio: boolean;
  transcript: string;
  mode: ClippingMode;
  providerId?: AiProviderId | null;
  rules: ViralClipRules;
  creatorId?: string | null;
}): Promise<{ clips: Array<Omit<ViralClipRecord, 'createdAt'>>; providerUsed: string; warning?: string }> {
  const safeDuration = Math.max(1, params.durationSec || 10);
  const automation = getAutomationConfig(false);

  // Always extract real FFmpeg non-silent segments first as deterministic ground truth
  let detectedSegments: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  if (params.hasAudio) {
    try {
      const segs = await detectActiveSegments(params.videoPath, safeDuration, -30, 0.7);
      detectedSegments = segs.map((s) => ({
        startSec: s.startSec,
        endSec: s.endSec,
        durationSec: s.durationSec,
      }));
    } catch {
      detectedSegments = [{ startSec: 0, endSec: safeDuration, durationSec: safeDuration }];
    }
  } else {
    detectedSegments = [{ startSec: 0, endSec: safeDuration, durationSec: safeDuration }];
  }

  // Deterministic Non-AI Mode (honest silence & pacing segmentation)
  if (params.mode === 'non_ai') {
    const baseName = path.parse(params.videoName).name.replace(/[_-]+/g, ' ');
    const chosen = detectedSegments.slice(0, Math.max(1, params.rules.maxClips));
    const clips: Array<Omit<ViralClipRecord, 'createdAt'>> = chosen.map((seg, idx) => {
      const title = `${baseName} — Segment ${idx + 1}`;
      const description = `Non-AI clip extracted from active audio window ${seg.startSec.toFixed(1)}s–${seg.endSec.toFixed(1)}s using FFmpeg silence detection.`;
      const excerpt = params.transcript.trim() ? params.transcript.slice(0, 220) : '';
      const warnings = scanRestrictedWords([title, description, excerpt], automation.wordsToAvoid);
      return {
        id: crypto.randomUUID(),
        mediaId: params.mediaId,
        creatorId: params.creatorId ?? null,
        title,
        description,
        hook: `Active segment starting at ${seg.startSec.toFixed(1)}s`,
        hashtags: ['#shorts', '#clips', '#video'],
        keywords: [baseName.toLowerCase(), 'short clip'],
        category: 'Auto Segment',
        viralScore: 0,
        scoreExplanation: 'Non-AI deterministic FFmpeg silence detection (no LLM viral scoring executed).',
        startSec: seg.startSec,
        endSec: seg.endSec,
        transcriptExcerpt: excerpt,
        srtContent: excerpt ? wrapTextToSrt(excerpt, seg.durationSec, 5) : '',
        restrictedWarnings: warnings,
        analysisMode: 'non_ai',
        providerUsed: 'Native FFmpeg (AI-Free)',
        status: 'draft',
        outputMediaId: null,
      };
    });

    return { clips, providerUsed: 'Native FFmpeg (AI-Free)' };
  }

  const provider = selectActiveProvider(params.providerId);
  if (!provider) {
    throw new Error(
      'No configured AI provider is active. Configure an AI provider (such as Google Gemini via Settings > Secrets or local Ollama) or switch mode to "Non-AI (FFmpeg)".',
    );
  }

  const prompt = buildAnalysisPrompt({
    videoName: params.videoName,
    durationSec: safeDuration,
    transcript: params.transcript,
    detectedSegments,
    rules: params.rules,
    mode: params.mode,
    wordsToAvoid: automation.wordsToAvoid,
  });

  const rawCandidates =
    provider.id === 'gemini'
      ? await runGeminiClipAnalysis(provider, prompt, params.mode)
      : await runOpenAiCompatibleAnalysis(provider, prompt);

  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    throw new Error(`${provider.name} returned no valid clip candidates. Check transcript or try Balanced mode.`);
  }

  const providerLabel = `${provider.name} (${provider.model})`;
  const clips: Array<Omit<ViralClipRecord, 'createdAt'>> = rawCandidates
    .slice(0, Math.max(1, params.rules.maxClips))
    .map((c, idx) => {
      const startSec = Math.max(0, Math.min(safeDuration - 0.5, Number(c.startSec) || 0));
      const endSec = Math.max(startSec + 0.5, Math.min(safeDuration, Number(c.endSec) || safeDuration));
      const title = String(c.title || `Highlight Clip #${idx + 1}`).trim().slice(0, 140);
      const description = String(c.description || '').trim().slice(0, 500);
      const hook = String(c.hook || '').trim().slice(0, 200);
      const hashtags = Array.isArray(c.hashtags)
        ? c.hashtags.map((h) => (String(h).startsWith('#') ? String(h) : `#${String(h)}`)).slice(0, 10)
        : ['#shorts'];
      const keywords = Array.isArray(c.keywords) ? c.keywords.map(String).slice(0, 10) : [];
      const excerpt = String(c.transcriptExcerpt || '').trim();
      const warnings = scanRestrictedWords(
        [title, description, hook, excerpt, ...hashtags],
        automation.wordsToAvoid,
      );

      return {
        id: crypto.randomUUID(),
        mediaId: params.mediaId,
        creatorId: params.creatorId ?? null,
        title,
        description,
        hook,
        hashtags,
        keywords,
        category: String(c.category || 'Highlight').slice(0, 48),
        viralScore: Math.max(0, Math.min(100, Math.round(Number(c.viralScore) || 70))),
        scoreExplanation: String(c.scoreExplanation || '').trim().slice(0, 320),
        startSec: Number(startSec.toFixed(2)),
        endSec: Number(endSec.toFixed(2)),
        transcriptExcerpt: excerpt,
        srtContent: excerpt ? wrapTextToSrt(excerpt, Math.max(1, endSec - startSec), 4) : '',
        restrictedWarnings: warnings,
        analysisMode: params.mode,
        providerUsed: providerLabel,
        status: 'draft',
        outputMediaId: null,
      };
    });

  return { clips, providerUsed: providerLabel };
}
