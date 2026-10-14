#Requires -Version 5.1
<#
  F.R.I.D.A.Y. – Komplettinstallation (Windows 11 + WSL2 + Hermes Agent + Kimi K3 + lokale Sprachsteuerung)
  Standardassistent: F.R.I.D.A.Y. ("Friday", Nachfolger von J.A.R.V.I.S.), Wake Word "Hey Friday". Der Name wird
  vor der Stimmaufnahme abgefragt und kann frei gewählt werden (z. B. Jarvis, James). Später ändern: change-assistant-name.bat
  (= install-jarvis.ps1 -ChangeName).
  Zuletzt (Schritt 15) wird das F.R.I.D.A.Y. Command Center (Dashboard + Control API, http://127.0.0.1:3100) nach
  C:\Jarvis\dashboard installiert; -UpdateDashboard (update-dashboard.bat) spielt nur dieses Update ein.
  Start per Doppelklick auf install-jarvis.bat. Kann jederzeit erneut gestartet werden: erledigte Schritte
  werden übersprungen (Fortschritt: C:\Jarvis\config\install-state.json).
#>
param([switch]$Resume, [switch]$ChangeName, [switch]$UpdateDashboard)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$env:WSL_UTF8 = '1'
$OutputEncoding = New-Object Text.UTF8Encoding $false  # Eingaben (z. B. Passwort mit Umlauten) korrekt an wsl.exe
$Root   = 'C:\Jarvis'
$Inst   = "$Root\installer"
$Distro = 'Ubuntu'
$Ports  = @{ Dashboard = 43691; Qwen = 43692; HermesApi = 43693; Voice = 43694; CommandCenter = 3100 }
$ResumeTask = 'JARVIS_Installation_fortsetzen'
# Command Center (Schritt 15). Zielpfad C:\Jarvis\dashboard weicht bewusst von PLAN §54 (D:\Jarvis\dashboard) ab, siehe docs/DEPLOYMENT.md.
$Dash       = "$Root\dashboard"
$DashUrl    = "http://127.0.0.1:$($Ports.CommandCenter)"
$DashPort   = $Ports.CommandCenter
$DashTask   = 'JARVIS_Dashboard'
$DashInstallLog = "$Root\logs\dashboard-install.log"
$DashHashFile   = "$Root\config\dashboard_owner.hash"   # nur der scrypt-Hash des Owner-Passworts, ACL nur Installationsbenutzer

# ---------------------------------------------------------------- Admin
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $fwd = ''
    if ($Resume) { $fwd += ' -Resume' }
    if ($ChangeName) { $fwd += ' -ChangeName' }
    if ($UpdateDashboard) { $fwd += ' -UpdateDashboard' }
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
# Dienst-Launcher (hidden.vbs startet powershell mit Neustartschleife entkoppelt): Stop-ScheduledTask beendet die Schleife nicht.
# Darum Stop-Flag setzen (Schleife beendet sich selbst), Launcher-Prozess und Kindprozess per CommandLine beenden.
# Die Launcher halten ausserdem einen benannten Mutex (Einzelinstanz).
function Get-LauncherProcesses([string]$Launcher, [string]$ChildPattern) {
    return @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe' OR Name='python.exe' OR Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $PID -and ($_.CommandLine -like "*$Launcher*" -or $_.CommandLine -like $ChildPattern) })
}
function Stop-LauncherService([string]$Task, [string]$Launcher, [string]$ChildPattern) {
    New-Item -ItemType Directory -Force "$Root\run" | Out-Null
    $flag = "$Root\run\$Launcher.stop"
    Set-Content -Path $flag -Value 'stop' -Encoding Ascii
    Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    foreach ($round in 1..3) {
        $procs = Get-LauncherProcesses $Launcher $ChildPattern
        if ($procs.Count -eq 0) { break }
        # Erst die Schleife (powershell), dann deren Kinder - sonst startet sie den Dienst sofort neu.
        $procs | Where-Object { $_.Name -eq 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $procs | Where-Object { $_.Name -ne 'powershell.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep 2
    }
    Remove-Item $flag -Force -ErrorAction SilentlyContinue
}
function Stop-VoiceService { Stop-LauncherService 'JARVIS_Voice' 'start-jarvis-voice.ps1' '*jarvis_voice.py*' }
function Test-VoiceServiceRunning { return ((Get-LauncherProcesses 'start-jarvis-voice.ps1' '*jarvis_voice.py*').Count -gt 0) }
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
    Title 'Schritt 1/15 – Systemcheck'
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
    Title 'Schritt 2/15 – Installationsdateien nach C:\Jarvis kopieren'
    if ($PSScriptRoot -ne $Inst) {
        & robocopy.exe $PSScriptRoot $Inst /E /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Install "Kopieren der Installationsdateien fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    Ok "Dateien liegen in $Inst"
    MarkDone 'files'
}
# Quelle des Command Centers (Ordner ueber installer\) merken: nach einem Neustart laeuft das Skript aus C:\Jarvis\installer,
# wo die Quellen nicht liegen. Schritt 15 findet sie dann ueber install-state.json (dashboard_source).
if ($PSScriptRoot -ne $Inst) {
    $repoCand = (Split-Path $PSScriptRoot -Parent).TrimEnd('\')
    if ((Test-Path "$repoCand\pnpm-workspace.yaml") -and (Test-Path "$repoCand\apps\control-api\package.json") -and $State.dashboard_source -ne $repoCand) {
        $State.dashboard_source = $repoCand; Save-State
    }
}

# Aktualisierte Voice-Dateien muessen auch eine bestehende Installation erreichen (Schritt 12 laeuft nur einmal): Hash-Vergleich
# je Datei, geaendert -> nach C:\Jarvis\voice kopieren (profiles, models, .venv bleiben unberuehrt) und den Sprachdienst neu starten,
# falls er lief.
function Sync-VoiceFiles {
    $src = "$Inst\voice"; $dst = "$Root\voice"
    if (-not (Test-Path "$dst\.venv\Scripts\python.exe") -or -not (Test-Path $src)) { return }
    $changed = @(Get-ChildItem $src -File | Where-Object {
        -not (Test-Path "$dst\$($_.Name)") -or (Sha256 $_.FullName) -ne (Sha256 "$dst\$($_.Name)") })
    if ($changed.Count -eq 0) { return }
    Info "Sprachdateien im Paket sind neuer: $(($changed | ForEach-Object { $_.Name }) -join ', ')"
    $wasRunning = Test-VoiceServiceRunning
    if ($wasRunning) { Stop-VoiceService }
    $changed | ForEach-Object { Copy-Item $_.FullName "$dst\$($_.Name)" -Force }
    Ok "$($changed.Count) Sprachdatei(en) nach $dst aktualisiert."
    if ($wasRunning) {
        if (Get-ScheduledTask -TaskName 'JARVIS_Voice' -ErrorAction SilentlyContinue) {
            Start-ScheduledTask -TaskName 'JARVIS_Voice'
            Ok 'Sprachdienst mit den neuen Dateien neu gestartet (lädt die Modelle, ca. 1-3 Minuten).'
        } else { Warn 'Aufgabe JARVIS_Voice fehlt - Sprachdienst nicht neu gestartet. install-jarvis.bat mit entferntem Eintrag "voiceservice" in install-state.json starten.' }
    }
}
Sync-VoiceFiles

# ================================================================ 3 WSL-Grundlage (ggf. Neustart)
if (-not (IsDone 'wslfeature')) {
    Title 'Schritt 3/15 – WSL2 (Linux-Subsystem) vorbereiten'
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
    Title 'Schritt 6/15 – WSL-Ressourcen festlegen'
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
    Title 'Schritt 7/15 – Ubuntu 24.04 installieren'
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
    Title 'Schritt 8/15 – Linux-Benutzer anlegen'
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
    Title 'Schritt 9/15 – WSL dauerhaft aktiv halten'
    Register-UserTask 'JARVIS_WSL_Keepalive' "`"$Inst\scripts\wsl-keepalive.vbs`"" 'Hält Ubuntu/WSL für Hermes dauerhaft aktiv'
    Start-ScheduledTask -TaskName 'JARVIS_WSL_Keepalive'
    Ok 'Aufgabe JARVIS_WSL_Keepalive eingerichtet (startet bei jeder Anmeldung).'
    MarkDone 'keepalive'
}

# ================================================================ 10 Hermes + Kimi
if (-not (IsDone 'hermes')) {
    Title 'Schritt 10/15 – Hermes Agent + Kimi K3'
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
    Title 'Schritt 11/15 – Lokales Sprachmodell (Qwen3-4B) für schnelle Antworten'
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
    Title "Schritt 13/15 – $AN lernt deine Stimme"
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
    Title "Schritt 14/15 – $AN starten"
    Register-UserTask 'JARVIS_Voice' "`"$Inst\scripts\hidden.vbs`" `"$Inst\scripts\start-jarvis-voice.ps1`"" "$AN Sprachsteuerung ($WP)" 45
    # Läuft noch ein Sprachdienst mit alter Konfiguration (Namenswechsel), erst Neustartschleife und Python beenden:
    # sonst startet die Schleife Python nach 10 s neu oder die Aufgabe startet eine zweite Instanz.
    Stop-VoiceService
    Start-ScheduledTask -TaskName 'JARVIS_Voice'
    Info 'Lade die Sprachmodelle (bis zu 3 Minuten) …'
    $ok = $false
    foreach ($i in 1..90) {
        try { if ((Invoke-RestMethod "http://127.0.0.1:$($Ports.Voice)" -TimeoutSec 2).state -eq 'listening') { $ok = $true; break } } catch {}
        Start-Sleep 2
    }
    if (-not $ok) { Stop-Install 'Sprachdienst startet nicht (C:\Jarvis\logs\voice-service.log).' }
    Ok "$AN antwortet auf dem Sprachport (state=listening)."
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
    MarkDone 'voiceservice'
}

# ================================================================ 15 F.R.I.D.A.Y. Command Center (Dashboard + Control API)
# Zielpfad C:\Jarvis\dashboard - Entscheidung des Eigentuemers; PLAN §54 nennt D:\Jarvis\dashboard. Der Installer legt
# ueberall C:\Jarvis zugrunde (kein D:-Laufwerk garantiert); der Pfad steht in dashboard.yaml und ist dort aenderbar.
# Details: docs/DEPLOYMENT.md. Der Schritt ist idempotent; ein Fehler hier laesst Sprache/Hermes/Qwen unangetastet.
$NodeMin = [version]'22.13.0'
# Verzeichnisse, die nie ins Ziel kopiert werden (Build-Ausgaben, Abhaengigkeiten, Screenshots/Belege, Metadaten).
$DashExcludeDirs = @('node_modules', '.git', '.next', 'dist', 'out', 'coverage', 'storybook-static', 'playwright-report',
                     'test-results', 'screenshots', 'evidence', '.turbo', '__pycache__', '.claude')
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
function Ensure-Node {
    $node = Find-Node; $ver = Get-NodeVersion $node
    if ($ver -and $ver -ge $NodeMin) { Ok "Node.js $ver gefunden"; return $node }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Stop-Dashboard "Für das Command Center wird Node.js $NodeMin oder neuer gebraucht, aber winget (App-Installer) fehlt. Bitte im Microsoft Store den 'App-Installer' aktualisieren oder Node.js LTS von https://nodejs.org installieren und install-jarvis.bat erneut starten."
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
        $nd = Split-Path $node
        if (($env:Path -split ';') -notcontains $nd) { $env:Path = "$nd;$env:Path" }
        Ok "Node.js $ver bereit"; return $node
    }
    if ($ver) { Stop-Dashboard "Node.js $ver ist zu alt (mindestens $NodeMin) und ließ sich nicht aktualisieren (Log: $DashInstallLog). Bitte Node.js LTS manuell von https://nodejs.org installieren und install-jarvis.bat erneut starten." }
    Stop-Dashboard "Node.js wurde installiert oder angefordert, ist in dieser Sitzung aber nicht auffindbar (der PATH wird erst in einer neuen Shell aktualisiert). Dieses Fenster schließen und install-jarvis.bat erneut starten. Log: $DashInstallLog"
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
function Get-SourceHash([string]$src) {
    # Inhaltshash ueber alles, was ins Ziel kopiert wird (ohne Build-Ausgaben und ohne die lokalen Konfigurationsdateien).
    $files = New-Object System.Collections.Generic.List[string]
    foreach ($f in $DashRootFiles) { if (Test-Path "$src\$f") { $files.Add("$src\$f") } }
    $stack = New-Object System.Collections.Generic.Stack[string]
    foreach ($d in ($DashSyncDirs + 'config')) { if (Test-Path "$src\$d") { $stack.Push("$src\$d") } }
    while ($stack.Count -gt 0) {
        $cur = $stack.Pop()
        $di = New-Object IO.DirectoryInfo $cur
        foreach ($sub in $di.GetDirectories()) { if ($DashExcludeDirs -notcontains $sub.Name) { $stack.Push($sub.FullName) } }
        foreach ($fi in $di.GetFiles()) { $files.Add($fi.FullName) }
    }
    $files.Sort([StringComparer]::Ordinal)
    $sb = New-Object Text.StringBuilder
    foreach ($f in $files) {
        $rel = $f.Substring($src.Length).TrimStart('\')
        if ($rel -in 'config\dashboard.yaml', 'config\adapters.yaml') { continue }
        [void]$sb.Append($rel).Append(':').Append((Get-FileHash $f -Algorithm SHA256).Hash).Append("`n")
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    return (-join ($sha.ComputeHash((New-Object Text.UTF8Encoding $false).GetBytes($sb.ToString())) | ForEach-Object { $_.ToString('x2') }))
}
function Sync-DashSource([string]$src) {
    New-Item -ItemType Directory -Force $Dash | Out-Null
    foreach ($f in $DashRootFiles) { if (Test-Path "$src\$f") { Copy-Item "$src\$f" "$Dash\$f" -Force } }
    foreach ($d in $DashSyncDirs) {
        if (-not (Test-Path "$src\$d")) { continue }
        # /MIR spiegelt (entfernt Veraltetes); ausgeschlossene Ordner (node_modules, dist, out, ...) bleiben im Ziel unberuehrt.
        & robocopy.exe "$src\$d" "$Dash\$d" /MIR /XD @DashExcludeDirs /XF '*.log' /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Dashboard "Kopieren von '$d' nach $Dash fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    if (Test-Path "$src\config") {
        # Ohne /MIR und ohne dashboard.yaml/adapters.yaml: lokale Konfiguration des Benutzers bleibt erhalten.
        & robocopy.exe "$src\config" "$Dash\config" /E /XF dashboard.yaml adapters.yaml /NFL /NDL /NJH /NJS /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { Stop-Dashboard "Kopieren von 'config' nach $Dash fehlgeschlagen (robocopy-Code $LASTEXITCODE)." }
    }
    foreach ($d in 'config', 'data', 'backups') { New-Item -ItemType Directory -Force "$Dash\$d" | Out-Null }
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
    # server.port aus dashboard.yaml (einfacher Zeilenscan; Umgebungsvariable JARVIS_PORT bleibt unberuecksichtigt).
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
    Stop-LauncherService $DashTask 'start-dashboard.ps1' '*control-api*dist*main.js*'
}
function Write-DashFile([string]$path, [string]$content, [string]$label) {
    $content = $content.Replace("`r`n", "`n")
    $enc = New-Object Text.UTF8Encoding $false
    if (-not (Test-Path $path)) { [IO.File]::WriteAllText($path, $content, $enc); Ok "$label geschrieben: $path"; return }
    if ([IO.File]::ReadAllText($path).Replace("`r`n", "`n") -eq $content) { Info "$label ist aktuell: $path"; return }
    if ($UpdateDashboard) { Info "$label bleibt unverändert (deine Änderungen werden behalten): $path"; return }
    Warn "$label existiert bereits und weicht von der Vorgabe des Installers ab: $path"
    if (YesNo 'Mit der Vorgabe überschreiben? (die alte Datei wird nach C:\Jarvis\backups gesichert)' $false) {
        Copy-Item $path "$Root\backups\$(Split-Path $path -Leaf).bak-$(Get-Date -Format yyyyMMdd-HHmmss)" -Force
        [IO.File]::WriteAllText($path, $content, $enc); Ok "$label überschrieben"
    } else { Info "$label bleibt unverändert (deine Änderungen werden behalten)." }
}
function Write-DashboardConfig {
    $cfg = "$Dash\config"
    # Nur der Anzeigename wird in einer bestehenden dashboard.yaml nachgezogen (Namenswechsel), alles andere bleibt wie es ist.
    if (Test-Path "$cfg\dashboard.yaml") {
        $old = [IO.File]::ReadAllText("$cfg\dashboard.yaml")
        $new = [regex]::Replace($old, '(?m)^(\s*assistantName:[ \t]*)("[^"\r\n]*"|[^\s#"]+)', { param($m) "$($m.Groups[1].Value)`"$AN`"" })
        if ($new -ne $old) { [IO.File]::WriteAllText("$cfg\dashboard.yaml", $new, (New-Object Text.UTF8Encoding $false)); Info "Anzeigename in dashboard.yaml auf '$AN' gesetzt." }
    }
    $dashboardYaml = @"
# F.R.I.D.A.Y. Command Center - Dashboard-Konfiguration (vom Installer erzeugt, HYBRID-Betrieb; frei editierbar).
# Der Installer ueberschreibt diese Datei nie ohne Rueckfrage. Mehr: docs/DEPLOYMENT.md, config/dashboard.example.yaml.
# Geaendert wird nach einem Neustart der Aufgabe JARVIS_Dashboard wirksam.

dataMode: hybrid # mock | hybrid | live - hybrid: in adapters.yaml genannte Kategorien live, der Rest mock

server:
  host: 127.0.0.1 # nur Loopback
  port: 3100
  allowRemote: false

# Pfade ohne Backslash (YAML). Entscheidung: C:\Jarvis\dashboard statt D:\Jarvis\dashboard (PLAN 54), Logs bei den
# anderen Diensten in C:\Jarvis\logs.
paths:
  dataDir: C:/Jarvis/dashboard/data
  logDir: C:/Jarvis/logs/dashboard
  backupDir: C:/Jarvis/dashboard/backups
  webRoot: C:/Jarvis/dashboard/apps/web/out

auth:
  mode: local
  ownerUsername: owner
  # Nur der scrypt-Hash, nie das Passwort. Datei mit Zugriff nur fuer den Installationsbenutzer (icacls).
  ownerPasswordHash: file:C:/Jarvis/config/dashboard_owner.hash
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
  theme: jarvis-command-midnight
  layout: jarvis-command-overview

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
# F.R.I.D.A.Y. Command Center - Adapter (vom Installer erzeugt, HYBRID-Betrieb; frei editierbar).
# Live: Aufgaben/Aktivitaet/Agenten ueber Hermes, Sprache ueber den Voice-Dienst, Systemstatus vom lokalen Rechner.
# Alle anderen Kategorien (memory, approvals, communication, calendar, automations, research, files, notifications,
# audit, commands) bleiben im Hybrid-Modus mock-* und sind in der Oberflaeche als Simulation erkennbar.
# Ports (Installer): 43691 Hermes-Dashboard, 43692 Qwen, 43693 Hermes-API, 43694 Voice-Status.
# Geheimnisse nie im Klartext: file:<absoluter Pfad> (nur serverseitig gelesen), env:NAME oder wincred:ZIEL.

allowlist:
  hermes-tasks: "@jarvis/adapter-hermes"
  hermes-activity: "@jarvis/adapter-hermes"
  hermes-agents: "@jarvis/adapter-hermes"
  jarvis-voice-http: "@jarvis/adapter-voice-http"
  local-system: "@jarvis/adapter-system-local"

adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    timeoutMs: 10000
    config:
      dashboardBaseUrl: http://127.0.0.1:43691
      dashboardAuth: scrape
      boards: [default]
  activity:
    provider: hermes-activity
    enabled: true
    timeoutMs: 10000
    config:
      apiBaseUrl: http://127.0.0.1:43693
      apiKey: "file:C:/Jarvis/config/hermes_api.key"
      dashboardBaseUrl: http://127.0.0.1:43691
      boards: [default]
  agents:
    provider: hermes-agents
    enabled: true
    timeoutMs: 10000
    config:
      apiBaseUrl: http://127.0.0.1:43693
      apiKey: "file:C:/Jarvis/config/hermes_api.key"
      dashboardBaseUrl: http://127.0.0.1:43691
      boards: [default]
  voice:
    provider: jarvis-voice-http
    enabled: true
    timeoutMs: 3000
    config:
      baseUrl: http://127.0.0.1:43694
      localModelUrl: http://127.0.0.1:43692
      wakePhrase: "$WP"
  system:
    provider: local-system
    enabled: true
    timeoutMs: 5000
    config:
      qwenUrl: http://127.0.0.1:43692
      hermesApiUrl: http://127.0.0.1:43693
      hermesDashboardUrl: http://127.0.0.1:43691
      voiceUrl: http://127.0.0.1:43694
      hermesApiKey: "file:C:/Jarvis/config/hermes_api.key"
      storagePaths: ["C:/"]
      wslDistro: $Distro
"@
    Write-DashFile "$cfg\dashboard.yaml" $dashboardYaml 'dashboard.yaml'
    Write-DashFile "$cfg\adapters.yaml" $adaptersYaml 'adapters.yaml'
}
function Protect-OwnerFile([string]$file) {
    & icacls.exe $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" /grant:r 'SYSTEM:(R)' | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Dashboard "Zugriffsrechte für $file konnten nicht gesetzt werden." }
}
function Set-DashboardOwnerPassword {
    $have = (Test-Path $DashHashFile) -and ((Get-Item $DashHashFile).Length -gt 0)
    if ($have) {
        Protect-OwnerFile $DashHashFile
        if ($UpdateDashboard -or -not (YesNo 'Für das Command Center ist bereits ein Owner-Passwort gesetzt. Neu setzen?' $false)) { Ok 'Owner-Passwort bleibt bestehen.'; return }
    }
    Info 'Lege das Passwort für den Login im Command Center fest (Benutzername: owner).'
    Info 'Mindestens 12 Zeichen. Gespeichert wird nur ein Hash (scrypt), nie das Passwort selbst.'
    while ($true) {
        $pw = Plain (Read-Host '  Owner-Passwort' -AsSecureString)
        $pw2 = Plain (Read-Host '  Passwort wiederholen' -AsSecureString)
        if ($pw.Length -lt 12) { Warn 'Das Passwort braucht mindestens 12 Zeichen.'; continue }
        if ($pw -ne $pw2) { Warn 'Die Eingaben sind nicht gleich - bitte nochmal.'; continue }
        break
    }
    $pw2 = $null
    Push-Location $Dash
    try { $lines = @($pw | & pnpm.cmd --filter '@jarvis/auth' hash-password 2>&1 | ForEach-Object { "$_" }) }
    finally { Pop-Location; $pw = $null }
    $text = $lines -join "`n"
    if (-not ($text -match 'JARVIS_OWNER_PASSWORD_HASH=''(scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+)''')) {
        Write-DashLog ">>> hash-password fehlgeschlagen:`n$text"
        Stop-Dashboard "Das Passwort-Hash-Werkzeug (pnpm --filter @jarvis/auth hash-password) hat keinen Hash geliefert. Log: $DashInstallLog"
    }
    $hash = $Matches[1]
    # Datei zuerst leer anlegen und absichern, dann erst den Hash hineinschreiben (Muster hermes_api.key).
    if (-not (Test-Path $DashHashFile)) { New-Item -ItemType File -Path $DashHashFile | Out-Null }
    Protect-OwnerFile $DashHashFile
    [IO.File]::WriteAllText($DashHashFile, $hash, (New-Object Text.UTF8Encoding $false))
    $hash = $null; $text = $null; $lines = $null
    Ok "Owner-Passwort gesetzt (Hash in $DashHashFile, nur für $($env:USERNAME) lesbar)."
}
function Install-Dashboard {
    Write-DashLog "=== Dashboard-Schritt gestartet ($(Get-Date -Format s)) ==="
    Info "Ziel: $Dash  |  URL: $DashUrl  |  Log: $DashInstallLog"
    Info 'Hinweis: PLAN §54 nennt D:\Jarvis\dashboard; hier gilt C:\Jarvis\dashboard (Entscheidung des Eigentümers, siehe docs\DEPLOYMENT.md).'

    # --- Quelle des Command Centers: Ordner neben installer\ (oder der beim ersten Start gemerkte)
    $src = $null
    foreach ($cand in @((Split-Path $PSScriptRoot -Parent), $State.dashboard_source)) {
        if ($cand -and (Test-Path "$cand\pnpm-workspace.yaml") -and (Test-Path "$cand\apps\control-api\package.json")) { $src = "$cand".TrimEnd('\'); break }
    }
    if (-not $src) {
        Stop-Dashboard "Die Quellen des Command Centers (Ordner apps, packages, adapters, config neben dem Ordner 'installer') wurden nicht gefunden. Bitte das komplette Paket entpacken (nicht nur den Ordner 'installer') und install-jarvis.bat aus dem entpackten Paket starten; der entpackte Ordner muss bis zum Ende der Installation an seinem Platz bleiben."
    }
    if ($src -eq $Dash) { Stop-Dashboard "Die Quelle darf nicht $Dash selbst sein - bitte install-jarvis.bat aus dem entpackten Paket starten." }
    Info "Quelle: $src"

    # --- Node.js + pnpm
    $node = Ensure-Node
    $pm = (Get-Content "$src\package.json" -Raw | ConvertFrom-Json).packageManager
    if (-not ("$pm" -match '^pnpm@(\d+\.\d+\.\d+)')) { Stop-Dashboard "Im package.json fehlt 'packageManager: pnpm@<Version>' ($src\package.json)." }
    $pnpmVersion = $Matches[1]
    Ensure-Pnpm $pnpmVersion

    # --- Quellen bereitstellen, installieren, bauen (nur wenn sich etwas geaendert hat)
    Info 'Prüfe Quellstand …'
    $hash = Get-SourceHash $src
    $built = (Test-Path "$Dash\apps\control-api\dist\main.js") -and [bool](Get-ChildItem "$Dash\apps\web\out" -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($State.dashboard_hash -eq $hash -and $built) {
        Ok "Quellen unverändert (Hash $($hash.Substring(0, 12))) - Build übersprungen."
    } else {
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
        Warn "Das Command Center wurde gebaut und konfiguriert, aber nicht gestartet. Programm beenden oder in $Dash\config\dashboard.yaml einen anderen Port wählen, dann install-jarvis.bat erneut starten."
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
        Warn 'Sprache und Hermes laufen davon unabhängig weiter. Ursache beheben und install-jarvis.bat erneut starten.'
        return
    }
    if ($h.Code -ge 200 -and $h.Code -lt 300) { Ok "Command Center läuft: $DashUrl (Health $($h.Code))" }
    else { Warn "Command Center läuft, meldet aber HTTP $($h.Code) (einzelne Adapter eingeschränkt? Siehe $Root\logs\dashboard-service.log). Es bleibt eingerichtet." }
    $script:DashOk = $true
}

Set-DashPort
if (-not (IsDone 'dashboard') -or $UpdateDashboard) {
    Title 'Schritt 15/15 – F.R.I.D.A.Y. Command Center (Dashboard) einrichten'
    try { Install-Dashboard }
    catch {
        $script:DashOk = $false
        Write-DashLog "FEHLER: $($_.Exception.Message)"
        Write-Host ""; Write-Host "  [FEHLER] Command Center: $($_.Exception.Message)" -ForegroundColor Red
        Warn "Log: $DashInstallLog"
    }
    if ($script:DashOk) { MarkDone 'dashboard' }
    else {
        Warn 'Das Command Center ist noch nicht fertig eingerichtet (Details oben). Sprache und Hermes sind davon nicht betroffen.'
        Warn "Erneut versuchen: update-dashboard.bat (im Paketordner) oder install-jarvis.bat -Resume. Log: $DashInstallLog"
    }
}

$DashProbe = Test-DashboardHealth 3
$p = Get-Content "$Root\config\persona.json" -Raw | ConvertFrom-Json
$dashNote = if (IsDone 'dashboard') { '' } else { "ACHTUNG: Command Center nicht eingerichtet - update-dashboard.bat oder install-jarvis.bat -Resume starten. Log: $DashInstallLog" }
$report = @"
# F.R.I.D.A.Y. – Installationsstatus

Installiert am $(Get-Date -Format 'dd.MM.yyyy HH:mm') für $($p.owner_name). Assistent: $AN · Wake Word: "$WP" ($($State.wake_engine)).

| Komponente | Adresse |
|---|---|
| F.R.I.D.A.Y. Command Center | $DashUrl (Login: owner) |
| Hermes Dashboard | http://127.0.0.1:$($Ports.Dashboard) |
| Qwen3-4B (lokal) | http://127.0.0.1:$($Ports.Qwen)/v1 |
| Hermes API (für Sprache) | http://127.0.0.1:$($Ports.HermesApi)/v1 |
| Sprachdienst-Status | http://127.0.0.1:$($Ports.Voice) |

Grafikkarte: $($State.gpu.name) ($($State.gpu.vram_mb) MB) · Linux-Benutzer: $($State.linux_user)
Autostart: JARVIS_WSL_Keepalive, JARVIS_Qwen, JARVIS_Voice, JARVIS_Dashboard (Aufgabenplanung). Hermes-Dienste: systemd in Ubuntu.
$dashNote
Erledigte Schritte: $(@($State.done) -join ', ')
"@
[IO.File]::WriteAllText("$Root\INSTALL_STATE.md", $report, (New-Object Text.UTF8Encoding $false))

Title "FERTIG – $AN ist einsatzbereit"
Info "Sag:  ""$WP""  … kurzer Piepton … dann deine Frage, z. B. ""Wie spät ist es?"""
Info "Folgefragen gehen 90 Sekunden lang ohne erneutes ""$WP""."
if ($DashProbe.Up) { Info "Command Center (Dashboard, Login 'owner'): $DashUrl" }
else { Warn "Command Center nicht erreichbar ($DashUrl) - Logs: $Root\logs\dashboard-service.log, $DashInstallLog. Erneut versuchen: update-dashboard.bat oder install-jarvis.bat -Resume." }
Info "Hermes-Dashboard (Kanban, Einstellungen): http://127.0.0.1:$($Ports.Dashboard)"
Info 'Alles startet ab jetzt automatisch bei der Anmeldung.'
Info 'Nächste Schritte (Telegram, E-Mail, Kalender): siehe ANLEITUNG.md'
if ($DashProbe.Up -and (YesNo 'Command Center jetzt im Browser öffnen?')) { Start-Process $DashUrl }
elseif (-not $DashProbe.Up) { Start-Process "http://127.0.0.1:$($Ports.Dashboard)" }
Stop-Transcript | Out-Null
Read-Host '  Enter zum Schließen'
