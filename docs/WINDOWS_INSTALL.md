# Native Windows 10 / 11 Setup Guide (Node.js, Python & FFmpeg — No Docker)

OpenVideo Studio runs natively on **Windows 10 and Windows 11** with **8 GB RAM** (16 GB recommended), **no Docker**, **no mandatory GPU**, and **no mandatory API keys or `.env` file**.

All environment variables are optional and automatically use safe defaults (`STORAGE_DIR=./storage`, `DATABASE_PATH=./data/openvideo.db`, `WORKER_CONCURRENCY=1`, `FFMPEG_THREADS=2`, `FFMPEG_PATH=ffmpeg`, `FFPROBE_PATH=ffprobe`, `YT_DLP_PATH=yt-dlp`).

## 1. Install Native Prerequisites

1. **Node.js 22 LTS** (includes native `node:sqlite`, zero C++ build tools required):
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
2. **FFmpeg & FFprobe** (required for all local Non-AI video editing, clipping, captions, and branding):
   ```powershell
   winget install Gyan.FFmpeg
   ```
3. **Python 3.11+** *(optional — only needed if you want `yt-dlp` for YouTube/Twitch/Kick URL downloads)*:
   ```powershell
   winget install Python.Python.3.12
   ```
4. **Ollama or LM Studio** *(optional — only needed if you want local offline AI analysis; Non-AI FFmpeg mode works without them)*.

## 2. Run Automated Windows Setup Script

From the project folder in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

What the script does:
- Verifies **Node.js**, **FFmpeg**, and **FFprobe** on your `PATH`.
- Runs `npm install`.
- If **Python** is installed, optionally creates a local virtual environment (`.venv`) and installs `yt-dlp` inside `.venv` without modifying system Python.
- Leaves `.env` completely optional (starts cleanly with built-in defaults and zero API keys).

## 3. Manual Start (Zero `.env` Required)

```powershell
npm install
npm run dev
```

Open **http://localhost:3000** in your browser. Non-AI video editing, silence-based auto-clipping, split facecam/gameplay framing, SRT captions, logo overlays, and folder watching work immediately with zero API keys.

## 4. Optional Environment Overrides

If you want to customize paths or enable optional AI providers, create a `.env` file (see `.env.example`):

```env
# All variables are optional — defaults shown below:
STORAGE_DIR="./storage"
DATABASE_PATH="./data/openvideo.db"
WORKER_CONCURRENCY=1
FFMPEG_THREADS=2
FFMPEG_PATH="ffmpeg"
FFPROBE_PATH="ffprobe"
YT_DLP_PATH="yt-dlp"

# Optional Local AI (only if installed & running):
# OLLAMA_BASE_URL="http://127.0.0.1:11434"
# LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"

# Optional Cloud AI (strictly server-side):
# GEMINI_API_KEY="your-real-key"
# GROQ_API_KEY="your-real-key"
# OPENROUTER_API_KEY="your-real-key"
```
