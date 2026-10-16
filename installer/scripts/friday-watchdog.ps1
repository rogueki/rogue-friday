# F.R.I.D.A.Y. Service-Watchdog: prueft einmal pro Aufruf (Aufgabe FRIDAY_Watchdog, alle 5 Minuten, unsichtbar ueber hidden.vbs),
# ob die installierten Dienste (Sprachdienst 43694, Qwen 43692, Command Center aus dashboard.yaml/3100) antworten, und startet
# einen abgestuerzten Dienst ueber seine Aufgabe (Start-ScheduledTask) neu. Es wird nie ein Prozess beendet.
# Neustart nur, wenn ALLES zutrifft: Port/Health antwortet nicht, kein Launcher-/Dienstprozess laeuft (Modellladen haelt den Port
# geschlossen, der Prozess existiert aber), kein Stop-Flag C:\Friday\run\<launcher>.stop (gewollter Stopp), der Installer laeuft nicht
# (C:\Friday\run\installer.active), nicht innerhalb der Anmelde-Schonfrist und Backoff (10 min Abstand, max. 3 Neustarts/Stunde).
# Log: C:\Friday\logs\watchdog.log (Rotation bei 1 MB), Zustand: C:\Friday\run\watchdog-state.json.
# -LibraryOnly: nur die Funktionen laden (Unit-Tests der Entscheidungslogik per Dot-Sourcing).
param([switch]$LibraryOnly)

$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$script:LogFile   = "$root\logs\watchdog.log"
$script:StateFile = "$root\run\watchdog-state.json"
$MinIntervalMinutes = 10
$MaxRestartsPerHour = 3
$GraceMinutes       = 3     # nach der Anmeldung starten die Aufgaben selbst (Verzoegerung 45-60 s plus Modellladen)
$HangWarnMinutes    = 20    # Prozess laeuft, Port aber so lange zu: nur warnen
$HeartbeatMinutes   = 60

function Get-WatchdogDecision {
    # Reine Entscheidungslogik ohne Seiteneffekte. Zeiten als Unix-Sekunden. Rueckgabe: Action = ok | installer-active | stopped |
    # loading | grace | backoff | limit | restart.
    param(
        [bool]$PortUp, [bool]$ProcessRunning, [bool]$StopFlag, [bool]$InstallerActive, [bool]$InGrace,
        [long[]]$RestartTimes = @(), [long]$Now = 0,
        [int]$MinIntervalMinutes = 10, [int]$MaxPerHour = 3
    )
    if ($PortUp) { return [pscustomobject]@{ Action = 'ok'; Reason = 'Port antwortet' } }
    if ($InstallerActive) { return [pscustomobject]@{ Action = 'installer-active'; Reason = 'Installer laeuft' } }
    if ($StopFlag) { return [pscustomobject]@{ Action = 'stopped'; Reason = 'Stop-Flag gesetzt (gewollter Stopp)' } }
    if ($ProcessRunning) { return [pscustomobject]@{ Action = 'loading'; Reason = 'Prozess laeuft, Port noch zu (Modellladen?)' } }
    if ($InGrace) { return [pscustomobject]@{ Action = 'grace'; Reason = 'Schonfrist nach der Anmeldung' } }
    $times = @($RestartTimes | Where-Object { $_ -gt 0 })
    $last = if ($times.Count -gt 0) { ($times | Measure-Object -Maximum).Maximum } else { 0 }
    if ($last -gt 0 -and ($Now - $last) -lt ($MinIntervalMinutes * 60)) {
        return [pscustomobject]@{ Action = 'backoff'; Reason = "letzter Neustart vor $([math]::Floor(($Now - $last) / 60)) min (Abstand $MinIntervalMinutes min)" }
    }
    $recent = @($times | Where-Object { ($Now - $_) -lt 3600 }).Count
    if ($recent -ge $MaxPerHour) {
        return [pscustomobject]@{ Action = 'limit'; Reason = "$recent Neustarts in der letzten Stunde (Maximum $MaxPerHour) - nur Warnung" }
    }
    return [pscustomobject]@{ Action = 'restart'; Reason = 'Port zu, kein Prozess, kein Stop-Flag' }
}

if ($LibraryOnly) { return }

