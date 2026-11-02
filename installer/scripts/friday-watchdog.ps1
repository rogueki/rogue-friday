# F.R.I.D.A.Y. Service-Watchdog: prueft einmal pro Aufruf (Aufgabe FRIDAY_Watchdog, alle 5 Minuten, unsichtbar ueber hidden.vbs),
# ob die installierten Dienste (Sprachdienst 43694, Qwen 43692, Command Center aus dashboard.yaml/3100, Hermes-Dashboard in WSL) antworten, und startet
# einen abgestuerzten Dienst ueber seine Aufgabe (Start-ScheduledTask) neu. Prozesse werden nur beendet, wenn ein Dienst haengt
# (Port offen, HTTP seit $HungRestartMinutes min ohne Antwort) - dann genau die Prozesse dieses Dienstes.
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
$HungRestartMinutes = 5     # Port offen, HTTP antwortet so lange nicht: Dienstprozesse beenden und neu starten
$HeartbeatMinutes   = 60
$OrphanFlagMinutes  = 10    # Installer und Stimmen-Update entfernen ihr Stop-Flag nach Sekunden; aelter heisst: Lauf abgebrochen

function Test-StopFlagOrphaned {
    # Ein abgebrochenes Update (2026-11-01: Konsole weg, Rollback gescheitert) liess das Flag liegen; der Sprachdienst blieb danach
    # dauerhaft aus, weil der Watchdog es als gewollten Stopp las. Laufende Installer-/Update-Laeufe sind ueber InstallerActive geschuetzt.
    param([Nullable[datetime]]$FlagWrittenAt, [datetime]$Now, [bool]$InstallerActive, [int]$OrphanMinutes = 10)
    if ($null -eq $FlagWrittenAt -or $InstallerActive) { return $false }
    return (($Now - $FlagWrittenAt).TotalMinutes -ge $OrphanMinutes)
}

