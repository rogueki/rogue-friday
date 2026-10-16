# Startet den F.R.I.D.A.Y.-Sprachdienst und startet ihn bei Absturz neu (Status: http://127.0.0.1:43694).
# Einzelinstanz per benanntem Mutex; Stop: Datei C:\Friday\run\start-friday-voice.ps1.stop (siehe Stop-LauncherService im Installer).
param([switch]$Visible, [string]$Root = '')
$root   = if ($Root) { $Root } else { Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
$python = "$root\voice\.venv\Scripts\python.exe"
$script = "$root\voice\friday_voice.py"
$log    = "$root\logs\voice-service.log"
$env:PYTHONUNBUFFERED = '1'
$env:PYTHONIOENCODING = 'utf-8'

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FRIDAY_VoiceLauncher', [ref]$created)
if (-not $created) { exit 0 }
$stopFlag = "$root\run\start-friday-voice.ps1.stop"
New-Item -ItemType Directory -Force "$root\run" | Out-Null
Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue

$voiceConfig = Get-Content "$root\config\voice.json" -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$healthPort = if ($voiceConfig.health_port) { [int]$voiceConfig.health_port } else { 43694 }
$qwenUrl = if ($voiceConfig.qwen_url) { [string]$voiceConfig.qwen_url } else { 'http://127.0.0.1:43692/v1/chat/completions' }
$qwenHealth = $qwenUrl -replace '/v1/chat/completions$', '/v1/models'
try { Invoke-RestMethod "http://127.0.0.1:$healthPort" -TimeoutSec 2 | Out-Null; exit 0 } catch {}

# Laut Plan zuerst Qwen, dann Voice.
foreach ($i in 1..60) {
    try { Invoke-RestMethod $qwenHealth -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 2 }
}

while (-not (Test-Path $stopFlag)) {
    "$(Get-Date -Format s) start" | Add-Content $log -Encoding utf8
    if ($Visible) {
        & $python $script 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding utf8 }
    } else {
        cmd.exe /c "`"$python`" `"$script`" >> `"$log`" 2>&1"
    }
    "$(Get-Date -Format s) beendet (Code $LASTEXITCODE) - Neustart in 10 s" | Add-Content $log -Encoding utf8
    foreach ($i in 1..10) { if (Test-Path $stopFlag) { break }; Start-Sleep 1 }
}
"$(Get-Date -Format s) gestoppt (Stop-Flag)" | Add-Content $log -Encoding utf8
