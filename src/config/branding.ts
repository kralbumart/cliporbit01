export interface BrandConfig {
  appName: string;
  shortName: string;
  tagline: string;
  version: string;
  license: string;
  repositoryUrl: string;
  defaultConcurrency: number;
  defaultFfmpegPreset: 'ultrafast' | 'veryfast' | 'fast';
  defaultFfmpegThreads: number;
}

/**
 * Single source of truth for branding and default low-resource settings.
 * Edit this file to white-label or customize the platform name and defaults.
 */
export const BRAND_CONFIG: BrandConfig = {
  appName: 'OpenVideo Studio',
  shortName: 'OVS',
  tagline: 'Open-Source Video Automation & Deterministic FFmpeg Studio',
  version: '0.2.0-mvp',
  license: 'MIT',
  repositoryUrl: 'https://github.com/openvideo-studio/openvideo-studio',
  defaultConcurrency: 1,
  defaultFfmpegPreset: 'veryfast',
  defaultFfmpegThreads: 2,
};
