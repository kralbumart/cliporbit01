# Security Policy

## Architectural Security Controls

OpenVideo Studio implements the following safeguards by default:

- **Server-Side Secrets Only**: Cloud AI API keys (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `CUSTOM_AI_API_KEY`) are read strictly from server environment variables and are never sent to the browser or stored in client storage.
- **Command Injection Prevention**: All `ffmpeg`, `ffprobe`, and `yt-dlp` invocations use `child_process.spawn` with `shell: false` and validated argument arrays.
- **Path Traversal Prevention**: Every media upload, export, thumbnail, and temp file path is resolved and verified inside `STORAGE_DIR` via `assertSafePath`.
- **SSRF Protection**: Universal URL inspection/downloading, webhook delivery, and cloud AI base URLs validate hostnames and resolved DNS IP addresses via `assertSafePublicUrl` to block loopback, link-local, and private RFC1918 networks (while explicitly allowing local loopback only for local Ollama/LM Studio providers).
- **Parameterized SQL**: All SQLite database operations (`node:sqlite`) use prepared parameterized statements.

## Reporting a Vulnerability

If you discover a security vulnerability, please do **not** open a public issue with exploit details. Instead, report it privately to the repository maintainers via GitHub Security Advisories or private email with reproduction steps so a patch can be released responsibly.
