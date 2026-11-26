import { useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { formatTimeAgo, studioApi } from '../lib/api';
import type { CampaignRecord, CreatorProfile, ViralClipRecord } from '../types/studio';

interface CreatorsCampaignsViewProps {
  creators: CreatorProfile[];
  campaigns: CampaignRecord[];
  clips: ViralClipRecord[];
  onRefreshCreators: () => Promise<void>;
  onRefreshCampaigns: () => Promise<void>;
  onNotify: (message: string, tone?: 'info' | 'error') => void;
}

function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function CreatorsCampaignsView({
  creators,
  campaigns,
  clips,
  onRefreshCreators,
  onRefreshCampaigns,
  onNotify,
}: CreatorsCampaignsViewProps) {
  const [subTab, setSubTab] = useState<'creators' | 'campaigns'>('creators');

  // Creator form state
  const [creatorName, setCreatorName] = useState('');
  const [creatorPlatform, setCreatorPlatform] = useState<'youtube' | 'twitch' | 'kick' | 'other'>('youtube');
  const [creatorUrl, setCreatorUrl] = useState('');
  const [creatorHandle, setCreatorHandle] = useState('');
  const [creatorMonitor, setCreatorMonitor] = useState(true);
  const [creatorAutoClip, setCreatorAutoClip] = useState(false);
  const [addingCreator, setAddingCreator] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Campaign form state
  const [campName, setCampName] = useState('');
  const [campBrand, setCampBrand] = useState('');
  const [campPlatform, setCampPlatform] = useState('YouTube Shorts / TikTok');
  const [campVerification, setCampVerification] = useState<'verified' | 'unconfirmed'>('unconfirmed');
  const [campStatus, setCampStatus] = useState<'active' | 'paused' | 'ended'>('active');
  const [campEligibility, setCampEligibility] = useState('');
  const [campPayout, setCampPayout] = useState('');
  const [campSourceUrl, setCampSourceUrl] = useState('');
  const [campNotes, setCampNotes] = useState('');
  const [addingCampaign, setAddingCampaign] = useState(false);

  async function handleAddCreator(e: React.FormEvent) {
    e.preventDefault();
    if (!creatorName.trim()) {
      onNotify('Enter a creator or channel name.', 'error');
      return;
    }
    setAddingCreator(true);
    try {
      await studioApi.createCreator({
        name: creatorName.trim(),
        platform: creatorPlatform,
        channelUrl: creatorUrl.trim(),
        handle: creatorHandle.trim(),
        monitoringEnabled: creatorMonitor,
        autoClipEnabled: creatorAutoClip,
      });
      setCreatorName('');
      setCreatorUrl('');
      setCreatorHandle('');
      await onRefreshCreators();
      onNotify('Creator profile added.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add creator', 'error');
    } finally {
      setAddingCreator(false);
    }
  }

  async function handleToggleCreator(
    creator: CreatorProfile,
    field: 'monitoringEnabled' | 'autoClipEnabled',
  ) {
    try {
      await studioApi.updateCreator(creator.id, { [field]: !creator[field] });
      await onRefreshCreators();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update creator', 'error');
    }
  }

  async function handleCheckCreator(id: string) {
    setCheckingId(id);
    try {
      const updated = await studioApi.checkCreator(id);
      await onRefreshCreators();
      onNotify(`${updated.name}: ${updated.liveStatusNote}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Status check failed', 'error');
    } finally {
      setCheckingId(null);
    }
  }

  async function handleDeleteCreator(id: string) {
    try {
      await studioApi.deleteCreator(id);
      await onRefreshCreators();
      onNotify('Creator removed.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleAddCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!campName.trim()) {
      onNotify('Enter a campaign name.', 'error');
      return;
    }
    setAddingCampaign(true);
    try {
      await studioApi.createCampaign({
        name: campName.trim(),
        brandName: campBrand.trim() || 'Independent',
        platform: campPlatform.trim() || 'Multi-platform',
        verificationStatus: campVerification,
        status: campStatus,
        eligibilitySummary: campEligibility.trim() || 'Review official campaign brief for eligibility.',
        payoutInfo: campPayout.trim() || 'Unconfirmed — verify directly with campaign host.',
        sourceUrl: campSourceUrl.trim(),
        notes: campNotes.trim(),
      });
      setCampName('');
      setCampBrand('');
      setCampEligibility('');
      setCampPayout('');
      setCampSourceUrl('');
      setCampNotes('');
      await onRefreshCampaigns();
      onNotify('Campaign saved to tracker.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save campaign', 'error');
    } finally {
      setAddingCampaign(false);
    }
  }

  async function handleDeleteCampaign(id: string) {
    try {
      await studioApi.deleteCampaign(id);
      await onRefreshCampaigns();
      onNotify('Campaign deleted.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-5">
        <div>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Channel Tracking · Clip History · Transparent Campaign Ledger
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
            Creators & Campaigns
          </h1>
        </div>

        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setSubTab('creators')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === 'creators'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            Creators ({creators.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('campaigns')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === 'campaigns'
                ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Briefcase className="h-3.5 w-3.5" />
            Campaigns ({campaigns.length})
          </button>
        </div>
      </div>

      {subTab === 'creators' ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Add Creator Form */}
          <form
            onSubmit={(e) => void handleAddCreator(e)}
            className="xl:col-span-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4"
          >
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Add Creator or Channel
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Link clips to creators and check channel URL reachability. Live status stays explicitly unconfirmed unless verified by an official platform API.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Creator / Channel Name
              </label>
              <input
                type="text"
                required
                value={creatorName}
                onChange={(e) => setCreatorName(e.target.value)}
                placeholder="e.g. Tech Breakdown Podcast"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Platform
                </label>
                <select
                  value={creatorPlatform}
                  onChange={(e) =>
                    setCreatorPlatform(e.target.value as 'youtube' | 'twitch' | 'kick' | 'other')
                  }
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="youtube">YouTube</option>
                  <option value="twitch">Twitch</option>
                  <option value="kick">Kick</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Handle
                </label>
                <input
                  type="text"
                  value={creatorHandle}
                  onChange={(e) => setCreatorHandle(e.target.value)}
                  placeholder="@channel"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Channel URL (HTTPS)
              </label>
              <input
                type="url"
                value={creatorUrl}
                onChange={(e) => setCreatorUrl(e.target.value)}
                placeholder="https://www.youtube.com/@channel"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <span>Enable Channel Monitoring</span>
                <input
                  type="checkbox"
                  checked={creatorMonitor}
                  onChange={(e) => setCreatorMonitor(e.target.checked)}
                  className="h-4 w-4 rounded accent-blue-600"
                />
              </label>
              <label className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <span>Auto-Clip Preference</span>
                <input
                  type="checkbox"
                  checked={creatorAutoClip}
                  onChange={(e) => setCreatorAutoClip(e.target.checked)}
                  className="h-4 w-4 rounded accent-blue-600"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={addingCreator}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {addingCreator ? 'Saving...' : 'Add Creator Profile'}
            </button>
          </form>

          {/* Creators Table / Directory */}
          <div className="xl:col-span-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Tracked Creators & Clip History
              </h2>
              <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                {clips.length} total clips in workspace
              </span>
            </div>

            {creators.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No creators added yet. Add a YouTube, Twitch, or Kick channel on the left to organize clip history and check channel reachability.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {creators.map((creator) => {
                  const creatorClips = clips.filter((c) => c.creatorId === creator.id);
                  const renderedCount = creatorClips.filter((c) => c.status === 'rendered').length;
                  const safeLink = isSafeHttpUrl(creator.channelUrl);

                  return (
                    <div key={creator.id} className="p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                            {creator.name}
                          </h3>
                          <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400 uppercase">
                            {creator.platform}
                          </span>
                          {creator.handle && (
                            <>
                              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                              <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                                {creator.handle}
                              </span>
                            </>
                          )}
                        </div>

                        {safeLink && (
                          <a
                            href={creator.channelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            {creator.channelUrl}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        )}

                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Status:{' '}
                          <span
                            className={`font-medium ${
                              creator.liveStatus === 'live'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-zinc-700 dark:text-zinc-300'
                            }`}
                          >
                            {creator.liveStatus}
                          </span>
                          {' · '}
                          {creator.liveStatusNote}
                          {creator.lastCheckedAt && ` (checked ${formatTimeAgo(creator.lastCheckedAt)})`}
                        </p>

                        <p className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                          Clip History: {creatorClips.length} generated · {renderedCount} rendered MP4
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleToggleCreator(creator, 'monitoringEnabled')}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            creator.monitoringEnabled
                              ? 'border-blue-600/40 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                              : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          Monitor: {creator.monitoringEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleCreator(creator, 'autoClipEnabled')}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                            creator.autoClipEnabled
                              ? 'border-emerald-600/40 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'
                              : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400'
                          }`}
                        >
                          Auto-Clip: {creator.autoClipEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCheckCreator(creator.id)}
                          disabled={checkingId === creator.id}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3 w-3 ${checkingId === creator.id ? 'animate-spin' : ''}`} />
                          Check URL
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteCreator(creator.id)}
                          aria-label={`Remove ${creator.name}`}
                          className="rounded-md p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Add Campaign Form */}
          <form
            onSubmit={(e) => void handleAddCampaign(e)}
            className="xl:col-span-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] p-5 space-y-4"
          >
            <div>
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Log Clipping Campaign
              </h2>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Track brand clipping briefs, eligibility rules, and source links. Always mark payouts as unconfirmed unless verified directly with the sponsor.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Campaign Name
              </label>
              <input
                type="text"
                required
                value={campName}
                onChange={(e) => setCampName(e.target.value)}
                placeholder="e.g. Launch Week Shorts Brief"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Brand / Sponsor
                </label>
                <input
                  type="text"
                  value={campBrand}
                  onChange={(e) => setCampBrand(e.target.value)}
                  placeholder="Sponsor name"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Target Platform
                </label>
                <input
                  type="text"
                  value={campPlatform}
                  onChange={(e) => setCampPlatform(e.target.value)}
                  placeholder="YouTube Shorts / TikTok"
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Verification Status
                </label>
                <select
                  value={campVerification}
                  onChange={(e) => setCampVerification(e.target.value as 'verified' | 'unconfirmed')}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="unconfirmed">Unconfirmed</option>
                  <option value="verified">Verified Directly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  Status
                </label>
                <select
                  value={campStatus}
                  onChange={(e) => setCampStatus(e.target.value as 'active' | 'paused' | 'ended')}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Eligibility & Rules Summary
              </label>
              <input
                type="text"
                value={campEligibility}
                onChange={(e) => setCampEligibility(e.target.value)}
                placeholder="e.g. 9:16 vertical, 15-60s, logo watermark required"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Payout Terms (from official brief)
              </label>
              <input
                type="text"
                value={campPayout}
                onChange={(e) => setCampPayout(e.target.value)}
                placeholder="Enter only verified terms or leave unconfirmed"
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Official Brief / Source URL
              </label>
              <input
                type="url"
                value={campSourceUrl}
                onChange={(e) => setCampSourceUrl(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Notes
              </label>
              <textarea
                rows={2}
                value={campNotes}
                onChange={(e) => setCampNotes(e.target.value)}
                placeholder="Deliverables, deadlines, required hashtags..."
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100"
              />
            </div>

            <button
              type="submit"
              disabled={addingCampaign}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {addingCampaign ? 'Saving...' : 'Save Campaign'}
            </button>
          </form>

          {/* Campaigns List */}
          <div className="xl:col-span-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111113] overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                Tracked Clipping Campaigns
              </h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                No fabricated payouts or unverified earnings
              </span>
            </div>

            {campaigns.length === 0 ? (
              <div className="p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No campaigns tracked yet. Log your own sponsor briefs or clipping contests on the left to keep eligibility rules and source URLs organized.
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {campaigns.map((camp) => {
                  const safeLink = isSafeHttpUrl(camp.sourceUrl);
                  return (
                    <div key={camp.id} className="p-5 flex items-start justify-between gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                            {camp.name}
                          </h3>
                          <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span className="text-xs text-zinc-600 dark:text-zinc-400">{camp.brandName}</span>
                          <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium ${
                              camp.verificationStatus === 'verified'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {camp.verificationStatus === 'verified' && <CheckCircle2 className="h-3.5 w-3.5" />}
                            {camp.verificationStatus === 'verified' ? 'Verified' : 'Unconfirmed'}
                          </span>
                          <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">·</span>
                          <span className="text-xs font-mono uppercase text-zinc-500 dark:text-zinc-400">
                            {camp.status}
                          </span>
                        </div>

                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          <span className="text-zinc-500 dark:text-zinc-400">Platform:</span> {camp.platform} ·{' '}
                          <span className="text-zinc-500 dark:text-zinc-400">Eligibility:</span> {camp.eligibilitySummary}
                        </p>
                        <p className="text-xs text-zinc-600 dark:text-zinc-300">
                          <span className="text-zinc-500 dark:text-zinc-400">Payout terms:</span> {camp.payoutInfo}
                        </p>
                        {camp.notes && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{camp.notes}</p>
                        )}
                        {safeLink && (
                          <a
                            href={camp.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            Official brief link
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDeleteCampaign(camp.id)}
                        aria-label={`Delete ${camp.name}`}
                        className="rounded-md p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
