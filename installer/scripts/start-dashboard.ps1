# Startet das F.R.I.D.A.Y. Command Center (Control API + Web, Standard http://127.0.0.1:3100) und startet es bei Absturz neu.
# Einzelinstanz per benanntem Mutex; Stop: Datei C:\Friday\run\start-dashboard.ps1.stop (siehe Stop-LauncherService im Installer).
# Installationsort C:\Friday\dashboard (Entscheidung des Eigentuemers, siehe docs/DEPLOYMENT.md). Log: C:\Friday\logs\dashboard-service.log
param([switch]$Visible)
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dash = "$root\dashboard"
$main = "$dash\apps\control-api\dist\main.js"
$log  = "$root\logs\dashboard-service.log"
$env:FRIDAY_CONFIG_DIR = "$dash\config"
$hermesDashboardPort = 43691
$stateFile = "$root\config\install-state.json"
if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
        $state = Get-Content -LiteralPath $stateFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        if ($null -ne $state.ports) {
            if ($null -eq $state.ports.Dashboard) { throw 'Missing Hermes dashboard port' }
            $savedPort = [int]$state.ports.Dashboard
            if ($savedPort -lt 1024 -or $savedPort -gt 65535) { throw 'Invalid Hermes dashboard port' }
            $hermesDashboardPort = $savedPort
        }
    } catch {
        throw "Hermes dashboard port could not be read from $stateFile`: $($_.Exception.Message)"
    }
}
$env:FRIDAY_HERMES_DASHBOARD_URL = "http://127.0.0.1:$hermesDashboardPort"
$skillsCatalog = "$root\skills\friday-skills\registry\integration_setup.json"
if (Test-Path -LiteralPath $skillsCatalog -PathType Leaf) {
    $env:FRIDAY_SKILLS_CATALOG_PATH = $skillsCatalog
}
$ffmpegPathFile = "$dash\config\ffmpeg.path"
if (-not $env:FRIDAY_FFMPEG_PATH -and (Test-Path -LiteralPath $ffmpegPathFile -PathType Leaf)) {
    $configuredFFmpeg = ([IO.File]::ReadAllText($ffmpegPathFile)).Trim()
    if ($configuredFFmpeg -and (Test-Path -LiteralPath $configuredFFmpeg -PathType Leaf)) {
        $env:FRIDAY_FFMPEG_PATH = $configuredFFmpeg
    }
}
# Log-Rotation waehrend der Server laeuft: Ausgabe von node geht Zeile fuer Zeile durch Write-AppLog, das alle 30 s die Groesse prueft
# (dashboard-service.log > 10 MB -> dashboard-service.log.1). Kein cmd-Redirect, der die Datei dauerhaft offen halten wuerde.
$script:lastRotateCheck = Get-Date
function Invoke-LogRotation {
    try { if ((Test-Path $log) -and ((Get-Item $log).Length -gt 10MB)) { Move-Item $log "$log.1" -Force -ErrorAction Stop } }
    catch { Add-Content -Path $log -Value "$(Get-Date -Format s) Log-Rotation fehlgeschlagen: $($_.Exception.Message)" -Encoding utf8 }
}
function Write-AppLog([string]$line) {
    if (((Get-Date) - $script:lastRotateCheck).TotalSeconds -ge 30) { $script:lastRotateCheck = Get-Date; Invoke-LogRotation }
    Add-Content -Path $log -Value $line -Encoding utf8
}
function Write-Log($text) { Write-AppLog "$(Get-Date -Format s) $text" }
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

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FRIDAY_DashboardLauncher', [ref]$created)
if (-not $created) { exit 0 }
$stopFlag = "$root\run\start-dashboard.ps1.stop"
New-Item -ItemType Directory -Force "$root\run" | Out-Null
Remove-Item $stopFlag -Force -ErrorAction SilentlyContinue

# Laeuft schon einer (Antwort mit beliebigem HTTP-Code), nichts doppelt starten.
try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:$port/api/v1/health -TimeoutSec 2 | Out-Null; exit 0 } catch { if ($_.Exception.Response) { exit 0 } }

Set-Location $dash
while (-not (Test-Path $stopFlag)) {
    Invoke-LogRotation
    $node = Find-Node
    if (-not $node) {
        Write-Log 'Node.js nicht gefunden - install-friday.bat erneut starten (Schritt Command Center).'
    } elseif (-not (Test-Path $main)) {
        Write-Log "$main fehlt - install-friday.bat erneut starten (Schritt Command Center)."
    } else {
        Write-Log "start ($node)"
        & $node $main 2>&1 | ForEach-Object { Write-AppLog "$_"; if ($Visible) { "$_" } }
        Write-Log "beendet (Code $LASTEXITCODE) - Neustart in 10 s"
    }
    foreach ($i in 1..10) { if (Test-Path $stopFlag) { break }; Start-Sleep 1 }
}
Write-Log 'gestoppt (Stop-Flag)'
