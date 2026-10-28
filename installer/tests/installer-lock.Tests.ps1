# Prueft die Installersperre: genau ein Lauf, klare Meldung mit PID, keine Blockade nach Abbruch,
# PID-Wiederverwendung wird nicht als laufender Installer verwechselt.
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib\installer-lock.ps1'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$gui = Join-Path $PSScriptRoot '..\install-friday-gui.ps1'
. $lib

if ($script:InstallerAlreadyRunningExitCode -ne 20) { throw 'Exitcode fuer laufende Installation ist nicht 20.' }

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday-lock-" + [guid]::NewGuid().ToString('N'))
$childScript = Join-Path $fixture 'hold-lock.ps1'
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    # --- Ein Prozess: Sperre nehmen, Datei belegen, freigeben, erneut nehmen ---
    $first = Enter-InstallerLock -Root $fixture -RunId 'probe-1' -Mode 'install'
    if (-not $first.Acquired) { throw 'Erster Lauf bekam die Sperre nicht.' }
    if (-not (Test-Path -LiteralPath $first.Path -PathType Leaf)) { throw 'Sperrdatei wurde nicht geschrieben.' }
    $record = Get-Content -LiteralPath $first.Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$record.pid -ne $PID) { throw 'Sperrdatei nennt nicht den eigenen Prozess.' }
    if (-not (ConvertTo-UtcTimestamp ([string]$record.startedUtc))) { throw 'Sperrdatei enthaelt keine lesbare Startzeit.' }
    if ((Format-InstallerLockHolder $record) -notmatch "PID $PID") { throw 'Meldung nennt die laufende PID nicht.' }
    if (-not (Test-InstallerLockHolderAlive $record)) { throw 'Eigener Eintrag gilt nicht als lebend.' }
    Exit-InstallerLock $first
    if (Test-Path -LiteralPath $first.Path) { throw 'Sperrdatei blieb nach der Freigabe liegen.' }
    $again = Enter-InstallerLock -Root $fixture -RunId 'probe-2' -Mode 'install'
    if (-not $again.Acquired) { throw 'Sperre war nach der Freigabe nicht wieder verfuegbar.' }
    Exit-InstallerLock $again

    # --- PID-Wiederverwendung: gleiche PID, andere Startzeit ist kein laufender Installer ---
    $self = Get-Process -Id $PID
    $reused = [pscustomobject]@{
        pid = $PID
        startedUtc = $self.StartTime.ToUniversalTime().AddHours(-3).ToString('o')
    }
    if (Test-InstallerLockHolderAlive $reused) { throw 'Alte PID mit abweichender Startzeit gilt faelschlich als laufend.' }
    $foreign = [pscustomobject]@{ pid = 4; startedUtc = (Get-Date).ToUniversalTime().ToString('o') }
    if (Test-InstallerLockHolderAlive $foreign) { throw 'Tote PID gilt faelschlich als laufend.' }
    if (Test-InstallerLockHolderAlive $null) { throw 'Fehlender Eintrag gilt faelschlich als laufend.' }
    if (Read-InstallerLock (Join-Path $fixture 'fehlt.json')) { throw 'Fehlende Sperrdatei liefert einen Eintrag.' }

    # --- Zwei echte Prozesse: genau einer arbeitet, der andere nennt den Halter ---
    $child = @'
