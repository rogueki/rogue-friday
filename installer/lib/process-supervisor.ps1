# Ueberwachte Unterprozesse: Zeitlimit, Abbruchbitte und gezieltes Beenden genau des gestarteten
# Prozesses. Bewusst keine Baumtoetung: fremde Prozesse und die WSL-Distribution bleiben unberuehrt.
function ConvertTo-WindowsArgument([string]$Value) {
    # Quotierung nach den Regeln von CreateProcess: nur bei Bedarf in Anfuehrungszeichen, Backslashes vor
    # einem Anfuehrungszeichen werden verdoppelt, ein Anfuehrungszeichen wird maskiert.
    if ($null -eq $Value -or $Value -eq '') { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq [char]'\') { $backslashes++; continue }
        if ($character -eq [char]'"') {
            [void]$builder.Append([string]::new([char]'\', ($backslashes * 2 + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) { [void]$builder.Append([string]::new([char]'\', $backslashes)); $backslashes = 0 }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) { [void]$builder.Append([string]::new([char]'\', ($backslashes * 2))) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Stop-ProcessTree([int]$ProcessId) {
    # Beendet den Prozess samt aller noch lebenden Nachkommen ueber die Eltern-Kind-Kette. Das greift auch dort,
    # wo ein Kind dem Job entkommen ist oder Windows die Job-Zuordnung verweigert hat.
    try { & taskkill.exe /T /F /PID $ProcessId 2>&1 | Out-Null } catch { }
    try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { }
}

function Invoke-SupervisedProcess {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutSeconds = 0,
        [int]$PollMilliseconds = 500,
        [string]$StdOutPath,
        [string]$StdErrPath,
        [scriptblock]$CancelCheck,
        [scriptblock]$OnTick
    )
    $result = [ordered]@{
        Started  = $false
        Pid      = $null
        ExitCode = $null
        TimedOut = $false
        Cancelled = $false
        Seconds  = 0
    }
    # Kein Start-Process -PassThru: mit umgeleiteten Stroemen liefert PowerShell 5.1 keinen Exitcode.
    # Ein eigener ProcessStartInfo ohne Umleitung gibt den Exitcode zuverlaessig; Werkzeuge schreiben
    # ihre Protokolle selbst (curl -o, pip ueber cmd).
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $started = Get-Date
    try { $process = [System.Diagnostics.Process]::Start($startInfo) } catch { return $result }
    if (-not $process) { return $result }
    $result.Started = $true
    $result.Pid = $process.Id
    # Der Job haelt den gesamten Aufruf zusammen; ohne Job-Bibliothek bleibt es beim gezielten Beenden.
    $job = [IntPtr]::Zero
    $inJob = $false
    $jobApi = [bool](Get-Command New-ProcessJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Add-ProcessToJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Stop-ProcessJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Close-ProcessJob -ErrorAction SilentlyContinue)
    if ($jobApi) {
        $job = New-ProcessJob
        if ($job -ne [IntPtr]::Zero) { $inJob = [bool](Add-ProcessToJob $job $process) }
    }
    $deadline = if ($TimeoutSeconds -gt 0) { $started.AddSeconds($TimeoutSeconds) } else { [datetime]::MaxValue }
    while (-not $process.HasExited) {
        if ($CancelCheck -and (& $CancelCheck)) { $result.Cancelled = $true; break }
        if ((Get-Date) -ge $deadline) { $result.TimedOut = $true; break }
        if ($OnTick) { & $OnTick ([int]((Get-Date) - $started).TotalSeconds) }
        Start-Sleep -Milliseconds ([math]::Max(50, $PollMilliseconds))
    }
    if ($result.Cancelled -or $result.TimedOut) {
        # Ein Zeitlimit oder eine Abbruchbitte gilt fuer den ganzen Aufruf: Werkzeuge wie pip starten
        # eigene Kinder (python), die ein Beenden nur des direkten Prozesses als Waise zurueckliesse.
        # Der Job enthaelt ausschliesslich Prozesse dieses Aufrufs - fremde bleiben unberuehrt.
        # Zuerst ueber die Eltern-Kind-Kette, solange der direkte Prozess noch lebt; der Job raeumt danach nur auf,
        # wenn Windows die Zuordnung angenommen hat (ein leerer Job meldet sonst Erfolg, ohne etwas zu beenden).
        Stop-ProcessTree $process.Id
        if ($inJob) { [void](Stop-ProcessJob $job) }
        try { $process.WaitForExit(5000) | Out-Null } catch { }
    }
    if ($process.HasExited) {
        # In PowerShell 5.1 ist ExitCode erst nach einem abgeschlossenen WaitForExit verlaesslich.
        try { $process.WaitForExit() } catch { }
        try { $result.ExitCode = $process.ExitCode } catch { $result.ExitCode = $null }
    }
    $result.Seconds = [int]((Get-Date) - $started).TotalSeconds
    try { $process.Dispose() } catch { }
    if ($jobApi -and $job -ne [IntPtr]::Zero) { Close-ProcessJob $job }
    return $result
}
function Invoke-CapturedProcess {
    # Fuer Aufrufe, deren Ausgabe der Installer selbst braucht (wsl.exe, wslpath): Ausgabe und Eingabe
    # werden umgeleitet, das Zeitlimit gilt fuer den gesamten Aufruf, und bei Ablauf wird der
    # gestartete Prozess samt Nachkommen beendet.
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @(),
        [int]$TimeoutSeconds = 0,
        [string]$StdIn,
        [int]$PollMilliseconds = 200,
        [scriptblock]$CancelCheck
    )
    $result = [ordered]@{
        Started   = $false
        Pid       = $null
        ExitCode  = $null
        TimedOut  = $false
        Cancelled = $false
        Seconds   = 0
        StdOut    = ''
        StdErr    = ''
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = (@($Arguments | ForEach-Object { ConvertTo-WindowsArgument ([string]$_) }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding $false
    $startInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding $false
    if ($PSBoundParameters.ContainsKey('StdIn')) { $startInfo.RedirectStandardInput = $true }
    $started = Get-Date
    try { $process = [System.Diagnostics.Process]::Start($startInfo) } catch { return $result }
    if (-not $process) { return $result }
    $result.Started = $true
    $result.Pid = $process.Id
    # Der Job haelt den gesamten Aufruf zusammen; ohne Job-Bibliothek bleibt es beim gezielten Beenden.
    $job = [IntPtr]::Zero
    $inJob = $false
    $jobApi = [bool](Get-Command New-ProcessJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Add-ProcessToJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Stop-ProcessJob -ErrorAction SilentlyContinue) -and
        [bool](Get-Command Close-ProcessJob -ErrorAction SilentlyContinue)
    if ($jobApi) {
        $job = New-ProcessJob
        if ($job -ne [IntPtr]::Zero) { $inJob = [bool](Add-ProcessToJob $job $process) }
    }
    # Asynchron lesen, sonst blockiert ein voller Pipe-Puffer den Kindprozess.
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if ($startInfo.RedirectStandardInput) {
        try {
            # UTF-8 bytes, not the console code page (ibm850): a password with umlauts otherwise reached Linux as other bytes.
            if ($StdIn) {
                $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($StdIn)
                $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
                $process.StandardInput.BaseStream.Flush()
            }
            $process.StandardInput.Close()
        } catch { }
    }
    $deadline = if ($TimeoutSeconds -gt 0) { $started.AddSeconds($TimeoutSeconds) } else { [datetime]::MaxValue }
    while (-not $process.HasExited) {
        if ($CancelCheck -and (& $CancelCheck)) { $result.Cancelled = $true; break }
        if ((Get-Date) -ge $deadline) { $result.TimedOut = $true; break }
        Start-Sleep -Milliseconds ([math]::Max(50, $PollMilliseconds))
    }
    if ($result.Cancelled -or $result.TimedOut) {
        # Zuerst ueber die Eltern-Kind-Kette, solange der direkte Prozess noch lebt; der Job raeumt danach nur auf,
        # wenn Windows die Zuordnung angenommen hat (ein leerer Job meldet sonst Erfolg, ohne etwas zu beenden).
        Stop-ProcessTree $process.Id
        if ($inJob) { [void](Stop-ProcessJob $job) }
        try { $process.WaitForExit(5000) | Out-Null } catch { }
    }
    if ($process.HasExited) {
        try { $process.WaitForExit() } catch { }
        try { $result.ExitCode = $process.ExitCode } catch { $result.ExitCode = $null }
    }
    foreach ($pair in @(@('StdOut', $stdoutTask), @('StdErr', $stderrTask))) {
        try { if ($pair[1].Wait(2000)) { $result[$pair[0]] = [string]$pair[1].Result } } catch { }
    }
    $result.Seconds = [int]((Get-Date) - $started).TotalSeconds
    try { $process.Dispose() } catch { }
    if ($jobApi -and $job -ne [IntPtr]::Zero) { Close-ProcessJob $job }
    return $result
}