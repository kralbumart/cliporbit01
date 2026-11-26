# Changelog

All notable changes to **OpenVideo Studio** are documented here.

## [2.0.0] - 2026-11-26 — AI Viral Clipping Studio Upgrade

### Added
- **Universal Video Link Input**: URL validation, platform detection (`youtube`, `twitch`, `kick`, `direct_video`), official YouTube oEmbed metadata + thumbnail preview, native direct HTTPS video downloads (250 MB cap + SSRF protection), and automatic `yt-dlp` integration when installed locally.
- **AI Clipping Engine & Provider Hub**: Support for Google Gemini (`@google/genai`), Ollama, LM Studio, Groq, OpenRouter, DeepSeek, OpenAI, and Custom OpenAI-compatible APIs. Added `Fast`, `Balanced`, `Best`, and `Non-AI` modes, audio transcription, live provider testing, and deterministic non-AI FFmpeg clipping fallback.
- **Viral Clip Rules & Metadata**: Configurable viral clipping rules, editable/copyable titles, hooks, descriptions, hashtags, keywords, category, viral score + rationale, SRT captions, and Words-to-Avoid warnings.
- **Upgraded Clip Editor**: Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), multi-segment timeline (split at playhead, duplicate, reorder, delete), `Split Facecam + Gameplay` crop boxes, TikTok/Reels/Shorts Safe Area guides, 4 caption styles + color pickers + Words-per-Line re-wrapper, logo X/Y margins, Fade-In/Fade-Out transitions, Intro/Outro concatenation, and persistent Brand Templates.
- **Automation Hub**: Live folder watcher on `storage/watch_inbox/` with ON/OFF controls and sample inbox drop test, SSRF-hardened Discord/Zapier/custom webhooks with live test trigger, and Words-to-Avoid rules.
- **Creators & Campaigns**: Creator directory with URL reachability checks, per-creator clip history, and transparent verified/unconfirmed campaign ledger.
- **Public GitHub & Windows Readiness**: Added `docs/MISSING_FEATURE_REPORT.md`, `docs/WINDOWS_INSTALL.md`, `scripts/setup-windows.ps1`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/workflows/ci.yml`, and `tests/smoke.test.mjs`.

## [1.0.0] - Initial Release (Phase 1 & 2)

- Local-first AI-free FFmpeg studio with SQLite job queue (concurrency = 1), SSE telemetry, Media Library, basic Video Editor, Silence-based Auto-Clipper & Merger, and Architecture Roadmap.
