# Einzelinstanz des Installers.
#
# Die Dienst-Launcher halten eigene Mutexe (Local\FRIDAY_VoiceLauncher usw.), der Installer selbst
# hielt bisher keinen: zwei Laeufe (Assistent plus geplante Aufgabe oder ein zweiter Doppelklick)
# konnten denselben Zustand abwechselnd ersetzen. Seit 813a430 ist das Schreiben atomar, aber der
# letzte Lauf gewann trotzdem und die Schrittmarken vermischten sich.
#
# Zwei Ebenen, weil sie unterschiedliche Fragen beantworten:
# - benannter Mutex: schliesst Parallelaeufe aus und wird vom Betriebssystem freigegeben, wenn der
#   Prozess stirbt (auch bei hartem Absturz) - eine tote Sperre blockiert also nie dauerhaft.
# - Sperrdatei mit PID und Startzeit: liefert die Meldung "wer laeuft gerade" und erkennt einen
#   abgebrochenen Lauf. Die PID allein ist dafuer kein Beweis, weil Windows PIDs wiederverwendet;
#   erst die zusaetzlich passende Startzeit ordnet die PID eindeutig einem Prozess zu.
#
# Dot-sourced by install-friday.ps1; also loaded directly by installer/tests/installer-lock.Tests.ps1.

$script:InstallerLockMutexName = 'Global\FRIDAY-Installer'
$script:InstallerLockFallbackMutexName = 'Local\FRIDAY-Installer'
$script:InstallerAlreadyRunningExitCode = 20

function Get-InstallerLockPath([string]$Root) {
    if (-not $Root) { throw 'InstallRoot fuer die Installersperre fehlt.' }
    return (Join-Path $Root 'run\installer.lock.json')
}

function Read-InstallerLock([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
        if (-not $raw) { return $null }
        return ($raw | ConvertFrom-Json)
    } catch { return $null }
}

function Get-ProcessStartTimeUtc([int]$ProcessId) {
    try { return (Get-Process -Id $ProcessId -ErrorAction Stop).StartTime.ToUniversalTime() } catch { return $null }
}

function ConvertTo-UtcTimestamp([string]$Value) {
    if (-not $Value) { return $null }
    try {
        return ([datetime]::Parse($Value, [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal))
    } catch { return $null }
}

function Test-InstallerLockHolderAlive($Lock) {
    # Gleiche PID heisst nicht gleicher Prozess: nur wenn die aufgezeichnete Startzeit zur
    # laufenden passt, ist der Eintrag noch der laufende Installer.
    if (-not $Lock -or -not $Lock.pid) { return $false }
    $started = Get-ProcessStartTimeUtc -ProcessId ([int]$Lock.pid)
    if (-not $started) { return $false }
    $recorded = ConvertTo-UtcTimestamp ([string]$Lock.startedUtc)
    if (-not $recorded) { return $true }
    return ([math]::Abs(($started - $recorded).TotalSeconds) -lt 2)
}

function Format-InstallerLockHolder($Lock) {
    if (-not $Lock -or -not $Lock.pid) { return 'Der laufende Prozess hat keine Sperrdatei hinterlassen.' }
    $parts = @("PID $($Lock.pid)")
    $recorded = ConvertTo-UtcTimestamp ([string]$Lock.startedUtc)
    if ($recorded) { $parts += "gestartet $($recorded.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss'))" }
    if ($Lock.mode) { $parts += "Art $($Lock.mode)" }
    if ($Lock.runId) { $parts += "Lauf $($Lock.runId)" }
    return ('Laufender Lauf: ' + ($parts -join ', '))
}

function Write-InstallerLock([string]$Path, [string]$RunId, [string]$Mode, [string]$InstallRoot) {
    $directory = Split-Path -Parent $Path
    if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $self = Get-Process -Id $PID
    $record = [ordered]@{
        pid = $PID
        startedUtc = $self.StartTime.ToUniversalTime().ToString('o')
        runId = $RunId
        mode = $Mode
        installRoot = $InstallRoot
        session = $self.SessionId
        computer = $env:COMPUTERNAME
    }
    [IO.File]::WriteAllText($Path, ($record | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
}

function Enter-InstallerLock([string]$Root, [string]$RunId = '', [string]$Mode = 'install') {
    $result = @{
        Acquired = $false
        Mutex = $null
        Path = (Get-InstallerLockPath $Root)
        Holder = $null
        Stale = $null
        Fallback = $false
    }
    $mutex = $null
    try {
        $mutex = New-Object System.Threading.Mutex($false, $script:InstallerLockMutexName)
    } catch [System.UnauthorizedAccessException] {
        # Global\ braucht SeCreateGlobalPrivilege; ohne Recht bleibt die Sperre auf die Sitzung beschraenkt.
        $mutex = New-Object System.Threading.Mutex($false, $script:InstallerLockFallbackMutexName)
        $result.Fallback = $true
    }
    $acquired = $false
    try { $acquired = $mutex.WaitOne(2000) }
    catch [System.Threading.AbandonedMutexException] { $acquired = $true }   # Vorbesitzer gestorben: Sperre ist frei
    if (-not $acquired) {
        $result.Holder = Read-InstallerLock $result.Path
        try { $mutex.Dispose() } catch { }
        return $result
    }
    $previous = Read-InstallerLock $result.Path
    if ($previous -and -not (Test-InstallerLockHolderAlive $previous)) { $result.Stale = $previous }
    Write-InstallerLock -Path $result.Path -RunId $RunId -Mode $Mode -InstallRoot $Root
    $result.Acquired = $true
    $result.Mutex = $mutex
    return $result
}

function Exit-InstallerLock($Lock) {
    if (-not $Lock) { return }
    if ($Lock.Path) { Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction SilentlyContinue }
    if ($Lock.Mutex) {
        try { $Lock.Mutex.ReleaseMutex() } catch { }
        try { $Lock.Mutex.Dispose() } catch { }
    }
}