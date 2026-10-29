# Enkelprozesse: ein Zeitlimit oder eine Abbruchbitte muss den ganzen Aufruf beenden, nicht nur den
# direkten Prozess. Sonst laeuft ein abgebrochener pip-Lauf als Waise weiter und schreibt das venv
# halb fertig. Geprueft wird das mit einem echten Prozessbaum (powershell -> ping).
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib'
. (Join-Path $lib 'job-object.ps1')
. (Join-Path $lib 'process-supervisor.ps1')

function Wait-PidFile([string]$Path, [int]$Seconds = 15) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        if (Test-Path -LiteralPath $Path) {
            $value = (Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue)
            if ($value -and $value.Trim() -match '^\d+$') { return [int]$value.Trim() }
        }
        Start-Sleep -Milliseconds 200
    }
    return 0
}

function Test-Alive([int]$ProcessId) {
    if (-not $ProcessId) { return $false }
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Stop-Quietly([int]$ProcessId) {
    if (-not $ProcessId) { return }
    try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { }
}

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-job-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$leftovers = New-Object System.Collections.ArrayList
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    $parentScript = Join-Path $fixture 'parent.ps1'
    $parentBody = @'
param([string]$PidFile)
$child = Start-Process -FilePath 'ping.exe' -ArgumentList '-n','40','127.0.0.1' -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $PidFile -Value $child.Id
Start-Sleep -Seconds 60
'@
    [IO.File]::WriteAllText($parentScript, ($parentBody -replace "`r`n","`n" -replace "`n","`r`n"), (New-Object System.Text.UTF8Encoding($true)))

    # 1) Zeitlimit: der ganze Baum muss enden.
    $pidFile = Join-Path $fixture 'child-timeout.pid'
    $run = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 4 -PollMilliseconds 200 `
        -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $parentScript, $pidFile)
    if (-not $run.Started) { throw 'Der ueberwachte Prozess wurde nicht gestartet.' }
    if (-not $run.TimedOut) { throw "Das Zeitlimit griff nicht (Exitcode $($run.ExitCode), $($run.Seconds) s)." }
    $grandchild = Wait-PidFile $pidFile
    if (-not $grandchild) { throw 'Der Enkelprozess hat seine PID nicht geschrieben.' }
    [void]$leftovers.Add($grandchild)
    Start-Sleep -Seconds 2
    if (Test-Alive $grandchild) { throw "Der Enkelprozess (PID $grandchild) laeuft nach dem Zeitlimit weiter." }

    # 2) Abbruchbitte waehrend der Arbeit: derselbe Baum, andere Ursache. Die Bitte kommt erst nach
    # einigen Sekunden, damit der Enkelprozess nachweislich schon laeuft.
    $pidFile2 = Join-Path $fixture 'child-cancel.pid'
    $cancelAt = (Get-Date).AddSeconds(5)
    $run2 = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 0 -PollMilliseconds 200 `
        -CancelCheck { (Get-Date) -ge $cancelAt } `
        -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $parentScript, $pidFile2)
    if (-not $run2.Cancelled) { throw 'Die Abbruchbitte wurde nicht als Abbruch gemeldet.' }
    $grandchild2 = Wait-PidFile $pidFile2
    if (-not $grandchild2) { throw 'Der Enkelprozess des Abbruchlaufs hat seine PID nicht geschrieben.' }
    [void]$leftovers.Add($grandchild2)
    Start-Sleep -Seconds 2
    if (Test-Alive $grandchild2) { throw "Der Enkelprozess (PID $grandchild2) laeuft nach der Abbruchbitte weiter." }

    # 3) Gegenprobe: ohne Job bleibt der Enkel am Leben, wenn nur der direkte Prozess endet.
    $pidFile3 = Join-Path $fixture 'child-control.pid'
    $control = Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $parentScript, $pidFile3)
    [void]$leftovers.Add($control.Id)
    $grandchild3 = Wait-PidFile $pidFile3
    if (-not $grandchild3) { throw 'Der Kontrolllauf hat keine PID geschrieben.' }
    [void]$leftovers.Add($grandchild3)
    Stop-Quietly $control.Id
    Start-Sleep -Seconds 2
    if (-not (Test-Alive $grandchild3)) {
        throw 'Die Gegenprobe zeigt keinen Unterschied: ohne Job endete der Enkel ebenfalls (Testannahme pruefen).'
    }
    Stop-Quietly $grandchild3

    # 3b) Verweigerte Job-Zuordnung (Installer laeuft selbst in einem fremden Job): das Zeitlimit muss den Baum
    # trotzdem beenden. Simuliert, indem die Zuordnung hier scheitert.
    function Add-ProcessToJob([IntPtr]$Job, $Process) { return $false }
    $pidFile4 = Join-Path $fixture 'child-nojob.pid'
    $run4 = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 4 -PollMilliseconds 200 `
        -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $parentScript, $pidFile4)
    if (-not $run4.TimedOut) { throw 'Das Zeitlimit griff ohne Job-Zuordnung nicht.' }
    [void]$leftovers.Add($run4.Pid)
    $grandchild4 = Wait-PidFile $pidFile4
    if (-not $grandchild4) { throw 'Der Enkelprozess ohne Job hat seine PID nicht geschrieben.' }
    [void]$leftovers.Add($grandchild4)
    Start-Sleep -Seconds 2
    if (Test-Alive $run4.Pid) { throw "Der direkte Prozess (PID $($run4.Pid)) laeuft ohne Job-Zuordnung nach dem Zeitlimit weiter." }
    if (Test-Alive $grandchild4) { throw "Der Enkelprozess (PID $grandchild4) laeuft ohne Job-Zuordnung nach dem Zeitlimit weiter." }
    . (Join-Path $lib 'job-object.ps1')

    # 4) Die Bibliothek selbst: Handle, Zuordnung, Beenden, Schliessen.
    $job = New-ProcessJob
    if ($job -eq [IntPtr]::Zero) { throw 'New-ProcessJob lieferte kein Handle.' }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'ping.exe'
    $startInfo.Arguments = '-n 40 127.0.0.1'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    [void]$leftovers.Add($process.Id)
    if (-not (Add-ProcessToJob $job $process)) { throw 'Der Prozess liess sich dem Job nicht zuordnen.' }
    if (-not (Stop-ProcessJob $job)) { throw 'Der Job liess sich nicht beenden.' }
    Close-ProcessJob $job
    Start-Sleep -Seconds 1
    if (Test-Alive $process.Id) { throw 'Der Prozess des beendeten Jobs laeuft weiter.' }

    Write-Host 'Enkelprozesse im Job: PASS'
} finally {
    foreach ($leftoverPid in $leftovers) { Stop-Quietly $leftoverPid }
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday-job-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}