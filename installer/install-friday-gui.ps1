#Requires -Version 5.1
param([string]$ResumeRoot = '', [ValidateSet('','success','failure','restart')][string]$Simulation = '')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    # Escalate before collecting credentials. Only the fixed script path and optional root are passed to UAC.
    $arguments = '-NoProfile -STA -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    if ($ResumeRoot) { $arguments += ' -ResumeRoot "' + $ResumeRoot + '"' }
    if ($Simulation) { $arguments += ' -Simulation ' + $Simulation }
    Start-Process -FilePath powershell.exe -ArgumentList $arguments -Verb RunAs
    exit
}

function Add-Row($panel, [string]$name, [string]$label, [int]$y, [string]$value = '', [bool]$password = $false) {
    $caption = New-Object Windows.Forms.Label
    $caption.Text = $label; $caption.Location = New-Object Drawing.Point(24, $y)
    $caption.Size = New-Object Drawing.Size(310, 24)
    $panel.Controls.Add($caption)
    $input = New-Object Windows.Forms.TextBox
    $input.Name = $name; $input.Text = $value
    $input.Location = New-Object Drawing.Point(340, $y)
    $input.Size = New-Object Drawing.Size(405, 27)
    $input.UseSystemPasswordChar = $password
    $panel.Controls.Add($input)
    $script:fields[$name] = $input
    return $input
}
function Add-Check($panel, [string]$name, [string]$label, [int]$y, [bool]$checked = $false) {
    $box = New-Object Windows.Forms.CheckBox
    $box.Name = $name; $box.Text = $label; $box.Checked = $checked
    $box.Location = New-Object Drawing.Point(24, $y)
    $box.Size = New-Object Drawing.Size(730, 29)
    $panel.Controls.Add($box); $script:fields[$name] = $box
    return $box
}
function Add-Choice($panel, [string]$name, [string]$label, [int]$y, [string[]]$items, [int]$selected = 0) {
    $caption = New-Object Windows.Forms.Label
    $caption.Text = $label; $caption.Location = New-Object Drawing.Point(24, $y)
    $caption.Size = New-Object Drawing.Size(310, 24); $panel.Controls.Add($caption)
    $box = New-Object Windows.Forms.ComboBox
    $box.Name = $name; $box.DropDownStyle = 'DropDownList'; $box.Location = New-Object Drawing.Point(340, $y)
    $box.Size = New-Object Drawing.Size(405, 28)
    [void]$box.Items.AddRange($items)
    $box.SelectedIndex = $selected
    $panel.Controls.Add($box); $script:fields[$name] = $box
    return $box
}
function Add-Text($panel, [string]$text, [int]$y, [int]$height = 42) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $text; $label.Location = New-Object Drawing.Point(24, $y)
    $label.Size = New-Object Drawing.Size(730, $height)
    $panel.Controls.Add($label)
    return $label
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
function Secure-Field([string]$name) {
    $value = $script:fields[$name].Text
    if (-not $value) { return '' }
    $secure = ConvertTo-SecureString -String $value -AsPlainText -Force
    try { return (ConvertFrom-SecureString -SecureString $secure) }
    finally { $secure.Dispose() }
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
    $hasKimiEnvironment = [bool][Environment]::GetEnvironmentVariable('KIMI_API_KEY', 'User')
    if ($done -notcontains 'hermes' -and ((-not (Checked 'useExistingKimi')) -or -not $hasKimiEnvironment) -and (Value 'kimiKey') -eq '') { throw 'Kimi-API-Schlüssel fehlt.' }
    if ($script:fields['voiceMode'].SelectedIndex -eq 1 -and (Value 'elevenlabsKey') -eq '') {
        $existingCloudKey = Test-Path -LiteralPath (Join-Path $root 'config\elevenlabs_api.key.dpapi') -PathType Leaf
        if (-not $existingCloudKey) { throw 'ElevenLabs-API-Schlüssel fehlt.' }
    }
    if ((Value 'voiceReference') -and -not ($state -and $state.voice_mode) -and
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
    if ($script:fields.voiceMode.SelectedIndex -eq 1 -and (Value 'voiceId') -and (Value 'voiceId') -notmatch '^[A-Za-z0-9]{10,64}$') {
        throw 'ElevenLabs Voice ID: 10 bis 64 Buchstaben oder Zahlen.'
    }
    return $state
}

$script:fields = @{}
$form = New-Object Windows.Forms.Form
$form.Text = 'F.R.I.D.A.Y. – geführte Installation'; $form.StartPosition = 'CenterScreen'
$form.Size = New-Object Drawing.Size(820, 690); $form.MinimumSize = New-Object Drawing.Size(820, 690)
$form.Font = New-Object Drawing.Font('Segoe UI', 10)
$tabs = New-Object Windows.Forms.TabControl
$tabs.Location = New-Object Drawing.Point(10, 10); $tabs.Size = New-Object Drawing.Size(785, 580)
$form.Controls.Add($tabs)
foreach ($title in @('Systemprüfung','Installationsort','Sprache & Stimme','Persönlichkeit','KI-Zugang','Zugänge','Zusammenfassung','Installation')) {
    $page = New-Object Windows.Forms.TabPage
    $page.Text = $title; $page.AutoScroll = $true
    [void]$tabs.TabPages.Add($page)
}
$tabs.SelectedIndex = 0
$back = New-Object Windows.Forms.Button; $back.Text = 'Zurück'; $back.Location = New-Object Drawing.Point(490, 605)
$back.Size = New-Object Drawing.Size(90, 32); $form.Controls.Add($back)
$next = New-Object Windows.Forms.Button; $next.Text = 'Weiter'; $next.Location = New-Object Drawing.Point(590, 605)
$next.Size = New-Object Drawing.Size(90, 32); $form.Controls.Add($next)
$start = New-Object Windows.Forms.Button; $start.Text = 'Installieren'; $start.Location = New-Object Drawing.Point(690, 605)
$start.Size = New-Object Drawing.Size(90, 32); $form.Controls.Add($start)

$system = $tabs.TabPages[0]
[void](Add-Text $system 'Systemprüfung vor der Installation' 25 35)
$systemReport = Add-Text $system 'Prüfung läuft …' 75 180
[void](Add-Text $system 'Benötigt: Windows mit WSL2, 40 GB freier Speicher, Internet und Administratorrechte. Lokale Sprache benötigt eine NVIDIA-GPU mit mindestens 6 GB VRAM. ElevenLabs verwendet eine Cloud-API; je nach Konto können Kosten entstehen.' 280 120)
$refresh = New-Object Windows.Forms.Button; $refresh.Text = 'Erneut prüfen'; $refresh.Location = New-Object Drawing.Point(24, 430)
$system.Controls.Add($refresh)
$refresh.Add_Click({
    try {
        $drive = (Value 'installRoot').Substring(0,1)
        $volume = Get-Volume -DriveLetter $drive -ErrorAction Stop
        $free = [math]::Round($volume.SizeRemaining / 1GB)
        $ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
        $gpu = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { (& nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1) } else { 'Keine NVIDIA-GPU erkannt' }
        $systemReport.Text = "Windows Build $([Environment]::OSVersion.Version.Build)`r`nRAM: $ram GB`r`n${drive}: $free GB frei`r`nGrafik: $gpu`r`nWSL: $([bool](Get-Command wsl.exe -ErrorAction SilentlyContinue))`r`nInternet wird beim Start vom Installer geprüft."
    } catch { $systemReport.Text = "Systemprüfung nicht vollständig: $($_.Exception.Message)" }
})

$paths = $tabs.TabPages[1]
[void](Add-Text $paths 'Installationsort und WSL-Distribution. Bei einer vorhandenen Installation werden die gespeicherten Werte übernommen.' 25 55)
[void](Add-Row $paths 'installRoot' 'Installationsordner' 95 'C:\Friday')
$browseRoot = New-Object Windows.Forms.Button; $browseRoot.Text = 'Ordner wählen'
$browseRoot.Location = New-Object Drawing.Point(340, 125); $browseRoot.Size = New-Object Drawing.Size(130, 30)
$paths.Controls.Add($browseRoot)
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
[void](Add-Row $paths 'distroName' 'WSL-Distributionsname' 165 'Ubuntu')
[void](Add-Row $paths 'distroLocation' 'WSL-Ablageort' 205 '(Windows-Standardort)')
[void](Add-Check $paths 'migrateLegacy' 'Vorhandenes C:\Jarvis nach C:\Friday übernehmen' 252 $true)
[void](Add-Check $paths 'disableLegacy' 'Bei frischer Installation alte JARVIS-Dienste deaktivieren' 288 $true)
[void](Add-Check $paths 'reuseDistro' 'Vorhandene passende WSL-Distribution verwenden' 324 $true)
[void](Add-Check $paths 'disableForeignTasks' 'Bei Migration kollidierende alte Aufgaben deaktivieren' 360 $true)
[void](Add-Check $paths 'overwriteDashboardConfig' 'Abweichende Dashboard-Vorgabe nach Sicherung überschreiben' 396 $false)
[void](Add-Text $paths 'Bestehende Daten, Stimmprofile und Konfigurationen werden bei Fortsetzung berücksichtigt. Eine frühere JARVIS-Installation bleibt als Sicherung erhalten.' 450 65)
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
}
$script:fields.installRoot.Add_Leave({ Update-PathFields; Load-RootState; $refresh.PerformClick() })

