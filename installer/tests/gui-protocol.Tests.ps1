# Ereignisstrom (Protokoll 2): Der Installer meldet Schritte, Downloads und Pakete als je eine
# JSON-Zeile. Geprueft werden Erzeugung, Robustheit beim Lesen und die Verdrahtung beider Seiten.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..\install-friday.ps1'
$gui = Join-Path $PSScriptRoot '..\install-friday-gui.ps1'
$lib = Join-Path $PSScriptRoot '..\lib\gui-protocol.ps1'
. $lib

# --- Erzeugung
$line = ConvertTo-GuiEventLine @{ type = 'step'; state = 'start'; step = 'distro'; text = "Ubuntu 24.04 – Umlaute: äöüß, Quote: `"x`", Backslash: \ " }
if (($line -split "`n").Count -ne 1) { throw 'Ereignis geht ueber mehrere Zeilen.' }
if ($line -notmatch '^\[FRIDAY-EVENT\]\{') { throw "Praefix fehlt: $line" }
$parsed = $line.Substring('[FRIDAY-EVENT]'.Length) | ConvertFrom-Json
if ([int]$parsed.v -ne 2) { throw "Protokollversion ist $($parsed.v) statt 2." }
if ($parsed.type -ne 'step' -or $parsed.step -ne 'distro' -or $parsed.state -ne 'start') { throw 'Felder wurden nicht uebernommen.' }
if ($parsed.text -notmatch 'äöüß' -or $parsed.text -notmatch 'Quote: "x"') { throw "Umlaute/Quotes wurden verstuemmelt: $($parsed.text)" }

# --- Lesen
$roundTrip = ConvertFrom-GuiEventLine $line
if ($roundTrip.Kind -ne 'event') { throw 'Eigenes Ereignis wurde nicht erkannt.' }
if ($roundTrip.Event.step -ne 'distro') { throw 'Ereignisfeld ging beim Lesen verloren.' }

foreach ($case in @(
    @{ name = 'Klartextzeile'; line = 'Schritt 7/15 – Ubuntu 24.04 installieren' },
    @{ name = 'leere Zeile'; line = '' },
    @{ name = 'Praefix ohne JSON'; line = '[FRIDAY-EVENT]' },
    @{ name = 'kaputtes JSON'; line = '[FRIDAY-EVENT]{"v":2,"type":"step"' },
    @{ name = 'Zeilenfragment'; line = '[FRIDAY-EVENT]{"v":2,"type":"ste' },
    @{ name = 'unbekannte Version'; line = '[FRIDAY-EVENT]{"v":3,"type":"step","state":"start"}' },
    @{ name = 'fehlende Version'; line = '[FRIDAY-EVENT]{"type":"step"}' },
    @{ name = 'Version als Text'; line = '[FRIDAY-EVENT]{"v":"zwei","type":"step"}' },
    @{ name = 'kein Objekt'; line = '[FRIDAY-EVENT]42' }
)) {
    $result = ConvertFrom-GuiEventLine $case.line
    if ($result.Kind -ne 'text') { throw "Fall '$($case.name)' wurde faelschlich als Ereignis gelesen." }
    if ($result.Text -ne $case.line) { throw "Fall '$($case.name)' hat den Text veraendert." }
}

# --- Schreiben nur im GUI-Lauf
$env:FRIDAY_INSTALL_RUN = ''
$captured = & { Write-GuiEvent 'step' @{ state = 'start'; step = 'x' } } 6>&1 | Out-String
if ($captured -match 'FRIDAY-EVENT') { throw 'Ohne GUI-Lauf wurde ein Ereignis geschrieben.' }
$env:FRIDAY_INSTALL_RUN = 'protokoll-test'
$captured = & { Write-GuiEvent 'step' @{ state = 'start'; step = 'x' } } 6>&1 | Out-String
if ($captured -notmatch 'FRIDAY-EVENT') { throw 'Im GUI-Lauf wurde kein Ereignis geschrieben.' }
Remove-Item Env:\FRIDAY_INSTALL_RUN -ErrorAction SilentlyContinue

# --- Verdrahtung Installer: jeder Schritt meldet Start, MarkDone meldet Ende
$body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
if ($body -notmatch "lib\\gui-protocol\.ps1") { throw 'Installermodul bindet den Ereignisstrom nicht ein.' }
if ($body -notmatch "Write-GuiEvent 'step' @\{ state = 'start'; step = \`$Name \}") { throw 'Enter-Step meldet keinen Start.' }
if ($body -notmatch "Write-GuiEvent 'step' @\{ state = 'done'; step = \`$n \}") { throw 'MarkDone meldet kein Ende.' }
if ($body -notmatch "Write-GuiEvent 'download'") { throw 'Downloads werden nicht gemeldet.' }
if ($body -notmatch "Write-GuiEvent 'pip'") { throw 'Paketinstallationen werden nicht gemeldet.' }
$stepBlocks = [regex]::Matches($body, "if \(-not \(IsDone '([a-z]+)'\)[^\r\n]*\{\r\n    (Enter-Step '([a-z]+)')")
if ($stepBlocks.Count -lt 15) { throw "Es wurden nur $($stepBlocks.Count) Schritte mit Ereignismeldung gefunden." }
foreach ($match in $stepBlocks) {
    if ($match.Groups[1].Value -ne $match.Groups[3].Value) {
        throw "Schritt meldet den falschen Namen: $($match.Groups[1].Value) -> $($match.Groups[3].Value)"
    }
}

# --- Verdrahtung GUI: kein Rohdurchgriff mehr, Ereignisse werden gezeigt
$guiBody = Get-Content -LiteralPath $gui -Raw -Encoding UTF8
if ($guiBody -notmatch "lib\\gui-protocol\.ps1") { throw 'GUI bindet den Ereignisstrom nicht ein.' }
if ($guiBody -match 'Append-Log \$task\.Result') { throw 'GUI schreibt Rohzeilen weiter direkt ins Protokoll.' }
if (([regex]::Matches($guiBody, 'Receive-BackendLine \$task\.Result')).Count -ne 2) { throw 'Nicht beide Ausgabestroeme laufen ueber den Ereignisleser.' }
if ($guiBody -notmatch "ConvertFrom-GuiEventLine") { throw 'GUI liest keine Ereignisse.' }
if ($guiBody -match 'Percent|\d+ ?%') { throw 'GUI rechnet Prozent aus Text.' }

# --- Echter Einstiegspunkt im GUI-Lauf: mindestens ein Ereignis, jede Ereigniszeile lesbar
$fixture = Join-Path ([IO.Path]::GetTempPath()) ("friday protocol-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $root = Join-Path $fixture 'Ziel ordner ü'
    New-Item -ItemType Directory -Force -Path (Join-Path $root 'config') | Out-Null
    $distroLocation = Join-Path $fixture 'distro ablage'
    New-Item -ItemType Directory -Force -Path $distroLocation | Out-Null
    $state = [ordered]@{
        done = @('preflight'); distro_name = 'FRIDAY-Test'; distro_location = $distroLocation
        ports = @{ Dashboard = 45001; Qwen = 45002; HermesApi = 45003; Voice = 45004; CommandCenter = 45010 }
        assistant_name = 'Friday'; wake_phrase = 'Hey Friday'
    }
    [IO.File]::WriteAllText((Join-Path $root 'config\install-state.json'), ($state | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    $stdout = Join-Path $fixture 'out.txt'; $stderr = Join-Path $fixture 'err.txt'
    $env:FRIDAY_INSTALL_RUN = 'protocol-e2e'
    & cmd.exe /c "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installer`" -InstallRoot `"$root`" -UpdateDashboard < nul > `"$stdout`" 2> `"$stderr`""
    $code = $LASTEXITCODE
    $output = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
    if ($code -ne 1) { throw "Lauf endete mit Code $code statt 1. Ausgabe: $output" }
    $eventLines = @(($output -split "`r?`n") | Where-Object { $_ -match '^\[FRIDAY-EVENT\]' })
    if ($eventLines.Count -lt 1) { throw "Der GUI-Lauf meldete kein einziges Ereignis: $output" }
    foreach ($eventLine in $eventLines) {
        $read = ConvertFrom-GuiEventLine $eventLine
        if ($read.Kind -ne 'event') { throw "Ereigniszeile nicht lesbar: $eventLine" }
    }
    $events = @($eventLines | ForEach-Object { (ConvertFrom-GuiEventLine $_).Event })
    $runEvent = $events | Where-Object { $_.type -eq 'run' -and $_.state -eq 'start' } | Select-Object -First 1
    if (-not $runEvent) { throw 'Kein Laufereignis gemeldet.' }
    if ("$($runEvent.run)" -ne 'protocol-e2e') { throw "Laufereignis nennt die falsche Kennung: $($runEvent.run)" }
    if ("$($runEvent.mode)" -ne 'update-dashboard') { throw "Laufereignis nennt den falschen Modus: $($runEvent.mode)" }
    # Der Lauf endet hier mit einem Fehler: genau ein Abschlussereignis mit Code 1.
    $closingEvents = @($events | Where-Object { $_.type -eq 'run' -and $_.state -ne 'start' })
    if ($closingEvents.Count -ne 1) { throw "Es wurden $($closingEvents.Count) Abschlussereignisse gemeldet statt genau einem." }
    if ("$($closingEvents[0].state)" -ne 'failed' -or [int]$closingEvents[0].exitCode -ne 1) {
        throw "Abschlussereignis nennt falsche Werte: state=$($closingEvents[0].state) exitCode=$($closingEvents[0].exitCode)"
    }
} finally {
    Remove-Item Env:\FRIDAY_INSTALL_RUN -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolved)).StartsWith('friday protocol-')) { throw "Unsicherer Testpfad: $resolved" }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

# --- Abschluss- und Warmup-Ereignisse
$env:FRIDAY_INSTALL_RUN = 'abschluss-test'
$script:GuiRunDoneWritten = $false
$doneLines = @(& {
    Write-GuiRunDone 1 'failed'
    Write-GuiRunDone 0 'ok'
} 6>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'FRIDAY-EVENT' })
if ($doneLines.Count -ne 1) { throw "Abschlussereignis wurde $($doneLines.Count)x geschrieben statt genau einmal." }
$doneEvent = (ConvertFrom-GuiEventLine $doneLines[0]).Event
if (-not $doneEvent) { throw 'Abschlussereignis ist nicht lesbar.' }
if ($doneEvent.type -ne 'run' -or $doneEvent.state -ne 'failed' -or [int]$doneEvent.exitCode -ne 1) {
    throw "Abschlussereignis nennt falsche Werte: $($doneLines[0])"
}
Remove-Item Env:\FRIDAY_INSTALL_RUN -ErrorAction SilentlyContinue

