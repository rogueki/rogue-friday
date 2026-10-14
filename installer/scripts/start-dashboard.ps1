# Startet das F.R.I.D.A.Y. Command Center (Control API + Web, Standard http://127.0.0.1:3100) und startet es bei Absturz neu.
# Installationsort C:\Jarvis\dashboard (Entscheidung des Eigentuemers, siehe docs/DEPLOYMENT.md). Log: C:\Jarvis\logs\dashboard-service.log
param([switch]$Visible)
$root = 'C:\Jarvis'
$dash = "$root\dashboard"
$main = "$dash\apps\control-api\dist\main.js"
$log  = "$root\logs\dashboard-service.log"
$env:JARVIS_CONFIG_DIR = "$dash\config"
function Write-Log($text) { "$(Get-Date -Format s) $text" | Add-Content $log -Encoding utf8 }
function Find-Node {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $p) { return $p } }
    return $null
}

# Port aus dashboard.yaml (server.port), Standard 3100.
$port = 3100
$inServer = $false
foreach ($line in (Get-Content "$dash\config\dashboard.yaml" -ErrorAction SilentlyContinue)) {
    if ($line -match '^server:') { $inServer = $true; continue }
    if ($inServer -and $line -match '^\S' -and $line -notmatch '^\s*#') { $inServer = $false }
    if ($inServer -and $line -match '^\s+port:\s*(\d{2,5})\b') { $port = [int]$Matches[1]; break }
}

# Laeuft schon einer (Antwort mit beliebigem HTTP-Code), nichts doppelt starten.
try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:$port/api/v1/health -TimeoutSec 2 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } }

Set-Location $dash
while ($true) {
    if ((Test-Path $log) -and ((Get-Item $log).Length -gt 10MB)) { Move-Item $log "$log.1" -Force }
    $node = Find-Node
    if (-not $node) {
        Write-Log 'Node.js nicht gefunden - install-jarvis.bat erneut starten (Schritt Command Center).'
    } elseif (-not (Test-Path $main)) {
        Write-Log "$main fehlt - install-jarvis.bat erneut starten (Schritt Command Center)."
    } else {
        Write-Log "start ($node)"
        if ($Visible) {
            & $node $main 2>&1 | ForEach-Object { "$_"; Add-Content -Path $log -Value "$_" -Encoding utf8 }
        } else {
            cmd.exe /c "`"$node`" `"$main`" >> `"$log`" 2>&1"
        }
        Write-Log "beendet (Code $LASTEXITCODE) - Neustart in 10 s"
    }
    Start-Sleep 10
}