$voice = $tabs.TabPages[2]
[void](Add-Text $voice 'Wähle die Sprachverarbeitung und die Stimme. Lokale Stimmen bleiben auf deinem PC; ElevenLabs benötigt Internet und einen geeigneten API-Tarif.' 25 65)
[void](Add-Choice $voice 'voiceMode' 'Sprachbetrieb' 102 @('Lokal (NVIDIA 6 GB VRAM)', 'ElevenLabs Cloud'))
[void](Add-Choice $voice 'voiceChoice' 'Lokale Ausgabestimme' 147 @('F.R.I.D.A.Y. weiblich', 'J.A.R.V.I.S. klassisch (beiliegende WAV)'))
[void](Add-Row $voice 'voiceReference' 'Eigene MP3/WAV (optional)' 193)
$browse = New-Object Windows.Forms.Button; $browse.Text = 'Datei wählen'; $browse.Location = New-Object Drawing.Point(340, 235)
$browse.Size = New-Object Drawing.Size(120, 31)
$voice.Controls.Add($browse)
$browse.Add_Click({ $picker = New-Object Windows.Forms.OpenFileDialog; $picker.Filter = 'Audio (*.wav;*.mp3)|*.wav;*.mp3'; if ($picker.ShowDialog() -eq 'OK') { $script:fields.voiceReference.Text = $picker.FileName } })
[void](Add-Row $voice 'voiceId' 'ElevenLabs Voice ID (optional)' 287)
$audioEndpoints = @(Get-PnpDevice -Class AudioEndpoint -Status OK -ErrorAction SilentlyContinue)
$inputs = @('Windows-Standardmikrofon') + @($audioEndpoints | Where-Object { $_.InstanceId -match '\{0\.0\.1\.' } |
    Select-Object -ExpandProperty FriendlyName -Unique)
