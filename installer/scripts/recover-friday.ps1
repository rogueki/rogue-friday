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
        $owned += [pscustomobject]@{ Name = $name; WasEnabled = $task.State -ne 'Disabled';
            WasRunning = $task.State -eq 'Running' }
    }
    foreach ($item in $owned) {
        if (-not @($script:taskJournal | Where-Object { $_.Name -eq $item.Name }).Count) {
            $script:taskJournal += $item
        }
        if ($item.WasRunning) { Stop-ScheduledTask -TaskName $item.Name -ErrorAction Stop }
        if ($item.WasEnabled) { Disable-ScheduledTask -TaskName $item.Name -ErrorAction Stop | Out-Null }
    }
    return $owned
}

function Resume-OwnedTasks([object[]]$Tasks) {
    foreach ($item in $Tasks) {
        if (-not $item.WasRunning) {
            Stop-ScheduledTask -TaskName $item.Name -ErrorAction SilentlyContinue
        }
        if ($item.WasEnabled) {
            Enable-ScheduledTask -TaskName $item.Name | Out-Null
            if ($item.WasRunning) { Start-ScheduledTask -TaskName $item.Name }
        } else {
            Disable-ScheduledTask -TaskName $item.Name | Out-Null
        }
    }
}

function Get-WslServiceStates([string]$Distro, [string]$User) {
    $states = @{}
    foreach ($name in @('hermes-gateway.service', 'hermes-dashboard.service')) {
        $output = & wsl.exe -d $Distro -u $User --exec systemctl --user is-active $name 2>$null
        $state = [string]($output | Select-Object -Last 1)
        if ($state -notin @('active', 'inactive', 'failed')) { throw "WSL-Dienstzustand $name ist unklar." }
        $states[$name] = $state
    }
    return $states
}

function Restore-WslServiceStates([string]$Distro, [string]$User, [hashtable]$States) {
    foreach ($name in $States.Keys) {
        $verb = if ($States[$name] -eq 'active') { 'start' } else { 'stop' }
        Invoke-Wsl $Distro $User @('systemctl', '--user', $verb, $name) | Out-Null
    }
}

function Test-WslRecoveryReceipt([string]$Distro, [string]$User, [string]$LinuxHome) {
    $output = Invoke-Wsl $Distro $User @('python3', '-c',
        'import pathlib,sys; print("present" if (pathlib.Path(sys.argv[1]) / ".friday-recovery-receipt.json").is_file() else "absent")', $LinuxHome)
    $result = [string]($output | Select-Object -Last 1)
    if ($result -notin @('present', 'absent')) { throw 'WSL-Recovery-Receipt-Status ist unklar.' }
    return $result -eq 'present'
}

function Get-ScopedBridgeDigests([string]$Root) {
    $result = @{}
    $data = Join-Path $Root 'dashboard\data'
    foreach ($item in @(@('memory', 'hermes-memory-bridge'), @('calendar', 'calendar-bridge'),
                       @('mail', 'mail-bridge'), @('messenger', 'hermes-messenger-bridge'))) {
        $file = Join-Path $data (Join-Path $item[1] 'auth.key')
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Wiederhergestellter $($item[0])-Dienstschluessel fehlt." }
        $encoded = [IO.File]::ReadAllText($file).Trim()
        if ($encoded -cnotmatch '^[A-Za-z0-9+/]{43}=$') { throw "Wiederhergestellter $($item[0])-Dienstschluessel ist ungueltig." }
        $bytes = [Convert]::FromBase64String($encoded)
        if ($bytes.Length -ne 32) { throw "Wiederhergestellter $($item[0])-Dienstschluessel ist ungueltig." }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $result[$item[0]] = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose(); [Array]::Clear($bytes, 0, $bytes.Length); $encoded = $null }
    }
    return $result
}

