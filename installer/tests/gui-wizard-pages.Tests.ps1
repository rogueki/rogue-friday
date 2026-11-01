# Assistentenseiten: Schrittfolge, Seitenaufbau und echt gezeichnete Seiten.
# Die Seitenbilder entstehen im Simulationslauf der Oberflaeche selbst (kein Nachbau im Test).
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
. (Join-Path $root 'gui\layout.ps1')
Add-Type -AssemblyName System.Drawing

$script:checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    $script:checks++
    if (-not $Condition) { throw $Message }
}

# --- 1. Schrittfolge: der eine Fortschrittsbalken folgt dem Installer, nicht einer zweiten Liste
$installerText = [IO.File]::ReadAllText((Join-Path $root 'install-friday.ps1'))
$installerOrder = @([regex]::Matches($installerText, "Enter-Step '([a-z0-9_-]+)'") | ForEach-Object { $_.Groups[1].Value })
Assert-True ($installerOrder.Count -ge 10) "Es wurden nur $($installerOrder.Count) Installerschritte gefunden."
Assert-True (($installerOrder -join ',') -eq ($script:GuiStepOrder -join ',')) "Schrittfolge weicht ab: Installer [$($installerOrder -join ',')] statt Oberflaeche [$($script:GuiStepOrder -join ',')]."
Assert-True ($script:GuiStepOrder.Count -eq @($script:GuiStepOrder | Sort-Object -Unique).Count) 'Die Schrittfolge enthaelt Dubletten.'

$first = Get-GuiStepPercent $script:GuiStepOrder[0]
$last = Get-GuiStepPercent ($script:GuiStepOrder[$script:GuiStepOrder.Count - 1])
Assert-True ($first -lt 10) "Der erste Schritt meldet bereits $first Prozent."
Assert-True ($last -eq 100) "Der letzte Schritt endet bei $last Prozent statt 100."
Assert-True ((Get-GuiStepPercent 'gibt-es-nicht') -eq -1) 'Ein unbekannter Schritt behauptet einen Fortschritt.'
for ($index = 1; $index -lt $script:GuiStepOrder.Count; $index++) {
    Assert-True ((Get-GuiStepPercent $script:GuiStepOrder[$index]) -gt (Get-GuiStepPercent $script:GuiStepOrder[$index - 1])) "Der Fortschritt faellt bei '$($script:GuiStepOrder[$index])'."
}

# --- 2. Aufbau der Oberflaeche (Struktur, aus dem Quelltext belegt)
$guiSource = [IO.File]::ReadAllText((Join-Path $root 'install-friday-gui.ps1'))
Assert-True ($guiSource -notmatch 'TabControl') 'Es gibt weiterhin eine Registerkarten-Oberflaeche.'
Assert-True ($guiSource -notmatch 'TabPages') 'Es gibt weiterhin Registerkarten.'
$pageKeys = @([regex]::Matches($guiSource, "New-WizardPage '([a-zA-Z]+)'") | ForEach-Object { $_.Groups[1].Value })
Assert-True ($pageKeys.Count -eq 8) "Die Oberflaeche hat $($pageKeys.Count) Seiten statt acht."
foreach ($expected in @('systemPage','pathsPage','voicePage','identityPage','modelPage','keysPage','summaryPage','progressPage')) {
    Assert-True ($pageKeys -contains $expected) "Seite '$expected' fehlt."
    Assert-True ($guiSource -match "New-WizardPage '$expected' '[^']+' '[^']+'") "Seite '$expected' hat keinen Titel oder keine Erklaerung."
}
Assert-True ($guiSource -match 'gui\\shell\.ps1') 'Die Oberflaeche nutzt den Rahmen nicht.'
Assert-True ($guiSource -match 'gui\\layout\.ps1') 'Die Oberflaeche nutzt den Layoutvertrag nicht.'
Assert-True ($guiSource -match 'gui\\background\.ps1') 'Die Oberflaeche nutzt das Originalbild nicht.'
# Genau ein Balken: er gehoert dem Rahmen, die Oberflaeche legt keinen eigenen an.
Assert-True ($guiSource -notmatch 'New-Object (Windows\.Forms\.)?ProgressBar') 'Die Oberflaeche legt einen zweiten Fortschrittsbalken an.'
Assert-True ($guiSource -match '\$shell\.ProgressBar\.Value') 'Der Rahmenbalken wird nicht gefuellt.'
# Diagnose nur auf Klick: kein dauerhaft sichtbares Protokollfeld auf einer Seite.
Assert-True ($guiSource -notmatch '\$progressPage\.Panel\.Controls\.Add\(\$script:details\)') 'Das Protokoll liegt dauerhaft auf der Seite.'
Assert-True ($guiSource -match 'DetailsLink\.Add_LinkClicked') 'Der Details-Verweis oeffnet keinen Dialog.'
Assert-True ($guiSource -match 'Abbrechen im Assistenten') 'Der Abbrechen-Knopf sendet keine Abbruchbitte.'
Assert-True ($guiSource -match 'Request-InstallerCancel') 'Die Oberflaeche kennt die Abbruchbitte nicht.'

