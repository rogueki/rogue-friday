#Requires -Version 5.1
<#
  F.R.I.D.A.Y. – Komplettinstallation (Windows 11 + WSL2 + Hermes Agent + KI-Anbieter nach Wahl + Sprachsteuerung)
  Standardassistent: F.R.I.D.A.Y. ("Friday", Nachfolger von J.A.R.V.I.S.), Wake Word "Hey Friday". Name UND Wake Word werden
  vor der Stimmaufnahme abgefragt und sind frei waehlbar (z. B. Name James, Wake Word "Computer" oder "Guten Morgen James").
  Spaeter aendern: change-assistant-name.bat (= install-friday.ps1 -ChangeName).
  Standard-Installationsordner: C:\Friday. Eine vorhandene Installation der J.A.R.V.I.S.-Version in C:\Jarvis (Zustand
  C:\Jarvis\config\install-state.json) wird beim Start zur Uebernahme angeboten (Migration, C:\Jarvis bleibt als Sicherung).
  Zuletzt (Schritt 15) wird das F.R.I.D.A.Y. Command Center (Dashboard + Control API, http://127.0.0.1:3100) nach
  C:\Friday\dashboard installiert; -UpdateDashboard (update-dashboard.bat) aktualisiert Dashboard und geaenderte Voice-Quelldateien.
  Start per Doppelklick auf install-friday.bat. Kann jederzeit erneut gestartet werden: erledigte Schritte
  werden uebersprungen (Fortschritt: C:\Friday\config\install-state.json).
  Fuer einen frischen abweichenden InstallRoot sind -DistroName und -DistroLocation erforderlich.
  Bei Folgelaeufen werden Distribution und Ports aus dem gespeicherten Zustand uebernommen.
  Am Ende richtet ein Zusatzschritt den Service-Watchdog ein (Aufgabe FRIDAY_Watchdog, alle 5 Minuten, unsichtbar).
#>
param([switch]$Resume, [switch]$ChangeName, [switch]$ChangeVoice, [switch]$UpdateDashboard,
      [string]$InstallRoot = 'C:\Friday', [string]$DistroName = '', [string]$DistroLocation = '',
      [string]$GuiConfigPath = '', [switch]$GuiSimulation, [switch]$SkipWslUpdate)

if ($InstallRoot -notmatch '^[A-Za-z]:\\[^<>:"|?*]+$' -or $InstallRoot -match '[\\/]\.\.?([\\/]|$)|[\x00-\x1F]' -or
    ([bool]$DistroName -ne [bool]$DistroLocation) -or
    ($DistroName -and $DistroName -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,31}$') -or
    ($DistroLocation -and ($DistroLocation -notmatch '^[A-Za-z]:\\[^<>:"|?*]+$' -or
        $DistroLocation -match '[\\/]\.\.?([\\/]|$)|[\x00-\x1F]'))) {
    throw 'InstallRoot bzw. DistroName/DistroLocation müssen sichere absolute Windows-Pfade und ein gültiger Distributionsname sein.'
}
if ($UpdateDashboard -and $ChangeVoice) { throw '-UpdateDashboard und -ChangeVoice bitte getrennt ausfuehren.' }
$GuiMode = [bool]$GuiConfigPath
$GuiConfig = $null
if ($GuiMode) {
    $guiAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $guiAdministrator) { throw 'GUI-Installation muss mit Administratorrechten gestartet werden.' }
    $configFull = [IO.Path]::GetFullPath($GuiConfigPath)
    $configDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FridayInstaller'))
    if ([IO.Path]::GetDirectoryName($configFull) -ine $configDir -or [IO.Path]::GetExtension($configFull) -ine '.json' -or
        -not (Test-Path -LiteralPath $configFull -PathType Leaf) -or (Get-Item -LiteralPath $configFull).Length -gt 65536 -or
        ((Get-Item -LiteralPath $configFull).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Ungültige GUI-Konfiguration.'
    }
    try { $GuiConfig = Get-Content -LiteralPath $configFull -Raw -Encoding UTF8 | ConvertFrom-Json }
    finally { Remove-Item -LiteralPath $configFull -Force -ErrorAction SilentlyContinue }
    if ($GuiConfig.protocol -ne 1 -or -not $GuiConfig.answers -or -not $GuiConfig.secrets) { throw 'Unbekanntes GUI-Protokoll.' }
    foreach ($key in @('assistantName','wakePhrase','ownerName','about','linuxUser','voiceMode','voiceChoice',
                      'voiceReference','voiceId','conversationBackend','qwenRegion','qwenConsent','inputDevice','outputDevice','address','character','length','migrateLegacy','disableLegacy',
                      'reuseDistro','disableForeignTasks','overwriteDashboardConfig','keepIdentity',
                      'repeatEnrollment','retryEnrollment','openBrowser','useExistingKimi','restartNow')) {
        if (-not $GuiConfig.answers.PSObject.Properties[$key]) { throw "GUI-Antwort fehlt: $key" }
    }
    foreach ($key in @('voiceMode','length','conversationBackend','qwenRegion')) {
        if ([string]$GuiConfig.answers.$key -notin @('1','2')) { throw "Ungültige GUI-Auswahl: $key" }
    }
    # Drei Stimmen: die dritte ist die eigene MP3/WAV. Ob die Datei vorliegt, prueft der
    # Stimmschritt selbst - hier waere die Pruefung falsch, weil ein fortgesetzter Lauf die
    # Referenz bereits im Zustand hat und das Feld dann leer bleiben darf.
    if ([string]$GuiConfig.answers.voiceChoice -notin @('1','2','3')) { throw 'Ungültige GUI-Auswahl: voiceChoice' }
    if ([string]$GuiConfig.answers.modelName -and ([string]$GuiConfig.answers.modelName).Length -gt 200) {
        throw 'Ungültiger Modellname.'
    }
    if ($GuiConfig.answers.PSObject.Properties['providerChoice'] -and
        [string]$GuiConfig.answers.providerChoice -notin @('1','2','3','4')) { throw 'Ungültige GUI-Auswahl: providerChoice' }
    if ($env:FRIDAY_INSTALL_RUN) { Write-Host "[GUI] Lauf $($env:FRIDAY_INSTALL_RUN)" }
    foreach ($key in @('address','character')) {
        if ([string]$GuiConfig.answers.$key -notin @('1','2','3')) { throw "Ungültige GUI-Auswahl: $key" }
    }
    foreach ($key in @('migrateLegacy','disableLegacy','reuseDistro','disableForeignTasks','overwriteDashboardConfig',
                      'keepIdentity','repeatEnrollment','qwenConsent','retryEnrollment','openBrowser','useExistingKimi','restartNow')) {
        if ([string]$GuiConfig.answers.$key -notin @('true','false')) { throw "Ungültige GUI-Entscheidung: $key" }
    }
}
# Data-mode migration lives in its own module so installer/test/data-mode.test.ps1 can prove it without a full run.
. (Join-Path $PSScriptRoot 'lib\data-mode.ps1')
# Einzelinstanz: benannter Mutex plus Sperrdatei mit PID und Startzeit (Begruendung im Modul).
. (Join-Path $PSScriptRoot 'lib\installer-lock.ps1')
# Kooperativer Abbruch: Abbruchbitte der GUI als Datei mit Laufkennung (Begruendung im Modul).
. (Join-Path $PSScriptRoot 'lib\installer-cancel.ps1')
# Rueckkanal der Aufnahme: Anfrage und Antwort als Dateien, gelesen vom grafischen Assistenten.
. (Join-Path $PSScriptRoot 'lib\gui-interaction.ps1')
# Sicherung des Stimmprofils vor einer erneuten Aufnahme (Manifest mit Pruefsummen).
. (Join-Path $PSScriptRoot 'lib\voice-profile-backup.ps1')
# Bereitschaft eines lokalen Dienstes: 503 ("Loading model") ist Laden, nicht Fehler.
. (Join-Path $PSScriptRoot 'lib\wait-http.ps1')
# Keepalive zaehlt nur als echter wsl.exe-Prozess, nicht als "bereit"-Aufgabe.
. (Join-Path $PSScriptRoot 'lib\wsl-keepalive.ps1')
# Pruefsummen geladener Dateien: falsche Datei wird geloescht statt weiterverwendet.
. (Join-Path $PSScriptRoot 'lib\download-integrity.ps1')
# Auswertung der wslpath-Antwort: Warnzeilen filtern, erst danach den Exitcode bewerten.
. (Join-Path $PSScriptRoot 'lib\wsl-path.ps1')
# Globale .wslconfig: vorhandene Einstellungen erhalten, fremde Distributionen nicht herunterfahren.
. (Join-Path $PSScriptRoot 'lib\wsl-config.ps1')
# Dashboard-Quellen: Inhaltshash und Kopie ins Ziel (kanonischer Stand, keine Build-Ausgaben).
. (Join-Path $PSScriptRoot 'lib\dashboard-sync.ps1')
# Dashboard-Sicherung: Manifest mit Pruefsummen, pruefbare Wiederherstellung inklusive Datenbank.
. (Join-Path $PSScriptRoot 'lib\dashboard-backup.ps1')
# Zeitlimit je Download: ein haengender Abruf soll nicht bis zum Stillstandsalarm laufen.
$script:DownloadTimeoutSeconds = 3600
# Stillstand: liefert ein Abruf 60 s lang weniger als 1 KB/s, bricht curl ab und versucht es erneut (I-010);
# ohne diese Grenze haengt ein stehender Abruf bis zum Downloadfenster.
$script:DownloadStallSeconds = 60
# Ereignisstrom fuer die GUI (Protokoll 2): eine JSON-Zeile je Ereignis, alter Text bleibt lesbar.
. (Join-Path $PSScriptRoot 'lib\gui-protocol.ps1')
# Job-Objekte: damit beendet ein Zeitlimit auch Enkelprozesse des eigenen Aufrufs (pip -> python).
. (Join-Path $PSScriptRoot 'lib\job-object.ps1')
# Ueberwachte Unterprozesse: hartes Zeitlimit und gezieltes Beenden genau des gestarteten Prozesses.
. (Join-Path $PSScriptRoot 'lib\process-supervisor.ps1')

if ($GuiSimulation) {
    if (-not $GuiMode -or -not $GuiConfig.simulation -or $env:FRIDAY_GUI_TEST -ne '1') { throw 'Simulation nur im lokalen GUI-Testmodus.' }
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
    Write-Output '[GUI] Prüfung von Stimme und Schlüssel'
    Write-Output '[GUI] Paketvorbereitung'
    if ($GuiConfig.simulation -eq 'failure') { Write-Error 'Simulation: Paketvorbereitung fehlgeschlagen.'; exit 1 }
    if ($GuiConfig.simulation -eq 'restart') { Write-Output '[GUI] Neustart erforderlich'; exit 10 }
    Write-Output '[GUI] Dashboard Health: online'
    exit 0
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($DistroLocation) { $DistroLocation = [IO.Path]::GetFullPath($DistroLocation).TrimEnd('\') }

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$env:WSL_UTF8 = '1'
$OutputEncoding = New-Object Text.UTF8Encoding $false  # Eingaben (z. B. Passwort mit Umlauten) korrekt an wsl.exe
if ($GuiMode) { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false }
$Root   = $InstallRoot
$Inst   = "$Root\installer"
$Distro = 'Ubuntu'
$Ports  = @{ Dashboard = 43691; Qwen = 43692; HermesApi = 43693; Voice = 43694; CommandCenter = 3100 }
$WslRootPath = '/mnt/c/Friday'
$WslInstPath = "$WslRootPath/installer"
$WslConfigPath = "$WslRootPath/config"
$ResumeTask = 'FRIDAY_Installation_fortsetzen'
# Command Center (Schritt 15) liegt unter dem gewaehlen InstallRoot.
$Dash       = "$Root\dashboard"
$DashUrl    = "http://127.0.0.1:$($Ports.CommandCenter)"
$DashPort   = $Ports.CommandCenter
$DashTask   = 'FRIDAY_Dashboard'
$DashInstallLog = "$Root\logs\dashboard-install.log"
$DashHashFile   = "$Root\config\dashboard_owner.hash"   # nur der scrypt-Hash des Owner-Passworts, ACL nur Installationsbenutzer

# ---------------------------------------------------------------- Admin
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $fwd = ''
    if ($Resume) { $fwd += ' -Resume' }
    if ($ChangeName) { $fwd += ' -ChangeName' }
    if ($ChangeVoice) { $fwd += ' -ChangeVoice' }
    if ($UpdateDashboard) { $fwd += ' -UpdateDashboard' }
    if ($GuiMode) { $fwd += ' -GuiConfigPath "' + $GuiConfigPath + '"' }
    $fwd += ' -InstallRoot "' + $InstallRoot + '"'
    if ($DistroName) { $fwd += ' -DistroName "' + $DistroName + '" -DistroLocation "' + $DistroLocation + '"' }
    # Ein Abbruch der Windows-Abfrage ist kein Fehler: es wurde noch nichts angelegt oder geaendert.
    . (Join-Path $PSScriptRoot 'lib\elevation.ps1')
    $elevation = Start-ElevatedPowerShell -ScriptPath $PSCommandPath -ForwardedArguments @($fwd.Trim())
    if ($elevation.Canceled) {
        Write-Host ''
        Write-Host '  Abgebrochen: ohne Administratorrechte wurde nichts installiert oder geaendert.' -ForegroundColor Yellow
        exit 3
    }
    if (-not $elevation.Started) {
        Write-Host ('  Start mit Administratorrechten fehlgeschlagen: ' + $elevation.Message) -ForegroundColor Yellow
        exit 4
    }
    exit
}
$Host.UI.RawUI.WindowTitle = 'F.R.I.D.A.Y. Installation'

# ---------------------------------------------------------------- Ausgabe & Eingabe
function Title($text) { Write-Host ""; Write-Host ("=" * 70) -ForegroundColor DarkCyan; Write-Host "  $text" -ForegroundColor Cyan; Write-Host ("=" * 70) -ForegroundColor DarkCyan }
function Info($text)  { Write-Host "  $text" }
function Ok($text)    { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text)  { Write-Host "  [!]  $text" -ForegroundColor Yellow }
function ConvertTo-BatchArgument([string]$Value) {
    # Argument fuer eine Batchdatei: in Anfuehrungszeichen sind &, ^ und ! unkritisch, Prozentzeichen
    # expandiert cmd aber auch dort - es muss verdoppelt werden. Ein Pfad mit abschliessendem Backslash
    # wuerde in der Kindzeile das Anfuehrungszeichen maskieren, daher wird "\." angehaengt.
    if ($null -eq $Value) { return '""' }
    $escaped = $Value -replace '%', '%%'
    if ($escaped.EndsWith('\')) { $escaped += '.' }
    return '"' + $escaped + '"'
}
function Restore-VoiceChange {
    # Bricht ein Sprachwechsel ab, bleibt der bisherige Sprachbetrieb aktiv: Status, voice.json, Referenzen und FRIDAY_Qwen
    # kommen aus der Sicherung zurueck, die vor der ersten Aenderung angelegt wurde.
    $rollback = $script:VoiceChangeRollback
    if (-not $rollback) { return }
    $script:VoiceChangeRollback = $null
    try {
        if (Test-VoiceServiceRunning) { Stop-VoiceService }
        Copy-Item -LiteralPath "$($rollback.Backup)\install-state.json" -Destination $StateFile -Force -ErrorAction Stop
        Copy-Item -LiteralPath "$($rollback.Backup)\voice.json" -Destination "$Root\config\voice.json" -Force -ErrorAction Stop
        $references = "$Root\config\voice-references"
        if (Test-Path -LiteralPath "$($rollback.Backup)\voice-references" -PathType Container) {
            if (Test-Path -LiteralPath $references) { Remove-Item -LiteralPath $references -Recurse -Force -ErrorAction Stop }
            Copy-Item -LiteralPath "$($rollback.Backup)\voice-references" -Destination $references -Recurse -ErrorAction Stop
        }
        $qwenTask = Get-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction SilentlyContinue
        if ($qwenTask -and (Test-TaskForInstallRoot $qwenTask)) {
            if ($rollback.QwenEnabled) {
                Enable-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction Stop | Out-Null
                Start-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction Stop
            } elseif ($qwenTask.State -ne 'Disabled') {
                Stop-LauncherService 'FRIDAY_Qwen' 'start-qwen-server.ps1' "*llama-server*--port $($Ports.Qwen)*" $Root $ProcessRoots
                Disable-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction Stop | Out-Null
            }
        }
        if (Get-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction Stop }
        Write-Host '  [OK] Der bisherige Sprachbetrieb ist wiederhergestellt.' -ForegroundColor Green
    } catch {
        Write-Host "  [WARNUNG] Der bisherige Sprachbetrieb konnte nicht vollständig wiederhergestellt werden: $($_.Exception.Message) Sicherung: $($rollback.Backup)" -ForegroundColor Yellow
    }
}
function Stop-Install($text) {
    Write-GuiRunDone 1 'failed'
    Write-Host ""; Write-Host "  [FEHLER] $text" -ForegroundColor Red
    Restore-VoiceChange
    # Frueher stand hier nur "install-friday.bat erneut starten". Diese .bat startet das Skript ohne
    # Parameter und faellt damit auf C:\Friday + Standard-Distribution zurueck: bei einem eigenen
    # Zielordner begann so eine zweite, falsche Installation (2026-10-21 real passiert).
    $resumeArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-BatchArgument $PSCommandPath), '-Resume')
    if ($Distro) { $resumeArgs += @('-DistroName', (ConvertTo-BatchArgument $Distro)) }
    if ($DistroLocation) { $resumeArgs += @('-DistroLocation', (ConvertTo-BatchArgument $DistroLocation)) }
    $resumeCmd = 'powershell.exe ' + ($resumeArgs -join ' ')
    if (-not $GuiMode -and $Root -and (Test-Path -LiteralPath $Root)) {
        try {
            # chcp 65001 plus UTF-8 ohne BOM: cmd liest die Datei sonst in der OEM-Codepage und
            # verstuemmelt Umlaute im Zielpfad, wodurch der Fortsetzungsbefehl den Zustand nicht mehr
            # findet und eine frische Installation an einem falschen Pfad prueft (real reproduziert).
            # Der Zielordner kommt aus dem Ordner der Datei selbst (%CD% nach cd /d %~dp0): damit koennen
            # &, %, ! und Umlaute im Pfad den Fortsetzungsbefehl nicht mehr verstuemmeln, und der Ordner
            # bleibt auch nach einem Verschieben richtig. Bewusst ohne abschliessenden Backslash, den die
            # Kindzeile als maskierendes Zeichen lesen koennte.
            $batArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-BatchArgument $PSCommandPath), '-Resume', '-InstallRoot', '"%CD%"')
            if ($Distro) { $batArgs += @('-DistroName', (ConvertTo-BatchArgument $Distro)) }
            if ($DistroLocation) { $batArgs += @('-DistroLocation', (ConvertTo-BatchArgument $DistroLocation)) }
            $resumeBat = "@echo off`r`nchcp 65001>nul`r`ncd /d `"%~dp0`"`r`npowershell.exe " + ($batArgs -join ' ') + "`r`n"
            [IO.File]::WriteAllText((Join-Path $Root 'resume.bat'), $resumeBat, (New-Object Text.UTF8Encoding($false)))
        } catch { }
    }
    Write-Host "  So geht es an dieser Stelle weiter:" -ForegroundColor Yellow
    Write-Host "  $resumeCmd" -ForegroundColor Yellow
    if (-not $GuiMode -and $Root) { Write-Host "  Oder einfach doppelklicken: $(Join-Path $Root 'resume.bat')" -ForegroundColor Yellow }
    # Marker entfernen: ein -NoExit-Fenster hielt ihn mit lebendem PID, Watchdogs hielten den Installer
    # dadurch faelschlich fuer laufend.
    if ($ActiveFile) { Remove-Item -LiteralPath $ActiveFile -Force -ErrorAction SilentlyContinue }
    Exit-InstallerLock $InstallerLock
    try { Stop-Transcript | Out-Null } catch { }
    if (-not $GuiMode) { Read-Host "  Enter zum Beenden" }
    exit 1
}
function Gui-Answer([string]$key, [string]$fallback = '') {
    if (-not $GuiMode) { return $fallback }
    $prop = $GuiConfig.answers.PSObject.Properties[$key]
    if (-not $prop) { throw "GUI-Antwort fehlt: $key" }
    return [string]$prop.Value
}
function Gui-Secret([string]$key) {
    $prop = $GuiConfig.secrets.PSObject.Properties[$key]
    if (-not $prop -or -not $prop.Value) { throw "GUI-Zugangsdaten fehlen: $key" }
    return (ConvertTo-SecureString -String ([string]$prop.Value))
}
function Ask($question, $default = '') {
    if ($GuiMode) {
        $key = switch -Regex ($question) {
            '^Wie soll dein Assistent heißen' { 'assistantName'; break }
            '^Mit welchem Wort oder Satz' { 'wakePhrase'; break }
            '^Wie heißt du' { 'ownerName'; break }
            '^Über mich' { 'about'; break }
            '^Linux-Benutzername' { 'linuxUser'; break }
            default { throw "Unbekannte GUI-Eingabe: $question" }
        }
        $value = Gui-Answer $key
        if ([string]::IsNullOrWhiteSpace($value)) { return $default }
        return $value.Trim()
    }
    $suffix = if ($default) { " [$default]" } else { '' }
    $a = Read-Host "  $question$suffix"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function Choose($question, [string[]]$options, $default = 1) {
    if ($GuiMode) {
        $key = switch -Regex ($question) {
            '^Wie soll .* dich ansprechen' { 'address'; break }
            '^Welcher Charakter' { 'character'; break }
            '^Wie ausführlich' { 'length'; break }
            default { throw "Unbekannte GUI-Auswahl: $question" }
        }
        $value = [int](Gui-Answer $key)
        if ($value -lt 1 -or $value -gt $options.Count) { throw "Ungültige GUI-Auswahl: $key" }
        return $value
    }
    Write-Host "  $question"
    for ($i = 0; $i -lt $options.Count; $i++) { Write-Host "     $($i + 1)) $($options[$i])" }
    while ($true) {
        $a = Ask "Auswahl (1-$($options.Count))" "$default"
        if ($a -match '^\d+$' -and [int]$a -ge 1 -and [int]$a -le $options.Count) { return [int]$a }
    }
}
function YesNo($question, $defaultYes = $true) {
    if ($GuiMode) {
        $key = switch -Regex ($question) {
            '^Diese Aufgaben jetzt DEAKTIVIEREN' { 'disableForeignTasks'; break }
            '^Bestehende Installation nach' { 'migrateLegacy'; break }
            '^Die alten JARVIS_' { 'disableLegacy'; break }
            '^Name und Wake Word unverändert' { 'repeatEnrollment'; break }
            '^Name und Wake Word beibehalten' { 'keepIdentity'; break }
            '^Es gibt bereits eine WSL-Distribution' { 'reuseDistro'; break }
            '^Kimi-API-Key aus' { 'useExistingKimi'; break }
            '^Aufnahme fortsetzen' { 'retryEnrollment'; break }
            '^Mit der Vorgabe überschreiben' { 'overwriteDashboardConfig'; break }
            '^Command Center jetzt im Browser' { 'openBrowser'; break }
            '^Zustimmung Qwen Audio' { 'qwenConsent'; break }
            '^Jetzt neu starten' { 'restartNow'; break }
            default { throw "Unbekannte GUI-Entscheidung: $question" }
        }
        return (Gui-Answer $key) -eq 'true'
    }
    $a = Ask "$question (j/n)" $(if ($defaultYes) { 'j' } else { 'n' })
    return $a -match '^[jJyY]'
}
function Plain([Security.SecureString]$s) {
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Find-VoiceReference([string]$Choice, [string]$SavedReference, [string]$InstallRoot, [string]$PackageRoot) {
    $candidates = @()
    if ($SavedReference) { $candidates += $SavedReference }
    foreach ($extension in @('wav', 'mp3')) {
        $candidates += "$InstallRoot\config\voice-references\$Choice-reference.$extension"
    }
    if ($Choice -eq 'classic') { $candidates += "$PackageRoot\voice_models\jarvis_ref.wav" }
    if ($Choice -eq 'friday-female') { $candidates += "$PackageRoot\voice_models\friday_ref.wav" }
    foreach ($candidate in $candidates) {
        if ($candidate -match '\.(wav|mp3)$' -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return ''
}

# Eine Referenzdatei ist nur brauchbar, wenn sie wirklich Audio enthaelt. Piper/Qwen scheitern
# sonst erst mitten in der Einrichtung, nachdem der halbe Klon gebaut wurde.
function Test-VoiceReferenceFile([string]$Path) {
    if (-not $Path) { return @{ Ok = $false; Reason = 'kein Pfad' } }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return @{ Ok = $false; Reason = 'Datei nicht gefunden' }
    }
    $extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -notin @('.wav', '.mp3')) { return @{ Ok = $false; Reason = 'nur WAV oder MP3' } }
    $length = (Get-Item -LiteralPath $Path).Length
    if ($length -lt 1024) { return @{ Ok = $false; Reason = 'Datei ist leer oder zu kurz' } }
    $head = New-Object byte[] 64
    $read = 0
    $stream = [IO.File]::OpenRead($Path)
    try { $read = $stream.Read($head, 0, $head.Length) } finally { $stream.Dispose() }
    if ($extension -eq '.wav') {
        if ($read -lt 44 -or [Text.Encoding]::ASCII.GetString($head, 0, 4) -ne 'RIFF' -or
            [Text.Encoding]::ASCII.GetString($head, 8, 4) -ne 'WAVE') {
            return @{ Ok = $false; Reason = 'WAV-Kopf ist beschaedigt' }
        }
        $channels = [BitConverter]::ToUInt16($head, 22)
        $rate = [BitConverter]::ToUInt32($head, 24)
        $bits = [BitConverter]::ToUInt16($head, 34)
        if ($channels -lt 1 -or $rate -lt 8000 -or $bits -lt 8) {
            return @{ Ok = $false; Reason = 'WAV-Format ist ungueltig' }
        }
        $seconds = ($length - 44) / ($rate * $channels * ($bits / 8))
        # voice_setup.py verlangt 3 bis 30 Sekunden; eine andere Grenze hier wuerde die Datei erst
        # nach den Downloads im Stimmschritt scheitern lassen.
        if ($seconds -lt 3) { return @{ Ok = $false; Reason = 'Audio ist kuerzer als drei Sekunden' } }
        if ($seconds -gt 30) { return @{ Ok = $false; Reason = 'Audio ist laenger als 30 Sekunden' } }
        return @{ Ok = $true; Reason = '' }
    }
    $sync = ($head[0] -eq 0xFF) -and (($head[1] -band 0xE0) -eq 0xE0)
    if ([Text.Encoding]::ASCII.GetString($head, 0, 3) -ne 'ID3' -and -not $sync) {
        return @{ Ok = $false; Reason = 'MP3-Kopf ist beschaedigt' }
    }
    return @{ Ok = $true; Reason = '' }
}

# ---------------------------------------------------------------- Helfer
function Native([scriptblock]$cmd) {
    Confirm-NotCancelled
    & $cmd 2>&1 | ForEach-Object { "$_" }
}
function Wsl-Run([string]$User, [string]$Script, [string]$StdIn = '', [int]$TimeoutSeconds = 1800) {
    # Skriptdateien statt Befehlszeilen: wsl.exe wuerde $VARIABLEN sonst vorzeitig expandieren.
    $wslEnv = @("FRIDAY_INSTALLER=$WslInstPath", "FRIDAY_CONFIG=$WslConfigPath", "FRIDAY_ROOT=$WslRootPath",
                "FRIDAY_DASH_PORT=$($Ports.Dashboard)", "FRIDAY_API_PORT=$($Ports.HermesApi)",
                "FRIDAY_QWEN_PORT=$($Ports.Qwen)", "FRIDAY_CALENDAR_PORT=$DashPort", "FRIDAY_MAIL_PORT=$DashPort", "FRIDAY_MEMORY_PORT=$DashPort",
                "FRIDAY_STUDIO_PORT=$DashPort")
    # Zeitlimit und Abbruchbitte gelten fuer den gesamten WSL-Aufruf; ohne Limit konnte ein haengendes
    # Skript den Installer unbegrenzt blockieren.
    $arguments = @('-d', $Distro, '-u', $User, '--exec', 'env') + $wslEnv + @('bash', $Script)
    $run = if ($StdIn) {
        Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments $arguments -TimeoutSeconds $TimeoutSeconds -StdIn $StdIn -CancelCheck { Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId }
    } else {
        Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments $arguments -TimeoutSeconds $TimeoutSeconds -CancelCheck { Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId }
    }
    $lines = @()
    foreach ($stream in @($run.StdOut, $run.StdErr)) {
        if ($stream) { $lines += @("$stream" -split "`r?`n" | Where-Object { $_ -ne '' }) }
    }
    $lines | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    if ($run.TimedOut) {
        Stop-Install "WSL-Schritt '$Script' hat das Zeitlimit von $TimeoutSeconds Sekunden ueberschritten."
    }
    if ($run.Cancelled) { Stop-Install 'Installation abgebrochen.' }
    return ($lines -join "`n")
}
function Get-WslPath([string]$WindowsPath, [switch]$Soft) {
    # wslpath antwortet normalerweise in Millisekunden; haengt der Aufruf, darf er den Lauf nicht sperren.
    $run = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', $WindowsPath) -TimeoutSeconds 60
    if ($run.TimedOut) {
        if ($Soft) { return $null }
        Stop-Install "WSL reagiert nicht auf die Pfadumwandlung (Zeitlimit 60 s): $WindowsPath"
    }
    # Vollstaendige Ausgabe auswerten, erst danach den Exitcode: WSL stellt Warnungen voran und
    # beendet sich trotzdem mit 0 - die erste Zeile ist nicht automatisch der Pfad.
    $linuxPath = Select-WslPathOutput (Split-WslOutput "$($run.StdOut)")
    if ($run.ExitCode -ne 0 -or -not $linuxPath) {
        if ($Soft) { return $null }
        Stop-Install "WSL kann den Installationspfad nicht einbinden: $WindowsPath"
    }
    return [string]$linuxPath
}
function Assert-CustomDistroLocation {
    $registration = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue |
        Get-ItemProperty | Where-Object { $_.DistributionName -eq $Distro } | Select-Object -First 1
    if (-not $registration -or [IO.Path]::GetFullPath($registration.BasePath).TrimEnd('\') -ine $DistroLocation) {
        Stop-Install "Ablageort der WSL-Distribution '$Distro' stimmt nicht mit $DistroLocation ueberein."
    }
}
function Wait-Http($url, $seconds, $headers = @{}) {
    # Bewusst ohne Invoke-WebRequest: waehrend des Modellstarts antwortet der Server erwartbar mit
    # HTTP 503 ({"error":{"message":"Loading model"}}), und PowerShell schrieb diese Fehlversuche als
    # "PS>TerminatingError(Invoke-WebRequest): ..." ins Transcript - das sah wie ein Abbruch aus.
    # 503 zaehlt deshalb als "laedt" und wird getrennt von "nicht erreichbar" gemeldet.
    $result = Wait-HttpEndpoint -Url $url -Seconds $seconds -Headers $headers -PollSeconds 3 `
        -CancelCheck { Confirm-NotCancelled }
    if ($result.Ok) { return $true }
    if ($result.Classification -eq 'loading') {
        Warn "Dienst antwortet nach $($result.Seconds) s weiterhin mit HTTP 503 (laedt noch): $url"
    } else {
        Warn "Dienst nicht erreichbar nach $($result.Seconds) s ($($result.Classification)): $url"
    }
    return $false
}
function Test-WslKeepalive {
    # Nur ein laufender wsl.exe-Prozess mit "sleep infinity" haelt die VM wach; eine eingerichtete Aufgabe
    # kann "bereit" melden, ohne dass die VM laeuft (Regression 2026-10-21).
    return ((Get-WslKeepaliveProcess -Distro $Distro).Count -gt 0)
}
function Assert-WslKeepalive {
    # Ohne laufenden Keepalive faehrt die WSL-VM nach ~60 s Idle herunter und reisst den gerade
    # startenden TTS-Dienst mit; der Health-Check laeuft dann zwangslaeufig ins Leere (2026-10-21).
    if (Test-WslKeepalive) { return }
    Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $Distro, '--exec', '/bin/sleep', 'infinity') -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-WslKeepalive) { Ok 'WSL bleibt aktiv (Keepalive gestartet).'; return }
    }
    Warn "WSL-Keepalive startet nicht - der TTS-Dienst kann beim Laden abbrechen. Log: $Root\logs"
}
function Invoke-Pip([string]$Python, [string[]]$PipArgs, [string]$Label) {
    # Fortschritt sichtbar machen: pip lief bisher mit -q und ohne jede Meldung 10-20 min lang, waehrend
    # das Terminal still blieb. Jetzt laeuft pip im Hintergrund und der Installer meldet im Takt weiter.
    # Der Exitcode kommt ueber eine cmd-Datei: Start-Process liefert ihn in PowerShell 5.1 nicht zuverlaessig.
    Confirm-NotCancelled
    Write-GuiEvent 'pip' @{ state = 'start'; label = $Label }
    $log = "$Root\logs\pip-$Label.log"
    $marker = "$log.code"
    $cmdFile = "$Root\logs\pip-$Label.cmd"
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    $quotedArgs = (@('-m', 'pip', 'install', '--progress-bar', 'off', '--no-input') + $PipArgs) |
        ForEach-Object { '"' + $_ + '"' }
    # Fuehrende Umleitung (> "datei" echo ...) ist noetig: die Form "echo %RC%> datei" wurde von cmd als
    # echo ohne Argument gelesen, dadurch blieb die Datei leer.
    $cmdBody = (@('@echo off',
                  ('"' + $Python + '" ' + ($quotedArgs -join ' ') + ' > "' + $log + '" 2>&1'),
                  'set RC=%ERRORLEVEL%',
                  ('> "' + $marker + '" echo %RC%')) -join "`r`n") + "`r`n"
    [IO.File]::WriteAllText($cmdFile, $cmdBody, [Text.Encoding]::Default)
    # cmd startet python als Kindprozess. Ein Abbruch, der nur cmd beendet, liesse pip weiterlaufen und
    # das venv halb geschrieben zurueck. Darum laeuft der gesamte Baum in einem Job-Objekt, das nur
    # Prozesse dieses Aufrufs enthaelt.
    $job = New-ProcessJob
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = 'cmd.exe'
    $startInfo.Arguments = '/c "' + $cmdFile + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $proc = $null
    try { $proc = [System.Diagnostics.Process]::Start($startInfo) } catch { }
    if (-not $proc) { Close-ProcessJob $job; Remove-Item -LiteralPath $cmdFile -Force -ErrorAction SilentlyContinue; return 1 }
    if ($job -ne [IntPtr]::Zero) { [void](Add-ProcessToJob $job $proc) }
    $start = Get-Date
    $aborted = $false
    while (-not (Test-Path -LiteralPath $marker)) {
        $mins = [math]::Floor(((Get-Date) - $start).TotalMinutes)
        Write-Host ("`r  laeuft weiter ... {0} min" -f $mins).PadRight(48) -NoNewline
        if ($proc.HasExited -and (Test-Path -LiteralPath $marker)) { break }
        if (Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId) {
            $aborted = $true
            break
        }
        if (((Get-Date) - $start).TotalMinutes -gt 120) { $aborted = $true; break }
        Start-Sleep -Seconds 5
    }
    if ($aborted) {
        # Der Job nimmt Enkelprozesse mit; ohne Job bleibt es beim gezielten Beenden von cmd.
        if (-not (Stop-ProcessJob $job)) {
            try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
        try { $proc.WaitForExit(5000) | Out-Null } catch { }
    }
    Close-ProcessJob $job
    Write-Host ("`r  abgeschlossen nach {0} s" -f [math]::Round(((Get-Date) - $start).TotalSeconds)).PadRight(48)
    Remove-Item -LiteralPath $cmdFile -Force -ErrorAction SilentlyContinue
    # Ein Abbruch wirkt hier als Abbruch des Laufs, nicht als pip-Fehler mit falscher Ursache.
    if ($aborted) { Confirm-NotCancelled; return 1 }
    if (-not (Test-Path -LiteralPath $marker)) { return 1 }
    $code = 1
    try { $code = [int](Get-Content -LiteralPath $marker -Raw).Trim() } catch { $code = 1 }
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    return $code
}
function Register-UserTask($name, $vbsArgs, $description, $delaySeconds = 0, $repeatMinutes = 0, $timeLimitMinutes = 0) {
    # repeatMinutes > 0: zusaetzlich zur Anmeldung wiederholt die Aufgabe sich endlos in diesem Abstand (ueberlebt Neustarts).
    # timeLimitMinutes > 0: Laufzeitgrenze (Standard: unbegrenzt, fuer die Dienst-Launcher mit Neustartschleife).
    $user    = "$env:USERDOMAIN\$env:USERNAME"
    $action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo $vbsArgs"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    if ($delaySeconds) { $trigger.Delay = "PT$($delaySeconds)S" }
    $triggers = @($trigger)
    if ($repeatMinutes -gt 0) {
        # 9999 Tage statt [TimeSpan]::MaxValue: aeltere Windows-Versionen lehnen MaxValue ab.
        $triggers += New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $repeatMinutes) -RepetitionDuration (New-TimeSpan -Days 9999)
    }
    $limit = if ($timeLimitMinutes -gt 0) { New-TimeSpan -Minutes $timeLimitMinutes } else { [TimeSpan]::Zero }
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit $limit -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $name -Description $description -Action $action -Trigger $triggers `
        -Settings $settings -Principal $principal -Force | Out-Null
}
# Dienst-Launcher (hidden.vbs startet powershell mit Neustartschleife entkoppelt): Stop-ScheduledTask beendet die Schleife nicht.
# Darum Stop-Flag setzen (Schleife beendet sich selbst), Launcher-Prozess und Kindprozess per CommandLine beenden.
# Die Launcher halten ausserdem einen benannten Mutex (Einzelinstanz).
function Get-LauncherProcesses([string]$Launcher, [string]$ChildPattern, [string[]]$RootFilter = @()) {
    # $RootFilter (z. B. 'C:\Jarvis\'): nur Prozesse, deren Befehlszeile diesen Pfad nennt (Migration: nie fremde Prozesse beenden)
    return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe' OR Name='python.exe' OR Name='node.exe' OR Name='llama-server.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $commandLine = [string]$_.CommandLine
            $pathMatches = $RootFilter.Count -eq 0
            foreach ($filter in $RootFilter) { if ($commandLine -like "*$filter*") { $pathMatches = $true; break } }
            $_.ProcessId -ne $PID -and ($commandLine -like "*$Launcher*" -or $commandLine -like $ChildPattern) -and $pathMatches
        })
}
function Stop-LauncherService([string]$Task, [string]$Launcher, [string]$ChildPattern, [string]$RunRoot = $Root, [string[]]$RootFilter = @()) {
    New-Item -ItemType Directory -Force "$RunRoot\run" | Out-Null
    $flag = "$RunRoot\run\$Launcher.stop"
    Set-Content -Path $flag -Value 'stop' -Encoding Ascii
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    foreach ($round in 1..3) {
        $procs = Get-LauncherProcesses $Launcher $ChildPattern $RootFilter
        if ($procs.Count -eq 0) { break }
        # Erst die Schleife (powershell), dann deren Kinder - sonst startet sie den Dienst sofort neu.
        $procs | Where-Object { $_.Name -eq 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $procs | Where-Object { $_.Name -ne 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep 2
    }
    Remove-Item $flag -Force -ErrorAction SilentlyContinue
}
function Stop-VoiceService { Stop-LauncherService 'FRIDAY_Voice' 'start-friday-voice.ps1' '*friday_voice.py*' $Root $ProcessRoots }
function Test-VoiceServiceRunning { return ((Get-LauncherProcesses 'start-friday-voice.ps1' '*friday_voice.py*' $ProcessRoots).Count -gt 0) }
function Download($url, $file) {
    Confirm-NotCancelled
    $downloadName = Split-Path -Path $file -Leaf
    Write-GuiEvent 'download' @{ state = 'start'; name = $downloadName }
    $run = Invoke-SupervisedProcess -FilePath 'curl.exe' -TimeoutSeconds $script:DownloadTimeoutSeconds -PollMilliseconds 500 `
        -Arguments @('-L', '--fail', '--retry', '5', '-C', '-', '--connect-timeout', '30', '--speed-limit', '1024', '--speed-time', [string]$script:DownloadStallSeconds, '-s', '-o', $file, $url) `
        -CancelCheck { Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId }
    if ($run.Cancelled) { Confirm-NotCancelled }
    if ($run.TimedOut) { Warn "Download $downloadName nach $($script:DownloadTimeoutSeconds) s abgebrochen; ein erneuter Lauf setzt an der vorhandenen Datei fort." }
    $downloadOk = ($run.ExitCode -eq 0)
    Write-GuiEvent 'download' @{ state = $(if ($downloadOk) { 'done' } else { 'failed' }); name = $downloadName }
    return $downloadOk
}
function Sha256($file) { return (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() }

# ---------------------------------------------------------------- Einzelinstanz
# Vor jeder Aenderung an Zustand, Aufgaben oder Diensten: zwei Laeufe duerfen den Fortschritt nicht
# abwechselnd ersetzen. Der zweite Start aendert nichts und endet mit eigenem Exitcode, damit GUI und
# geplante Aufgabe den Unterschied zwischen "laeuft schon" und "fehlgeschlagen" sehen.
$InstallerMode = if ($UpdateDashboard) { 'update-dashboard' } elseif ($ChangeVoice) { 'change-voice' } elseif ($ChangeName) { 'change-name' } elseif ($GuiMode) { 'gui' } else { 'install' }
# Eine Laufkennung fuer Sperre, Abbruchbitte und Meldungen. Ohne sie waere eine Abbruchbitte nicht
# zuordenbar und eine liegen gebliebene Datei koennte spaetere Laeufe beenden.
$InstallRunId = if ($env:FRIDAY_INSTALL_RUN) { [string]$env:FRIDAY_INSTALL_RUN } else { "$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))" }
$InstallerLock = Enter-InstallerLock -Root $Root -RunId $InstallRunId -Mode $InstallerMode
if (-not $InstallerLock.Acquired) {
    Write-Host ""
    Write-Host "  [BELEGT] Es laeuft bereits eine Installation." -ForegroundColor Yellow
    Write-Host "  $(Format-InstallerLockHolder $InstallerLock.Holder)" -ForegroundColor Yellow
    Write-Host "  Dieser Start wurde nicht begonnen; es wurde nichts geaendert." -ForegroundColor Yellow
    # Kein Warten auf Eingabe bei -Resume: der Weg laeuft auch aus der geplanten Aufgabe, wo niemand
    # Enter druecken kann. Doppelklick ohne -Resume behaelt die Pause, damit die Meldung lesbar bleibt.
    if (-not $GuiMode -and -not $Resume) { Read-Host "  Enter zum Beenden" }
    exit $script:InstallerAlreadyRunningExitCode
}
if ($InstallerLock.Stale) {
    Warn ("Voriger Lauf (PID $($InstallerLock.Stale.pid)) endete ohne Aufraeumen; seine Schritte werden erneut geprueft.")
}
# Eine Abbruchbitte, die vor dem Start schon vorlag, beendet den Lauf, bevor irgendetwas geaendert wird.
if (Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId) {
    Clear-InstallerCancel -Root $Root -RunId $InstallRunId
    Write-Host ""
    Write-Host "  [ABBRUCH] Fuer diesen Lauf lag bereits eine Abbruchbitte vor. Es wurde nichts geaendert." -ForegroundColor Yellow
    # Wie bei der Sperre: kein Warten auf Eingabe, wenn der Weg aus einer geplanten Aufgabe kommt.
    if (-not $GuiMode -and -not $Resume) { Read-Host "  Enter zum Beenden" }
    exit 1
}
# Laufbeginn melden, damit die GUI Laufkennung und Modus aus dem Ereignisstrom kennt.
Write-GuiEvent 'run' @{ state = 'start'; mode = $InstallerMode; run = $InstallRunId }
function Enter-Step([string]$Name) {
    # Schrittgrenze: Abbruch pruefen und den Schritt als Ereignis melden (die GUI zeigt nur echte Daten).
    Confirm-NotCancelled
    Write-GuiEvent 'step' @{ state = 'start'; step = $Name }
}
function Confirm-NotCancelled {
    # Wird vor jedem Schritt und vor jedem Unterprozess aufgerufen: die Abbruchbitte wirkt an der
    # naechsten sicheren Grenze, nicht mitten in einem Kopier- oder Installationsvorgang.
    if (-not (Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId)) { return }
    $cancelFlag = Read-InstallerCancel $Root
    $cancelReason = if ($cancelFlag -and $cancelFlag.reason) { [string]$cancelFlag.reason } else { 'ohne Angabe' }
    Clear-InstallerCancel -Root $Root -RunId $InstallRunId
    Stop-Install "Abbruch angefordert ($cancelReason). Die bereits erledigten Schritte bleiben gespeichert; ein erneuter Start setzt dort fort."
}
# Sicherheitsnetz fuer alle Ausgaenge (auch exit 10): die Datei verschwindet mit dem Prozess.
$lockPathLiteral = "$($InstallerLock.Path)".Replace("'", "''")
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action ([scriptblock]::Create("Remove-Item '$lockPathLiteral' -Force -ErrorAction SilentlyContinue")) | Out-Null

if (Get-ScheduledTask -TaskName $ResumeTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $ResumeTask -Confirm:$false
}

# ---------------------------------------------------------------- Assistentenname und Wake Word
# Gleiche Regeln wie voice/personal_wake.py (valid_name, valid_phrase, slugify, short_form, is_pretrained_phrase) und common/persona.py.
$DefaultName = 'Friday'
$WakeGreetings = @('hey', 'hi', 'hallo', 'ok', 'okay', 'hej')   # Grusswort am Anfang -> die Phrase hat eine Kurzform ("Friday")
function Test-AssistantName($n) { return $n -match '^\p{L}{2,20}$' }
function Format-AssistantName($n) { return $n.Substring(0, 1).ToUpper() + $n.Substring(1) }
function Get-WakeSlug($n) {
    # Ordnername der Aufnahmen (wake_<slug>): ASCII, Kleinbuchstaben, ae/oe/ue, Leerzeichen/Bindestrich -> "_" ("Hey Friday" -> hey_friday)
    $s = $n.ToLower().Replace('ä', 'ae').Replace('ö', 'oe').Replace('ü', 'ue').Replace('ß', 'ss')
    $s = ($s.Normalize([Text.NormalizationForm]::FormD) -replace '[^\x00-\x7F]', '') -replace '[^a-z0-9]+', '_'
    $s = $s.Trim('_')
    if ($s) { return $s } else { return 'assistant' }
}
function Get-WakeFold($w) {
    # Kleinbuchstaben ohne Akzente, nur a-z (wie personal_wake.fold)
    return (("$w".ToLower().Replace('ß', 'ss')).Normalize([Text.NormalizationForm]::FormD) -replace '[^a-z]', '')
}
function ConvertTo-PhraseText($p) { return ((("$p").Normalize([Text.NormalizationForm]::FormC).Trim()) -replace '\s+', ' ') }
function Test-WakePhrase($p) {
    # 1-4 Woerter aus Buchstaben (auch Umlaute) mit optionalem Bindestrich, durch Leerzeichen getrennt, insgesamt 3-30 Zeichen
    $t = ConvertTo-PhraseText $p
    if ($t.Length -lt 3 -or $t.Length -gt 30) { return $false }
    $words = @($t -split ' ')
    if ($words.Count -gt 4) { return $false }
    foreach ($w in $words) { if ($w -notmatch '^\p{L}+(-\p{L}+)*$') { return $false } }
    return $true
}
function Format-WakePhrase($p) {
    return ((@((ConvertTo-PhraseText $p) -split ' ') | ForEach-Object { $_.Substring(0, 1).ToUpper() + $_.Substring(1) }) -join ' ')
}
function Get-WakeKey($p) { return ((("$p").Trim().ToLower()) -replace '[\s-]+', ' ') }
function Test-PretrainedPhrase($p) { return ((Get-WakeKey $p) -eq 'hey jarvis') }   # nur exakt "Hey Jarvis" nutzt das vortrainierte openWakeWord-Modell
function Get-WakeShort($p) {
    # Kurzform ohne fuehrendes Grusswort ("Hey Friday" -> "Friday"); $null, wenn die Phrase nicht so beginnt
    $words = @((ConvertTo-PhraseText $p) -split ' ')
    if ($words.Count -ge 2 -and ($WakeGreetings -contains (Get-WakeFold $words[0]))) { return (Format-WakePhrase ($words[1..($words.Count - 1)] -join ' ')) }
    return $null
}
function Read-AssistantName($default) {
    while ($true) {
        $n = Ask 'Wie soll dein Assistent heißen?' $default
        if (Test-AssistantName $n) { return (Format-AssistantName $n) }
        if ($GuiMode) { throw 'Ungültiger Assistentenname in der grafischen Installation.' }
        Warn 'Bitte nur Buchstaben (auch Umlaute), 2 bis 20 Zeichen, ohne Leerzeichen und Zahlen.'
    }
}
function Read-WakePhrase($name, $default) {
    # Das Wake Word wird immer frei gefragt (nicht aus dem Namen abgeleitet); Standard "Hey <Name>".
    while ($true) {
        $p = Ask "Mit welchem Wort oder Satz soll $name geweckt werden?" $default
        if (Test-WakePhrase $p) { return (Format-WakePhrase $p) }
        if ($GuiMode) { throw 'Ungültiges Wake Word in der grafischen Installation.' }
        Warn 'Bitte 1 bis 4 Wörter (nur Buchstaben, auch Umlaute, sowie Bindestrich), insgesamt 3 bis 30 Zeichen.'
    }
}
function Set-AssistantIdentity($name, $phrase) {
    $State.assistant_name = $name
    $State.wake_phrase = $phrase
    $State.wake_slug = Get-WakeSlug $phrase
    $State.wake_engine = if (Test-PretrainedPhrase $phrase) { 'openwakeword' } else { 'personal' }
    Save-State
}

# ---------------------------------------------------------------- Migration einer vorhandenen Installation (C:\Jarvis -> C:\Friday)
# Die JARVIS-Version dieses Installers legte alles unter C:\Jarvis ab. Gibt es dort eine Installation und noch kein C:\Friday,
# wird angeboten, sie zu uebernehmen. Phasen (Schluessel in C:\Jarvis\migrate-to-friday.json, jede Phase ist wiederholbar):
#   stop     alte Dienste anhalten (alter Watchdog zuerst, dann Launcher/Prozesse mit den ALTEN Namen und Mustern)
#   copy     C:\Jarvis -> C:\Friday kopieren (robocopy); C:\Jarvis bleibt unveraendert als Sicherung
#   rewrite  Pfade in kopierten Zustands-/Konfigurationsdateien umschreiben, Zustand fuer die Neu-Einrichtung anpassen
#   tasks    alte JARVIS_*-Aufgaben sichern (XML) und entfernen, FRIDAY_*-Aufgaben registrieren; Fremdes nur auflisten
#   wsl      (nach Schritt 2) Hermes in Ubuntu auf die neuen Pfade umstellen (wsl\migrate_paths.sh)
# Am Ende (Schluss des Installers) steht die Abschlussmeldung mit Hinweis auf die Sicherung.
$LegacyRoot    = 'C:\Jarvis'
$MigrationFile = "$LegacyRoot\migrate-to-friday.json"
$ProcessRoots = @("$Root\")
$legacyAlias = Get-Item -LiteralPath $LegacyRoot -Force -ErrorAction SilentlyContinue
if ($legacyAlias -and ($legacyAlias.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
    ([string](@($legacyAlias.Target) | Select-Object -First 1)).TrimEnd('\') -ieq $Root) {
    $ProcessRoots += "$LegacyRoot\"
}
# Dienste der alten Version: Aufgabe, Launcher-Skript (Name des Stop-Flags), Kindprozess-Muster
$LegacyServices = @(
    @{ Task = 'JARVIS_Voice';     Launcher = 'start-jarvis-voice.ps1'; Child = '*jarvis_voice.py*' }
    @{ Task = 'JARVIS_Qwen';      Launcher = 'start-qwen-server.ps1';  Child = '*llama-server*--port 43692*' }
    @{ Task = 'JARVIS_Dashboard'; Launcher = 'start-dashboard.ps1';    Child = '*control-api*dist*main.js*' }
)
# Aufgaben, die der alte Installer selbst angelegt hat. Nur diese (und nur mit Aktion unter C:\Jarvis\installer) werden entfernt.
$LegacyTaskNames = @('JARVIS_Watchdog', 'JARVIS_Voice', 'JARVIS_Qwen', 'JARVIS_Dashboard', 'JARVIS_WSL_Keepalive', 'JARVIS_Installation_fortsetzen')
$PrePhases = @('stop', 'copy', 'rewrite', 'tasks')   # vor dem Kopieren der Installationsdateien; 'wsl' folgt danach

function Read-Migration {
    if (-not (Test-Path $MigrationFile)) { return $null }
    try { $j = Get-Content $MigrationFile -Raw | ConvertFrom-Json }
    catch { Stop-Install "Die Migrationsdatei $MigrationFile ist nicht lesbar ($($_.Exception.Message)). Datei prüfen oder löschen (dann wird die Übernahme neu angeboten)." }
    return @{
        phases   = @($j.phases | Where-Object { $_ })
        foreign  = @($j.foreign | Where-Object { $_ })
        removed  = @($j.removed | Where-Object { $_ })
        disabled = @($j.disabled | Where-Object { $_ })
        started  = "$($j.started)"
        finished = [bool]$j.finished
    }
}
function Save-Migration($m) {
    [IO.File]::WriteAllText($MigrationFile, ($m | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}
function Complete-MigrationPhase($m, [string]$phase) {
    $m.phases = @(@($m.phases) + $phase | Select-Object -Unique)
    Save-Migration $m
}
function Get-LegacyTaskReport {
    # Aufgaben mit JARVIS_-Namen oder einer Aktion, die C:\Jarvis nennt. "Own" = vom alten Installer angelegt, "Foreign" = alles andere.
    $own = @(); $foreign = @()
    foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        $text = (@($t.Actions | ForEach-Object { ("$($_.Execute) $($_.Arguments)").Trim() }) -join ' | ')
        if (-not (($t.TaskName -like 'JARVIS_*') -or ($text -like "*$LegacyRoot*"))) { continue }
        $item = [pscustomobject]@{ Name = $t.TaskName; Path = $t.TaskPath; Action = $text }
        if (($LegacyTaskNames -contains $t.TaskName) -and $t.TaskPath -eq '\' -and ($text -like "*$LegacyRoot\installer\*")) { $own += $item } else { $foreign += $item }
    }
    return [pscustomobject]@{ Own = $own; Foreign = $foreign }
}
function Stop-LegacyServices($report) {
    # Alten Watchdog zuerst (sonst startet er die Dienste sofort neu), dann die Launcher mit den alten Namen/Mustern.
    New-Item -ItemType Directory -Force "$LegacyRoot\run" | Out-Null
    Set-Content -Path "$LegacyRoot\run\installer.active" -Value "$PID" -Encoding Ascii   # auch der alte Watchdog greift dann nicht ein
    foreach ($t in @($report.Own | Where-Object { $_.Name -eq 'JARVIS_Watchdog' })) {
        Disable-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue | Out-Null
        Stop-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
    }
    foreach ($svc in $LegacyServices) {
        Stop-LauncherService $svc.Task $svc.Launcher $svc.Child $LegacyRoot "$LegacyRoot\"
    }
    $left = @($LegacyServices | ForEach-Object { Get-LauncherProcesses $_.Launcher $_.Child "$LegacyRoot\" })
    if ($left.Count -gt 0) {
        Stop-Install "Alte Dienste laufen noch (PID $(($left | ForEach-Object { $_.ProcessId }) -join ', ')). Bitte in der Aufgabenverwaltung beenden und den Installer erneut starten."
    }
    Remove-Item "$LegacyRoot\run\installer.active" -Force -ErrorAction SilentlyContinue
}
function Get-EnableCommand($name, $path) {
    if ($path -and $path -ne '\') { return "Enable-ScheduledTask -TaskName '$name' -TaskPath '$path'" }
    return "Enable-ScheduledTask -TaskName '$name'"
}
function Disable-ForeignLegacyTasks($report) {
    # Fremde Aufgaben, deren Aktion C:\Jarvis oder /mnt/c/Jarvis nennt (z. B. ein Watchdog eines aelteren Installers, der den ALTEN
    # Sprachdienst auf Port 43694 neu startet): auflisten, nachfragen (Standard ja), XML sichern, nur DEAKTIVIEREN - nie loeschen.
    # Rueckgabe: je deaktivierter Aufgabe Name + Befehl zum Wieder-Aktivieren (fuer Migrationszustand und Abschlusstext).
    $disabled = @()
    $hits = @($report.Foreign | Where-Object { $_.Action -like "*$LegacyRoot*" -or $_.Action -like '*/mnt/c/Jarvis*' })
    if ($hits.Count -eq 0) { return $disabled }
    Warn 'Diese fremden Aufgaben (nicht von diesem Installer) verweisen auf die alte Installation:'
    foreach ($t in $hits) { Warn "  $($t.Name) :: $($t.Action)" }
    Info 'Solche Aufgaben starten oft den ALTEN Sprachdienst (Port 43694) oder einen TTS-Server (43695) neu und würden mit dem neuen Dienst um die Ports streiten.'
    if (-not (YesNo 'Diese Aufgaben jetzt DEAKTIVIEREN (nicht löschen; die Aufgabe wird vorher als XML gesichert)?' $true)) {
        Warn 'Aufgaben bleiben aktiv - sie können den alten Dienst neu starten. Von Hand deaktivieren: Disable-ScheduledTask -TaskName <Name>'
        return $disabled
    }
    $dir = "$LegacyRoot\migration-tasks"
    New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($t in $hits) {
        try { Export-ScheduledTask -TaskName $t.Name -TaskPath $t.Path | Set-Content -Path "$dir\foreign-$($t.Name).xml" -Encoding UTF8 }
        catch { Stop-Install "Sicherung der Aufgabe $($t.Name) fehlgeschlagen: $($_.Exception.Message)" }
        Stop-ScheduledTask -TaskName $t.Name -TaskPath $t.Path -ErrorAction SilentlyContinue
        Disable-ScheduledTask -TaskName $t.Name -TaskPath $t.Path | Out-Null
        Ok "Aufgabe $($t.Name) deaktiviert (Sicherung: $dir\foreign-$($t.Name).xml). Wieder aktivieren: $(Get-EnableCommand $t.Name $t.Path)"
        $disabled += [pscustomobject]@{ Name = $t.Name; Command = (Get-EnableCommand $t.Name $t.Path) }
    }
    return $disabled
}
function Disable-LegacyAutostart($report) {
    # Bei abgelehnter Uebernahme: Aufgaben nur deaktivieren (nichts wird geloescht), dann die alten Dienste anhalten.
    foreach ($t in $report.Own) { Disable-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue | Out-Null }
    $disabled = @(Disable-ForeignLegacyTasks $report)
    Stop-LegacyServices $report
    if ($disabled.Count -gt 0) {
        Info 'Zum Wieder-Aktivieren der fremden Aufgaben (PowerShell als Administrator):'
        foreach ($d in $disabled) { Info "  $($d.Command)" }
    }
}
function Get-FolderBytes([string]$path, [string[]]$skip) {
    # Gesamtgroesse in Bytes ohne die Ordner in $skip und ohne Junctions/Symlinks (wie robocopy /XJ)
    [long]$sum = 0
    foreach ($f in @(Get-ChildItem $path -File -Force -ErrorAction SilentlyContinue)) { $sum += $f.Length }
    foreach ($d in @(Get-ChildItem $path -Directory -Force -ErrorAction SilentlyContinue)) {
        if (($skip -contains $d.FullName) -or ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
        $sum += Get-FolderBytes $d.FullName $skip
    }
    return $sum
}
function Convert-LegacyText([string]$text, [bool]$dashboardIds) {
    # C:\Jarvis / C:\\Jarvis (JSON-escaped) / C:/Jarvis und /mnt/c/Jarvis -> Friday; das Trennzeichen bleibt, wie es ist.
    $t = [regex]::Replace($text, '(?i)C:(\\\\|\\|/)Jarvis(?![\p{L}\p{N}_-])', 'C:$1Friday')
    $t = [regex]::Replace($t, '/mnt/c/Jarvis(?![\p{L}\p{N}_-])', '/mnt/c/Friday')
    if ($dashboardIds) {
        # Kennungen in dashboard.yaml/adapters.yaml, die mit dem Umbenennen des Monorepos wechseln
        foreach ($pair in @(@('@jarvis/', '@friday/'), @('jarvis-voice-http', 'friday-voice-http'),
                            @('jarvis-command-midnight', 'friday-command-midnight'), @('jarvis-command-overview', 'friday-command-overview'))) {
            $t = $t.Replace($pair[0], $pair[1])
        }
    }
    return $t
}
function Convert-LegacyFile([string]$file, [bool]$dashboardIds) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $old = (New-Object Text.UTF8Encoding $false).GetString($bytes, $(if ($bom) { 3 } else { 0 }), $bytes.Length - $(if ($bom) { 3 } else { 0 }))
    $new = Convert-LegacyText $old $dashboardIds
    if ($new -eq $old) { return $false }
    if ($file -like '*.json') { $null = $new | ConvertFrom-Json }   # kaputtes JSON darf nie geschrieben werden (wirft)
    [IO.File]::WriteAllText($file, $new, (New-Object Text.UTF8Encoding $bom))
    return $true
}
function Protect-MigratedFile([string]$file) {
    if (-not (Test-Path $file)) { return }
    & icacls.exe $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" /grant:r 'SYSTEM:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Install "Zugriffsrechte für $file konnten nicht gesetzt werden." }
}
function Invoke-MigrationCopy {
    $skip = @("$LegacyRoot\run", "$LegacyRoot\installer", "$LegacyRoot\dashboard", "$LegacyRoot\cache\pip", "$LegacyRoot\migration-tasks")
    $copyGB = [math]::Round((Get-FolderBytes $LegacyRoot $skip) / 1GB, 1)
    $needGB = [math]::Ceiling($copyGB * 1.1) + 2
    $driveLetter = $Root.Substring(0, 1)
    $freeGB = [math]::Round((Get-Volume -DriveLetter $driveLetter).SizeRemaining / 1GB)
    Info "Zu kopieren: ca. $copyGB GB, frei auf ${driveLetter}: $freeGB GB."
    if ($freeGB -lt $needGB) { Stop-Install "Auf ${driveLetter}: sind nur $freeGB GB frei, die Übernahme braucht ca. $needGB GB. Platz schaffen und erneut starten." }
    Info 'Kopiere C:\Jarvis nach C:\Friday (Modelle, Stimmprofil, Konfiguration; das dauert einige Minuten) …'
    & robocopy.exe $LegacyRoot $Root /E /XJ /R:2 /W:2 /XD @skip '__pycache__' /XF 'migrate-to-friday.json' 'installer.active' /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Stop-Install "Kopieren von $LegacyRoot nach $Root fehlgeschlagen (robocopy-Code $LASTEXITCODE). Platz/Berechtigungen prüfen und erneut starten." }
    # Command Center: nur Konfiguration, Daten und Sicherungen. Programm, node_modules und Build werden in Schritt 15 neu aufgebaut
    # (pnpm-Junctions wuerden beim Kopieren aufgeloest und die absoluten Pfade im Build wuerden nicht mehr stimmen).
    foreach ($sub in 'config', 'data', 'backups') {
        if (-not (Test-Path "$LegacyRoot\dashboard\$sub")) { continue }
        & robocopy.exe "$LegacyRoot\dashboard\$sub" "$Root\dashboard\$sub" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Install "Kopieren von dashboard\$sub fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    # Dateien der alten Version, die im neuen Paket anders heissen, nicht mitnehmen.
    Remove-Item "$Root\voice\jarvis_voice.py" -Force -ErrorAction SilentlyContinue
}
function Invoke-MigrationRewrite {
    Info 'Schreibe die Pfade in den kopierten Dateien um (C:\Jarvis → C:\Friday) …'
    $targets = @()
    foreach ($dir in "$Root\config", "$Root\windows-worker", "$Root\dashboard\config") {
        if (Test-Path $dir) { $targets += @(Get-ChildItem $dir -File -Recurse -Include *.json, *.yaml, *.yml, *.md, *.txt, *.ps1, *.cfg, *.ini -ErrorAction SilentlyContinue) }
    }
    foreach ($dir in "$Root\models\openwakeword", "$Root\voice") {
        if (Test-Path $dir) { $targets += @(Get-ChildItem $dir -File -Filter '*.json' -ErrorAction SilentlyContinue) }
    }
    if (Test-Path "$Root\INSTALL_STATE.md") { $targets += Get-Item "$Root\INSTALL_STATE.md" }
    $changed = 0
    foreach ($f in $targets) {
        $dash = ($f.FullName -like "$Root\dashboard\config\*")
        try { if (Convert-LegacyFile $f.FullName $dash) { $changed++; Info "umgeschrieben: $($f.FullName.Substring($Root.Length + 1))" } }
        catch { Stop-Install "Umschreiben von $($f.FullName) fehlgeschlagen: $($_.Exception.Message) - die Datei in C:\Jarvis ist unverändert." }
    }
    Ok "$changed Datei(en) umgeschrieben."
    $left = @($targets | Where-Object { (Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue) -match '(?i)C:(\\\\|\\|/)Jarvis(?![\p{L}\p{N}_-])|/mnt/c/Jarvis(?![\p{L}\p{N}_-])' })
    foreach ($f in $left) { Warn "Enthält weiterhin einen alten Pfad (bitte prüfen): $($f.FullName)" }
    # Hermes-Modellname der Sprachsteuerung: die Umstellung in Ubuntu (migrate_paths.sh) setzt API_SERVER_MODEL_NAME=friday.
    $vf = "$Root\config\voice.json"
    if (Test-Path $vf) {
        $vj = Get-Content $vf -Raw | ConvertFrom-Json
        if ("$($vj.hermes_model)" -eq 'jarvis') {
            $vj | Add-Member -NotePropertyName hermes_model -NotePropertyValue 'friday' -Force
            [IO.File]::WriteAllText($vf, ($vj | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding $false))
            Info 'voice.json: hermes_model jarvis → friday'
        }
    }
    # Geheimnisdateien: robocopy uebernimmt die Zugriffsrechte nicht, also neu setzen (nur der Installationsbenutzer).
    foreach ($secret in "$Root\config\hermes_api.key", "$Root\config\dashboard_owner.hash", "$Root\dashboard\data\auth.key") { Protect-MigratedFile $secret }
    # Zustand: Schritte, die Pfade/Aufgaben einbetten, werden mit den neuen Pfaden wiederholt.
    $sf = "$Root\config\install-state.json"
    $st = Get-Content $sf -Raw | ConvertFrom-Json
    $done = @($st.done | Where-Object { $_ -and $_ -notin @('files', 'voiceservice', 'dashboard', 'watchdog') })
    $venvOk = $false
    $vpy = "$Root\voice\.venv\Scripts\python.exe"
    if ($done -contains 'voicepython' -and (Test-Path $vpy)) {
        Info 'Prüfe die kopierte Python-Umgebung (kann einige Sekunden dauern) …'
        & $vpy -c 'import numpy, torch, sounddevice, faster_whisper, openwakeword, speechbrain' 2>&1 | Out-Null
        $venvOk = ($LASTEXITCODE -eq 0)
        if (-not $venvOk) { Warn 'Die kopierte Python-Umgebung funktioniert am neuen Ort nicht. Sie wird in Schritt 12 neu aufgebaut (10-20 min, Internet nötig).' }
    }
    if ($done -contains 'voicepython' -and -not $venvOk) { $done = @($done | Where-Object { $_ -ne 'voicepython' }) }
    $st | Add-Member -NotePropertyName done -NotePropertyValue $done -Force
    $st | Add-Member -NotePropertyName migrated_from -NotePropertyValue 'Jarvis' -Force   # bewusst kein Pfad: ein erneuter Umschreib-Lauf soll ihn nicht anfassen
    $st | Add-Member -NotePropertyName migrated_at -NotePropertyValue (Get-Date -Format s) -Force
    foreach ($k in 'dashboard_hash', 'dashboard_pnpm') { if ($st.PSObject.Properties[$k]) { $st.PSObject.Properties.Remove($k) } }
    [IO.File]::WriteAllText($sf, ($st | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
    Ok 'Zustand angepasst: Command Center und Sprachdienst werden neu eingerichtet, alles andere bleibt.'
}
function Invoke-MigrationTasks($m, $report) {
    $m.foreign = @($report.Foreign | ForEach-Object { "$($_.Name) :: $($_.Action)" })
    $dir = "$LegacyRoot\migration-tasks"
    New-Item -ItemType Directory -Force $dir | Out-Null
    foreach ($t in $report.Own) {
        try { Export-ScheduledTask -TaskName $t.Name | Set-Content -Path "$dir\$($t.Name).xml" -Encoding UTF8 }
        catch { Stop-Install "Sicherung der Aufgabe $($t.Name) fehlgeschlagen: $($_.Exception.Message)" }
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false
        Ok "Alte Aufgabe $($t.Name) entfernt (Sicherung: $dir\$($t.Name).xml)."
        $m.removed = @(@($m.removed) + $t.Name | Select-Object -Unique)
    }
    $st = Get-Content "$Root\config\install-state.json" -Raw | ConvertFrom-Json
    $done = @($st.done)
    # Aufgaben, deren Schritt nicht wiederholt wird, direkt neu registrieren (Dienst-Aufgaben folgen in den Schritten 14/15 und am Ende).
    if ($done -contains 'keepalive') {
        Register-UserTask 'FRIDAY_WSL_Keepalive' "`"$Inst\scripts\wsl-keepalive.vbs`"" 'Hält Ubuntu/WSL für Hermes dauerhaft aktiv'
        Ok 'Aufgabe FRIDAY_WSL_Keepalive eingerichtet.'
    }
    if ($State.voice_mode -ne 'elevenlabs' -and $done -contains 'qwen') {
        Register-UserTask 'FRIDAY_Qwen' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-qwen-server.ps1`"" 'Lokaler Qwen3-4B-Router für F.R.I.D.A.Y.'
        Ok 'Aufgabe FRIDAY_Qwen eingerichtet (wird nach dem Kopieren der Skripte gestartet).'
    }
    $newlyDisabled = @(Disable-ForeignLegacyTasks $report)
    $m.disabled = @(@($m.disabled) + @($newlyDisabled | ForEach-Object { $_.Command }) | Select-Object -Unique)
    if ($newlyDisabled.Count -gt 0) { Stop-LegacyServices $report }   # ein fremder Watchdog kann den alten Dienst zwischenzeitlich neu gestartet haben
    $m.foreign = @($report.Foreign | Where-Object { $_.Name -notin @($newlyDisabled | ForEach-Object { $_.Name }) } | ForEach-Object { "$($_.Name) :: $($_.Action)" })
    if ($m.foreign.Count -gt 0) {
        Warn 'Weitere Aufgaben verweisen noch auf C:\Jarvis oder heißen JARVIS_* und wurden NICHT angefasst:'
        foreach ($f in $m.foreign) { Warn "  $f" }
        Warn 'Sie gehören nicht zu diesem Installer. Von Hand anpassen, deaktivieren oder löschen.'
    }
}
function Invoke-LegacyMigration {
    $m = Read-Migration
    if (-not $m) {
        if (-not (Test-Path "$LegacyRoot\config\install-state.json")) { return }
        if (Test-Path $Root) { return }   # C:\Friday existiert bereits: frische oder schon uebernommene Installation
        Title 'Vorhandene Installation gefunden'
        Info 'Auf diesem PC liegt eine frühere Installation (J.A.R.V.I.S.-Version) in C:\Jarvis. F.R.I.D.A.Y. wird in C:\Friday eingerichtet.'
        Info 'Ich kann die bestehende Einrichtung übernehmen:'
        Info '  • Stimmprofil, Wake-Word-Modell, Persönlichkeit, Modelle, Hermes-Einrichtung und Command-Center-Daten werden kopiert'
        Info '  • die alten JARVIS_*-Aufgaben werden angehalten, gesichert und durch FRIDAY_*-Aufgaben ersetzt'
        Info '  • Hermes in Ubuntu wird auf die neuen Pfade umgestellt (kein Neuinstallieren, Kimi-Schlüssel bleibt)'
        Info '  • C:\Jarvis bleibt bis zum Schluss unverändert als Sicherung erhalten, nichts wird gelöscht'
        Info '  • Dauer: einige Minuten; das Command Center wird danach neu gebaut (Internet nötig)'
        if (-not (YesNo 'Bestehende Installation nach C:\Friday übernehmen?' $true)) {
            Info 'Dann wird F.R.I.D.A.Y. frisch in C:\Friday installiert; C:\Jarvis bleibt unberührt.'
            if (YesNo 'Die alten JARVIS_*-Dienste jetzt anhalten und deaktivieren (empfohlen: sie belegen sonst dieselben Ports 43691-43694 und 3100)?' $true) {
                Disable-LegacyAutostart (Get-LegacyTaskReport)
                Ok 'Alte Dienste angehalten, ihre Aufgaben sind deaktiviert (nicht gelöscht; wieder aktivieren: Enable-ScheduledTask JARVIS_<Name>).'
            }
            return
        }
        $m = @{ phases = @(); foreign = @(); removed = @(); disabled = @(); started = (Get-Date -Format s); finished = $false }
        Save-Migration $m
    }
    if ($m.finished -or @($PrePhases | Where-Object { @($m.phases) -notcontains $_ }).Count -eq 0) { return }
    New-Item -ItemType Directory -Force "$LegacyRoot\logs" | Out-Null
    Start-Transcript -Path "$LegacyRoot\logs\migrate-to-friday-$(Get-Date -Format yyyyMMdd-HHmmss).log" -Append | Out-Null
    Title 'Übernahme von C:\Jarvis nach C:\Friday'
    $report = Get-LegacyTaskReport
    if (@($m.phases) -notcontains 'stop') {
        Info 'Phase 1/4 – alte Dienste anhalten …'
        Stop-LegacyServices $report
        Complete-MigrationPhase $m 'stop'
    }
    if (@($m.phases) -notcontains 'copy') {
        Info 'Phase 2/4 – kopieren …'
        New-Item -ItemType Directory -Force $Root | Out-Null
        Invoke-MigrationCopy
        Complete-MigrationPhase $m 'copy'
    }
    if (@($m.phases) -notcontains 'rewrite') {
        Info 'Phase 3/4 – Pfade und Zustand anpassen …'
        Invoke-MigrationRewrite
        Complete-MigrationPhase $m 'rewrite'
    }
    if (@($m.phases) -notcontains 'tasks') {
        Info 'Phase 4/4 – Aufgaben umstellen …'
        Invoke-MigrationTasks $m $report
        Complete-MigrationPhase $m 'tasks'
    }
    Ok 'Dateien und Aufgaben sind übernommen. Die Hermes-Umstellung in Ubuntu folgt nach dem Kopieren der Installationsdateien.'
    Stop-Transcript | Out-Null
}
function Invoke-MigrationWsl {
    # Nach Schritt 2 (C:\Friday\installer existiert): Hermes in Ubuntu auf die neuen Pfade umstellen, Qwen starten.
    $m = Read-Migration
    if (-not $m -or $m.finished -or @($m.phases) -contains 'wsl') { return }
    Title 'Übernahme: Hermes und Dienste umstellen'
    if (IsDone 'hermes') {
        if (-not $State.linux_user) { Stop-Install 'install-state.json enthält keinen Linux-Benutzer - Hermes kann nicht umgestellt werden.' }
        $out = Wsl-Run $State.linux_user '/mnt/c/Friday/installer/wsl/migrate_paths.sh'
        if ($out -notmatch 'MIGRATE_WSL_DONE') { Stop-Install 'Umstellung von Hermes in Ubuntu fehlgeschlagen (graue Ausgabe oben). Nach der Behebung install-friday.bat erneut starten - C:\Jarvis ist unverändert.' }
        Ok 'Hermes verwendet jetzt /mnt/c/Friday und das Modell "friday".'
    } else { Info 'Hermes war in der alten Installation nicht eingerichtet - nichts umzustellen.' }
    if ((IsDone 'keepalive') -and (Get-ScheduledTask -TaskName 'FRIDAY_WSL_Keepalive' -ErrorAction SilentlyContinue)) { Start-ScheduledTask -TaskName 'FRIDAY_WSL_Keepalive' }
    if ($State.voice_mode -ne 'elevenlabs' -and (IsDone 'qwen') -and (Get-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction SilentlyContinue)) {
        Start-ScheduledTask -TaskName 'FRIDAY_Qwen'
        if (Wait-Http "http://127.0.0.1:$($Ports.Qwen)/v1/models" 120) { Ok 'Qwen läuft aus C:\Friday.' }
        else { Warn "Qwen antwortet nicht (C:\Friday\logs\qwen-server.log). Erneut versuchen: Start-ScheduledTask FRIDAY_Qwen" }
    }
    Complete-MigrationPhase $m 'wsl'
}
function Show-MigrationSummary {
    $m = Read-Migration
    if (-not $m -or $m.finished) { return }
    Title 'Übernahme abgeschlossen'
    Ok 'Deine bisherige Installation läuft jetzt als F.R.I.D.A.Y. aus C:\Friday.'
    Info 'C:\Jarvis wurde NICHT verändert (bis auf die Migrationsdatei und das Protokoll) und bleibt als Sicherung erhalten.'
    Info '  Sicherung der alten Aufgaben (XML): C:\Jarvis\migration-tasks'
    Info '  Protokoll der Übernahme:            C:\Jarvis\logs\migrate-to-friday-*.log'
    Info 'Erst prüfen, ob alles läuft (Wake Word, Command Center, Hermes-Dashboard), und wenn ja - in einer PowerShell als Administrator:'
    Info '  Remove-Item -Recurse -Force C:\Jarvis'
    Info '(Wer die alten Aufgaben-XML behalten will, kopiert C:\Jarvis\migration-tasks vorher weg.)'
    if (@($m.disabled).Count -gt 0) {
        Info 'Fremde Aufgaben, die auf C:\Jarvis verwiesen, wurden DEAKTIVIERT (nicht gelöscht; XML-Sicherung in C:\Jarvis\migration-tasks\foreign-*.xml).'
        Info 'Wieder aktivieren (PowerShell als Administrator), falls du sie weiter brauchst:'
        foreach ($c in $m.disabled) { Info "  $c" }
        Info 'Ein TTS-Server auf Port 43695 aus der alten Installation wird NICHT übernommen: er läuft weiter nur, wenn du ihn selbst auf C:\Friday umstellst.'
    }
    if (@($m.foreign).Count -gt 0) {
        Warn 'Diese Aufgaben gehören nicht zu diesem Installer, zeigen noch auf C:\Jarvis und müssen von Hand angepasst oder gelöscht werden:'
        foreach ($f in $m.foreign) { Warn "  $f" }
    }
    $m.finished = $true
    Save-Migration $m
}

$CustomRoot = $Root -ine 'C:\Friday'
function Test-FreshRootEmpty([string]$Path) {
    # Der Installer legt seine Sperrdatei unter <Root>\run ab, bevor diese Pruefung greift. Sie darf
    # einen wirklich leeren Zielordner nicht wie fremde Daten aussehen lassen - sonst waere jede frische
    # Installation mit eigenem Root unmoeglich. Alles andere zaehlt weiter als belegt.
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return $true }
    foreach ($item in @(Get-ChildItem -LiteralPath $Path -Force)) {
        if ($item.Name -ine 'run' -or -not $item.PSIsContainer) { return $false }
        $inner = @(Get-ChildItem -LiteralPath $item.FullName -Force | Where-Object { $_.Name -ine 'installer.lock.json' })
        if ($inner.Count -gt 0) { return $false }
    }
    return $true
}
if ($CustomRoot) {
    if (-not (Test-Path -LiteralPath "$Root\config\install-state.json" -PathType Leaf) -and
        ($UpdateDashboard -or $ChangeVoice -or $ChangeName)) {
        Stop-Install "Keine bestehende Installation in $Root gefunden. Bitte zuerst die vollstaendige Installation ausfuehren."
    }
    if (-not (Test-Path -LiteralPath "$Root\config\install-state.json" -PathType Leaf) -and
        (-not $DistroName -or -not $DistroLocation)) {
        Stop-Install 'Frische Installation ausserhalb C:\Friday erfordert -DistroName und -DistroLocation.'
    }
    if (-not (Test-Path -LiteralPath "$Root\config\install-state.json" -PathType Leaf) -and
        -not (Test-FreshRootEmpty $Root)) {
        Stop-Install "Der frische InstallRoot ist nicht leer: $Root. Bestehende Daten werden nicht ueberschrieben."
    }
} else {
    $legacyItem = Get-Item -LiteralPath $LegacyRoot -Force -ErrorAction SilentlyContinue
    if ($legacyItem -and ($legacyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
        (Test-Path -LiteralPath "$LegacyRoot\config\install-state.json")) {
        if (-not (Test-Path -LiteralPath "$Root\config\install-state.json")) {
            Stop-Install "$LegacyRoot ist eine Junction. Automatische Migration nach C:\Friday waere hier unsicher; bestehenden Zielpfad explizit mit -InstallRoot und gezieltem Update waehlen."
        }
        Warn "$LegacyRoot ist eine Junction; die bestehende Installation in $Root wird ohne Legacy-Migration fortgesetzt."
    } else { Invoke-LegacyMigration }
}

foreach ($d in 'config','exchange','logs','models','scripts','voice','windows-worker','backups','cache','installer') {
    New-Item -ItemType Directory -Force "$Root\$d" | Out-Null
}
# Markierung "Installer laeuft" (Inhalt: PID): der Service-Watchdog (FRIDAY_Watchdog) startet waehrenddessen nichts neu, denn
# Stop-LauncherService/Neuinstallation halten Dienste absichtlich lange gestoppt. Entfernt am Ende und beim Beenden der Sitzung
# (auch bei Stop-Install/Neustart-Exit); eine verwaiste Datei ignoriert der Watchdog (Prozess tot oder aelter als 12 h).
New-Item -ItemType Directory -Force "$Root\run" | Out-Null
$ActiveFile = "$Root\run\installer.active"
Set-Content -Path $ActiveFile -Value "$PID" -Encoding Ascii
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action ([scriptblock]::Create("Remove-Item '$ActiveFile' -Force -ErrorAction SilentlyContinue")) | Out-Null
Start-Transcript -Path "$Root\logs\install-$(Get-Date -Format yyyyMMdd-HHmmss).log" -Append | Out-Null

# Schutz vor einer zweiten, falschen Installation: Ein Start ohne -InstallRoot landet in C:\Friday. Existiert
# auf dem PC bereits eine Installation (erkennbar an den Aufgaben, die auf <Root>\installer\... zeigen), wird
# gewarnt statt still eine zweite anzulegen. Genau das passierte am 2026-10-21.
if (-not $Resume -and -not $PSBoundParameters.ContainsKey('InstallRoot')) {
    $knownRoot = $null
    foreach ($taskName in @('FRIDAY_Dashboard', 'FRIDAY_Qwen', 'FRIDAY_Voice')) {
        $knownTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if (-not $knownTask) { continue }
        $taskArguments = (@($knownTask.Actions | ForEach-Object { "$($_.Arguments)" }) -join ' ')
        if ($taskArguments -match '([A-Za-z]:\\[^"]*?)\\installer\\') { $knownRoot = $Matches[1]; break }
    }
    $rootHasState = Test-Path -LiteralPath (Join-Path $Root 'config\install-state.json')
    if ($knownRoot -and -not $rootHasState -and
        [IO.Path]::GetFullPath($knownRoot).TrimEnd('\') -ine [IO.Path]::GetFullPath($Root).TrimEnd('\')) {
        Warn "Auf diesem PC ist bereits eine F.R.I.D.A.Y.-Installation eingerichtet: $knownRoot"
        Info "Dieser Start wuerde eine ZWEITE Installation in $Root anlegen."
        Info ('Vorhandene Installation fortsetzen: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Resume -InstallRoot "' + $knownRoot + '"')
        if ($GuiMode) {
            Stop-Install "F.R.I.D.A.Y. ist auf diesem PC bereits in $knownRoot installiert. Im Assistenten diesen Ordner waehlen, um die Installation fortzusetzen oder zu aktualisieren."
        }
        if (-not (YesNo "Trotzdem eine zweite Installation in $Root anlegen?")) {
            Stop-Install 'Abgebrochen, damit keine zweite Installation entsteht.'
        }
    }
}

# ---------------------------------------------------------------- Fortschritt
$StateFile = "$Root\config\install-state.json"
$State = @{ done = @() }
function Read-InstallerState([string]$Path) {
    # Liefert $null, wenn die Datei fehlt, leer, kein JSON-Objekt oder ohne done[] ist. Eine halb
    # geschriebene Datei darf nie als "noch nichts erledigt" durchgehen, sonst beginnt die
    # Installation von vorn und ueberschreibt vorhandene Schritte.
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 } catch { return $null }
    if (-not $raw -or -not $raw.Trim()) { return $null }
    try { $parsed = $raw | ConvertFrom-Json } catch { return $null }
    if (-not $parsed -or $parsed -isnot [System.Management.Automation.PSCustomObject]) { return $null }
    if (-not $parsed.PSObject.Properties['done']) { return $null }
    return $parsed
}
function Import-InstallerState([string]$Path) {
    # Source: 'live' (unveraendert gelesen), 'backup' (Sicherung wiederhergestellt), $null (nichts brauchbar).
    $result = @{ State = $null; Source = $null; Damaged = $null }
    $live = Read-InstallerState $Path
    if ($live) { $result.State = $live; $result.Source = 'live'; return $result }
    if (Test-Path -LiteralPath $Path -PathType Leaf) { $result.Damaged = $Path }
    $backup = Read-InstallerState "$Path.bak"
    if ($backup) {
        # Die Sicherung ist der letzte vollstaendig geschriebene Stand; sie ersetzt die kaputte Datei,
        # damit auch spaetere Laeufe wieder eine lesbare Grundlage haben.
        Copy-Item -LiteralPath "$Path.bak" -Destination $Path -Force
        $result.State = $backup
        $result.Source = 'backup'
    }
    return $result
}
$ExistingState = Test-Path -LiteralPath $StateFile -PathType Leaf
if ($ExistingState) {
    $importedState = Import-InstallerState $StateFile
    if (-not $importedState.State) {
        Stop-Install "Der gespeicherte Fortschritt ist unlesbar ($StateFile) und auch die Sicherung $StateFile.bak hilft nicht. Bitte die Datei aus einer eigenen Sicherung zurueckholen; ohne Zustand wuerde die Installation von vorn beginnen."
    }
    if ($importedState.Source -eq 'backup') {
        Warn "Der gespeicherte Fortschritt war unlesbar; die Sicherung $StateFile.bak wurde wiederhergestellt."
    }
    $importedState.State.PSObject.Properties | ForEach-Object { $State[$_.Name] = $_.Value }
}
function IsDone($n) { return @($State.done) -contains $n }
function Test-TaskForInstallRoot($task) {
    if (-not $task) { return $false }
    $actions = @($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    foreach ($path in $ProcessRoots) { if ($actions -like "*$path*") { return $true } }
    return $false
}
if ($CustomRoot) {
    # Zuerst die gespeicherte Distribution uebernehmen: jede Meldung und jeder Fortsetzungsbefehl
    # (resume.bat) muss die echte Distribution nennen, nicht den Standardnamen. Sonst haette ein
    # Abbruch vor der Uebernahme "Ubuntu" vorgeschlagen und den eigenen Ablageort verschluckt.
    if ($ExistingState) {
        if ($State.distro_name) { $Distro = [string]$State.distro_name }
        if ($State.distro_location) { $DistroLocation = [string]$State.distro_location }
    }
    if ($ExistingState -and (-not $State.distro_name -or -not $State.distro_location -or -not $State.ports)) {
        Stop-Install 'Der gespeicherte Zustand enthaelt keine benannte Distribution, deren Ablageort oder Portbelegung. Update abgebrochen.'
    }
    if ($ExistingState -and ($UpdateDashboard -or $ChangeVoice) -and
        (-not $State.assistant_name -or -not $State.wake_phrase)) {
        Stop-Install 'Assistentenname oder Wake Word fehlen im gespeicherten Zustand.'
    }
    if ($ExistingState -and $DistroName -and ($DistroName -ne $State.distro_name -or $DistroLocation -ine $State.distro_location)) {
        Stop-Install "DistroName/DistroLocation widersprechen dem gespeicherten Zustand ($($State.distro_name), $($State.distro_location))."
    }
    if (-not $ExistingState) {
        $Distro = $DistroName
        $State.distro_name = $Distro
        $State.distro_location = $DistroLocation
        $State.ports = @{ Dashboard = 43791; Qwen = 43792; HermesApi = 43793; Voice = 43794; CommandCenter = 3101 }
    }
    $rootVolume = [IO.Path]::GetPathRoot($Root)
    if ($rootVolume -ine [IO.Path]::GetPathRoot($DistroLocation)) {
        Stop-Install "InstallRoot und DistroLocation muessen auf demselben Laufwerk liegen ($Root / $DistroLocation)."
    }
    if ($Root.StartsWith("$DistroLocation\", [StringComparison]::OrdinalIgnoreCase) -or
        $DistroLocation.StartsWith("$Root\", [StringComparison]::OrdinalIgnoreCase) -or $Root -ieq $DistroLocation) {
        Stop-Install 'InstallRoot und DistroLocation duerfen sich nicht ueberlappen.'
    }
    if ($ExistingState -and ($UpdateDashboard -or $ChangeVoice)) {
        $requiredSteps = @('preflight','files','wslfeature','power','persona','wslconfig','distro','linuxuser','keepalive','hermes','qwen','voicepython','enroll','voiceservice')
        $missing = @($requiredSteps | Where-Object { -not (IsDone $_) })
        if ($missing.Count -gt 0) { Stop-Install "Bestehende Installation ist fuer ein gezieltes Update unvollstaendig: $($missing -join ', ')." }
    }
    $savedPorts = @{}
    foreach ($name in @('Dashboard','Qwen','HermesApi','Voice','CommandCenter')) {
        $value = if ($State.ports -is [System.Collections.IDictionary]) { $State.ports[$name] } else { $State.ports.$name }
        if ($null -eq $value -or [int]$value -lt 1024 -or [int]$value -gt 65535) { Stop-Install "Ungueltiger gespeicherter Port: $name" }
        $savedPorts[$name] = [int]$value
    }
    if (@($savedPorts.Values | Select-Object -Unique).Count -ne 5) { Stop-Install 'Gespeicherte Diensteports ueberschneiden sich.' }
    $candidateTtsPort = $savedPorts.Voice + 1
    if ($candidateTtsPort -gt 65535 -or $savedPorts.Values -contains $candidateTtsPort) {
        Stop-Install 'Der TTS-Port nach dem Sprachdienst-Port ist ungueltig oder bereits fuer einen anderen Friday-Dienst reserviert.'
    }
    if (-not $ExistingState) {
        foreach ($port in (@($savedPorts.Values) + @($candidateTtsPort))) {
            if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
                Stop-Install "Port $port ist belegt. Frische Installation an diesem InstallRoot wurde nicht begonnen."
            }
        }
    }
    if ($ExistingState -and ($UpdateDashboard -or $ChangeVoice)) {
        foreach ($file in @("$Root\config\persona.json", "$Root\config\voice.json", "$Dash\config\dashboard.yaml", "$Dash\config\adapters.yaml")) {
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-Install "Bestandskonfiguration fehlt: $file" }
        }
    }
    $Ports = $savedPorts
    $DashPort = $Ports.CommandCenter
    $DashUrl = "http://127.0.0.1:$DashPort"
    # Der alte D:-Installer registrierte den Dashboard-Launcher unter JARVIS_Dashboard.
    # Bis zum erfolgreichen Healthcheck bleibt diese Aufgabe als Rueckfall erhalten.
    $legacyDashTask = Get-ScheduledTask -TaskName 'JARVIS_Dashboard' -ErrorAction SilentlyContinue
    $fridayDashTask = Get-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction SilentlyContinue
    if ($fridayDashTask -and -not (Test-TaskForInstallRoot $fridayDashTask)) { Stop-Install 'FRIDAY_Dashboard gehoert zu einem anderen Installationspfad. Update abgebrochen.' }
    if ($legacyDashTask -and -not (Test-TaskForInstallRoot $legacyDashTask)) { Stop-Install 'JARVIS_Dashboard gehoert zu einem anderen Installationspfad. Update abgebrochen.' }
    if ($legacyDashTask -and $fridayDashTask) { Stop-Install 'Zwei Dashboard-Aufgaben gefunden. Bitte zuerst die doppelte Registrierung klaeren.' }
    if ($legacyDashTask -and -not $fridayDashTask) {
        $DashTask = 'JARVIS_Dashboard'
    }
    if ($ChangeVoice) {
        $voiceTask = Get-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction SilentlyContinue
        if (-not (Test-TaskForInstallRoot $voiceTask)) { Stop-Install 'FRIDAY_Voice fehlt oder gehoert zu einem anderen Installationspfad. Update abgebrochen.' }
    }
    foreach ($taskName in @('FRIDAY_WSL_Keepalive','FRIDAY_Qwen','FRIDAY_Voice','FRIDAY_Watchdog')) {
        $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
        if ($task -and -not (Test-TaskForInstallRoot $task)) {
            Stop-Install "Aufgabe $taskName gehoert zu einem anderen Installationspfad. Keine fremde Aufgabe wird ueberschrieben."
        }
    }
    if (-not $ExistingState) { [IO.File]::WriteAllText($StateFile, ($State | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false))) }
}
function Save-State {
    $directory = Split-Path -Parent $StateFile
    if ($directory -and -not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    # Erst vollstaendig daneben schreiben, dann ersetzen: ein Absturz mitten im Schreiben darf den
    # Fortschritt (done[]) nicht auf eine halbe JSON-Datei reduzieren, sonst ist die Fortsetzung weg.
    $temporary = "$StateFile.tmp"
    [IO.File]::WriteAllText($temporary, ($State | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $StateFile) {
        try { [IO.File]::Replace($temporary, $StateFile, [NullString]::Value, $true) }
        catch {
            # Replace braucht NTFS-Semantik; wenn es scheitert, bleibt der Zustand trotzdem erhalten.
            Remove-Item -LiteralPath $StateFile -Force
            [IO.File]::Move($temporary, $StateFile)
        }
    } else {
        [IO.File]::Move($temporary, $StateFile)
    }
    # Sicherung des zuletzt vollstaendig geschriebenen Stands. Ohne sie waere eine durch
    # Datentraegerfehler oder Fremdeingriff unlesbare Datei der Verlust des gesamten Fortschritts.
    try { [IO.File]::Copy($StateFile, "$StateFile.bak", $true) } catch { }
}
function MarkDone($n) {
    $State.done = @(@($State.done) + $n | Select-Object -Unique); Save-State
    Write-GuiEvent 'step' @{ state = 'done'; step = $n }
}
if ($GuiMode -and -not (IsDone 'voicepython')) {
    # The one-use GUI request is removed before provisioning. Preserve only
    # nonsecret answers so a WSL reboot can restore decisions made in the wizard.
    $State.gui_pending = @{}
    foreach ($key in @('ownerName','about','address','character','length','inputDevice','outputDevice',
                      'voiceMode','voiceChoice','voiceReference','voiceId','conversationBackend','qwenRegion','qwenConsent','migrateLegacy','disableLegacy',
                      'reuseDistro','disableForeignTasks','overwriteDashboardConfig','keepIdentity',
                      'repeatEnrollment','openBrowser')) {
        $State.gui_pending[$key] = [string]$GuiConfig.answers.$key
    }
    Save-State
}

Title 'F.R.I.D.A.Y. – Installation'
Info 'Dieser Assistent richtet F.R.I.D.A.Y., deinen persönlichen Sprachassistenten, komplett ein. Du wirst nur nach wenigen Dingen gefragt.'
Info 'Dauer: ca. 45–90 Minuten (viele Downloads). Unterbrechen ist kein Problem – einfach neu starten.'

# ================================================================ 0 Name und Wake Word des Assistenten (VOR allen Aufnahmen und Konfigurationsdateien)
# Name und Wake Word werden einmal gefragt, bei Fortsetzung wiederverwendet. Das Wake Word wird IMMER frei gefragt (Standard
# "Hey <Name>"), nicht aus dem Namen abgeleitet. Aendern ohne Zusatzaufwand nur, solange noch keine Stimmaufnahmen existieren;
# danach ueber change-assistant-name.bat (-ChangeName): Aufnahme, Wake-Word-Training und Sprachdienst werden wiederholt.
function Sync-PersonaIdentity($name, $phrase) {
    # persona.json (Quelle fuer Hermes SOUL.md und voice.json) traegt Name und Wake Phrase.
    $pf = "$Root\config\persona.json"
    if (-not (Test-Path $pf)) { return }
    $pj = Get-Content $pf -Raw | ConvertFrom-Json
    if ("$($pj.assistant_name)" -ceq $name -and "$($pj.wake_phrase)" -ceq $phrase) { return }
    $pj | Add-Member -NotePropertyName assistant_name -NotePropertyValue $name -Force
    $pj | Add-Member -NotePropertyName wake_phrase -NotePropertyValue $phrase -Force
    [IO.File]::WriteAllText($pf, ($pj | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}
function Update-PersonaIdentity($newName, $newPhrase, [string[]]$redo) {
    # persona.json, SOUL.md (Hermes) und voice.json tragen den alten Namen/die alte Phrase: ersetzen, die abhaengigen Schritte wiederholen.
    Sync-PersonaIdentity $newName $newPhrase
    $State.done = @(@($State.done) | Where-Object { $_ -notin $redo })
    Save-State
}
function Initialize-WakeSettings {
    # Zustand aus der Zeit vor dem frei waehlbaren Wake Word (und alter Ordnername wake_slug = Namens-Slug) auf die Phrase bringen.
    if (-not $State.assistant_name) { return }
    $phrase = if (Test-WakePhrase $State.wake_phrase) { Format-WakePhrase $State.wake_phrase } else { "Hey $($State.assistant_name)" }
    if ($State.wake_phrase -cne $phrase -or $State.wake_slug -cne (Get-WakeSlug $phrase)) { Set-AssistantIdentity $State.assistant_name $phrase }
    Sync-PersonaIdentity $State.assistant_name $State.wake_phrase
}
$recordingsExist = (IsDone 'enroll') -or [bool](Get-ChildItem "$Root\voice\profiles\owner\raw" -Recurse -Filter *.wav -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $CustomRoot -or -not $ExistingState) { Initialize-WakeSettings }
$oldName = $null; $oldPhrase = $null
if ($ChangeName -and $State.assistant_name) {
    $oldName = $State.assistant_name; $oldPhrase = $State.wake_phrase
    foreach ($k in 'assistant_name', 'wake_phrase', 'wake_slug', 'wake_engine') { $State.Remove($k) }
    Save-State
    Info "Bisher: Name $oldName, Wake Word '$oldPhrase'. Du kannst beides ändern (Enter = beibehalten)."
}
if (-not $State.assistant_name) {
    Title 'Dein Assistent'
    # Installation aus der Zeit vor der Namensabfrage (persona.json ohne assistant_name): der Assistent hieß Jarvis, Wake Word "Hey Jarvis".
    $legacy = (-not $oldName) -and ((IsDone 'persona') -or $recordingsExist)
    $prev = if ($oldName) { $oldName } elseif ($legacy) { 'Jarvis' } else { $null }
    $prevPhrase = if ($oldName) { if ($oldPhrase) { $oldPhrase } else { "Hey $oldName" } } elseif ($legacy) { 'Hey Jarvis' } else { $null }
    if ($legacy) {
        Info "Vorhandene Installation erkannt: Der Assistent heißt bisher $prev, Wake Word '$prevPhrase' (Enter = beibehalten)."
    } elseif (-not $oldName) {
        Info 'Standardmäßig heißt dein Assistent Friday (F.R.I.D.A.Y., der Nachfolger von J.A.R.V.I.S.) und hört auf "Hey Friday".'
        Info 'Du kannst ihm jetzt einen eigenen Namen geben, z. B. Jarvis, James oder Frida.'
    }
    $new = Read-AssistantName $(if ($prev) { $prev } else { $DefaultName })
    if (-not $legacy -and -not $oldName) {
        Info 'Das Wake Word ist frei wählbar: ein Wort oder ein kurzer Satz (1 bis 4 Wörter), z. B. "Hey Friday", "Computer" oder "Guten Morgen Friday".'
        Info 'Nur "Hey Jarvis" nutzt ein fertiges Modell. Jedes andere Wake Word lernt dein PC aus deinen eigenen Aufnahmen (lokal, einige Minuten Rechenzeit); zwei Silben oder mehr und ein markanter Klang werden zuverlässiger erkannt.'
    }
    $defaultPhrase = if ($prevPhrase -and $new -eq $prev) { $prevPhrase } else { "Hey $new" }
    $newPhrase = Read-WakePhrase $new $defaultPhrase
    Set-AssistantIdentity $new $newPhrase
    if ($prev) {
        $nameChanged = ($new -ne $prev)
        $phraseChanged = ((Get-WakeKey $newPhrase) -ne (Get-WakeKey $prevPhrase))
        $redo = @()
        if ($nameChanged) { $redo = @('hermes', 'voicepython') } elseif ($phraseChanged) { $redo = @('voicepython') }
        if (($nameChanged -or $phraseChanged) -and $recordingsExist) { $redo += @('enroll', 'voiceservice') }
        elseif (-not ($nameChanged -or $phraseChanged) -and $oldName -and (YesNo 'Name und Wake Word unverändert. Stimmaufnahme trotzdem wiederholen?' $false)) {
            $redo = @('enroll', 'voiceservice')
        }
        Update-PersonaIdentity $new $newPhrase $redo
        if ($redo.Count -gt 0) { Warn 'Die abhängigen Schritte (Hermes-Persönlichkeit, Sprachmodell-Konfiguration, ggf. Stimmaufnahme, Wake-Word-Training und Sprachdienst) werden jetzt mit diesen Angaben erneut durchlaufen.' }
    }
    Ok "Dein Assistent heißt $($State.assistant_name) – Wake Word: '$($State.wake_phrase)'."
} elseif (-not $Resume -and -not $recordingsExist) {
    Info "Dein Assistent heißt $($State.assistant_name) (Wake Word '$($State.wake_phrase)')."
    if (-not (YesNo 'Name und Wake Word beibehalten?')) {
        $new = Read-AssistantName $State.assistant_name
        $newPhrase = Read-WakePhrase $new $(if ($new -eq $State.assistant_name) { $State.wake_phrase } else { "Hey $new" })
        if ($new -ne $State.assistant_name -or (Get-WakeKey $newPhrase) -ne (Get-WakeKey $State.wake_phrase)) {
            Set-AssistantIdentity $new $newPhrase
            Update-PersonaIdentity $new $newPhrase @('hermes', 'voicepython')
            Ok "Dein Assistent heißt jetzt $new – Wake Word: '$newPhrase'."
        }
    }
}
$AN = $State.assistant_name
$WP = $State.wake_phrase
$Slug = $State.wake_slug
$WakeShort = Get-WakeShort $WP

if ($CustomRoot -and $ChangeVoice) {
    $voiceBackup = "$Root\backups\voice-change-$(Get-Date -Format yyyyMMdd-HHmmss)"
    try {
        New-Item -ItemType Directory -Path $voiceBackup -ErrorAction Stop | Out-Null
        Copy-Item -LiteralPath $StateFile -Destination "$voiceBackup\install-state.json" -ErrorAction Stop
        Copy-Item -LiteralPath "$Root\config\voice.json" -Destination "$voiceBackup\voice.json" -ErrorAction Stop
        $referenceDir = "$Root\config\voice-references"
        if (Test-Path -LiteralPath $referenceDir -PathType Container) {
            Copy-Item -LiteralPath $referenceDir -Destination "$voiceBackup\voice-references" -Recurse -ErrorAction Stop
        }
    } catch { Stop-Install "Stimmen-Sicherung fehlgeschlagen: $($_.Exception.Message)" }
    # Vor der Moduswahl sichern: dort wird der neue Modus gespeichert und FRIDAY_Qwen fuer ElevenLabs schon abgeschaltet.
    $qwenBefore = Get-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction SilentlyContinue
    $script:VoiceChangeRollback = @{
        Backup      = $voiceBackup
        QwenEnabled = [bool]($qwenBefore -and (Test-TaskForInstallRoot $qwenBefore) -and $qwenBefore.State -ne 'Disabled')
    }
    Ok "Bisherige Stimmkonfiguration gesichert: $voiceBackup"
}
if (-not $UpdateDashboard -and ($ChangeVoice -or $State.voice_mode -notin @('local', 'elevenlabs') -or -not (IsDone 'preflight'))) {
    Title 'Sprachbetrieb wählen'
    Info '1  Lokal: Sprachmodelle auf NVIDIA-GPU mit mindestens 6 GB VRAM'
    Info '2  ElevenLabs Cloud: Spracherkennung und Sprachausgabe ohne lokale GPU (API-Schlüssel nötig)'
    $defaultMode = if ($State.voice_mode -eq 'elevenlabs') { '2' } else { '1' }
    do {
        $answer = $(if ($GuiMode) { Gui-Answer 'voiceMode' } else { Read-Host "  Sprachbetrieb [1/2, Standard $defaultMode]" }).Trim()
        if (-not $answer) { $answer = $defaultMode }
    } while ($answer -notin @('1', '2'))
    $newMode = if ($answer -eq '2') { 'elevenlabs' } else { 'local' }
    if ($State.voice_mode -ne $newMode) {
        $State.voice_mode_changed = $true
        $redoSteps = if ($newMode -eq 'local') { @('preflight', 'qwen', 'voicepython', 'voiceservice') }
                     else { @('voicepython', 'voiceservice') }
        $State.done = @(@($State.done) | Where-Object { $_ -notin $redoSteps })
        if ($newMode -eq 'elevenlabs') {
            $qwenTask = Get-ScheduledTask -TaskName 'FRIDAY_Qwen' -ErrorAction SilentlyContinue
            if ($qwenTask -and (Test-TaskForInstallRoot $qwenTask)) {
                Stop-LauncherService 'FRIDAY_Qwen' 'start-qwen-server.ps1' "*llama-server*--port $($Ports.Qwen)*" $Root $ProcessRoots
                Disable-ScheduledTask -TaskName 'FRIDAY_Qwen' | Out-Null
            }
        }
    }
    $State.voice_mode = $newMode
    if ($newMode -eq 'elevenlabs') {
        Info 'ElevenLabs Voice ID: Standardstimme oder eigene Voice ID aus deinem ElevenLabs-Konto.'
        Warn 'Die Standardstimme ist eine Bibliotheksstimme. ElevenLabs sperrt deren API-Nutzung im Free-Tarif; dafuer ist ein geeigneter Tarif erforderlich.'
        $voiceId = $(if ($GuiMode) { Gui-Answer 'voiceId' } else { Read-Host '  Voice ID (leer = Standardstimme)' }).Trim()
        if (-not $voiceId) { $voiceId = if ($State.elevenlabs_voice_id) { $State.elevenlabs_voice_id } else { '21m00Tcm4TlvDq8ikWAM' } }
        if ($voiceId -notmatch '^[A-Za-z0-9]{10,64}$') { Stop-Install 'ElevenLabs Voice ID ist ungueltig.' }
        $State.elevenlabs_voice_id = $voiceId
    }
    Info 'Gespräch: 1  Lokal   2  Qwen Audio Live-Gespräch (Alibaba Token Plan, Internet nötig; Wake Word, Sprecherprüfung und Stimme bleiben lokal)'
    $defaultConversation = if ($State.conversation_backend -eq 'qwen') { '2' } else { '1' }
    do {
        $answer = $(if ($GuiMode) { Gui-Answer 'conversationBackend' } else { Read-Host "  Gespräch [1/2, Standard $defaultConversation]" }).Trim()
        if (-not $answer) { $answer = $defaultConversation }
    } while ($answer -notin @('1', '2'))
    $newConversation = if ($answer -eq '2') { 'qwen' } else { 'local' }
    $newRegion = if ($State.qwen_region -eq 'cn-beijing') { 'cn-beijing' } else { 'ap-southeast-1' }
    if ($newConversation -eq 'qwen') {
        $defaultRegion = if ($newRegion -eq 'cn-beijing') { '2' } else { '1' }
        do {
            $answer = $(if ($GuiMode) { Gui-Answer 'qwenRegion' } else { Read-Host "  Alibaba-Region: 1 International (Singapur), 2 China (Peking) [Standard $defaultRegion]" }).Trim()
            if (-not $answer) { $answer = $defaultRegion }
        } while ($answer -notin @('1', '2'))
        $newRegion = if ($answer -eq '2') { 'cn-beijing' } else { 'ap-southeast-1' }
        Info 'Qwen Audio sendet für das Live-Gespräch Sprache und Gesprächsinhalte an Alibaba Cloud (Token Plan). Wake Word, Sprecherprüfung und Stimme bleiben auf diesem PC.'
        if (-not (YesNo 'Zustimmung Qwen Audio: Sprache und Gesprächsinhalte an Alibaba Cloud übertragen?' $false)) {
            Warn 'Ohne Zustimmung bleibt das Gespräch lokal.'
            $newConversation = 'local'
        }
    }
    $newConsent = ($newConversation -eq 'qwen')
    if ([string]$State.conversation_backend -ne $newConversation -or [string]$State.qwen_region -ne $newRegion -or [bool]$State.qwen_consent -ne $newConsent) {
        # voice.json entsteht im Schritt voicepython; danach muss der Sprachdienst neu starten.
        $State.done = @(@($State.done) | Where-Object { $_ -notin @('voicepython', 'voiceservice') })
    }
    $State.conversation_backend = $newConversation
    $State.qwen_consent = $newConsent
    $State.qwen_region = $newRegion
    Save-State
}

if ($State.voice_mode -eq 'elevenlabs' -and $State.voice_choice -notin @('friday-female', 'classic')) {
    $State.voice_choice = 'friday-female'
    Save-State
}
if (-not $UpdateDashboard -and $State.voice_mode -ne 'elevenlabs' -and
    ($ChangeVoice -or $State.voice_choice -notin @('friday-female', 'classic', 'custom'))) {
    Title 'Ausgabestimme wählen'
    Info '1  F.R.I.D.A.Y. (weiblich)'
    Info '2  J.A.R.V.I.S. (männlich)'
    Info '3  Eigene MP3/WAV'
    $classicSaved = $State['voice_reference_classic']
    if (-not $classicSaved -and $State.voice_choice -eq 'classic') { $classicSaved = $State.voice_reference }
    $classicAvailable = Find-VoiceReference 'classic' $classicSaved $Root $PSScriptRoot
    if (-not $classicAvailable -and -not (Test-Path "$PSScriptRoot\voice_models\jarvis_de.onnx") -and
        -not (Test-Path "$Inst\voice_models\jarvis_de.onnx")) {
        Warn 'Ohne eigene J.A.R.V.I.S.-Referenz/ONNX klingt Option 2 heller (Thorsten mit Filmfilter).'
    }
    $defaultChoice = if ($State.voice_choice -eq 'classic') { '2' } elseif ($State.voice_choice -eq 'custom') { '3' } elseif ($State.voice_choice -eq 'friday-female') { '1' } elseif ($AN -eq 'Jarvis') { '2' } else { '1' }
    do {
        $answer = $(if ($GuiMode) { Gui-Answer 'voiceChoice' } else { Read-Host "  Stimme [1-3, Standard $defaultChoice]" }).Trim()
        if (-not $answer) { $answer = $defaultChoice }
    } while ($answer -notin @('1', '2', '3'))
    # Option 3 hat einen eigenen Stimmplatz (custom): Persona, Referenzpaare, fast_tts und der Stimm-Endpunkt
    # kennen ihn. Damit bleibt die beiliegende Referenz unberuehrt, wenn spaeter auf F.R.I.D.A.Y. zurueck
    # gewechselt wird.
    $newChoice = if ($answer -eq '2') { 'classic' } elseif ($answer -eq '3') { 'custom' } else { 'friday-female' }
    $ownReference = ($newChoice -eq 'custom')
    $reference = ''
    if ($State.voice_mode -eq 'local' -and $newChoice -in @('friday-female', 'classic', 'custom')) {
        $choiceReference = $State["voice_reference_$newChoice"]
        if (-not $choiceReference -and $State.voice_choice -eq $newChoice) { $choiceReference = $State.voice_reference }
        if ($ownReference) {
            $prompt = '  Pfad zur eigenen MP3/WAV (3 bis 30 Sekunden, Pflichtfeld)'
            $reference = $(if ($GuiMode) { Gui-Answer 'voiceReference' } else { Read-Host $prompt }).Trim().Trim('"')
            if (-not $reference) { Stop-Install "Für 'Eigene MP3/WAV' wird eine Stimmdatei benötigt. Installation erneut starten und den Pfad angeben." }
            $voiceFile = Test-VoiceReferenceFile $reference
            if (-not $voiceFile.Ok) { Stop-Install "Stimmdatei ist nicht verwendbar: $reference ($($voiceFile.Reason))" }
        } else {
            $defaultReference = Find-VoiceReference $newChoice $choiceReference $Root $PSScriptRoot
            if ($defaultReference) { Info "Stimmreferenz wird automatisch verwendet: $defaultReference" }
            $reference = $(if ($GuiMode) { Gui-Answer 'voiceReference' } else { Read-Host '  Andere MP3/WAV-Stimmreferenz (leer = angezeigte Stimme oder Piper-Basisstimme)' }).Trim().Trim('"')
            if (-not $reference) { $reference = $defaultReference }
            if ($reference) {
                $voiceFile = Test-VoiceReferenceFile $reference
                if (-not $voiceFile.Ok) { Stop-Install "Stimmreferenz ist nicht verwendbar: $reference ($($voiceFile.Reason))" }
            }
            if (-not $reference) { Warn 'Ohne Referenz wird die passende Piper-Basisstimme installiert. Du kannst später mit change-voice.bat eine eigene Referenz wählen.' }
        }
    }
    $changed = $State.voice_choice -ne $newChoice -or $State.voice_reference -ne $reference
    $State.voice_choice = $newChoice
    $State.voice_reference = $reference
    # Der eigene Platz speichert seine Referenz unter seinem eigenen Schluessel, damit ein erneuter Lauf sie
    # wiederfindet und ein Zurueckwechseln die beiliegende Stimme unberuehrt laesst. voice_reference_own bleibt
    # als Altlast-Alias erhalten.
    $State["voice_reference_$newChoice"] = $reference
    if ($ownReference) { $State['voice_reference_own'] = $reference }
    if (($changed -or $ChangeVoice) -and (IsDone 'voicepython')) {
        $State.done = @(@($State.done) | Where-Object { $_ -notin @('voicepython', 'voiceservice') })
        Warn 'Die Ausgabestimme wird neu eingerichtet; vorhandene persönliche Aufnahmen bleiben erhalten.'
    }
    Save-State
}

# ================================================================ 1 Systemcheck
if (-not (IsDone 'preflight')) {
    Enter-Step 'preflight'
    Title 'Schritt 1/15 – Systemcheck'
    $build = [Environment]::OSVersion.Version.Build
    $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    $cores = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
    $installDrive = $Root.Substring(0, 1)
    $freeGB = [math]::Round((Get-Volume -DriveLetter $installDrive).SizeRemaining / 1GB)
    Info "Windows-Build $build | RAM $ramGB GB | $cores Threads | ${installDrive}: $freeGB GB frei"
    if ($build -lt 19041) { Stop-Install 'Windows ist zu alt für WSL2. Bitte Windows aktualisieren.' }
    if ($freeGB -lt 40) { Stop-Install "Auf ${installDrive}: sind nur $freeGB GB frei – mindestens 40 GB werden gebraucht." }
    $gpu = @{ nvidia = $false; name = 'keine NVIDIA-GPU'; vram_mb = 0; driver = ''; cc = 0.0 }
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        $q = (& nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
        $p = @(if ($q) { "$q" -split ',\s*' })
        if ($p.Count -lt 4 -or $p[1] -notmatch '^\d+$') {
            # Aeltere Treiber kennen compute_cap nicht (Fehlertext auf stdout): ohne das Feld erneut abfragen, cc=0 -> CUDA-12.4-Build.
            $q = (& nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>$null | Select-Object -First 1)
            $p = @(if ($q) { "$q" -split ',\s*' })
            if ($p.Count -ge 3) { $p += '0' }
        }
        if ($p.Count -ge 4 -and $p[1] -match '^\d+$') {
            $gpu = @{ nvidia = $true; name = $p[0]; vram_mb = [int]$p[1]; driver = $p[2]; cc = [double]($p[3] -replace ',', '.') }
        }
    }
    Info "Grafikkarte: $($gpu.name) | VRAM $($gpu.vram_mb) MB | Treiber $($gpu.driver) | Compute $($gpu.cc)"
    if ($State.voice_mode -eq 'local' -and (-not $gpu.nvidia -or [int]$gpu.vram_mb -lt 6144)) {
        Stop-Install 'Lokale Sprache erfordert eine NVIDIA-GPU mit mindestens 6 GB VRAM. Bitte ElevenLabs Cloud wählen.'
    }
    try { Invoke-WebRequest -UseBasicParsing https://huggingface.co -Method Head -TimeoutSec 15 | Out-Null; Ok 'Internet erreichbar' }
    catch { Stop-Install 'Keine Internetverbindung.' }
    $State.build = $build; $State.ram_gb = $ramGB; $State.cores = $cores; $State.gpu = $gpu
    MarkDone 'preflight'
}
if ($State.voice_mode -eq 'local' -and (-not $State.gpu.nvidia -or [int]$State.gpu.vram_mb -lt 6144)) {
    Stop-Install 'Lokale Sprache erfordert eine NVIDIA-GPU mit mindestens 6 GB VRAM. Bitte ElevenLabs Cloud wählen.'
}

# ================================================================ 2 Dateien
# Bei jedem Start synchronisieren, solange das Skript nicht aus dem Ziel-Installerordner laeuft: ein aktualisiertes Paket
# muss die dort liegenden Kopien (WSL-Skripte, Voice-Dateien) ersetzen, auch wenn der Schritt schon erledigt ist.
if (-not (IsDone 'files') -or $PSScriptRoot -ne $Inst) {
    Enter-Step 'files'
    Title "Schritt 2/15 – Installationsdateien nach $Root kopieren"
    if ($PSScriptRoot -ne $Inst) {
        # Tests, Testdaten und Caches gehoeren nicht ins Installationsziel (REL-06.03); kein Produktcode liest sie.
        & robocopy.exe $PSScriptRoot $Inst /E /XD tests test fixtures __pycache__ .pytest_cache /XF test_*.py *.Tests.ps1 *.test.ps1 test_*.sh test-find-obsidian-install.ps1 /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Install "Kopieren der Installationsdateien fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    Ok "Dateien liegen in $Inst"
    MarkDone 'files'
}
# Uebernahme einer alten Installation (nur wenn Phasen offen sind): Hermes in Ubuntu umstellen, Qwen starten - braucht die Skripte aus Schritt 2.
if (-not $CustomRoot) { Invoke-MigrationWsl }
# Quelle des Command Centers (Ordner ueber installer\) merken: nach einem Neustart laeuft das Skript aus dem Ziel-Installerordner,
# wo die Quellen nicht liegen. Schritt 15 findet sie dann ueber install-state.json (dashboard_source).
if ($PSScriptRoot -ne $Inst) {
    $repoCand = (Split-Path $PSScriptRoot -Parent).TrimEnd('\')
    if ((Test-Path "$repoCand\pnpm-workspace.yaml") -and (Test-Path "$repoCand\apps\control-api\package.json") -and $State.dashboard_source -ne $repoCand) {
        $State.dashboard_source = $repoCand; Save-State
    }
}

# Aktualisierte Voice-Dateien muessen auch eine bestehende Installation erreichen (Schritt 12 laeuft nur einmal): Hash-Vergleich
# je Datei, geaendert -> nach $Root\voice kopieren (profiles, models, .venv bleiben unberuehrt) und den Sprachdienst neu starten,
# falls er lief.
function Sync-VoiceFiles {
    $src = "$Inst\voice"; $dst = "$Root\voice"
    if (-not (Test-Path "$dst\.venv\Scripts\python.exe") -or -not (Test-Path $src)) { return }
    $changed = @(Get-ChildItem $src -File | Where-Object {
        -not (Test-Path "$dst\$($_.Name)") -or (Sha256 $_.FullName) -ne (Sha256 "$dst\$($_.Name)") })
    if ($changed.Count -eq 0) { return }
    Info "Sprachdateien im Paket sind neuer: $(($changed | ForEach-Object { $_.Name }) -join ', ')"
    if ($changed.Name -contains 'calendar_voice.py' -or $changed.Name -contains 'friday_voice.py') {
        $voicePython = "$dst\.venv\Scripts\python.exe"
        & $voicePython -c "from zoneinfo import ZoneInfo; ZoneInfo('Europe/Berlin')" *> $null
        if ($LASTEXITCODE -ne 0) {
            & $voicePython -m pip install -q tzdata *> $null
            if ($LASTEXITCODE -ne 0) { Warn 'Zeitzonendaten fehlen: Sprachtermine koennen bis zur Installation von tzdata nicht angelegt werden.' }
        }
    }
    $wasRunning = Test-VoiceServiceRunning
    if ($wasRunning) { Stop-VoiceService }
    $changed | ForEach-Object { Copy-Item $_.FullName "$dst\$($_.Name)" -Force }
    Ok "$($changed.Count) Sprachdatei(en) nach $dst aktualisiert."
    if ($wasRunning) {
        if (Get-ScheduledTask -TaskName 'FRIDAY_Voice' -ErrorAction SilentlyContinue) {
            Start-ScheduledTask -TaskName 'FRIDAY_Voice'
            Ok 'Sprachdienst mit den neuen Dateien neu gestartet (lädt die Modelle, ca. 1-3 Minuten).'
        } else { Warn 'Aufgabe FRIDAY_Voice fehlt - Sprachdienst nicht neu gestartet. install-friday.bat mit entferntem Eintrag "voiceservice" in install-state.json starten.' }
    }
}
Sync-VoiceFiles

# ================================================================ 3 WSL-Grundlage (ggf. Neustart)
if (-not (IsDone 'wslfeature')) {
    Enter-Step 'wslfeature'
    Title 'Schritt 3/15 – WSL2 (Linux-Subsystem) vorbereiten'
    Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--status') -TimeoutSeconds 120 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Info 'WSL wird installiert …'
        Native { wsl.exe --install --no-distribution } | ForEach-Object { Info $_ }
        if ($GuiMode) {
            $resumeArgs = "-NoProfile -STA -ExecutionPolicy Bypass -File `"$Inst\install-friday-gui.ps1`" -ResumeRoot `"$Root`""
        } else {
            $resumeArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$Inst\install-friday.ps1`" -Resume -InstallRoot `"$Root`""
            if ($CustomRoot) { $resumeArgs += " -DistroName `"$Distro`" -DistroLocation `"$DistroLocation`"" }
        }
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $resumeArgs
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $ResumeTask -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
        Warn 'Windows muss jetzt neu starten. Danach geht die Installation automatisch weiter.'
        Stop-Transcript | Out-Null
        if (-not $GuiMode -and (YesNo 'Jetzt neu starten?')) { Restart-Computer -Force }
        if ($GuiMode) { exit 10 }
        exit
    }
    # WSL-Update nur, wenn es nicht abgeschaltet wurde, mit Zeitlimit und ohne Abbruch des Laufs:
    # eine alte, aber funktionierende WSL darf die Installation nicht blockieren (Regression 2026-10-22).
    if ($SkipWslUpdate) {
        Info 'WSL-Update uebersprungen (--SkipWslUpdate).'
    } else {
        $updateRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--update') -TimeoutSeconds 600
        if ($updateRun.TimedOut) {
            Warn 'WSL-Update nach 600 s abgebrochen; die vorhandene WSL bleibt in Benutzung.'
        } elseif ($updateRun.ExitCode -ne 0) {
            Warn "WSL-Update meldete Exitcode $($updateRun.ExitCode); die vorhandene WSL bleibt in Benutzung."
        }
    }
    $versionRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--version') -TimeoutSeconds 120
Ok "WSL bereit: $(@("$($versionRun.StdOut)" -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1))"
    MarkDone 'wslfeature'
}

# ================================================================ 4 Energie
if (-not (IsDone 'power')) {
    Enter-Step 'power'
    Title 'Schritt 4/15 – Energieoptionen (am Netzteil immer wach bleiben)'
    & powercfg /change standby-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
    & powercfg /setactive SCHEME_CURRENT
    Ok 'Am Netzteil: kein Standby, kein Ruhezustand, Deckel zuklappen = keine Aktion. Bildschirm darf ausgehen.'
    MarkDone 'power'
}

# ================================================================ 5 Persönlichkeit
if (-not (IsDone 'persona')) {
    Enter-Step 'persona'
    Title "Schritt 5/15 – Deine Wünsche an $AN"
    $name = ''
    while (-not $name) { $name = Ask 'Wie heißt du (Vorname)?' }
    $addr = Choose "Wie soll $AN dich ansprechen?" @("Mit 'Sir' und Sie – wie ein britischer Butler", "Mit Vornamen und Sie ($name)", "Mit Vornamen und Du ($name)") 1
    $char = Choose 'Welcher Charakter?' @('Britischer Butler: höflich, elegant, trockener Humor', 'Freundlich und locker', 'Sachlich und knapp') 1
    $len  = Choose 'Wie ausführlich sollen Antworten sein?' @('Kurz und auf den Punkt', 'Ausführlicher') 1
    Info "Optional: Was soll $AN über dich wissen? (Beruf, Firma, Interessen, Familie … – Enter = überspringen)"
    $about = Ask 'Über mich'
    $persona = [ordered]@{
        assistant_name = $AN
        wake_phrase = $WP
        owner_name = $name
        address    = @('sir', 'sie', 'du')[$addr - 1]
        character  = @('butler', 'freundlich', 'sachlich')[$char - 1]
        length     = @('kurz', 'normal')[$len - 1]
        about      = $about
    }
    [IO.File]::WriteAllText("$Root\config\persona.json", ($persona | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Ok "Gespeichert (änderbar in $Root\config\persona.json)."
    MarkDone 'persona'
}

# ================================================================ 6 .wslconfig
if (-not (IsDone 'wslconfig')) {
    Enter-Step 'wslconfig'
    Title 'Schritt 6/15 – WSL-Ressourcen festlegen'
    $cfgFile = "$env:USERPROFILE\.wslconfig"
    $plan = Get-WslConfigPlan -ConfigPath $cfgFile -RunningDistros (Get-RunningWslDistros) -Distro $Distro
    if (-not $plan.Write) {
        Ok 'Vorhandene .wslconfig bleibt unveraendert (gilt fuer alle WSL-Distributionen).'
    } else {
        $lines = Get-FridayWslConfigLines -RamGb $State.ram_gb -Cores $State.cores -Build $State.build
        if ($State.build -lt 22621) { Warn 'Windows-Build < 22621: "mirrored networking" nicht verfügbar – Windows erreicht WSL-Dienste evtl. nur eingeschränkt.' }
        Set-Content -Path $cfgFile -Value $lines -Encoding Ascii
        if ($plan.Shutdown) {
            Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--shutdown') -TimeoutSeconds 120 | Out-Null
            Ok "WSL-Ressourcen gesetzt: $($lines[1]), $($lines[2]), 8 GB Swap."
        } else {
            Warn 'Andere WSL-Distributionen laufen: die neue .wslconfig gilt erst nach dem naechsten WSL-Neustart; WSL wird nicht heruntergefahren.'
        }
    }
    MarkDone 'wslconfig'
}

# ================================================================ 7 Ubuntu
if (-not (IsDone 'distro')) {
    Enter-Step 'distro'
    Title 'Schritt 7/15 – Ubuntu 24.04 installieren'
    # Verteilte Liste ueber das Zeitlimit geholt: ein haengendes wsl.exe blockierte sonst die Frage nach der Distribution.
    $listRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-l', '-q') -TimeoutSeconds 120
    $existing = @(("$($listRun.StdOut)" -split "`r?`n") | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ })
    if ($existing -contains $Distro) {
        if ($CustomRoot -and -not $State.distro_requested) { Stop-Install "Die WSL-Distribution '$Distro' existiert bereits. Frische Installation darf sie nicht uebernehmen." }
        if (-not (YesNo "Es gibt bereits eine WSL-Distribution '$Distro'. Diese verwenden?")) { Stop-Install "Bitte vorhandenes '$Distro' sichern/entfernen oder umbenennen." }
    } else {
        if ($CustomRoot) {
            if ((Test-Path -LiteralPath $DistroLocation -PathType Container) -and
                (Get-ChildItem -LiteralPath $DistroLocation -Force | Select-Object -First 1)) {
                Stop-Install "DistroLocation ist nicht leer: $DistroLocation"
            }
            $State.distro_requested = $true; Save-State
            Native { wsl.exe --install Ubuntu-24.04 --name $Distro --location $DistroLocation --no-launch --web-download } | ForEach-Object { Info $_ }
        } else {
            Native { wsl.exe --install Ubuntu-24.04 --name $Distro --no-launch --web-download } | ForEach-Object { Info $_ }
        }
        # Verteilte Liste ueber das Zeitlimit geholt: ein haengendes wsl.exe blockierte sonst die Frage nach der Distribution.
    $listRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-l', '-q') -TimeoutSeconds 120
    $existing = @(("$($listRun.StdOut)" -split "`r?`n") | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ })
        if ($existing -notcontains $Distro) { Stop-Install 'Ubuntu konnte nicht installiert werden (siehe Meldung oben).' }
    }
    if ($CustomRoot) { Assert-CustomDistroLocation }
    Ok 'Ubuntu ist installiert.'
    MarkDone 'distro'
}
if ($CustomRoot) {
    if (-not ($UpdateDashboard -or $ChangeVoice)) { Assert-CustomDistroLocation }
    # Updates also run WSL helpers; derive their paths from this install root.
    $WslRootPath = Get-WslPath $Root
    $WslInstPath = "$WslRootPath/installer"
    $WslConfigPath = "$WslRootPath/config"
}

# ================================================================ 8 Linux-Benutzer
if (-not (IsDone 'linuxuser')) {
    Enter-Step 'linuxuser'
    Title 'Schritt 8/15 – Linux-Benutzer anlegen'
    Info "$AN läuft in Ubuntu unter einem eigenen Benutzer. Name: nur Kleinbuchstaben/Zahlen."
    $suggest = ($env:USERNAME.ToLower() -replace '[^a-z0-9_-]', '')
    if ($suggest -notmatch '^[a-z_]') { $suggest = 'friday' }
    do {
        $user = Ask 'Linux-Benutzername' $suggest
        if ($GuiMode -and $user -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Ungültiger Linux-Benutzername in der grafischen Installation.' }
    } until ($user -match '^[a-z_][a-z0-9_-]{0,31}$')
    while ($true) {
        $p1 = Plain $(if ($GuiMode) { Gui-Secret 'linuxPassword' } else { Read-Host '  Linux-Passwort (wird für "sudo" gebraucht, gut merken!)' -AsSecureString })
        $p2 = Plain $(if ($GuiMode) { Gui-Secret 'linuxPasswordRepeat' } else { Read-Host '  Passwort wiederholen' -AsSecureString })
        if ($p1 -and $p1 -eq $p2) { break }
        if ($GuiMode) { throw 'Linux-Passwörter fehlen oder stimmen nicht überein.' }
        Warn 'Passwörter leer oder ungleich – bitte nochmal.'
    }
    Info 'Richte Ubuntu ein (Pakete, Benutzer, systemd) – dauert einige Minuten …'
    $out = Wsl-Run 'root' "$WslInstPath/wsl/setup_root.sh" "$user`n$p1"
    $p1 = $null; $p2 = $null
    if ($out -notmatch 'ROOT_SETUP_DONE') { Stop-Install 'Ubuntu-Grundeinrichtung fehlgeschlagen.' }
    Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('--terminate', $Distro) -TimeoutSeconds 120 | Out-Null
    Start-Sleep 3
    $whoRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '--exec', 'whoami') -TimeoutSeconds 60
    $initRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '--exec', 'ps', '-p', '1', '-o', 'comm=') -TimeoutSeconds 60
    $who = @("$($whoRun.StdOut)" -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    $pid1 = @("$($initRun.StdOut)" -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    if ("$who".Trim() -ne $user -or "$pid1".Trim() -ne 'systemd') { Stop-Install "Prüfung fehlgeschlagen (Benutzer='$who', PID1='$pid1')." }
    $State.linux_user = $user
    Ok "Benutzer '$user' aktiv, systemd läuft."
    MarkDone 'linuxuser'
}

# ================================================================ 9 WSL wach halten
if (-not (IsDone 'keepalive')) {
    Enter-Step 'keepalive'
    Title 'Schritt 9/15 – WSL dauerhaft aktiv halten'
    Register-UserTask 'FRIDAY_WSL_Keepalive' "`"$Inst\scripts\wsl-keepalive.vbs`" `"$Distro`"" 'Hält Ubuntu/WSL für Hermes dauerhaft aktiv'
    Start-ScheduledTask -TaskName 'FRIDAY_WSL_Keepalive'
    Ok 'Aufgabe FRIDAY_WSL_Keepalive eingerichtet (startet bei jeder Anmeldung).'
    Assert-WslKeepalive
    MarkDone 'keepalive'
}

# ================================================================ 10 Hermes + KI-Anbieter
if (-not (IsDone 'hermes')) {
    Enter-Step 'hermes'
    Title 'Schritt 10/15 – Hermes Agent + KI-Anbieter'
    # Der Anbieter kommt aus dem Installer statt fest verdrahtet aus Kimi. Verknuepft wird ueber Hermes'
    # eigene Konfiguration (~/.hermes/.env + `hermes config set`) - kein eigener Auth-Stack, damit wir
    # update-fest bleiben. Das Hermes-Dashboard braucht der Nutzer dafuer nie zu oeffnen.
    $detectedKimi = [Environment]::GetEnvironmentVariable('KIMI_API_KEY', 'User')
    $detectedAlibaba = @(@('BAILIAN_API_KEY', 'DASHSCOPE_API_KEY') | ForEach-Object { [Environment]::GetEnvironmentVariable($_, 'User') } | Where-Object { $_ }) | Select-Object -First 1
    if ($GuiMode -and -not $State.model_provider -and -not $GuiConfig.answers.PSObject.Properties['providerChoice']) {
        # Kein stiller Standardanbieter: fehlt die Antwort der Oberflaeche, bricht der Lauf ab, statt
        # eine vom Benutzer nie getroffene Wahl zu installieren.
        Stop-Install 'Die Oberflaeche hat keinen Anbieter uebermittelt.'
    }
    $provider = [string]$State.model_provider
    if (-not $provider) {
        Info 'Wie soll F.R.I.D.A.Y. denken?'
        Info '1  OpenAI      (empfohlen)'
        Info '2  Anthropic   (Claude)'
        Info '3  Erweitert   Alibaba Qwen, DeepSeek, OpenRouter oder eigener OpenAI-kompatibler Server'
        Info '4  Kimi Coding (Moonshot, Modell k3)'
        if ($detectedKimi) { Info '   (Auf diesem PC liegt ein Kimi-Key bereit - er passt zu Option 4.)' }
        if ($detectedAlibaba) { Info '   (Auf diesem PC liegt ein Alibaba-Schlüssel bereit - er passt zu Option 3 mit dem Alibaba Token Plan.)' }
        do {
            $answer = $(if ($GuiMode) { Gui-Answer 'providerChoice' } else { Read-Host '  Anbieter [1-4, Standard 1]' }).Trim()
            if (-not $answer) { $answer = '1' }
            if ($GuiMode -and $answer -notin @('1', '2', '3', '4')) { Stop-Install "Ungueltige Anbieterwahl der Oberflaeche: $answer" }
        } while ($answer -notin @('1', '2', '3', '4'))
        $provider = switch ($answer) { '2' { 'anthropic' } '3' { 'custom' } '4' { 'kimi-coding' } default { 'openai-api' } }
    }
    $modelName = [string]$State.model_name
    $baseUrl = [string]$State.model_base_url
    $key = ''
    if ($GuiMode -and -not $modelName) { $modelName = (Gui-Answer 'modelName').Trim() }
    if ($provider -in @('openai', 'openai-api')) {
        $provider = 'openai-api'
        if (-not $modelName) { $modelName = 'gpt-5' }
        Info "OpenAI - Modell: $modelName"
        Info 'OpenAI-API-Key eingeben (bleibt unsichtbar; wird nur in Ubuntu unter ~/.hermes/.env gespeichert).'
        $key = Plain $(if ($GuiMode) { Gui-Secret 'openaiKey' } else { Read-Host '  OpenAI-API-Key' -AsSecureString })
    } elseif ($provider -eq 'anthropic') {
        if (-not $modelName) { $modelName = 'claude-sonnet-5-5' }
        Info "Anthropic - Modell: $modelName"
        Info 'Anthropic-API-Key eingeben (bleibt unsichtbar; wird nur in Ubuntu unter ~/.hermes/.env gespeichert).'
        $key = Plain $(if ($GuiMode) { Gui-Secret 'anthropicKey' } else { Read-Host '  Anthropic-API-Key' -AsSecureString })
    } elseif ($provider -eq 'kimi-coding') {
        if (-not $modelName) { $modelName = 'k3' }
        $baseUrl = ''
        if ($detectedKimi -and (-not $GuiMode -or (Gui-Answer 'useExistingKimi') -eq 'true')) {
            $key = $detectedKimi
            Info 'Kimi-Code-Zugang auf diesem PC gefunden - eingerichtet wird Modell k3.'
        } else {
            Info 'Kimi-API-Key eingeben (bleibt unsichtbar; wird nur in Ubuntu unter ~/.hermes/.env gespeichert).'
            $key = Plain $(if ($GuiMode) { Gui-Secret 'kimiKey' } else { Read-Host '  Kimi-API-Key' -AsSecureString })
        }
    } else {
        # Hermes 0.22.2 kennt keinen Key-Prefix fuer kimi-coding (nur openrouter ist in
        # KNOWN_PROVIDER_KEY_PREFIXES) und normalisiert "openai" auf einen Aggregator. Diese
        # Zuordnung bleibt daher eine Installer-Heuristik; setup_hermes.sh prueft anschliessend
        # gegen den installierten Katalog, ob der Anbieter ueberhaupt als API-Key-Anbieter existiert.
        if (-not $GuiMode -and $detectedKimi -and $detectedKimi -match '^sk-kimi-') {
            $provider = 'kimi-coding'
            $modelName = 'k3'
            $baseUrl = ''
            $key = $detectedKimi
            Info 'Kimi-Code-Key auf diesem PC gefunden - eingerichtet wird der Kimi-Coding-Zugang (Modell k3).'
        } else {
            Info 'Erweitert - OpenAI-kompatibler Anbieter, z. B. Alibaba Token Plan https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1, DeepSeek https://api.deepseek.com/v1 oder OpenRouter https://openrouter.ai/api/v1'
            do {
                $enteredUrl = $(if ($GuiMode) { Gui-Answer 'modelBaseUrl' } else { Read-Host "  Basis-URL [Standard $baseUrl]" }).Trim()
                if ($enteredUrl) { $baseUrl = $enteredUrl }
                if ($GuiMode -and $baseUrl -notmatch '^https?://') { Stop-Install 'Die Oberflaeche hat keine gueltige Server-Adresse (https://...) uebermittelt.' }
            } while ($baseUrl -notmatch '^https?://')
            if (-not $modelName) {
                $enteredModel = $(if ($GuiMode) { Gui-Answer 'modelName' } else { Read-Host '  Modellname (z. B. deepseek-chat)' }).Trim()
                $modelName = if ($enteredModel) { $enteredModel } else { 'deepseek-chat' }
            }
            if (-not $GuiMode -and $detectedAlibaba -and $baseUrl -match '^https://token-plan\.(ap-southeast-1|cn-beijing)\.maas\.aliyuncs\.com/' -and
                (YesNo 'Auf diesem PC liegt ein Alibaba-Schlüssel (BAILIAN_API_KEY/DASHSCOPE_API_KEY) bereit. Verwenden?' $true)) {
                $key = [string]$detectedAlibaba
                Info 'Alibaba-Schlüssel dieses PCs übernommen.'
            } else {
                Info 'API-Key eingeben (bleibt unsichtbar; wird nur in Ubuntu unter ~/.hermes/.env gespeichert).'
                $key = Plain $(if ($GuiMode) { Gui-Secret 'customKey' } else { Read-Host '  API-Key' -AsSecureString })
            }
            if ($key -and $key -match '^sk-kimi-') {
                $provider = 'kimi-coding'; $modelName = 'k3'; $baseUrl = ''
                Info 'Der eingegebene Key ist ein Kimi-Code-Key - es wird der Kimi-Coding-Zugang (Modell k3) eingerichtet.'
            }
        }
    }
    if (-not $key) { Stop-Install "Ohne API-Key kann $AN nicht denken." }
    if (-not $modelName) { Stop-Install 'Kein Modellname gewaehlt.' }
    $State.model_provider = $provider
    $State.model_name = $modelName
    $State.model_base_url = $baseUrl
    Save-State
    # Datei zuerst leer anlegen und absichern, dann erst den Schluessel hineinschreiben (kein Fenster mit geerbten Rechten);
    # die Rechte werden bei jedem Lauf neu gesetzt, damit ein frueherer Fehlschlag nicht dauerhaft ungeschuetzt bleibt.
    $apiKeyFile = "$Root\config\hermes_api.key"
    if (-not (Test-Path $apiKeyFile)) { New-Item -ItemType File -Path $apiKeyFile | Out-Null }
    & icacls.exe $apiKeyFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" /grant:r 'SYSTEM:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Install "Zugriffsrechte für $apiKeyFile konnten nicht gesetzt werden." }
    if ((Get-Item $apiKeyFile).Length -eq 0) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        [IO.File]::WriteAllText($apiKeyFile, (-join ($bytes | ForEach-Object { $_.ToString('x2') })))
    }
    # One Token Plan key serves the brain and Qwen Audio (U-02); the voice step only asks when no key file exists yet.
    $qwenKeyFile = "$Root\config\alibaba_tokenplan.key.dpapi"
    if (-not $GuiMode -and $State.conversation_backend -eq 'qwen' -and
        $baseUrl -match '^https://token-plan\.(ap-southeast-1|cn-beijing)\.maas\.aliyuncs\.com/' -and
        -not (Test-Path -LiteralPath $qwenKeyFile -PathType Leaf)) {
        $brainRegion = $Matches[1]
        if (YesNo 'Gleichen Alibaba-Schlüssel auch für Qwen Audio (Live-Gespräch) verwenden?' $true) {
            ConvertTo-SecureString -String $key -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $qwenKeyFile -Encoding Ascii
            $State.qwen_region = $brainRegion
            Save-State
            Ok 'Qwen Audio nutzt den Schlüssel des Denkmodells (verschlüsselt für diesen Windows-Benutzer gespeichert).'
        }
    }
    # Anbieter, Modell und Basis-URL gehen ueber eine eigene Datei im Austauschordner (keine Secrets),
    # der Key weiterhin ueber stdin - so taucht er in keiner Prozessliste auf. Datei danach loeschen.
    $modelSetupFile = "$Root\exchange\model-setup.env"
    New-Item -ItemType Directory -Force (Split-Path $modelSetupFile) | Out-Null
    $modelSetupLines = @("FRIDAY_MODEL_PROVIDER=$provider", "FRIDAY_MODEL_NAME=$modelName", "FRIDAY_MODEL_BASE_URL=$baseUrl")
    [IO.File]::WriteAllText($modelSetupFile, (($modelSetupLines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
    Info "Installiere Hermes, verbinde $provider, richte Persönlichkeit, Kanban, Dashboard und Gateway ein (10–20 min) …"
    try {
        $out = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_hermes.sh" $key
    } finally {
        $key = $null
        Remove-Item -LiteralPath $modelSetupFile -Force -ErrorAction SilentlyContinue
    }
    if ($out -notmatch 'HERMES_SETUP_DONE') { Stop-Install 'Hermes-Einrichtung fehlgeschlagen (siehe graue Ausgabe oben).' }
    if ($out -match 'MODEL_OK') { Ok "KI-Anbieter $provider antwortet (Modell $modelName)." }
    else { Warn 'Antwort-Test nicht bestanden - Key und Modellname pruefen. Spaeter im Command Center unter Einstellungen aenderbar.' }
    if (Wait-Http "http://127.0.0.1:$($Ports.Dashboard)/" 60) { Ok "Dashboard von Windows erreichbar: http://127.0.0.1:$($Ports.Dashboard)" }
    else { Warn 'Dashboard von Windows nicht erreichbar (mirrored networking?).' }
    MarkDone 'hermes'
}

# Friday-Skills come from the separate versioned repository. Recheck on updates;
# A local vault is the default even if Obsidian is closed. Existing vaults are preserved.
if (-not $ChangeVoice -and (IsDone 'hermes')) {
    Title 'Obsidian-Gedächtnis einrichten und prüfen'
    $obsidianSetup = Join-Path $PSScriptRoot 'setup-obsidian.ps1'
    if (-not (Test-Path -LiteralPath $obsidianSetup -PathType Leaf)) { Stop-Install 'Obsidian-Setup fehlt im Installer.' }
    try {
        $obsidianResult = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $obsidianSetup -Action ensure -InstallRoot $Root |
            Select-Object -Last 1 | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $obsidianResult.readable -or -not $obsidianResult.applied) {
            Stop-Install 'Obsidian-Vault ist in Friday-Ubuntu nicht einsatzbereit.'
        }
        Ok "Obsidian-Vault bereit: $($obsidianResult.path)"
    } catch { Stop-Install "Obsidian-Einrichtung fehlgeschlagen: $($_.Exception.Message)" }
}
# a failed fetch leaves the previous checkout and Hermes built-ins untouched.
if (-not $ChangeVoice -and ((-not (IsDone 'skills')) -or $UpdateDashboard)) {
    Title 'Friday-Skills einrichten und pruefen'
    $out = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_skills.sh"
    $skillsReady = $out -match 'FRIDAY_SKILLS_READY count=(\d+)'
    $commitReported = $out -match 'FRIDAY_SKILLS_COMMIT ([0-9a-f]{40})'
    $skillsCommit = if ($commitReported) { $Matches[1] } else { '' }
    if ($skillsReady -and $commitReported) {
        $State.skills_commit = $skillsCommit
        MarkDone 'skills'
        Ok "Friday-Skills validiert: $($State.skills_commit). Hermes-Standardskills bleiben bei Hermes."
    } else {
        Warn "Friday-Skills fehlen oder sind unvollstaendig. Reparatur: install-friday.ps1 -UpdateDashboard -InstallRoot '$Root' erneut ausfuehren. Diagnose: wsl.exe -d $Distro -u $($State.linux_user) --exec env FRIDAY_ROOT=$WslRootPath FRIDAY_INSTALLER=$WslInstPath bash $WslInstPath/wsl/setup_skills.sh status"
        $State.done = @($State.done | Where-Object { $_ -ne 'skills' }); Save-State
    }
}
$readiness = 'nicht geprueft (Stimmenwechsel)'
$vaultStatus = 'nicht geprueft (Stimmenwechsel)'
if (-not $ChangeVoice) {
    Title 'Hermes-PowerPoint-Voraussetzung einrichten'
    $powerpointSetup = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_powerpoint.sh"
    if ($powerpointSetup -match 'FRIDAY_POWERPOINT_READY') {
        Ok 'PowerPoint-Bibliothek fuer Hermes in WSL verfuegbar.'
    } else {
        Warn 'PowerPoint-Bibliothek nicht einsatzbereit. Deck-Erstellung spaeter nach Anleitung reparieren; optionale Renderer werden nicht automatisch installiert.'
    }
    Title 'Skill-Voraussetzungen (nur Diagnose)'
    $readiness = Wsl-Run $State.linux_user "$WslInstPath/wsl/check_skill_readiness.sh"
    $vault = [Environment]::GetEnvironmentVariable('FRIDAY_OBSIDIAN_VAULT', 'User')
    if ($vault -and (Test-Path -LiteralPath $vault -PathType Container) -and
        (Test-Path -LiteralPath (Join-Path $vault '.obsidian') -PathType Container)) {
        $vaultStatus = "gefunden: $vault"
        Ok "Obsidian-Vault gefunden: $vault"
    } else {
        $vaultStatus = 'nicht verifiziert'
        Warn 'Obsidian-Vault nicht verifiziert: FRIDAY_OBSIDIAN_VAULT muss auf einen Ordner mit .obsidian zeigen.'
    }
    Info 'CLI-/Renderer-Fund, Vault-Pfad und Treiberpruefung beweisen keine Kontobindung oder Live-Ausfuehrung.'
}

# ================================================================ 11 Qwen lokal
if (-not (IsDone 'qwen')) {
    Enter-Step 'qwen'
    if ($State.voice_mode -eq 'elevenlabs') {
        Info 'Cloud-Modus: lokaler Qwen-Download und -Dienst entfallen.'
        MarkDone 'qwen'
    } else {
    Title 'Schritt 11/15 – Lokales Sprachmodell (Qwen3-4B) für schnelle Antworten'
    $gpu = $State.gpu
    # Pascal (GTX 10xx) & Co. laufen nur mit dem CUDA-12.4-Build; RTX 50xx braucht CUDA 13.
    $flavor = if (-not $gpu.nvidia) { 'cpu' } elseif ([double]$gpu.cc -ge 12.0) { 'cuda-13' } else { 'cuda-12.4' }
    Info "llama.cpp-Variante: $flavor"
    $rels = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=40' -Headers @{ 'User-Agent' = 'friday-installer' }
    $pattern = '^llama-b\d+-bin-win-' + [regex]::Escape($flavor) + '[\d.]*-x64\.zip$'
    $rel = $null; $main = $null
    foreach ($r in $rels) { $main = $r.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1; if ($main) { $rel = $r; break } }
    if (-not $main) { Stop-Install "Kein passender llama.cpp-Download ($flavor) gefunden." }
    $assets = @($main)
    if ($flavor -ne 'cpu') {
        $cud = $rel.assets | Where-Object { $_.name -match ('^cudart-llama-bin-win-' + [regex]::Escape($flavor) + '[\d.]*-x64\.zip$') } | Select-Object -First 1
        if ($cud) { $assets += $cud }
    }
    New-Item -ItemType Directory -Force "$Root\llama.cpp" | Out-Null
    foreach ($a in $assets) {
        $zip = "$Root\cache\$($a.name)"
        if (-not (Download $a.browser_download_url $zip)) { Stop-Install "Download fehlgeschlagen: $($a.name)" }
        if ($a.digest -and -not (Assert-FileSha256 $zip $a.digest "Archiv $($a.name)")) { Stop-Install "Prüfsumme falsch: $($a.name) - Datei gelöscht, erneut starten." }
        Expand-Archive $zip -DestinationPath "$Root\llama.cpp" -Force
        Ok "$($a.name) ($($rel.tag_name)) geprüft und entpackt"
    }
    $model = "$Root\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf"
    New-Item -ItemType Directory -Force (Split-Path $model) | Out-Null
    Info 'Lade Qwen3-4B (2,5 GB) …'
    if (-not (Download 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf' $model)) { Stop-Install 'Qwen-Download fehlgeschlagen.' }
    if (-not (Assert-FileSha256 $model '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5' 'Qwen-Modell')) { Stop-Install 'Qwen-Prüfsumme falsch – erneut starten.' }
    Ok 'Qwen3-4B geprüft'
    $ctx = if ($gpu.nvidia -and [int]$gpu.vram_mb -gt 7000) { 8192 } else { 4096 }
    $layers = if ($gpu.nvidia) { 99 } else { 0 }
    @{ ctx_size = $ctx; gpu_layers = $layers; port = $Ports.Qwen } | ConvertTo-Json | Set-Content "$Root\config\qwen.json" -Encoding Ascii
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Inst\scripts\start-qwen-server.ps1"
    # Warmup getrennt vom Schritt melden: der Modellstart braucht Sekunden bis Minuten, ohne Ausgabe.
    Write-GuiEvent 'warmup' @{ state = 'start'; service = 'qwen' }
    if (-not (Wait-Http "http://127.0.0.1:$($Ports.Qwen)/v1/models" 120)) { Stop-Install "Qwen-Server startet nicht ($Root\logs\qwen-server.log)." }
    $body = @{ model = 'qwen3-router'; max_tokens = 10; chat_template_kwargs = @{ enable_thinking = $false }
               messages = @(@{ role = 'user'; content = 'Antworte nur mit LOCAL_OK' }) } | ConvertTo-Json -Depth 5
    $t = Measure-Command { $r = Invoke-RestMethod -Method Post "http://127.0.0.1:$($Ports.Qwen)/v1/chat/completions" -ContentType 'application/json' -Body $body -TimeoutSec 120 }
    Ok ("Qwen antwortet ({0:N1} s): {1}" -f $t.TotalSeconds, $r.choices[0].message.content.Trim())
    Write-GuiEvent 'warmup' @{ state = 'done'; service = 'qwen'; seconds = [math]::Round($t.TotalSeconds, 1) }
    Register-UserTask 'FRIDAY_Qwen' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-qwen-server.ps1`"" 'Lokaler Qwen3-4B-Router für F.R.I.D.A.Y.'
    MarkDone 'qwen'
    }
}

# ================================================================ 12 Python + Sprachpakete
if (-not (IsDone 'voicepython')) {
    Enter-Step 'voicepython'
    Title 'Schritt 12/15 – Sprachsteuerung installieren (Python + Modelle)'
    $py = $null
    # Ohne Python-Launcher wirft der Aufruf nur einen Befehl-nicht-gefunden-Fehler und laesst $LASTEXITCODE unveraendert (alter Wert 0).
    $havePy = $false
    if (Get-Command py.exe -ErrorAction SilentlyContinue) { & py.exe -3.11 --version *> $null; $havePy = ($LASTEXITCODE -eq 0) }
    if (-not $havePy) {
        Info 'Installiere Python 3.11 …'
        Native { winget install --id Python.Python.3.11 -e --silent --scope user --accept-package-agreements --accept-source-agreements } | Out-Null
    }
    foreach ($cand in @("$env:LOCALAPPDATA\Programs\Python\Python311\python.exe", 'C:\Program Files\Python311\python.exe')) { if (Test-Path $cand) { $py = $cand; break } }
    if (-not $py -and (Get-Command py.exe -ErrorAction SilentlyContinue)) { $py = (& py.exe -3.11 -c "import sys; print(sys.executable)" 2>$null) }
    if (-not $py -or -not (Test-Path $py)) { Stop-Install 'Python 3.11 nicht gefunden – bitte von python.org installieren und erneut starten.' }
    Copy-Item "$Inst\voice\*" "$Root\voice\" -Recurse -Force
    $venv = "$Root\voice\.venv"
    if ((Test-Path "$venv\Scripts\python.exe") -and -not (Test-VenvUsable $venv)) {
        Warn 'Unvollständige Python-Umgebung aus einem abgebrochenen Lauf - sie wird neu angelegt.'
        Remove-Item -LiteralPath $venv -Recurse -Force
    }
    if (-not (Test-Path "$venv\Scripts\python.exe")) { & $py -m venv $venv }
    $vpy = "$venv\Scripts\python.exe"
    $env:PIP_CACHE_DIR = "$Root\cache\pip"
    Info 'Python-Pakete installieren (PyTorch + Whisper: zusammen ca. 1,3 GB, 10–20 min) …'
    & $vpy -m pip install -q --upgrade pip wheel 2>&1 | Out-Null
    if ((Invoke-Pip $vpy @('torch', 'torchaudio', '--index-url', 'https://download.pytorch.org/whl/cpu') 'torch') -ne 0) {
        Stop-Install "PyTorch konnte nicht installiert werden ($Root\logs\pip-torch.log)."
    }
    if ($State.voice_mode -eq 'elevenlabs') {
        if ((Invoke-Pip $vpy @('openwakeword', 'speechbrain', 'silero-vad', 'sounddevice', 'soundfile', 'scipy',
                               'scikit-learn', 'huggingface_hub', 'tzdata', 'av', 'websockets>=15,<17') 'voice') -ne 0) {
            Stop-Install "Python-Pakete konnten nicht installiert werden ($Root\logs\pip-voice.log)."
        }
        $secretPath = "$Root\config\elevenlabs_api.key.dpapi"
        if (-not (Test-Path -LiteralPath $secretPath -PathType Leaf)) {
            Info 'ElevenLabs API-Schlüssel wird verschlüsselt für diesen Windows-Benutzer gespeichert.'
            $secret = if ($GuiMode) { Gui-Secret 'elevenlabsKey' } else { Read-Host '  ElevenLabs API-Schlüssel' -AsSecureString }
            if ($secret.Length -eq 0) { Stop-Install 'ElevenLabs API-Schlüssel fehlt.' }
            $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $secretPath -Encoding Ascii
            $secret.Dispose()
        }
    } else {
        if ((Invoke-Pip $vpy @('faster-whisper', 'nvidia-cublas-cu12', 'nvidia-cudnn-cu12==9.*', 'openwakeword',
                               'speechbrain', 'silero-vad', 'piper-tts', 'sounddevice', 'soundfile', 'scipy',
                               'scikit-learn', 'huggingface_hub', 'tzdata', 'av', 'websockets>=15,<17') 'voice') -ne 0) {
            Stop-Install "Python-Pakete konnten nicht installiert werden ($Root\logs\pip-voice.log)."
        }
    }
    if ($State.conversation_backend -eq 'qwen') {
        $qwenSecretPath = "$Root\config\alibaba_tokenplan.key.dpapi"
        if (-not (Test-Path -LiteralPath $qwenSecretPath -PathType Leaf)) {
            Info 'Alibaba-Token-Plan-Schlüssel für Qwen Audio wird verschlüsselt für diesen Windows-Benutzer gespeichert.'
            $secret = if ($GuiMode) { Gui-Secret 'qwenAudioKey' } else { Read-Host '  Alibaba-Token-Plan-Schlüssel' -AsSecureString }
            if ($secret.Length -eq 0) { Stop-Install 'Alibaba-Token-Plan-Schlüssel für Qwen Audio fehlt.' }
            $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $qwenSecretPath -Encoding Ascii
            $secret.Dispose()
        }
    }
    if ($LASTEXITCODE -ne 0) { Stop-Install "Python-Pakete konnten nicht installiert werden ($Root\logs\pip.log)." }
    Info 'Richte Sprachsteuerung ein …'
    $voiceArgs = @($Root, '--voice-mode', $State.voice_mode, '--voice-choice', $State.voice_choice,
                   '--qwen-port', [string]$Ports.Qwen, '--hermes-port', [string]$Ports.HermesApi,
                   '--voice-port', [string]$Ports.Voice)
    if ($State.voice_mode -eq 'elevenlabs') { $voiceArgs += @('--elevenlabs-voice-id', $State.elevenlabs_voice_id) }
    if ($State.conversation_backend -eq 'qwen') {
        $voiceArgs += @('--conversation-backend', 'qwen', '--qwen-region', [string]$State.qwen_region)
        if ($State.qwen_consent) { $voiceArgs += @('--qwen-consent') }
    }
    if ($State.voice_reference -and $State.voice_mode -eq 'local') { $voiceArgs += @('--voice-reference', $State.voice_reference) }
    $ttsPort = [int]$Ports.Voice + 1
    if ($ttsPort -gt 65535) { Stop-Install 'Kein freier TTS-Port nach dem Sprachdienst-Port vorhanden.' }
    if ($State.voice_mode -eq 'local' -and $State.voice_reference -and $State.gpu.nvidia -and [int]$State.gpu.vram_mb -ge 11000) {
        $voiceArgs += @('--fast-tts', '--fast-tts-port', [string]$ttsPort)
    }
    $out = & $vpy "$Root\voice\voice_setup.py" @voiceArgs 2>&1 | ForEach-Object { "$_" }
    $out | Where-Object { $_ -match '==>|^\s{3}|DONE' } | ForEach-Object { Info $_ }
    if (($out -join "`n") -notmatch 'VOICE_SETUP_DONE') { Stop-Install 'Einrichtung der Sprachmodelle fehlgeschlagen.' }
    if ($GuiMode -and ($GuiConfig.answers.inputDevice -or $GuiConfig.answers.outputDevice)) {
        $deviceArgs = @("$Root\config\voice.json")
        if ($GuiConfig.answers.inputDevice) { $deviceArgs += @('--input-name', [string]$GuiConfig.answers.inputDevice) }
        if ($GuiConfig.answers.outputDevice) { $deviceArgs += @('--output-name', [string]$GuiConfig.answers.outputDevice) }
        & $vpy "$Root\voice\select_audio_devices.py" @deviceArgs 2>&1 | ForEach-Object { Info "$_" }
        if ($LASTEXITCODE -ne 0) { Stop-Install 'Audiogerät nicht gefunden oder nicht nutzbar. Im grafischen Assistenten Windows-Standardgerät wählen und erneut starten.' }
    }
    $voiceConfig = Get-Content -LiteralPath "$Root\config\voice.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($voiceConfig.tts_backend -eq 'streaming_qwen') {
        Info 'Installiere dauerhaft geladenen lokalen TTS-Dienst in der Friday-Distribution …'
        $windowsPaths = @("$Root\installer\fast_tts\install_wsl.sh", $voiceConfig.tts_reference, $voiceConfig.tts_reference_text_file)
        $pairResult = @(& $vpy "$Root\voice\prepare_voice_pairs.py" $Root $PSScriptRoot 2>&1)
        if ($LASTEXITCODE -ne 0) { Stop-Install "Stimmreferenzen konnten nicht vorbereitet werden: $($pairResult -join ' ')" }
        $pairs = $pairResult[-1] | ConvertFrom-Json
        if ($pairs.'friday-female' -and $pairs.classic) {
            $referenceDir = "$Root\config\voice-references"
            $windowsPaths += @("$referenceDir\friday-female-streaming.wav", "$referenceDir\friday-female-reference.txt",
                               "$referenceDir\classic-streaming.wav", "$referenceDir\classic-reference.txt")
        }
        if ($pairs.custom -and $pairs.'friday-female' -and $pairs.classic) {
            # Der eigene Platz wird nur mitgegeben, wenn wirklich eine eigene Aufnahme vorbereitet wurde; er folgt
            # positionell auf die beiden mitgelieferten Paare.
            $referenceDir = "$Root\config\voice-references"
            $windowsPaths += @("$referenceDir\custom-streaming.wav", "$referenceDir\custom-reference.txt")
        }
        $linuxPaths = @()
        foreach ($windowsPath in $windowsPaths) {
            # WSL kann vor dem Pfad Warnungen ausgeben (z. B. wsl2.localhostForwarding bei gespiegeltem Netzwerk);
            # Get-WslPath nimmt die erste Linux-Zeile und bricht bei Zeitueberschreitung ab.
            $linuxPath = Get-WslPath $windowsPath
            if (-not $linuxPath) { Stop-Install "WSL-Pfad konnte nicht aufgeloest werden: $windowsPath" }
            $linuxPaths += $linuxPath
        }
        Assert-WslKeepalive
        $ttsArgs = @($linuxPaths[0], $linuxPaths[1], $linuxPaths[2], [string]$ttsPort)
        if ($linuxPaths.Count -in @(7, 9)) { $ttsArgs += $linuxPaths[3..($linuxPaths.Count - 1)] }
        # Das Installationsskript des TTS-Dienstes laedt Pakete nach und braucht daher ein eigenes Limit.
        $ttsRun = Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments (@('-d', $Distro, '-u', $State.linux_user, '--exec', 'bash') + $ttsArgs) -TimeoutSeconds 1800 -CancelCheck { Test-InstallerCancelRequested -Root $Root -RunId $InstallRunId }
        foreach ($stream in @($ttsRun.StdOut, $ttsRun.StdErr)) {
            if ($stream) { @("$stream" -split "`r?`n") | Where-Object { $_ -ne '' } | ForEach-Object { Info "$_" } }
        }
        if ($ttsRun.TimedOut) { Stop-Install 'Der lokale TTS-Dienst wurde nicht innerhalb von 30 Minuten installiert.' }
        if ($ttsRun.Cancelled) { Stop-Install 'Installation abgebrochen.' }
        if ($ttsRun.ExitCode -ne 0) { Stop-Install 'Lokaler TTS-Dienst konnte nicht installiert werden.' }
        # Kaltstart inkl. Modellpruefung und CUDA-Graphs braucht bis ~150 s, mit Download deutlich mehr.
        Info 'Lade die Stimme (Modell wird in den Grafikspeicher geladen, kann einige Minuten dauern) …'
        if (-not (Wait-Http "http://127.0.0.1:$ttsPort/health" 900)) {
            if (-not (Test-WslKeepalive)) { Warn 'Die WSL-VM lief zwischenzeitlich nicht - Keepalive pruefen.' }
            Stop-Install 'Lokaler TTS-Dienst meldet sich nach dem Modellstart nicht bereit. Pruefen: wsl -d <Distro> -- journalctl --user -u friday-tts -n 50'
        }
        Ok "Lokaler TTS-Dienst bereit (Port $ttsPort)."
    } else {
        # Beim Stimmenwechsel auf Piper/Legacy bleibt sonst das alte GPU-Modell geladen.
        Invoke-CapturedProcess -FilePath 'wsl.exe' -Arguments @('-d', $Distro, '-u', $State.linux_user, '--exec', 'systemctl', '--user', 'stop', 'friday-tts.service') -TimeoutSeconds 120 | Out-Null
    }
    Ok 'Sprachmodelle bereit.'
    MarkDone 'voicepython'
}

# ================================================================ 13 Stimme einlernen
if (-not (IsDone 'enroll')) {
    Enter-Step 'enroll'
    Title "Schritt 13/15 – $AN lernt deine Stimme"
    Info "$AN reagiert nur auf DEINE Stimme. Dafür nimmst du jetzt einige Sätze auf (ca. 10–12 Minuten):"
    if ($WakeShort) { Info "  • 26x ""$WP"", 18x ""$WakeShort"", 15 ähnlich klingende Wörter, 8 kurze Texte vorlesen" }
    else { Info "  • 44x ""$WP"", 15 ähnlich klingende Wörter (Teile und Varianten der Phrase), 8 kurze Texte vorlesen" }
    Info '  • Ruhige Umgebung, normal sprechen, nach jedem Piepton sprechen.'
    if ($GuiMode) { Info 'Der Assistent führt jetzt durch jede Aufnahme: Signal abwarten, sprechen, auf Wunsch anhören oder abbrechen.' }
    else { Info 'Es öffnet sich gleich ein eigenes Fenster. Dort Enter drücken und den Anweisungen folgen.' }
    if (-not $GuiMode) { Read-Host '  Enter, wenn du bereit bist' }
    # Vor einer erneuten Aufnahme das vorhandene Stimmprofil sichern: sonst ueberschreibt ein
    # abgebrochener Durchlauf WAVs und Embedding ohne Rueckweg.
    $profileBackup = Backup-VoiceProfile -Root $Root -Label 'vor-enrollment'
    if ($profileBackup) { Info "Vorhandenes Stimmprofil gesichert: $profileBackup" }
    $vpy = "$Root\voice\.venv\Scripts\python.exe"
    $raw = "$Root\voice\profiles\owner\raw"
    while ($true) {
        New-Item -ItemType Directory -Force "$Root\run" | Out-Null
        # Jede Aufnahme fordert im Assistenten eine Aktion an; eine liegen gebliebene Anfrage wuerde sofort blockieren.
        Clear-GuiInteraction $Root
        if ($GuiMode) {
            $interactionFile = "$Root\run\gui-interaction.json"
            & $vpy "$Root\voice\enroll_record.py" --name $AN --phrase $WP --gui --interaction-file $interactionFile 2>&1 | ForEach-Object { Info "$_" }
            $enrollExit = $LASTEXITCODE
            Clear-GuiInteraction $Root
            if ($enrollExit -ne 0) { Stop-Install 'Stimmaufnahme wurde abgebrochen oder ist fehlgeschlagen. Prüfe Mikrofon und Meldungen, dann den grafischen Assistenten erneut starten.' }
        } else {
            Start-Process -FilePath $vpy -ArgumentList "`"$Root\voice\enroll_record.py`" --name `"$AN`" --phrase `"$WP`"" -WorkingDirectory "$Root\voice" -Wait
        }
        $nWake = @(Get-ChildItem "$raw\wake_$Slug\*.wav" -ErrorAction SilentlyContinue).Count
        $nSpeech = @(Get-ChildItem "$raw\speech\*.wav" -ErrorAction SilentlyContinue).Count
        if ($nWake -ge 20 -and $nSpeech -ge 6) { break }
        Warn "Zu wenige Aufnahmen ($nWake x '$WP', $nSpeech Texte). Bitte vollständig durchlaufen."
        if ($GuiMode) { Stop-Install 'Stimmaufnahme unvollständig. Mikrofon prüfen und den grafischen Assistenten erneut starten.' }
        if (-not (YesNo 'Aufnahme fortsetzen?')) { Stop-Install 'Stimmprofil unvollständig.' }
    }
    Info 'Berechne dein Stimmprofil und trainiere die Wake-Word-Erkennung (bei eigenem Wake Word einige Minuten) …'
    # Altes persoenliches Modell (andere Phrase) entfernen: fehlt es danach, ist das Training gescheitert - nie ein veraltetes Modell weiterverwenden.
    Remove-Item "$Root\models\openwakeword\personal_wake.npz", "$Root\models\openwakeword\personal_wake.json" -Force -ErrorAction SilentlyContinue
    & $vpy "$Root\voice\build_speaker_profile.py" 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'Profil|score|Kreuz' } | ForEach-Object { Info $_ }
    $wakeOut = @(& $vpy "$Root\voice\train_owner_verifier.py" 2>&1 | ForEach-Object { "$_" })
    $wakeOut | Where-Object { $_ -match 'Verifier|Wake|Schwelle|Aufnahmen|Kalibrier' } | ForEach-Object { Info $_ }
    if (-not (Test-Path "$Root\voice\profiles\owner\embeddings\owner_ecapa.npy")) { Stop-Install 'Stimmprofil konnte nicht erstellt werden.' }
    if ($State.wake_engine -eq 'personal') {
        if (-not (Test-Path "$Root\models\openwakeword\personal_wake.npz") -or -not (Test-Path "$Root\models\openwakeword\personal_wake.json")) {
            Stop-Install "Wake-Word-Modell für '$WP' konnte nicht erstellt werden (Ausgabe oben). Aufnahme prüfen und erneut starten."
        }
        $wakeMeta = Get-Content "$Root\models\openwakeword\personal_wake.json" -Raw | ConvertFrom-Json
        if ((Get-WakeKey $wakeMeta.wake_phrase) -ne (Get-WakeKey $WP)) {
            Stop-Install "Das Wake-Word-Modell gehört zu '$($wakeMeta.wake_phrase)', nicht zu '$WP'. Aufnahme prüfen und erneut starten."
        }
        if (($wakeOut -join "`n") -match 'WAKE_QUALITY=schwach') {
            Warn "Das Wake Word '$WP' ist noch unsicher erkennbar (ähnlich klingende Wörter). Es funktioniert, kann aber öfter nicht oder fälschlich anspringen."
            Warn 'Tipp: Aufnahme in ruhigerer Umgebung wiederholen (siehe ANLEITUNG.md) oder ein längeres, markanteres Wake Word wählen (change-assistant-name.bat).'
        }
    }
    Ok 'Stimmprofil erstellt (bleibt nur auf diesem PC).'
    MarkDone 'enroll'
} elseif ((Test-Path "$Root\voice\profiles\owner\embeddings\owner_ecapa.npy") -and
          -not (Test-Path "$Root\voice\profiles\owner\embeddings\owner_profile.json") -and
          [bool](Get-ChildItem "$Root\voice\profiles\owner\raw\speech\*.wav" -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    # Aeltere Installationen haben ein Profil ohne Messwerte: aus denselben Aufnahmen neu berechnen, damit das
    # Dashboard Probenzahl und Qualitaet zeigt. Scheitert das, bleibt das bisherige Profil unveraendert in Betrieb.
    Info 'Ergänze die Messwerte des vorhandenen Stimmprofils …'
    $vpy = "$Root\voice\.venv\Scripts\python.exe"
    $profileFile = "$Root\voice\profiles\owner\embeddings\owner_ecapa.npy"
    Copy-Item -LiteralPath $profileFile -Destination "$profileFile.prev" -Force
    & $vpy "$Root\voice\build_speaker_profile.py" 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'Profil|Kreuz' } | ForEach-Object { Info $_ }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$Root\voice\profiles\owner\embeddings\owner_profile.json")) {
        Move-Item -LiteralPath "$profileFile.prev" -Destination $profileFile -Force
        Warn 'Messwerte des Stimmprofils konnten nicht ergänzt werden; das bisherige Profil bleibt aktiv.'
    } else {
        Remove-Item -LiteralPath "$profileFile.prev" -Force
    }
}

# ================================================================ 14 Sprachdienst + Abschluss
if (-not (IsDone 'voiceservice')) {
    Enter-Step 'voiceservice'
    Title "Schritt 14/15 – $AN starten"
    Register-UserTask 'FRIDAY_Voice' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-friday-voice.ps1`"" "$AN Sprachsteuerung ($WP)" 45
    # Läuft noch ein Sprachdienst mit alter Konfiguration (Namenswechsel), erst Neustartschleife und Python beenden:
    # sonst startet die Schleife Python nach 10 s neu oder die Aufgabe startet eine zweite Instanz.
    Stop-VoiceService
    Start-ScheduledTask -TaskName 'FRIDAY_Voice'
    Info 'Lade die Sprachmodelle (bis zu 3 Minuten) …'
    # Wie beim Modellstart: die Ladezeit des Sprachdienstes als eigenes Ereignis, nicht als stille Schrittzeit.
    Write-GuiEvent 'warmup' @{ state = 'start'; service = 'voice' }
    $voiceWarmupStart = Get-Date
    $ok = $false
    foreach ($i in 1..90) {
        Confirm-NotCancelled
        try { if ((Invoke-RestMethod "http://127.0.0.1:$($Ports.Voice)" -TimeoutSec 2).state -eq 'listening') { $ok = $true; break } } catch {}
        Start-Sleep 2
    }
    if (-not $ok) { Stop-Install "Sprachdienst startet nicht ($Root\logs\voice-service.log)." }
    Ok "$AN antwortet auf dem Sprachport (state=listening)."
    Write-GuiEvent 'warmup' @{ state = 'done'; service = 'voice'; seconds = [math]::Round(((Get-Date) - $voiceWarmupStart).TotalSeconds, 1) }
    if ($State.voice_mode -eq 'elevenlabs') {
        Info 'Cloud-Stimme wird erst beim ersten Sprachkommando verwendet; kein kostenpflichtiger Installations-Testaufruf.'
    } else {
    $helloLog = "$Root\logs\say-hello.log"
    $helloOut = @(& "$Root\voice\.venv\Scripts\python.exe" "$Root\voice\say_hello.py" $Root "Guten Tag. $AN ist installiert und bereit." 2>&1 | ForEach-Object { "$_" })
    $helloCode = $LASTEXITCODE
    Set-Content -Path $helloLog -Value (@("$(Get-Date -Format s) say_hello Exitcode $helloCode") + $helloOut) -Encoding UTF8
    if ($helloCode -eq 0) { Ok 'Begrüßung gesprochen.' }
    else {
        Warn "Die gesprochene Begrüßung ist fehlgeschlagen (Exitcode $helloCode) - Lautsprecher/Stimme prüfen. Details: $helloLog"
        $helloOut | Select-Object -Last 3 | ForEach-Object { Warn $_ }
        Warn "$AN läuft trotzdem; die Installation wird fortgesetzt."
    }
    }
    MarkDone 'voiceservice'
    # Ab hier laeuft der neue Sprachbetrieb; spaetere Fehler betreffen ihn nicht mehr.
    $script:VoiceChangeRollback = $null
}

# ================================================================ 15 F.R.I.D.A.Y. Command Center (Dashboard + Control API)
# Das Dashboard wird in $Root\dashboard eingerichtet; der Pfad steht in dashboard.yaml.
# Details: docs/DEPLOYMENT.md. Der Schritt ist idempotent; ein Fehler hier laesst Sprache/Hermes/Qwen unangetastet.
$NodeMin = [version]'22.13.0'
# Verzeichnisse, die nie ins Ziel kopiert werden (Build-Ausgaben, Abhaengigkeiten, Screenshots/Belege, Metadaten).
$DashExcludeDirs = @('node_modules', '.git', '.next', 'dist', 'out', 'coverage', 'storybook-static', 'playwright-report',
                     'test-results', 'screenshots', 'evidence', '.turbo', '__pycache__', '.claude', 'fixtures')
$DashSyncDirs  = @('apps', 'packages', 'adapters', 'scripts')
$DashRootFiles = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'eslint.config.js',
                   'vitest.config.ts', '.npmrc', '.nvmrc', 'README.md', 'LICENSE')
$script:DashOk = $false
# Fehler im Dashboard-Schritt beenden nur diesen Schritt (Ausnahme, vom Aufrufer gefangen), nicht den ganzen Installer:
# Abschlussbericht und Schlussmeldung sollen trotzdem erscheinen.
function Stop-Dashboard([string]$text) { throw (New-Object System.InvalidOperationException $text) }

function Write-DashLog([string]$text) { Add-Content -Path $DashInstallLog -Value "$(Get-Date -Format s) $text" -Encoding UTF8 }
function Show-DashLogTail { Get-Content $DashInstallLog -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray } }
function Update-SessionPath {
    $env:Path = (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'), $env:Path) |
        Where-Object { $_ }) -join ';'
}
function Find-Node {
    $c = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if (Test-Path $p) { return $p } }
    return $null
}
function Get-NodeVersion($nodeExe) {
    if (-not $nodeExe) { return $null }
    $v = (& $nodeExe --version 2>$null | Select-Object -First 1)
    if ("$v" -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
    return $null
}
function Get-PnpmVersion {
    $c = Get-Command pnpm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return $null }
    $v = (& $c.Source --version 2>$null | Select-Object -First 1)
    return "$v".Trim()
}
function Set-NodeSessionPath([string]$nodeExe) {
    # CMD runs pnpm package scripts in child processes. Quoted PATH fragments can
    # hide node.exe/pnpm.cmd from those children even when PowerShell finds them.
    $nodeDir = Split-Path $nodeExe
    $entries = @($nodeDir) + @($env:Path -split ';' | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ -and $_ -ine $nodeDir })
    $env:Path = $entries -join ';'
}
function Ensure-Node {
    $node = Find-Node; $ver = Get-NodeVersion $node
    if ($ver -and $ver -ge $NodeMin) { Set-NodeSessionPath $node; Ok "Node.js $ver gefunden"; return $node }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Stop-Dashboard "Für das Command Center wird Node.js $NodeMin oder neuer gebraucht, aber winget (App-Installer) fehlt. Bitte im Microsoft Store den 'App-Installer' aktualisieren oder Node.js LTS von https://nodejs.org installieren und install-friday.bat erneut starten."
    }
    $wingetArgs = @('--id', 'OpenJS.NodeJS.LTS', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
    $verbs = if ($ver) { Info "Node.js $ver ist zu alt (mindestens $NodeMin) - aktualisiere per winget …"; @('upgrade', 'install') } else { Info 'Installiere Node.js LTS per winget …'; @('install') }
    foreach ($verb in $verbs) {
        Write-DashLog ">>> winget $verb OpenJS.NodeJS.LTS"
        Native { winget $verb @wingetArgs } | ForEach-Object { Write-DashLog $_ }
        # Fundortpruefung statt Exitcode (winget meldet "bereits installiert" mit Code != 0).
        Update-SessionPath; $node = Find-Node; $ver = Get-NodeVersion $node
        if ($ver -and $ver -ge $NodeMin) { break }
    }
    if ($ver -and $ver -ge $NodeMin) {
        Set-NodeSessionPath $node
        Ok "Node.js $ver bereit"; return $node
    }
    if ($ver) { Stop-Dashboard "Node.js $ver ist zu alt (mindestens $NodeMin) und ließ sich nicht aktualisieren (Log: $DashInstallLog). Bitte Node.js LTS manuell von https://nodejs.org installieren und install-friday.bat erneut starten." }
    Stop-Dashboard "Node.js wurde installiert oder angefordert, ist in dieser Sitzung aber nicht auffindbar (der PATH wird erst in einer neuen Shell aktualisiert). Dieses Fenster schließen und install-friday.bat erneut starten. Log: $DashInstallLog"
}
function Ensure-Pnpm([string]$wanted) {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    if ((Get-PnpmVersion) -eq $wanted) { Ok "pnpm $wanted bereit"; return }
    Info "Aktiviere pnpm $wanted (corepack) …"
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
        Write-DashLog ">>> corepack enable / prepare pnpm@$wanted"
        Native { corepack enable } | ForEach-Object { Write-DashLog $_ }
        Native { corepack prepare "pnpm@$wanted" --activate } | ForEach-Object { Write-DashLog $_ }
    }
    if ((Get-PnpmVersion) -ne $wanted) {
        Write-DashLog ">>> npm install -g pnpm@$wanted (Ausweichweg)"
        Native { npm.cmd install -g "pnpm@$wanted" } | ForEach-Object { Write-DashLog $_ }
        Update-SessionPath
    }
    if ((Get-PnpmVersion) -ne $wanted) {
        Stop-Dashboard "pnpm $wanted konnte nicht aktiviert werden (Internet? corepack/npm laden es aus der npm-Registry). Log: $DashInstallLog"
    }
    Ok "pnpm $wanted bereit"
}
function Find-FFmpeg {
    if ($env:FRIDAY_FFMPEG_PATH -and (Test-Path -LiteralPath $env:FRIDAY_FFMPEG_PATH -PathType Leaf)) {
        return (Resolve-Path -LiteralPath $env:FRIDAY_FFMPEG_PATH).Path
    }
    $command = Get-Command ffmpeg.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    return $null
}
function Ensure-FFmpeg {
    $binary = Find-FFmpeg
    if (-not $binary -and (Get-Command winget -ErrorAction SilentlyContinue)) {
        Info 'Installiere FFmpeg fuer den automatischen Content-Studio-Schnitt per winget …'
        Write-DashLog '>>> winget install Gyan.FFmpeg'
        Native { winget install --id Gyan.FFmpeg -e --silent --scope user --accept-package-agreements --accept-source-agreements } |
            ForEach-Object { Write-DashLog $_ }
        Update-SessionPath
        $binary = Find-FFmpeg
    }
    if (-not $binary) {
        Warn 'FFmpeg fehlt. Content Studio kann Medien noch nicht automatisch schneiden. FFmpeg installieren und das Dashboard-Update erneut ausfuehren.'
        return $false
    }
    $versionOutput = @(& $binary -version 2>$null)
    if ($LASTEXITCODE -ne 0 -or $versionOutput.Count -eq 0 -or "$($versionOutput[0])" -notmatch '^ffmpeg version ') {
        Warn "FFmpeg unter $binary antwortet nicht korrekt. Automatischer Content-Studio-Schnitt bleibt deaktiviert."
        return $false
    }
    $pathFile = "$Dash\config\ffmpeg.path"
    New-Item -ItemType Directory -Force (Split-Path $pathFile -Parent) | Out-Null
    [IO.File]::WriteAllText($pathFile, $binary + "`n", [Text.UTF8Encoding]::new($false))
    Ok "FFmpeg fuer Content Studio bereit: $binary"
    return $true
}
function Get-SourceHash([string]$src) {
    # Inhaltshash ueber alles, was ins Ziel kopiert wird (ohne Build-Ausgaben und ohne die lokalen
    # Konfigurationsdateien des Benutzers). Die Dateiliste liegt in lib\dashboard-sync.ps1.
    return (Get-DashboardSourceHash -Source $src -RootFiles $DashRootFiles -Dirs ($DashSyncDirs + 'config') `
        -ExcludeDirs $DashExcludeDirs -PreserveFiles @('config\dashboard.yaml', 'config\adapters.yaml'))
}
function Sync-DashSource([string]$src) {
    Sync-DashboardSource -Source $src -Target $Dash -RootFiles $DashRootFiles -Dirs $DashSyncDirs `
        -ExcludeDirs $DashExcludeDirs -PreserveFiles @('config\dashboard.yaml', 'config\adapters.yaml') | Out-Null
    New-Item -ItemType Directory -Force "$Root\logs\dashboard" | Out-Null
}
function Invoke-Pnpm([string[]]$pnpmArgs) {
    Write-DashLog ">>> pnpm $($pnpmArgs -join ' ')   (in $Dash)"
    Push-Location $Dash
    try { & pnpm.cmd @pnpmArgs 2>&1 | ForEach-Object { Add-Content -Path $DashInstallLog -Value "$_" -Encoding UTF8 }; $code = $LASTEXITCODE }
    finally { Pop-Location }
    Write-DashLog "<<< Exitcode $code"
    return $code
}
function Test-DashboardHealth([int]$timeoutSec = 3) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing "$DashUrl/api/v1/health" -TimeoutSec $timeoutSec
        return [pscustomobject]@{ Up = $true; Code = [int]$r.StatusCode; Body = "$($r.Content)" }
    } catch {
        # Eine HTTP-Antwort mit Fehlercode (z. B. 503 bei Teilausfall) heisst: der Server laeuft.
        if ($_.Exception.Response) { return [pscustomobject]@{ Up = $true; Code = [int]$_.Exception.Response.StatusCode; Body = '' } }
        return [pscustomobject]@{ Up = $false; Code = 0; Body = '' }
    }
}
function Get-ConfiguredPort([string]$yamlFile, [int]$default) {
    # server.port aus dashboard.yaml (einfacher Zeilenscan; Umgebungsvariable FRIDAY_PORT bleibt unberuecksichtigt).
    if (-not (Test-Path $yamlFile)) { return $default }
    $inServer = $false
    foreach ($line in (Get-Content $yamlFile)) {
        if ($line -match '^server:') { $inServer = $true; continue }
        if ($inServer -and $line -match '^\S' -and $line -notmatch '^\s*#') { $inServer = $false }
        if ($inServer -and $line -match '^\s+port:\s*(\d{2,5})\b') { return [int]$Matches[1] }
    }
    return $default
}
function Set-DashPort {
    $script:DashPort = Get-ConfiguredPort "$Dash\config\dashboard.yaml" $Ports.CommandCenter
    $script:DashUrl = "http://127.0.0.1:$($script:DashPort)"
}
function Get-PortOwner([int]$port) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $c) { return $null }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    return [pscustomobject]@{ ProcessId = $c.OwningProcess; Name = "$($p.Name)"; CommandLine = "$($p.CommandLine)" }
}
function Stop-DashboardService {
    # Erst die Neustartschleife (Launcher), dann Node - sonst startet der Launcher den Server sofort neu.
    Stop-LauncherService $DashTask 'start-dashboard.ps1' '*control-api*dist*main.js*' $Root $ProcessRoots
}
function Move-LegacyDashboardTask {
    if ($DashTask -ne 'JARVIS_Dashboard') { return $true }
    $oldTask = Get-ScheduledTask -TaskName 'JARVIS_Dashboard' -ErrorAction SilentlyContinue
    if (-not $oldTask -or -not (Test-TaskForInstallRoot $oldTask) -or $oldTask.TaskPath -ne '\') {
        Stop-Dashboard 'Die bisherige Dashboard-Aufgabe fehlt oder gehoert nicht zu dieser Installation.'
    }
    $oldAction = @($oldTask.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
    $launcherMatches = $false
    foreach ($path in $ProcessRoots) {
        if ($oldAction -like "*$($path)installer\scripts\start-dashboard.ps1*") { $launcherMatches = $true; break }
    }
    if (-not $launcherMatches) { Stop-Dashboard 'Die bisherige Dashboard-Aufgabe startet keinen bekannten Dashboard-Launcher.' }
    if (Get-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction SilentlyContinue) {
        Stop-Dashboard 'FRIDAY_Dashboard existiert bereits. Eine fremde oder doppelte Aufgabe wird nicht ueberschrieben.'
    }

    # Erst neue Autostart-Aufgabe anlegen, dann den alten Launcher beenden. Bis dahin bleibt der alte Autostart erhalten.
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Stop'
    $newTaskCreated = $false
    $oldStopped = $false
    $newStarted = $false
    try {
        Register-UserTask 'FRIDAY_Dashboard' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-dashboard.ps1`"" 'F.R.I.D.A.Y. Command Center (Dashboard + Control API)' 60
        $newTaskCreated = $true
        $newTask = Get-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction Stop
        if (-not (Test-TaskForInstallRoot $newTask) -or $newTask.TaskPath -ne '\') { throw 'Neue Dashboard-Aufgabe hat einen unerwarteten Pfad.' }
        $oldStopped = $true
        Stop-DashboardService
        if (Get-PortOwner $DashPort) { throw "Port $DashPort ist nach dem Stopp des alten Dashboard-Launchers weiterhin belegt." }
        $newStarted = $true
        Start-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction Stop
        $healthy = $false
        foreach ($i in 1..30) {
            $check = Test-DashboardHealth 3
            if ($check.Up -and $check.Code -ge 200 -and $check.Code -lt 300) { $healthy = $true; break }
            Start-Sleep 2
        }
        if (-not $healthy) { throw 'Neue Dashboard-Aufgabe erreichte keinen erfolgreichen Healthcheck.' }
        Unregister-ScheduledTask -TaskName 'JARVIS_Dashboard' -Confirm:$false -ErrorAction Stop
        $script:DashTask = 'FRIDAY_Dashboard'
        Ok 'Dashboard-Autostart von JARVIS_Dashboard auf FRIDAY_Dashboard umgestellt.'
        return $true
    } catch {
        $cause = $_.Exception.Message
        if ($newStarted) {
            try { Stop-LauncherService 'FRIDAY_Dashboard' 'start-dashboard.ps1' '*control-api*dist*main.js*' $Root $ProcessRoots }
            catch { Warn "Neuer Dashboard-Launcher konnte nicht sauber gestoppt werden: $($_.Exception.Message)" }
        }
        if ($newTaskCreated -or (Get-ScheduledTask -TaskName 'FRIDAY_Dashboard' -ErrorAction SilentlyContinue)) {
            try { Unregister-ScheduledTask -TaskName 'FRIDAY_Dashboard' -Confirm:$false -ErrorAction Stop }
            catch { Warn "FRIDAY_Dashboard konnte nicht entfernt werden: $($_.Exception.Message)" }
        }
        if ($oldStopped) {
            try { Start-ScheduledTask -TaskName 'JARVIS_Dashboard' -ErrorAction Stop }
            catch { Warn "Bisheriger Dashboard-Launcher konnte nicht sofort neu gestartet werden: $($_.Exception.Message)" }
        }
        Stop-Dashboard "Dashboard-Aufgabenmigration fehlgeschlagen ($cause). JARVIS_Dashboard bleibt fuer den naechsten Login erhalten."
    } finally { $ErrorActionPreference = $oldEap }
}
function Write-DashFile([string]$path, [string]$content, [string]$label) {
    $content = $content.Replace("`r`n", "`n")
    $enc = New-Object Text.UTF8Encoding $false
    if (-not (Test-Path $path)) { [IO.File]::WriteAllText($path, $content, $enc); Ok "$label geschrieben: $path"; return }
    if ([IO.File]::ReadAllText($path).Replace("`r`n", "`n") -eq $content) { Info "$label ist aktuell: $path"; return }
    if ($UpdateDashboard) { Info "$label bleibt unverändert (deine Änderungen werden behalten): $path"; return }
    Warn "$label existiert bereits und weicht von der Vorgabe des Installers ab: $path"
    if (YesNo "Mit der Vorgabe überschreiben? (die alte Datei wird nach $Root\backups gesichert)" $false) {
        Copy-Item $path "$Root\backups\$(Split-Path $path -Leaf).bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
        [IO.File]::WriteAllText($path, $content, $enc); Ok "$label überschrieben"
    } else { Info "$label bleibt unverändert (deine Änderungen werden behalten)." }
}
function Write-DashboardConfig {
    $cfg = "$Dash\config"
    $rootYaml = $Root.Replace('\', '/')
    $storageDrive = $Root.Substring(0, 1)
    $cloudModeYaml = if ($State.voice_mode -eq 'elevenlabs') { 'true' } else { 'false' }
    # Nur der Anzeigename wird in einer bestehenden dashboard.yaml nachgezogen (Namenswechsel), alles andere bleibt wie es ist.
    if (Test-Path "$cfg\dashboard.yaml") {
        $old = [IO.File]::ReadAllText("$cfg\dashboard.yaml")
        $new = [regex]::Replace($old, '(?m)^(\s*assistantName:[ \t]*)("[^"\r\n]*"|[^\s#"]+)', { param($m) "$($m.Groups[1].Value)`"$AN`"" })
        if ($new -ne $old) { [IO.File]::WriteAllText("$cfg\dashboard.yaml", $new, (New-Object Text.UTF8Encoding $false)); Info "Anzeigename in dashboard.yaml auf '$AN' gesetzt." }
    }
    $dashboardYaml = @"
# F.R.I.D.A.Y. Command Center - Dashboard-Konfiguration (vom Installer erzeugt, LIVE-Betrieb; frei editierbar).
# Der Installer ueberschreibt diese Datei nie ohne Rueckfrage. Mehr: docs/DEPLOYMENT.md, config/dashboard.example.yaml.
# Geaendert wird nach einem Neustart der Aufgabe FRIDAY_Dashboard wirksam.

dataMode: live # nur eingerichtete Kategorien liefern Daten, es gibt keine Ersatzdaten

server:
  host: 127.0.0.1 # nur Loopback
  port: $($Ports.CommandCenter)
  allowRemote: false

# Pfade ohne Backslash (YAML), abgeleitet vom InstallRoot.
paths:
  dataDir: "$rootYaml/dashboard/data"
  logDir: "$rootYaml/logs/dashboard"
  backupDir: "$rootYaml/dashboard/backups"
  webRoot: "$rootYaml/dashboard/apps/web/out"

auth:
  mode: local
  ownerUsername: owner
  # Nur der scrypt-Hash, nie das Passwort. Datei mit Zugriff nur fuer den Installationsbenutzer (icacls).
  ownerPasswordHash: "file:$rootYaml/config/dashboard_owner.hash"
  sessionTtlMinutes: 720
  reauthWindowMinutes: 5
  idleTimeoutMinutes: 30
  secureCookies: false

realtime:
  ringBufferSize: 5000
  heartbeatSeconds: 15

ui:
  locale: de-DE
  timezone: Europe/Berlin
  assistantName: "$AN" # Anzeigename; settings.profile.assistantName (in der Oberflaeche geaendert) hat Vorrang
  theme: friday-command-midnight
  layout: friday-command-overview
  # Creator Studio gehoert zum Standardpaket: Menueeintrag und API sind ohne Zusatzschritt da.
  # Abschalten: contentStudio: false (oder in der Oberflaeche unter Einstellungen).
  contentStudio: true

dev:
  scenarioConsole: false
  responseValidation: true

logging:
  level: info
  redactEmails: false
  file:
    enabled: true
    maxBytes: 10485760
    maxFiles: 5
"@
    $adaptersYaml = @"
# F.R.I.D.A.Y. Command Center - Adapter (vom Installer erzeugt, LIVE-Betrieb; frei editierbar).
# Live: Aufgaben/Aktivitaet/Agenten ueber Hermes, Sprache ueber den Voice-Dienst, Systemstatus vom lokalen Rechner.
# Nicht eingerichtete Kategorien (memory, approvals, communication, calendar, research, files,
# notifications, audit, commands) bleiben deaktiviert und werden in der Oberflaeche als nicht eingerichtet gezeigt -
# es gibt keinen Mock-Fallback. Eine Kategorie wird erst aktiv, wenn hier ein Provider eingetragen ist.
# Ports werden aus dem gespeicherten Installationszustand uebernommen.
# Geheimnisse nie im Klartext: file:<absoluter Pfad> (nur serverseitig gelesen), env:NAME oder wincred:ZIEL.

allowlist:
  hermes-tasks: "@friday/adapter-hermes"
  hermes-activity: "@friday/adapter-hermes"
  hermes-agents: "@friday/adapter-hermes"
  hermes-automations: "@friday/adapter-hermes"
  friday-voice-http: "@friday/adapter-voice-http"
  local-system: "@friday/adapter-system-local"
  caldav-calendar: "@friday/adapter-calendar-placeholder"

adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    timeoutMs: 10000
    config:
      dashboardBaseUrl: http://127.0.0.1:$($Ports.Dashboard)
      dashboardAuth: scrape
      boards: [default]
  activity:
    provider: hermes-activity
    enabled: true
    timeoutMs: 10000
    config:
      apiBaseUrl: http://127.0.0.1:$($Ports.HermesApi)
      apiKey: "file:$rootYaml/config/hermes_api.key"
      dashboardBaseUrl: http://127.0.0.1:$($Ports.Dashboard)
      boards: [default]
  agents:
    provider: hermes-agents
    enabled: true
    timeoutMs: 10000
    config:
      apiBaseUrl: http://127.0.0.1:$($Ports.HermesApi)
      apiKey: "file:$rootYaml/config/hermes_api.key"
      dashboardBaseUrl: http://127.0.0.1:$($Ports.Dashboard)
      boards: [default]
  automations:
    provider: hermes-automations
    enabled: true
    timeoutMs: 10000
    config:
      dashboardBaseUrl: http://127.0.0.1:$($Ports.Dashboard)
      dashboardAuth: scrape
  voice:
    provider: friday-voice-http
    enabled: true
    timeoutMs: 3000
    config:
      baseUrl: http://127.0.0.1:$($Ports.Voice)
      localModelUrl: http://127.0.0.1:$($Ports.Qwen)
      cloudMode: $cloudModeYaml
      wakePhrase: "$WP"
  system:
    provider: local-system
    enabled: true
    timeoutMs: 5000
    config:
      qwenUrl: http://127.0.0.1:$($Ports.Qwen)
      cloudMode: $cloudModeYaml
      hermesApiUrl: http://127.0.0.1:$($Ports.HermesApi)
      hermesDashboardUrl: http://127.0.0.1:$($Ports.Dashboard)
      voiceUrl: http://127.0.0.1:$($Ports.Voice)
      hermesApiKey: "file:$rootYaml/config/hermes_api.key"
      storagePaths: ["${storageDrive}:/"]
      wslDistro: $Distro
"@
    Write-DashFile "$cfg\dashboard.yaml" $dashboardYaml 'dashboard.yaml'
    Write-DashFile "$cfg\adapters.yaml" $adaptersYaml 'adapters.yaml'
    # An earlier installation keeps its own dashboard.yaml; move it to live so an upgrade does not keep the
    # simulation. The migration writes a backup next to the file and logs the previous mode.
    $modeResult = Set-ProductionDataMode -DashboardYaml "$cfg\dashboard.yaml" -BackupDir "$Root\backups"
    if ($modeResult.Changed) {
        Warn "dashboard.yaml stand auf dataMode: $($modeResult.From). Auf live umgestellt (Simulation deaktiviert); Sicherung: $($modeResult.Backup). Wirksam nach Neustart der Aufgabe FRIDAY_Dashboard."
    } elseif ($modeResult.Reason -eq 'unknown-mode') {
        Warn "dashboard.yaml enthaelt den unbekannten dataMode '$($modeResult.From)'. Bitte auf live setzen; der Dienst startet sonst nicht."
    }
    # Existing installations keep their adapter choices. Only add the dormant ICS provider to the allowlist.
    if ($UpdateDashboard -and (Test-Path -LiteralPath "$cfg\adapters.yaml")) {
        $adapterPath = "$cfg\adapters.yaml"
        $adapterText = [System.IO.File]::ReadAllText($adapterPath)
        if ($adapterText -notmatch '(?m)^  caldav-calendar:') {
            $marker = '(?m)^(  local-system:[ \t]*"@friday/adapter-system-local")\r?\n'
            if ($adapterText -match $marker) {
                $adapterText = [regex]::Replace($adapterText, $marker, '$1' + "`r`n" + '  caldav-calendar: "@friday/adapter-calendar-placeholder"' + "`r`n", 1)
                [System.IO.File]::WriteAllText($adapterPath, $adapterText, (New-Object System.Text.UTF8Encoding($false)))
            } else { Warn 'Kalender-Provider konnte nicht automatisch in die angepasste Adapter-Allowlist eingetragen werden.' }
        }
    }
}
function Protect-OwnerFile([string]$file) {
    & icacls.exe $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" /grant:r 'SYSTEM:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Dashboard "Zugriffsrechte für $file konnten nicht gesetzt werden." }
}
function Set-DashboardOwnerPassword {
    $have = (Test-Path $DashHashFile) -and ((Get-Item $DashHashFile).Length -gt 0)
    if ($have) {
        Protect-OwnerFile $DashHashFile
        Ok 'Bestehendes Owner-Konto bleibt erhalten.'
        return
    }
    Info "Öffne nach dem Start $DashUrl. Dort legst du Name, Benutzername und Passwort beim ersten Login selbst fest."
}
function Backup-CustomDashboard {
    # Vor dem Update: Build, Konfiguration UND Datenbank sichern; das Manifest macht die Wiederherstellung
    # pruefbar (Groesse und Pruefsumme je Datei).
    $entries = @(
        @{ Source = "$Dash\config\dashboard.yaml"; Relative = 'config\dashboard.yaml' },
        @{ Source = "$Dash\config\adapters.yaml"; Relative = 'config\adapters.yaml' },
        @{ Source = $DashHashFile; Relative = 'config\dashboard_owner.hash' },
        @{ Source = $StateFile; Relative = 'config\install-state.json' },
        @{ Source = "$Dash\apps\control-api\dist"; Relative = 'apps\control-api\dist' },
        @{ Source = "$Dash\apps\web\out"; Relative = 'apps\web\out' },
        @{ Source = "$Dash\data\dashboard.sqlite"; Relative = 'data\dashboard.sqlite' },
        @{ Source = "$Dash\data\dashboard.sqlite-wal"; Relative = 'data\dashboard.sqlite-wal' },
        @{ Source = "$Dash\data\dashboard.sqlite-shm"; Relative = 'data\dashboard.sqlite-shm' },
        @{ Source = "$Dash\data\dashboard-revision.json"; Relative = 'data\dashboard-revision.json' },
        @{ Source = "$Dash\data\audit-head.json"; Relative = 'data\audit-head.json' }
    )
    try {
        $backup = Backup-DashboardState -BackupRoot "$Root\backups" -Entries $entries -Reason 'Dashboard-Update'
    } catch {
        Stop-Dashboard "Dashboard-Sicherung vor dem Update fehlgeschlagen: $($_.Exception.Message)"
    }
    Ok "Vorheriger Dashboard-Build, Konfiguration und Datenbank gesichert: $backup"
}
function Install-Dashboard {
    Write-DashLog "=== Dashboard-Schritt gestartet ($(Get-Date -Format s)) ==="
    Info "Ziel: $Dash  |  URL: $DashUrl  |  Log: $DashInstallLog"
    # Erst den Dienst stoppen, dann sichern: sonst schreibt das laufende Dashboard waehrend der Kopie in
    # dashboard.sqlite/-wal und die Sicherung ist inkonsistent (INS-11). Der Dienst startet am Ende des Schritts neu.
    if ($CustomRoot -and $UpdateDashboard) {
        Stop-DashboardService
        Backup-CustomDashboard
    }

    # --- Quelle des Command Centers: Ordner neben installer\ (oder der beim ersten Start gemerkte)
    $src = $null
    foreach ($cand in @((Split-Path $PSScriptRoot -Parent), $State.dashboard_source)) {
        if ($cand -and (Test-Path "$cand\pnpm-workspace.yaml") -and (Test-Path "$cand\apps\control-api\package.json")) { $src = "$cand".TrimEnd('\'); break }
    }
    if (-not $src) {
        Stop-Dashboard "Die Quellen des Command Centers (Ordner apps, packages, adapters, config neben dem Ordner 'installer') wurden nicht gefunden. Bitte das komplette Paket entpacken (nicht nur den Ordner 'installer') und install-friday.bat aus dem entpackten Paket starten; der entpackte Ordner muss bis zum Ende der Installation an seinem Platz bleiben."
    }
    if ($src -eq $Dash) { Stop-Dashboard "Die Quelle darf nicht $Dash selbst sein - bitte install-friday.bat aus dem entpackten Paket starten." }
    Info "Quelle: $src"

    # --- Node.js + pnpm
    $node = Ensure-Node
    $pm = (Get-Content "$src\package.json" -Raw | ConvertFrom-Json).packageManager
    if (-not ("$pm" -match '^pnpm@(\d+\.\d+\.\d+)')) { Stop-Dashboard "Im package.json fehlt 'packageManager: pnpm@<Version>' ($src\package.json)." }
    $pnpmVersion = $Matches[1]
    Ensure-Pnpm $pnpmVersion
    Ensure-FFmpeg | Out-Null

    # --- Quellen bereitstellen, installieren, bauen (nur wenn sich etwas geaendert hat)
    Info 'Prüfe Quellstand …'
    $hash = Get-SourceHash $src
    $built = (Test-Path "$Dash\apps\control-api\dist\main.js") -and [bool](Get-ChildItem "$Dash\apps\web\out" -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($State.dashboard_hash -eq $hash -and $built) {
        Ok "Quellen unverändert (Hash $($hash.Substring(0, 12))) - Build übersprungen."
    } else {
        # Der Hash gilt erst nach einem vollstaendigen Build wieder: ein abgebrochener Neubau darf beim naechsten Lauf
        # nicht als fertig gelten, nur weil alte dist-Dateien und eine teilweise Web-Ausgabe vorhanden sind.
        $State.dashboard_hash = $null; Save-State
        Stop-DashboardService
        Info "Kopiere das Command Center nach $Dash …"
        Sync-DashSource $src
        Info 'pnpm install --frozen-lockfile (beim ersten Mal einige Minuten, braucht Internet) …'
        $code = Invoke-Pnpm @('install', '--frozen-lockfile')
        if ($code -ne 0) {
            Show-DashLogTail
            if ((Get-Content $DashInstallLog -Tail 60 -ErrorAction SilentlyContinue) -match 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ERR_PNPM_FETCH|ERR_SOCKET') {
                Stop-Dashboard "pnpm install ist fehlgeschlagen: die npm-Registry ist nicht erreichbar (Internet/Proxy prüfen). Log: $DashInstallLog"
            }
            Stop-Dashboard "pnpm install ist fehlgeschlagen (Exitcode $code). Log: $DashInstallLog"
        }
        Info 'pnpm build:app (Web + Control API, einige Minuten) …'
        $code = Invoke-Pnpm @('build:app')
        if ($code -ne 0) { Show-DashLogTail; Stop-Dashboard "Der Build des Command Centers ist fehlgeschlagen (Exitcode $code). Log: $DashInstallLog" }
        if (-not (Test-Path "$Dash\apps\control-api\dist\main.js")) { Stop-Dashboard "Build ohne Ergebnis: $Dash\apps\control-api\dist\main.js fehlt. Log: $DashInstallLog" }
        $State.dashboard_hash = $hash; $State.dashboard_pnpm = $pnpmVersion; Save-State
        Ok 'Command Center gebaut.'
    }
    $State.dashboard_source = $src; Save-State

    # --- Konfiguration + Owner-Passwort
    Write-DashboardConfig
    Set-DashPort
    if ($DashPort -ne $Ports.CommandCenter) { Info "Port aus dashboard.yaml: $DashPort" }
    Set-DashboardOwnerPassword

    # --- Autostart, Start, Healthcheck
    Stop-DashboardService
    $owner = Get-PortOwner $DashPort
    if ($owner) {
        Warn "Port $DashPort ist belegt durch '$($owner.Name)' (PID $($owner.ProcessId)): $($owner.CommandLine)"
        Warn "Das Command Center wurde gebaut und konfiguriert, aber nicht gestartet. Programm beenden oder in $Dash\config\dashboard.yaml einen anderen Port wählen, dann install-friday.bat erneut starten."
        return
    }
    Register-UserTask $DashTask "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-dashboard.ps1`"" 'F.R.I.D.A.Y. Command Center (Dashboard + Control API)' 60
    Ok "Aufgabe $DashTask eingerichtet (startet bei jeder Anmeldung, bei Absturz Neustart nach 10 s)."
    Start-ScheduledTask -TaskName $DashTask
    Info 'Warte auf das Command Center (bis zu 60 Sekunden) …'
    $h = $null
    foreach ($i in 1..30) { $h = Test-DashboardHealth 3; if ($h.Up) { break }; Start-Sleep 2 }
    if (-not $h.Up) {
        Warn "Das Command Center antwortet nicht auf $DashUrl/api/v1/health. Log: $Root\logs\dashboard-service.log (und $DashInstallLog)."
        Warn 'Sprache und Hermes laufen davon unabhängig weiter. Ursache beheben und install-friday.bat erneut starten.'
        return
    }
    if ($h.Code -ge 200 -and $h.Code -lt 300) { Ok "Command Center läuft: $DashUrl (Health $($h.Code))" }
    else { Warn "Command Center läuft, meldet aber HTTP $($h.Code) (einzelne Adapter eingeschränkt? Siehe $Root\logs\dashboard-service.log). Es bleibt eingerichtet." }
    if ($DashTask -eq 'JARVIS_Dashboard') {
        if ($h.Code -lt 200 -or $h.Code -ge 300) {
            Warn 'Legacy-Dashboard-Autostart bleibt erhalten, bis das Command Center einen erfolgreichen Healthcheck liefert.'
            return
        }
        Move-LegacyDashboardTask | Out-Null
    }
    $script:DashOk = $true
}

Set-DashPort
if (-not (IsDone 'dashboard') -or $UpdateDashboard) {
    Enter-Step 'dashboard'
    Title 'Schritt 15/15 – F.R.I.D.A.Y. Command Center (Dashboard) einrichten'
    try { Install-Dashboard }
    catch {
        $script:DashOk = $false
        Write-DashLog "FEHLER: $($_.Exception.Message)"
        Write-Host ""; Write-Host "  [FEHLER] Command Center: $($_.Exception.Message)" -ForegroundColor Red
        Warn "Log: $DashInstallLog"
    }
    if ($script:DashOk) {
        MarkDone 'dashboard'
        # Auch ein GitHub-ZIP ohne .git liefert den Commit (installer\source-revision.txt); ohne ihn zeigt die
        # Systemseite keinen Stand und das Dashboard-Update verweigert den Start.
        $revision = Get-DashboardSourceRevision $State.dashboard_source
        if ($revision) {
            $revisionFile = "$Dash\data\dashboard-revision.json"
            $revisionJson = @{ commit = "$revision"; installedAt = (Get-Date -Format o) } | ConvertTo-Json
            [IO.File]::WriteAllText($revisionFile, $revisionJson, [Text.UTF8Encoding]::new($false))
        } else {
            Warn 'Quell-Commit unbekannt (weder Git-Checkout noch GitHub-ZIP): die Systemseite zeigt keinen Dashboard-Stand.'
        }
    } else {
        Warn 'Das Command Center ist noch nicht fertig eingerichtet (Details oben). Sprache und Hermes sind davon nicht betroffen.'
        Warn "Erneut versuchen: update-dashboard.bat (im Paketordner) oder install-friday.bat -Resume. Log: $DashInstallLog"
    }
}

# Ein Moduswechsel muss auch den laufenden Dashboard-Adaptern bekannt sein;
# sonst melden sie den absichtlich abgeschalteten Qwen-Dienst als Fehler.
if ($State.voice_mode -in @('local', 'elevenlabs') -and (IsDone 'dashboard')) {
    $adapterPath = "$Dash\config\adapters.yaml"
    if (Test-Path -LiteralPath $adapterPath -PathType Leaf) {
        $adapterText = [IO.File]::ReadAllText($adapterPath)
        $modeText = if ($State.voice_mode -eq 'elevenlabs') { 'true' } else { 'false' }
        $pattern = '(?m)^(?<line>      (?:localModelUrl|qwenUrl):[^\r\n]*)(?:\r?\n      cloudMode: (?:true|false))?'
        $matches = [regex]::Matches($adapterText, $pattern)
        if ($matches.Count -eq 2) {
            $updated = [regex]::Replace($adapterText, $pattern, { param($m) "$($m.Groups['line'].Value)`n      cloudMode: $modeText" })
            if ($updated -ne $adapterText) {
                Copy-Item -LiteralPath $adapterPath -Destination "$Root\backups\adapters.yaml.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
                [IO.File]::WriteAllText($adapterPath, $updated, (New-Object Text.UTF8Encoding $false))
                Stop-DashboardService
                Start-ScheduledTask -TaskName $DashTask
            }
            $State.voice_mode_changed = $false
            Save-State
        } elseif ($State.voice_mode_changed) { Warn 'Dashboard-Adapterkonfiguration hat eine angepasste Struktur; Cloud-Modus dort manuell setzen.' }
    }
}

# The API creates this independent read-only key on startup. Transfer it only via stdin
# after the dashboard is healthy; never put it in WSL command arguments or installer logs.
if (-not $ChangeVoice -and (IsDone 'skills') -and (IsDone 'dashboard')) {
    $calendarKeyFile = "$Dash\data\calendar-bridge\auth.key"
    if (Test-Path -LiteralPath $calendarKeyFile) {
        $calendarKey = [IO.File]::ReadAllText($calendarKeyFile).Trim()
        try {
            $calendarBridgeResult = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_calendar_bridge.sh" $calendarKey
            if ($calendarBridgeResult -match 'FRIDAY_CALENDAR_BRIDGE_READY') { Ok 'Hermes-Kalenderleser mit privatem lokalem Schluessel eingerichtet.' }
            else { Warn 'Hermes-Kalenderleser nicht eingerichtet; Kalender im Dashboard bleibt verfuegbar.' }
        } finally { $calendarKey = $null }
    } else { Warn 'Kalender-Dienstschluessel fehlt; Dashboard-Health und API-Start pruefen.' }
}

# The mail bridge has its own read-only API credential. Keep it out of WSL
# command arguments, console output, and the general Hermes/voice credentials.
if (-not $ChangeVoice -and (IsDone 'skills') -and (IsDone 'dashboard')) {
    $mailKeyFile = "$Dash\data\mail-bridge\auth.key"
    $mailHealth = Test-DashboardHealth 3
    if (-not $mailHealth.Up -or $mailHealth.Code -lt 200 -or $mailHealth.Code -ge 300) {
        Warn 'Mail-Bruecke nicht eingerichtet: Dashboard-Healthcheck ist nicht erfolgreich.'
    } elseif (Test-Path -LiteralPath $mailKeyFile -PathType Leaf) {
        $mailKey = [IO.File]::ReadAllText($mailKeyFile).Trim()
        try {
            if ($mailKey -notmatch '^[A-Za-z0-9+/]{43}=$') {
                Warn 'Mail-Dienstschluessel ungueltig; Hermes-Mailleser nicht eingerichtet.'
            } else {
                $mailBridgeResult = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_mail_bridge.sh" $mailKey
                if ($mailBridgeResult -match 'FRIDAY_MAIL_BRIDGE_READY') { Ok 'Hermes-Mailleser mit privatem lokalem Schluessel eingerichtet.' }
                else { Warn 'Hermes-Mailleser nicht eingerichtet; Postfach im Dashboard bleibt verfuegbar.' }
            }
        } catch {
            Warn 'Hermes-Mailleser nicht eingerichtet; Postfach im Dashboard bleibt verfuegbar.'
        } finally { $mailKey = $null }
    } else { Warn 'Mail-Dienstschluessel fehlt; Dashboard-Health und API-Start pruefen.' }
}

# Hermes liest und speichert den Content-Studio-Plan mit eigenem Schluessel (nur Plan, Revision geprueft, I-054);
# bezahlte Studio-Aktionen bleiben im Dashboard. Schluessel nur per stdin, nie als WSL-Argument oder im Log.
if (-not $ChangeVoice -and (IsDone 'skills') -and (IsDone 'dashboard')) {
    $studioKeyFile = "$Dash\data\content-studio-bridge\auth.key"
    $studioHealth = Test-DashboardHealth 3
    if (-not $studioHealth.Up -or $studioHealth.Code -lt 200 -or $studioHealth.Code -ge 300) {
        Warn 'Hermes-Studioplan nicht eingerichtet: Dashboard-Healthcheck ist nicht erfolgreich.'
    } elseif (Test-Path -LiteralPath $studioKeyFile -PathType Leaf) {
        $studioKey = [IO.File]::ReadAllText($studioKeyFile).Trim()
        try {
            if ($studioKey -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Ungueltiger Studio-Dienstschluessel.' }
            $studioResult = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_studio_bridge.sh" $studioKey
            if ($studioResult -match 'FRIDAY_STUDIO_BRIDGE_READY') { Ok 'Hermes-Studioplan mit privatem lokalem Schluessel eingerichtet.' }
            else { Warn 'Hermes-Studioplan nicht eingerichtet; Content Studio im Dashboard bleibt verfuegbar.' }
        } catch { Warn 'Hermes-Studioplan nicht eingerichtet; Content Studio im Dashboard bleibt verfuegbar.' }
        finally { $studioKey = $null }
    } else { Warn 'Studio-Dienstschluessel fehlt; Dashboard-API-Start pruefen.' }
}

# A distinct owner-only memory credential reaches the pinned local Hermes CLI plugin.
if (-not $ChangeVoice -and (IsDone 'skills') -and (IsDone 'dashboard')) {
    $memoryKeyFile = "$Dash\data\hermes-memory-bridge\auth.key"
    $memoryHealth = Test-DashboardHealth 3
    if (-not $memoryHealth.Up -or $memoryHealth.Code -lt 200 -or $memoryHealth.Code -ge 300) {
        Warn 'Hermes-Gedächtnis nicht eingerichtet: Dashboard-Healthcheck fehlgeschlagen.'
    } elseif (Test-Path -LiteralPath $memoryKeyFile -PathType Leaf) {
        $memoryKey = [IO.File]::ReadAllText($memoryKeyFile).Trim()
        try {
            if ($memoryKey -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Ungültiger Gedächtnis-Dienstschlüssel.' }
            $memoryResult = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_memory_bridge.sh" $memoryKey
            if ($memoryResult -match 'FRIDAY_MEMORY_BRIDGE_READY') { Ok 'Hermes-CLI-Gedächtnis mit privatem lokalem Schlüssel eingerichtet.' }
            else { Warn 'Hermes-CLI-Gedächtnis nicht eingerichtet; Hermes-Version und Hook-Status prüfen.' }
        } catch { Warn 'Hermes-CLI-Gedächtnis nicht eingerichtet; Hermes-Version und Hook-Status prüfen.' }
        finally { $memoryKey = $null }
    } else { Warn 'Hermes-Gedächtnis-Dienstschlüssel fehlt; Dashboard-API-Start prüfen.' }
}

# The gateway admission hook uses a separate scoped key; CLI Memory credentials never authenticate it.
if (-not $ChangeVoice -and (IsDone 'skills') -and (IsDone 'dashboard')) {
    $messengerKeyFile = "$Dash\data\hermes-messenger-bridge\auth.key"
    $messengerHealth = Test-DashboardHealth 3
    if ($messengerHealth.Up -and $messengerHealth.Code -ge 200 -and $messengerHealth.Code -lt 300 -and
        (Test-Path -LiteralPath $messengerKeyFile -PathType Leaf)) {
        $messengerKey = [IO.File]::ReadAllText($messengerKeyFile).Trim()
        try {
            if ($messengerKey -notmatch '^[A-Za-z0-9+/]{43}=$') { throw 'Ungültiger Messenger-Dienstschlüssel.' }
            $messengerResult = Wsl-Run $State.linux_user "$WslInstPath/wsl/setup_messenger_inbound_bridge.sh" $messengerKey
            if ($messengerResult -match 'FRIDAY_MESSENGER_BRIDGE_READY') { Ok 'Hermes-Messenger-Empfang mit eigenem lokalem Schlüssel eingerichtet.' }
            else { Warn 'Hermes-Messenger-Empfang nicht eingerichtet; Hermes-Hook und Gateway prüfen.' }
        } catch { Warn 'Hermes-Messenger-Empfang nicht eingerichtet; Hermes-Hook und Gateway prüfen.' }
        finally { $messengerKey = $null }
    } else { Warn 'Messenger-Dienstschlüssel oder Dashboard-Health fehlt; Messenger-Empfang nicht eingerichtet.' }
}

# ================================================================ Zusatz: Service-Watchdog (FRIDAY_Watchdog)
# Prueft alle 5 Minuten, ob Sprachdienst, Qwen und Command Center antworten, und startet abgestuerzte Dienste ueber ihre Aufgabe neu
# (Regeln: scripts\friday-watchdog.ps1). Laeuft unsichtbar ueber hidden.vbs (wscript), wie die uebrigen FRIDAY-Aufgaben - ein direkter
# powershell.exe-Start mit -WindowStyle Hidden blitzt sonst alle 5 Minuten ein Konsolenfenster auf. Idempotent: wird bei jedem Lauf
# neu registriert. Ein Fehler hier laesst die Installation unberuehrt (nur Warnung). Andere Aufgaben (z. B. ein altes
# FRIDAY_Voice_Watchdog frueherer Installer) werden nicht angefasst.
if (-not $CustomRoot -or -not ($UpdateDashboard -or $ChangeVoice)) {
Title 'Zusatz – Service-Watchdog einrichten'
$eapBefore = $ErrorActionPreference
$ErrorActionPreference = 'Stop'
try {
    $wd = "$Inst\scripts\friday-watchdog.ps1"
    if (-not (Test-Path $wd)) { throw "$wd fehlt (Installationsdateien unvollständig)." }
    Register-UserTask 'FRIDAY_Watchdog' "`"$Inst\scripts\hidden.vbs`" `"$wd`"" 'F.R.I.D.A.Y. Service-Watchdog: startet abgestürzte Dienste neu (alle 5 Minuten, unsichtbar)' 120 5 2
    if (-not (Get-ScheduledTask -TaskName 'FRIDAY_Watchdog')) { throw 'Aufgabe FRIDAY_Watchdog nach der Registrierung nicht auffindbar.' }
    Ok "Aufgabe FRIDAY_Watchdog eingerichtet (alle 5 Minuten und bei Anmeldung, unsichtbar). Log: $Root\logs\watchdog.log"
    MarkDone 'watchdog'
} catch {
    Warn "Service-Watchdog nicht eingerichtet: $($_.Exception.Message)"
    Warn 'Die Dienste laufen trotzdem; ohne Watchdog werden abgestürzte Dienste nur durch die eigenen Neustartschleifen bzw. bei der nächsten Anmeldung wieder gestartet. Erneut versuchen: install-friday.bat starten.'
} finally { $ErrorActionPreference = $eapBefore }
} else { Info 'Watchdog bleibt bei diesem gezielten Update unveraendert.' }

$DashProbe = Test-DashboardHealth 3
$p = Get-Content "$Root\config\persona.json" -Raw | ConvertFrom-Json
$dashNote = if (IsDone 'dashboard') { '' } else { "ACHTUNG: Command Center nicht eingerichtet - update-dashboard.bat oder install-friday.bat -Resume starten. Log: $DashInstallLog" }
$qwenReportLine = if ($State.voice_mode -eq 'elevenlabs') { '' } else { "| Qwen3-4B (lokal) | http://127.0.0.1:$($Ports.Qwen)/v1 |" }
$report = @"
# F.R.I.D.A.Y. – Installationsstatus

Installiert am $(Get-Date -Format 'dd.MM.yyyy HH:mm') für $($p.owner_name). Assistent: $AN · Wake Word: "$WP" ($($State.wake_engine)).

| Komponente | Adresse |
|---|---|
| F.R.I.D.A.Y. Command Center | $DashUrl (Anmeldung im Browser) |
| Hermes Dashboard | http://127.0.0.1:$($Ports.Dashboard) |
$qwenReportLine
| Hermes API (für Sprache) | http://127.0.0.1:$($Ports.HermesApi)/v1 |
| Sprachdienst-Status | http://127.0.0.1:$($Ports.Voice) |

Grafikkarte: $($State.gpu.name) ($($State.gpu.vram_mb) MB) · Linux-Benutzer: $($State.linux_user)
Autostart: vorhandene Aufgabenplanung, Dashboard-Aufgabe $DashTask. Watchdog: FRIDAY_Watchdog (alle 5 Minuten). Hermes-Dienste: systemd in $Distro.
$dashNote
Friday-Skills: $(if (IsDone 'skills') { "Registry validiert, Commit $($State.skills_commit)" } else { 'fehlen oder nicht validiert; Installer erneut starten' }). Hermes-Standardskills bleiben in Hermes.
Erste Einrichtung: Im Command Center Besitzerkonto anlegen oder anmelden. Bei einem neuen Besitzer startet dort die fortsetzbare Einführung mit Profil, Friday- und Hermes-Skills sowie Konto-Voraussetzungen. Ein Skill ist erst nutzbar, wenn Hermes und die nötigen Integrationen ihn tatsächlich bereitstellen.
WSL-Voraussetzungen (Fund, keine Funktionsprobe): $($readiness -replace "`n", '; ')
Obsidian-Vault: $vaultStatus
Optionale Coding-CLIs: Im Installerordner setup-coding-cli.ps1 -Cli opencode|codex|claude ausfuehren; ChatGPT-/Claude-Abo-Anmeldung danach interaktiv mit -Cli codex|claude -Login. Jede CLI wird nur auf ausdrueckliche Auswahl nativ in WSL installiert. Eine Versionspruefung belegt weder Anmeldung noch einen erfolgreichen Coding-Auftrag.
Optionale E-Mail-CLI: installer\setup-himalaya.ps1 -Action install; IMAP-/SMTP-Konto danach unter Einstellungen > Skill-Konten anlegen. Anbieterzugriff bleibt bis zur echten Kontopruefung offen.
Erledigte Schritte: $(@($State.done) -join ', ')
"@
[IO.File]::WriteAllText("$Root\INSTALL_STATE.md", $report, (New-Object Text.UTF8Encoding $false))
Remove-Item "$Root\run\installer.active" -Force -ErrorAction SilentlyContinue   # Installer fertig: der Watchdog darf wieder eingreifen

Title "FERTIG – $AN ist einsatzbereit"
Info "Sag:  ""$WP""  … kurzer Piepton … dann deine Frage, z. B. ""Wie spät ist es?"""
Info "Folgefragen gehen 15 Sekunden lang ohne erneutes ""$WP""."
if ($DashProbe.Up) { Info "Command Center (Dashboard): $DashUrl" }
else { Warn "Command Center nicht erreichbar ($DashUrl) - Logs: $Root\logs\dashboard-service.log, $DashInstallLog. Erneut versuchen: update-dashboard.bat oder install-friday.bat -Resume." }
Info "Hermes-Dashboard (Kanban, Einstellungen): http://127.0.0.1:$($Ports.Dashboard)"
Info 'Alles startet ab jetzt automatisch bei der Anmeldung.'
if ($DashProbe.Up) { Info 'Erste Einrichtung: Command Center öffnen, Besitzerkonto anlegen/anmelden und die Einführung durchlaufen. Friday zeigt dort Skills und noch fehlende Konten.' }
Info 'Optionale native Coding-CLI: installer\setup-coding-cli.ps1 -Cli opencode|codex|claude (einzeln, nach Bedarf).'
Info 'ChatGPT-/Claude-Abo fuer Coding-CLI: installer\setup-coding-cli.ps1 -Cli codex|claude -Login (interaktiv).'
Info 'Optionales IMAP/SMTP: installer\setup-himalaya.ps1 -Action install; Postfach im Dashboard unter Skill-Konten.'
Info 'Nächste Schritte (Telegram, E-Mail, Kalender): siehe ANLEITUNG.md'
if (-not $CustomRoot) { Show-MigrationSummary }
if ($DashProbe.Up -and (YesNo 'Command Center jetzt im Browser öffnen?')) { Start-Process $DashUrl }
elseif (-not $DashProbe.Up) { Start-Process "http://127.0.0.1:$($Ports.Dashboard)" }
$finalCode = if ($GuiMode -and -not $DashProbe.Up) { 1 } else { 0 }
Write-GuiRunDone $finalCode 'ok'
Exit-InstallerLock $InstallerLock
Stop-Transcript | Out-Null
if (-not $GuiMode) { Read-Host '  Enter zum Schließen' }
if ($GuiMode -and -not $DashProbe.Up) { exit 1 }
