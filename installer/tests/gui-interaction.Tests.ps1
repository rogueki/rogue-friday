# Interaktionsdatei der Aufnahme: Assistent und Aufnahme muessen denselben Vertrag lesen und schreiben.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '..'
. (Join-Path $installer 'lib\gui-interaction.ps1')
# Der py-Launcher loest die Version selbst auf; fuer einen direkten Prozessstart wird der Interpreter gebraucht.
$py = (& py -3.11 -c "import sys; print(sys.executable)" | Select-Object -Last 1)
if (-not $py -or -not (Test-Path -LiteralPath $py)) { throw "Python 3.11 wurde nicht gefunden." }
$py = $py.Trim()

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

# Startet die Aufnahme mit eigener Ausgabe. Start-Process liefert in PowerShell 5.1 keinen Exitcode,
# sobald umgeleitet wird; deshalb der Prozess direkt ueber .NET.
function Start-Captured([string]$exe, [string[]]$arguments) {
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = (($arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    return $process
}
$root = Join-Path $env:TEMP ('friday-interaction-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root 'run') -Force | Out-Null
try {
    $paths = Get-GuiInteractionPaths $root
    Assert-True ($paths.Request -eq (Join-Path $root 'run\gui-interaction.json')) 'Der Anforderungspfad liegt nicht im Laufordner.'
    Assert-True ($paths.Response -eq ($paths.Request + '.response')) 'Der Antwortpfad passt nicht zur Aufnahme.'
    Assert-True (-not (Read-GuiInteractionRequest $root)) 'Ohne Datei darf keine Anfrage entstehen.'

    # --- Anfrage lesen
    @{ v = 1; id = 'abc123def456'; kind = 'record'; title = 'Stimmaufnahme';
       prompt = "Aufnahme 3: sage 'Hey Friday'"; detail = 'normal, ca. 50 cm'; block = 'wake_hey_friday';
       index = 3; total = 44; actions = @('ok','replay','skip','cancel'); created = '2026-10-22T17:30:00' } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    $request = Read-GuiInteractionRequest $root
    Assert-True ([bool]$request) 'Eine gueltige Anfrage wurde nicht erkannt.'
    Assert-True ($request.Id -eq 'abc123def456') 'Die Kennung der Anfrage ging verloren.'
    Assert-True ($request.Index -eq 3 -and $request.Total -eq 44) 'Der Fortschritt der Anfrage ging verloren.'
    Assert-True ($request.Block -eq 'wake_hey_friday') 'Der Aufnahmeblock ging verloren.'
    Assert-True ($request.Actions.Count -eq 4) 'Die angebotenen Aktionen wurden beschnitten.'

    # --- Ungueltiges wird nicht als Anfrage ausgegeben
    'kein json' | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    Assert-True (-not (Read-GuiInteractionRequest $root)) 'Kaputtes JSON gilt als Anfrage.'
    @{ v = 2; id = 'x'; kind = 'record'; prompt = 'p' } | ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    Assert-True (-not (Read-GuiInteractionRequest $root)) 'Eine fremde Vertragsversion gilt als Anfrage.'
    @{ v = 1; id = 'x'; kind = 'unbekannt'; prompt = 'p' } | ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    Assert-True (-not (Read-GuiInteractionRequest $root)) 'Eine unbekannte Interaktionsart gilt als Anfrage.'
    @{ v = 1; id = 'x'; kind = 'record' } | ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    Assert-True (-not (Read-GuiInteractionRequest $root)) 'Eine Anfrage ohne Aufforderung gilt als gueltig.'

    # --- Antwort schreiben
    @{ v = 1; id = 'abc123def456'; kind = 'record'; prompt = 'p'; actions = @('ok','replay','cancel') } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath $paths.Request -Encoding UTF8
    Assert-True (Send-GuiInteractionResponse $root 'abc123def456' 'ok') 'Die Antwort wurde nicht geschrieben.'
    Assert-True (Test-Path -LiteralPath $paths.Response -PathType Leaf) 'Die Antwortdatei fehlt.'
    $answer = Get-Content -LiteralPath $paths.Response -Raw | ConvertFrom-Json
    Assert-True ($answer.id -eq 'abc123def456' -and $answer.action -eq 'ok') 'Die Antwort enthaelt nicht Kennung und Aktion.'
    Assert-True (-not (Test-Path -LiteralPath ($paths.Response + '.tmp'))) 'Die Zwischendatei blieb liegen.'
    Assert-True (-not (Send-GuiInteractionResponse $root 'fremd1234567' 'ok')) 'Eine fremde Kennung wird beantwortet.'
    Assert-True (-not (Send-GuiInteractionResponse $root 'abc123def456' 'springen')) 'Eine unbekannte Aktion wird geschrieben.'
    Assert-True (-not (Send-GuiInteractionResponse $root 'abc123def456' 'skip')) 'Eine nicht angebotene Aktion wird geschrieben.'
    Assert-True (-not (Send-GuiInteractionResponse $root '' 'ok')) 'Ohne Kennung wird geantwortet.'

    # --- Aufraeumen
    Clear-GuiInteraction $root
    Assert-True (-not (Test-Path -LiteralPath $paths.Request)) 'Die Anfrage blieb nach dem Aufraeumen liegen.'
    Assert-True (-not (Test-Path -LiteralPath $paths.Response)) 'Die Antwort blieb nach dem Aufraeumen liegen.'

    # --- Gegenprobe zur Aufnahme: dieselbe Datei spricht die Python-Seite
    $probe = Join-Path $PSScriptRoot 'fixtures\interaction-probe.py'
    Assert-True (Test-Path -LiteralPath $probe -PathType Leaf) 'Die Testhilfe der Aufnahme fehlt.'
    $voice = Join-Path $installer 'voice'
    $response = Join-Path $root 'answer.json'
    $process = Start-Captured $py @($probe, $voice, $paths.Request)
    $answered = $false
    foreach ($attempt in 1..120) {
        Start-Sleep -Milliseconds 150
        $open = Read-GuiInteractionRequest $root
        if ($open) {
            Assert-True ($open.Block -eq 'wake_hey_friday' -and $open.Index -eq 3 -and $open.Total -eq 44) 'Die Aufnahme schreibt keinen Fortschritt.'
            $answered = Send-GuiInteractionResponse $root $open.Id 'replay'
            break
        }
        if ($process.HasExited) { break }
    }
    Assert-True $answered 'Der Assistent konnte die Anfrage der Aufnahme nicht beantworten.'
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    [void]$process.WaitForExit(20000)
    Assert-True ($process.ExitCode -eq 0) "Die Aufnahme endete mit Exitcode $($process.ExitCode): $stderr"
    $result = ($stdout.Trim() -split "`n" | Where-Object { $_ -match '^\s*\{' } | Select-Object -Last 1) | ConvertFrom-Json
    Assert-True ($result.action -eq 'replay') "Die Aufnahme hat die Aktion '$($result.action)' statt 'replay' gelesen."
    Assert-True (-not (Test-Path -LiteralPath $paths.Response)) 'Die Antwort blieb nach dem Lesen liegen.'

    # --- Abbruch aus der Oberflaeche
    # Die vorige Aufnahme laesst ihre Anfrage liegen; ohne Aufraeumen ginge der Abbruch an deren Kennung.
    Clear-GuiInteraction $root
    $process = Start-Captured $py @($probe, $voice, $paths.Request)
    $cancelled = $false
    foreach ($attempt in 1..120) {
        Start-Sleep -Milliseconds 150
        $open = Read-GuiInteractionRequest $root
        if ($open) { $cancelled = Send-GuiInteractionResponse $root $open.Id 'cancel'; break }
        if ($process.HasExited) { break }
    }
    Assert-True $cancelled 'Der Abbruch konnte nicht uebergeben werden.'
    [void]$process.StandardOutput.ReadToEnd()
    [void]$process.StandardError.ReadToEnd()
    [void]$process.WaitForExit(20000)
    Assert-True ($process.ExitCode -eq 2) "Ein Abbruch muss die Aufnahme mit Exitcode 2 beenden, war $($process.ExitCode)."
} finally {
    $verified = [IO.Path]::GetFullPath($root)
    if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
    }
}

    # --- Verdrahtung: Installer uebergibt die Datei, Assistent beantwortet sie, Aufnahme liest sie
    function Get-WiringProblems([string]$InstallerPath, [string]$GuiPath, [string]$RecordPath) {
        $problems = @()
        $installerText = Get-Content -LiteralPath $InstallerPath -Raw
        $guiText = Get-Content -LiteralPath $GuiPath -Raw
        $recordText = Get-Content -LiteralPath $RecordPath -Raw
        if ($installerText -notmatch '--interaction-file \$interactionFile') { $problems += 'Der Installer uebergibt die Interaktionsdatei nicht an die Aufnahme.' }
        if ($installerText -notmatch '\$interactionFile = "\$Root\\run\\gui-interaction\.json"') { $problems += 'Der Installer bildet den Pfad nicht im Laufordner.' }
        if (($installerText -split 'Clear-GuiInteraction \$Root').Count -lt 3) { $problems += 'Der Installer raeumt alte Anfragen nicht vor und nach der Aufnahme auf.' }
        if ($guiText -notmatch 'Read-GuiInteractionRequest') { $problems += 'Der Assistent liest keine Aufnahmeanfrage.' }
        foreach ($action in @('ok', 'replay', 'skip', 'cancel')) {
            if ($guiText -notmatch "Complete-GuiInteraction '$action'") { $problems += "Der Assistent kann '$action' nicht senden." }
        }
        if ($guiText -notmatch 'Show-GuiInteraction \$request') { $problems += 'Der Assistent zeigt die Aufnahmenseite nicht an.' }
        if ($guiText -notmatch 'interactionOk' -or $guiText -notmatch 'interactionReplay' -or $guiText -notmatch 'interactionSkip') { $problems += 'Der Assistent bietet die Aufnahmeaktionen nicht als Bedienelemente an.' }
        if ($recordText -notmatch '--interaction-file' -or $recordText -notmatch 'gui_interaction\.InteractionClient') { $problems += 'Die Aufnahme liest die Interaktionsdatei nicht.' }
        $clientAt = $recordText.IndexOf('if CLIENT is not None')
        $tkAt = $recordText.IndexOf('from tkinter import messagebox')
        if ($clientAt -lt 0 -or $tkAt -lt 0 -or $clientAt -gt $tkAt) { $problems += 'Die Aufnahme fragt zuerst den Dialog statt der Interaktionsdatei.' }
        if ($recordText -notmatch 'replay_last') { $problems += 'Die Aufnahme kann die letzte Aufnahme nicht erneut abspielen.' }
        return $problems
    }

    $recordPathReal = Join-Path $installer 'voice\enroll_record.py'
    $guiPathReal = Join-Path $installer 'install-friday-gui.ps1'
    $installerPathReal = Join-Path $installer 'install-friday.ps1'
    $problems = Get-WiringProblems $installerPathReal $guiPathReal $recordPathReal
    Assert-True ($problems.Count -eq 0) "Die Verdrahtung ist unvollstaendig: $($problems -join ' ')"

    # Gegenprobe: eine Fassung ohne Uebergabe darf die Pruefung nicht bestehen.
    $brokenDir = Join-Path $root 'broken'
    New-Item -ItemType Directory -Path $brokenDir -Force | Out-Null
    $brokenInstaller = Join-Path $brokenDir 'install-friday.ps1'
    $installerText = Get-Content -LiteralPath $installerPathReal -Raw
    [IO.File]::WriteAllText($brokenInstaller, $installerText.Replace('--gui --interaction-file $interactionFile', '--gui'), (New-Object Text.UTF8Encoding $false))
    $broken = Get-WiringProblems $brokenInstaller $guiPathReal $recordPathReal
    Assert-True (($broken | Where-Object { $_ -match 'uebergibt die Interaktionsdatei nicht' }).Count -eq 1) 'Die Gegenprobe ohne Uebergabe wurde nicht erkannt.'

    $brokenRecord = Join-Path $brokenDir 'enroll_record.py'
    $recordText = Get-Content -LiteralPath $recordPathReal -Raw
    [IO.File]::WriteAllText($brokenRecord, $recordText.Replace('if CLIENT is not None', 'if False'), (New-Object Text.UTF8Encoding $false))
    $broken = Get-WiringProblems $installerPathReal $guiPathReal $brokenRecord
    Assert-True (($broken | Where-Object { $_ -match 'fragt zuerst den Dialog' }).Count -eq 1) 'Die Gegenprobe mit Dialog statt Datei wurde nicht erkannt.'

    $brokenGui = Join-Path $brokenDir 'install-friday-gui.ps1'
    $guiText = Get-Content -LiteralPath $guiPathReal -Raw
    [IO.File]::WriteAllText($brokenGui, $guiText.Replace("Complete-GuiInteraction 'skip'", "Complete-GuiInteraction 'nein'"), (New-Object Text.UTF8Encoding $false))
    $broken = Get-WiringProblems $installerPathReal $brokenGui $recordPathReal
    Assert-True (($broken | Where-Object { $_ -match "'skip' nicht senden" }).Count -eq 1) 'Die Gegenprobe ohne Ueberspringen wurde nicht erkannt.'

Write-Host "Aufnahme-Interaktion: PASS ($script:checks Zusicherungen, Assistent und Aufnahme teilen den Vertrag)"
