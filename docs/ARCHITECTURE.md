# OpenVideo Studio — System Architecture (Phase 1)

## 1. Environment Inspection Baseline

Inspected host environment prior to implementation:

| Metric | Observed Value | Architectural Impact |
| :--- | :--- | :--- |
| Operating System | Linux x86_64 (`4.19.0-gvisor`) | Cross-platform POSIX/Windows path abstraction required |
| CPU Cores | 2 vCPUs | Cap FFmpeg threads (`-threads 2`) and default concurrency to `1` |
| Memory (RAM) | 4.0 GiB total (~3.5 GiB available, 0 swap) | Stream uploads directly to disk via `multer`; never load video buffers into RAM |
| Disk Space | 504 GiB available | Safe for local media staging, temp renders, and SQLite WAL storage |
| Node.js Runtime | `v22.23.5` (native `node:sqlite`) | Zero native C++ build overhead; minimal idle RAM footprint (~60 MB) |
| FFmpeg / FFprobe | `ffmpeg 4.4.2` + `ffprobe` installed (`scale`, `crop`, `overlay`, `subtitles`/`libass`, `drawtext`, `silencedetect`) | Native deterministic video operations work immediately without Docker or AI |
| Python | `3.11.2` | Available for optional future local Whisper/CV plugins (Phase 4–5) |
| Docker | Not installed | Validates mandatory zero-Docker local execution design |

---

## 2. System Architecture Diagram

```text
+------------------------------------------------------------------------------+
|                       CLIENTS (Responsive & Lightweight)                     |
|  [ Web Browser (React 19 + Vite) ]  [ Windows Tauri (Ph 8) ]  [ Android PWA ]|
+--------------------------------------+---------------------------------------+
                                       | HTTP REST + Server-Sent Events (SSE)
                                       v
+------------------------------------------------------------------------------+
|                     APPLICATION SERVER (Express + TypeScript)                |
|                                                                              |
|  +-----------------------+  +----------------------+  +-------------------+  |
|  | Media Upload & Stream |  | Job Queue Controller |  | System Telemetry  |  |
|  | (Disk-streamed Multer |  | Pause / Resume /     |  | CPU / RAM / Disk  |  |
|  |  + HTTP Range Video)  |  | Cancel / Retry       |  | + FFmpeg Health   |  |
|  +-----------+-----------+  +----------+-----------+  +---------+---------+  |
|              |                         |                        |            |
|  +-----------v-------------------------v------------------------v---------+  |
|  |           SQLite Persistence Layer (node:sqlite, WAL mode)             |  |
|  |   Tables: media_assets | jobs | settings   (Upgradeable to PostgreSQL) |  |
|  +-------------------------------------+----------------------------------+  |
|                                        |                                     |
|  +-------------------------------------v----------------------------------+  |
|  |        LOCAL WORKER RUNNER (Default Concurrency = 1, Memory-Safe)      |  |
|  |   Spawns native FFmpeg/FFprobe with shell:false & strict arg arrays    |  |
|  |   Streams progress via stderr -> SSE | Cleans temp files on exit       |  |
|  +-------------------------------------+----------------------------------+  |
+----------------------------------------|-------------------------------------+
                                         |
          +------------------------------+------------------------------+
          v                                                             v
+-------------------------+                               +-------------------------+
| Local Filesystem Store  |                               | Optional Modular Layers |
| storage/uploads/        |                               | Phase 3: AI Provider Hub|
| storage/exports/        |                               |   (Ollama, Gemini, etc.)|
| storage/thumbnails/     |                               | Phase 6: Postgres + S3  |
| storage/temp/           |                               | Phase 7: Social Adapters|
+-------------------------+                               +-------------------------+
```

---

## 3. Low-Resource Engineering Principles (8 GB RAM Target)

1. **Zero Mandatory Background AI Models**: No LLM, Whisper, or diffusion model loads at startup.
2. **Disk-Streamed Uploads**: Multipart video uploads stream directly to `storage/uploads/` via `multer` disk storage instead of buffering in Node heap memory.
3. **Single-Pass FFmpeg Filtergraphs**: Trim, aspect-ratio conversion (`9:16` crop or blur-pad), resolution scaling, logo overlay, and SRT/VTT subtitle burn-in compile into **one FFmpeg invocation**, avoiding multi-generation temporary files.
4. **Concurrency = 1 Default**: The SQLite-backed worker runs 1 render job at a time by default (`WORKER_CONCURRENCY=1`) and caps FFmpeg encoder threads (`-threads 2`), keeping the UI and OS responsive on 4–8 GB RAM machines.
5. **Immediate Resource Reclamation**: Cancelling a job terminates the FFmpeg child process and deletes partial output files immediately.

---

## 4. Deployment Topologies

- **Local Single-User Mode (Current Phase 2 MVP)**:
  - Single Node.js process serving React UI + Express API + SQLite (`data/openvideo.db`) + Native FFmpeg + Local `storage/` directory. No Docker, no Redis, no PostgreSQL required.
- **Production Multi-User Cloud Mode (Phases 6–9)**:
  - **Frontend**: Deployed statically on Vercel.
  - **API Server**: Deployed on container/VM host (Fly.io, Railway, Cloud Run, or self-hosted VPS).
  - **Database & Queue**: PostgreSQL (`pg-boss`) or Redis worker queue.
  - **Video Workers**: Dedicated CPU/GPU worker nodes or local Windows companion nodes pulling jobs from the queue.
  - **Object Storage**: S3 / Cloudflare R2 / MinIO.
