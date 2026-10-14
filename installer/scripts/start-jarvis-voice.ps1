# Startet den JARVIS-Voice-Service und startet ihn bei Absturz neu (Status: http://127.0.0.1:43694).
param([switch]$Visible)
$root   = 'C:\Jarvis'
$python = "$root\voice\.venv\Scripts\python.exe"
$script = "$root\voice\jarvis_voice.py"
$log    = "$root\logs\voice-service.log"
$env:PYTHONUNBUFFERED = '1'
$env:PYTHONIOENCODING = 'utf-8'

try { Invoke-RestMethod http://127.0.0.1:43694 -TimeoutSec 2 | Out-Null; exit 0 } catch {}

# Laut Plan zuerst Qwen, dann Voice.
foreach ($i in 1..60) {
    try { Invoke-RestMethod http://127.0.0.1:43692/v1/models -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 2 }
}

while ($true) {
    "$(Get-Date -Format s) start" | Add-Content $log -Encoding utf8
    if ($Visible) {
        & $python $script 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding utf8 }
    } else {
        cmd.exe /c "`"$python`" `"$script`" >> `"$log`" 2>&1"
    }
    "$(Get-Date -Format s) beendet (Code $LASTEXITCODE) - Neustart in 10 s" | Add-Content $log -Encoding utf8
    Start-Sleep 10
}
