# OpenVideo Studio — AI Viral Clipping & Local Video Automation Platform

**OpenVideo Studio** is an open-source-first, low-resource AI viral clipping and deterministic FFmpeg video studio designed to run natively on **8 GB RAM** Windows 10/11, Linux, and macOS machines — with **no mandatory Docker, no mandatory GPU, and no mandatory paid API keys**.

## Key Capabilities

- **Universal Video Link Input**: Paste YouTube, Twitch, Kick, or direct HTTPS `.mp4`/`.webm`/`.mov` URLs (or upload local videos). Validates URLs with SSRF protection, fetches real YouTube oEmbed metadata & thumbnails, streams direct videos natively, and automatically leverages local `yt-dlp` when installed.
- **AI Viral Clipping Engine & Provider Hub**: Configure local (**Ollama**, **LM Studio**) or cloud (**Google Gemini**, **Groq**, **OpenRouter**, **DeepSeek**, **OpenAI**, **Custom OpenAI-compatible**) providers via server-side environment variables. Supports **Fast**, **Balanced**, **Best**, and **Non-AI** modes, audio transcription, configurable viral clip rules, and editable/copyable titles, hooks, descriptions, hashtags, keywords, and viral score explanations.
- **Full Clip Editor**: Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), multi-segment timeline (split at playhead, duplicate, reorder, delete), `9:16` / `16:9` / `1:1` framing, **Split Facecam + Gameplay** manual crop boxes, TikTok/Reels/Shorts safe-area guides, 4 caption presets + color pickers + Words-per-Line SRT re-wrapper, logo watermarks with X/Y margins, Fade-In/Fade-Out transitions, Intro/Outro concatenation, and persistent **Brand Templates**.
- **Automation Hub**: Live folder watcher (`storage/watch_inbox/`) with ON/OFF controls, SSRF-hardened Discord/Zapier/custom webhook notifications, and **Words-to-Avoid** compliance warnings.
- **Creators & Campaigns**: Manage creator channels, run URL reachability checks (honestly distinguishing verified vs. unconfirmed status), track per-creator clip history, and log clipping campaigns without fabricated payouts.
- **Low-Resource Worker Queue**: Persistent Node 22 native SQLite (`WAL` mode) job queue with default `concurrency = 1`, live CPU/RAM/disk SSE telemetry, and pause/resume/cancel/retry controls.

## Quick Start (Zero API Keys or `.env` Required)

All environment variables are optional and use safe local defaults (`STORAGE_DIR=./storage`, `DATABASE_PATH=./data/openvideo.db`, `WORKER_CONCURRENCY=1`, `FFMPEG_THREADS=2`, `FFMPEG_PATH=ffmpeg`, `FFPROBE_PATH=ffprobe`, `YT_DLP_PATH=yt-dlp`). Ollama, LM Studio, and cloud AI keys are completely optional — Non-AI FFmpeg editing and clipping work out of the box.

```bash
npm install
npm run dev
```

Open **http://localhost:3000**.

### Windows 10 / 11 Native Setup (Node.js + Python + FFmpeg, No Docker)

1. Install **Node.js 22 LTS** (`winget install OpenJS.NodeJS.LTS`) and **FFmpeg** (`winget install Gyan.FFmpeg`).
2. *(Optional)* Install **Python 3.12** (`winget install Python.Python.3.12`) if you want `yt-dlp` for YouTube/Twitch/Kick URL downloads.
3. Run the automated PowerShell script or start directly with `npm install && npm run dev`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

See [`docs/WINDOWS_INSTALL.md`](docs/WINDOWS_INSTALL.md) for full details.

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start Express API + Vite dev server on port 3000 |
| `npm run lint` | TypeScript strict type check (`tsc --noEmit`) |
| `npm run build` | Build production frontend into `dist/` |
| `npm test` | Run end-to-end API & FFmpeg smoke test (`tests/smoke.test.mjs`) |

## Documentation

- [`docs/MISSING_FEATURE_REPORT.md`](docs/MISSING_FEATURE_REPORT.md) — Audit & implementation breakdown
- [`docs/WINDOWS_INSTALL.md`](docs/WINDOWS_INSTALL.md) — Native Windows 10/11 guide (zero Docker)
- [`SECURITY.md`](SECURITY.md) — Security controls (SSRF, path safety, server-side keys, `shell: false`)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Developer workflow & guidelines
- [`CHANGELOG.md`](CHANGELOG.md) — Version history

## License

MIT — see [`LICENSE`](LICENSE).
