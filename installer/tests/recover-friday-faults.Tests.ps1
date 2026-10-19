$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot '..\scripts\recover-friday.ps1'
$fixture = Join-Path $env:TEMP ('friday-recovery-faults-' + [guid]::NewGuid().ToString('N'))
$target = Join-Path $fixture 'target'
$stage = Join-Path $target 'backups\.friday-recovery-test'
$script:stageFixture = $stage
New-Item -ItemType Directory -Path (Join-Path $target 'config'), (Join-Path $target 'dashboard\scripts'), $stage -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $target 'config\install-state.json'),
    (@{ distro_name = 'FridayTest'; linux_user = 'friday'; ports = @{ CommandCenter = 3101 } } | ConvertTo-Json -Compress))
[IO.File]::WriteAllText((Join-Path $target 'dashboard\scripts\wsl-system-restore.py'), 'fixture')
[IO.File]::WriteAllText((Join-Path $stage 'recovery-plan.json'), '{"state":"applying"}')
$env:FRIDAY_RECOVERY_TEST = '1'
try {
    . $scriptPath -BackupPath (Join-Path $fixture 'backup') -TargetRoot $target -Apply
    $TargetRoot = $target
    $BackupPath = Join-Path $fixture 'backup'
    $Apply = $true
    $script:events = @()
    $script:taskJournal = @()
    $script:taskState = @{
        FRIDAY_Watchdog = 'Running'; FRIDAY_Dashboard = 'Ready'; FRIDAY_Voice = 'Disabled'
    }
    function Get-ScheduledTask {
        param([string]$TaskName)
        if (-not $script:taskState.ContainsKey($TaskName)) { return $null }
        $path = if ($script:foreignTask -eq $TaskName) { 'C:\Foreign\installer\script.ps1' } else {
            Join-Path $target 'installer\scripts\launcher.ps1'
        }
        return [pscustomobject]@{ State = $script:taskState[$TaskName];
            Actions = @([pscustomobject]@{ Execute = 'powershell.exe'; Arguments = $path }) }
    }
    function Stop-ScheduledTask { param([string]$TaskName)
        $script:events += "stop:$TaskName"
        if ($script:failStop -eq $TaskName) { throw 'synthetic stop failure' }
        $script:taskState[$TaskName] = 'Ready'
    }
    function Disable-ScheduledTask { param([string]$TaskName)
        $script:events += "disable:$TaskName"
        if ($script:failDisable -eq $TaskName) { throw 'synthetic disable failure' }
        $script:taskState[$TaskName] = 'Disabled'
    }
    function Enable-ScheduledTask { param([string]$TaskName)
        $script:events += "enable:$TaskName"; $script:taskState[$TaskName] = 'Ready'
    }
    function Start-ScheduledTask { param([string]$TaskName)
        $script:events += "start:$TaskName"; $script:taskState[$TaskName] = 'Running'
    }
    function Get-NetTCPConnection { return $null }

    $script:foreignTask = 'FRIDAY_Dashboard'
    try { Stop-OwnedTasks $target | Out-Null; throw 'foreign task accepted' }
    catch { if ($_.Exception.Message -notmatch 'gehoert nicht') { throw } }
    if ($script:events.Count -ne 0 -or $script:taskJournal.Count -ne 0) { throw 'foreign task mutated state' }
    $script:foreignTask = $null

    $script:failStop = 'FRIDAY_Watchdog'
    try { Stop-OwnedTasks $target | Out-Null; throw 'stop failure accepted' }
    catch { if ($_.Exception.Message -notmatch 'synthetic stop') { throw } }
    if ($script:taskJournal.Count -ne 1 -or $script:taskJournal[0].Name -ne 'FRIDAY_Watchdog') {
        throw 'failed task stop was not journaled'
    }
    $script:failStop = $null
    Resume-OwnedTasks $script:taskJournal
    $script:taskJournal = @(); $script:events = @()

    $script:failDisable = 'FRIDAY_Watchdog'
    try { Stop-OwnedTasks $target | Out-Null; throw 'partial stop accepted' }
    catch { if ($_.Exception.Message -notmatch 'synthetic disable') { throw } }
    if ($script:taskJournal.Count -ne 1 -or $script:taskJournal[0].Name -ne 'FRIDAY_Watchdog') {
        throw 'partial task stop was not journaled'
    }
    $script:failDisable = $null
    Resume-OwnedTasks $script:taskJournal
    if ($script:taskState.FRIDAY_Watchdog -ne 'Running' -or $script:taskState.FRIDAY_Dashboard -ne 'Ready' -or
        $script:taskState.FRIDAY_Voice -ne 'Disabled') { throw 'original task states not restored' }

    function Get-WslServiceStates { return @{ 'hermes-gateway.service' = 'active'; 'hermes-dashboard.service' = 'inactive' } }
    function Restore-WslServiceStates { $script:events += 'restore-wsl-states' }
    function Invoke-Wsl {
        param([string]$Distro, [string]$User, [string[]]$Arguments, [string]$InputJson = '')
        if ($Arguments[0] -eq 'python3' -and $InputJson) {
            if ($InputJson -match '"action":"rollback"') { $script:events += 'rollback-wsl'; return '{"state":"rolled back"}' }
            $script:events += 'import-wsl'
            if ($script:validImport) { return ('{"hermesRevision":"' + ('a' * 40) + '"}') }
            return 'not-json'
        }
        if ($Arguments[0] -eq 'python3') { return '/home/friday' }
        if ($Arguments -contains 'is-active') { return 'active' }
        $script:events += "wsl:$($Arguments -join ':')"
        return 'ok'
    }
    function Wsl-Path { return '/mnt/c/fixture' }
    function Test-WslRecoveryReceipt { return $true }
    function Invoke-RecoveryCli {
        param([string[]]$Arguments)
        $script:events += "cli:$($Arguments[0])"
        if ($script:failPrepare -and $Arguments[0] -eq 'prepare') { throw 'synthetic prepare failure' }
        if ($Arguments[0] -eq 'prepare') { return [pscustomobject]@{ path = $script:stageFixture; fileCount = 4; wslRevision = ('a' * 40) } }
        if ($Arguments[0] -eq 'apply') {
            if ($script:failApply) { throw 'synthetic apply failure' }
            return [pscustomobject]@{ state = 'applied' }
        }
        return [pscustomobject]@{ state = 'rolled-back' }
    }
    $script:failPrepare = $true
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'prepare failure accepted' }
    catch { if ($_.Exception.Message -notmatch 'synthetic prepare failure') { throw } }
    if ('restore-wsl-states' -notin $script:events -or 'import-wsl' -in $script:events -or
        $script:taskState.FRIDAY_Watchdog -ne 'Running') { throw 'prepare failure did not restore prior services' }

    $script:failPrepare = $false
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'bad import receipt accepted' }
    catch { if ($_.Exception.Message -notmatch 'ConvertFrom-Json|Invalid JSON|JSON') { throw } }
    if ('rollback-wsl' -notin $script:events -or 'restore-wsl-states' -notin $script:events -or
        $script:taskState.FRIDAY_Watchdog -ne 'Running') { throw 'bad receipt did not roll back imported WSL state' }

    function Test-WslRecoveryReceipt { throw 'synthetic receipt lookup failure' }
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'unknown receipt accepted' }
    catch { if ($_.Exception.Message -notmatch 'Receipt-Status ist unklar') { throw } }
    if ('restore-wsl-states' -in $script:events -or $script:taskState.FRIDAY_Watchdog -eq 'Running') {
        throw 'unknown WSL receipt restarted target services'
    }
    function Test-WslRecoveryReceipt { return $true }
    Resume-OwnedTasks $script:taskJournal

    $script:validImport = $true; $script:failApply = $true
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'apply failure accepted' }
    catch { if ($_.Exception.Message -notmatch 'synthetic apply failure') { throw } }
    if ('cli:rollback' -notin $script:events -or 'rollback-wsl' -notin $script:events -or
        'restore-wsl-states' -notin $script:events -or $script:taskState.FRIDAY_Watchdog -ne 'Running') {
        throw 'apply failure did not restore prior state'
    }

    $script:failApply = $false
    New-Item -ItemType Directory -Path (Join-Path $target 'installer') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $target 'installer\install-friday.ps1'), 'fixture')
    function powershell.exe { $global:LASTEXITCODE = 1; $script:events += 'installer-failed' }
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'installer failure accepted' }
    catch { if ($_.Exception.Message -notmatch 'Reprovisionierung') { throw } }
    if ('installer-failed' -notin $script:events -or 'cli:rollback' -notin $script:events -or
        'rollback-wsl' -notin $script:events) { throw 'installer failure skipped rollback' }

    function powershell.exe { $global:LASTEXITCODE = 0; $script:events += 'installer-ok' }
    function Invoke-WebRequest { throw 'synthetic health failure' }
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    try { Invoke-FridayRecovery | Out-Null; throw 'health failure accepted' }
    catch { if ($_.Exception.Message -notmatch 'synthetic health failure') { throw } }
    if ('installer-ok' -notin $script:events -or 'cli:rollback' -notin $script:events -or
        'rollback-wsl' -notin $script:events) { throw 'health failure skipped rollback' }

    function Invoke-WebRequest { return [pscustomobject]@{ StatusCode = 200 } }
    $script:events = @(); $script:taskJournal = @(); $script:taskState.FRIDAY_Watchdog = 'Running'
    $result = @(Invoke-FridayRecovery)
    if (-not (@($result) -join ' ' -match 'healthy') -or 'cli:rollback' -in $script:events -or
        $script:taskState.FRIDAY_Watchdog -ne 'Running' -or $script:taskState.FRIDAY_Dashboard -ne 'Ready' -or
        $script:taskState.FRIDAY_Voice -ne 'Disabled') { throw 'healthy recovery did not preserve task states' }
    'Recovery fault harness PASS'
} finally {
    Remove-Item Env:FRIDAY_RECOVERY_TEST -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