$outputs = @('Windows-Standardlautsprecher') + @($audioEndpoints | Where-Object { $_.InstanceId -match '\{0\.0\.0\.' } |
    Select-Object -ExpandProperty FriendlyName -Unique)
[void](Add-Choice $voice 'inputDevice' 'Mikrofon' 334 $inputs)
[void](Add-Choice $voice 'outputDevice' 'Lautsprecher' 378 $outputs)
$voiceHelp = Add-Text $voice 'Klassisch wählt ohne eigene Datei automatisch die mitgelieferte Referenz. Für die weibliche lokale Qwen-Stimme kann eine eigene Referenz gewählt werden; ohne Referenz wird Piper Kerstin verwendet.' 430 82
$script:fields.voiceId.Enabled = $false
$script:fields.voiceMode.Add_SelectedIndexChanged({
    $local = $script:fields.voiceMode.SelectedIndex -eq 0
    $script:fields.voiceChoice.Enabled = $local; $script:fields.voiceReference.Enabled = $local
    $browse.Enabled = $local; $script:fields.voiceId.Enabled = -not $local
    $voiceHelp.Text = if ($local) {
        'Klassisch wählt ohne eigene Datei automatisch die mitgelieferte Referenz. Für die weibliche lokale Qwen-Stimme kann eine eigene Referenz gewählt werden; ohne Referenz wird Piper Kerstin verwendet.'
    } else {
        'ElevenLabs liefert Erkennung und Ausgabe über das Internet. Die Voice ID stammt aus deinem ElevenLabs-Konto; die Standard-Bibliotheksstimme kann einen kostenpflichtigen Tarif erfordern.'
    }
})

