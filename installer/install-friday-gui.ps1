#Requires -Version 5.1
param([string]$ResumeRoot = '', [ValidateSet('','success','failure','restart')][string]$Simulation = '',
      [switch]$ChangeVoice, [ValidateSet('','local','elevenlabs')][string]$VoiceTarget = '')

# Simulation nur im lokalen Testmodus: ohne Marker keine Trockenlaeufe, die einen Erfolg vortaeuschen.
if ($Simulation -and $env:FRIDAY_GUI_TEST -ne '1') {
    [Console]::Error.WriteLine('Simulation ist nur im lokalen GUI-Testmodus erlaubt (FRIDAY_GUI_TEST=1).')
    exit 2
}

# Start mit Administratorrechten: nur fester Skriptpfad und optionaler Zielordner, keine Geheimnisse.
. (Join-Path $PSScriptRoot 'lib\elevation.ps1')
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $forward = @()
    if ($ResumeRoot) { $forward += @('-ResumeRoot', ('"' + $ResumeRoot + '"')) }
    if ($Simulation) { $forward += @('-Simulation', $Simulation) }
    if ($ChangeVoice) { $forward += '-ChangeVoice' }
    if ($VoiceTarget) { $forward += @('-VoiceTarget', $VoiceTarget) }
    $elevation = Start-ElevatedPowerShell -ScriptPath $PSCommandPath -ForwardedArguments $forward -Sta
    if ($elevation.Canceled) { exit 3 }
    if (-not $elevation.Started) { [Console]::Error.WriteLine('Start mit Administratorrechten fehlgeschlagen: ' + $elevation.Message); exit 4 }
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# Kooperativer Abbruch: dieselbe Bitte, die der Installer an seinen Schrittgrenzen prueft.
. (Join-Path $PSScriptRoot 'lib\installer-cancel.ps1')
# Ereignisstrom des Installers (Protokoll 2); unbekannte Zeilen bleiben sichtbarer Text.
. (Join-Path $PSScriptRoot 'lib\gui-protocol.ps1')
# Rueckkanal der Stimmaufnahme: Anfrage und Antwort als Dateien (derselbe Vertrag wie in der Aufnahme).
. (Join-Path $PSScriptRoot 'lib\gui-interaction.ps1')
# Layoutvertrag, Bild und Rahmen der Oberflaeche.
. (Join-Path $PSScriptRoot 'gui\layout.ps1')
. (Join-Path $PSScriptRoot 'gui\background.ps1')
. (Join-Path $PSScriptRoot 'gui\shell.ps1')

$script:cancelGraceSeconds = 25
$script:fields = @{}
$script:captions = @{}

# Die Anzeigeskalierung kommt aus dem System, nicht aus einer Annahme: bei 150 % waechst das Fenster
# mit und alle Abstaende und Schriften wachsen mit.
$script:dpiScale = 1.0
try {
    $screenGraphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    try { $script:dpiScale = [math]::Round($screenGraphics.DpiX / 96, 2) } finally { $screenGraphics.Dispose() }
} catch { $script:dpiScale = 1.0 }
if ($script:dpiScale -lt 1) { $script:dpiScale = 1.0 }
$startSize = New-Object Drawing.Size([int](1200 * $script:dpiScale), [int](760 * $script:dpiScale))
$shell = New-GuiShell -ClientSize $startSize -Scale $script:dpiScale -AdditionalBackdropPaths @((Join-Path $PSScriptRoot '..\installer_background.png'))
$form = $shell.Form
# Felder liegen in einer Spalte; Beschriftung links, Eingabe rechts daneben. Alle Masse skalieren.
$script:labelWidth = [int](190 * $script:dpiScale)
$script:inputLeft = [int](196 * $script:dpiScale)
$script:inputWidth = [int](300 * $script:dpiScale)
$script:rowHeight = [int](38 * $script:dpiScale)