function Get-UnixNow { return [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() }
function Write-WatchdogLog([string]$level, [string]$text) {
    $line = "$(Get-Date -Format s) $level $text"
    try {
        New-Item -ItemType Directory -Force (Split-Path $script:LogFile) | Out-Null
        if ((Test-Path $script:LogFile) -and ((Get-Item $script:LogFile).Length -gt 1MB)) { Move-Item $script:LogFile "$($script:LogFile).1" -Force }
        Add-Content -Path $script:LogFile -Value $line -Encoding UTF8
    } catch {
        # Log nicht schreibbar (Datei gesperrt, Platte voll): Ersatzdatei, damit die Meldung nicht verloren geht.
        Add-Content -Path "$env:TEMP\friday-watchdog-fallback.log" -Value "$line (Log-Fehler: $($_.Exception.Message))" -Encoding UTF8 -ErrorAction SilentlyContinue
    }
}
function Test-TcpPort([int]$port, [int]$timeoutMs = 1500) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}
function Test-HttpAnswer([string]$url, [int]$timeoutSec = 5) {
    # Eine HTTP-Antwort mit Fehlercode (z. B. 503 bei Teilausfall) heisst: der Server laeuft.
    try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec $timeoutSec | Out-Null; return $true }
    catch { if ($_.Exception.Response) { return $true }; return $false }
}
function Get-ConfiguredPort([string]$yamlFile, [int]$default) {
    if (-not (Test-Path $yamlFile)) { return $default }
    $inServer = $false
    foreach ($line in (Get-Content $yamlFile)) {
        if ($line -match '^server:') { $inServer = $true; continue }
        if ($inServer -and $line -match '^\S' -and $line -notmatch '^\s*#') { $inServer = $false }
        if ($inServer -and $line -match '^\s+port:\s*(\d{2,5})\b') { return [int]$Matches[1] }
    }
    return $default
}
function Test-InstallerActive {
    # Der Installer legt C:\Friday\run\installer.active (Inhalt: PID) an und entfernt sie am Ende. Verwaiste Markierungen
    # (Absturz, Neustart mitten in der Installation) zaehlen nicht: Prozess muss leben und ein PowerShell sein, Alter < 12 h.
    $f = "$root\run\installer.active"
    if (-not (Test-Path $f)) { return $false }
    try {
        if (((Get-Date) - (Get-Item $f).LastWriteTime).TotalHours -gt 12) { return $false }
        $installerPid = [int]((Get-Content $f -Raw).Trim())
        $p = Get-Process -Id $installerPid -ErrorAction SilentlyContinue
        return ($null -ne $p -and $p.ProcessName -like 'powershell*')
    } catch { Write-WatchdogLog 'WARN' "installer.active nicht lesbar: $($_.Exception.Message)"; return $false }
}
function Get-LogonAgeMinutes {
    # Alter der Anmeldesitzung (aeltester explorer.exe der eigenen Sitzung); $null, wenn nicht ermittelbar.
    try {
        $sid = (Get-Process -Id $PID).SessionId
        $e = Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sid } | Sort-Object StartTime | Select-Object -First 1
        if ($e) { return ((Get-Date) - $e.StartTime).TotalMinutes }
    } catch { return $null }
    return $null
}
function Read-WatchdogState {
    $s = @{ services = @{}; lastHeartbeat = [long]0 }
    if (-not (Test-Path $script:StateFile)) { return $s }
    try {
        $j = Get-Content $script:StateFile -Raw | ConvertFrom-Json
        if ($j.lastHeartbeat) { $s.lastHeartbeat = [long]$j.lastHeartbeat }
        if ($j.services) {
            foreach ($prop in $j.services.PSObject.Properties) {
                $v = $prop.Value
                $s.services[$prop.Name] = @{
                    restarts = @(@($v.restarts) | Where-Object { $_ } | ForEach-Object { [long]$_ })
                    downSince = [long]$v.downSince; lastWarn = [long]$v.lastWarn; lastAction = "$($v.lastAction)"
                }
            }
        }
    } catch { Write-WatchdogLog 'WARN' "Zustandsdatei unlesbar, beginne neu: $($_.Exception.Message)" }
    return $s
}
function Save-WatchdogState($state) {
    try {
        New-Item -ItemType Directory -Force (Split-Path $script:StateFile) | Out-Null
        $tmp = "$($script:StateFile).tmp"
        [IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
        Move-Item $tmp $script:StateFile -Force
    } catch { Write-WatchdogLog 'ERROR' "Zustand nicht speicherbar: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- Einzelinstanz
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\FRIDAY_Watchdog', [ref]$created)
if (-not $created) { exit 0 }
try {
    # ------------------------------------------------------------ installierte Dienste (Schritt erledigt)
    $done = @()
    try {
        $installedState = Get-Content "$root\config\install-state.json" -Raw | ConvertFrom-Json
        $done = @($installedState.done)
    }
    catch { Write-WatchdogLog 'ERROR' "install-state.json nicht lesbar: $($_.Exception.Message)"; exit 0 }
    $voicePort = if ($installedState.ports.Voice) { [int]$installedState.ports.Voice } else { 43694 }
    $qwenPort = if ($installedState.ports.Qwen) { [int]$installedState.ports.Qwen } else { 43692 }
    $commandCenterPort = if ($installedState.ports.CommandCenter) { [int]$installedState.ports.CommandCenter } else { 3100 }
    $dashPort = Get-ConfiguredPort "$root\dashboard\config\dashboard.yaml" $commandCenterPort
    $services = @(
        @{ Key = 'voice';     Name = 'Sprachdienst';   Step = 'voiceservice'; Task = 'FRIDAY_Voice';     Launcher = 'start-friday-voice.ps1'; Child = '*friday_voice.py*';           Port = $voicePort;    Http = $null }
        @{ Key = 'qwen';      Name = 'Qwen';           Step = 'qwen';         Task = 'FRIDAY_Qwen';      Launcher = 'start-qwen-server.ps1';  Child = "*llama-server*--port $qwenPort*"; Port = $qwenPort;    Http = $null }
        @{ Key = 'dashboard'; Name = 'Command Center'; Step = 'dashboard';    Task = 'FRIDAY_Dashboard'; Launcher = 'start-dashboard.ps1';    Child = '*control-api*dist*main.js*';  Port = $dashPort; Http = "http://127.0.0.1:$dashPort/api/v1/health" }
    ) | Where-Object { $done -contains $_.Step }
    if (@($services).Count -eq 0) { exit 0 }

    $state = Read-WatchdogState
    $now = Get-UnixNow
    $installerActive = Test-InstallerActive
    $age = Get-LogonAgeMinutes
    $inGrace = ($null -ne $age -and $age -lt $GraceMinutes)

    # Eine Prozessabfrage pro Durchlauf. Schlaegt sie fehl, ist "kein Prozess" nicht belegt: dann nichts neu starten.
    try {
        $procs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe' OR Name='python.exe' OR Name='node.exe' OR Name='llama-server.exe'" -ErrorAction Stop |
            Where-Object { $_.ProcessId -ne $PID })
    } catch { Write-WatchdogLog 'ERROR' "Prozessliste nicht lesbar, ueberspringe diesen Durchlauf: $($_.Exception.Message)"; exit 0 }

    $summary = @()
    foreach ($svc in $services) {
        if (-not $state.services.ContainsKey($svc.Key)) { $state.services[$svc.Key] = @{ restarts = @(); downSince = [long]0; lastWarn = [long]0; lastAction = '' } }
        $st = $state.services[$svc.Key]
        $st.restarts = @($st.restarts | Where-Object { ($now - $_) -lt 3600 })

        $portUp = Test-TcpPort $svc.Port
        if ($portUp -and $svc.Http) { $portUp = Test-HttpAnswer $svc.Http }
        $running = @($procs | Where-Object { "$($_.CommandLine)" -like "*$($svc.Launcher)*" -or "$($_.CommandLine)" -like $svc.Child }).Count -gt 0
        $stopFlag = Test-Path "$root\run\$($svc.Launcher).stop"

        $d = Get-WatchdogDecision -PortUp $portUp -ProcessRunning $running -StopFlag $stopFlag -InstallerActive $installerActive -InGrace $inGrace `
            -RestartTimes ([long[]]$st.restarts) -Now $now -MinIntervalMinutes $MinIntervalMinutes -MaxPerHour $MaxRestartsPerHour
        $summary += "$($svc.Key)=$($d.Action)"

        if ($portUp) { $st.downSince = [long]0 } elseif ($st.downSince -eq 0) { $st.downSince = $now }
        $downMin = if ($st.downSince -gt 0) { [int](($now - $st.downSince) / 60) } else { 0 }
        $changed = ($d.Action -ne $st.lastAction)

        switch ($d.Action) {
            'ok' { if ($changed -and @('restart', 'backoff', 'limit') -contains $st.lastAction) { Write-WatchdogLog 'INFO' "$($svc.Name): antwortet wieder (Port $($svc.Port))." } }
            'restart' {
                try {
                    Start-ScheduledTask -TaskName $svc.Task -ErrorAction Stop
                    Write-WatchdogLog 'WARN' "$($svc.Name): Port $($svc.Port) antwortet nicht, kein Prozess - Aufgabe $($svc.Task) neu gestartet."
                } catch {
                    Write-WatchdogLog 'ERROR' "$($svc.Name): Neustart der Aufgabe $($svc.Task) fehlgeschlagen: $($_.Exception.Message)"
                }
                $st.restarts = @($st.restarts + $now)   # auch bei Fehlschlag zaehlen: Backoff verhindert Dauerfeuer
            }
            'loading' {
                if ($downMin -ge $HangWarnMinutes -and ($changed -or (($now - $st.lastWarn) -ge 3600))) {
                    Write-WatchdogLog 'WARN' "$($svc.Name): Prozess laeuft, Port $($svc.Port) seit $downMin min zu - haengt vermutlich (kein automatischer Eingriff, Log des Dienstes pruefen)."
                    $st.lastWarn = $now
                }
            }
            'limit' {
                if ($changed -or (($now - $st.lastWarn) -ge 3600)) { Write-WatchdogLog 'WARN' "$($svc.Name): $($d.Reason)."; $st.lastWarn = $now }
            }
            'stopped' { if ($changed) { Write-WatchdogLog 'INFO' "$($svc.Name): bleibt gestoppt - $($d.Reason)." } }
            default { }   # installer-active, grace, backoff: ruhig, der naechste Durchlauf entscheidet erneut
        }
        $st.lastAction = $d.Action
    }

    if (($now - $state.lastHeartbeat) -ge ($HeartbeatMinutes * 60)) {
        Write-WatchdogLog 'INFO' "Heartbeat: $($summary -join ' ')"
        $state.lastHeartbeat = $now
    }
    Save-WatchdogState $state
}
catch { Write-WatchdogLog 'ERROR' "Watchdog-Durchlauf abgebrochen: $($_.Exception.Message)" }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