$identity = $tabs.TabPages[3]
[void](Add-Row $identity 'assistantName' 'Name des Assistenten' 35 'Friday')
[void](Add-Row $identity 'wakePhrase' 'Aktivierungswort / Satz' 78 'Hey Friday')
[void](Add-Row $identity 'ownerName' 'Dein Vorname' 121 $env:USERNAME)
[void](Add-Choice $identity 'address' 'Anrede' 165 @('Sir und Sie','Vorname und Sie','Vorname und Du'))
[void](Add-Choice $identity 'character' 'Charakter' 209 @('Britischer Butler','Freundlich','Sachlich'))
[void](Add-Choice $identity 'length' 'Antwortlänge' 253 @('Kurz','Ausführlicher'))
[void](Add-Row $identity 'about' 'Über dich (optional)' 297)
[void](Add-Check $identity 'keepIdentity' 'Bestehenden Namen und Wake Word beibehalten' 347 $true)
[void](Add-Check $identity 'repeatEnrollment' 'Stimmaufnahme bei unverändertem Namen wiederholen' 384 $false)
[void](Add-Text $identity 'Für ein persönliches Wake Word werden später Sprachproben aufgenommen. Die Aufnahme führt dich mit sichtbaren Dialogen und Hörsignalen durch die Sätze.' 434 70)
$script:fields.assistantName.Add_Leave({ if ($script:fields.wakePhrase.Text -eq 'Hey Friday') { $script:fields.wakePhrase.Text = 'Hey ' + $script:fields.assistantName.Text.Trim() } })

$model = $tabs.TabPages[4]
[void](Add-Choice $model 'providerChoice' 'Anbieter' 35 @(
    'OpenAI (empfohlen)', 'Anthropic (Claude)', 'Erweitert: Kimi, DeepSeek, OpenRouter oder eigener Server'))
[void](Add-Row $model 'modelBaseUrl' 'Basis-URL (nur Erweitert, z. B. https://api.deepseek.com/v1)' 79)
[void](Add-Row $model 'modelName' 'Modellname (leer = Standard des Anbieters)' 123)
[void](Add-Row $model 'openaiKey' 'OpenAI-API-Key' 167 '' $true)
[void](Add-Row $model 'anthropicKey' 'Anthropic-API-Key' 211 '' $true)
[void](Add-Row $model 'customKey' 'API-Key des erweiterten Anbieters' 255 '' $true)
$modelHelp = Add-Text $model 'Der Schlüssel wird verdeckt eingegeben und nur an den Installer übergeben. Er landet ausschließlich in der WSL-Installation unter ~/.hermes/.env. Ein hier gefundener Kimi-Code-Schlüssel (sk-kimi-…) richtet automatisch den Kimi-Coding-Zugang ein.' 305 110
function Update-ProviderFields {
    $choice = $script:fields.providerChoice.SelectedIndex
    $script:fields.openaiKey.Enabled = $choice -eq 0
    $script:fields.anthropicKey.Enabled = $choice -eq 1
    foreach ($name in @('customKey', 'modelBaseUrl', 'modelName')) { $script:fields[$name].Enabled = $choice -eq 2 }
}
$script:fields.providerChoice.Add_SelectedIndexChanged({ Update-ProviderFields })
Update-ProviderFields

$keys = $tabs.TabPages[5]
[void](Add-Row $keys 'linuxUser' 'Linux-Benutzername' 35 'friday')
[void](Add-Row $keys 'linuxPassword' 'Linux-Passwort' 78 '' $true)
[void](Add-Row $keys 'linuxPasswordRepeat' 'Linux-Passwort wiederholen' 121 '' $true)
[void](Add-Check $keys 'useExistingKimi' 'Vorhandenen Kimi-Schlüssel verwenden, falls verfügbar' 165 $true)
[void](Add-Row $keys 'kimiKey' 'Kimi-API-Schlüssel' 209 '' $true)
[void](Add-Row $keys 'elevenlabsKey' 'ElevenLabs-API-Schlüssel' 253 '' $true)
[void](Add-Check $keys 'openBrowser' 'Dashboard nach der Installation öffnen' 303 $true)
[void](Add-Text $keys 'Zugangsdaten werden verdeckt eingegeben, nur für diesen Windows-Benutzer verschlüsselt an den Installer übergeben und nicht in dessen Argumenten gespeichert. Das Dashboard-Besitzerkonto legst du beim ersten Öffnen an.' 365 90)
$script:fields.useExistingKimi.Add_CheckedChanged({ $script:fields.kimiKey.Enabled = -not $script:fields.useExistingKimi.Checked })
$kimiEnvironment = [Environment]::GetEnvironmentVariable('KIMI_API_KEY', 'User')
if (-not $kimiEnvironment) {
    $script:fields.useExistingKimi.Checked = $false
    $script:fields.useExistingKimi.Enabled = $false
    $script:fields.kimiKey.Enabled = $true
}

