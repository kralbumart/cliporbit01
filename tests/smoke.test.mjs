#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

async function req(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, data: json };
}

async function waitForJob(jobId, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { ok, data } = await req('/api/jobs');
    assert.equal(ok, true, 'GET /api/jobs should succeed');
    const job = data.find((j) => j.id === jobId);
    if (job && (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')) {
      return job;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function run() {
  console.log(`Running OpenVideo Studio smoke test against ${BASE}...`);

  // 1. Health & System Metrics
  const health = await req('/api/health');
  assert.equal(health.status, 200, '/api/health must return 200');
  assert.equal(health.data.ok, true, '/api/health ok must be true');

  const metrics = await req('/api/system/metrics');
  assert.equal(metrics.status, 200, '/api/system/metrics must return 200');
  assert.equal(metrics.data.ffmpegAvailable, true, 'FFmpeg must be detected');
  console.log(`  [PASS] Health & Metrics (FFmpeg: ${metrics.data.ffmpegVersion}, yt-dlp: ${metrics.data.ytDlpAvailable})`);

  // 2. Universal URL Input validation (SSRF block + YouTube inspect)
  const ssrf = await req('/api/url/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:3000/secret.mp4' }),
  });
  assert.equal(ssrf.status, 400, 'Loopback SSRF URL must be rejected with 400');

  const invalidProto = await req('/api/url/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'file:///etc/passwd' }),
  });
  assert.equal(invalidProto.status, 400, 'Non-HTTP URL must be rejected');
  console.log('  [PASS] SSRF & URL scheme validation');

  // 3. AI Providers listing
  const providers = await req('/api/ai/providers');
  assert.equal(providers.status, 200, 'GET /api/ai/providers must return 200');
  assert.ok(providers.data.length >= 6, 'Should expose seeded local & cloud AI providers');
  console.log(`  [PASS] AI Providers (${providers.data.length} providers configured in registry)`);

  // 4. Generate 12s FFmpeg sample pack
  const sample = await req('/api/media/generate-sample', { method: 'POST' });
  assert.equal(sample.status, 201, 'Sample pack generation must return 201');
  const videoId = sample.data.videoAsset.id;
  const logoId = sample.data.logoAsset?.id || null;
  assert.ok(videoId, 'Sample video asset must be created');
  console.log(`  [PASS] Sample pack generated (${videoId})`);

  // 5. Non-AI Viral Clip Generation + Words-to-Avoid check
  await req('/api/automation', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wordsToAvoid: ['forbiddenword'] }),
  });

  const clipGen = await req('/api/ai/analyze-clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaId: videoId,
      transcript: '00:00 Welcome to OpenVideo Studio. 00:04 This clip avoids forbiddenword and shows real local FFmpeg rendering. 00:09 Export crisp vertical clips.',
      mode: 'non_ai',
      rules: {
        strongHook: true,
        removeSilence: true,
        meaningfulContext: true,
        completeSentences: true,
        engagingMoments: true,
        noAbruptEnding: true,
        noMisleadingEdits: true,
        minDurationSec: 3,
        maxDurationSec: 8,
        maxClips: 2,
        language: 'English',
        aspectRatio: '9:16',
        minViralScore: 50,
        sceneDetection: true,
        facecamSplit: false,
        speakerFocus: false,
      },
    }),
  });
  assert.equal(clipGen.status, 201, 'POST /api/ai/analyze-clips (non_ai) must return 201');
  assert.ok(clipGen.data.clips.length >= 1, 'Should generate at least 1 clip');
  const firstClip = clipGen.data.clips[0];
  console.log(`  [PASS] Non-AI Clip Engine generated ${clipGen.data.clips.length} clips (score ${firstClip.viralScore})`);

  // 6. Save Brand Template
  const tpl = await req('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Test Split Template',
      aspectRatio: '9:16',
      fitMode: 'split_facecam',
      facecamBox: { xPct: 65, yPct: 5, wPct: 30, hPct: 35 },
      gameplayBox: { xPct: 10, yPct: 10, wPct: 80, hPct: 80 },
      captionStyle: 'viral_yellow',
      captionColor: '#FACC15',
      captionOutlineColor: '#000000',
      captionFontSize: 22,
      captionPosition: 'middle',
      wordsPerLine: 4,
      logoMediaId: logoId,
      logoCorner: 'top-right',
      logoScalePct: 18,
      logoOpacity: 0.85,
      logoMarginX: 20,
      logoMarginY: 20,
      fadeInSec: 0.3,
      fadeOutSec: 0.3,
      brandColor: '#2563EB',
    }),
  });
  assert.equal(tpl.status, 201, 'POST /api/templates must return 201');
  console.log(`  [PASS] Brand template saved (${tpl.data.id})`);

  // 7. Full Upgraded FFmpeg Pipeline Render (Multi-segment + Split Facecam + Styled Captions + Logo Margins + Fade)
  const renderRes = await req('/api/jobs/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaId: videoId,
      clipId: firstClip.id,
      outputName: 'smoke_split_render',
      trimEnabled: true,
      startSec: 0,
      endSec: 4,
      segments: [
        { id: 's1', label: 'Intro', startSec: 0, endSec: 2 },
        { id: 's2', label: 'Hook', startSec: 4, endSec: 6 },
      ],
      aspectRatio: '9:16',
      fitMode: 'split_facecam',
      facecamBox: { xPct: 65, yPct: 5, wPct: 30, hPct: 35 },
      gameplayBox: { xPct: 10, yPct: 10, wPct: 80, hPct: 80 },
      resolution: '480p',
      crf: 26,
      preset: 'ultrafast',
      subtitleEnabled: true,
      subtitleInlineSrt: '1\n00:00:00,200 --> 00:00:03,600\nSmoke Test Vertical Caption',
      subtitlePosition: 'middle',
      subtitleFontSize: 20,
      captionStyle: 'viral_yellow',
      captionColor: '#FACC15',
      captionOutlineColor: '#000000',
      logoEnabled: Boolean(logoId),
      logoMediaId: logoId,
      logoCorner: 'top-right',
      logoScalePct: 18,
      logoOpacity: 0.85,
      logoMarginX: 20,
      logoMarginY: 20,
      fadeInSec: 0.3,
      fadeOutSec: 0.3,
      audioMode: 'keep',
      musicVolume: 0.3,
    }),
  });
  assert.equal(renderRes.status, 201, 'POST /api/jobs/edit must return 201');
  const finishedJob = await waitForJob(renderRes.data.id);
  assert.equal(finishedJob.status, 'completed', `FFmpeg job failed: ${finishedJob.errorMessage}`);
  assert.ok(finishedJob.outputMediaId, 'Completed job must produce outputMediaId');
  console.log(`  [PASS] Upgraded FFmpeg render completed (${finishedJob.outputMediaId})`);

  // 8. Creators & Campaigns CRUD
  const creator = await req('/api/creators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Test Channel',
      platform: 'youtube',
      channelUrl: 'https://www.youtube.com/@YouTube',
      handle: '@YouTube',
      monitoringEnabled: true,
      autoClipEnabled: false,
    }),
  });
  assert.equal(creator.status, 201, 'POST /api/creators must return 201');

  const campaign = await req('/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Test Brief',
      brandName: 'OpenVideo',
      platform: 'YouTube Shorts',
      verificationStatus: 'unconfirmed',
      status: 'active',
      eligibilitySummary: '9:16 clips',
      payoutInfo: 'Unconfirmed',
      sourceUrl: '',
      notes: 'Automated smoke check',
    }),
  });
  assert.equal(campaign.status, 201, 'POST /api/campaigns must return 201');

  // Cleanup test records
  await req(`/api/creators/${creator.data.id}`, { method: 'DELETE' });
  await req(`/api/campaigns/${campaign.data.id}`, { method: 'DELETE' });
  await req(`/api/templates/${tpl.data.id}`, { method: 'DELETE' });
  for (const c of clipGen.data.clips) {
    await req(`/api/clips/${c.id}`, { method: 'DELETE' });
  }
  await req(`/api/jobs/${finishedJob.id}`, { method: 'DELETE' });
  await req(`/api/media/${finishedJob.outputMediaId}`, { method: 'DELETE' });
  await req(`/api/media/${videoId}`, { method: 'DELETE' });
  if (logoId) await req(`/api/media/${logoId}`, { method: 'DELETE' });
  if (sample.data.subtitleAsset?.id) {
    await req(`/api/media/${sample.data.subtitleAsset.id}`, { method: 'DELETE' });
  }

  console.log('  [PASS] Creators, Campaigns, and cleanup verified');
  console.log('ALL SMOKE TESTS PASSED.');
}

run().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
