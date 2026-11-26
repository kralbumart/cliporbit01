# OpenVideo Studio — Feature Matrix

This matrix explicitly separates **AI-Free Native Operations** (working immediately with zero API keys), **Optional Local AI**, **Optional Cloud AI (BYOK)**, and **Publishing/Multi-User Services**.

| Capability | Category | Requires AI Key? | Cost Tier | Implementation Status |
| :--- | :--- | :---: | :--- | :--- |
| Media Upload (Video, Audio, Image, SRT/VTT) | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Built-in FFmpeg Sample Video Generator | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| FFprobe Video & Audio Metadata Extraction | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Automatic Video Thumbnail Generation | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Video Trimming (Start / End Precision) | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| 9:16 Vertical Shorts Conversion (Center Crop & Blur-Pad) | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| 16:9 Landscape & 1:1 Square Conversion | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Resolution Scaling (1080p / 720p / 480p) & CRF Compression | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| SRT / VTT Subtitle Import, Inline Editor & Burn-In Styling | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Logo / Watermark Overlay (Corner, Scale, Opacity) | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Multi-Video Merging / Concatenation | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Audio Extraction (MP3 / WAV) & Background Audio Mixing | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| AI-Free Silence Detection & Segment Clip Extraction | Native FFmpeg | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Persistent SQLite Job Queue (Pause, Resume, Cancel, Retry) | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Real-Time SSE Progress + CPU/RAM/Disk Telemetry | Native Core | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Light & Dark Theme Dashboard | Frontend UI | No | Free / Open-Source | **Implemented (Phase 2 MVP)** |
| Local AI Provider Hub (Ollama, llama.cpp, LM Studio) | Optional Local AI | No | Free / Local Compute | Planned (Phase 3) |
| Cloud AI Provider Hub (Gemini, OpenRouter, OpenAI, Claude, DeepSeek, Groq, etc. + Colibri adapter) | Optional Cloud AI | Yes (BYOK) | Free-Tier / Paid API | Planned (Phase 3) |
| Task-Based AI Model Router & Cost Estimator | AI Infrastructure | Optional | Local / BYOK | Planned (Phase 3) |
| AI Script Studio, Local Whisper Subtitles & TTS Voiceover | AI Content | Optional | Local / BYOK | Planned (Phase 4) |
| AI Highlight Detection & Optional Face Tracking | AutoClip AI | Optional | Local / BYOK | Planned (Phase 5) |
| Multi-User Auth, RBAC, Quotas, PostgreSQL & S3 Storage | Multi-User SaaS | No | Self-Hosted / Cloud | Planned (Phase 6) |
| Social Publishing Adapters (YouTube, IG, TikTok, X, LinkedIn) | Publishing | Platform OAuth | Official API Limits | Planned (Phase 7) |
| Windows Desktop App (Tauri + PowerShell Setup) & Android PWA/Capacitor | Native Clients | No | Free / Open-Source | Planned (Phase 8) |
| Vercel Frontend + Dedicated Cloud Worker Deployment | Cloud Ops | No | Free-Tier / Paid Cloud | Planned (Phase 9) |