function Invoke-FridayRecovery {
$target = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
$statePath = Join-Path $target 'config\install-state.json'
if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { throw 'Frische Zielinstallation fehlt.' }
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($state.distro_name -cnotmatch '^[A-Za-z][A-Za-z0-9_-]{0,31}$' -or
    $state.linux_user -cnotmatch '^[a-z_][a-z0-9_-]*$') { throw 'Ziel-WSL-Identitaet ist ungueltig.' }

$script:taskJournal = @()
$wslStates = @{}
$stage = $null
$wslAttempted = $false
$windowsAttempted = $false
try {
    if ($Apply) {
        Stop-OwnedTasks $target | Out-Null
        $dashboardPort = [int]$state.ports.CommandCenter
        if ($dashboardPort -lt 1024 -or $dashboardPort -gt 65535) { throw 'Dashboard-Port ist ungueltig.' }
        if (Get-NetTCPConnection -LocalPort $dashboardPort -State Listen -ErrorAction SilentlyContinue) {
            throw 'Ziel-Dashboard laeuft nach Task-Stopp noch; Recovery verweigert.'
        }
        $wslStates = Get-WslServiceStates $state.distro_name $state.linux_user
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
    $linuxHome = [string]((Invoke-Wsl $state.distro_name $state.linux_user @('python3', '-c',
        'from pathlib import Path; print(Path.home())')) | Select-Object -Last 1)
    if (-not $linuxHome.StartsWith('/home/')) { throw 'Ziel-WSL-Home ist ungueltig.' }
    $request = @{ action = 'import'; source = $linuxSnapshot; home = $linuxHome; allowExisting = $true } | ConvertTo-Json -Compress
    $wslAttempted = $true
    $import = Invoke-Wsl $state.distro_name $state.linux_user @('python3', $linuxHelper) $request
    $receipt = [string]($import | Select-Object -Last 1)
    if (($receipt | ConvertFrom-Json).hermesRevision -ne $stage.wslRevision) {
        throw 'WSL-Recovery-Revision weicht vom Backup ab.'
    }
    $windowsAttempted = $true
    Invoke-RecoveryCli @('apply', $stage.path) | Out-Null

    # UpdateDashboard re-applies all scoped Hermes bridge keys from the recovered
    # Control API and checks its own build/health. It runs only in the new root.
    $installer = Join-Path $target 'installer\install-friday.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Ziel-Installer fehlt.' }
    foreach ($item in $script:taskJournal) {
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
    $bridgeHelper = Join-Path $target 'dashboard\scripts\wsl-recovery-bridge-health.py'
    if (-not (Test-Path -LiteralPath $bridgeHelper -PathType Leaf)) { throw 'WSL-Bridge-Health-Helfer fehlt.' }
    $memoryDbPath = Wsl-Path $state.distro_name $state.linux_user (Join-Path $target 'dashboard\data\memory\outbox.sqlite')
    $bridgeRequest = @{ port = $dashboardPort; memoryDbPath = $memoryDbPath;
        keyDigests = (Get-ScopedBridgeDigests $target) } | ConvertTo-Json -Compress
    $bridgeResult = Invoke-Wsl $state.distro_name $state.linux_user @('python3', (Wsl-Path $state.distro_name $state.linux_user $bridgeHelper)) $bridgeRequest
    $bridgeHealth = [string]($bridgeResult | Select-Object -Last 1) | ConvertFrom-Json
    if ($bridgeHealth.state -cne 'ready' -or @($bridgeHealth.keyMatches).Count -ne 4 -or
        @($bridgeHealth.readOnlyProbes) -cnotcontains 'memory-search') {
        throw 'Wiederhergestellte API-Bruecken sind nicht bereit.'
    }
    Resume-OwnedTasks $script:taskJournal
    Write-Output (@{ state = 'healthy'; stagingPath = $stage.path; fileCount = $stage.fileCount;
        hermesRevision = $stage.wslRevision } | ConvertTo-Json -Compress)
} catch {
    $reason = $_.Exception.Message
    $rollbackProblems = @()
    if ($windowsAttempted) {
        try {
            Stop-OwnedTasks $target | Out-Null
            Invoke-Wsl $state.distro_name $state.linux_user @('systemctl', '--user', 'stop', 'hermes-gateway.service', 'hermes-dashboard.service') | Out-Null
        } catch { $rollbackProblems += 'Wiederhergestellte Dienste konnten nicht angehalten werden.' }
    }
    if ($windowsAttempted -and $stage) {
        try {
            $plan = Get-Content -LiteralPath (Join-Path $stage.path 'recovery-plan.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($plan.state -in @('applying', 'applied')) { Invoke-RecoveryCli @('rollback', $stage.path) | Out-Null }
        }
        catch { $rollbackProblems += 'Windows-Rollback verweigert; Staging und Ziel fuer manuelle Pruefung erhalten.' }
    }
    $receiptPresent = $false
    if ($wslAttempted -and $linuxHome -and $linuxSnapshot -and $linuxHelper) {
        try { $receiptPresent = Test-WslRecoveryReceipt $state.distro_name $state.linux_user $linuxHome }
        catch { $rollbackProblems += 'WSL-Recovery-Receipt-Status ist unklar; Dienste bleiben angehalten.' }
    }
    if ($receiptPresent) {
        try {
            $request = @{ action = 'rollback'; source = $linuxSnapshot; home = $linuxHome } | ConvertTo-Json -Compress
            Invoke-Wsl $state.distro_name $state.linux_user @('python3', $linuxHelper) $request | Out-Null
        } catch { $rollbackProblems += 'WSL-Rollback verweigert; Recovery-Receipt erhalten.' }
    }
    if ($rollbackProblems.Count -eq 0) {
        try { Restore-WslServiceStates $state.distro_name $state.linux_user $wslStates }
        catch { $rollbackProblems += 'Urspruengliche WSL-Dienstzustaende konnten nicht wiederhergestellt werden.' }
    }
    if ($rollbackProblems.Count -eq 0) { Resume-OwnedTasks $script:taskJournal }
    throw "Recovery gescheitert: $reason $($rollbackProblems -join ' ')"
}
}

if ($env:FRIDAY_RECOVERY_TEST -ne '1') { Invoke-FridayRecovery }
