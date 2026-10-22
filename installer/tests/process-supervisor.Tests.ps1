# Ueberwachte Unterprozesse: Quotierung, Exitcode, hartes Zeitlimit, Abbruchbitte und gezieltes
# Beenden - nachgewiesen mit echten Kindprozessen.
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib\process-supervisor.ps1'
. $lib
# Job-Objekte gehoeren zum echten Aufbau des Supervisors (Enkelprozesse beenden).
. (Join-Path $PSScriptRoot '..\lib\job-object.ps1')

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday supervisor-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    # --- Quotierung nach CreateProcess-Regeln
    if ((ConvertTo-WindowsArgument 'einfach') -ne 'einfach') { throw 'Einfaches Argument wurde veraendert.' }
    if ((ConvertTo-WindowsArgument '') -ne '""') { throw 'Leeres Argument wurde nicht zitiert.' }
    if ((ConvertTo-WindowsArgument 'Ziel ordner ü') -ne '"Ziel ordner ü"') { throw 'Leerzeichen/Umlaut wurden nicht zitiert.' }
    if ((ConvertTo-WindowsArgument 'C:\Pfad mit\Leerzeichen\') -ne '"C:\Pfad mit\Leerzeichen\\"') { throw 'Abschliessender Backslash wurde nicht verdoppelt.' }
    if ((ConvertTo-WindowsArgument 'sag "hallo"') -ne '"sag \"hallo\""') { throw "Anfuehrungszeichen wurden falsch maskiert: $(ConvertTo-WindowsArgument 'sag "hallo"')" }
    # Der Beweis, dass die Quotierung wirklich durch den Prozessstart kommt: ein Kindprozess schreibt
    # seine Argumente zurueck, inklusive Leerzeichen, Umlaut und Anfuehrungszeichen.
    $echo = Join-Path $fixture 'echo.ps1'
    [IO.File]::WriteAllText($echo, "param([Parameter(ValueFromRemainingArguments=`$true)]`$rest)`r`n[IO.File]::WriteAllText(`$env:SUPERVISOR_ECHO, (`$rest -join '|'))`r`n", (New-Object System.Text.UTF8Encoding($false)))
    $echoOut = Join-Path $fixture 'echo.txt'
    $env:SUPERVISOR_ECHO = $echoOut
    $values = @('eins', 'Ziel ordner ü', 'sag "hallo"', 'C:\Pfad mit\Leerzeichen\')
    $echoRun = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 60 `
        -Arguments (@('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $echo) + $values)
    if (-not $echoRun.Started -or $echoRun.ExitCode -ne 0) { throw "Echo-Prozess endete nicht sauber (Exitcode $($echoRun.ExitCode))." }
    $echoed = Get-Content -LiteralPath $echoOut -Raw -Encoding UTF8
    if ($echoed.Trim() -ne ($values -join '|')) { throw "Argumente kamen veraendert an: '$($echoed.Trim())'" }
    Remove-Item Env:\SUPERVISOR_ECHO -ErrorAction SilentlyContinue

    # --- Normaler Lauf: Exitcode wird gemeldet, Ausgabe schreibt das Werkzeug selbst
    $marker = Join-Path $fixture 'verlauf.txt'
    $ok = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 60 `
        -Arguments @('-NoProfile', '-Command', "Set-Content -LiteralPath '$marker' -Value 'hallo'; exit 7")
    if ($ok.ExitCode -ne 7) { throw "Exitcode wurde nicht gemeldet (war $($ok.ExitCode))." }
    if ($ok.TimedOut -or $ok.Cancelled) { throw 'Normaler Lauf wurde faelschlich als Abbruch gewertet.' }
    if ((Get-Content -LiteralPath $marker -Raw) -notmatch 'hallo') { throw 'Der Prozess hat seine Arbeit nicht ausgefuehrt.' }

    # --- Hartes Zeitlimit: der Prozess wird beendet, ein fremder Bruderprozess ueberlebt
    $sibling = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 120') -PassThru -WindowStyle Hidden
    try {
        $slow = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 2 -PollMilliseconds 200 `
            -Arguments @('-NoProfile', '-Command', 'Start-Sleep -Seconds 120')
        if (-not $slow.TimedOut) { throw 'Zeitlimit hat nicht gegriffen.' }
        if (Get-Process -Id $slow.Pid -ErrorAction SilentlyContinue) { throw 'Zeitlimit hat den Prozess nicht beendet.' }
        if (-not (Get-Process -Id $sibling.Id -ErrorAction SilentlyContinue)) { throw 'Zeitlimit hat einen fremden Prozess mitgerissen.' }
        # --- Abbruchbitte wirkt waehrend des Laufs
        $script:cancel = $false
        $cancelled = Invoke-SupervisedProcess -FilePath 'powershell.exe' -TimeoutSeconds 60 -PollMilliseconds 200 `
            -Arguments @('-NoProfile', '-Command', 'Start-Sleep -Seconds 120') -CancelCheck { $script:polls++; return ($script:polls -ge 3) }
        if (-not $cancelled.Cancelled) { throw 'Abbruch waehrend des Laufs wurde nicht gemeldet.' }
        if (Get-Process -Id $cancelled.Pid -ErrorAction SilentlyContinue) { throw 'Abbruch hat den Prozess nicht beendet.' }
        if (-not (Get-Process -Id $sibling.Id -ErrorAction SilentlyContinue)) { throw 'Abbruch hat einen fremden Prozess mitgerissen.' }
    } finally {
        Stop-Process -Id $sibling.Id -Force -ErrorAction SilentlyContinue
    }

        # --- Verdrahtung im Installer: Download mit Zeitlimit und Abbruchbitte, pip mit gezieltem Beenden
    $installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
    $body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
    if ($body -notmatch "lib\\process-supervisor\.ps1") { throw 'Installer bindet den Supervisor nicht ein.' }
    if ($body -notmatch '\$script:DownloadTimeoutSeconds = \d+') { throw 'Kein Zeitlimit fuer Downloads definiert.' }
    $downloadBody = $body.Substring($body.IndexOf('function Download(', [StringComparison]::Ordinal), 1200)
    if ($downloadBody -notmatch 'Invoke-SupervisedProcess') { throw 'Download laeuft nicht ueberwacht.' }
    if ($downloadBody -notmatch 'CancelCheck') { throw 'Download prueft die Abbruchbitte waehrend des Laufs nicht.' }
    if ($downloadBody -notmatch 'TimedOut') { throw 'Download meldet ein Zeitlimit nicht.' }
    if ($downloadBody -match 'curl\.exe.*\n.*\$LASTEXITCODE') { throw 'Download startet curl weiterhin unueberwacht.' }
    $pipBody = $body.Substring($body.IndexOf('function Invoke-Pip(', [StringComparison]::Ordinal), 3600)
    # pip laeuft jetzt in einem Job-Objekt: der Abbruch beendet den ganzen Aufruf (cmd + python), ohne
    # fremde Prozesse anzutasten. Der gezielte Griff auf cmd bleibt nur der Rueckfall ohne Job-Unterstuetzung.
    if ($pipBody -notmatch 'New-ProcessJob') { throw 'pip laeuft nicht in einem Job-Objekt.' }
    if ($pipBody -notmatch 'Add-ProcessToJob') { throw 'pip ordnet den Prozess dem Job nicht zu.' }
    if ($pipBody -notmatch 'Stop-ProcessJob') { throw 'pip beendet den Job bei Abbruch nicht.' }
    if ($pipBody -notmatch 'Close-ProcessJob') { throw 'pip gibt das Job-Handle nicht frei.' }
    if ($pipBody -match 'taskkill\.exe') { throw 'pip beendet weiterhin den ganzen Baum.' }

    Write-Host 'Ueberwachte Unterprozesse: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday supervisor-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}