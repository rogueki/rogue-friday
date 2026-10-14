#Requires -Version 5.1
<#
  F.R.I.D.A.Y. – Komplettinstallation (Windows 11 + WSL2 + Hermes Agent + Kimi K3 + lokale Sprachsteuerung)
  Standardassistent: F.R.I.D.A.Y. ("Friday", Nachfolger von J.A.R.V.I.S.), Wake Word "Hey Friday". Der Name wird
  vor der Stimmaufnahme abgefragt und kann frei gewählt werden (z. B. Jarvis, James). Später ändern: change-assistant-name.bat
  (= install-jarvis.ps1 -ChangeName).
  Start per Doppelklick auf install-jarvis.bat. Kann jederzeit erneut gestartet werden: erledigte Schritte
  werden übersprungen (Fortschritt: C:\Jarvis\config\install-state.json).
#>
param([switch]$Resume, [switch]$ChangeName)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$env:WSL_UTF8 = '1'
$OutputEncoding = New-Object Text.UTF8Encoding $false  # Eingaben (z. B. Passwort mit Umlauten) korrekt an wsl.exe
$Root   = 'C:\Jarvis'
$Inst   = "$Root\installer"
$Distro = 'Ubuntu'
$Ports  = @{ Dashboard = 43691; Qwen = 43692; HermesApi = 43693; Voice = 43694 }
$ResumeTask = 'JARVIS_Installation_fortsetzen'

# ---------------------------------------------------------------- Admin
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $fwd = ''
    if ($Resume) { $fwd += ' -Resume' }
    if ($ChangeName) { $fwd += ' -ChangeName' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"$fwd"
    exit
}
$Host.UI.RawUI.WindowTitle = 'F.R.I.D.A.Y. Installation'

foreach ($d in 'config','exchange','logs','models','scripts','voice','windows-worker','backups','cache','installer') {
    New-Item -ItemType Directory -Force "$Root\$d" | Out-Null
}
Start-Transcript -Path "$Root\logs\install-$(Get-Date -Format yyyyMMdd-HHmmss).log" -Append | Out-Null

# ---------------------------------------------------------------- Ausgabe & Eingabe
function Title($text) { Write-Host ""; Write-Host ("=" * 70) -ForegroundColor DarkCyan; Write-Host "  $text" -ForegroundColor Cyan; Write-Host ("=" * 70) -ForegroundColor DarkCyan }
function Info($text)  { Write-Host "  $text" }
function Ok($text)    { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text)  { Write-Host "  [!]  $text" -ForegroundColor Yellow }
function Stop-Install($text) {
    Write-Host ""; Write-Host "  [FEHLER] $text" -ForegroundColor Red
    Write-Host "  Problem beheben und install-jarvis.bat einfach erneut starten - es geht an dieser Stelle weiter." -ForegroundColor Red
    Stop-Transcript | Out-Null; Read-Host "  Enter zum Beenden"; exit 1
}
function Ask($question, $default = '') {
    $suffix = if ($default) { " [$default]" } else { '' }
    $a = Read-Host "  $question$suffix"
    if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}
