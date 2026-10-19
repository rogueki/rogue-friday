#Requires -Version 5.1
param(
    [Parameter(Mandatory=$true)][string]$BackupPath,
    [Parameter(Mandatory=$true)][string]$TargetRoot,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object Text.UTF8Encoding $false

function Invoke-RecoveryCli([string[]]$Arguments) {
    $cli = Join-Path $TargetRoot 'dashboard\apps\control-api\dist\system-recovery.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'Recovery CLI fehlt in der frischen Zielinstallation.' }
    $output = & node.exe $cli @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Recovery CLI fehlgeschlagen: $(@($output) -join ' ')" }
    return (@($output | Where-Object { $_ -match '^\{' } | Select-Object -Last 1) | ConvertFrom-Json)
}

function Invoke-Wsl([string]$Distro, [string]$User, [string[]]$Arguments, [string]$InputJson = '') {
    $args = @('-d', $Distro, '-u', $User, '--exec') + $Arguments
    $output = if ($InputJson) { $InputJson | & wsl.exe @args 2>&1 } else { & wsl.exe @args 2>&1 }
    if ($LASTEXITCODE -ne 0) { throw "WSL-Wiederherstellung fehlgeschlagen: $(@($output) -join ' ')" }
    return @($output)
}

function Wsl-Path([string]$Distro, [string]$User, [string]$WindowsPath) {
    $output = Invoke-Wsl $Distro $User @('wslpath', '-a', '-u', $WindowsPath)
    $path = [string]($output | Select-Object -Last 1)
    if (-not $path.StartsWith('/')) { throw 'WSL-Pfadabbildung ist ungueltig.' }
    return $path.Trim()
}

function Stop-OwnedTasks([string]$Root) {
    $owned = @()
    foreach ($name in @('FRIDAY_Watchdog', 'FRIDAY_Dashboard', 'FRIDAY_Voice', 'FRIDAY_Qwen', 'FRIDAY_WSL_Keepalive')) {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if (-not $task) { continue }
        $actions = @($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
        if ($actions.IndexOf($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "Aufgabe $name gehoert nicht zur isolierten Zielinstallation."
        }
        $wasEnabled = $task.State -ne 'Disabled'
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($wasEnabled) { Disable-ScheduledTask -TaskName $name | Out-Null }
        $owned += [pscustomobject]@{ Name = $name; WasEnabled = $wasEnabled }
    }
    return $owned
}

function Resume-OwnedTasks([object[]]$Tasks) {
    foreach ($item in $Tasks) {
        if ($item.WasEnabled) {
            Enable-ScheduledTask -TaskName $item.Name | Out-Null
            if ($item.Name -in @('FRIDAY_Dashboard', 'FRIDAY_Watchdog', 'FRIDAY_WSL_Keepalive', 'FRIDAY_Voice')) {
                Start-ScheduledTask -TaskName $item.Name
            }
        }
    }
}

$target = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
$statePath = Join-Path $target 'config\install-state.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'Frische Zielinstallation fehlt.' }
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($state.distro_name -cnotmatch '^[A-Za-z][A-Za-z0-9_-]{0,31}$' -or
    $state.linux_user -cnotmatch '^[a-z_][a-z0-9_-]*$') { throw 'Ziel-WSL-Identitaet ist ungueltig.' }

$tasks = @()
$stage = $null
$wslImported = $false
$windowsApplied = $false
try {
    if ($Apply) {
        $tasks = @(Stop-OwnedTasks $target)
        $dashboardPort = [int]$state.ports.CommandCenter
        if ($dashboardPort -lt 1024 -or $dashboardPort -gt 65535) { throw 'Dashboard-Port ist ungueltig.' }
        if (Get-NetTCPConnection -LocalPort $dashboardPort -State Listen -ErrorAction SilentlyContinue) {
            throw 'Ziel-Dashboard laeuft nach Task-Stopp noch; Recovery verweigert.'
        }
        Invoke-Wsl $state.distro_name $state.linux_user @('systemctl', '--user', 'stop', 'hermes-gateway.service', 'hermes-dashboard.service') | Out-Null
    }
    $stage = Invoke-RecoveryCli @('prepare', $BackupPath, $target)
    $cloudKey = Join-Path $stage.path 'new\config\elevenlabs_api.key.dpapi'
    if (Test-Path -LiteralPath $cloudKey -PathType Leaf) {
        try {
            $protected = Get-Content -LiteralPath $cloudKey -Raw -Encoding Ascii
            $secret = $protected.Trim() | ConvertTo-SecureString
            $secret.Dispose()
        } catch {
            throw 'Gesicherter Cloud-Stimmschluessel ist fuer diesen Windows-Benutzer nicht entschluesselbar; vor Recovery neu provisionieren.'
        } finally { $protected = $null; $secret = $null }
    }
    if (-not $Apply) {
        Write-Output (@{ state = 'prepared-only'; stagingPath = $stage.path; fileCount = $stage.fileCount;
            hermesRevision = $stage.wslRevision } | ConvertTo-Json -Compress)
        return
    }
    $helper = Join-Path $target 'dashboard\scripts\wsl-system-restore.py'
    if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) { throw 'WSL-Recovery-Helfer fehlt.' }
    $linuxHelper = Wsl-Path $state.distro_name $state.linux_user $helper
    $linuxSnapshot = Wsl-Path $state.distro_name $state.linux_user (Join-Path $stage.path 'wsl')
    $home = [string]((Invoke-Wsl $state.distro_name $state.linux_user @('python3', '-c',
        'from pathlib import Path; print(Path.home())')) | Select-Object -Last 1)
    if (-not $home.StartsWith('/home/')) { throw 'Ziel-WSL-Home ist ungueltig.' }
    $request = @{ action = 'import'; source = $linuxSnapshot; home = $home } | ConvertTo-Json -Compress
    $import = Invoke-Wsl $state.distro_name $state.linux_user @('python3', $linuxHelper) $request
    $receipt = [string]($import | Select-Object -Last 1)
    if (($receipt | ConvertFrom-Json).hermesRevision -ne $stage.wslRevision) {
        throw 'WSL-Recovery-Revision weicht vom Backup ab.'
    }
    $wslImported = $true
    Invoke-RecoveryCli @('apply', $stage.path) | Out-Null
    $windowsApplied = $true

    # UpdateDashboard re-applies all scoped Hermes bridge keys from the recovered
    # Control API and checks its own build/health. It runs only in the new root.
    $installer = Join-Path $target 'installer\install-friday.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Ziel-Installer fehlt.' }
    foreach ($item in $tasks) {
        if ($item.WasEnabled -and $item.Name -in @('FRIDAY_Dashboard', 'FRIDAY_Voice')) {
            Enable-ScheduledTask -TaskName $item.Name | Out-Null
        }
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -UpdateDashboard -InstallRoot $target
    if ($LASTEXITCODE -ne 0) { throw 'Reprovisionierung des isolierten Ziels fehlgeschlagen.' }
    $health = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$dashboardPort/api/v1/health" -TimeoutSec 5
    if ($health.StatusCode -ne 200) { throw 'Wiederhergestelltes Dashboard ist nicht gesund.' }
    $gateway = Invoke-Wsl $state.distro_name $state.linux_user @('systemctl', '--user', 'is-active', 'hermes-gateway.service')
    if ([string]($gateway | Select-Object -Last 1) -ne 'active') { throw 'Wiederhergestelltes Hermes-Gateway ist nicht aktiv.' }
    Resume-OwnedTasks $tasks
    Write-Output (@{ state = 'healthy'; stagingPath = $stage.path; fileCount = $stage.fileCount;
        hermesRevision = $stage.wslRevision } | ConvertTo-Json -Compress)
} catch {
    $reason = $_.Exception.Message
    $rollbackProblems = @()
    if ($windowsApplied) {
        try {
            Stop-OwnedTasks $target | Out-Null
            Invoke-Wsl $state.distro_name $state.linux_user @('systemctl', '--user', 'stop', 'hermes-gateway.service', 'hermes-dashboard.service') | Out-Null
        } catch { $rollbackProblems += 'Wiederhergestellte Dienste konnten nicht angehalten werden.' }
    }
    if ($windowsApplied) {
        try { Invoke-RecoveryCli @('rollback', $stage.path) | Out-Null }
        catch { $rollbackProblems += 'Windows-Rollback verweigert; Staging und Ziel fuer manuelle Pruefung erhalten.' }
    }
    if ($wslImported) {
        try {
            $request = @{ action = 'rollback'; source = $linuxSnapshot; home = $home } | ConvertTo-Json -Compress
            Invoke-Wsl $state.distro_name $state.linux_user @('python3', $linuxHelper) $request | Out-Null
        } catch { $rollbackProblems += 'WSL-Rollback verweigert; Recovery-Receipt erhalten.' }
    }
    if ($rollbackProblems.Count -eq 0) { Resume-OwnedTasks $tasks }
    throw "Recovery gescheitert: $reason $($rollbackProblems -join ' ')"
}
