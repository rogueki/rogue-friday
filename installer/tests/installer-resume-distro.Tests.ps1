# Prueft am echten Einstiegspunkt, dass ein fortgesetzter Lauf Distribution und Ablageort aus dem
# gespeicherten Zustand uebernimmt und bei Abweichung abbricht, bevor irgendetwas an WSL passiert.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'

$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday resume-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$root = Join-Path $fixture 'Ziel ordner ü'
$distroLocation = Join-Path $fixture 'distro ablage'
$otherLocation = Join-Path $fixture 'andere ablage'

function Invoke-Installer([string]$Tag, [string[]]$Extra = @()) {
    $stdout = Join-Path $fixture "$Tag.out.txt"
    $stderr = Join-Path $fixture "$Tag.err.txt"
    $arguments = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$root`" -UpdateDashboard"
    foreach ($extra in $Extra) { $arguments += " $extra" }
    & cmd.exe /c "$arguments < nul > `"$stdout`" 2> `"$stderr`""
    return @{
        Code = $LASTEXITCODE
        Out = (Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
        Err = (Get-Content -LiteralPath $stderr -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
    }
}

try {
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'config') | Out-Null
    New-Item -ItemType Directory -Force -Path $distroLocation | Out-Null
    New-Item -ItemType Directory -Force -Path $otherLocation | Out-Null

    $state = [ordered]@{
        done            = @('preflight')
        distro_name     = 'FRIDAY-Test'
        distro_location = $distroLocation
        ports           = @{ Dashboard = 45001; Qwen = 45002; HermesApi = 45003; Voice = 45004; CommandCenter = 45010 }
        assistant_name  = 'Friday'
        wake_phrase     = 'Hey Friday'
    }
    $stateFile = Join-Path $root 'config\install-state.json'
    [IO.File]::WriteAllText($stateFile, ($state | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))

    # Ohne -DistroName: der Zustand muss gelten. Der Lauf endet an der naechsten Pruefung
    # (unvollstaendige Installation fuer ein gezieltes Update), nicht an der Distribution.
    $resumed = Invoke-Installer -Tag 'resume'
    if ($resumed.Code -ne 1) { throw "Fortsetzung endete mit Code $($resumed.Code) statt 1. Ausgabe: $($resumed.Out) $($resumed.Err)" }
    if ($resumed.Out -notmatch 'unvollstaendig') { throw "Fortsetzung erreichte die erwartete Pruefung nicht: $($resumed.Out)" }
    if ($resumed.Out -match 'widersprechen dem gespeicherten Zustand') { throw 'Fortsetzung verwarf den gespeicherten Ablageort.' }
    if ($resumed.Out -match 'Schritt 7|wsl\.exe') { throw 'Fortsetzung hat die WSL-Schritte begonnen.' }
    if (Test-Path -LiteralPath (Join-Path $root 'run\installer.lock.json')) { throw 'Sperrdatei blieb nach dem Abbruch liegen.' }
    if (Test-Path -LiteralPath (Join-Path $root 'run\installer.active')) { throw 'Aktivmarkierung blieb nach dem Abbruch liegen.' }

    # Mit abweichendem -DistroName: klarer Abbruch, keine stille Umleitung auf eine andere Distribution.
    $conflict = Invoke-Installer -Tag 'konflikt' -Extra @("-DistroName `"FRIDAY-Anders`"", "-DistroLocation `"$otherLocation`"")
    if ($conflict.Code -ne 1) { throw "Konfliktlauf endete mit Code $($conflict.Code) statt 1. Ausgabe: $($conflict.Out)" }
    if ($conflict.Out -notmatch 'widersprechen dem gespeicherten Zustand') { throw "Abweichende Distribution brach nicht mit Klartext ab: $($conflict.Out)" }
    if ($conflict.Out -notmatch 'FRIDAY-Test') { throw 'Abbruch nennt den gespeicherten Distributionsnamen nicht.' }
    if ($conflict.Out -match 'wsl\.exe') { throw 'Abbruch hat noch WSL aufgerufen.' }

    # Der Zustand bleibt unveraendert lesbar (kein Lauf hat ihn ueberschrieben).
    $after = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($after.distro_name -ne 'FRIDAY-Test' -or @($after.done).Count -ne 1) { throw 'Der gespeicherte Zustand wurde durch die abgebrochenen Laeufe veraendert.' }

    # Der Abbruch hinterlaesst einen Fortsetzungsbefehl. Er muss Distribution und Ablageort korrekt
    # zitieren - und in dieser Form auch wirklich laufen.
    $resumeBat = Join-Path $root 'resume.bat'
    if (-not (Test-Path -LiteralPath $resumeBat -PathType Leaf)) { throw "Stop-Install hat keinen Fortsetzungsbefehl geschrieben (Inhalt: $((Get-ChildItem -LiteralPath $root -Force).Name -join ', '); Ausgabe: $($resumed.Out) $($resumed.Err))" }
    $resumeText = Get-Content -LiteralPath $resumeBat -Raw -Encoding UTF8
    # Der Zielordner steht bewusst nicht woertlich in der Datei: sie wechselt in den eigenen Ordner und
    # uebergibt %CD%. Damit sind &, %, ! und Umlaute im Pfad entschaerft, und der Ordner darf verschoben werden.
    if ($resumeText -notmatch 'cd /d "%~dp0"') { throw "Fortsetzungsbefehl wechselt nicht in den eigenen Ordner: $resumeText" }
    if ($resumeText -notmatch '-InstallRoot "%CD%"') { throw "Fortsetzungsbefehl uebergibt den Zielordner nicht als %CD%: $resumeText" }
    if ($resumeText -match [regex]::Escape($root)) { throw "Fortsetzungsbefehl enthaelt den Zielordner woertlich und bleibt damit fuer Sonderzeichen anfaellig: $resumeText" }
    if ($resumeText -notmatch '-Resume') { throw 'Fortsetzungsbefehl setzt den Lauf nicht fort.' }
    if ($resumeText -notmatch [regex]::Escape('FRIDAY-Test')) { throw "Fortsetzungsbefehl nennt die Distribution nicht: $resumeText" }
    if ($resumeText -match [regex]::Escape('"Ubuntu"')) { throw "Fortsetzungsbefehl leitet auf die Standarddistribution um: $resumeText" }

    $resumeOut = Join-Path $fixture 'resume-bat.out.txt'
    $resumeErr = Join-Path $fixture 'resume-bat.err.txt'
    # Den .bat-Befehl so ausfuehren, wie ein Doppelklick es taete (cmd liest die Datei in der OEM-Codepage).
    & cmd.exe /c "`"$resumeBat`" < nul > `"$resumeOut`" 2> `"$resumeErr`""
    $resumeCode = $LASTEXITCODE
    $resumeOutput = Get-Content -LiteralPath $resumeOut -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($resumeCode -ne 1) { throw "resume.bat endete mit Code $resumeCode statt 1. Ausgabe: $resumeOutput $(Get-Content -LiteralPath $resumeErr -Raw -ErrorAction SilentlyContinue)" }
    # Entscheidend: der Befehl findet den Zustand wieder (sonst kaeme der Hinweis auf eine frische
    # Installation) und stoppt an einer bekannten sicheren Pruefung: fremde Installation mit eigenen
    # Aufgaben, unvollstaendiger Zustand oder (ohne NVIDIA-GPU) die GPU-Pruefung fuer lokale Sprache.
    if ($resumeOutput -match 'Frische Installation|Keine bestehende Installation') {
        throw "resume.bat hat den gespeicherten Zustand nicht gefunden: $resumeOutput"
    }
    if ($resumeOutput -notmatch 'unvollstaendig|gehoert zu einem anderen Installationspfad|Lokale Sprache erfordert eine NVIDIA-GPU') {
        throw "resume.bat erreichte keine erwartete Pruefung: $resumeOutput"
    }

    Write-Host 'Fortsetzung mit gespeicherter Distribution: PASS'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday resume-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}