# --- 3. Echter Simulationslauf: acht gezeichnete Seiten
$gui = Join-Path $root 'install-friday-gui.ps1'
# Simulation nur im Testmodus: dieser Lauf ist der Testmodus.
$env:FRIDAY_GUI_TEST = '1'
$output = & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $gui -Simulation success 2>&1
$exitCode = $LASTEXITCODE
$testLine = @($output | Where-Object { $_ -match '^GUI_TEST ' }) | Select-Object -Last 1
Assert-True ($exitCode -eq 0) "Der Simulationslauf endete mit Exitcode $exitCode."
Assert-True ([bool]$testLine) 'Der Simulationslauf meldet keinen Abschluss.'
Assert-True ($testLine -match 'exit=0') "Der gemeldete Exitcode ist nicht 0: $testLine"

# Tastaturdurchlauf: der Assistent selbst laeuft die Tabulatorreihenfolge jeder Seite durch.
Assert-True ($testLine -match 'focus=(\d+=\d+,){7}\d+=\d+') "Der Lauf meldet keinen Tastaturdurchlauf: $testLine"
$focusPairs = @([regex]::Matches(($testLine -split 'focus=')[1], '(\d+)=(\d+)') | ForEach-Object {
    [pscustomobject]@{ Page = [int]$_.Groups[1].Value; Count = [int]$_.Groups[2].Value }
})
Assert-True ($focusPairs.Count -eq 8) "Der Tastaturdurchlauf meldet $($focusPairs.Count) Seiten statt acht."
foreach ($pair in $focusPairs) {
    Assert-True ($pair.Count -ge 1) "Seite $($pair.Page) erreicht per Tastatur kein einziges Bedienelement."
}
Assert-True (($focusPairs | Measure-Object -Property Count -Sum).Sum -ge 40) "Der Tastaturdurchlauf erreicht insgesamt zu wenige Bedienelemente."
Assert-True (($focusPairs | Where-Object { $_.Page -eq 3 }).Count -ge 8) 'Die Seite mit den meisten Feldern erreicht zu wenige Bedienelemente.'
# Der Durchlauf ist echt: er benutzt die WinForms-Tabulatorlogik, keine behauptete Liste.
Assert-True ($guiSource -match 'SelectNextControl') 'Der Tastaturdurchlauf nutzt die Fokuslogik von WinForms nicht.'
Assert-True ($guiSource -match 'function Test-FocusReachable') 'Der Tastaturdurchlauf fehlt.'
Assert-True ($guiSource -match 'erreicht den Abbruch nicht') 'Der Abbruch wird nicht per Tastatur gefordert.'