function Get-WatchdogDecision {
    # Reine Entscheidungslogik ohne Seiteneffekte. Zeiten als Unix-Sekunden. Rueckgabe: Action = ok | installer-active | stopped |
    # loading | grace | backoff | limit | restart.
    param(
        [bool]$PortUp, [bool]$ProcessRunning, [bool]$StopFlag, [bool]$InstallerActive, [bool]$InGrace,
        [long[]]$RestartTimes = @(), [long]$Now = 0,
        [int]$MinIntervalMinutes = 10, [int]$MaxPerHour = 3,
        [bool]$HttpHung = $false, [int]$HungMinutes = 0, [int]$HungRestartMinutes = 5
    )
    if ($PortUp) { return [pscustomobject]@{ Action = 'ok'; Reason = 'Port antwortet' } }
    if ($InstallerActive) { return [pscustomobject]@{ Action = 'installer-active'; Reason = 'Installer laeuft' } }
    if ($StopFlag) { return [pscustomobject]@{ Action = 'stopped'; Reason = 'Stop-Flag gesetzt (gewollter Stopp)' } }
    # Port offen, aber keine HTTP-Antwort: der Server haengt (2026-11-02: Command Center 15 min eingefroren). Modellladen haelt
    # den Port dagegen geschlossen und faellt unter 'loading'.
    $hung = $HttpHung -and $ProcessRunning
    if ($hung -and $HungMinutes -lt $HungRestartMinutes) {
        return [pscustomobject]@{ Action = 'hung-wait'; Reason = "Port offen, keine HTTP-Antwort seit $HungMinutes min" }
    }
    if ($ProcessRunning -and -not $hung) { return [pscustomobject]@{ Action = 'loading'; Reason = 'Prozess laeuft, Port noch zu (Modellladen?)' } }
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
    if ($hung) { return [pscustomobject]@{ Action = 'restart-hung'; Reason = "Port offen, seit $HungMinutes min keine HTTP-Antwort" } }
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
function Test-WslUnitActive([string]$unit) {
    # Ein startender Dienst haelt den Port noch zu; nur ein inaktiver/fehlgeschlagener Dienst wird neu gestartet.
    # Ist der Zustand nicht lesbar, gilt der Dienst als laufend: lieber kein Neustart als ein unbelegter.
    try {
        $out = & wsl.exe -d $script:Distro -u $script:LinuxUser --exec systemctl --user is-active $unit 2>$null
        return @('active', 'activating', 'reloading') -contains "$out".Trim()
    } catch { return $true }
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
                    hungSince = [long]$v.hungSince
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
    # Hermes-Dashboard laeuft als systemd-Benutzerdienst in WSL; die Adapter fuer Aufgaben/Agenten/Aktivitaet lesen nur dort.
    $hermesDashPort = if ($installedState.ports.Dashboard) { [int]$installedState.ports.Dashboard } else { 43691 }
    $script:Distro = "$($installedState.distro_name)"
    $script:LinuxUser = "$($installedState.linux_user)"
    $wslReady = ($script:Distro -match '^[A-Za-z0-9_.-]+$') -and ($script:LinuxUser -match '^[a-z_][a-z0-9_-]*$')
    $services = @(
        @{ Key = 'voice';     Name = 'Sprachdienst';   Step = 'voiceservice'; Task = 'FRIDAY_Voice';     Launcher = 'start-friday-voice.ps1'; Child = '*friday_voice.py*';           Port = $voicePort;    Http = $null }
        @{ Key = 'qwen';      Name = 'Qwen';           Step = 'qwen';         Task = 'FRIDAY_Qwen';      Launcher = 'start-qwen-server.ps1';  Child = "*llama-server*--port $qwenPort*"; Port = $qwenPort;    Http = $null }
        @{ Key = 'dashboard'; Name = 'Command Center'; Step = 'dashboard';    Task = 'FRIDAY_Dashboard'; Launcher = 'start-dashboard.ps1';    Child = '*control-api*dist*main.js*';  Port = $dashPort; Http = "http://127.0.0.1:$dashPort/api/v1/health" }
        @{ Key = 'hermes-dashboard'; Name = 'Hermes-Dashboard'; Step = 'hermes'; Task = $null; Launcher = 'hermes-dashboard'; Child = $null; Unit = 'hermes-dashboard.service'; Port = $hermesDashPort; Http = $null }
    ) | Where-Object { $done -contains $_.Step -and ($_.Key -ne 'qwen' -or $installedState.voice_mode -ne 'elevenlabs') -and ($_.Key -ne 'hermes-dashboard' -or $wslReady) }
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
        if (-not $state.services.ContainsKey($svc.Key)) { $state.services[$svc.Key] = @{ restarts = @(); downSince = [long]0; lastWarn = [long]0; lastAction = ''; hungSince = [long]0 } }
        $st = $state.services[$svc.Key]
        $st.restarts = @($st.restarts | Where-Object { ($now - $_) -lt 3600 })

        $tcpUp = Test-TcpPort $svc.Port
        $portUp = $tcpUp
        if ($portUp -and $svc.Http) { $portUp = Test-HttpAnswer $svc.Http }
        $serviceProcs = @(if (-not $svc.Unit) { $procs | Where-Object { "$($_.CommandLine)" -like "*$($svc.Launcher)*" -or ($svc.Child -and "$($_.CommandLine)" -like $svc.Child) } })
        $running = if ($svc.Unit) { (-not $portUp) -and (Test-WslUnitActive $svc.Unit) } else { $serviceProcs.Count -gt 0 }
        $httpHung = $tcpUp -and -not $portUp -and -not $svc.Unit
        if ($httpHung) { if (-not $st.hungSince) { $st.hungSince = $now } } else { $st.hungSince = [long]0 }
        $hungMin = if ($st.hungSince) { [int](($now - $st.hungSince) / 60) } else { 0 }
        $target = if ($svc.Unit) { "WSL-Dienst $($svc.Unit)" } else { "Aufgabe $($svc.Task)" }
        $flagPath = "$root\run\$($svc.Launcher).stop"
        $stopFlag = Test-Path $flagPath
        if ($stopFlag) {
            $flagWrittenAt = try { (Get-Item -LiteralPath $flagPath -ErrorAction Stop).LastWriteTime } catch { $null }
            if (Test-StopFlagOrphaned -FlagWrittenAt $flagWrittenAt -Now (Get-Date) -InstallerActive $installerActive -OrphanMinutes $OrphanFlagMinutes) {
                try {
                    Remove-Item -LiteralPath $flagPath -Force -ErrorAction Stop
                    $stopFlag = $false
                    Write-WatchdogLog 'WARN' "$($svc.Name): verwaistes Stop-Flag (seit $($flagWrittenAt.ToString('s'))) entfernt."
                } catch { Write-WatchdogLog 'ERROR' "$($svc.Name): verwaistes Stop-Flag nicht entfernbar: $($_.Exception.Message)" }
            }
        }

        $d = Get-WatchdogDecision -PortUp $portUp -ProcessRunning $running -StopFlag $stopFlag -InstallerActive $installerActive -InGrace $inGrace `
            -RestartTimes ([long[]]$st.restarts) -Now $now -MinIntervalMinutes $MinIntervalMinutes -MaxPerHour $MaxRestartsPerHour `
            -HttpHung $httpHung -HungMinutes $hungMin -HungRestartMinutes $HungRestartMinutes
        $summary += "$($svc.Key)=$($d.Action)"

        if ($portUp) { $st.downSince = [long]0 } elseif ($st.downSince -eq 0) { $st.downSince = $now }
        $downMin = if ($st.downSince -gt 0) { [int](($now - $st.downSince) / 60) } else { 0 }
        $changed = ($d.Action -ne $st.lastAction)

        switch ($d.Action) {
            'ok' { if ($changed -and @('restart', 'backoff', 'limit') -contains $st.lastAction) { Write-WatchdogLog 'INFO' "$($svc.Name): antwortet wieder (Port $($svc.Port))." } }
            'restart' {
                try {
                    if ($svc.Unit) {
                        & wsl.exe -d $script:Distro -u $script:LinuxUser --exec systemctl --user restart $svc.Unit 2>$null
                        if ($LASTEXITCODE -ne 0) { throw "systemctl --user restart $($svc.Unit) endete mit Exitcode $LASTEXITCODE" }
                    } else { Start-ScheduledTask -TaskName $svc.Task -ErrorAction Stop }
                    Write-WatchdogLog 'WARN' "$($svc.Name): Port $($svc.Port) antwortet nicht, kein Prozess - $target neu gestartet."
                } catch {
                    Write-WatchdogLog 'ERROR' "$($svc.Name): Neustart ($target) fehlgeschlagen: $($_.Exception.Message)"
                }
                $st.restarts = @($st.restarts + $now)   # auch bei Fehlschlag zaehlen: Backoff verhindert Dauerfeuer
            }
            'restart-hung' {
                # Nur die Prozesse dieses Dienstes (Launcher und Kind) beenden; ein haengender Server raeumt sich nicht selbst auf.
                try {
                    Stop-ScheduledTask -TaskName $svc.Task -ErrorAction SilentlyContinue
                    foreach ($proc in $serviceProcs) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
                    Start-ScheduledTask -TaskName $svc.Task -ErrorAction Stop
                    Write-WatchdogLog 'WARN' "$($svc.Name): Port $($svc.Port) offen, aber seit $hungMin min keine HTTP-Antwort - $($serviceProcs.Count) Prozess(e) beendet, $target neu gestartet."
                } catch {
                    Write-WatchdogLog 'ERROR' "$($svc.Name): Neustart nach Haenger ($target) fehlgeschlagen: $($_.Exception.Message)"
                }
                $st.restarts = @($st.restarts + $now)
                $st.hungSince = [long]0
            }
            'hung-wait' {
                if ($changed) { Write-WatchdogLog 'WARN' "$($svc.Name): $($d.Reason) - Neustart nach $HungRestartMinutes min." }
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