param([string]$Lib, [string]$Root, [string]$Out, [int]$HoldSeconds = 6)
$ErrorActionPreference = 'Stop'
. $Lib
$r = Enter-InstallerLock -Root $Root -RunId 'child' -Mode 'test'
$record = @{
    Acquired  = [bool]$r.Acquired
    HolderPid = $(if ($r.Holder) { [int]$r.Holder.pid } else { 0 })
    HolderMode = $(if ($r.Holder) { [string]$r.Holder.mode } else { '' })
}
[IO.File]::WriteAllText($Out, ($record | ConvertTo-Json))
if ($r.Acquired) {
    Start-Sleep -Seconds $HoldSeconds
    Exit-InstallerLock $r
}
exit 0
'@
    [IO.File]::WriteAllText($childScript, $child, (New-Object System.Text.UTF8Encoding($true)))

    $outA = Join-Path $fixture 'a.json'
    $outB = Join-Path $fixture 'b.json'
    $startChild = {
        param($Out)
        Start-Process -FilePath 'powershell.exe' -PassThru -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$childScript`"",
            '-Lib', "`"$lib`"", '-Root', "`"$fixture`"", '-Out', "`"$Out`"")
    }
    $procA = & $startChild $outA
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath $outA) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $outA)) { throw 'Erster Prozess hat die Sperre nicht gemeldet.' }
    $resultA = Get-Content -LiteralPath $outA -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $resultA.Acquired) { throw 'Erster Prozess bekam die Sperre nicht.' }

    $procB = Start-Process -FilePath 'powershell.exe' -PassThru -Wait -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$childScript`"",
        '-Lib', "`"$lib`"", '-Root', "`"$fixture`"", '-Out', "`"$outB`"")
    if (-not (Test-Path -LiteralPath $outB)) { throw 'Zweiter Prozess hat kein Ergebnis geschrieben.' }
    $resultB = Get-Content -LiteralPath $outB -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($resultB.Acquired) { throw 'Zweiter Prozess arbeitete parallel zum ersten.' }
    if ([int]$resultB.HolderPid -ne [int]$procA.Id) { throw "Zweiter Prozess nennt PID $($resultB.HolderPid) statt $($procA.Id)." }
    if ([int]$resultB.HolderPid -eq [int]$procB.Id) { throw 'Zweiter Prozess nennt sich selbst als Halter.' }

    $procA.WaitForExit(30000) | Out-Null
    if (-not $procA.HasExited) { $procA.Kill(); throw 'Erster Prozess beendete sich nicht.' }
    if ($procA.ExitCode -ne 0) { throw "Erster Prozess endete mit Code $($procA.ExitCode)." }
    if (Test-Path -LiteralPath (Get-InstallerLockPath $fixture)) { throw 'Sperrdatei blieb nach dem Ende des ersten Prozesses liegen.' }

    # Nach dem regulaeren Ende darf sofort erneut gestartet werden (auch nach Prozessende ohne Aufraeumen,
    # weil der Mutex mit dem Prozess freigegeben wird).
    $third = Enter-InstallerLock -Root $fixture -RunId 'probe-3' -Mode 'install'
    if (-not $third.Acquired) { throw 'Sperre blieb nach dem Ende eines Prozesses haengen.' }
    Exit-InstallerLock $third

    # --- Verdrahtung im Installer: Sperre vor jeder Aenderung, Freigabe an den Ausgaengen ---
    $body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
    $lockCall = $body.IndexOf('$InstallerLock = Enter-InstallerLock', [StringComparison]::Ordinal)
    if ($lockCall -lt 0) { throw 'install-friday.ps1 nimmt die Sperre nicht.' }
    if ($body -notmatch [regex]::Escape(". (Join-Path `$PSScriptRoot 'lib\installer-lock.ps1')")) { throw 'installer-lock.ps1 wird nicht geladen.' }
    foreach ($marker in @('if (Get-ScheduledTask -TaskName $ResumeTask', '$StateFile = "$Root\config\install-state.json"',
                          'else { Invoke-LegacyMigration }', 'New-Item -ItemType Directory -Force "$Root\run"')) {
        $position = $body.IndexOf($marker, [StringComparison]::Ordinal)
        if ($position -lt 0) { throw "Marker fehlt im Installer: $marker" }
        if ($position -lt $lockCall) { throw "Sperre kommt zu spaet (nach '$marker')." }
    }
    $stopInstall = $body.Substring($body.IndexOf('function Stop-Install', [StringComparison]::Ordinal),
        $body.IndexOf('function Gui-Answer', [StringComparison]::Ordinal) - $body.IndexOf('function Stop-Install', [StringComparison]::Ordinal))
    if ($stopInstall -notmatch 'Exit-InstallerLock \$InstallerLock') { throw 'Stop-Install gibt die Sperre nicht frei.' }
    if (([regex]::Matches($body, 'Exit-InstallerLock \$InstallerLock')).Count -lt 2) { throw 'Regulaeres Ende gibt die Sperre nicht frei.' }
    if ($body -notmatch 'exit \$script:InstallerAlreadyRunningExitCode') { throw 'Zweiter Start endet nicht mit eigenem Exitcode.' }
    if ($body -notmatch 'if \(-not \$GuiMode -and -not \$Resume\) \{ Read-Host') {
        throw 'Belegter Start wartet auch bei -Resume auf Eingabe (geplante Aufgabe bliebe haengen).'
    }

    $guiBody = Get-Content -LiteralPath $gui -Raw -Encoding UTF8
    if ($guiBody -notmatch '\$exitCode -eq 20') { throw 'GUI unterscheidet den Exitcode 20 nicht von einem Fehler.' }
    if ($guiBody -notmatch 'Es läuft bereits eine Installation') { throw 'GUI nennt den laufenden Lauf nicht.' }

    Write-Host 'Installersperre: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}