$summary = $tabs.TabPages[6]
$summaryText = New-Object Windows.Forms.TextBox
$summaryText.Multiline = $true; $summaryText.ReadOnly = $true; $summaryText.ScrollBars = 'Vertical'
$summaryText.Location = New-Object Drawing.Point(24, 25); $summaryText.Size = New-Object Drawing.Size(730, 470)
$summary.Controls.Add($summaryText)
$progress = $tabs.TabPages[7]
$status = Add-Text $progress 'Bereit.' 20 40
$details = New-Object Windows.Forms.TextBox
$details.Multiline = $true; $details.ReadOnly = $true; $details.ScrollBars = 'Vertical'
$details.Font = New-Object Drawing.Font('Consolas', 9)
$details.Location = New-Object Drawing.Point(20, 72); $details.Size = New-Object Drawing.Size(738, 430)
$progress.Controls.Add($details)
$toggleDetails = New-Object Windows.Forms.Button; $toggleDetails.Text = 'Details ausblenden'
$toggleDetails.Location = New-Object Drawing.Point(535, 515); $toggleDetails.Size = New-Object Drawing.Size(220, 34)
$progress.Controls.Add($toggleDetails)
$toggleDetails.Add_Click({
    $details.Visible = -not $details.Visible
    $toggleDetails.Text = if ($details.Visible) { 'Details ausblenden' } else { 'Details anzeigen' }
})
$retry = New-Object Windows.Forms.Button; $retry.Text = 'Erneut versuchen'; $retry.Location = New-Object Drawing.Point(20, 515)
$retry.Size = New-Object Drawing.Size(150, 34)
$retry.Enabled = $false; $progress.Controls.Add($retry)
$reboot = New-Object Windows.Forms.Button; $reboot.Text = 'Jetzt neu starten'; $reboot.Location = New-Object Drawing.Point(180, 515)
$reboot.Size = New-Object Drawing.Size(160, 34); $reboot.Enabled = $false; $progress.Controls.Add($reboot)
$reboot.Add_Click({
    if ([Windows.Forms.MessageBox]::Show('Windows jetzt neu starten? Der Assistent setzt die Installation nach der Anmeldung fort.',
        'Neustart', 'YesNo', 'Question') -eq 'Yes') { Restart-Computer -Force }
})

