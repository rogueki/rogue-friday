# Zeitlimit fuer wsl.exe: jeder Aufruf, dessen Ausgabe der Installer selbst braucht, laeuft ueber
# Invoke-CapturedProcess. Geprueft werden der Helfer selbst (Ausgabe, Eingabe, Zeitlimit, Abbruch,
# gezieltes Beenden) und die Verdrahtung im Installer.
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PSScriptRoot '..\lib\process-supervisor.ps1'
. $lib
$script = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\install-friday.ps1'))
$cmd = Join-Path $env:SystemRoot 'System32\cmd.exe'

# --- Ausgabe und Exitcode
$echo = Invoke-CapturedProcess -FilePath $cmd -Arguments @('/c', 'echo hallo welt') -TimeoutSeconds 30
if (-not $echo.Started) { throw 'Prozess wurde nicht gestartet.' }
if ($echo.ExitCode -ne 0) { throw "Exitcode war $($echo.ExitCode) statt 0." }
if ($echo.StdOut.Trim() -ne 'hallo welt') { throw "Ausgabe war '$($echo.StdOut.Trim())'." }
if ($echo.TimedOut) { throw 'Ein schneller Aufruf galt als Zeitueberschreitung.' }

# --- Exitcode des Kindes wird durchgereicht
$fail = Invoke-CapturedProcess -FilePath $cmd -Arguments @('/c', 'exit 7') -TimeoutSeconds 30
if ($fail.ExitCode -ne 7) { throw "Exitcode 7 wurde nicht durchgereicht: $($fail.ExitCode)" }

# --- Standardeingabe
$stdin = Invoke-CapturedProcess -FilePath $cmd -Arguments @('/c', 'more') -TimeoutSeconds 30 -StdIn "zeile-eins`nzeile-zwei`n"
if ($stdin.StdOut -notmatch 'zeile-eins' -or $stdin.StdOut -notmatch 'zeile-zwei') { throw "Eingabe kam nicht an: '$($stdin.StdOut)'" }

# --- Zeitlimit beendet nur den gestarteten Prozess
$sibling = Start-Process -FilePath $cmd -ArgumentList @('/c', 'ping -n 20 127.0.0.1 > nul') -PassThru -WindowStyle Hidden
try {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $slow = Invoke-CapturedProcess -FilePath $cmd -Arguments @('/c', 'ping -n 20 127.0.0.1 > nul') -TimeoutSeconds 2 -PollMilliseconds 100
    $watch.Stop()
    if (-not $slow.TimedOut) { throw 'Haengender Aufruf galt nicht als Zeitueberschreitung.' }
    if ($slow.Seconds -gt 10) { throw "Zeitlimit griff erst nach $($slow.Seconds) s." }
    if (-not $sibling.HasExited -and $sibling.Id) {
        $still = Get-Process -Id $sibling.Id -ErrorAction SilentlyContinue
        if (-not $still) { throw 'Der fremde Prozess wurde mitbeendet.' }
    }
} finally { try { Stop-Process -Id $sibling.Id -Force -ErrorAction SilentlyContinue } catch { } }

# --- Abbruchbitte wirkt waehrend des Laufs
$counter = 0
$cancel = Invoke-CapturedProcess -FilePath $cmd -Arguments @('/c', 'ping -n 20 127.0.0.1 > nul') -TimeoutSeconds 60 -PollMilliseconds 100 -CancelCheck { $script:counter++; $script:counter -ge 3 }
if (-not $cancel.Cancelled) { throw 'Abbruchbitte wurde nicht erkannt.' }
if ($cancel.TimedOut) { throw 'Abbruch wurde als Zeitueberschreitung gemeldet.' }

# --- Verdrahtung: kein ungebundener Aufruf fuer Ausgaben des Installers
if ($script -match '& wsl\.exe') { throw 'Es gibt noch einen direkten wsl.exe-Aufruf ohne Zeitlimit.' }
$expected = @{
    'Wsl-Run'          = "-TimeoutSeconds `$TimeoutSeconds"
    'Get-WslPath'      = "-TimeoutSeconds 60"
    'Pfadumwandlung'   = "-Arguments @('-d', `$Distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', `$WindowsPath) -TimeoutSeconds 60"
    'whoami'           = "-Arguments @('-d', `$Distro, '--exec', 'whoami') -TimeoutSeconds 60"
    'init'             = "-Arguments @('-d', `$Distro, '--exec', 'ps', '-p', '1', '-o', 'comm=') -TimeoutSeconds 60"
    'TTS-Installation' = "-TimeoutSeconds 1800 -CancelCheck"
    'Verteilte Liste'  = "-Arguments @('-l', '-q') -TimeoutSeconds 120"
}
foreach ($name in $expected.Keys) {
    if (-not $script.Contains($expected[$name])) { throw "Verdrahtung fehlt: $name ($($expected[$name]))." }
}
# Bewusste Ausnahme: die vier Einrichtungsaufrufe von WSL selbst (Feature, Update, Distributionsdownload)
# laufen ueber Native, weil sie ihren Fortschritt live schreiben. Sie sind hier festgenagelt, damit kein
# weiterer Aufruf unbemerkt ohne Limit dazukommt.
$native = ([regex]::Matches($script, 'Native \{ wsl\.exe')).Count
if ($native -ne 4) { throw "Ungebundene WSL-Einrichtungsaufrufe: $native (erwartet 4)." }
if ($script -notmatch 'Native \{ wsl\.exe --install Ubuntu-24\.04 --name \$Distro --no-launch --web-download \}') {
    throw 'Der Distributionsdownload ohne eigenes Verzeichnis fehlt oder wurde umgebaut - Limit pruefen.'
}

Write-Host 'wsl.exe-Zeitlimits: PASS'