function Choose($question, [string[]]$options, $default = 1) {
    Write-Host "  $question"
    for ($i = 0; $i -lt $options.Count; $i++) { Write-Host "     $($i + 1)) $($options[$i])" }
    while ($true) {
        $a = Ask "Auswahl (1-$($options.Count))" "$default"
        if ($a -match '^\d+$' -and [int]$a -ge 1 -and [int]$a -le $options.Count) { return [int]$a }
    }
}
function YesNo($question, $defaultYes = $true) {
    $a = Ask "$question (j/n)" $(if ($defaultYes) { 'j' } else { 'n' })
    return $a -match '^[jJyY]'
}
function Plain([Security.SecureString]$s) {
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# ---------------------------------------------------------------- Assistentenname
# Gleiche Regeln wie voice/personal_wake.py (valid_name, slugify, wake_phrase) und common/persona.py.
$DefaultName = 'Friday'
function Test-AssistantName($n) { return $n -match '^\p{L}{2,20}$' }
function Format-AssistantName($n) { return $n.Substring(0, 1).ToUpper() + $n.Substring(1) }
function Get-WakeSlug($n) {
    $s = $n.ToLower().Replace('ä', 'ae').Replace('ö', 'oe').Replace('ü', 'ue').Replace('ß', 'ss')
    $s = ($s.Normalize([Text.NormalizationForm]::FormD) -replace '[^\x00-\x7F]', '') -replace '[^a-z0-9]+', '_'
    $s = $s.Trim('_')
    if ($s) { return $s } else { return 'assistant' }
}
function Read-AssistantName($default) {
    while ($true) {
        $n = Ask 'Wie soll dein Assistent heißen?' $default
        if (Test-AssistantName $n) { return (Format-AssistantName $n) }
        Warn 'Bitte nur Buchstaben (auch Umlaute), 2 bis 20 Zeichen, ohne Leerzeichen und Zahlen.'
    }
}
function Set-AssistantName($n) {
    $State.assistant_name = $n
    $State.wake_phrase = "Hey $n"
    $State.wake_slug = Get-WakeSlug $n
    $State.wake_engine = if ($State.wake_slug -eq 'jarvis') { 'openwakeword' } else { 'personal' }
    Save-State
}

# ---------------------------------------------------------------- Fortschritt
$StateFile = "$Root\config\install-state.json"
$State = @{ done = @() }
if (Test-Path $StateFile) {
    (Get-Content $StateFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $State[$_.Name] = $_.Value }
}
function Save-State { $State | ConvertTo-Json -Depth 6 | Set-Content $StateFile -Encoding UTF8 }
function IsDone($n) { return @($State.done) -contains $n }
function MarkDone($n) { $State.done = @(@($State.done) + $n | Select-Object -Unique); Save-State }

# ---------------------------------------------------------------- Helfer
function Native([scriptblock]$cmd) { & $cmd 2>&1 | ForEach-Object { "$_" } }
function Wsl-Run([string]$User, [string]$Script, [string]$StdIn = '') {
    # Skriptdateien statt Befehlszeilen: wsl.exe wuerde $VARIABLEN sonst vorzeitig expandieren.
    $out = if ($StdIn) { $StdIn | & wsl.exe -d $Distro -u $User --exec bash $Script 2>&1 } else { & wsl.exe -d $Distro -u $User --exec bash $Script 2>&1 }
    $lines = @($out | ForEach-Object { "$_" })
    $lines | ForEach-Object { Write-Host "     $_" -ForegroundColor DarkGray }
    return ($lines -join "`n")
}
function Wait-Http($url, $seconds, $headers = @{}) {
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
        try { Invoke-WebRequest -UseBasicParsing $url -Headers $headers -TimeoutSec 3 | Out-Null; return $true } catch { Start-Sleep 3 }
    }
    return $false
}
function Register-UserTask($name, $vbsArgs, $description, $delaySeconds = 0) {
    $action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo $vbsArgs"
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    if ($delaySeconds) { $trigger.Delay = "PT$($delaySeconds)S" }
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $name -Description $description -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Force | Out-Null
}
function Download($url, $file) {
    & curl.exe -L --fail --retry 5 -C - -s -o $file $url
    return $LASTEXITCODE -eq 0
}
function Sha256($file) { return (Get-FileHash $file -Algorithm SHA256).Hash.ToLower() }

if (Get-ScheduledTask -TaskName $ResumeTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $ResumeTask -Confirm:$false
}

Title 'F.R.I.D.A.Y. – Installation'
Info 'Dieser Assistent richtet F.R.I.D.A.Y., deinen persönlichen Sprachassistenten, komplett ein. Du wirst nur nach wenigen Dingen gefragt.'
Info 'Dauer: ca. 45–90 Minuten (viele Downloads). Unterbrechen ist kein Problem – einfach neu starten.'