function Load-RootState {
    $root = Value 'installRoot'
    if ($script:configuredRoot -ieq $root) { return }
    $script:configuredRoot = $root
    $saved = Existing-State $root
    $script:fields.assistantName.Text = if ($saved -and $saved.assistant_name) { $saved.assistant_name } else { 'Friday' }
    $script:fields.wakePhrase.Text = if ($saved -and $saved.wake_phrase) { $saved.wake_phrase } else { 'Hey Friday' }
    $script:fields.ownerName.Text = $env:USERNAME
    $script:fields.linuxUser.Text = if ($saved -and $saved.linux_user) { $saved.linux_user } else { 'friday' }
    $script:fields.about.Text = ''
    $script:fields.address.SelectedIndex = 0; $script:fields.character.SelectedIndex = 0; $script:fields.length.SelectedIndex = 0
    foreach ($field in @('linuxPassword','linuxPasswordRepeat','kimiKey','elevenlabsKey','openaiKey','anthropicKey','customKey')) { $script:fields[$field].Clear() }
    $script:fields.voiceMode.SelectedIndex = if ($saved -and $saved.voice_mode -eq 'elevenlabs') { 1 } else { 0 }
    $script:fields.voiceChoice.SelectedIndex = if ($saved -and $saved.voice_choice -eq 'classic') { 1 } else { 0 }
    $script:fields.voiceId.Text = if ($saved -and $saved.elevenlabs_voice_id) { $saved.elevenlabs_voice_id } else { '' }
    $script:fields.voiceReference.Text = if ($saved -and $saved.voice_reference) { $saved.voice_reference } else { '' }
    $script:fields.inputDevice.SelectedIndex = 0; $script:fields.outputDevice.SelectedIndex = 0
    $pending = if ($saved -and $saved.gui_pending) { $saved.gui_pending } else { $null }
    if ($pending) {
        if (-not (@($saved.done) -contains 'persona')) {
            if ($pending.ownerName) { $script:fields.ownerName.Text = [string]$pending.ownerName }
            $script:fields.about.Text = [string]$pending.about
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
            if ($pending.voiceChoice -in @('1','2')) { $script:fields.voiceChoice.SelectedIndex = [int]$pending.voiceChoice - 1 }
            $script:fields.voiceReference.Text = [string]$pending.voiceReference
            $script:fields.voiceId.Text = [string]$pending.voiceId
        }
        foreach ($fieldName in @('migrateLegacy','disableLegacy','reuseDistro','disableForeignTasks',
                                 'overwriteDashboardConfig','keepIdentity','repeatEnrollment','openBrowser')) {
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
                if ($persona.about) { $script:fields.about.Text = $persona.about }
            } catch { }
        }
    }
    foreach ($choice in @('assistantName','wakePhrase')) { $script:fields[$choice].Enabled = -not ($saved -and $saved.assistant_name) }
    foreach ($choice in @('voiceMode','voiceChoice','voiceReference','voiceId')) {
        $script:fields[$choice].Enabled = -not ($saved -and $saved.voice_mode)
    }
    foreach ($choice in @('inputDevice','outputDevice')) { $script:fields[$choice].Enabled = -not ($saved -and @($saved.done) -contains 'voicepython') }
    $browse.Enabled = $script:fields.voiceReference.Enabled
    foreach ($choice in @('ownerName','address','character','length','about')) { $script:fields[$choice].Enabled = -not ($saved -and @($saved.done) -contains 'persona') }
    $script:fields.linuxUser.Enabled = -not ($saved -and $saved.linux_user)
    $script:fields.keepIdentity.Enabled = $script:fields.assistantName.Enabled
    $script:fields.repeatEnrollment.Enabled = $script:fields.assistantName.Enabled
    if ($saved -and @($saved.done) -contains 'hermes') {
        $script:fields.useExistingKimi.Enabled = $false; $script:fields.kimiKey.Enabled = $false
    } else {
        $script:fields.useExistingKimi.Enabled = [bool]$kimiEnvironment
        $script:fields.kimiKey.Enabled = -not $script:fields.useExistingKimi.Checked
    }
}
if ($ResumeRoot) { $script:fields.installRoot.Text = $ResumeRoot }
Update-PathFields
Load-RootState
$refresh.PerformClick()

