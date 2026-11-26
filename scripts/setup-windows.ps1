<#
.SYNOPSIS
    Native Windows 10/11 Setup Script for OpenVideo Studio (Node.js + Python + FFmpeg, No Docker).
.DESCRIPTION
    Checks Node.js 22+, FFmpeg/FFprobe, installs npm dependencies, and optionally sets up
    a local Python .venv with yt-dlp. Zero API keys and zero .env configuration are required.
#>

$ErrorActionPreference = "Stop"

Write-Host "=== OpenVideo Studio — Native Windows Setup (No Docker) ===" -ForegroundColor Cyan

# 1. Check Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "[ERROR] Node.js 22+ not found. Install with: winget install OpenJS.NodeJS.LTS" -ForegroundColor Red
    exit 1
}
$nodeVer = (& node -v).Trim()
Write-Host "[OK] Found Node.js $nodeVer" -ForegroundColor Green

# 2. Check FFmpeg & FFprobe
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffmpegCmd) {
    Write-Host "[WARN] FFmpeg not found on PATH. Install with: winget install Gyan.FFmpeg" -ForegroundColor Yellow
} else {
    Write-Host "[OK] Found FFmpeg at $($ffmpegCmd.Source)" -ForegroundColor Green
}

$ffprobeCmd = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffprobeCmd) {
    Write-Host "[WARN] FFprobe not found on PATH (included with Gyan.FFmpeg)." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Found FFprobe at $($ffprobeCmd.Source)" -ForegroundColor Green
}

# 3. Install npm dependencies
Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
npm install

# 4. Optional local Python venv + yt-dlp for URL downloading
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd) {
    Write-Host "Found Python — setting up optional local .venv with yt-dlp..." -ForegroundColor Cyan
    if (-not (Test-Path ".venv")) {
        & python -m venv .venv
    }
    $pipPath = ".\.venv\Scripts\pip.exe"
    if (Test-Path $pipPath) {
        & $pipPath install --upgrade yt-dlp | Out-Null
        $ytdlpExe = (Resolve-Path ".\.venv\Scripts\yt-dlp.exe").Path
        Write-Host "[OK] Installed optional yt-dlp at $ytdlpExe" -ForegroundColor Green
        Write-Host "     Optional: set YT_DLP_PATH=`"$ytdlpExe`" in .env to use this binary." -ForegroundColor Gray
    }
} else {
    Write-Host "[INFO] Python not found — skipping optional yt-dlp install. Local uploads & direct HTTPS videos still work." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup complete! No API keys or .env file required to start." -ForegroundColor Green
Write-Host "Start OpenVideo Studio with:" -ForegroundColor White
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host "Then open http://localhost:3000 in your browser." -ForegroundColor Gray