# ================================================================ 0 Name des Assistenten (VOR allen Aufnahmen und Konfigurationsdateien)
# Einmal fragen, bei Fortsetzung wiederverwenden. Ändern ohne Zusatzaufwand nur, solange noch keine Stimmaufnahmen
# existieren; danach über change-assistant-name.bat (-ChangeName): neuer Name, Aufnahme und Sprachdienst werden wiederholt.
function Update-PersonaName($newName, [string[]]$redo) {
    # persona.json, SOUL.md (Hermes) und voice.json tragen den alten Namen: Name ersetzen, die abhängigen Schritte wiederholen.
    $pf = "$Root\config\persona.json"
    if (Test-Path $pf) {
        $pj = Get-Content $pf -Raw | ConvertFrom-Json
        $pj | Add-Member -NotePropertyName assistant_name -NotePropertyValue $newName -Force
        [IO.File]::WriteAllText($pf, ($pj | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    }
    $State.done = @(@($State.done) | Where-Object { $_ -notin $redo })
    Save-State
}
$recordingsExist = (IsDone 'enroll') -or [bool](Get-ChildItem "$Root\voice\profiles\owner\raw" -Recurse -Filter *.wav -ErrorAction SilentlyContinue | Select-Object -First 1)
$oldName = $null
if ($ChangeName -and $State.assistant_name) {
    $oldName = $State.assistant_name
    foreach ($k in 'assistant_name', 'wake_phrase', 'wake_slug', 'wake_engine') { $State.Remove($k) }
    Save-State
    Info "Bisheriger Name: $oldName. Du kannst einen neuen Namen wählen (Enter = $oldName behalten)."
}
if (-not $State.assistant_name) {
    Title 'Dein Assistent'
    # Installation aus der Zeit vor der Namensabfrage (persona.json ohne assistant_name): der Assistent hieß Jarvis.
    $legacy = (-not $oldName) -and ((IsDone 'persona') -or $recordingsExist)
    $prev = if ($oldName) { $oldName } elseif ($legacy) { 'Jarvis' } else { $null }
    if ($legacy) {
        Info "Vorhandene Installation erkannt: Der Assistent heißt bisher $prev (Enter = beibehalten)."
    } elseif (-not $oldName) {
        Info 'Standardmäßig heißt dein Assistent Friday (F.R.I.D.A.Y., der Nachfolger von J.A.R.V.I.S.) und hört auf "Hey Friday".'
        Info 'Du kannst ihm jetzt einen eigenen Namen geben, z. B. Jarvis, James oder Frida. Der Name wird für die Stimmaufnahme gebraucht.'
    }
    $new = Read-AssistantName $(if ($prev) { $prev } else { $DefaultName })
    Set-AssistantName $new
    if ($prev) {
        $redo = @()
        if ($new -ne $prev) {
            $redo = @('hermes', 'voicepython')
            if ($recordingsExist) { $redo += @('enroll', 'voiceservice') }
        } elseif ($oldName -and (YesNo 'Name unverändert. Stimmaufnahme trotzdem wiederholen?' $false)) {
            $redo = @('enroll', 'voiceservice')
        }
        Update-PersonaName $new $redo
        if ($redo.Count -gt 0) { Warn 'Die abhängigen Schritte (Hermes-Persönlichkeit, Sprachmodell-Konfiguration, ggf. Stimmaufnahme und Sprachdienst) werden jetzt mit diesem Namen erneut durchlaufen.' }
    }
    Ok "Dein Assistent heißt $($State.assistant_name) – Wake Word: '$($State.wake_phrase)'."
} elseif (-not $Resume -and -not $recordingsExist) {
    Info "Dein Assistent heißt $($State.assistant_name) (Wake Word '$($State.wake_phrase)')."
    if (-not (YesNo 'Namen beibehalten?')) {
        $new = Read-AssistantName $State.assistant_name
        if ($new -ne $State.assistant_name) {
            Set-AssistantName $new
            Update-PersonaName $new @('hermes', 'voicepython')
            Ok "Dein Assistent heißt jetzt $new – Wake Word: '$($State.wake_phrase)'."
        }
    }
}
$AN = $State.assistant_name
$WP = $State.wake_phrase
$Slug = $State.wake_slug

# ================================================================ 1 Systemcheck
if (-not (IsDone 'preflight')) {
    Title 'Schritt 1/14 – Systemcheck'
    $build = [Environment]::OSVersion.Version.Build
    $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    $cores = (Get-CimInstance Win32_Processor | Measure-Object NumberOfLogicalProcessors -Sum).Sum
    $freeGB = [math]::Round((Get-Volume -DriveLetter C).SizeRemaining / 1GB)
    Info "Windows-Build $build | RAM $ramGB GB | $cores Threads | C: $freeGB GB frei"
    if ($build -lt 19041) { Stop-Install 'Windows ist zu alt für WSL2. Bitte Windows aktualisieren.' }
    if ($freeGB -lt 40) { Stop-Install "Auf C: sind nur $freeGB GB frei – mindestens 40 GB werden gebraucht." }
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
    if (-not $gpu.nvidia) { Warn "Keine NVIDIA-GPU gefunden: $AN läuft dann komplett auf der CPU (langsamer)." }
    try { Invoke-WebRequest -UseBasicParsing https://huggingface.co -Method Head -TimeoutSec 15 | Out-Null; Ok 'Internet erreichbar' }
    catch { Stop-Install 'Keine Internetverbindung.' }
    $State.build = $build; $State.ram_gb = $ramGB; $State.cores = $cores; $State.gpu = $gpu
    MarkDone 'preflight'
}

# ================================================================ 2 Dateien
# Bei jedem Start synchronisieren, solange das Skript nicht aus C:\Jarvis\installer laeuft: ein aktualisiertes Paket
# muss die dort liegenden Kopien (WSL-Skripte, Voice-Dateien) ersetzen, auch wenn der Schritt schon erledigt ist.
if (-not (IsDone 'files') -or $PSScriptRoot -ne $Inst) {
    Title 'Schritt 2/14 – Installationsdateien nach C:\Jarvis kopieren'
    if ($PSScriptRoot -ne $Inst) {
        & robocopy.exe $PSScriptRoot $Inst /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Install "Kopieren der Installationsdateien fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    Ok "Dateien liegen in $Inst"
    MarkDone 'files'
}

# ================================================================ 3 WSL-Grundlage (ggf. Neustart)
if (-not (IsDone 'wslfeature')) {
    Title 'Schritt 3/14 – WSL2 (Linux-Subsystem) vorbereiten'
    & wsl.exe --status *> $null
    if ($LASTEXITCODE -ne 0) {
        Info 'WSL wird installiert …'
        Native { wsl.exe --install --no-distribution } | ForEach-Object { Info $_ }
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Inst\install-jarvis.ps1`" -Resume"
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $ResumeTask -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
        Warn 'Windows muss jetzt neu starten. Danach geht die Installation automatisch weiter.'
        Stop-Transcript | Out-Null
        if (YesNo 'Jetzt neu starten?') { Restart-Computer -Force }
        exit
    }
    Native { wsl.exe --update } | Out-Null
    Ok "WSL bereit: $((& wsl.exe --version | Select-Object -First 1))"
    MarkDone 'wslfeature'
}

# ================================================================ 4 Energie
if (-not (IsDone 'power')) {
    Title 'Schritt 4/14 – Energieoptionen (am Netzteil immer wach bleiben)'
    & powercfg /change standby-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    & powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
    & powercfg /setactive SCHEME_CURRENT
    Ok 'Am Netzteil: kein Standby, kein Ruhezustand, Deckel zuklappen = keine Aktion. Bildschirm darf ausgehen.'
    MarkDone 'power'
}

# ================================================================ 5 Persönlichkeit
if (-not (IsDone 'persona')) {
    Title "Schritt 5/14 – Deine Wünsche an $AN"
    $name = ''
    while (-not $name) { $name = Ask 'Wie heißt du (Vorname)?' }
    $addr = Choose "Wie soll $AN dich ansprechen?" @("Mit 'Sir' und Sie – wie ein britischer Butler", "Mit Vornamen und Sie ($name)", "Mit Vornamen und Du ($name)") 1
    $char = Choose 'Welcher Charakter?' @('Britischer Butler: höflich, elegant, trockener Humor', 'Freundlich und locker', 'Sachlich und knapp') 1
    $len  = Choose 'Wie ausführlich sollen Antworten sein?' @('Kurz und auf den Punkt', 'Ausführlicher') 1
    Info "Optional: Was soll $AN über dich wissen? (Beruf, Firma, Interessen, Familie … – Enter = überspringen)"
    $about = Ask 'Über mich'
    $persona = [ordered]@{
        assistant_name = $AN
        owner_name = $name
        address    = @('sir', 'sie', 'du')[$addr - 1]
        character  = @('butler', 'freundlich', 'sachlich')[$char - 1]
        length     = @('kurz', 'normal')[$len - 1]
        about      = $about
    }
    [IO.File]::WriteAllText("$Root\config\persona.json", ($persona | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    Ok 'Gespeichert (änderbar in C:\Jarvis\config\persona.json).'
    MarkDone 'persona'
}

# ================================================================ 6 .wslconfig
if (-not (IsDone 'wslconfig')) {
    Title 'Schritt 6/14 – WSL-Ressourcen festlegen'
    $mem = [math]::Max(4, [math]::Min(16, [math]::Floor($State.ram_gb / 2)))
    $cpu = [math]::Max(2, [math]::Min(10, $State.cores - 2))
    $cfgFile = "$env:USERPROFILE\.wslconfig"
    if (Test-Path $cfgFile) { Copy-Item $cfgFile "$Root\backups\.wslconfig.bak-$(Get-Date -Format yyyyMMdd-HHmmss)" }
    $lines = @('[wsl2]', "memory=$($mem)GB", "processors=$cpu", 'swap=8GB', 'localhostForwarding=true')
    if ($State.build -ge 22621) { $lines += @('networkingMode=mirrored', 'dnsTunneling=true', 'firewall=true') }
    else { Warn 'Windows-Build < 22621: "mirrored networking" nicht verfügbar – Windows erreicht WSL-Dienste evtl. nur eingeschränkt.' }
    $lines += @('', '[experimental]', 'autoMemoryReclaim=gradual')
    Set-Content -Path $cfgFile -Value $lines -Encoding Ascii
    & wsl.exe --shutdown
    Ok "WSL: $mem GB RAM, $cpu Threads, 8 GB Swap."
    MarkDone 'wslconfig'
}

# ================================================================ 7 Ubuntu
if (-not (IsDone 'distro')) {
    Title 'Schritt 7/14 – Ubuntu 24.04 installieren'
    $existing = @(& wsl.exe -l -q 2>$null | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    if ($existing -contains $Distro) {
        if (-not (YesNo "Es gibt bereits eine WSL-Distribution '$Distro'. Diese verwenden?")) { Stop-Install "Bitte vorhandenes '$Distro' sichern/entfernen oder umbenennen." }
    } else {
        Native { wsl.exe --install Ubuntu-24.04 --name $Distro --no-launch --web-download } | ForEach-Object { Info $_ }
        $existing = @(& wsl.exe -l -q 2>$null | ForEach-Object { "$_".Trim() })
        if ($existing -notcontains $Distro) { Stop-Install 'Ubuntu konnte nicht installiert werden (siehe Meldung oben).' }
    }
    Ok 'Ubuntu ist installiert.'
    MarkDone 'distro'
}

# ================================================================ 8 Linux-Benutzer
if (-not (IsDone 'linuxuser')) {
    Title 'Schritt 8/14 – Linux-Benutzer anlegen'
    Info "$AN läuft in Ubuntu unter einem eigenen Benutzer. Name: nur Kleinbuchstaben/Zahlen."
    $suggest = ($env:USERNAME.ToLower() -replace '[^a-z0-9_-]', '')
    if ($suggest -notmatch '^[a-z_]') { $suggest = 'jarvis' }
    do { $user = Ask 'Linux-Benutzername' $suggest } until ($user -match '^[a-z_][a-z0-9_-]{0,31}$')
    while ($true) {
        $p1 = Plain (Read-Host '  Linux-Passwort (wird für "sudo" gebraucht, gut merken!)' -AsSecureString)
        $p2 = Plain (Read-Host '  Passwort wiederholen' -AsSecureString)
        if ($p1 -and $p1 -eq $p2) { break }
        Warn 'Passwörter leer oder ungleich – bitte nochmal.'
    }
    Info 'Richte Ubuntu ein (Pakete, Benutzer, systemd) – dauert einige Minuten …'
    $out = Wsl-Run 'root' "/mnt/c/Jarvis/installer/wsl/setup_root.sh" "$user`n$p1"
    $p1 = $null; $p2 = $null
    if ($out -notmatch 'ROOT_SETUP_DONE') { Stop-Install 'Ubuntu-Grundeinrichtung fehlgeschlagen.' }
    & wsl.exe --terminate $Distro | Out-Null
    Start-Sleep 3
    $who = (& wsl.exe -d $Distro --exec whoami 2>$null | Select-Object -First 1)
    $pid1 = (& wsl.exe -d $Distro --exec ps -p 1 -o comm= 2>$null | Select-Object -First 1)
    if ("$who".Trim() -ne $user -or "$pid1".Trim() -ne 'systemd') { Stop-Install "Prüfung fehlgeschlagen (Benutzer='$who', PID1='$pid1')." }
    $State.linux_user = $user
    Ok "Benutzer '$user' aktiv, systemd läuft."
    MarkDone 'linuxuser'
}

# ================================================================ 9 WSL wach halten
if (-not (IsDone 'keepalive')) {
    Title 'Schritt 9/14 – WSL dauerhaft aktiv halten'
    Register-UserTask 'JARVIS_WSL_Keepalive' "`"$Inst\scripts\wsl-keepalive.vbs`"" 'Hält Ubuntu/WSL für Hermes dauerhaft aktiv'
    Start-ScheduledTask -TaskName 'JARVIS_WSL_Keepalive'
    Ok 'Aufgabe JARVIS_WSL_Keepalive eingerichtet (startet bei jeder Anmeldung).'
    MarkDone 'keepalive'
}

# ================================================================ 10 Hermes + Kimi
if (-not (IsDone 'hermes')) {
    Title 'Schritt 10/14 – Hermes Agent + Kimi K3'
    $key = [Environment]::GetEnvironmentVariable('KIMI_API_KEY', 'User')
    if ($key -and (YesNo 'Kimi-API-Key aus der Kimi-Code-Einrichtung gefunden. Verwenden?')) { }
    else {
        Info 'Kimi-API-Key eingeben (Eingabe bleibt unsichtbar; wird nur in Ubuntu unter ~/.hermes/.env gespeichert).'
        $key = Plain (Read-Host '  Kimi-API-Key' -AsSecureString)
    }
    if (-not $key) { Stop-Install "Ohne Kimi-API-Key kann $AN nicht denken." }
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
    Info 'Installiere Hermes, verbinde Kimi, richte Persönlichkeit, Kanban, Dashboard und Gateway ein (10–20 min) …'
    $out = Wsl-Run $State.linux_user '/mnt/c/Jarvis/installer/wsl/setup_hermes.sh' $key
    $key = $null
    if ($out -notmatch 'HERMES_SETUP_DONE') { Stop-Install 'Hermes-Einrichtung fehlgeschlagen (siehe graue Ausgabe oben).' }
    if ($out -match 'KIMI_OK') { Ok 'Kimi K3 antwortet.' } else { Warn 'Kimi-Test nicht bestanden – Key prüfen; später in Ubuntu: hermes model' }
    if (Wait-Http "http://127.0.0.1:$($Ports.Dashboard)/" 60) { Ok "Dashboard von Windows erreichbar: http://127.0.0.1:$($Ports.Dashboard)" }
    else { Warn 'Dashboard von Windows nicht erreichbar (mirrored networking?).' }
    MarkDone 'hermes'
}

# ================================================================ 11 Qwen lokal
if (-not (IsDone 'qwen')) {
    Title 'Schritt 11/14 – Lokales Sprachmodell (Qwen3-4B) für schnelle Antworten'
    $gpu = $State.gpu
    # Pascal (GTX 10xx) & Co. laufen nur mit dem CUDA-12.4-Build; RTX 50xx braucht CUDA 13.
    $flavor = if (-not $gpu.nvidia) { 'cpu' } elseif ([double]$gpu.cc -ge 12.0) { 'cuda-13' } else { 'cuda-12.4' }
    Info "llama.cpp-Variante: $flavor"
    $rels = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=40' -Headers @{ 'User-Agent' = 'jarvis-installer' }
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
        if ($a.digest -and ("sha256:" + (Sha256 $zip)) -ne $a.digest) { Remove-Item $zip -Force; Stop-Install "Prüfsumme falsch: $($a.name) - Datei gelöscht, erneut starten." }
        Expand-Archive $zip -DestinationPath "$Root\llama.cpp" -Force
        Ok "$($a.name) ($($rel.tag_name)) geprüft und entpackt"
    }
    $model = "$Root\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf"
    New-Item -ItemType Directory -Force (Split-Path $model) | Out-Null
    Info 'Lade Qwen3-4B (2,5 GB) …'
    if (-not (Download 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf' $model)) { Stop-Install 'Qwen-Download fehlgeschlagen.' }
    if ((Sha256 $model) -ne '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5') { Remove-Item $model; Stop-Install 'Qwen-Prüfsumme falsch – erneut starten.' }
    Ok 'Qwen3-4B geprüft'
    $ctx = if ($gpu.nvidia -and [int]$gpu.vram_mb -gt 7000) { 8192 } else { 4096 }
    $layers = if ($gpu.nvidia) { 99 } else { 0 }
    @{ ctx_size = $ctx; gpu_layers = $layers } | ConvertTo-Json | Set-Content "$Root\config\qwen.json" -Encoding Ascii
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Inst\scripts\start-qwen-server.ps1"
    if (-not (Wait-Http "http://127.0.0.1:$($Ports.Qwen)/v1/models" 120)) { Stop-Install 'Qwen-Server startet nicht (C:\Jarvis\logs\qwen-server.log).' }
    $body = @{ model = 'qwen3-router'; max_tokens = 10; chat_template_kwargs = @{ enable_thinking = $false }
               messages = @(@{ role = 'user'; content = 'Antworte nur mit LOCAL_OK' }) } | ConvertTo-Json -Depth 5
    $t = Measure-Command { $r = Invoke-RestMethod -Method Post "http://127.0.0.1:$($Ports.Qwen)/v1/chat/completions" -ContentType 'application/json' -Body $body -TimeoutSec 120 }
    Ok ("Qwen antwortet ({0:N1} s): {1}" -f $t.TotalSeconds, $r.choices[0].message.content.Trim())
    Register-UserTask 'JARVIS_Qwen' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-qwen-server.ps1`"" 'Lokaler Qwen3-4B-Router für F.R.I.D.A.Y.'
    MarkDone 'qwen'
}

# ================================================================ 12 Python + Sprachpakete
if (-not (IsDone 'voicepython')) {
    Title 'Schritt 12/14 – Sprachsteuerung installieren (Python + Modelle)'
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
    Copy-Item "$Inst\voice\*" "$Root\voice\" -Force
    $venv = "$Root\voice\.venv"
    if (-not (Test-Path "$venv\Scripts\python.exe")) { & $py -m venv $venv }
    $vpy = "$venv\Scripts\python.exe"
    $env:PIP_CACHE_DIR = "$Root\cache\pip"
    Info 'Python-Pakete (ca. 3 GB, 10–20 min) …'
    & $vpy -m pip install -q --upgrade pip wheel 2>&1 | Out-Null
    & $vpy -m pip install -q torch torchaudio --index-url https://download.pytorch.org/whl/cpu 2>&1 | Out-File "$Root\logs\pip.log" -Append
    & $vpy -m pip install -q faster-whisper nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" openwakeword speechbrain silero-vad `
        piper-tts sounddevice soundfile scipy scikit-learn huggingface_hub 2>&1 | Out-File "$Root\logs\pip.log" -Append
    if ($LASTEXITCODE -ne 0) { Stop-Install 'Python-Pakete konnten nicht installiert werden (C:\Jarvis\logs\pip.log).' }
    Info 'Lade Sprachmodelle und teste die Grafikkarte …'
    $out = & $vpy "$Root\voice\voice_setup.py" $Root 2>&1 | ForEach-Object { "$_" }
    $out | Where-Object { $_ -match '==>|^\s{3}|DONE' } | ForEach-Object { Info $_ }
    if (($out -join "`n") -notmatch 'VOICE_SETUP_DONE') { Stop-Install 'Einrichtung der Sprachmodelle fehlgeschlagen.' }
    Ok 'Sprachmodelle bereit.'
    MarkDone 'voicepython'
}

# ================================================================ 13 Stimme einlernen
if (-not (IsDone 'enroll')) {
    Title "Schritt 13/14 – $AN lernt deine Stimme"
    Info "$AN reagiert nur auf DEINE Stimme. Dafür nimmst du jetzt einige Sätze auf (ca. 10–12 Minuten):"
    Info "  • 26x ""$WP"", 18x ""$AN"", 15 ähnlich klingende Wörter, 8 kurze Texte vorlesen"
    Info '  • Ruhige Umgebung, normal sprechen, nach jedem Piepton sprechen.'
    Info 'Es öffnet sich gleich ein eigenes Fenster. Dort Enter drücken und den Anweisungen folgen.'
    Read-Host '  Enter, wenn du bereit bist'
    $vpy = "$Root\voice\.venv\Scripts\python.exe"
    $raw = "$Root\voice\profiles\owner\raw"
    while ($true) {
        Start-Process -FilePath $vpy -ArgumentList "`"$Root\voice\enroll_record.py`" --name `"$AN`"" -WorkingDirectory "$Root\voice" -Wait
        $nWake = @(Get-ChildItem "$raw\wake_hey_$Slug\*.wav" -ErrorAction SilentlyContinue).Count
        $nSpeech = @(Get-ChildItem "$raw\speech\*.wav" -ErrorAction SilentlyContinue).Count
        if ($nWake -ge 20 -and $nSpeech -ge 6) { break }
        Warn "Zu wenige Aufnahmen ($nWake x '$WP', $nSpeech Texte). Bitte vollständig durchlaufen."
        if (-not (YesNo 'Aufnahme fortsetzen?')) { Stop-Install 'Stimmprofil unvollständig.' }
    }
    Info 'Berechne dein Stimmprofil und trainiere die Wake-Word-Erkennung (bei eigenem Namen einige Minuten) …'
    & $vpy "$Root\voice\build_speaker_profile.py" 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'Profil|score|Kreuz' } | ForEach-Object { Info $_ }
    $wakeOut = @(& $vpy "$Root\voice\train_owner_verifier.py" 2>&1 | ForEach-Object { "$_" })
    $wakeOut | Where-Object { $_ -match 'Verifier|Wake|Schwelle|Aufnahmen|Kalibrier' } | ForEach-Object { Info $_ }
    if (-not (Test-Path "$Root\voice\profiles\owner\embeddings\owner_ecapa.npy")) { Stop-Install 'Stimmprofil konnte nicht erstellt werden.' }
    if ($State.wake_engine -eq 'personal') {
        if (-not (Test-Path "$Root\models\openwakeword\personal_wake.npz") -or -not (Test-Path "$Root\models\openwakeword\personal_wake.json")) {
            Stop-Install "Wake-Word-Modell für '$WP' konnte nicht erstellt werden (Ausgabe oben). Aufnahme prüfen und erneut starten."
        }
        if (($wakeOut -join "`n") -match 'WAKE_QUALITY=schwach') {
            Warn "Das Wake Word '$WP' ist noch unsicher erkennbar (ähnlich klingende Wörter). Es funktioniert, kann aber öfter nicht oder fälschlich anspringen."
            Warn 'Tipp: Aufnahme in ruhigerer Umgebung wiederholen (siehe ANLEITUNG.md) oder einen längeren, markanteren Namen wählen.'
        }
    }
    Ok 'Stimmprofil erstellt (bleibt nur auf diesem PC).'
    MarkDone 'enroll'
}

# ================================================================ 14 Sprachdienst + Abschluss
if (-not (IsDone 'voiceservice')) {
    Title "Schritt 14/14 – $AN starten"
    Register-UserTask 'JARVIS_Voice' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-jarvis-voice.ps1`"" "$AN Sprachsteuerung ($WP)" 45
    # Läuft noch ein Sprachdienst mit alter Konfiguration (Namenswechsel), erst beenden: die Aufgabe startet keine zweite Instanz.
    Stop-ScheduledTask -TaskName 'JARVIS_Voice' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*jarvis_voice.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-ScheduledTask -TaskName 'JARVIS_Voice'
    Info 'Lade die Sprachmodelle (bis zu 3 Minuten) …'
    $ok = $false
    foreach ($i in 1..90) {
        try { if ((Invoke-RestMethod "http://127.0.0.1:$($Ports.Voice)" -TimeoutSec 2).state -eq 'listening') { $ok = $true; break } } catch {}
        Start-Sleep 2
    }
    if (-not $ok) { Stop-Install 'Sprachdienst startet nicht (C:\Jarvis\logs\voice-service.log).' }
    & "$Root\voice\.venv\Scripts\python.exe" "$Root\voice\say_hello.py" $Root 2>$null
    MarkDone 'voiceservice'
}

$p = Get-Content "$Root\config\persona.json" -Raw | ConvertFrom-Json
$report = @"
# F.R.I.D.A.Y. – Installationsstatus

Installiert am $(Get-Date -Format 'dd.MM.yyyy HH:mm') für $($p.owner_name). Assistent: $AN · Wake Word: "$WP" ($($State.wake_engine)).

| Komponente | Adresse |
|---|---|
| Hermes Dashboard | http://127.0.0.1:$($Ports.Dashboard) |
| Qwen3-4B (lokal) | http://127.0.0.1:$($Ports.Qwen)/v1 |
| Hermes API (für Sprache) | http://127.0.0.1:$($Ports.HermesApi)/v1 |
| Sprachdienst-Status | http://127.0.0.1:$($Ports.Voice) |

Grafikkarte: $($State.gpu.name) ($($State.gpu.vram_mb) MB) · Linux-Benutzer: $($State.linux_user)
Autostart: JARVIS_WSL_Keepalive, JARVIS_Qwen, JARVIS_Voice (Aufgabenplanung). Hermes-Dienste: systemd in Ubuntu.
Erledigte Schritte: $(@($State.done) -join ', ')
"@
[IO.File]::WriteAllText("$Root\INSTALL_STATE.md", $report, (New-Object Text.UTF8Encoding $false))

Title "FERTIG – $AN ist einsatzbereit"
Info "Sag:  ""$WP""  … kurzer Piepton … dann deine Frage, z. B. ""Wie spät ist es?"""
Info "Folgefragen gehen 90 Sekunden lang ohne erneutes ""$WP""."
Info "Dashboard (Kanban, Einstellungen): http://127.0.0.1:$($Ports.Dashboard)"
Info 'Alles startet ab jetzt automatisch bei der Anmeldung.'
Info 'Nächste Schritte (Telegram, E-Mail, Kalender): siehe ANLEITUNG.md'
Start-Process "http://127.0.0.1:$($Ports.Dashboard)"
Stop-Transcript | Out-Null
Read-Host '  Enter zum Schließen'