function Update-Summary {
    $mode = if ($script:fields.voiceMode.SelectedIndex -eq 0) { 'Lokal (NVIDIA-GPU)' } else { 'ElevenLabs Cloud (mögliche Anbieter-Kosten)' }
    $voiceName = if ($script:fields.voiceMode.SelectedIndex -eq 1) {
        if (Value 'voiceId') { 'ElevenLabs Voice ID ' + (Value 'voiceId') } else { 'ElevenLabs Standardstimme' }
    } elseif ($script:fields.voiceChoice.SelectedIndex -eq 1) { 'J.A.R.V.I.S. klassisch' } else { 'F.R.I.D.A.Y. weiblich' }
    $state = Existing-State (Value 'installRoot')
    $previous = if ($state) { "Vorhandene Installation: erledigte Schritte werden übernommen ($(@($state.done).Count) Schritte)." } else { 'Neuinstallation: WSL, Hermes, Sprache und Dashboard werden eingerichtet.' }
    $summaryText.Text = (@"
$previous

Installationsordner: $(Value 'installRoot')
WSL: $(Value 'distroName') · $(Value 'distroLocation')
Assistent: $(Value 'assistantName') · Wake Word: $(Value 'wakePhrase')
Person: $(Value 'ownerName')
Sprachbetrieb: $mode
Stimme: $voiceName
Referenz: $(if ($script:fields.voiceMode.SelectedIndex -eq 1) { 'ElevenLabs (keine lokale Referenz)' } elseif (Value 'voiceReference') { Value 'voiceReference' } else { 'automatische Auswahl' })
Mikrofon: $(Value 'inputDevice')
Lautsprecher: $(Value 'outputDevice')

Es werden nur benötigte Komponenten installiert: WSL/Ubuntu, Hermes/Kimi,
Sprachdienst und Command Center. Der Installer zeigt jeden tatsächlichen Schritt
und laufende Meldungen. Downloads benötigen Internet und etwa 45–90 Minuten.
Nach einer neuen WSL-Einrichtung kann ein Windows-Neustart erforderlich sein.

Die Zugangsdaten werden in dieser Übersicht nicht angezeigt.
"@).Replace("`r`n", "`n").Replace("`n", "`r`n")
}
$tabs.Add_SelectedIndexChanged({
    if ($script:process) {
        if ($tabs.SelectedIndex -ne 6) { $tabs.SelectedIndex = 6 }
        $back.Enabled = $false; $next.Enabled = $false; $start.Enabled = $false
        return
    }
    if ($tabs.SelectedIndex -eq 5) { Update-Summary }
    $back.Enabled = $tabs.SelectedIndex -gt 0 -and $tabs.SelectedIndex -lt 6
    $next.Enabled = $tabs.SelectedIndex -lt 5
    $start.Enabled = $tabs.SelectedIndex -eq 5
})
$back.Add_Click({ if ($tabs.SelectedIndex -gt 0) { $tabs.SelectedIndex-- } })
$next.Add_Click({ if ($tabs.SelectedIndex -lt 5) { $tabs.SelectedIndex++ } })

$script:process = $null
$script:simulationFile = $null
$script:stdoutTask = $null
$script:stderrTask = $null
$script:guiExitCode = 0
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
function Append-Log([string]$line) {
    $script:lastOutputAt = Get-Date
    foreach ($secret in $script:redactions) {
        if ($secret) { $line = $line.Replace($secret, '[verdeckt]') }
    }
    $details.AppendText($line + "`r`n")
    if ($line -match '^\s*(Schritt \d+|\[GUI\]|\[FEHLER\]|\[OK\])') { $status.Text = $line.Trim() }
}
function Start-Backend {
    if ($script:process) { return }
    try { $state = Test-Wizard } catch { Show-Error $_.Exception.Message; return }
    $answers = @{
        assistantName = Value 'assistantName'; wakePhrase = Value 'wakePhrase'; ownerName = Value 'ownerName'
        about = Value 'about'; linuxUser = Value 'linuxUser'; voiceMode = [string]($script:fields.voiceMode.SelectedIndex + 1)
        voiceChoice = [string]($script:fields.voiceChoice.SelectedIndex + 1); voiceReference = Value 'voiceReference'
        voiceId = Value 'voiceId'
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
        providerChoice = [string]($script:fields.providerChoice.SelectedIndex + 1)
        modelBaseUrl = Value 'modelBaseUrl'; modelName = Value 'modelName'
    }
    $secrets = @{
        linuxPassword = Secure-Field 'linuxPassword'; linuxPasswordRepeat = Secure-Field 'linuxPasswordRepeat'
        kimiKey = Secure-Field 'kimiKey'; elevenlabsKey = Secure-Field 'elevenlabsKey'
        openaiKey = Secure-Field 'openaiKey'; anthropicKey = Secure-Field 'anthropicKey'
        customKey = Secure-Field 'customKey'
    }
    $script:redactions = @(@('linuxPassword','linuxPasswordRepeat','kimiKey','elevenlabsKey','openaiKey','anthropicKey','customKey') |
        ForEach-Object { $script:fields[$_].Text } | Where-Object { $_ })
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
        $script:fields.kimiKey.Clear(); $script:fields.elevenlabsKey.Clear()
        foreach ($name in @('openaiKey','anthropicKey','customKey')) { $script:fields[$name].Clear() }
        $details.Clear(); $status.Text = 'Installation läuft …'
        $tabs.SelectedIndex = 6; $timer.Start(); $retry.Enabled = $false
        $back.Enabled = $false; $next.Enabled = $false; $start.Enabled = $false
    } catch {
        if ($script:process) {
            try { if (-not $script:process.HasExited) { & taskkill.exe /PID $script:process.Id /T /F | Out-Null } } catch { }
            $script:process.Dispose(); $script:process = $null
        }
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
        Show-Error "Installation konnte nicht starten: $($_.Exception.Message)"
    }
}
$start.Add_Click({ Start-Backend })
$retry.Add_Click({ $tabs.SelectedIndex = 5; Update-Summary })
$timer.Add_Tick({
    foreach ($stream in @('stdout','stderr')) {
        $taskName = $stream + 'Task'
        $reader = if ($stream -eq 'stdout') { $script:process.StandardOutput } else { $script:process.StandardError }
        $task = Get-Variable -Name $taskName -Scope Script -ValueOnly
        $read = 0
        while ($task -and $task.IsCompleted -and $read -lt 100) {
            if ($null -eq $task.Result) { $task = $null; break }
            Append-Log $task.Result
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
                Append-Log $task.Result
                $task = $reader.ReadLineAsync()
            }
        }
        $exitCode = $script:process.ExitCode
        $script:guiExitCode = $exitCode
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
        if ($exitCode -eq 0) { $status.Text = 'Installation abgeschlossen. Dashboard und Dienste wurden geprüft.' }
        elseif ($exitCode -eq 10) { $status.Text = 'Windows-Neustart erforderlich. Nach der Anmeldung öffnet sich dieser Assistent erneut.'; $reboot.Enabled = $true }
        elseif ($exitCode -eq 20) { $status.Text = 'Es läuft bereits eine Installation. Bitte dort abschließen oder beenden; dieser Start hat nichts geändert.'; $retry.Enabled = $true }
        else { $status.Text = "Installation angehalten (Fehlercode $exitCode). Details prüfen, dann erneut versuchen."; $retry.Enabled = $true }
        $script:process.Dispose(); $script:process = $null
        $script:redactions = @()
        if ($Simulation) {
            $capture = Join-Path $env:TEMP "friday-gui-$Simulation.png"
            $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
            try { $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height))); $bitmap.Save($capture) }
            finally { $bitmap.Dispose() }
            $script:guiTestMessage = "GUI_TEST mode=$Simulation exit=$exitCode status=$($status.Text) screenshot=$capture"
            $form.Close()
        }
    }
})
$form.Add_FormClosing({
    if ($script:process -and -not $script:process.HasExited) {
        $choice = [Windows.Forms.MessageBox]::Show('Die Installation läuft. Beim Schließen wird der aktuelle Installationsprozess beendet. Erledigte Schritte bleiben gespeichert. Schließen?',
            'Installation läuft', 'YesNo', 'Warning')
        if ($choice -ne 'Yes') { $_.Cancel = $true; return }
        try { & taskkill.exe /PID $script:process.Id /T /F | Out-Null; $script:process.WaitForExit(5000) | Out-Null } catch { }
        if ($script:configPath -and (Test-Path -LiteralPath $script:configPath)) { Remove-Item -LiteralPath $script:configPath -Force -ErrorAction SilentlyContinue }
    }
})
$form.Add_Shown({
    $form.Activate()
    if ($Simulation) {
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
            if ((Value 'ownerName') -cne 'Testnutzer' -or (Value 'about') -cne 'synthetisch' -or
                $script:fields.address.SelectedIndex -ne 2 -or $script:fields.character.SelectedIndex -ne 1 -or
                $script:fields.length.SelectedIndex -ne 1 -or $script:fields.voiceMode.SelectedIndex -ne 1 -or
                (Value 'inputDevice') -cne 'Testmikrofon' -or (Value 'outputDevice') -cne 'Testlautsprecher' -or
                $script:fields.openBrowser.Checked) { throw 'GUI resume did not restore pending nonsecret decisions.' }
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
        $script:fields.useExistingKimi.Checked = $false
        $script:fields.kimiKey.Text = 'synthetic-test-key'
        $script:fields.linuxPassword.Text = 'synthetic-test-password'
        $script:fields.linuxPasswordRepeat.Text = 'synthetic-test-password'
        foreach ($required in @('providerChoice', 'modelBaseUrl', 'modelName', 'openaiKey', 'anthropicKey', 'customKey')) {
            if (-not $script:fields.ContainsKey($required)) { throw "GUI provider field missing: $required" }
        }
        if ($tabs.TabPages[4].Text -ne 'KI-Zugang' -or $tabs.TabPages.Count -ne 8) { throw 'GUI provider page missing.' }
        foreach ($index in 0..6) {
            $tabs.SelectedIndex = $index
            if ($index -eq 2) { $script:fields.voiceMode.SelectedIndex = 0 }
            $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
            try {
                $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
                $bitmap.Save((Join-Path $env:TEMP "friday-gui-page-$index.png"))
            } finally { $bitmap.Dispose() }
        }
        $tabs.SelectedIndex = 2; $script:fields.voiceMode.SelectedIndex = 1
        $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
        try {
            $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
            $bitmap.Save((Join-Path $env:TEMP 'friday-gui-cloud.png'))
        } finally { $bitmap.Dispose() }
        $script:fields.voiceMode.SelectedIndex = 0
        $tabs.SelectedIndex = 6
        Start-Backend
    }
})
[void]$form.ShowDialog()
if ($Simulation) { Write-Output $script:guiTestMessage; exit $script:guiExitCode }