$body = Get-Content -LiteralPath $installer -Raw -Encoding UTF8
$stopInstall = $body.Substring($body.IndexOf('function Stop-Install(', [StringComparison]::Ordinal), 300)
if ($stopInstall -notmatch "Write-GuiRunDone 1 'failed'") { throw 'Abbruch meldet kein Abschlussereignis.' }
$tail = $body.Substring($body.Length - 1500)
if ($tail -notmatch 'Write-GuiRunDone \$finalCode') { throw 'Normales Ende meldet kein Abschlussereignis.' }
# Nur im Qwen-Schritt pruefen: dieselbe Wait-Http-Zeile gibt es auch in der Migrationsphase.
$qwenStart = $body.IndexOf("Title 'Schritt 11/15", [StringComparison]::Ordinal)
if ($qwenStart -lt 0) { throw 'Qwen-Schritt nicht gefunden.' }
# Feste Fensterbreite: "MarkDone 'qwen'" steht auch im Cloud-Zweig weiter oben.
$qwenBlock = $body.Substring($qwenStart, [Math]::Min(5200, $body.Length - $qwenStart))
$warmStart = $qwenBlock.IndexOf("state = 'start'; service = 'qwen'", [StringComparison]::Ordinal)
$warmDone = $qwenBlock.IndexOf("state = 'done'; service = 'qwen'", [StringComparison]::Ordinal)
$waitHttp = $qwenBlock.IndexOf('Wait-Http "http://127.0.0.1:$($Ports.Qwen)/v1/models" 120', [StringComparison]::Ordinal)
$startServer = $qwenBlock.IndexOf('start-qwen-server.ps1', [StringComparison]::Ordinal)
if ($warmStart -lt 0 -or $warmDone -lt 0) { throw 'Warmup-Ereignisse fehlen.' }
if (-not ($startServer -lt $warmStart -and $warmStart -lt $waitHttp -and $waitHttp -lt $warmDone)) {
    throw "Warmup-Ereignisse liegen nicht um den Modellstart (server=$startServer start=$warmStart wait=$waitHttp done=$warmDone)."
}
$guiBodyCheck = Get-Content -LiteralPath $gui -Raw -Encoding UTF8
if ($guiBodyCheck -notmatch "'warmup'") { throw 'GUI kennt den Warmup-Ereignistyp nicht.' }
if ($guiBodyCheck -notmatch '\$script:sawRunDone') { throw 'GUI merkt sich das Abschlussereignis nicht.' }
if ($guiBodyCheck -notmatch 'kein Abschlussereignis') { throw 'GUI weist fehlendes Abschlussereignis nicht aus.' }
# --- Voice-Warmup und Lastfall: 10 000 gemischte Zeilen durch den Adapter
$voiceStart = $body.IndexOf("state = 'start'; service = 'voice'", [StringComparison]::Ordinal)
$voiceDone = $body.IndexOf("state = 'done'; service = 'voice'", [StringComparison]::Ordinal)
$voiceWait = $body.IndexOf('state -eq ''listening''', [StringComparison]::Ordinal)
if ($voiceStart -lt 0 -or $voiceDone -lt 0) { throw 'Voice-Warmup-Ereignisse fehlen.' }
if (-not ($voiceStart -lt $voiceWait -and $voiceWait -lt $voiceDone)) { throw 'Voice-Warmup liegt nicht um die Bereitschaftspruefung.' }

$lines = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt 2500; $i++) {
    $lines.Add((ConvertTo-GuiEventLine @{ type = 'step'; state = 'start'; step = "schritt-$i"; text = "Umlaute äöüß $i" }))
    $lines.Add("pip sammelt Ausgabe $i")
    $lines.Add('[FRIDAY-EVENT]{"v":3,"type":"step"}')
    $lines.Add('')
}
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$events = 0; $texts = 0
foreach ($line in $lines) {
    $read = ConvertFrom-GuiEventLine $line
    if ($read.Kind -eq 'event') { $events++ } else { $texts++ }
}
$watch.Stop()
if ($events -ne 2500) { throw "Lastfall: $events Ereignisse statt 2500 erkannt." }
if ($texts -ne 7500) { throw "Lastfall: $texts Textzeilen statt 7500 erkannt." }
if ($watch.Elapsed.TotalSeconds -gt 60) { throw "Lastfall zu langsam: $($watch.Elapsed.TotalSeconds) s fuer $($lines.Count) Zeilen." }
Write-Host ("  Lastfall: {0} Zeilen in {1:N2} s" -f $lines.Count, $watch.Elapsed.TotalSeconds)
Write-Host 'Ereignisstrom Protokoll 2: PASS'
