# Contributing to OpenVideo Studio

We welcome pull requests, bug reports, and feature ideas that keep **OpenVideo Studio** lightweight, local-first, honest, and easy to run on 8 GB RAM machines.

## Core Engineering Principles

1. **AI-Free Core First**: Every deterministic video editing feature (trim, split, merge, aspect ratio, facecam split, captions, branding, audio, folder watch) must continue working without any paid API key.
2. **Low Resource Usage**: Never raise default worker concurrency above `1` or load heavy ML models automatically on startup.
3. **Security by Default**:
   - Keep all cloud API keys strictly server-side via environment variables.
   - Always spawn `ffmpeg`, `ffprobe`, and `yt-dlp` with `shell: false` and explicit argument arrays.
   - Validate all external URLs with `assertSafePublicUrl` (SSRF protection) and all file paths with `assertSafePath`.
4. **Honest Reporting**: Never simulate downloads, AI analysis, live stream status, or campaign payouts.

## Development Workflow

```bash
npm install
npm run dev      # Starts Express + Vite on http://localhost:3000
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run build    # Production Vite frontend build
npm test         # End-to-end API & FFmpeg smoke test (requires server running on port 3000)
```

## Submitting Pull Requests

1. Fork the repository and create a descriptive feature branch.
2. Ensure `npm run lint` and `npm run build` pass with zero errors.
3. Never commit `.env`, `storage/`, or `data/*.db` files.
4. Open a pull request describing the change and how it was tested.
