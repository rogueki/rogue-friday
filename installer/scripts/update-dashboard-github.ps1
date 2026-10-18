#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [string]$RunId = '',
    [string]$TaskName = ''
)
$ErrorActionPreference = 'Stop'
if ($ExpectedCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'Ungültige Commit-ID.' }
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$dash = Join-Path $root 'dashboard'
$data = Join-Path $dash 'data'
$updates = Join-Path $root 'updates'
$cache = Join-Path $updates 'rogue-friday-main'
$marker = Join-Path $data 'dashboard-revision.json'
$resultFile = Join-Path $data 'dashboard-update-result.json'
$progressFile = Join-Path $data 'dashboard-update-progress.json'
$lock = Join-Path $updates 'dashboard-update.lock'
$log = Join-Path $root 'logs\dashboard-update.log'
$repository = 'https://github.com/rogueki/rogue-friday.git'
New-Item -ItemType Directory -Force $updates, (Split-Path $log -Parent) | Out-Null
$lockHandle = $null
$backup = $null
$stopped = $false
$voiceHelper = $null
$voiceApplyStarted = $false
$runStartedAt = (Get-Date).ToUniversalTime().ToString('o')
$processStartedAt = (Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')
if (-not $RunId) { $RunId = [guid]::NewGuid().ToString('N') }
if ($RunId -notmatch '^[0-9a-f]{32}$') { throw 'Ungültige Lauf-ID.' }
if ($TaskName -and $TaskName -cne ('FRIDAY_Update_' + $RunId)) { throw 'Ungültiger Update-Aufgabenname.' }
$step = 0
$phase = 'starting'
function Write-UpdateState([string]$phase, [string]$message, [string]$state = 'running') {
    $value = @{ schema = 1; runId = $RunId; targetCommit = $ExpectedCommit; state = $state; phase = $phase;
        step = $step; totalSteps = 8; message = $message; startedAt = $runStartedAt;
        updatedAt = (Get-Date).ToUniversalTime().ToString('o'); pid = $PID; processStartedAt = $processStartedAt }
    $temporary = "$progressFile.$RunId.tmp"
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if ([IO.File]::Exists($progressFile)) {
        $previous = "$progressFile.$RunId.previous"
        [IO.File]::Replace($temporary, $progressFile, $previous)
        Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue
    }
    else { [IO.File]::Move($temporary, $progressFile) }
}
function Set-UpdatePhase([int]$number, [string]$phase, [string]$message) {
    $script:step = $number
    $script:phase = $phase
    Write-UpdateState $phase $message
}
try {
    $lockHandle = [IO.File]::Open($lock, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $lockInfo = @{ runId = $RunId; pid = $PID; processStartedAt = $processStartedAt } | ConvertTo-Json -Compress
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($lockInfo)
    $lockHandle.Write($bytes, 0, $bytes.Length)
    $lockHandle.Flush()
    Set-UpdatePhase 1 'download' 'GitHub-Quellstand wird geladen.'
} catch {
    if ($lockHandle) { $lockHandle.Dispose(); Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue }
    throw
}
function Git([string[]]$arguments) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $records = & git.exe @arguments 2>&1
        $gitExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousErrorActionPreference }
    $result = @()
    foreach ($record in @($records)) {
        if ($record -is [Management.Automation.ErrorRecord]) {
            $record.ToString() | Out-File -FilePath $log -Append -Encoding utf8
        } else { $result += [string]$record }
    }
    if ($gitExit -ne 0) { throw "Git-Operation fehlgeschlagen: $($arguments[0])" }
    return $result
}
function Start-Dashboard {
    Start-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction Stop
}
function Stop-Dashboard {
    Stop-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction SilentlyContinue
    $prefix = [IO.Path]::GetFullPath($dash).TrimEnd('\') + '\'
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($prefix) -and $_.CommandLine.Contains('control-api') -and $_.CommandLine.Contains('main.js')
    })
    foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    foreach ($process in $processes) { Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
}
function Health-Ready {
    $config = Join-Path $dash 'config\dashboard.yaml'
    $port = 3100
    if (Test-Path $config) {
        $yaml = Get-Content $config -Raw
        if ($yaml -match '(?m)^\s+port:\s*(\d{2,5})\s*$') { $port = [int]$Matches[1] }
    }
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/v1/health" -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}
function Assert-NoReparse([string]$path, [string]$base = $dash) {
    $basePath = [IO.Path]::GetFullPath($base).TrimEnd('\')
    $current = [IO.Path]::GetFullPath($path).TrimEnd('\')
    if (-not ($current.Equals($basePath, [StringComparison]::OrdinalIgnoreCase) -or
        $current.StartsWith($basePath + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw 'Updatepfad verlässt den erlaubten Ordner.'
    }
    while ($true) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Verknüpfung im Updatepfad: $current" }
        }
        if ($current -ieq $basePath) { break }
        $next = Split-Path $current -Parent
        if (-not $next -or $next -eq $current) { throw 'Updatepfad verlässt den erlaubten Ordner.' }
        $current = $next
    }
}
function Stage-VerifiedVoiceHelper {
    $gitPath = 'installer/scripts/update-voice-personas.ps1'
    $source = Join-Path $cache 'installer\scripts\update-voice-personas.ps1'
    $tree = (Git -arguments @('-C', $cache, 'ls-tree', $target, '--', $gitPath) | Select-Object -First 1)
    if ($tree -notmatch '^100(644|755) blob ([0-9a-f]{40})\s') { throw 'Verifizierter Stimmen-Updater fehlt im Git-Stand.' }
    $expectedBlob = $Matches[2]
    Assert-NoReparse $source $cache
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Stimmen-Updater fehlt im Quellstand.' }
    $item = Get-Item -LiteralPath $source -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Verknüpfung statt Stimmen-Updater gefunden.' }
    $actualBlob = (Git -arguments @('-C', $cache, 'hash-object', "--path=$gitPath", '--', $source) | Select-Object -First 1).Trim()
    if ($actualBlob -cne $expectedBlob) { throw 'Stimmen-Updater stimmt nicht mit dem Git-Stand überein.' }
    $staged = Join-Path $updates ("voice-helper-$RunId.ps1")
    Assert-NoReparse $staged $updates
    Copy-Item -LiteralPath $source -Destination $staged -ErrorAction Stop
    Assert-NoReparse $staged $updates
    $stagedBlob = (Git -arguments @('-C', $cache, 'hash-object', "--path=$gitPath", '--', $staged) | Select-Object -First 1).Trim()
    if ($stagedBlob -cne $expectedBlob) {
        throw 'Stimmen-Updater konnte nicht sicher zwischengespeichert werden.'
    }
    return $staged
}
function Invoke-VoicePersonaHelper([string]$mode) {
    if ($mode -cnotin @('Apply', 'Rollback') -or -not $voiceHelper) { throw 'Ungültiger Stimmen-Update-Aufruf.' }
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $voiceHelper -InstallRoot $root -SourceRoot $cache -RunId $RunId -Mode $mode 2>&1 |
            Out-File -LiteralPath $log -Append -Encoding utf8
        $helperExitCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    if ($helperExitCode -ne 0) { throw "Stimmen-Update $mode fehlgeschlagen." }
    try {
        $result = Get-Content -LiteralPath (Join-Path $updates "voice-personas-$RunId\result.json") -Raw | ConvertFrom-Json
    } catch { throw "Stimmen-Update $mode hat keinen bestätigten Ergebnisstatus." }
    $accepted = if ($mode -eq 'Apply') { @('applied', 'runtimeNotConfigured') } else { @('rolledBack') }
    if ($accepted -cnotcontains $result.status) { throw "Stimmen-Update $mode hat keinen bestätigten Ergebnisstatus." }
}
function Get-VoiceSourcePaths {
    return @('installer/voice/friday_voice.py', 'installer/voice/voice_persona.py',
        'installer/voice/prepare_voice_pairs.py', 'installer/fast_tts/server.py',
        'installer/fast_tts/install_wsl.sh', 'installer/fast_tts/update_personas.sh',
        'installer/voice_models/friday_ref.wav', 'installer/voice_models/friday_ref.txt',
        'installer/voice_models/jarvis_ref.wav', 'installer/voice_models/jarvis_ref.txt')
}
function Assert-VerifiedVoiceSources {
    foreach ($gitPath in (Get-VoiceSourcePaths)) {
        $tree = (Git -arguments @('-C', $cache, 'ls-tree', $target, '--', $gitPath) | Select-Object -First 1)
        if ($tree -notmatch '^100(644|755) blob ([0-9a-f]{40})\s') { throw "Stimmdatei fehlt im Git-Stand: $gitPath" }
        $expectedBlob = $Matches[2]
        $source = Join-Path $cache $gitPath.Replace('/', '\')
        Assert-NoReparse $source $cache
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Stimmdatei fehlt im Quellstand: $gitPath" }
        $item = Get-Item -LiteralPath $source -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Verknüpfung statt Stimmdatei: $gitPath" }
        $actualBlob = (Git -arguments @('-C', $cache, 'hash-object', "--path=$gitPath", '--', $source) | Select-Object -First 1).Trim()
        if ($actualBlob -cne $expectedBlob) { throw "Stimmdatei stimmt nicht mit Git überein: $gitPath" }
    }
}
function Restore-VoicePersonaAfterFailure {
    if (-not $voiceApplyStarted) { return $true }
    Write-UpdateState 'rollback' 'Vorherige Stimmen werden wiederhergestellt.' 'running'
    Invoke-VoicePersonaHelper 'Rollback'
    $voiceResult = Get-Content -LiteralPath (Join-Path $updates "voice-personas-$RunId\result.json") -Raw | ConvertFrom-Json
    if ($voiceResult.status -cne 'rolledBack') { throw 'Stimmen-Rollback wurde nicht bestätigt.' }
    "$(Get-Date -Format o) Stimmen-Rollback bestätigt" | Add-Content $log
    return $true
}
function Test-VoicePersonaUpdateNeeded([string[]]$changedPaths) {
    $voicePaths = Get-VoiceSourcePaths
    foreach ($path in $changedPaths) {
        if ($voicePaths -ccontains $path -or $path -ceq 'installer/scripts/update-voice-personas.ps1') { return $true }
    }
    foreach ($name in @('friday_ref.wav', 'friday_ref.txt', 'jarvis_ref.wav', 'jarvis_ref.txt')) {
        if (-not (Test-Path -LiteralPath (Join-Path $root "installer\voice_models\$name") -PathType Leaf)) { return $true }
    }
    if ((Test-Path -LiteralPath (Join-Path $root 'voice\friday_voice.py') -PathType Leaf) -and
        -not (Test-Path -LiteralPath (Join-Path $root 'voice\voice_persona.py') -PathType Leaf)) { return $true }
    return $false
}
function Set-UpdateToolPath {
    # pnpm's build scripts run through cmd.exe, which cannot resolve tools in quoted PATH entries.
    $entries = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) |
        Where-Object { $_ } | ForEach-Object { $_ -split ';' } |
        ForEach-Object { [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"')) } |
        Where-Object { $_ }
    foreach ($directory in @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\nodejs", "$env:APPDATA\npm")) {
        if ($directory -and (Test-Path -LiteralPath $directory -PathType Container)) { $entries += $directory }
    }
    $env:Path = (@($entries | Select-Object -Unique)) -join ';'
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or
        -not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Node.js oder pnpm fehlt im Suchpfad. Bitte die grafische Installation erneut ausführen.'
    }
}
function Sync-BuildOutput([string]$source, [string]$destination) {
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Build-Ausgabe fehlt: $source" }
    New-Item -ItemType Directory -Force $destination | Out-Null
    $seen = @{}
    $sourcePrefix = $source.TrimEnd('\') + '\'
    $destinationPrefix = $destination.TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse) {
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Verknüpfung in Build-Ausgabe: $($file.FullName)" }
        $relative = $file.FullName.Substring($sourcePrefix.Length)
        $seen[$relative] = $true
        $targetFile = $destinationPrefix + $relative
        Assert-NoReparse $targetFile
        if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf) -or
            (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash) {
            New-Item -ItemType Directory -Force (Split-Path $targetFile -Parent) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $targetFile -Force
        }
    }
    foreach ($file in Get-ChildItem -LiteralPath $destination -File -Recurse) {
        $relative = $file.FullName.Substring($destinationPrefix.Length)
        if (-not $seen.ContainsKey($relative)) {
            Assert-NoReparse $file.FullName
            Remove-Item -LiteralPath $file.FullName -Force
        }
    }
}
try {
    "$(Get-Date -Format o) Update $ExpectedCommit gestartet" | Add-Content $log
    Set-UpdateToolPath
    if (-not (Test-Path $marker)) { throw 'Installierter Git-Stand fehlt.' }
    $installedMarkerText = Get-Content $marker -Raw
    $installed = ($installedMarkerText | ConvertFrom-Json).commit
    if ($installed -cnotmatch '^[0-9a-f]{40}$') { throw 'Installierter Git-Stand ist ungültig.' }
    if (-not (Test-Path (Join-Path $cache '.git'))) {
        Git -arguments @('clone', '--no-checkout', $repository, $cache) | Out-Null
    }
    $remote = (Git -arguments @('-C', $cache, 'config', '--get', 'remote.origin.url') | Select-Object -First 1).Trim()
    if ($remote -ne $repository) { throw 'Update-Cache hat eine unerwartete Git-Quelle.' }
    Git -arguments @('-C', $cache, 'fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main') | Out-Null
    Set-UpdatePhase 2 'verify' 'Quellstand und Änderungen werden geprüft.'
    $target = (Git -arguments @('-C', $cache, 'rev-parse', 'refs/remotes/origin/main') | Select-Object -First 1).Trim()
    if ($target -cne $ExpectedCommit) { throw 'GitHub main hat sich geändert. Bitte Update erneut prüfen.' }
    & git.exe -C $cache merge-base --is-ancestor $installed $target 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Installierter Stand gehört nicht zur main-Historie. Zuerst manuell abgleichen.' }
    $raw = Git -arguments @('-C', $cache, 'diff', '--name-status', '--no-renames', $installed, $target, '--')
    $changes = @()
    $changedPaths = @()
    foreach ($line in $raw) {
        if ($line -notmatch '^([AMD])\s+(.+)$') { throw 'Unerwarteter Git-Diff-Eintrag.' }
        $kind = $Matches[1]
        $path = $Matches[2].Replace('/', '\')
        if ($path -match '[:*?"<>|]' -or $path.StartsWith('\')) { throw 'Ungültiger Git-Pfad.' }
        $changedPaths += $path.Replace('\', '/')
        $allowed = $path -match '^(apps|packages|adapters|scripts|config)\\' -or $path -in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.base.json','eslint.config.js','vitest.config.ts','.npmrc','.nvmrc')
        if (-not $allowed -or $path -in @('config\dashboard.yaml','config\adapters.yaml') -or
            $path -match '(^|\\)(node_modules|dist|out|\.git)(\\|$)' -or $path -match '(^|\\)\.\.(\\|$)' -or
            $path -match '(^|\\)(\.env[^\\]*|[^\\]+\.(key|pem|p12))$') { continue }
        $changes += [pscustomobject]@{ Kind = $kind; Path = $path }
    }
    Git -arguments @('-C', $cache, 'checkout', '--detach', '--force', $target) | Out-Null
    $voiceNeeded = Test-VoicePersonaUpdateNeeded $changedPaths
    # Check every changed installed source against the old Git blob before writing it.
    foreach ($change in $changes) {
        $destination = Join-Path $dash $change.Path
        Assert-NoReparse $destination
        $gitPath = $change.Path.Replace('\','/')
        if ($change.Kind -eq 'A') {
            if (Test-Path -LiteralPath $destination) { throw "Lokale Datei kollidiert mit Update: $gitPath" }
        } else {
            if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw "Installierte Datei fehlt: $gitPath" }
            $old = (Git -arguments @('-C', $cache, 'rev-parse', "${installed}:$gitPath") | Select-Object -First 1).Trim()
            $actual = (Git -arguments @('-C', $cache, 'hash-object', "--path=$gitPath", '--', $destination) | Select-Object -First 1).Trim()
            if ($old -cne $actual) { throw "Lokale Änderung geschützt: $gitPath" }
        }
        if ($change.Kind -ne 'D') {
            $mode = (Git -arguments @('-C', $cache, 'ls-tree', $target, '--', $gitPath) | Select-Object -First 1)
            if ($mode -notmatch '^100644 |^100755 ') { throw "Nicht reguläre Git-Datei: $gitPath" }
        }
    }
    if ($voiceNeeded) {
        Assert-VerifiedVoiceSources
        $voiceHelper = Stage-VerifiedVoiceHelper
    }
    if ($changes.Count -eq 0) {
        $successMessage = 'Dashboard ist aktuell.'
        if ($voiceNeeded) {
            Set-UpdatePhase 2 'verify' 'Stimmen werden aktualisiert.'
            $voiceApplyStarted = $true
            Invoke-VoicePersonaHelper 'Apply'
            $successMessage = 'Stimmen aktualisiert; Dashboard ist aktuell.'
        }
        [IO.File]::WriteAllText($marker, (@{ commit = $target; installedAt = (Get-Date -Format o) } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($resultFile, (@{ commit = $target; status = 'success'; time = (Get-Date -Format o) } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        Set-UpdatePhase 8 'success' $successMessage
        Write-UpdateState 'success' $successMessage 'success'
        "$(Get-Date -Format o) Keine Dashboard-Dateien geändert; Revisionsstand aktualisiert" | Add-Content $log
        return
    }
    # Build in the dedicated cache while the installed service keeps running.
    Push-Location $cache
    try {
        Set-UpdatePhase 3 'dependencies' 'Abhängigkeiten im Update-Cache werden vorbereitet.'
        & pnpm.cmd install --frozen-lockfile 2>&1 | Out-File $log -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw 'pnpm install im Update-Cache fehlgeschlagen.' }
        Set-UpdatePhase 4 'build' 'Dashboard wird gebaut.'
        & pnpm.cmd build:app 2>&1 | Out-File $log -Append -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard-Build im Update-Cache fehlgeschlagen.' }
    } finally { Pop-Location }
    if ($voiceNeeded) {
        Assert-VerifiedVoiceSources
        Set-UpdatePhase 4 'build' 'Stimmen werden aktualisiert.'
        $voiceApplyStarted = $true
        Invoke-VoicePersonaHelper 'Apply'
    }
    $backup = Join-Path $updates ("backup-" + (Get-Date -Format yyyyMMdd-HHmmss))
    Set-UpdatePhase 5 'backup' 'Installierte Dateien werden gesichert.'
    New-Item -ItemType Directory -Force $backup | Out-Null
    foreach ($change in $changes) {
        $source = Join-Path $dash $change.Path
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            $targetBackup = Join-Path $backup $change.Path
            New-Item -ItemType Directory -Force (Split-Path $targetBackup -Parent) | Out-Null
            Copy-Item -LiteralPath $source -Destination $targetBackup -Force
        }
    }
    foreach ($folder in @('apps\control-api\dist','apps\web\out')) {
        $source = Join-Path $dash $folder
        if (Test-Path $source) {
            $saved = Join-Path $backup $folder
            New-Item -ItemType Directory -Force (Split-Path $saved -Parent) | Out-Null
            Copy-Item -LiteralPath $source -Destination $saved -Recurse -Force
        }
    }
    Copy-Item -LiteralPath $marker -Destination (Join-Path $backup 'dashboard-revision.json') -Force
    Stop-Dashboard
    $stopped = $true
    Set-UpdatePhase 6 'install' 'Geänderte Dashboard-Dateien werden installiert.'
    foreach ($name in @('dashboard.sqlite','dashboard.sqlite-wal','dashboard.sqlite-shm')) {
        $databaseFile = Join-Path $data $name
        if (Test-Path -LiteralPath $databaseFile -PathType Leaf) { Copy-Item -LiteralPath $databaseFile -Destination (Join-Path $backup $name) -Force }
    }
    foreach ($change in $changes) {
        $destination = Join-Path $dash $change.Path
        if ($change.Kind -eq 'D') { Remove-Item -LiteralPath $destination -Force }
        else {
            New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null
            Copy-Item -LiteralPath (Join-Path $cache $change.Path) -Destination $destination -Force
        }
    }
    foreach ($folder in @('apps\control-api\dist','apps\web\out')) {
        $source = Join-Path $cache $folder
        $destination = Join-Path $dash $folder
        Sync-BuildOutput $source $destination
    }
    if ($changes.Path -match '(^|\\)(package.json|pnpm-lock.yaml)$') {
        Push-Location $dash
        try { & pnpm.cmd install --frozen-lockfile 2>&1 | Out-File $log -Append -Encoding utf8; if ($LASTEXITCODE -ne 0) { throw 'Abhängigkeiten konnten nicht aktualisiert werden.' } }
        finally { Pop-Location }
    }
    Start-Dashboard
    Set-UpdatePhase 7 'health' 'Dashboard startet neu; Verbindung wird geprüft.'
    if (-not (Health-Ready)) { throw 'Dashboard-Healthcheck nach Update fehlgeschlagen.' }
    [IO.File]::WriteAllText($marker, (@{ commit = $target; installedAt = (Get-Date -Format o) } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($resultFile, (@{ commit = $target; status = 'success'; time = (Get-Date -Format o) } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Set-UpdatePhase 8 'success' 'Update installiert und Dashboard erreichbar.'
    Write-UpdateState 'success' 'Update installiert und Dashboard erreichbar.' 'success'
    "$(Get-Date -Format o) Update erfolgreich; Backup: $backup" | Add-Content $log
} catch {
    $failureMessage = $_.Exception.Message
    if ($voiceApplyStarted -or ($stopped -and $backup)) {
        Write-UpdateState 'rollback' 'Update fehlgeschlagen; Wiederherstellung wird geprüft.' 'running'
    }
    "$(Get-Date -Format o) FEHLER: $failureMessage" | Add-Content $log
    $voiceRollbackConfirmed = $true
    if ($voiceApplyStarted) {
        try {
            $voiceRollbackConfirmed = Restore-VoicePersonaAfterFailure
        } catch {
            $voiceRollbackConfirmed = $false
            "$(Get-Date -Format o) Stimmen-Rollback fehlgeschlagen: $($_.Exception.Message)" | Add-Content $log
        }
    }
    if ($stopped -and $backup) {
        try {
            Stop-Dashboard
            foreach ($change in $changes) {
                $destination = Join-Path $dash $change.Path
                $saved = Join-Path $backup $change.Path
                if (Test-Path -LiteralPath $saved -PathType Leaf) { New-Item -ItemType Directory -Force (Split-Path $destination -Parent) | Out-Null; Copy-Item -LiteralPath $saved -Destination $destination -Force }
                elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
            }
            foreach ($folder in @('apps\control-api\dist','apps\web\out')) {
                $saved = Join-Path $backup $folder
                if (Test-Path $saved) { & robocopy.exe $saved (Join-Path $dash $folder) /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null }
            }
            Copy-Item -LiteralPath (Join-Path $backup 'dashboard-revision.json') -Destination $marker -Force
            foreach ($name in @('dashboard.sqlite','dashboard.sqlite-wal','dashboard.sqlite-shm')) {
                $saved = Join-Path $backup $name
                $databaseFile = Join-Path $data $name
                if (Test-Path -LiteralPath $saved -PathType Leaf) { Copy-Item -LiteralPath $saved -Destination $databaseFile -Force }
                elseif (Test-Path -LiteralPath $databaseFile -PathType Leaf) { Remove-Item -LiteralPath $databaseFile -Force }
            }
            if ($changes.Path -match '(^|\\)(package.json|pnpm-lock.yaml)$') {
                Push-Location $dash
                try { & pnpm.cmd install --frozen-lockfile 2>&1 | Out-File $log -Append -Encoding utf8 }
                finally { Pop-Location }
            }
            Start-Dashboard
            if (-not (Health-Ready)) { throw 'Dashboard nach Rollback nicht erreichbar.' }
            "$(Get-Date -Format o) Rollback abgeschlossen" | Add-Content $log
            if ($voiceRollbackConfirmed) { $failureMessage = "Update in Phase $phase fehlgeschlagen; vorheriger Stand wiederhergestellt." }
            else { $failureMessage = "Update in Phase $phase fehlgeschlagen; Dashboard wiederhergestellt, Stimmen-Rollback nicht bestätigt." }
        } catch {
            if ($voiceRollbackConfirmed) { $failureMessage = "Update in Phase $phase fehlgeschlagen; Dashboard-Rollback konnte nicht bestätigt werden." }
            else { $failureMessage = "Update in Phase $phase fehlgeschlagen; Dashboard- und Stimmen-Rollback konnten nicht bestätigt werden." }
            "$(Get-Date -Format o) Rollback fehlgeschlagen: $($_.Exception.Message)" | Add-Content $log
        }
    }
    if (-not $voiceRollbackConfirmed -and -not ($stopped -and $backup)) {
        $failureMessage = "Update in Phase $phase fehlgeschlagen; Stimmen-Rollback nicht bestätigt."
    }
    if ($voiceApplyStarted -and -not $stopped -and $installedMarkerText) {
        try { [IO.File]::WriteAllText($marker, $installedMarkerText, [Text.UTF8Encoding]::new($false)) }
        catch {
            $failureMessage = "Update in Phase $phase fehlgeschlagen; vorheriger Revisionsstand konnte nicht wiederhergestellt werden."
            "$(Get-Date -Format o) Revisionsstand-Rollback fehlgeschlagen: $($_.Exception.Message)" | Add-Content $log
        }
    }
    [IO.File]::WriteAllText($resultFile, (@{ commit = $ExpectedCommit; status = 'failed'; time = (Get-Date -Format o); message = $failureMessage } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-UpdateState 'failed' $failureMessage 'failed'
    throw "Dashboard-Update fehlgeschlagen: $failureMessage"
} finally {
    if ($lockHandle) { $lockHandle.Dispose() }
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
    if ($TaskName) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue }
}