function Add-Row($panel, [string]$name, [string]$label, [int]$y, [string]$value = '', [bool]$password = $false) {
    $caption = New-Object Windows.Forms.Label
    $caption.Text = $label; $caption.Location = New-Object Drawing.Point(0, ($y + 3))
    $caption.Size = New-Object Drawing.Size($script:labelWidth, [int](20 * $script:dpiScale))
    $caption.BackColor = [Drawing.Color]::Transparent
    $caption.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $panel.Controls.Add($caption)
    $script:captions[$name] = $caption
    $input = New-Object Windows.Forms.TextBox
    $input.Name = $name; $input.Text = $value
    $input.Location = New-Object Drawing.Point($script:inputLeft, $y)
    $input.Size = New-Object Drawing.Size($script:inputWidth, [int](25 * $script:dpiScale))
    $input.UseSystemPasswordChar = $password
    $panel.Controls.Add($input)
    $script:fields[$name] = $input
    return $input
}
function Add-Check($panel, [string]$name, [string]$label, [int]$y, [bool]$checked = $false) {
    $box = New-Object Windows.Forms.CheckBox
    $box.Name = $name; $box.Text = $label; $box.Checked = $checked
    $box.Location = New-Object Drawing.Point(0, $y)
    $box.Size = New-Object Drawing.Size([int](496 * $script:dpiScale), [int](27 * $script:dpiScale))
    $box.BackColor = [Drawing.Color]::Transparent
    $box.ForeColor = Get-GuiColor $script:GuiLayout.SecondaryText
    $panel.Controls.Add($box); $script:fields[$name] = $box
    return $box
}
function Add-Choice($panel, [string]$name, [string]$label, [int]$y, [string[]]$items, [int]$selected = 0) {
    $caption = New-Object Windows.Forms.Label
    $caption.Text = $label; $caption.Location = New-Object Drawing.Point(0, ($y + 3))
    $caption.Size = New-Object Drawing.Size($script:labelWidth, [int](20 * $script:dpiScale))
    $caption.BackColor = [Drawing.Color]::Transparent
    $caption.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $panel.Controls.Add($caption)
    $script:captions[$name] = $caption
    $box = New-Object Windows.Forms.ComboBox
    $box.Name = $name; $box.DropDownStyle = 'DropDownList'; $box.Location = New-Object Drawing.Point($script:inputLeft, $y)
    $box.Size = New-Object Drawing.Size($script:inputWidth, [int](25 * $script:dpiScale))
    [void]$box.Items.AddRange($items)
    $box.SelectedIndex = $selected
    $panel.Controls.Add($box); $script:fields[$name] = $box
    return $box
}
function Add-Text($panel, [string]$text, [int]$y, [int]$height = 42) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text; $label.Location = New-Object Drawing.Point(0, $y)
    $label.Size = New-Object Drawing.Size([int](496 * $script:dpiScale), [int]($height * $script:dpiScale))
    $label.BackColor = [Drawing.Color]::Transparent
    $label.ForeColor = Get-GuiColor $script:GuiLayout.SecondaryText
    $panel.Controls.Add($label)
    return $label
}
function Set-ReadOnlyPath($box) {
    # Pfade nur per Durchsuchen: ein Tippfehler im Pfad faellt sonst erst im Installer auf.
    $box.ReadOnly = $true
    $box.BackColor = Get-GuiColor '#1A2433'
    $box.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
}
function Get-WslDistroNames {
    # wsl.exe schreibt ohne WSL_UTF8 UTF-16 mit Nullbytes in die Pipe.
    $previous = $env:WSL_UTF8
    try {
        $env:WSL_UTF8 = '1'
        $names = @(& wsl.exe -l -q 2>$null | ForEach-Object { ([string]$_).Replace([string][char]0, '').Trim() } | Where-Object { $_ })
    } catch { $names = @() } finally { $env:WSL_UTF8 = $previous }
    return @($names | Where-Object { $_ -match '^[A-Za-z][A-Za-z0-9._-]{0,63}$' } | Sort-Object -Unique)
}
function Get-FocusedControl($root) {
    # WinForms meldet am Formular nur den obersten Container; fuer die Tastaturpruefung wird das
    # tatsaechlich fokussierte Bedienelement gebraucht.
    foreach ($child in $root.Controls) {
        if ($child.Focused) { return $child }
        $found = Get-FocusedControl $child
        if ($found) { return $found }
    }
    return $null
}
function Test-FocusReachable($page, $form) {
    # Laeuft die Tabulatorreihenfolge der Seite einmal durch und liefert die erreichten Namen.
    $reachable = @()
    $first = $null
    foreach ($control in $page.Panel.Controls) {
        if ($control.TabStop -and $control.Enabled -and $control.Visible -and
            ($control -is [Windows.Forms.TextBox] -or $control -is [Windows.Forms.ComboBox] -or
             $control -is [Windows.Forms.Button] -or $control -is [Windows.Forms.CheckBox])) {
            $first = $control; break
        }
    }
    if (-not $first) { $first = $form.CancelButton }
    if (-not $first) { return $reachable }
    $first.Select()
    [System.Windows.Forms.Application]::DoEvents()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    for ($step = 0; $step -lt 80 -and $watch.Elapsed.TotalSeconds -lt 8; $step++) {
        $current = Get-FocusedControl $form
        if (-not $current) { break }
        if ($reachable -notcontains $current.Name) { $reachable += $current.Name }
        [void]$form.SelectNextControl($current, $true, $true, $true, $true)
        [System.Windows.Forms.Application]::DoEvents()
        $next = Get-FocusedControl $form
        if (-not $next -or $next.Name -eq $current.Name) { break }
    }
    return $reachable
}
function Value([string]$name) { return $script:fields[$name].Text.Trim() }
function Checked([string]$name) { return [bool]$script:fields[$name].Checked }
function BoolText([bool]$value) { if ($value) { return 'true' }; return 'false' }
function Show-Error([string]$message) {
    [void][Windows.Forms.MessageBox]::Show($message, 'F.R.I.D.A.Y. Installation', 'OK', 'Warning')
}
function Existing-State([string]$root) {
    $path = Join-Path $root 'config\install-state.json'
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try { return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { Show-Error "Installationszustand kann nicht gelesen werden: $path" }
    }
    return $null
}
function Protect-PrivatePath([string]$path, [bool]$directory) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    if ($directory) { $acl = New-Object Security.AccessControl.DirectorySecurity }
    else { $acl = New-Object Security.AccessControl.FileSecurity }
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($principal in @($sid, (New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'),
                                 (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
        if ($directory) {
            $rights = [Security.AccessControl.FileSystemRights]::FullControl
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal, $rights,
                [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
                [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        } else {
            $rule = New-Object Security.AccessControl.FileSystemAccessRule($principal,
                [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow)
        }
        $acl.AddAccessRule($rule)
    }
    if ($directory) { [IO.Directory]::SetAccessControl($path, $acl) }
    else { [IO.File]::SetAccessControl($path, $acl) }
}
function Secure-Text([string]$value) {
    if (-not $value) { return '' }
    $secure = ConvertTo-SecureString -String $value -AsPlainText -Force
    try { return (ConvertFrom-SecureString -SecureString $secure) }
    finally { $secure.Dispose() }
}
function Secure-Field([string]$name) { return Secure-Text $script:fields[$name].Text }
function Test-VoiceReferenceAnswer([int]$ModeIndex, [int]$ChoiceIndex, [string]$Reference) {
    # Die eigene Stimme hat keine mitgelieferte Ersatzdatei; ohne Datei braeche der Installer erst spaeter ab.
    if ($ModeIndex -eq 0 -and $ChoiceIndex -eq 2 -and -not "$Reference".Trim()) {
        throw 'Für die eigene Stimme bitte eine MP3/WAV-Datei (3 bis 30 Sekunden) wählen.'
    }
}
function Get-VoiceIdValue {
    $text = Value 'voiceId'
    if ($text -eq '(Standardstimme des Kontos)') { return '' }
    if ($text -match '\(([A-Za-z0-9]{10,64})\)$') { return $Matches[1] }
    return $text
}
function Use-AlibabaEnvironment {
    return (Get-ProviderPreset).BaseUrl -eq 'alibaba' -and [bool]$alibabaEnvironment -and (Checked 'useExistingAlibaba')
}
function Get-ProviderKeyText {
    if (Use-AlibabaEnvironment) { return [string]$alibabaEnvironment }
    return $script:fields.providerKey.Text.Trim()
}
function Use-ProviderKeyForQwen {
    # One Token Plan key serves the brain and Qwen Audio when the owner says so on the model page (U-02).
    return (Test-QwenSameKeyOffered) -and (Checked 'qwenSameKey') -and (Get-ProviderKeyText) -ne ''
}
function Test-Wizard {
    $root = Value 'installRoot'; $location = Value 'distroLocation'; $distro = Value 'distroName'
    if ($root -notmatch '^[A-Za-z]:\\[^<>:"|?*]+$' -or $root -match '[\\/]\.\.?([\\/]|$)') { throw 'Installationsordner: absoluten Windows-Pfad wählen.' }
    if ($root -ine 'C:\Friday' -and (-not $distro -or -not $location)) { throw 'Bei einem anderen Installationsordner sind Distributionsname und WSL-Ablageort erforderlich.' }
    if ($distro -and $distro -notmatch '^[A-Za-z][A-Za-z0-9_-]{0,31}$') { throw 'Ungültiger WSL-Distributionsname.' }
    if ($root -ine 'C:\Friday' -and $location -and ($location -notmatch '^[A-Za-z]:\\[^<>:"|?*]+$' -or $location -match '[\\/]\.\.?([\\/]|$)')) { throw 'Ungültiger WSL-Ablageort.' }
    if ($root -ine 'C:\Friday' -and $location.Substring(0,1) -ine $root.Substring(0,1)) { throw 'Installation und WSL-Ablage müssen auf demselben Laufwerk liegen.' }
    if ((Value 'assistantName') -notmatch '^\p{L}{2,20}$') { throw 'Assistentenname: 2 bis 20 Buchstaben.' }
    $wake = ((Value 'wakePhrase') -replace '\s+', ' ').Trim()
    $words = @($wake -split ' ')
    if ($wake.Length -lt 3 -or $wake.Length -gt 30 -or $words.Count -gt 4 -or @($words | Where-Object { $_ -notmatch '^\p{L}+(-\p{L}+)*$' }).Count) {
        throw 'Wake Word: 1 bis 4 Wörter aus Buchstaben, 3 bis 30 Zeichen.'
    }
    if ((Value 'ownerName') -eq '') { throw 'Bitte deinen Vornamen eintragen.' }
    if ((Value 'linuxUser') -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { throw 'Linux-Benutzername: Kleinbuchstaben, Zahlen, _ oder -.' }
    $state = Existing-State $root
    $done = if ($state) { @($state.done) } else { @() }
    if ($done -notcontains 'linuxuser' -and ($script:fields.linuxPassword.Text -eq '' -or
        $script:fields.linuxPassword.Text -cne $script:fields.linuxPasswordRepeat.Text)) { throw 'Linux-Passwort fehlt oder die Wiederholung stimmt nicht.' }
    if ($done -notcontains 'hermes' -and -not ($state -and $state.model_provider)) {
        $preset = Get-ProviderPreset
        $usesKimiEnvironment = $preset.Backend -eq '4' -and [bool]$kimiEnvironment -and (Checked 'useExistingKimi')
        if (-not $usesKimiEnvironment -and (Get-ProviderKeyText) -eq '') { throw "$($preset.KeyLabel) fehlt." }
        if ($preset.BaseUrl -eq 'custom' -and (Value 'modelBaseUrl') -notmatch '^https?://[^\s/]+') { throw 'Server-Adresse: vollständige URL mit https:// eintragen.' }
        if ($preset.Backend -ne '4' -and (Value 'modelName') -eq '') { throw 'Bitte ein Modell wählen.' }
        if ((Value 'modelName').Length -gt 200) { throw 'Der Modellname ist zu lang.' }
    }
    if ($script:fields['voiceMode'].SelectedIndex -eq 1 -and (Value 'elevenlabsKey') -eq '') {
        $existingCloudKey = Test-Path -LiteralPath (Join-Path $root 'config\elevenlabs_api.key.dpapi') -PathType Leaf
        if (-not $existingCloudKey) { throw 'ElevenLabs-API-Schlüssel fehlt.' }
    }
    if ($script:fields.conversationBackend.SelectedIndex -eq 1 -and -not (Checked 'qwenConsent')) { throw 'Für Qwen Audio ist deine Zustimmung zur Datenübertragung an Alibaba Cloud nötig. Sonst „Lokal“ wählen.' }
    if ($script:fields.conversationBackend.SelectedIndex -eq 1 -and (Value 'qwenAudioKey') -eq '' -and
        -not (Test-Path -LiteralPath (Join-Path $root 'config\alibaba_tokenplan.key.dpapi') -PathType Leaf) -and
        -not (Use-ProviderKeyForQwen)) {
        throw 'Für Qwen Audio fehlt der Alibaba-Token-Plan-Schlüssel: auf der Seite „Sprache & Stimme“ eintragen oder beim KI-Zugang „Diesen Schlüssel auch für Qwen Audio verwenden“ anhaken.'
    }
    if (-not ($state -and $state.voice_mode) -or $ChangeVoice) {
        Test-VoiceReferenceAnswer $script:fields.voiceMode.SelectedIndex $script:fields.voiceChoice.SelectedIndex (Value 'voiceReference')
    }
    if ((Value 'voiceReference') -and (-not ($state -and $state.voice_mode) -or $ChangeVoice) -and
        -not (Test-Path -LiteralPath (Value 'voiceReference') -PathType Leaf)) { throw 'Die gewählte Stimmreferenz wurde nicht gefunden.' }
    if ((Value 'voiceReference') -and (Test-Path -LiteralPath (Value 'voiceReference') -PathType Leaf)) {
        $referenceFile = Get-Item -LiteralPath (Value 'voiceReference')
        if ($referenceFile.Extension.ToLowerInvariant() -notin @('.wav', '.mp3')) { throw 'Die Stimmreferenz muss eine WAV- oder MP3-Datei sein.' }
        if ($referenceFile.Length -lt 1024) { throw 'Die Stimmreferenz ist leer oder beschädigt.' }
    }
    if ($state -and @($state.done) -contains 'voicepython' -and
        ($script:fields.inputDevice.SelectedIndex -gt 0 -or $script:fields.outputDevice.SelectedIndex -gt 0)) {
        throw 'Die Gerätewahl gilt bei neuer Spracheinrichtung.'
    }
    if ($script:fields.voiceMode.SelectedIndex -eq 1 -and (Get-VoiceIdValue) -and (Get-VoiceIdValue) -notmatch '^[A-Za-z0-9]{10,64}$') {
        throw 'ElevenLabs Voice ID: 10 bis 64 Buchstaben oder Zahlen.'
    }
    return $state
}

# --- Seiten des Assistenten. Eine Seite ist ein Panel in der Seitenflaeche des Rahmens.
$script:pages = New-Object System.Collections.ArrayList
function New-WizardPage([string]$key, [string]$title, [string]$body) {
    $panel = New-Object Windows.Forms.Panel
    $panel.Name = $key
    $panel.Dock = [Windows.Forms.DockStyle]::Fill
    $panel.BackColor = [Drawing.Color]::Transparent
    $panel.AutoScroll = $true
    $panel.Visible = $false
    $shell.PageHost.Controls.Add($panel)
    $page = [ordered]@{ Key = $key; Title = $title; Body = $body; Panel = $panel }
    [void]$script:pages.Add($page)
    return $page
}

function Get-PageIndex([string]$key) {
    for ($i = 0; $i -lt $script:pages.Count; $i++) { if ($script:pages[$i].Key -eq $key) { return $i } }
    return -1
}

$systemPage = New-WizardPage 'systemPage' 'Systemprüfung' 'Prüft Windows, WSL2, Speicher, Rechte und Grafik, bevor etwas verändert wird.'
$systemReport = Add-Text $systemPage.Panel 'Prüfung läuft …' 0 120
$systemPage.Panel.Controls.Add((Add-Text $systemPage.Panel 'Benötigt: Windows mit WSL2, 40 GB freier Speicher, Internet und Administratorrechte. Lokale Sprache benötigt eine NVIDIA-GPU mit mindestens 6 GB VRAM. ElevenLabs verwendet eine Cloud-API; je nach Konto können Kosten entstehen.' 128 96))
$refresh = New-Object Windows.Forms.Button; $refresh.Text = 'Erneut prüfen'
$refresh.Location = New-Object Drawing.Point(0, 232); $refresh.Size = New-Object Drawing.Size(150, 30)
$systemPage.Panel.Controls.Add($refresh)
# Die Systempruefung ist teuer (WMI, nvidia-smi): sie laeuft beim Wechsel des Ordners, nicht bei jedem Fokuswechsel.
$script:refreshedRoot = ''
$refresh.Add_Click({
    try {
        $drive = (Value 'installRoot').Substring(0,1)
        $volume = Get-Volume -DriveLetter $drive -ErrorAction Stop
        $free = [math]::Round($volume.SizeRemaining / 1GB)
        $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
        $gpu = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1) } else { 'Keine NVIDIA-GPU erkannt' }
        $systemReport.Text = "Windows Build $([Environment]::OSVersion.Version.Build)`r`nRAM: $ram GB`r`n${drive}: $free GB frei`r`nGrafik: $gpu`r`nWSL: $([bool](Get-Command wsl.exe -ErrorAction SilentlyContinue))`r`nInternet wird beim Start vom Installer geprüft."
    } catch { $systemReport.Text = "Systemprüfung nicht vollständig: $($_.Exception.Message)" }
    $script:refreshedRoot = Value 'installRoot'
})

$pathsPage = New-WizardPage 'pathsPage' 'Installationsort' 'Bei einer vorhandenen Installation werden die gespeicherten Werte übernommen; nichts wird still überschrieben.'
[void](Add-Text $pathsPage.Panel 'Installationsordner und WSL-Distribution. Ein anderer Ordner verlangt einen eigenen Distributionsnamen.' 0 44)
[void](Add-Row $pathsPage.Panel 'installRoot' 'Installationsordner' 50 'C:\Friday')
Set-ReadOnlyPath $script:fields.installRoot
$browseRoot = New-Object Windows.Forms.Button; $browseRoot.Text = 'Ordner wählen'
$browseRoot.Location = New-Object Drawing.Point(196, 78); $browseRoot.Size = New-Object Drawing.Size(130, 26)
$pathsPage.Panel.Controls.Add($browseRoot)
$browseRoot.Add_Click({
    $picker = New-Object Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Übergeordneten Ordner für die neue Friday-Installation wählen'
    $picker.ShowNewFolderButton = $false
    if ($picker.ShowDialog() -eq 'OK') {
        $selectedFolder = $picker.SelectedPath
        $script:fields.installRoot.Text = if ((Split-Path $selectedFolder -Leaf) -ieq 'Friday') { $selectedFolder } else { Join-Path $selectedFolder 'Friday' }
        Update-PathFields; Load-RootState; $refresh.PerformClick()
    }
})
$script:wslDistros = @(Get-WslDistroNames)
$distroBox = Add-Choice $pathsPage.Panel 'distroName' 'WSL-Distributionsname' 112 (@('Ubuntu') + @($script:wslDistros | Where-Object { $_ -ne 'Ubuntu' }))
$distroBox.DropDownStyle = 'DropDown'
[void](Add-Row $pathsPage.Panel 'distroLocation' 'WSL-Ablageort' 150 '(Windows-Standardort)')
Set-ReadOnlyPath $script:fields.distroLocation
$browseLocation = New-Object Windows.Forms.Button; $browseLocation.Text = 'Ordner wählen'
$browseLocation.Location = New-Object Drawing.Point(196, 178); $browseLocation.Size = New-Object Drawing.Size(130, 26)
$pathsPage.Panel.Controls.Add($browseLocation)
$browseLocation.Add_Click({
    $picker = New-Object Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Ordner für die WSL-Ablage wählen (gleiches Laufwerk wie die Installation)'
    $picker.ShowNewFolderButton = $true
    if ($picker.ShowDialog() -eq 'OK') {
        $selectedFolder = $picker.SelectedPath
        $script:fields.distroLocation.Text = if ((Split-Path $selectedFolder -Leaf) -ieq 'Friday-Ubuntu') { $selectedFolder } else { Join-Path $selectedFolder 'Friday-Ubuntu' }
    }
})
[void](Add-Check $pathsPage.Panel 'migrateLegacy' 'Vorhandenes C:\Jarvis nach C:\Friday übernehmen' 216 $true)
[void](Add-Check $pathsPage.Panel 'disableLegacy' 'Bei frischer Installation alte JARVIS-Dienste deaktivieren' 216 $true)
[void](Add-Check $pathsPage.Panel 'reuseDistro' 'Vorhandene passende WSL-Distribution verwenden' 216 $true)
[void](Add-Check $pathsPage.Panel 'disableForeignTasks' 'Bei Migration kollidierende alte Aufgaben deaktivieren' 216 $true)
[void](Add-Check $pathsPage.Panel 'overwriteDashboardConfig' 'Abweichende Dashboard-Vorgabe nach Sicherung überschreiben' 216 $false)
$script:legacyNote = Add-Text $pathsPage.Panel 'Bestehende Daten, Stimmprofile und Konfigurationen werden bei Fortsetzung berücksichtigt. Eine frühere JARVIS-Installation bleibt als Sicherung erhalten.' 346 56
# Beim Verlassen des Ordnerfelds wird die Systempruefung nur bei echter Aenderung neu gerechnet.
$script:fields.installRoot.Add_Leave({
    Update-PathFields
    Load-RootState
    if ($script:refreshedRoot -ne (Value 'installRoot')) { $refresh.PerformClick() }
})
function Update-PathFields {
    $custom = (Value 'installRoot') -ine 'C:\Friday'
    $script:fields.distroName.Enabled = $custom
    $script:fields.distroLocation.Enabled = $custom
    if ($custom -and $script:fields.distroName.Text -eq 'Ubuntu') { $script:fields.distroName.Text = 'Friday-Ubuntu' }
    if ($custom -and $script:fields.distroLocation.Text -eq '(Windows-Standardort)') {
        $script:fields.distroLocation.Text = (Value 'installRoot').Substring(0,1) + ':\Friday-Ubuntu'
    }
    if (-not $custom) {
        $script:fields.distroName.Text = 'Ubuntu'
        $script:fields.distroLocation.Text = '(Windows-Standardort)'
    }
    $browseLocation.Enabled = $custom
    Update-LegacyOptions
}
# Einmal beim Start: die Aufgabenplanung ist zu langsam fuer jeden Tastendruck.
$script:legacyTasksPresent = [bool](Get-ScheduledTask -TaskName 'JARVIS*' -ErrorAction SilentlyContinue)
function Update-LegacyOptions {
    # Nur zutreffende Fragen zeigen; ausgeblendete behalten ihren sicheren Standardwert.
    $root = Value 'installRoot'
    $legacyRoot = Test-Path -LiteralPath 'C:\Jarvis'
    $legacyTasks = $script:legacyTasksPresent
    $visible = [ordered]@{
        migrateLegacy = $legacyRoot
        disableLegacy = $legacyTasks
        reuseDistro = $script:wslDistros -contains (Value 'distroName')
        disableForeignTasks = $legacyRoot -or $legacyTasks
        overwriteDashboardConfig = Test-Path -LiteralPath (Join-Path $root 'config\dashboard.yaml')
    }
    $y = 216
    foreach ($name in $visible.Keys) {
        $script:fields[$name].Visible = [bool]$visible[$name]
        if ($visible[$name]) { $script:fields[$name].Top = $y; $y += 30 }
    }
    $script:legacyNote.Visible = $legacyRoot -or $legacyTasks -or [bool]$visible.overwriteDashboardConfig
    $script:legacyNote.Top = $y + 6
}
$script:fields.distroName.Add_TextChanged({ Update-LegacyOptions })


$voicePage = New-WizardPage 'voicePage' 'Sprache & Stimme' 'Lokale Stimmen bleiben auf deinem PC; ElevenLabs braucht Internet und einen passenden Tarif.'
[void](Add-Text $voicePage.Panel 'Wähle die Sprachverarbeitung und die Stimme. Die Gerätewahl gilt für die Aufnahme deiner Stimmproben.' 0 44)
[void](Add-Choice $voicePage.Panel 'voiceMode' 'Sprachbetrieb' 50 @('Lokal (NVIDIA 6 GB VRAM)', 'ElevenLabs Cloud'))
[void](Add-Choice $voicePage.Panel 'voiceChoice' 'Lokale Ausgabestimme' 88 @('F.R.I.D.A.Y. weiblich', 'J.A.R.V.I.S. klassisch (beiliegende WAV)', 'Eigene Stimme (eigene MP3/WAV)'))
[void](Add-Row $voicePage.Panel 'voiceReference' 'Eigene MP3/WAV' 126)
Set-ReadOnlyPath $script:fields.voiceReference
$browse = New-Object Windows.Forms.Button; $browse.Text = 'Datei wählen'
$browse.Location = New-Object Drawing.Point(196, 154); $browse.Size = New-Object Drawing.Size(120, 26)
$voicePage.Panel.Controls.Add($browse)
$browse.Add_Click({ $picker = New-Object Windows.Forms.OpenFileDialog; $picker.Filter = 'Audio (*.wav;*.mp3)|*.wav;*.mp3'; if ($picker.ShowDialog() -eq 'OK') { $script:fields.voiceReference.Text = $picker.FileName } })
[void](Add-Row $voicePage.Panel 'elevenlabsKey' 'ElevenLabs-API-Schlüssel' 188 '' $true)
$voiceIdBox = Add-Choice $voicePage.Panel 'voiceId' 'ElevenLabs-Stimme' 226 @('(Standardstimme des Kontos)')
$voiceIdBox.DropDownStyle = 'DropDown'
$loadVoices = New-Object Windows.Forms.Button; $loadVoices.Text = 'Stimmen laden'
$loadVoices.Location = New-Object Drawing.Point(196, 254); $loadVoices.Size = New-Object Drawing.Size(130, 26)
$voicePage.Panel.Controls.Add($loadVoices)
$loadVoices.Add_Click({
    $key = $script:fields.elevenlabsKey.Text.Trim()
    if (-not $key) { Show-Error 'Bitte zuerst den ElevenLabs-API-Schlüssel eintragen.'; return }
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $response = Invoke-RestMethod -Uri 'https://api.elevenlabs.io/v1/voices' -Headers @{ 'xi-api-key' = $key } -TimeoutSec 20
        $box = $script:fields.voiceId
        $box.Items.Clear(); [void]$box.Items.Add('(Standardstimme des Kontos)')
        foreach ($voice in @($response.voices)) { [void]$box.Items.Add("$($voice.name) ($($voice.voice_id))") }
        $box.SelectedIndex = 0
    } catch { Show-Error 'Die Stimmen konnten nicht geladen werden. Schlüssel und Internetverbindung prüfen.' }
})
$audioEndpoints = @(Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue)
$inputs = @('Windows-Standardmikrofon') + @($audioEndpoints | Where-Object { $_.InstanceId -match '\{0\.0\.1\.' } |
    Select-Object -ExpandProperty FriendlyName -Unique)
$outputs = @('Windows-Standardlautsprecher') + @($audioEndpoints | Where-Object { $_.InstanceId -match '\{0\.0\.0\.' } |
    Select-Object -ExpandProperty FriendlyName -Unique)
[void](Add-Choice $voicePage.Panel 'inputDevice' 'Mikrofon' 292 $inputs)
[void](Add-Choice $voicePage.Panel 'outputDevice' 'Lautsprecher' 330 $outputs)
$voiceHelp = Add-Text $voicePage.Panel 'Eigene Stimme nutzt deine MP3/WAV (3 bis 30 Sekunden) auf einem eigenen Platz; F.R.I.D.A.Y. und J.A.R.V.I.S. bleiben unverändert. Ohne Datei nutzt Klassisch die mitgelieferte Referenz, weiblich Piper Kerstin.' 368 72
[void](Add-Choice $voicePage.Panel 'conversationBackend' 'Gespräch' 446 @('Lokal (Standard)', 'Qwen Audio Live-Gespräch (Alibaba Token Plan)'))
[void](Add-Choice $voicePage.Panel 'qwenRegion' 'Alibaba-Region' 484 @('International (Singapur)', 'China (Peking)'))
[void](Add-Row $voicePage.Panel 'qwenAudioKey' 'Token-Plan-API-Schlüssel' 522 '' $true)
$testQwenKey = New-Object Windows.Forms.Button; $testQwenKey.Name = 'testQwenKey'; $testQwenKey.Text = 'Schlüssel prüfen'
$testQwenKey.Location = New-Object Drawing.Point(196, 550); $testQwenKey.Size = New-Object Drawing.Size(150, 26)
$voicePage.Panel.Controls.Add($testQwenKey)
$script:qwenKeyResult = Add-Text $voicePage.Panel '' 578 18
[void](Add-Text $voicePage.Panel 'Qwen Audio führt das Gespräch über das Internet; Wake Word, Sprecherprüfung und Stimme bleiben auf deinem PC. Fällt Qwen aus, antwortet der Assistent lokal. Nutzt du beim KI-Zugang Alibaba Cloud Qwen (Token Plan), lass das Feld leer: Dort kannst du denselben Schlüssel übernehmen.' 596 72)
[void](Add-Check $voicePage.Panel 'qwenConsent' 'Ich stimme zu: Für das Live-Gespräch gehen Sprache und Gesprächsinhalte an Alibaba Cloud (Qwen Audio, Token Plan).' 672 $false)
function Update-ConversationFields {
    $qwen = $script:fields.conversationBackend.Enabled -and $script:fields.conversationBackend.SelectedIndex -eq 1
    $script:fields.qwenRegion.Enabled = $qwen; $script:fields.qwenAudioKey.Enabled = $qwen
    $script:fields.qwenConsent.Enabled = $qwen
    $testQwenKey.Enabled = $qwen
}
function Test-QwenKey {
    $key = $script:fields.qwenAudioKey.Text.Trim()
    if (-not $key) { $script:qwenKeyResult.Text = 'Bitte zuerst den Schlüssel eintragen.'; return }
    $region = if ($script:fields.qwenRegion.SelectedIndex -eq 1) { 'cn-beijing' } else { 'ap-southeast-1' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $form.Cursor = [Windows.Forms.Cursors]::WaitCursor
    try {
        $null = Invoke-WebRequest -Uri "https://token-plan.$region.maas.aliyuncs.com/compatible-mode/v1/models" -Headers @{ Authorization = "Bearer $key" } -UseBasicParsing -TimeoutSec 20
        $script:qwenKeyResult.Text = '✓ Schlüssel gültig.'
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $script:qwenKeyResult.Text = if ($code -in @(401, 403)) { '✗ Alibaba lehnt diesen Schlüssel ab (Region prüfen).' }
                                     elseif ($code -gt 0) { "Prüfung nicht möglich (HTTP $code); der Sprachdienst prüft beim Start erneut." }
                                     else { 'Keine Verbindung zu Alibaba; der Sprachdienst prüft beim Start erneut.' }
    } finally { $form.Cursor = [Windows.Forms.Cursors]::Default; $key = $null }
}
$testQwenKey.Add_Click({ Test-QwenKey })
$script:fields.conversationBackend.Add_SelectedIndexChanged({ Update-ConversationFields })
Update-ConversationFields

$script:fields.voiceId.Enabled = $false
$script:fields.elevenlabsKey.Enabled = $false; $loadVoices.Enabled = $false
function Update-VoiceModeFields {
    $local = $script:fields.voiceMode.SelectedIndex -eq 0
    $script:fields.voiceChoice.Enabled = $local; $script:fields.voiceReference.Enabled = $local
    $browse.Enabled = $local; $script:fields.voiceId.Enabled = -not $local
    $script:fields.elevenlabsKey.Enabled = -not $local; $loadVoices.Enabled = -not $local
    $voiceHelp.Text = if ($local) {
        'Eigene Stimme nutzt deine MP3/WAV (3 bis 30 Sekunden) auf einem eigenen Platz; F.R.I.D.A.Y. und J.A.R.V.I.S. bleiben unverändert. Ohne Datei nutzt Klassisch die mitgelieferte Referenz, weiblich Piper Kerstin.'
    } else {
        'ElevenLabs liefert Erkennung und Ausgabe über das Internet. Die Voice ID stammt aus deinem ElevenLabs-Konto; die Standard-Bibliotheksstimme kann einen kostenpflichtigen Tarif erfordern.'
    }
}
$script:fields.voiceMode.Add_SelectedIndexChanged({ Update-VoiceModeFields })

$identityPage = New-WizardPage 'identityPage' 'Persönlichkeit' 'Name, Anrede und Charakter bestimmen, wie F.R.I.D.A.Y. mit dir spricht.'
[void](Add-Row $identityPage.Panel 'assistantName' 'Name des Assistenten' 0 'Friday')
[void](Add-Row $identityPage.Panel 'wakePhrase' 'Aktivierungswort / Satz' 38 'Hey Friday')
[void](Add-Row $identityPage.Panel 'ownerName' 'Dein Vorname' 76 $env:USERNAME)
[void](Add-Choice $identityPage.Panel 'address' 'Anrede' 114 @('Sir und Sie','Vorname und Sie','Vorname und Du'))
[void](Add-Choice $identityPage.Panel 'character' 'Charakter' 152 @('Britischer Butler','Freundlich','Sachlich'))
[void](Add-Choice $identityPage.Panel 'length' 'Antwortlänge' 190 @('Kurz','Ausführlicher'))
[void](Add-Check $identityPage.Panel 'keepIdentity' 'Bestehenden Namen und Wake Word beibehalten' 228 $true)
[void](Add-Check $identityPage.Panel 'repeatEnrollment' 'Stimmaufnahme bei unverändertem Namen wiederholen' 258 $false)
[void](Add-Text $identityPage.Panel 'Für ein persönliches Wake Word werden später Sprachproben aufgenommen. Die Aufnahme führt dich mit sichtbaren Dialogen und Hörsignalen durch die Sätze.' 294 56)
$script:fields.assistantName.Add_Leave({ if ($script:fields.wakePhrase.Text -eq 'Hey Friday') { $script:fields.wakePhrase.Text = 'Hey ' + $script:fields.assistantName.Text.Trim() } })

$modelPage = New-WizardPage 'modelPage' 'KI-Zugang' 'Der Schlüssel wird verdeckt eingegeben und nur an den Installer übergeben.'
# Sichtbare Anbieter; Backend kennt nur 1 OpenAI, 2 Anthropic, 3 OpenAI-kompatibel (Basis-URL), 4 Kimi Coding.
$script:providerPresets = @(
    @{ Label = 'OpenAI'; Backend = '1'; BaseUrl = ''; Models = @('gpt-5', 'gpt-5-mini'); KeyLabel = 'OpenAI-API-Schlüssel'; Probe = 'https://api.openai.com/v1' }
    @{ Label = 'Anthropic (Claude)'; Backend = '2'; BaseUrl = ''; Models = @('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'); KeyLabel = 'Anthropic-API-Schlüssel'; Probe = 'anthropic' }
    # Only models the Token Plan serves: kimi-k2.5 answered 403 AccessDenied.Unpurchased (live check 2026-11-01).
    @{ Label = 'Alibaba Cloud Qwen (Token Plan)'; Backend = '3'; BaseUrl = 'alibaba'; Models = @('qwen3.7-plus', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'deepseek-v4-pro', 'glm-5.2'); KeyLabel = 'Token-Plan-API-Schlüssel'; Probe = 'base' }
    @{ Label = 'Kimi Coding (Moonshot)'; Backend = '4'; BaseUrl = ''; Models = @('k3'); KeyLabel = 'Kimi-API-Schlüssel'; Probe = '' }
    @{ Label = 'DeepSeek'; Backend = '3'; BaseUrl = 'https://api.deepseek.com/v1'; Models = @('deepseek-chat', 'deepseek-reasoner'); KeyLabel = 'DeepSeek-API-Schlüssel'; Probe = 'base' }
    @{ Label = 'OpenRouter'; Backend = '3'; BaseUrl = 'https://openrouter.ai/api/v1'; Models = @('openrouter/auto'); KeyLabel = 'OpenRouter-API-Schlüssel'; Probe = 'base' }
    @{ Label = 'Eigener OpenAI-kompatibler Server'; Backend = '3'; BaseUrl = 'custom'; Models = @(); KeyLabel = 'API-Schlüssel des Servers'; Probe = 'base' }
)
$script:alibabaRegions = @(
    @{ Label = 'International (Singapur)'; Url = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' }
    @{ Label = 'China (Peking)'; Url = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
)
[void](Add-Choice $modelPage.Panel 'providerChoice' 'Anbieter' 0 @($script:providerPresets | ForEach-Object { $_.Label }))
[void](Add-Choice $modelPage.Panel 'alibabaRegion' 'Region' 38 @($script:alibabaRegions | ForEach-Object { $_.Label }))
$modelBox = Add-Choice $modelPage.Panel 'modelName' 'Modell' 76 @('gpt-5')
$modelBox.DropDownStyle = 'DropDown'
[void](Add-Row $modelPage.Panel 'modelBaseUrl' 'Server-Adresse (https://…/v1)' 114)
[void](Add-Row $modelPage.Panel 'providerKey' 'API-Schlüssel' 152 '' $true)
[void](Add-Check $modelPage.Panel 'useExistingKimi' 'Auf diesem PC gefundenen Kimi-Schlüssel verwenden' 190 $true)
[void](Add-Check $modelPage.Panel 'useExistingAlibaba' 'Auf diesem PC gefundenen Alibaba-Schlüssel verwenden' 190 $true)
[void](Add-Check $modelPage.Panel 'qwenSameKey' 'Diesen Schlüssel auch für Qwen Audio (Live-Gespräch) verwenden' 190 $true)
$testKey = New-Object Windows.Forms.Button; $testKey.Name = 'testKey'; $testKey.Text = 'Schlüssel prüfen'
$testKey.Location = New-Object Drawing.Point(196, 222); $testKey.Size = New-Object Drawing.Size(150, 28)
$modelPage.Panel.Controls.Add($testKey)
$script:keyResult = Add-Text $modelPage.Panel '' 256 40
$modelHelp = Add-Text $modelPage.Panel 'Der Schlüssel landet ausschließlich in der WSL-Installation unter ~/.hermes/.env. Modell und Anbieter lassen sich später im Command Center ändern.' 300 60
$kimiEnvironment = [Environment]::GetEnvironmentVariable('KIMI_API_KEY', 'User')
# Alibaba's own tools keep the Token Plan key in one of these user variables; it is reused like the Kimi key.
$alibabaEnvironment = @(@('BAILIAN_API_KEY', 'DASHSCOPE_API_KEY') | ForEach-Object { [Environment]::GetEnvironmentVariable($_, 'User') } | Where-Object { $_ }) | Select-Object -First 1

function Get-ProviderPreset { return $script:providerPresets[[Math]::Max(0, $script:fields.providerChoice.SelectedIndex)] }
function Get-ProviderBaseUrl {
    $preset = Get-ProviderPreset
    if ($preset.BaseUrl -eq 'alibaba') { return $script:alibabaRegions[[Math]::Max(0, $script:fields.alibabaRegion.SelectedIndex)].Url }
    if ($preset.BaseUrl -eq 'custom') { return (Value 'modelBaseUrl') }
    return $preset.BaseUrl
}
function Test-QwenSameKeyOffered {
    # U-02: only ask when Qwen Audio is chosen, the brain uses an Alibaba Token Plan key and no own Qwen key was typed.
    return -not $script:providerLocked -and (Get-ProviderPreset).BaseUrl -eq 'alibaba' -and
        $script:fields.conversationBackend.SelectedIndex -eq 1 -and (Value 'qwenAudioKey') -eq ''
}
function Update-ProviderFields {
    $preset = Get-ProviderPreset
    $locked = [bool]$script:providerLocked
    $box = $script:fields.modelName
    $box.Items.Clear()
    foreach ($model in $preset.Models) { [void]$box.Items.Add($model) }
    if ($box.Items.Count -gt 0) { $box.SelectedIndex = 0 } else { $box.Text = '' }
    $box.Enabled = -not $locked -and $preset.Backend -ne '4'
    Update-ProviderLayout
    $script:captions.providerKey.Text = $preset.KeyLabel
    $testKey.Enabled = -not $locked -and [bool]$preset.Probe
    $script:keyResult.Text = if ($preset.Probe) { '' } else { 'Der Kimi-Zugang wird während der Installation geprüft.' }
    foreach ($name in @('providerChoice', 'alibabaRegion', 'modelBaseUrl', 'useExistingKimi', 'useExistingAlibaba')) { $script:fields[$name].Enabled = -not $locked }
}
function Update-ProviderLayout {
    $preset = Get-ProviderPreset
    $locked = [bool]$script:providerLocked
    $useKimi = $preset.Backend -eq '4' -and [bool]$kimiEnvironment
    $useAlibaba = $preset.BaseUrl -eq 'alibaba' -and [bool]$alibabaEnvironment
    $script:fields.useExistingKimi.Visible = $useKimi
    $script:fields.useExistingAlibaba.Visible = $useAlibaba
    $script:fields.qwenSameKey.Visible = Test-QwenSameKeyOffered
    # Derived from the preset: .Visible of a control reads false while its page is hidden.
    $script:fields.alibabaRegion.Visible = $preset.BaseUrl -eq 'alibaba'
    $script:captions.alibabaRegion.Visible = $preset.BaseUrl -eq 'alibaba'
    $script:fields.modelBaseUrl.Visible = $preset.BaseUrl -eq 'custom'
    $script:captions.modelBaseUrl.Visible = $preset.BaseUrl -eq 'custom'
    # Nur sichtbare Zeilen belegen Platz; .Visible taugt nicht, solange die Seite selbst verborgen ist.
    $shown = [ordered]@{
        alibabaRegion = $preset.BaseUrl -eq 'alibaba'
        modelName = $true
        modelBaseUrl = $preset.BaseUrl -eq 'custom'
        providerKey = $true
        useExistingKimi = $useKimi
        useExistingAlibaba = $useAlibaba
        qwenSameKey = Test-QwenSameKeyOffered
    }
    $y = 38
    foreach ($name in $shown.Keys) {
        if (-not $shown[$name]) { continue }
        $script:fields[$name].Top = $y
        if ($script:captions.ContainsKey($name)) { $script:captions[$name].Top = $y + 3 }
        $y += 38
    }
    $testKey.Top = $y + 4
    $script:keyResult.Top = $y + 40
    $modelHelp.Top = $y + 84
    $script:fields.providerKey.Enabled = -not $locked -and -not ($useKimi -and $script:fields.useExistingKimi.Checked) -and -not ($useAlibaba -and $script:fields.useExistingAlibaba.Checked)
}
function Test-ProviderKey {
    $preset = Get-ProviderPreset
    $key = Get-ProviderKeyText
    if (-not $key) { $script:keyResult.Text = 'Bitte zuerst den Schlüssel eintragen.'; return }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ($preset.Probe -eq 'anthropic') {
        $uri = 'https://api.anthropic.com/v1/models'; $headers = @{ 'x-api-key' = $key; 'anthropic-version' = '2023-06-01' }
    } else {
        $base = if ($preset.Probe -eq 'base') { Get-ProviderBaseUrl } else { $preset.Probe }
        if ($base -notmatch '^https://') { $script:keyResult.Text = 'Bitte eine Server-Adresse mit https:// eintragen.'; return }
        $uri = $base.TrimEnd('/') + '/models'; $headers = @{ Authorization = "Bearer $key" }
    }
    $form.Cursor = [Windows.Forms.Cursors]::WaitCursor
    try {
        $null = Invoke-WebRequest -Uri $uri -Headers $headers -UseBasicParsing -TimeoutSec 20
        $script:keyResult.Text = '✓ Schlüssel gültig.'
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        $script:keyResult.Text = if ($code -in @(401, 403)) { '✗ Der Anbieter lehnt diesen Schlüssel ab.' }
                                 elseif ($code -gt 0) { "Prüfung nicht möglich (HTTP $code); der Zugang wird während der Installation getestet." }
                                 else { 'Keine Verbindung zum Anbieter; der Zugang wird während der Installation getestet.' }
    } finally { $form.Cursor = [Windows.Forms.Cursors]::Default }
}
$script:fields.providerChoice.Add_SelectedIndexChanged({ Update-ProviderFields })
$script:fields.useExistingKimi.Add_CheckedChanged({ Update-ProviderFields })
$script:fields.useExistingAlibaba.Add_CheckedChanged({ Update-ProviderFields })
$testKey.Add_Click({ Test-ProviderKey })
$script:providerLocked = $false
Update-ProviderFields

$keysPage = New-WizardPage 'keysPage' 'Zugänge' 'Zugangsdaten werden verdeckt eingegeben, verschlüsselt übergeben und nicht in Argumenten gespeichert.'
[void](Add-Row $keysPage.Panel 'linuxUser' 'Linux-Benutzername' 0 'friday')
[void](Add-Row $keysPage.Panel 'linuxPassword' 'Linux-Passwort' 38 '' $true)
[void](Add-Row $keysPage.Panel 'linuxPasswordRepeat' 'Linux-Passwort wiederholen' 76 '' $true)
[void](Add-Check $keysPage.Panel 'openBrowser' 'Dashboard nach der Installation öffnen' 124 $true)
[void](Add-Text $keysPage.Panel 'Das Dashboard-Besitzerkonto legst du beim ersten Öffnen an. Diese Angaben gelten nur für diesen Windows-Benutzer.' 160 56)


$summaryPage = New-WizardPage 'summaryPage' 'Zusammenfassung' 'Prüfe die Angaben; geändert wird erst nach deinem Klick auf Installieren.'
$summaryText = New-Object Windows.Forms.TextBox
$summaryText.Multiline = $true; $summaryText.ReadOnly = $true; $summaryText.ScrollBars = 'Vertical'
$summaryText.Dock = [Windows.Forms.DockStyle]::Fill
$summaryText.BackColor = Get-GuiColor '#0F1622'
$summaryText.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
$summaryText.BorderStyle = 'None'
$summaryPage.Panel.Controls.Add($summaryText)

$progressPage = New-WizardPage 'progressPage' 'Installation' 'Der Installer meldet jeden Schritt; Details erscheinen nur auf Klick.'
$status = Add-Text $progressPage.Panel 'Bereit.' 0 44
$progressPage.Panel.Controls.Add($status)
$retry = New-Object Windows.Forms.Button; $retry.Text = 'Erneut versuchen'
$retry.Location = New-Object Drawing.Point(0, 56); $retry.Size = New-Object Drawing.Size(150, 32)
$retry.Enabled = $false; $progressPage.Panel.Controls.Add($retry)
$reboot = New-Object Windows.Forms.Button; $reboot.Text = 'Jetzt neu starten'
$reboot.Location = New-Object Drawing.Point(162, 56); $reboot.Size = New-Object Drawing.Size(160, 32)
$reboot.Enabled = $false; $progressPage.Panel.Controls.Add($reboot)
$reboot.Add_Click({
    if ([Windows.Forms.MessageBox]::Show('Windows jetzt neu starten? Der Assistent setzt die Installation nach der Anmeldung fort.',
        'Neustart', 'YesNo', 'Question') -eq 'Yes') { Restart-Computer -Force }
})
# Das Protokoll sammelt nur noch; sichtbar wird es ausschliesslich im Detaildialog des Verweises.
$script:details = New-Object Windows.Forms.TextBox
$script:details.Multiline = $true; $script:details.ReadOnly = $true; $script:details.ScrollBars = 'Vertical'
$script:details.Font = New-Object Drawing.Font('Consolas', 9)

function Load-RootState {
    $root = Value 'installRoot'
    if ($script:configuredRoot -ieq $root) { return }
    $script:configuredRoot = $root
    $saved = Existing-State $root
    $script:fields.assistantName.Text = if ($saved -and $saved.assistant_name) { $saved.assistant_name } else { 'Friday' }
    $script:fields.wakePhrase.Text = if ($saved -and $saved.wake_phrase) { $saved.wake_phrase } else { 'Hey Friday' }
    $script:fields.ownerName.Text = $env:USERNAME
    $script:fields.linuxUser.Text = if ($saved -and $saved.linux_user) { $saved.linux_user } else { 'friday' }
    $script:fields.address.SelectedIndex = 0; $script:fields.character.SelectedIndex = 0; $script:fields.length.SelectedIndex = 0
    foreach ($field in @('linuxPassword','linuxPasswordRepeat','elevenlabsKey','providerKey','qwenAudioKey')) { $script:fields[$field].Clear() }
    $script:fields.voiceMode.SelectedIndex = if ($saved -and $saved.voice_mode -eq 'elevenlabs') { 1 } else { 0 }
    $script:fields.voiceChoice.SelectedIndex = if ($saved -and $saved.voice_choice -eq 'classic') { 1 } elseif ($saved -and $saved.voice_choice -eq 'custom') { 2 } else { 0 }
    $script:fields.voiceId.Text = if ($saved -and $saved.elevenlabs_voice_id) { $saved.elevenlabs_voice_id } else { '' }
    $script:fields.voiceReference.Text = if ($saved -and $saved.voice_reference) { $saved.voice_reference } else { '' }
    $script:fields.conversationBackend.SelectedIndex = if ($saved -and $saved.conversation_backend -eq 'qwen') { 1 } else { 0 }
    $script:fields.qwenRegion.SelectedIndex = if ($saved -and $saved.qwen_region -eq 'cn-beijing') { 1 } else { 0 }
    $script:fields.inputDevice.SelectedIndex = 0; $script:fields.outputDevice.SelectedIndex = 0
    $pending = if ($saved -and $saved.gui_pending) { $saved.gui_pending } else { $null }
    if ($pending) {
        if (-not (@($saved.done) -contains 'persona')) {
            if ($pending.ownerName) { $script:fields.ownerName.Text = [string]$pending.ownerName }
            foreach ($fieldName in @('address','character','length')) {
                $number = 0
                if ([int]::TryParse([string]$pending.$fieldName, [ref]$number) -and
                    $number -ge 1 -and $number -le $script:fields[$fieldName].Items.Count) {
                    $script:fields[$fieldName].SelectedIndex = $number - 1
                }
            }
        }
        if (-not $saved.voice_mode) {
            if ($pending.voiceMode -in @('1','2')) { $script:fields.voiceMode.SelectedIndex = [int]$pending.voiceMode - 1 }
            if ($pending.voiceChoice -in @('1','2','3')) { $script:fields.voiceChoice.SelectedIndex = [int]$pending.voiceChoice - 1 }
            $script:fields.voiceReference.Text = [string]$pending.voiceReference
            $script:fields.voiceId.Text = [string]$pending.voiceId
            if ($pending.conversationBackend -in @('1','2')) { $script:fields.conversationBackend.SelectedIndex = [int]$pending.conversationBackend - 1 }
            if ($pending.qwenRegion -in @('1','2')) { $script:fields.qwenRegion.SelectedIndex = [int]$pending.qwenRegion - 1 }
        }
        foreach ($fieldName in @('migrateLegacy','disableLegacy','reuseDistro','disableForeignTasks',
                                 'overwriteDashboardConfig','keepIdentity','repeatEnrollment','openBrowser','qwenConsent')) {
            if ($pending.$fieldName -in @('true','false')) { $script:fields[$fieldName].Checked = $pending.$fieldName -eq 'true' }
        }
    }
    $audioState = $null
    if ($saved -and @($saved.done) -contains 'voicepython') {
        $voicePath = Join-Path $root 'config\voice.json'
        if (Test-Path -LiteralPath $voicePath -PathType Leaf) {
            try { $audioState = Get-Content -LiteralPath $voicePath -Raw -Encoding UTF8 | ConvertFrom-Json }
            catch { Show-Error "Audiokonfiguration kann nicht gelesen werden: $voicePath" }
        }
    }
    foreach ($pair in @(@('inputDevice','input_device'), @('outputDevice','output_device'))) {
        $fieldName, $actualKey = $pair
        $label = if ($audioState -and $audioState.$actualKey) { [string]$audioState.$actualKey }
                 elseif ($pending -and $pending.$fieldName) { [string]$pending.$fieldName }
                 else { '' }
        if ($label) {
            $choice = $script:fields[$fieldName]
            $index = $choice.Items.IndexOf($label)
            if ($index -lt 0) { $index = $choice.Items.Add($label) }
            $choice.SelectedIndex = $index
        }
    }
    if ($saved) {
        if ($saved.distro_name) { $script:fields.distroName.Text = $saved.distro_name }
        if ($saved.distro_location) { $script:fields.distroLocation.Text = $saved.distro_location }
        $personaPath = Join-Path $root 'config\persona.json'
        if (Test-Path -LiteralPath $personaPath) {
            try {
                $persona = Get-Content -LiteralPath $personaPath -Raw | ConvertFrom-Json
                if ($persona.owner_name) { $script:fields.ownerName.Text = $persona.owner_name }
                $addressIndex = [array]::IndexOf(@('sir','sie','du'), [string]$persona.address)
                $characterIndex = [array]::IndexOf(@('butler','freundlich','sachlich'), [string]$persona.character)
                $lengthIndex = [array]::IndexOf(@('kurz','normal'), [string]$persona.length)
                if ($addressIndex -ge 0) { $script:fields.address.SelectedIndex = $addressIndex }
                if ($characterIndex -ge 0) { $script:fields.character.SelectedIndex = $characterIndex }
                if ($lengthIndex -ge 0) { $script:fields.length.SelectedIndex = $lengthIndex }
            } catch { }
        }
    }
    foreach ($choice in @('assistantName','wakePhrase')) { $script:fields[$choice].Enabled = -not ($saved -and $saved.assistant_name) }
    # Die ganze Sprachseite gehoert zum Sprachdienst-Schritt: waehlbar, bis er eingerichtet ist - auch wenn ein
    # abgebrochener Lauf schon einen Sprachbetrieb gespeichert hat. Danach aendert man sie im Dashboard.
    $voiceLocked = [bool]($saved -and @($saved.done) -contains 'voicepython')
    $script:fields.voiceMode.Enabled = -not $voiceLocked
    if ($voiceLocked) {
        foreach ($choice in @('voiceChoice','voiceReference','voiceId','elevenlabsKey')) { $script:fields[$choice].Enabled = $false }
        $loadVoices.Enabled = $false
    } else { Update-VoiceModeFields }
    $script:fields.conversationBackend.Enabled = -not $voiceLocked
    Update-ConversationFields
    $script:qwenKeyResult.Text = if ($voiceLocked) { 'Schon eingerichtet – ändern unter Dashboard → Einstellungen → Sprache.' } else { '' }
    foreach ($choice in @('inputDevice','outputDevice')) { $script:fields[$choice].Enabled = -not ($saved -and @($saved.done) -contains 'voicepython') }
    $browse.Enabled = $script:fields.voiceReference.Enabled
    foreach ($choice in @('ownerName','address','character','length')) { $script:fields[$choice].Enabled = -not ($saved -and @($saved.done) -contains 'persona') }
    $script:fields.linuxUser.Enabled = -not ($saved -and $saved.linux_user)
    $script:fields.keepIdentity.Enabled = $script:fields.assistantName.Enabled
    $script:fields.repeatEnrollment.Enabled = $script:fields.assistantName.Enabled
    # Ein eingerichteter KI-Zugang wird im Installer nicht erneut abgefragt (Aenderung im Command Center).
    $script:providerLocked = [bool]($saved -and (@($saved.done) -contains 'hermes' -or $saved.model_provider))
    Update-ProviderFields
    $script:keyResult.Text = if ($script:providerLocked) { 'Der KI-Zugang ist bereits eingerichtet und bleibt unverändert.' } else { $script:keyResult.Text }
}
if ($ResumeRoot) { $script:fields.installRoot.Text = $ResumeRoot }
Update-PathFields
Load-RootState
$refresh.PerformClick()
if ($ChangeVoice) {
    # Nur der Sprachbetrieb aendert sich; alles andere bleibt, wie die vorhandene Installation es gespeichert hat.
    $changeState = if ($ResumeRoot) { Existing-State $ResumeRoot } else { $null }
    if (-not ($changeState -and $changeState.voice_mode)) {
        [void][Windows.Forms.MessageBox]::Show('Sprachbetrieb wechseln geht nur bei einer vorhandenen Installation. Bitte den Installationsordner im Dashboard prüfen.',
            'F.R.I.D.A.Y.', 'OK', 'Error')
        exit 5
    }
    foreach ($choice in @('voiceMode','voiceChoice','voiceReference','voiceId','conversationBackend')) { $script:fields[$choice].Enabled = $true }
    $browse.Enabled = $true
    Update-ConversationFields
    $script:qwenKeyResult.Text = ''
    if ($VoiceTarget -eq 'elevenlabs') { $script:fields.voiceMode.SelectedIndex = 1 } elseif ($VoiceTarget -eq 'local') { $script:fields.voiceMode.SelectedIndex = 0 }
    $keep = @('voicePage', 'summaryPage', 'progressPage')
    foreach ($page in @($script:pages | Where-Object { $keep -notcontains $_.Key })) {
        $page.Panel.Visible = $false
        $script:pages.Remove($page)
    }
    $form.Text = 'F.R.I.D.A.Y. – Sprachbetrieb wechseln'
}

function Update-Summary {
    $mode = if ($script:fields.voiceMode.SelectedIndex -eq 0) { 'Lokal (NVIDIA-GPU)' } else { 'ElevenLabs Cloud (mögliche Anbieter-Kosten)' }
    $voiceName = if ($script:fields.voiceMode.SelectedIndex -eq 1) {
        if (Get-VoiceIdValue) { 'ElevenLabs Voice ID ' + (Get-VoiceIdValue) } else { 'ElevenLabs Standardstimme' }
    } elseif ($script:fields.voiceChoice.SelectedIndex -eq 1) { 'J.A.R.V.I.S. klassisch' } elseif ($script:fields.voiceChoice.SelectedIndex -eq 2) { 'Eigene Stimme' } else { 'F.R.I.D.A.Y. weiblich' }
    $state = Existing-State (Value 'installRoot')
    $previous = if ($ChangeVoice) { 'Sprachbetrieb wechseln: nur die Sprachteile werden neu eingerichtet. Name, Konten, KI-Zugang und Dashboard bleiben unverändert.' + $(if ($script:fields.voiceMode.SelectedIndex -eq 0) { "`nLokal braucht eine NVIDIA-Grafikkarte mit mindestens 6 GB Speicher; fehlende Sprachmodelle werden geladen (mehrere GB)." } else { '' }) } elseif ($state) { "Vorhandene Installation: erledigte Schritte werden übernommen ($(@($state.done).Count) Schritte)." } else { 'Neuinstallation: WSL, Hermes, Sprache und Dashboard werden eingerichtet.' }
    $summaryText.Text = (@"
$previous

Installationsordner: $(Value 'installRoot')
WSL: $(Value 'distroName') · $(Value 'distroLocation')
Assistent: $(Value 'assistantName') · Wake Word: $(Value 'wakePhrase')
Person: $(Value 'ownerName')
KI-Anbieter: $(if ($script:providerLocked) { 'bereits eingerichtet' } else { (Get-ProviderPreset).Label + ' · ' + $(if ((Get-ProviderPreset).Backend -eq '4') { 'k3' } else { Value 'modelName' }) })
Sprachbetrieb: $mode
Gespräch: $(if ($script:fields.conversationBackend.SelectedIndex -eq 1) { 'Qwen Audio Live-Gespräch (Alibaba Token Plan, Internet), Zustimmung erteilt' + $(if (Use-ProviderKeyForQwen) { ' · Schlüssel wie Denkmodell' } else { '' }) } else { 'Lokal' })
Stimme: $voiceName
Referenz: $(if ($script:fields.voiceMode.SelectedIndex -eq 1) { 'ElevenLabs (keine lokale Referenz)' } elseif (Value 'voiceReference') { Value 'voiceReference' } else { 'automatische Auswahl' })
Mikrofon: $(Value 'inputDevice')
Lautsprecher: $(Value 'outputDevice')

Es werden nur benötigte Komponenten installiert: WSL/Ubuntu, Hermes mit KI-Anbieter,
Sprachdienst und Command Center. Der Installer zeigt jeden tatsächlichen Schritt
und laufende Meldungen. Downloads benötigen Internet und etwa 45–90 Minuten.
Nach einer neuen WSL-Einrichtung kann ein Windows-Neustart erforderlich sein.

Die Zugangsdaten werden in dieser Übersicht nicht angezeigt.
"@).Replace("`r`n", "`n").Replace("`n", "`r`n")
}

$script:pageIndex = 0
function Show-GuiPage([int]$index) {
    # Eine Wahrheit fuer die Anzeige: Seite, Schritttext und Fusszeile werden immer gemeinsam gesetzt.
    if ($index -lt 0 -or $index -ge $script:pages.Count) { return }
    $script:pageIndex = $index
    foreach ($candidate in $script:pages) { $candidate.Panel.Visible = $false }
    $page = $script:pages[$index]
    $page.Panel.Visible = $true
    $page.Panel.BringToFront()
    if ($page.Key -eq 'modelPage') { Update-ProviderLayout }
    $running = [bool]($script:process -and -not $script:process.HasExited)
    $isProgress = $page.Key -eq 'progressPage'
    $isSummary = $page.Key -eq 'summaryPage'
    Set-GuiShellPage $shell ("Schritt $($index + 1) von $($script:pages.Count)") $page.Title $page.Body $isProgress $shell.ProgressBar.Value
    if ($isProgress) { $shell.BodyLabel.Text = $status.Text }
    $shell.BackButton.Visible = (-not $isProgress) -and ($index -gt 0)
    $shell.BackButton.Enabled = $shell.BackButton.Visible -and (-not $running)
    $shell.PrimaryButton.Visible = (-not $isProgress)
    $shell.PrimaryButton.Enabled = -not $running
    $shell.PrimaryButton.Text = if ($isSummary -and $ChangeVoice) { 'Wechseln' } elseif ($isSummary) { 'Installieren' } else { 'Weiter' }
    $shell.CancelButton.Text = if ($running) { 'Abbrechen' } elseif ($isProgress) { 'Schließen' } else { 'Abbrechen' }
    if ($isSummary) { Update-Summary }
}

# --- Stimmaufnahme: die Aufnahme fordert jede Aktion als Datei an, die Oberflaeche antwortet.
# Ein eigenes Fenster oder eine unsichtbare Enter-Abfrage gibt es damit nicht mehr.
$script:interactionId = ''
$script:interactionRoot = ''
$script:interactionProof = ''
# Beantwortete Anfragen bleiben gemerkt: die Aufnahme loescht ihre Datei erst beim naechsten Schritt.
$script:interactionAnswered = @{}
$script:interactionPage = New-Object Windows.Forms.Panel
$script:interactionPage.Name = 'interactionPage'
$script:interactionPage.Dock = [Windows.Forms.DockStyle]::Fill
$script:interactionPage.BackColor = [Drawing.Color]::Transparent
$script:interactionPage.Visible = $false
$shell.PageHost.Controls.Add($script:interactionPage)
function New-InteractionLabel([int]$y, [int]$height, [int]$size, $style, [string]$color) {
    $label = New-Object Windows.Forms.Label
    $label.AutoSize = $false
    $label.Location = New-Object Drawing.Point(0, [int]($y * $script:dpiScale))
    $label.Size = New-Object Drawing.Size([int](540 * $script:dpiScale), [int]($height * $script:dpiScale))
    $label.Font = New-GuiFont $size $style $script:dpiScale
    $label.ForeColor = Get-GuiColor $color
    $label.BackColor = [Drawing.Color]::Transparent
    $script:interactionPage.Controls.Add($label)
    return $label
}
$script:interactionTitle = New-InteractionLabel 0 44 20 ([Drawing.FontStyle]::Bold) $script:GuiLayout.PrimaryText
$script:interactionPrompt = New-InteractionLabel 52 150 13 ([Drawing.FontStyle]::Regular) $script:GuiLayout.PrimaryText
$script:interactionDetail = New-InteractionLabel 210 26 11 ([Drawing.FontStyle]::Regular) $script:GuiLayout.SecondaryText
$script:interactionProgress = New-InteractionLabel 242 26 12 ([Drawing.FontStyle]::Bold) $script:GuiLayout.Accent
$script:interactionHint = New-InteractionLabel 332 48 10 ([Drawing.FontStyle]::Regular) $script:GuiLayout.SecondaryText
$script:interactionHint.Text = 'Sprich nach dem Signalton. Die Aufnahme bleibt lokal; "Anhören" spielt die letzte Aufnahme erneut ab.'
function New-InteractionButton([string]$name, [string]$text, [int]$x, [int]$width, [scriptblock]$onClick) {
    $button = New-Object Windows.Forms.Button
    $button.Name = $name
    $button.Text = $text
    $button.Location = New-Object Drawing.Point([int]($x * $script:dpiScale), [int](278 * $script:dpiScale))
    $button.Size = New-Object Drawing.Size([int]($width * $script:dpiScale), [int](42 * $script:dpiScale))
    $button.BackColor = Get-GuiColor $script:GuiLayout.Surface
    $button.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $button.FlatStyle = 'Flat'
    $button.Add_Click($onClick)
    $script:interactionPage.Controls.Add($button)
    return $button
}
$script:interactionOk = New-InteractionButton 'interactionOk' 'Jetzt sprechen' 0 190 { Complete-GuiInteraction 'ok' }
$script:interactionReplay = New-InteractionButton 'interactionReplay' 'Anhören' 202 150 { Complete-GuiInteraction 'replay' }
$script:interactionSkip = New-InteractionButton 'interactionSkip' 'Überspringen' 364 150 { Complete-GuiInteraction 'skip' }
function Show-GuiInteraction([object]$Request) {
    # Anfrage der Aufnahme anzeigen: Aufforderung, Fortschritt und nur die angebotenen Aktionen.
    if (-not $Request) { return }
    if ($script:interactionAnswered.ContainsKey([string]$Request.Id)) { return }
    $script:interactionId = [string]$Request.Id
    $script:interactionTitle.Text = if ($Request.Title) { [string]$Request.Title } else { 'Stimmaufnahme' }
    $script:interactionPrompt.Text = [string]$Request.Prompt
    $script:interactionDetail.Text = [string]$Request.Detail
    if ($Request.Total -gt 0) { $script:interactionProgress.Text = "Aufnahme $($Request.Index) von $($Request.Total)" }
    elseif ($Request.Index -gt 0) { $script:interactionProgress.Text = "Aufnahme $($Request.Index)" }
    else { $script:interactionProgress.Text = '' }
    $script:interactionReplay.Enabled = ($Request.Actions -contains 'replay')
    $script:interactionSkip.Enabled = ($Request.Actions -contains 'skip')
    $script:interactionPage.Visible = $true
    $script:interactionPage.BringToFront()
    $script:interactionOk.Focus() | Out-Null
    Set-GuiShellPage $shell 'Stimmaufnahme' $script:interactionTitle.Text $script:interactionPrompt.Text $false $shell.ProgressBar.Value
    $shell.BodyLabel.Text = $script:interactionDetail.Text
    $shell.BackButton.Visible = $false
    $shell.PrimaryButton.Visible = $false
    $shell.CancelButton.Text = 'Abbrechen'
    $shell.CancelButton.Enabled = $true
}
function Complete-GuiInteraction([string]$Action) {
    # Antwort genau auf die offene Anfrage; ohne offene Anfrage passiert nichts.
    if (-not $script:interactionId) { return }
    $root = $script:interactionRoot
    if (-not $root) { try { $root = [string](Value 'installRoot') } catch { $root = '' } }
    $sent = Send-GuiInteractionResponse $root $script:interactionId $Action
    $script:interactionAnswered[$script:interactionId] = $true
    $requestPath = Join-Path (Join-Path $root 'run') 'gui-interaction.json'
    if (Test-Path -LiteralPath $requestPath) { Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue }
    if ($sent) { Append-Log "[AUFNAHME] '$Action' an die Stimmaufnahme gesendet." }
    else { Append-Log "[AUFNAHME] Die Antwort '$Action' konnte nicht zugestellt werden." }
    $script:interactionId = ''
    $script:interactionPage.Visible = $false
    if ($script:process -and -not $script:process.HasExited) { Show-GuiPage (Get-PageIndex 'progressPage') }
}
$script:interactionTimer = New-Object Windows.Forms.Timer
$script:interactionTimer.Interval = 200
$script:interactionTimer.Add_Tick({
    $root = $script:interactionRoot
    # Ohne laufenden Lauf und ohne ausdruecklichen Testordner wird nichts gelesen: eine liegen
    # gebliebene Datei darf den Assistenten nicht vor dem Start blockieren.
    if (-not $root) {
        if (-not ($script:process -and -not $script:process.HasExited)) { return }
        try { $root = [string](Value 'installRoot') } catch { $root = '' }
        if (-not $root) { return }
    }
    $request = Read-GuiInteractionRequest $root
    if (-not $request) { return }
    if ($request.Id -eq $script:interactionId) { return }
    if ($script:interactionAnswered.ContainsKey($request.Id)) { return }
    Show-GuiInteraction $request
})
$script:interactionTimer.Start()

$shell.BackButton.Add_Click({ Show-GuiPage ($script:pageIndex - 1) })
$shell.PrimaryButton.Add_Click({
    if ($script:pageIndex -eq $script:pages.Count - 2) { Start-Backend; return }
    Show-GuiPage ($script:pageIndex + 1)
})
$shell.CancelButton.Add_Click({
    if ($script:interactionId) { Complete-GuiInteraction 'cancel'; return }
    if ($script:process -and -not $script:process.HasExited) {
        if (-not (Request-GuiCancel 'Abbrechen im Assistenten')) { Show-Error 'Der Abbruch konnte nicht übermittelt werden.' }
        return
    }
    $form.Close()
})
$shell.DetailsLink.Add_LinkClicked({
    # Protokolle nur auf ausdruecklichen Klick, nie dauerhaft sichtbar.
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'Protokoll dieses Laufs'
    $dialog.ClientSize = New-Object Drawing.Size(760, 480)
    $dialog.StartPosition = 'CenterParent'
    $dialog.BackColor = Get-GuiColor '#0B1220'
    $log = New-Object Windows.Forms.TextBox
    $log.Multiline = $true; $log.ReadOnly = $true; $log.ScrollBars = 'Vertical'
    $log.Dock = [Windows.Forms.DockStyle]::Fill
    $log.Font = New-Object Drawing.Font('Consolas', 9)
    $log.BackColor = Get-GuiColor '#0B1220'; $log.ForeColor = Get-GuiColor $script:GuiLayout.PrimaryText
    $log.BorderStyle = 'None'
    $log.Text = $script:details.Text
    $dialog.Controls.Add($log)
    try { [void]$dialog.ShowDialog($form) } finally { $dialog.Dispose() }
})

$script:process = $null
$script:simulationFile = $null
$script:stdoutTask = $null
$script:stderrTask = $null
$script:guiExitCode = 0
$script:sawRunDone = $false
$script:redactions = @()
$script:configPath = $null
$script:runId = ''
$script:lastOutputAt = $null
$script:stalledReported = $false
# Jede Installation bekommt eine eigene Kennung. Ohne sie laesst sich ein Protokoll nach einer
# Wiederholung nicht eindeutig einem Lauf zuordnen.
function New-RunId { return ([guid]::NewGuid().ToString('N').Substring(0, 12)) }
# Ein Lauf ohne Ausgabe ist nicht dasselbe wie ein haengender Lauf: der Assistent meldet die Stille,
# beendet aber nichts, weil ein Abbruch mitten in der Einrichtung mehr zerstoert als rettet.
function Test-RunStalled([object]$LastOutput, [object]$Now, [int]$Minutes = 15) {
    if (-not $LastOutput -or -not $Now) { return $false }
    return ($Now - $LastOutput).TotalMinutes -ge $Minutes
}
$timer = New-Object Windows.Forms.Timer; $timer.Interval = 150
function Format-GuiEvent([object]$Event) {
    # Nur echte Felder, keine aus Text geratenen Prozentzahlen oder Erfolge.
    switch ([string]$Event.type) {
        'step' {
            if ("$($Event.state)" -eq 'start') { return "Schritt $($Event.step) gestartet" }
            return "Schritt $($Event.step) abgeschlossen"
        }
        'download' {
            if ("$($Event.state)" -eq 'start') { return "Download $($Event.name) laeuft" }
            if ("$($Event.state)" -eq 'failed') { return "Download $($Event.name) fehlgeschlagen" }
            return "Download $($Event.name) fertig"
        }
        'pip' { return "Pakete werden installiert ($($Event.label))" }
        'warmup' {
            if ("$($Event.state)" -eq 'start') { return "Modell $($Event.service) wird geladen" }
            if ($Event.PSObject.Properties['seconds']) { return "Modell $($Event.service) bereit nach $($Event.seconds) s" }
            return "Modell $($Event.service) bereit"
        }
        'run' {
            if ("$($Event.state)" -eq 'start') { return "Lauf $($Event.run) gestartet ($($Event.mode))" }
            return "Lauf beendet: $($Event.state) (Exitcode $($Event.exitCode))"
        }
        default { return "Ereignis: $($Event.type)" }
    }
}
function Receive-BackendLine([string]$Line) {
    $parsed = ConvertFrom-GuiEventLine $Line
    if ($parsed.Kind -ne 'event') { Append-Log $Line; return }
    $text = Format-GuiEvent $parsed.Event
    if ($parsed.Event.type -eq 'run' -and $parsed.Event.state -ne 'start') { $script:sawRunDone = $true }
    if ("$($parsed.Event.type)" -eq 'step' -and "$($parsed.Event.state)" -eq 'start') {
        $status.Text = $text
        # Der eine Fortschrittsbalken folgt der Schrittfolge des Installers; unbekannte Schritte
        # lassen ihn stehen, statt einen erfundenen Fortschritt zu zeigen.
        $percent = Get-GuiStepPercent ([string]$parsed.Event.step)
        if ($percent -ge 0) { $shell.ProgressBar.Value = [math]::Min(100, $percent) }
        $stepNumber = [array]::IndexOf($script:GuiStepOrder, [string]$parsed.Event.step) + 1
        if ($stepNumber -gt 0) { $shell.StepLabel.Text = "Schritt $stepNumber von $($script:GuiStepOrder.Count)" }
        if ($script:pageIndex -eq (Get-PageIndex 'progressPage')) { $shell.BodyLabel.Text = $text }
    }
    Append-Log $text
}
function Append-Log([string]$line) {
    $script:lastOutputAt = Get-Date
    foreach ($secret in $script:redactions) {
        if ($secret) { $line = $line.Replace($secret, '[verdeckt]') }
    }
    $script:details.AppendText($line + "`r`n")
    if ($line -match '^\s*(Schritt \d+|\[GUI\]|\[FEHLER\]|\[OK\])') {
        if ($script:pageIndex -eq (Get-PageIndex 'progressPage')) { $shell.BodyLabel.Text = $line.Trim() }
    }
}
function Request-GuiCancel([string]$Reason) {
    # Ohne laufenden Lauf und ohne Laufkennung gibt es niemanden, den die Bitte erreichen koennte.
    if (-not $script:process -or $script:process.HasExited -or -not $script:runId) { return $false }
    $targetRoot = ''
    try { $targetRoot = [string](Value 'installRoot') } catch { }
    if (-not $targetRoot) { return $false }
    $flagPath = Request-InstallerCancel -Root $targetRoot -RunId $script:runId -Reason $Reason
    if (-not $flagPath) { return $false }
    Append-Log "[ABBRUCH] Bitte an den Lauf gesendet; der Installer haelt an der naechsten sicheren Grenze an."
    return $true
}
function Stop-BackendGracefully([string]$Reason) {
    # Erst bitten, dann warten, erst zuletzt beenden. Ein hartes Beenden mitten in Kopier-, pip- oder
    # WSL-Schritten hinterlaesst halbe Artefakte und reisst Dienstprozesse mit.
    if (-not $script:process -or $script:process.HasExited) { return }
    if (Request-GuiCancel $Reason) {
        $deadline = (Get-Date).AddSeconds($script:cancelGraceSeconds)
        while (-not $script:process.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
        if ($script:process.HasExited) {
            $script:process.WaitForExit(5000) | Out-Null
            Append-Log "[ABBRUCH] Der Installer hat an einer sicheren Grenze angehalten."
            return
        }
        Append-Log "[ABBRUCH] Der Installer reagiert nicht auf die Bitte; der Prozess wird beendet."
    }
    try { if (-not $script:process.HasExited) { & taskkill.exe /PID $script:process.Id /T /F | Out-Null } } catch { }
    $script:process.WaitForExit(5000) | Out-Null
}
function Start-Backend {
    if ($script:process) { return }
    try { $state = Test-Wizard } catch { Show-Error $_.Exception.Message; return }
    $answers = @{
        assistantName = Value 'assistantName'; wakePhrase = Value 'wakePhrase'; ownerName = Value 'ownerName'
        about = ''; linuxUser = Value 'linuxUser'; voiceMode = [string]($script:fields.voiceMode.SelectedIndex + 1)
        voiceChoice = [string]($script:fields.voiceChoice.SelectedIndex + 1); voiceReference = Value 'voiceReference'
        voiceId = Get-VoiceIdValue
        conversationBackend = [string]($script:fields.conversationBackend.SelectedIndex + 1)
        qwenRegion = $(if (Use-ProviderKeyForQwen) { [string]($script:fields.alibabaRegion.SelectedIndex + 1) } else { [string]($script:fields.qwenRegion.SelectedIndex + 1) })
        qwenConsent = BoolText (Checked 'qwenConsent')
        inputDevice = $(if ($script:fields.inputDevice.SelectedIndex -gt 0) { Value 'inputDevice' } else { '' })
        outputDevice = $(if ($script:fields.outputDevice.SelectedIndex -gt 0) { Value 'outputDevice' } else { '' })
        address = [string]($script:fields.address.SelectedIndex + 1)
        character = [string]($script:fields.character.SelectedIndex + 1); length = [string]($script:fields.length.SelectedIndex + 1)
        migrateLegacy = BoolText (Checked 'migrateLegacy'); disableLegacy = BoolText (Checked 'disableLegacy')
        reuseDistro = BoolText (Checked 'reuseDistro'); disableForeignTasks = BoolText (Checked 'disableForeignTasks')
        overwriteDashboardConfig = BoolText (Checked 'overwriteDashboardConfig')
        keepIdentity = BoolText (Checked 'keepIdentity'); repeatEnrollment = BoolText (Checked 'repeatEnrollment')
        retryEnrollment = 'false'; openBrowser = BoolText (Checked 'openBrowser')
        useExistingKimi = BoolText (Checked 'useExistingKimi'); restartNow = 'false'
        providerChoice = [string](Get-ProviderPreset).Backend
        modelBaseUrl = $(if ((Get-ProviderPreset).Backend -eq '3') { Get-ProviderBaseUrl } else { '' })
        modelName = $(if ((Get-ProviderPreset).Backend -eq '4') { 'k3' } else { Value 'modelName' })
    }
    $backendChoice = [string](Get-ProviderPreset).Backend
    $providerSecret = if (Use-AlibabaEnvironment) { Secure-Text ([string]$alibabaEnvironment) } else { Secure-Field 'providerKey' }
    $secrets = @{
        linuxPassword = Secure-Field 'linuxPassword'; linuxPasswordRepeat = Secure-Field 'linuxPasswordRepeat'
        elevenlabsKey = Secure-Field 'elevenlabsKey'
        qwenAudioKey = $(if ($script:fields.conversationBackend.SelectedIndex -ne 1) { '' } elseif (Use-ProviderKeyForQwen) { $providerSecret } else { Secure-Field 'qwenAudioKey' })
        openaiKey = $(if ($backendChoice -eq '1') { $providerSecret } else { '' })
        anthropicKey = $(if ($backendChoice -eq '2') { $providerSecret } else { '' })
        customKey = $(if ($backendChoice -eq '3') { $providerSecret } else { '' })
        kimiKey = $(if ($backendChoice -eq '4') { $providerSecret } else { '' })
    }
    $script:redactions = @(@('linuxPassword','linuxPasswordRepeat','elevenlabsKey','providerKey','qwenAudioKey') |
        ForEach-Object { $script:fields[$_].Text } | Where-Object { $_ })
    if (Use-AlibabaEnvironment) { $script:redactions += [string]$alibabaEnvironment }
    $config = @{ protocol = 1; answers = $answers; secrets = $secrets }
    if ($Simulation) { $config.simulation = $Simulation }
    $privateDir = Join-Path $env:LOCALAPPDATA 'FridayInstaller'
    try {
        [void][IO.Directory]::CreateDirectory($privateDir)
        Protect-PrivatePath $privateDir $true
        $script:configPath = Join-Path $privateDir (([guid]::NewGuid().ToString('N')) + '.json')
        [IO.File]::WriteAllText($script:configPath, ($config | ConvertTo-Json -Depth 5 -Compress), (New-Object Text.UTF8Encoding $false))
        Protect-PrivatePath $script:configPath $false
        $backend = Join-Path $PSScriptRoot 'install-friday.ps1'
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = 'powershell.exe'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
        $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
        $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $backend + '" -GuiConfigPath "' + $script:configPath + '" -InstallRoot "' + (Value 'installRoot') + '"'
        if ((Value 'installRoot') -ine 'C:\Friday') { $psi.Arguments += ' -DistroName "' + (Value 'distroName') + '" -DistroLocation "' + (Value 'distroLocation') + '"' }
        if ($ChangeVoice) { $psi.Arguments += ' -ChangeVoice' }
        if ($Simulation) { $psi.Arguments += ' -GuiSimulation'; $psi.EnvironmentVariables['FRIDAY_GUI_TEST'] = '1' }
        $script:process = New-Object Diagnostics.Process
        $script:process.StartInfo = $psi
        $script:runId = New-RunId
        $psi.EnvironmentVariables['FRIDAY_INSTALL_RUN'] = $script:runId
        if (-not $script:process.Start()) { throw 'Installationsprozess konnte nicht gestartet werden.' }
        Append-Log "Lauf $($script:runId) gestartet."
        $script:lastOutputAt = Get-Date
        $script:stalledReported = $false
        $script:stdoutTask = $script:process.StandardOutput.ReadLineAsync()
        $script:stderrTask = $script:process.StandardError.ReadLineAsync()
        $script:fields.linuxPassword.Clear(); $script:fields.linuxPasswordRepeat.Clear()
        $script:fields.elevenlabsKey.Clear(); $script:fields.providerKey.Clear(); $script:fields.qwenAudioKey.Clear()
        $script:details.Clear(); $status.Text = 'Installation läuft …'
        Show-GuiPage (Get-PageIndex 'progressPage')
        $shell.ProgressBar.Value = 0
        $timer.Start(); $retry.Enabled = $false
        $shell.CancelButton.Text = 'Abbrechen'
    } catch {
        if ($script:process) {
            Stop-BackendGracefully 'Startfehler'
            $script:process.Dispose(); $script:process = $null
        }
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
        Show-Error "Installation konnte nicht starten: $($_.Exception.Message)"
    }
}
$retry.Add_Click({ Show-GuiPage (Get-PageIndex 'summaryPage'); Update-Summary })
$timer.Add_Tick({
    foreach ($stream in @('stdout','stderr')) {
        $taskName = $stream + 'Task'
        $reader = if ($stream -eq 'stdout') { $script:process.StandardOutput } else { $script:process.StandardError }
        $task = Get-Variable -Name $taskName -Scope Script -ValueOnly
        $read = 0
        while ($task -and $task.IsCompleted -and $read -lt 100) {
            if ($null -eq $task.Result) { $task = $null; break }
            Receive-BackendLine $task.Result
            $task = $reader.ReadLineAsync(); $read++
        }
        Set-Variable -Name $taskName -Scope Script -Value $task
    }
    if ($script:process -and -not $script:process.HasExited -and -not $script:stalledReported -and
        (Test-RunStalled $script:lastOutputAt (Get-Date))) {
        $script:stalledReported = $true
        Append-Log "[HINWEIS] Seit 15 Minuten keine Ausgabe aus der Installation. Der Lauf arbeitet weiter; bitte Protokoll und Status prüfen, bevor du abbrichst."
    }
    if ($script:process -and $script:process.HasExited) {
        $timer.Stop()
        foreach ($stream in @('stdout','stderr')) {
            $taskName = $stream + 'Task'
            $reader = if ($stream -eq 'stdout') { $script:process.StandardOutput } else { $script:process.StandardError }
            $task = Get-Variable -Name $taskName -Scope Script -ValueOnly
            while ($task) {
                if (-not $task.Wait(100)) {
                    Append-Log '[Protokollausgabe eines Unterprozesses ist noch offen.]'
                    break
                }
                if ($null -eq $task.Result) { break }
                Receive-BackendLine $task.Result
                $task = $reader.ReadLineAsync()
            }
        }
        $exitCode = $script:process.ExitCode
        $script:guiExitCode = $exitCode
        # Der Exitcode bleibt massgeblich; ein fehlendes Abschlussereignis wird nur benannt, nicht als Erfolg verkauft.
        if (-not $script:sawRunDone) { Append-Log '[HINWEIS] Der Installer hat kein Abschlussereignis gesendet; massgeblich ist der Exitcode.' }
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
        if ($exitCode -eq 0) { $status.Text = 'Installation abgeschlossen. Dashboard und Dienste wurden geprüft.' }
        elseif ($exitCode -eq 10) { $status.Text = 'Windows-Neustart erforderlich. Nach der Anmeldung öffnet sich dieser Assistent erneut.'; $reboot.Enabled = $true }
        elseif ($exitCode -eq 20) { $status.Text = 'Es läuft bereits eine Installation. Bitte dort abschließen oder beenden; dieser Start hat nichts geändert.'; $retry.Enabled = $true }
        else { $status.Text = "Installation angehalten (Fehlercode $exitCode). Details prüfen, dann erneut versuchen."; $retry.Enabled = $true }
        $shell.BodyLabel.Text = $status.Text
        $shell.ProgressBar.Value = if ($exitCode -eq 0) { 100 } else { $shell.ProgressBar.Value }
        $shell.CancelButton.Text = 'Schließen'
        $script:process.Dispose(); $script:process = $null
        $script:redactions = @()
        if ($Simulation) {
            $capture = Join-Path $env:TEMP "friday-gui-$Simulation.png"
            $bitmap = New-Object Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
            try { $shell.Panel.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height))); $bitmap.Save($capture) }
            finally { $bitmap.Dispose() }
            $script:guiTestMessage = "GUI_TEST mode=$Simulation exit=$exitCode status=$($status.Text) focus=$($script:focusSummary) $($script:interactionProof) $($script:qwenProof) $($script:resumeProof) screenshot=$capture"
            $form.Close()
        }
    }
})
$form.Add_FormClosing({
    if ($script:process -and -not $script:process.HasExited) {
        $choice = [Windows.Forms.MessageBox]::Show('Die Installation läuft. Beim Schließen wird der aktuelle Installationsprozess beendet. Erledigte Schritte bleiben gespeichert. Schließen?',
            'Installation läuft', 'YesNo', 'Warning')
        if ($choice -ne 'Yes') { $_.Cancel = $true; return }
        Stop-BackendGracefully 'Fenster geschlossen'
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
    }
})
$form.Add_Shown({
    $form.Activate()
    Show-GuiPage 0
if ($Simulation) {
        $script:watchdog = New-Object Windows.Forms.Timer
        $script:watchdog.Interval = 600000
        $script:watchdog.Add_Tick({
            $script:watchdog.Stop()
            $script:guiTestMessage = "GUI_TEST mode=$Simulation error=zeitlimit"
            $script:guiExitCode = 1
            if ($form.Visible) { $form.Close() }
        })
        $script:watchdog.Start()
        $originalRoot = $script:fields.installRoot.Text
        $testRoot = Join-Path $env:TEMP ('friday-gui-resume-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path (Join-Path $testRoot 'config') -Force | Out-Null
        try {
            $stateFile = Join-Path $testRoot 'config\install-state.json'
            @{ done=@(); gui_pending=@{ ownerName='Testnutzer'; about='synthetisch'; address='3'; character='2'; length='2';
                inputDevice='Testmikrofon'; outputDevice='Testlautsprecher'; voiceMode='2'; voiceChoice='1';
                voiceReference=''; voiceId=''; openBrowser='false' } } |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding UTF8
            $script:fields.installRoot.Text = $testRoot; Load-RootState
            if ((Value 'ownerName') -cne 'Testnutzer' -or
                $script:fields.address.SelectedIndex -ne 2 -or $script:fields.character.SelectedIndex -ne 1 -or
                $script:fields.length.SelectedIndex -ne 1 -or $script:fields.voiceMode.SelectedIndex -ne 1 -or
                (Value 'inputDevice') -cne 'Testmikrofon' -or (Value 'outputDevice') -cne 'Testlautsprecher' -or
                $script:fields.openBrowser.Checked) { throw 'GUI resume did not restore pending nonsecret decisions.' }
            @{ done=@(); gui_pending=@{ voiceMode='1'; voiceChoice='3'; voiceReference='C:\Stimmen\eigen.wav' } } |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding UTF8
            $script:configuredRoot = ''; Load-RootState
            if ($script:fields.voiceChoice.SelectedIndex -ne 2 -or (Value 'voiceReference') -cne 'C:\Stimmen\eigen.wav') {
                throw 'GUI resume did not restore the own voice choice.'
            }
            @{ done=@('persona','voicepython'); gui_pending=@{}; voice_mode='local' } |
                ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $stateFile -Encoding UTF8
            @{ input_device='Real microphone, MME'; output_device='Real speaker, MME' } |
                ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'config\voice.json') -Encoding UTF8
            $script:configuredRoot = ''
            Load-RootState
            if ((Value 'inputDevice') -cne 'Real microphone, MME' -or
                (Value 'outputDevice') -cne 'Real speaker, MME') { throw 'GUI resume did not display configured audio devices.' }
        } finally {
            $script:fields.installRoot.Text = $originalRoot; $script:configuredRoot = ''; Load-RootState
            $verified = [IO.Path]::GetFullPath($testRoot)
            if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        foreach ($required in @('providerChoice', 'alibabaRegion', 'modelBaseUrl', 'modelName', 'providerKey', 'useExistingKimi', 'useExistingAlibaba', 'elevenlabsKey', 'conversationBackend', 'qwenRegion', 'qwenAudioKey')) {
            if (-not $script:fields.ContainsKey($required)) { throw "GUI provider field missing: $required" }
        }
        if ($script:pages.Count -ne 8 -or $script:pages[4].Title -ne 'KI-Zugang') { throw 'GUI provider page missing.' }
        # Jede Seite wird gezeichnet und abgelegt; das belegt, dass sie ohne Terminal darstellbar ist.
        foreach ($index in 0..7) {
            Show-GuiPage $index
            [System.Windows.Forms.Application]::DoEvents()
            if ($index -eq 2) { $script:fields.voiceMode.SelectedIndex = 0 }
            $bitmap = New-Object Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
            try {
                $shell.Panel.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
                $bitmap.Save((Join-Path $env:TEMP "friday-gui-page-$index.png"))
            } finally { $bitmap.Dispose() }
        }
        Show-GuiPage 2; $script:fields.voiceMode.SelectedIndex = 1
        $bitmap = New-Object Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
        try {
            $shell.Panel.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
            $bitmap.Save((Join-Path $env:TEMP 'friday-gui-cloud.png'))
        } finally { $bitmap.Dispose() }
        $script:fields.voiceMode.SelectedIndex = 0
        # Qwen Audio with an Alibaba brain: the voice page's Qwen block and the model page's same-key question (U-02).
        $script:fields.conversationBackend.SelectedIndex = 1
        Show-GuiPage 2
        $voicePage.Panel.AutoScrollPosition = New-Object Drawing.Point(0, 420)
        [System.Windows.Forms.Application]::DoEvents()
        $bitmap = New-Object Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
        try {
            $shell.Panel.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
            $bitmap.Save((Join-Path $env:TEMP 'friday-gui-qwen-voice.png'))
        } finally { $bitmap.Dispose() }
        $voicePage.Panel.AutoScrollPosition = New-Object Drawing.Point(0, 0)
        $originalProvider = $script:fields.providerChoice.SelectedIndex
        $script:fields.providerChoice.SelectedIndex = 2
        Show-GuiPage 4
        [System.Windows.Forms.Application]::DoEvents()
        $sameKeyShown = $script:fields.qwenSameKey.Visible
        $bitmap = New-Object Drawing.Bitmap($shell.Panel.Width, $shell.Panel.Height)
        try {
            $shell.Panel.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
            $bitmap.Save((Join-Path $env:TEMP 'friday-gui-qwen-model.png'))
        } finally { $bitmap.Dispose() }
        $script:fields.conversationBackend.SelectedIndex = 0
        Update-ProviderLayout
        $sameKeyHiddenForLocal = -not $script:fields.qwenSameKey.Visible
        $script:fields.providerChoice.SelectedIndex = $originalProvider
        $script:qwenProof = "qwensame=shown:$sameKeyShown hiddenlocal:$sameKeyHiddenForLocal"
        # Tastatur: jede Seite muss ihre Bedienelemente ohne Maus erreichen koennen. Geprueft wird die
        # echte Tabulatorreihenfolge von WinForms, nicht eine behauptete Liste.
        $focusSummary = @()
        # Ein vorhandener Zustand sperrt Felder; fuer den Tastaturdurchlauf gilt ein neutraler Ordner,
        # damit jede Seite wirklich bedienbar geprueft wird.
        $walkRoot = Join-Path $env:TEMP ('friday-gui-focus-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $walkRoot -Force | Out-Null
        $walkOriginalRoot = $script:fields.installRoot.Text
        try {
        $script:fields.installRoot.Text = $walkRoot
        $script:configuredRoot = ''
        Load-RootState
        foreach ($index in 0..7) {
            Show-GuiPage $index
            [System.Windows.Forms.Application]::DoEvents()
            $page = $script:pages[$index]
            $tour = Test-FocusReachable $page $form
            $expected = @($page.Panel.Controls | Where-Object {
                $_.TabStop -and $_.Enabled -and $_.Visible -and
                ($_ -is [Windows.Forms.TextBox] -or $_ -is [Windows.Forms.ComboBox] -or
                 $_ -is [Windows.Forms.Button] -or $_ -is [Windows.Forms.CheckBox])
            } | ForEach-Object { $_.Name })
            $missing = @($expected | Where-Object { $tour -notcontains $_ })
            if ($expected.Count -gt 0 -and $missing.Count -gt 0) { throw "GUI Tastatur: Seite $index erreicht $($missing -join ', ') nicht." }
            # Ohne erreichbaren Abbruch ist die Tastaturbedienung unvollstaendig.
            if ($tour -notcontains 'cancelButton') { throw "GUI Tastatur: Seite $index erreicht den Abbruch nicht (erreicht: $($tour -join '.'))." }
            if ($index -lt 7 -and $tour -notcontains 'primaryButton') { throw "GUI Tastatur: Seite $index erreicht die Hauptaktion nicht (erreicht: $($tour -join '.'), primary sichtbar=$($shell.PrimaryButton.Visible) aktiv=$($shell.PrimaryButton.Enabled) tabstop=$($shell.PrimaryButton.TabStop))." }
            $focusSummary += "$index=$($tour.Count)"
        }
        } catch {
            $script:guiTestMessage = "GUI_TEST mode=$Simulation error=tastatur:$($_.Exception.Message)"
            $script:guiExitCode = 1
            if ($form.Visible) { $form.Close() }
            return
        } finally {
            $script:fields.installRoot.Text = $walkOriginalRoot
            $script:configuredRoot = ''
            Load-RootState
            $verifiedWalk = [IO.Path]::GetFullPath($walkRoot)
            if ($verifiedWalk.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $verifiedWalk -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        $script:focusSummary = ($focusSummary -join ',')
        # Fortgesetzte Installation: ein abgebrochener Lauf hat den Sprachbetrieb gespeichert, der Sprachdienst fehlt noch.
        # Dann muss die ganze Sprachseite bedienbar sein; erst nach dem Sprachdienst-Schritt ist sie gesperrt.
        $resumeOriginalRoot = $script:fields.installRoot.Text
        $resumeRoots = @()
        try {
            $resumeOpen = $false; $resumeLocked = $false
            foreach ($case in @('open', 'locked')) {
                $caseRoot = Join-Path $env:TEMP ('friday-gui-resume-' + [guid]::NewGuid().ToString('N'))
                $resumeRoots += $caseRoot
                New-Item -ItemType Directory -Path (Join-Path $caseRoot 'config') -Force | Out-Null
                $done = @('preflight', 'files', 'persona')
                if ($case -eq 'locked') { $done += @('hermes', 'qwen', 'voicepython', 'voiceservice') }
                @{ assistant_name = 'Kira'; wake_phrase = 'Hey Kira'; voice_mode = 'local'; voice_choice = 'friday-female'
                   conversation_backend = 'qwen'; qwen_consent = $true; done = $done } | ConvertTo-Json |
                    Set-Content -LiteralPath (Join-Path $caseRoot 'config\install-state.json') -Encoding UTF8
                $script:fields.installRoot.Text = $caseRoot
                $script:configuredRoot = ''
                Load-RootState
                Show-GuiPage 2
                [System.Windows.Forms.Application]::DoEvents()
                if ($case -eq 'open') {
                    $localOpen = $script:fields.voiceMode.Enabled -and $script:fields.voiceChoice.Enabled -and
                                 $script:fields.voiceReference.Enabled -and $browse.Enabled -and $script:fields.conversationBackend.Enabled
                    $script:fields.voiceMode.SelectedIndex = 1
                    $cloudOpen = $script:fields.voiceId.Enabled -and $script:fields.elevenlabsKey.Enabled -and $loadVoices.Enabled
                    $script:fields.voiceMode.SelectedIndex = 0
                    $script:fields.conversationBackend.SelectedIndex = 1
                    $qwenOpen = $script:fields.qwenRegion.Enabled -and $script:fields.qwenAudioKey.Enabled -and
                                $script:fields.qwenConsent.Enabled -and $testQwenKey.Enabled
                    $script:fields.conversationBackend.SelectedIndex = 0
                    $resumeOpen = [bool]($localOpen -and $cloudOpen -and $qwenOpen)
                    if (-not $resumeOpen) { throw "Sprachseite gesperrt (lokal:$localOpen cloud:$cloudOpen qwen:$qwenOpen)." }
                } else {
                    $resumeLocked = -not ($script:fields.voiceMode.Enabled -or $script:fields.voiceChoice.Enabled -or $loadVoices.Enabled -or
                                          $script:fields.conversationBackend.Enabled -or $script:fields.qwenAudioKey.Enabled -or $script:fields.qwenConsent.Enabled)
                    if (-not $resumeLocked) { throw 'Sprachseite bleibt nach eingerichtetem Sprachdienst bedienbar.' }
                }
            }
            $script:resumeProof = "voiceresume=open:$resumeOpen locked:$resumeLocked"
        } catch {
            $script:guiTestMessage = "GUI_TEST mode=$Simulation error=fortsetzen:$($_.Exception.Message)"
            $script:guiExitCode = 1
            if ($form.Visible) { $form.Close() }
            return
        } finally {
            $script:fields.installRoot.Text = $resumeOriginalRoot
            $script:configuredRoot = ''
            Load-RootState
            foreach ($caseRoot in $resumeRoots) {
                $verified = [IO.Path]::GetFullPath($caseRoot)
                if ($verified.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('') + ''), [StringComparison]::OrdinalIgnoreCase)) {
                    Remove-Item -LiteralPath $verified -Recurse -Force -ErrorAction SilentlyContinue
                }
            }
        }
        # Geheimnisse erst jetzt: Load-RootState im Tastaturdurchlauf leert Passwort- und Schluesselfelder.
        $script:fields.useExistingKimi.Checked = $false
        $script:fields.useExistingAlibaba.Checked = $false
        $script:fields.providerKey.Text = 'synthetic-test-key'
        $script:fields.linuxPassword.Text = 'synthetic-test-password'
        $script:fields.linuxPasswordRepeat.Text = 'synthetic-test-password'
        # Aufnahme-Interaktion: eine Anfrage im Lauf-Ordner muss die Aufnahmenseite zeigen und die Antwort schreiben.
        $interactionRoot = Join-Path $env:TEMP ('friday-gui-interaction-' + [guid]::NewGuid().ToString('N'))
        try {
            New-Item -ItemType Directory -Path (Join-Path $interactionRoot 'run') -Force | Out-Null
            $request = @{ v = 1; id = 'selftest0001'; kind = 'record'; title = 'Stimmaufnahme'
                          prompt = 'Aufnahme 1 von 44: normal, ca. 50 cm' + [char]10 + [char]10 + 'Sage nach dem Signal: Hey Friday'
                          detail = 'normal, ca. 50 cm vom Laptop'; block = 'wake_hey_friday'; index = 1; total = 44
                          actions = @('ok', 'replay', 'skip', 'cancel'); created = (Get-Date).ToString('s') }
            [IO.File]::WriteAllText((Join-Path $interactionRoot 'run\gui-interaction.json'),
                ($request | ConvertTo-Json -Depth 4 -Compress), (New-Object Text.UTF8Encoding $false))
            $script:interactionRoot = $interactionRoot
            for ($wait = 0; $wait -lt 60 -and -not $script:interactionPage.Visible; $wait++) {
                [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50
            }
            if (-not $script:interactionPage.Visible) { throw 'Die Aufnahmenseite erscheint nicht.' }
            if ($script:interactionPrompt.Text -notmatch 'Hey Friday') { throw 'Die Aufnahmeaufforderung wird nicht angezeigt.' }
            if ($script:interactionProgress.Text -ne 'Aufnahme 1 von 44') { throw "Fortschritt falsch: '$($script:interactionProgress.Text)'" }
            if ($shell.PrimaryButton.Visible -or $shell.BackButton.Visible) { throw 'Die Fusszeile zeigt waehrend der Aufnahme falsche Aktionen.' }
            if ($shell.CancelButton.Text -ne 'Abbrechen') { throw 'Der Abbruch ist waehrend der Aufnahme nicht erreichbar.' }
            $tour = Test-FocusReachable @{ Panel = $script:interactionPage } $form
            foreach ($needed in @('interactionOk', 'interactionReplay', 'interactionSkip')) {
                if ($tour -notcontains $needed) { throw "GUI Tastatur: Aufnahmenseite erreicht $needed nicht (erreicht: $($tour -join '.'))." }
            }
            if ($tour -notcontains 'cancelButton') { throw 'GUI Tastatur: Aufnahmenseite erreicht den Abbruch nicht.' }
            [void]$script:interactionOk.PerformClick()
            [Windows.Forms.Application]::DoEvents()
            $answerFile = Join-Path $interactionRoot 'run\gui-interaction.json.response'
            if (-not (Test-Path -LiteralPath $answerFile)) { throw 'Die Aufnahmeantwort wurde nicht geschrieben.' }
            $answer = Get-Content -LiteralPath $answerFile -Raw | ConvertFrom-Json
            if ($answer.id -ne 'selftest0001' -or $answer.action -ne 'ok') { throw "Falsche Antwort '$($answer.action)' auf '$($answer.id)'." }
            if ($script:interactionPage.Visible) { throw 'Die Aufnahmenseite bleibt nach der Antwort sichtbar.' }
            $script:interactionProof = 'interaction=visible:True ok:True'
        } catch {
            $script:guiTestMessage = "GUI_TEST mode=$Simulation error=aufnahme:$($_.Exception.Message)"
            $script:guiExitCode = 1
            if ($form.Visible) { $form.Close() }
            return
        } finally {
            $script:interactionRoot = ''
            $verifiedInteraction = [IO.Path]::GetFullPath($interactionRoot)
            if ($verifiedInteraction.StartsWith(([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
                Remove-Item -LiteralPath $verifiedInteraction -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        Show-GuiPage 6
        Start-Backend
    }
})
[void]$form.ShowDialog()
if ($Simulation) { Write-Output $script:guiTestMessage; exit $script:guiExitCode }
