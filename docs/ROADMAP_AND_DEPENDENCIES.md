# Dependencies, Resource Budgets & Phased Roadmap

## 1. Mandatory vs. Optional Dependencies

### Mandatory (Minimum Local MVP — Zero Docker, Zero AI)
| Dependency | Role | Footprint |
| :--- | :--- | :--- |
| **Node.js 22+** | Unified API server, built-in `node:sqlite`, Vite build | ~60–110 MB RAM idle |
| **FFmpeg & FFprobe** | Deterministic video/audio transcoding, cropping, subtitles, silence detection | Native binary, ~80–350 MB RAM during 720p/1080p encode |
| **Express + Multer** | REST API, SSE stream, disk-streamed file upload | Minimal (<15 MB) |
| **React 19 + Tailwind CSS v4** | Lightweight responsive UI (lazy-rendered views) | Minimal browser footprint |

### Optional (Installed Only When Enabled in Later Phases)
| Dependency | Phase | Purpose |
| :--- | :---: | :--- |
| **Ollama / llama.cpp / LM Studio** | Phase 3 | Local LLM inference without cloud API costs |
| **Cloud Provider SDKs / OpenAI-compatible HTTP** | Phase 3 | Gemini, OpenRouter, OpenAI, Anthropic, DeepSeek, Groq, etc. |
| **whisper.cpp / faster-whisper** | Phase 4 | Local offline speech-to-SRT subtitle generation |
| **Piper TTS / Edge TTS** | Phase 4 | Local lightweight voiceover synthesis |
| **PostgreSQL + S3/MinIO** | Phase 6 | Multi-user cloud persistence and object storage |
| **Tauri (Rust) + Capacitor** | Phase 8 | Lightweight Windows desktop shell & Android wrapper |

---

## 2. Lowest-Resource MVP Implementation Choice

To support **8 GB RAM Windows/Linux systems** (and our inspected **4 GB RAM / 2 vCPU** dev container):
- **Single-Process Modular Architecture**: Instead of forcing Redis + Celery + PostgreSQL + Docker + Python + Node simultaneously for local users, Phase 2 runs a single Node.js 22 server with built-in `node:sqlite` (WAL mode) and an in-process persistent worker runner spawning native `ffmpeg` binaries with `concurrency = 1`.
- **Same Clean Boundaries for Scaling**: Every service (`db.ts`, `queue.ts`, `ffmpeg.ts`, `system.ts`) is isolated behind typed interfaces so Phase 6 can swap SQLite → PostgreSQL and in-process runner → remote worker queue without rewriting the API or frontend.

---

## 3. 10-Phase Development Plan

- **Phase 1 (Complete):** Environment inspection, architecture diagram, feature matrix, dependency audit, and phased roadmap.
- **Phase 2 (Complete — Current Working MVP):** AI-free local studio with Dashboard, Media Library, Sample Video Generator, Video Editor (Trim, 9:16/16:9/1:1, Blur-Pad, Resolution/CRF Compression, SRT/VTT Subtitles, Logo Overlay, Audio Extract/Mix), Multi-Video Merge, AI-Free Silence Clipping, Persistent SQLite Job Queue (Pause/Resume/Cancel/Retry), Real-Time SSE Progress, System CPU/RAM/Disk Telemetry, and Light/Dark Themes.
- **Phase 3 (Next):** Modular AI Provider Hub (Ollama, llama.cpp, LM Studio, Gemini, OpenRouter, OpenAI, Anthropic, DeepSeek, Groq, custom OpenAI-compatible endpoints, Colibri extensible adapter) + Task Router.
- **Phase 4:** AI Script Studio, Local Whisper transcription, and TTS Voiceover studio.
- **Phase 5:** AutoClip highlight detection, speaker/face-aware vertical reframing, and faceless Shorts pipelines.
- **Phase 6:** Multi-user authentication, RBAC, usage/storage quotas, PostgreSQL migration, S3/MinIO storage, and audit logs.
- **Phase 7:** Official Social Media Publishing Adapters (YouTube, Instagram, TikTok, X, LinkedIn, Facebook, Pinterest) + Calendar Queue.
- **Phase 8:** Windows Desktop Installer (Tauri + PowerShell setup scripts) and Android PWA / Capacitor wrapper.
- **Phase 9:** Vercel frontend deployment guide + decoupled cloud worker architecture.
- **Phase 10:** Automated E2E tests, CI workflows, LICENSE/SECURITY/CONTRIBUTING docs, and public GitHub release readiness.