# Die Aufnahmenseite ist Teil desselben Selbsttests: Anfrage lesen, Aktionen bedienen, Antwort schreiben.
Assert-True ($testLine -match 'interaction=visible:True ok:True') "Der Selbsttest belegt die Aufnahmenseite nicht: $testLine"
Assert-True ($testLine -match 'qwensame=shown:True hiddenlocal:True') "Die Frage nach demselben Qwen-Schluessel erscheint nicht nur mit Qwen und Alibaba: $testLine"
# Fortgesetzte Installation (Sprachbetrieb gespeichert, Sprachdienst fehlt): Stimme, Stimmen laden, Gespraech,
# Schluessel und Zustimmung bedienbar; nach dem Sprachdienst-Schritt gesperrt.
Assert-True ($testLine -match 'voiceresume=open:True locked:True') "Die Sprachseite einer fortgesetzten Installation ist nicht bedienbar: $testLine"
foreach ($name in @('friday-gui-qwen-voice.png', 'friday-gui-qwen-model.png')) {
    Assert-True (Test-Path -LiteralPath (Join-Path $env:TEMP $name) -PathType Leaf) "Die Qwen-Ansicht $name wurde nicht gezeichnet."
}
Assert-True ($guiSource -match 'Read-GuiInteractionRequest') 'Der Assistent liest keine Aufnahmeanfrage.'
Assert-True ($guiSource -match "Complete-GuiInteraction 'ok'") 'Der Assistent beantwortet die Aufnahme nicht.'

$screens = @()
foreach ($index in 0..7) {
    $path = Join-Path $env:TEMP "friday-gui-page-$index.png"
    Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Seite $index wurde nicht gezeichnet."
    $image = [System.Drawing.Image]::FromFile($path)
    try {
        Assert-True ($image.Width -eq 1200 -and $image.Height -eq 760) "Seite $index hat $($image.Width)x$($image.Height) statt 1200x760."
    } finally { $image.Dispose() }
    $screens += $path
}

function Get-PageStats([string]$Path) {
    $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
    try {
        $leftColors = @{}
        $contentPixels = 0
        $samples = @{}
        for ($y = 8; $y -lt 752; $y += 8) {
            for ($x = 8; $x -lt 1192; $x += 8) {
                $pixel = $bitmap.GetPixel($x, $y)
                if ($x -lt 624) { $leftColors[$pixel.ToArgb()] = $true }
                else {
                    # Inhalt rechts: helle Schrift und helle Eingabefelder heben sich vom dunklen Grund ab.
                    if ($pixel.R -gt 90 -or $pixel.G -gt 90) { $contentPixels++ }
                }
                $samples["$x,$y"] = $pixel.ToArgb()
            }
        }
        return [ordered]@{ LeftColors = $leftColors.Count; ContentPixels = $contentPixels; Samples = $samples }
    } finally { $bitmap.Dispose() }
}

$stats = @()
for ($index = 0; $index -lt 8; $index++) {
    $stat = Get-PageStats $screens[$index]
    $stats += $stat
    Assert-True ($stat.LeftColors -ge 20) "Seite $index zeigt links kein Bild ($($stat.LeftColors) Farben)."
    Assert-True ($stat.ContentPixels -ge 200) "Seite $index zeigt rechts keinen Inhalt ($($stat.ContentPixels) helle Punkte)."
}

# Die Seiten sind nicht identisch: jede folgt-Seite unterscheidet sich sichtbar von der vorigen.
for ($index = 1; $index -lt 8; $index++) {
    $differences = 0
    foreach ($key in $stats[$index].Samples.Keys) {
        if ($stats[$index].Samples[$key] -ne $stats[$index - 1].Samples[$key]) { $differences++ }
    }
    Assert-True ($differences -ge 20) "Seite $index unterscheidet sich kaum von Seite $($index - 1) ($differences Unterschiede)."
}

Write-Host "Assistentenseiten: PASS ($script:checks Zusicherungen, 8 Seiten gezeichnet, Tastaturdurchlauf)"